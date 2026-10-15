import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { firstTab, rangeInTabsDocument, tabsDocument, toMarkdown, type CreateCommentRequest, type CreateDocumentRequest, type DocumentSort, type ImportResponse, type SubmitStepsRequest } from "@docs/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  addReply,
  addSuggestionReply,
  CommentVersionConflictError,
  createComment,
  deleteComment,
  deleteReply,
  deleteSuggestionReply,
  editMessage,
  getComment,
  InvalidCommentError,
  listComments,
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
  getDocumentPreview,
  getStepsSince,
  endSession,
  InvalidStepsError,
  listDocuments,
  nameCurrentVersion,
  openDocument,
  renameDocument,
  restoreRevision,
  templateDocument,
} from "./documents.ts";
import { toDocx } from "./export/docx.ts";
import { createImportedDocument, ImportError, importFile, isImportable, MAX_IMPORT_BYTES } from "./import/index.ts";
import { createRemoteFetcher, LinkTitles, RemoteFetchError, type RemoteFetcher } from "./remote.ts";
import { getRevision, listRevisions, nameRevision } from "./revisions.ts";
import { imageTypes, readUpload, sniffImageType, storeUpload } from "./uploads.ts";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const contentTypes = Object.fromEntries(Object.entries(imageTypes).map(([type, ext]) => [ext, type]));
const sorts: DocumentSort[] = ["lastOpened", "lastModifiedByMe", "lastModified", "title"];

type AppOptions = {
  db: Database;
  uploadsDir: string;
  /** Fetches web pages and images; tests replace it. */
  remote?: RemoteFetcher;
};

