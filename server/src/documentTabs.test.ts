// Document tabs on the server: documents stored before tabs, the steps that give them tab nodes,
// and exports and thumbnails per tab (docs/design/document-tabs.md).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentSchema, documentTabs, FIRST_TAB_ID, wrapInTab, type DocumentPreview } from "@pubky-write/shared";
import { Fragment } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createComment, listComments } from "./comments.ts";
import { openDatabase, type Database } from "./database.ts";
import { applySteps, createDocument, getDocumentContent, restoreRevision } from "./documents.ts";
import { listRevisions } from "./revisions.ts";

let db: Database;
let app: ReturnType<typeof createApp>;
let documentId: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  app = createApp({ db, uploadsDir: mkdtempSync(join(tmpdir(), "docs-uploads-")) });
  documentId = createDocument(db, "Tabs", 0).id;
  edit((tr) => tr.insert(1, documentSchema.text("First tab text")), 1_000);
});

function edit(build: (tr: Transform) => Transform, now = 2_000): void {
  const { doc, version } = getDocumentContent(db, documentId)!;
  const steps = build(new Transform(doc)).steps.map((step) => step.toJSON());
  const result = applySteps(db, documentId, { clientId: "test", version, steps }, now);
  expect(result?.kind).toBe("applied");
}

/** Wraps the stored document in Tab 1 and adds tab "Second" (as the editor's Add tab does). */
function addSecondTab(text: string, now = 2_000): void {
  edit((tr) => {
    wrapInTab(tr);
    const tab = documentSchema.nodes.documentTab!.create(
      { id: "t.second", name: "Second", order: 1 },
      documentSchema.nodes.paragraph!.create(null, documentSchema.text(text)),
    );
    return tr.insert(tr.doc.content.size, Fragment.from(tab));
  }, now);
}

describe("documents stored before tabs", () => {
  it("are one tab until a tab command adds the tab nodes, which is an ordinary step", () => {
    expect(documentTabs(getDocumentContent(db, documentId)!.doc)).toHaveLength(1);
    addSecondTab("Second tab text");
    const { doc } = getDocumentContent(db, documentId)!;
    expect(documentTabs(doc).map((tab) => [tab.id, tab.node.textContent])).toEqual([
      [FIRST_TAB_ID, "First tab text"],
      ["t.second", "Second tab text"],
    ]);
  });

  it("keep their comments on the same text when they get tab nodes", () => {
    const current = getDocumentContent(db, documentId)!;
    createComment(db, documentId, current, { version: current.version, from: 1, to: 6, body: "On First" });
    expect(current.doc.textBetween(1, 6)).toBe("First");
    addSecondTab("x");
    const [thread] = listComments(db, documentId);
    expect(getDocumentContent(db, documentId)!.doc.textBetween(thread!.from, thread!.to)).toBe("First");
  });

  it("restore their old versions into the first tab, keeping the other tabs' content out of it", () => {
    const [first] = listRevisions(db, documentId);
    // A later session: its own version.
    addSecondTab("Second tab text", 1_000_000);
    edit((tr) => tr.insert(2, documentSchema.text("Changed ")), 1_000_000);
    expect(restoreRevision(db, documentId, first!.id, 2_000_000)).not.toBeNull();
    const tabs = documentTabs(getDocumentContent(db, documentId)!.doc);
    expect(tabs.map((tab) => tab.node.textContent)).toEqual(["First tab text"]);
    expect(tabs[0]!.id).toBe(FIRST_TAB_ID);
  });
});

describe("exports and thumbnails", () => {
  beforeEach(() => addSecondTab("Second tab text"));

  const exported = async (query: string) => (await app.request(`/api/documents/${documentId}/export/md${query}`)).text();

  it("export one tab, all tabs under their names, or without a tab the first", async () => {
    expect(await exported("?tab=t.second")).toBe("Second tab text\n");
    expect(await exported("")).toBe("First tab text\n");
    expect(await exported("?tab=all")).toBe("# Tab 1\n\nFirst tab text\n\n<!-- page break -->\n\n# Second\n\nSecond tab text\n");
    const docx = await app.request(`/api/documents/${documentId}/export/docx?tab=all`);
    expect(docx.status).toBe(200);
  });

  it("show the first tab in the document list", async () => {
    const preview = (await (await app.request(`/api/documents/${documentId}/preview`)).json()) as DocumentPreview;
    expect(JSON.stringify(preview.content)).toContain("First tab text");
    expect(JSON.stringify(preview.content)).not.toContain("Second tab text");
  });

  it("search finds text in every tab", async () => {
    const list = (await (await app.request("/api/documents?q=Second%20tab")).json()) as { id: string }[];
    expect(list.map((entry) => entry.id)).toEqual([documentId]);
  });
});
