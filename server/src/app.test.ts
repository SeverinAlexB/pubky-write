import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentSummary, ImportResponse, OpenedDocument } from "@docs/shared";
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
