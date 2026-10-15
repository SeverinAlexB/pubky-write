// Helpers shared by the Markdown and Word importers. Both build document JSON and finish with
// `finishDocument`, which validates it against the editor's schema.
import { documentSchema, isPaperSize } from "@docs/shared";
import type { JSONContent } from "@tiptap/core";
import { Mark, type Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { fixTables } from "@tiptap/pm/tables";

export type MarkJSON = { type: string; attrs?: Record<string, unknown> };

/** Stores an image found in an imported file and returns its URL, or null if its type is not supported. */
export type ImageStore = (data: Uint8Array) => Promise<string | null>;

export type ImportOptions = {
  storeImage: ImageStore;
  /** The paper size of the new document unless the file sets its own (see defaultPaperSize). */
  paperSize?: string;
};

/** A comment thread found in an imported file: its anchor in the document, its messages and whether it is resolved. */
export type ImportedComment = { from: number; to: number; resolved: boolean; messages: { body: string; createdAt: number | null }[] };

export type ImportResult = { doc: Node; dropped: string[]; comments: ImportedComment[] };

export class ImportError extends Error {}

/** A text node, or nothing for empty text. Marks are put in schema order, as the schema requires. */
export function textNode(text: string, marks: readonly MarkJSON[]): JSONContent[] {
  if (!text) return [];
  const set = markSet(marks);
  return [{ type: "text", text, ...(set.length > 0 && { marks: set }) }];
}

/** Text with tab characters, which become tab nodes. */
export function textWithTabs(text: string, marks: readonly MarkJSON[]): JSONContent[] {
  return text.split("\t").flatMap((part, index) => [...(index > 0 ? [leafNode("tab", marks)] : []), ...textNode(part, marks)]);
}

/** An inline leaf node such as a tab, with marks. */
export function leafNode(type: string, marks: readonly MarkJSON[]): JSONContent {
  const set = markSet(marks);
  return { type, ...(set.length > 0 && { marks: set }) };
}

/** Sorts marks, drops duplicates and resolves exclusions (inline code excludes other marks). */
function markSet(marks: readonly MarkJSON[]): MarkJSON[] {
  if (marks.length === 0) return [];
  let set: readonly Mark[] = Mark.none;
  for (const mark of marks) set = documentSchema.mark(mark.type, mark.attrs).addToSet(set);
  return set.map((mark) => mark.toJSON() as MarkJSON);
}

export const emptyParagraph = (): JSONContent => ({ type: "paragraph" });

const listItemTypes = new Set(["listItem", "taskItem"]);
const containerTypes = new Set(["blockquote", "tableCell", "tableHeader", "listItem", "taskItem"]);

/** Fixes what the schema requires: list items start with a paragraph and containers are not empty. */
export function repair(node: JSONContent): JSONContent {
  const content = node.content?.map(repair);
  if (listItemTypes.has(node.type ?? "") && content?.[0]?.type !== "paragraph") {
    return { ...node, content: [emptyParagraph(), ...(content ?? [])] };
  }
  if (containerTypes.has(node.type ?? "") && (!content || content.length === 0)) return { ...node, content: [emptyParagraph()] };
  return content ? { ...node, content } : node;
}

/** Builds the document from top-level blocks and checks it against the schema. */
export function finishDocument(blocks: JSONContent[], options: ImportOptions, pageSetup: Record<string, unknown> = {}): Node {
  const attrs = { ...(isPaperSize(options.paperSize) && { paperSize: options.paperSize }), ...pageSetup };
  const content = blocks.length > 0 ? blocks.map(repair) : [emptyParagraph()];
  let doc: Node;
  try {
    doc = withRectangularTables(documentSchema.nodeFromJSON({ type: "doc", attrs, content }));
    doc.check();
  } catch (error) {
    throw new ImportError(`The file could not be converted: ${(error as Error).message}`);
  }
  return doc;
}

/** Collects the kinds of content an importer left out, for the notice after importing. */
export class DroppedContent {
  private readonly kinds = new Set<string>();

  add(kind: string): void {
    this.kinds.add(kind);
  }

  list(): string[] {
    return [...this.kinds];
  }
}

/**
 * The document with every table a rectangle of cells, as the table commands need: Word allows rows
 * of different lengths and spans that reach past the table. Missing cells are added empty and spans
 * shortened, as the editor itself would on the first change.
 */
export function withRectangularTables(doc: Node): Node {
  let state = EditorState.create({ doc });
  // A fix can leave a problem in a table nested in the one fixed; a few rounds settle it.
  for (let round = 0; round < 5; round++) {
    const tr = fixTables(state);
    if (!tr) break;
    state = state.apply(tr);
  }
  return state.doc;
}
