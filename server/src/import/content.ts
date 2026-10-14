// Helpers shared by the Markdown and Word importers. Both build document JSON and finish with
// `finishDocument`, which validates it against the editor's schema.
import { documentSchema, isPaperSize } from "@docs/shared";
import type { JSONContent } from "@tiptap/core";
import { Mark, type Node } from "@tiptap/pm/model";

export type MarkJSON = { type: string; attrs?: Record<string, unknown> };

/** Stores an image found in an imported file and returns its URL, or null if its type is not supported. */
export type ImageStore = (data: Uint8Array) => Promise<string | null>;

export type ImportOptions = {
  storeImage: ImageStore;
  /** The paper size of the new document unless the file sets its own (see defaultPaperSize). */
  paperSize?: string;
};

export type ImportResult = { doc: Node; dropped: string[] };

export class ImportError extends Error {}

/** A text node, or nothing for empty text. Marks are put in schema order, as the schema requires. */
export function textNode(text: string, marks: readonly MarkJSON[]): JSONContent[] {
  if (!text) return [];
  const set = markSet(marks);
  return [{ type: "text", text, ...(set.length > 0 && { marks: set }) }];
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
    doc = documentSchema.nodeFromJSON({ type: "doc", attrs, content });
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
