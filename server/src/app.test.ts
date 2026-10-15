import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentSummary, ImportResponse, OpenedDocument } from "@docs/shared";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openDatabase } from "./database.ts";
import { MAX_IMPORT_BYTES } from "./import/index.ts";

let app: ReturnType<typeof createApp>;
let uploadsDir: string;

beforeEach(() => {
  uploadsDir = mkdtempSync(join(tmpdir(), "docs-uploads-"));
  app = createApp({ db: openDatabase(":memory:"), uploadsDir });
});

function upload(name: string, content: BlobPart, paperSize?: string) {
  const form = new FormData();
  form.set("file", new File([content], name));
  if (paperSize) form.set("paperSize", paperSize);
  return app.request("/api/documents/import", { method: "POST", body: form });
}

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("POST /api/documents/import", () => {
  it("creates a document named after the file, stores its images and lists dropped content", async () => {
    const response = await upload("Meeting notes.md", `# Agenda\n\n- One\n\n![dot](${PNG_DATA_URL})\n\n<div>x</div>\n`, "Letter");
    expect(response.status).toBe(201);
    const { document, dropped } = (await response.json()) as ImportResponse;
    expect(document.title).toBe("Meeting notes");
    expect(dropped).toEqual(["HTML"]);
    expect(readdirSync(uploadsDir)).toHaveLength(1);

    const opened = (await (await app.request(`/api/documents/${document.id}`)).json()) as OpenedDocument;
    expect(opened.content.attrs?.paperSize).toBe("Letter");
    expect(opened.content.content?.map((block) => block.type)).toEqual(["heading", "bulletList", "image"]);
  });

  it("creates the comments of a Word file and exports them again", async () => {
    const fixture = readFileSync(new URL("import/fixtures/corpus/libreoffice/CommentReply.docx", import.meta.url));
    const { document } = (await (await upload("Reply.docx", fixture)).json()) as ImportResponse;
    const opened = (await (await app.request(`/api/documents/${document.id}`)).json()) as OpenedDocument;
    expect(opened.comments.map((comment) => comment.messages.map((message) => message.body))).toEqual([["Parent", "Child"]]);

    const exported = await app.request(`/api/documents/${document.id}/export/docx`);
    const zip = await JSZip.loadAsync(await exported.arrayBuffer());
    const comments = await zip.file("word/comments.xml")!.async("string");
    expect(comments).toContain("Parent");
    expect(comments).toContain("Child");
    expect(await zip.file("word/document.xml")!.async("string")).toContain("commentRangeStart");
  });

  it("refuses other file types, broken Word files and files over 20 MB", async () => {
    expect((await upload("sheet.xlsx", "x")).status).toBe(415);
    const broken = await upload("broken.docx", "not a zip");
    expect(broken.status).toBe(422);
    expect((await broken.json()).error).toMatch(/not a Word document/);
    const large = await upload("large.md", new Uint8Array(MAX_IMPORT_BYTES + 1));
    expect(large.status).toBe(413);
    expect((await large.json()).error).toBe("Files can be at most 20 MB");
  });
});

describe("templates and previews", () => {
  it("creates a document from a template, titled with the template's name", async () => {
    const response = await app.request("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "report", paperSize: "A4" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as DocumentSummary;
    expect(created.title).toBe("Report");

    const preview = await app.request(`/api/documents/${created.id}/preview?v=${created.updatedAt}`);
    expect(preview.headers.get("Cache-Control")).toContain("immutable");
    const { content } = await preview.json();
    expect(content.content[0]).toMatchObject({ type: "paragraph", attrs: { paragraphStyle: "title" } });

    const unknown = await app.request("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "invoice" }),
    });
    expect(unknown.status).toBe(400);
    expect((await app.request("/api/documents/missing/preview")).status).toBe(404);
  });
});

describe("fetching from the web", () => {
  const PNG = Buffer.from(PNG_DATA_URL.split(",")[1]!, "base64");
  const fakeWeb = (pages: Record<string, { contentType: string; body: Buffer | string }>) =>
    createApp({
      db: openDatabase(":memory:"),
      uploadsDir,
      remote: async (url) => {
        const page = pages[url];
        if (!page) return { url, status: 404, contentType: "text/plain", body: Buffer.from("") };
        return { url, status: 200, contentType: page.contentType, body: Buffer.from(page.body) };
      },
    });

  it("GET /api/link-preview answers a page's title", async () => {
    const web = fakeWeb({ "https://example.com/": { contentType: "text/html", body: "<title>Example Domain</title>" } });
    const response = await web.request(`/api/link-preview?url=${encodeURIComponent("https://example.com/")}`);
    expect(await response.json()).toEqual({ title: "Example Domain" });
    expect(await (await web.request(`/api/link-preview?url=${encodeURIComponent("https://example.com/none")}`)).json()).toEqual({ title: null });
    expect((await web.request("/api/link-preview")).status).toBe(400);
  });

  it("GET /api/link-preview refuses addresses on this machine or the local network", async () => {
    for (const url of ["http://127.0.0.1:3001/api/documents", "http://192.168.0.1/", "file:///etc/passwd"]) {
      const response = await app.request(`/api/link-preview?url=${encodeURIComponent(url)}`);
      expect(response.status, url).toBe(400);
    }
  });

  it("POST /api/uploads/remote copies a web image into the uploads", async () => {
    const web = fakeWeb({
      "https://example.com/dot.png": { contentType: "image/png", body: PNG },
      "https://example.com/page.html": { contentType: "text/html", body: "<p>not an image</p>" },
    });
    const post = (url: string) => web.request("/api/uploads/remote", { method: "POST", body: JSON.stringify({ url }), headers: { "Content-Type": "application/json" } });
    const response = await post("https://example.com/dot.png");
    expect(response.status).toBe(201);
    const { url } = await response.json();
    expect(url).toMatch(/^\/uploads\/[\w-]+\.png$/);
    expect(readdirSync(uploadsDir)).toHaveLength(1);
    expect((await post("https://example.com/page.html")).status).toBe(415);
    expect((await post("https://example.com/missing.png")).status).toBe(502);
    const refused = await app.request("/api/uploads/remote", { method: "POST", body: JSON.stringify({ url: "http://10.0.0.1/x.png" }), headers: { "Content-Type": "application/json" } });
    expect(refused.status).toBe(400);
  });

  it("GET /api/documents/:id/steps lists the steps after a version", async () => {
    const created = (await (await app.request("/api/documents", { method: "POST" })).json()) as DocumentSummary;
    const step = { stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Hi" }] } };
    await app.request(`/api/documents/${created.id}/steps`, { method: "POST", body: JSON.stringify({ clientId: "c1", version: 0, steps: [step] }), headers: { "Content-Type": "application/json" } });
    const again = await app.request(`/api/documents/${created.id}/steps`, { method: "POST", body: JSON.stringify({ clientId: "c1", version: 0, steps: [step] }), headers: { "Content-Type": "application/json" } });
    expect(await again.json()).toEqual({ version: 1, alreadyApplied: true });
    const since = await app.request(`/api/documents/${created.id}/steps?since=0`);
    expect(await since.json()).toEqual({ version: 1, steps: [step], clientIds: ["c1"] });
    expect((await app.request(`/api/documents/${created.id}/steps?since=5`)).status).toBe(400);
    expect((await app.request(`/api/documents/missing/steps?since=0`)).status).toBe(404);
  });
});
