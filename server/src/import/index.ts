// File > Open > Upload: converts a Word or Markdown file into a new document.
import { extname } from "node:path";
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
