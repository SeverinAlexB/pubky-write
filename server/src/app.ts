import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { toMarkdown, type CreateCommentRequest, type CreateDocumentRequest, type DocumentSort, type SubmitStepsRequest } from "@docs/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  addReply,
  CommentVersionConflictError,
  createComment,
  deleteComment,
  deleteReply,
  editMessage,
  getComment,
  InvalidCommentError,
  setResolved,
} from "./comments.ts";
import { inTransaction, type Database } from "./database.ts";
import {
  applySteps,
  blankDocument,
  copyDocument,
  copyRevision,
  createDocument,
  deleteDocument,
  getDocumentContent,
  InvalidStepsError,
  listDocuments,
  nameCurrentVersion,
  openDocument,
  renameDocument,
  restoreRevision,
} from "./documents.ts";
import { toDocx } from "./export/docx.ts";
import { getRevision, listRevisions, nameRevision } from "./revisions.ts";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const imageTypes: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const contentTypes = Object.fromEntries(Object.entries(imageTypes).map(([type, ext]) => [ext, type]));
const sorts: DocumentSort[] = ["lastOpened", "lastModified", "title"];

export function createApp({ db, uploadsDir }: { db: Database; uploadsDir: string }): Hono {
  mkdirSync(uploadsDir, { recursive: true });
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof InvalidStepsError || error instanceof InvalidCommentError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof CommentVersionConflictError) return c.json({ error: error.message }, 409);
    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/documents", (c) => {
    const sort = c.req.query("sort") as DocumentSort | undefined;
    return c.json(listDocuments(db, { query: c.req.query("q"), sort: sort && sorts.includes(sort) ? sort : undefined }));
  });

  app.post("/api/documents", async (c) => {
    const body = await c.req.json<CreateDocumentRequest>().catch(() => ({}) as CreateDocumentRequest);
    return c.json(createDocument(db, body.title, Date.now(), blankDocument(body.paperSize)), 201);
  });

  app.get("/api/documents/:id", (c) => c.json(found(openDocument(db, c.req.param("id")))));

  app.post("/api/documents/:id/copy", (c) => c.json(found(copyDocument(db, c.req.param("id"))), 201));

  app.patch("/api/documents/:id", async (c) => {
    const { title } = await c.req.json<{ title: string }>();
    if (typeof title !== "string") throw new HTTPException(400, { message: "title is required" });
    return c.json(found(renameDocument(db, c.req.param("id"), title)));
  });

  app.delete("/api/documents/:id", (c) => {
    found(deleteDocument(db, c.req.param("id")) || null);
    return c.body(null, 204);
  });

  app.post("/api/documents/:id/steps", async (c) => {
    const body = await c.req.json<SubmitStepsRequest>();
    if (typeof body.clientId !== "string" || !Number.isInteger(body.version) || !Array.isArray(body.steps)) {
      throw new HTTPException(400, { message: "clientId, version and steps are required" });
    }
    const result = found(applySteps(db, c.req.param("id"), body));
    if (result.kind === "conflict") {
      const { kind: _kind, ...conflict } = result;
      return c.json(conflict, 409);
    }
    return c.json({ version: result.version });
  });

  app.post("/api/documents/:id/comments", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<CreateCommentRequest>();
    const thread = inTransaction(db, () => {
      const current = found(getDocumentContent(db, id));
      return createComment(db, id, current, body);
    });
    return c.json(thread, 201);
  });

  app.post("/api/documents/:id/comments/:commentId/replies", async (c) => {
    const { body } = await c.req.json<{ body: string }>();
    return c.json(found(addReply(db, c.req.param("id"), Number(c.req.param("commentId")), body)), 201);
  });

  app.patch("/api/documents/:id/comments/:commentId", async (c) => {
    const { resolved } = await c.req.json<{ resolved: boolean }>();
    if (typeof resolved !== "boolean") throw new HTTPException(400, { message: "resolved must be true or false" });
    return c.json(found(setResolved(db, c.req.param("id"), Number(c.req.param("commentId")), resolved)));
  });

  app.delete("/api/documents/:id/comments/:commentId", (c) => {
    found(deleteComment(db, c.req.param("id"), Number(c.req.param("commentId"))) || null);
    return c.body(null, 204);
  });

  app.patch("/api/documents/:id/comments/:commentId/messages/:messageId", async (c) => {
    const { body } = await c.req.json<{ body: string }>();
    const { id, commentId, messageId } = c.req.param();
    return c.json(found(editMessage(db, id, Number(commentId), Number(messageId), body)));
  });

  app.delete("/api/documents/:id/comments/:commentId/messages/:messageId", (c) => {
    const { id, commentId, messageId } = c.req.param();
    return c.json(found(deleteReply(db, id, Number(commentId), Number(messageId))));
  });

  app.get("/api/documents/:id/comments/:commentId", (c) =>
    c.json(found(getComment(db, c.req.param("id"), Number(c.req.param("commentId"))))),
  );

  app.get("/api/documents/:id/revisions", (c) => c.json(listRevisions(db, c.req.param("id"))));

  app.post("/api/documents/:id/revisions/current/name", async (c) =>
    c.json(found(nameCurrentVersion(db, c.req.param("id"), await nameFrom(c.req.json())))),
  );

  app.patch("/api/documents/:id/revisions/:revisionId", async (c) =>
    c.json(found(nameRevision(db, c.req.param("id"), Number(c.req.param("revisionId")), await nameFrom(c.req.json())))),
  );

  app.post("/api/documents/:id/revisions/:revisionId/copy", (c) =>
    c.json(found(copyRevision(db, c.req.param("id"), Number(c.req.param("revisionId")))), 201),
  );

  app.get("/api/documents/:id/revisions/:revisionId", (c) =>
    c.json(found(getRevision(db, c.req.param("id"), Number(c.req.param("revisionId"))))),
  );

  app.post("/api/documents/:id/revisions/:revisionId/restore", (c) =>
    c.json(found(restoreRevision(db, c.req.param("id"), Number(c.req.param("revisionId"))))),
  );

  app.get("/api/documents/:id/export/:format", async (c) => {
    const { title, doc } = found(getDocumentContent(db, c.req.param("id")));
    const format = c.req.param("format");
    if (format === "md") {
      return download(toMarkdown(doc), `${title}.md`, "text/markdown; charset=utf-8");
    }
    if (format === "docx") {
      const buffer = await toDocx(doc, title, (src) => readUpload(uploadsDir, src));
      return download(
        new Uint8Array(buffer),
        `${title}.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    }
    throw new HTTPException(404, { message: `Unknown export format: ${format}` });
  });

  app.post("/api/uploads", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HTTPException(400, { message: "file is required" });
    const extension = imageTypes[file.type];
    if (!extension) throw new HTTPException(415, { message: "Only PNG, JPEG, GIF and WebP images are supported" });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "Images can be at most 10 MB" });

    const name = `${randomUUID()}${extension}`;
    await writeFile(join(uploadsDir, name), new Uint8Array(await file.arrayBuffer()));
    return c.json({ url: `/uploads/${name}` }, 201);
  });

  app.get("/uploads/:name", async (c) => {
    const name = c.req.param("name");
    const data = await readUpload(uploadsDir, `/uploads/${name}`);
    if (!data) throw new HTTPException(404, { message: "Not found" });
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": contentTypes[extname(name)] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  return app;
}

async function nameFrom(body: Promise<{ name?: unknown }>): Promise<string> {
  const { name } = await body.catch(() => ({ name: undefined }));
  if (typeof name !== "string") throw new HTTPException(400, { message: "name is required" });
  return name;
}

function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new HTTPException(404, { message: "Not found" });
  return value;
}

/** Reads an uploaded image by its `/uploads/<name>` URL; other URLs are not read. */
async function readUpload(uploadsDir: string, src: string): Promise<Buffer | null> {
  if (!src.startsWith("/uploads/")) return null;
  const name = basename(src);
  if (name !== src.slice("/uploads/".length)) return null;
  return readFile(join(uploadsDir, name)).catch(() => null);
}

function download(body: string | Uint8Array<ArrayBuffer>, filename: string, contentType: string): Response {
  const safeName = filename.replace(/[\\/:*?"<>|\r\n]+/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    },
  });
}
