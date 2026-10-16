// Converts a document to GitHub-flavoured Markdown. Formatting Markdown cannot express
// (underline, highlight, superscript, subscript, alignment, colour) uses inline HTML or is dropped.
//
// Title becomes a level 1 heading and Subtitle a plain paragraph, so the Markdown outline
// keeps one top-level heading per title. A page break becomes an HTML comment, which keeps
// it in the file without drawing anything. Footnotes become `[^1]` references with the notes
// at the end, a table of contents a list of links to the headings; headers, footers and page
// number fields are left out. Equations are written as `$LaTeX$` (and a dollar sign in the text
// as `\$`). Suggestions are written as if they were accepted.
import { documentSchema } from "./schema.ts";
import { acceptedDocument } from "./suggestions.ts";
import { headingSlug, tocTarget } from "./tableOfContents.ts";
import { defaultMarkdownSerializer, MarkdownSerializer, type MarkdownSerializerState } from "prosemirror-markdown";
import type { Node } from "@tiptap/pm/model";

const defaults = defaultMarkdownSerializer.nodes;

const serializer: MarkdownSerializer = new MarkdownSerializer(
  {
    paragraph(state, node, parent, index) {
      if (node.attrs.paragraphStyle === "title") state.write("# ");
      defaults.paragraph!(state, node, parent, index);
    },
    heading: defaults.heading!,
    blockquote: defaults.blockquote!,
    horizontalRule: defaults.horizontal_rule!,
    pageBreak(state, node) {
      state.write("<!-- page break -->");
      state.closeBlock(node);
    },
    // Markdown has no columns.
    columnBreak() {},
    // Images are blocks in this schema; the default serializer treats them as inline.
    image(state, node, parent, index) {
      defaults.image!(state, node, parent, index);
      state.closeBlock(node);
    },
    hardBreak: defaults.hard_break!,
    // A tab character, or its character reference at the start of a line, where a tab would make
    // an indented code block.
    tab(state) {
      state.write("");
      // atBlank is not in the published types.
      const atLineStart = (state as unknown as { atBlank: () => boolean }).atBlank();
      state.write(atLineStart ? "&#9;" : "\t");
    },
    text: defaults.text!,
    listItem: defaults.list_item!,
    bulletList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    taskList(state, node) {
      state.renderList(node, "  ", (index) => (node.child(index).attrs.checked ? "- [x] " : "- [ ] "));
    },
    taskItem: defaults.list_item!,
    orderedList(state, node) {
      const start: number = node.attrs.start ?? 1;
      const width = String(start + node.childCount - 1).length;
      state.renderList(node, " ".repeat(width + 2), (index) => `${String(start + index).padStart(width)}. `);
    },
    codeBlock(state, node) {
      const fence = node.textContent.includes("```") ? "````" : "```";
      state.write(`${fence}${node.attrs.language ?? ""}\n`);
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write(fence);
      state.closeBlock(node);
    },
    table(state, node) {
      writeTable(state, node);
    },
    footnote(state, node) {
      const notes = currentNotes();
      notes.push(footnoteMarkdown(node));
      state.write(`[^${notes.length}]`);
    },
    pageField() {},
    equation(state, node) {
      const latex = (node.attrs.latex as string).trim();
      if (latex) state.write(`$${latex}$`);
    },
    // Exports pick their tabs with tabsDocument first; a tab node elsewhere (a copied selection) is its blocks.
    documentTab(state, node) {
      state.renderContent(node);
    },
    tableOfContents(state, node) {
      writeTableOfContents(state, node);
    },
  },
  {
    bold: defaultMarkdownSerializer.marks.strong!,
    italic: defaultMarkdownSerializer.marks.em!,
    code: defaultMarkdownSerializer.marks.code!,
    link: defaultMarkdownSerializer.marks.link!,
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    underline: { open: "<u>", close: "</u>", mixable: true, expelEnclosingWhitespace: true },
    superscript: { open: "<sup>", close: "</sup>", mixable: true, expelEnclosingWhitespace: true },
    subscript: { open: "<sub>", close: "</sub>", mixable: true, expelEnclosingWhitespace: true },
    highlight: { open: "<mark>", close: "</mark>", mixable: true, expelEnclosingWhitespace: true },
    textStyle: { open: "", close: "", mixable: true },
    // Gone once suggestions are accepted (see toMarkdown); kept here so a stray mark cannot fail the export.
    suggestionInsert: { open: "", close: "", mixable: true },
    suggestionDelete: { open: "", close: "", mixable: true },
    suggestionFormat: { open: "", close: "", mixable: true },
  },
  // A dollar sign would start an equation when the file is read again.
  { escapeExtraCharacters: /\$/g },
);

/** Footnote texts of the document being serialized, in reference order. */
let notes: string[] | null = null;
/** The document being serialized, for the headings a table of contents links to. */
let currentDoc: Node | null = null;

function currentNotes(): string[] {
  return (notes ??= []);
}

/** Markdown of the document as if every suggestion were accepted. */
export function toMarkdown(source: Node): string {
  const doc = acceptedDocument(source);
  notes = [];
  currentDoc = doc;
  try {
    let markdown = serializer.serialize(doc, { tightLists: true }) + "\n";
    if (notes.length > 0) markdown += "\n" + notes.map((text, index) => `[^${index + 1}]: ${text}`).join("\n") + "\n";
    return markdown;
  } finally {
    notes = null;
    currentDoc = null;
  }
}

/** A footnote's paragraphs on one line (continuation lines would need indenting). */
function footnoteMarkdown(node: Node): string {
  const content = documentSchema.nodeFromJSON({ type: "doc", content: node.attrs.content });
  return serializer.serialize(content, { tightLists: true }).trim().replace(/\n+/g, " ");
}

/** Each entry as a list item linking to its heading's anchor, nested by level. */
function writeTableOfContents(state: MarkdownSerializerState, toc: Node): void {
  const lines: string[] = [];
  toc.forEach((entry, _offset, index) => {
    const text = state.esc(entry.textContent);
    const target = currentDoc ? tocTarget(currentDoc, toc, index) : null;
    const indent = "  ".repeat(entry.attrs.indent as number);
    lines.push(target ? `${indent}- [${text}](#${headingSlug(target.text)})` : `${indent}- ${text}`);
  });
  state.write(lines.join("\n"));
  state.closeBlock(toc);
}

/** GFM tables need a header row, so the first row is always used as the header. */
function writeTable(state: MarkdownSerializerState, table: Node): void {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cellMarkdown(cell)));
    rows.push(cells);
  });
  const columns = Math.max(...rows.map((cells) => cells.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: columns }, (_, index) => cells[index] ?? "").join(" | ")} |`;

  const [header = [], ...body] = rows;
  const lines = [line(header), line(Array.from({ length: columns }, () => "---")), ...body.map(line)];
  state.write(lines.join("\n"));
  state.closeBlock(table);
}

function cellMarkdown(cell: Node): string {
  const content = documentSchema.topNodeType.create(null, cell.content);
  return serializer
    .serialize(content, { tightLists: true })
    .trim()
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, "<br>");
}
