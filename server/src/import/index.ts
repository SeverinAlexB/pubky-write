// File > Open > Upload: converts a Word or Markdown file into a new document.
import { extname } from "node:path";
import type { DocumentSummary } from "@docs/shared";
import { insertImportedComments } from "../comments.ts";
import { inTransaction, type Database } from "../database.ts";
import { createDocument } from "../documents.ts";
import { ImportError, type ImportOptions, type ImportResult } from "./content.ts";
import { docxToDocument } from "./docx.ts";
import { markdownToDocument } from "./markdown.ts";

export { ImportError } from "./content.ts";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const importers: Record<string, (data: Uint8Array, options: ImportOptions) => Promise<ImportResult>> = {
  ".docx": docxToDocument,
  ".md": (data, options) => markdownToDocument(new TextDecoder().decode(data), options),
  ".markdown": (data, options) => markdownToDocument(new TextDecoder().decode(data), options),
};

export function isImportable(fileName: string): boolean {
  return Object.hasOwn(importers, extname(fileName).toLowerCase());
}

/** The document's title: the file name without its extension. */
export function importedTitle(fileName: string): string {
  return fileName.slice(0, fileName.length - extname(fileName).length);
}

export async function importFile(fileName: string, data: Uint8Array, options: ImportOptions): Promise<ImportResult> {
  const importer = importers[extname(fileName).toLowerCase()];
  if (!importer) throw new ImportError("Only Word (.docx) and Markdown (.md) files can be opened");
  return importer(data, options);
}

/** Creates the document an import made, with the comment threads found in the file. */
export function createImportedDocument(db: Database, fileName: string, result: ImportResult, now = Date.now()): DocumentSummary {
  return inTransaction(db, () => {
    const summary = createDocument(db, importedTitle(fileName), now, result.doc);
    insertImportedComments(db, summary.id, result.doc, result.comments, now);
    return summary;
  });
}