export function createApp({
  db,
  uploadsDir,
  // REMOTE_FETCH_ALLOW_PRIVATE=1 lets the end-to-end tests paste images served from this machine.
  remote = createRemoteFetcher({ allowPrivate: process.env.REMOTE_FETCH_ALLOW_PRIVATE === "1" }),
}: AppOptions): Hono {
  mkdirSync(uploadsDir, { recursive: true });
  const app = new Hono();
  const linkTitles = new LinkTitles(remote);

  app.onError((error, c) => {
    // As JSON, so the client can show the message.
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    if (error instanceof InvalidStepsError || error instanceof InvalidCommentError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof CommentVersionConflictError) return c.json({ error: error.message }, 409);
    if (error instanceof ImportError) return c.json({ error: error.message }, 422);
    if (error instanceof RemoteFetchError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/documents", (c) => {
    const sort = c.req.query("sort") as DocumentSort | undefined;
    return c.json(listDocuments(db, { query: c.req.query("q"), sort: sort && sorts.includes(sort) ? sort : undefined }));
  });

  app.post("/api/documents", async (c) => {
    const body = await c.req.json<CreateDocumentRequest>().catch(() => ({}) as CreateDocumentRequest);
    if (body.template !== undefined) {
      const template = templateDocument(String(body.template), body.paperSize, body.pageSetup);
      if (!template) throw new HTTPException(400, { message: `Unknown template: ${body.template}` });
      return c.json(createDocument(db, body.title ?? template.name, Date.now(), template.doc), 201);
    }
    return c.json(createDocument(db, body.title, Date.now(), blankDocument(body.paperSize, body.pageSetup)), 201);
  });

  app.post(
    "/api/documents/import",
    // The form around the file adds a little to its size.
    bodyLimit({
      maxSize: MAX_IMPORT_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: "Files can be at most 20 MB" }, 413),
    }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new HTTPException(400, { message: "file is required" });
      if (!isImportable(file.name)) {
        throw new HTTPException(415, { message: "Only Word (.docx) and Markdown (.md) files can be opened" });
      }
      if (file.size > MAX_IMPORT_BYTES) throw new HTTPException(413, { message: "Files can be at most 20 MB" });
      const paperSize = form.get("paperSize");
      const result = await importFile(file.name, new Uint8Array(await file.arrayBuffer()), {
        paperSize: typeof paperSize === "string" ? paperSize : undefined,
        storeImage: async (data) => {
          const type = sniffImageType(data);
          return type ? storeUpload(uploadsDir, data, type) : null;
        },
      });
      return c.json({ document: createImportedDocument(db, file.name, result), dropped: result.dropped } satisfies ImportResponse, 201);
    },
  );

  app.get("/api/documents/:id", (c) => c.json(found(openDocument(db, c.req.param("id")))));

  // The client asks with ?v=<updatedAt>, so a cached preview is only reused while it is current.
  app.get("/api/documents/:id/preview", (c) => {
    const preview = found(getDocumentPreview(db, c.req.param("id")));
    if (c.req.query("v")) c.header("Cache-Control", "private, max-age=31536000, immutable");
    return c.json(preview);
  });

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
    return c.json({ version: result.version, ...(result.alreadyApplied && { alreadyApplied: true }) });
  });

  // The steps after a version, for restoring edits kept in the browser while offline (see sync.ts).
  app.get("/api/documents/:id/steps", (c) => {
    const since = Number(c.req.query("since"));
    if (!Number.isInteger(since)) throw new HTTPException(400, { message: "since must be a version" });
    return c.json(found(getStepsSince(db, c.req.param("id"), since)));
  });

  // Restoring edits another session kept in the browser: ends that session and returns the steps after a version.
  app.post("/api/documents/:id/sessions/:clientId/end", async (c) => {
    const { since } = await c.req.json<{ since?: unknown }>().catch(() => ({ since: undefined }));
    if (!Number.isInteger(since)) throw new HTTPException(400, { message: "since must be a version" });
    return c.json(found(endSession(db, c.req.param("id"), c.req.param("clientId"), since as number)));
  });

  // The title of a web page, for the link bubble.
  app.get("/api/link-preview", async (c) => {
    const url = c.req.query("url");
    if (!url) throw new HTTPException(400, { message: "url is required" });
    return c.json({ title: await linkTitles.title(url) });
  });

  // An image pasted from a web page is copied into the uploads, so documents never depend on other sites.
  app.post("/api/uploads/remote", async (c) => {
    const { url } = await c.req.json<{ url?: unknown }>().catch(() => ({ url: undefined }));
    if (typeof url !== "string") throw new HTTPException(400, { message: "url is required" });
    const response = await remote(url, { maxBytes: MAX_UPLOAD_BYTES, timeoutMs: 15_000, accept: "image/*" });
    if (response.status < 200 || response.status >= 300) throw new HTTPException(502, { message: `The image could not be loaded (${response.status})` });
    const type = sniffImageType(response.body);
    if (!type) throw new HTTPException(415, { message: "Only PNG, JPEG, GIF and WebP images are supported" });
    return c.json({ url: await storeUpload(uploadsDir, new Uint8Array(response.body), type) }, 201);
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

  app.post("/api/documents/:id/suggestions/:suggestionId/replies", async (c) => {
    const { id, suggestionId } = c.req.param();
    found(getDocumentContent(db, id));
    const { body } = await c.req.json<{ body: string }>();
    return c.json(addSuggestionReply(db, id, suggestionId, body), 201);
  });

  app.delete("/api/documents/:id/suggestions/:suggestionId/replies/:replyId", (c) => {
    const { id, suggestionId, replyId } = c.req.param();
    return c.json(found(deleteSuggestionReply(db, id, suggestionId, Number(replyId))));
  });

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

  // ?tab=<id> exports one tab, ?tab=all every tab; without it the first tab.
  app.get("/api/documents/:id/export/:format", async (c) => {
    const { title, doc: content } = found(getDocumentContent(db, c.req.param("id")));
    const which = c.req.query("tab") ?? firstTab(content).id;
    const doc = tabsDocument(content, which);
    const format = c.req.param("format");
    if (format === "md") {
      return download(toMarkdown(doc), `${title}.md`, "text/markdown; charset=utf-8");
    }
    if (format === "docx") {
      const comments = listComments(db, c.req.param("id")).flatMap((comment) => {
        const range = rangeInTabsDocument(content, which, comment);
        return range ? [{ ...comment, ...range }] : [];
      });
      const buffer = await toDocx(doc, title, (src) => readUpload(uploadsDir, src), comments);
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

    return c.json({ url: await storeUpload(uploadsDir, new Uint8Array(await file.arrayBuffer()), file.type) }, 201);
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

function download(body: string | Uint8Array<ArrayBuffer>, filename: string, contentType: string): Response {
  const safeName = filename.replace(/[\\/:*?"<>|\r\n]+/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    },
  });
}
