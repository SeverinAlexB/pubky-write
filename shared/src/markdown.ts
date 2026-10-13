// Converts a document to GitHub-flavoured Markdown. Formatting Markdown cannot express
// (underline, highlight, alignment, colour) uses inline HTML or is dropped.
import { documentSchema } from "./schema.ts";
import { defaultMarkdownSerializer, MarkdownSerializer, type MarkdownSerializerState } from "prosemirror-markdown";
import type { Node } from "@tiptap/pm/model";

const defaults = defaultMarkdownSerializer.nodes;

const serializer: MarkdownSerializer = new MarkdownSerializer(
  {
    paragraph: defaults.paragraph!,
    heading: defaults.heading!,
    blockquote: defaults.blockquote!,
    horizontalRule: defaults.horizontal_rule!,
    // Images are blocks in this schema; the default serializer treats them as inline.
    image(state, node, parent, index) {
      defaults.image!(state, node, parent, index);
      state.closeBlock(node);
    },
    hardBreak: defaults.hard_break!,
    text: defaults.text!,
    listItem: defaults.list_item!,
    bulletList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
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
  },
  {
    bold: defaultMarkdownSerializer.marks.strong!,
    italic: defaultMarkdownSerializer.marks.em!,
    code: defaultMarkdownSerializer.marks.code!,
    link: defaultMarkdownSerializer.marks.link!,
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    underline: { open: "<u>", close: "</u>", mixable: true, expelEnclosingWhitespace: true },
    highlight: { open: "<mark>", close: "</mark>", mixable: true, expelEnclosingWhitespace: true },
    textStyle: { open: "", close: "", mixable: true },
  },
);

export function toMarkdown(doc: Node): string {
  return serializer.serialize(doc, { tightLists: true }) + "\n";
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
