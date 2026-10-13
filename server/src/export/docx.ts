// Converts a document to a Word file with the `docx` library.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import { imageSize } from "image-size";
import type { Mark, Node } from "@tiptap/pm/model";

export type ImageReader = (src: string) => Promise<Buffer | null>;

type Block = Paragraph | Table;
type ListContext = { kind: "bullet" | "ordered"; level: number; instance: number };

const MAX_IMAGE_WIDTH_PX = 600;
const ORDERED_LIST = "ordered-list";

const alignments = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

export async function toDocx(doc: Node, title: string, readImage: ImageReader): Promise<Buffer> {
  const converter = new DocxConverter(readImage);
  const children = await converter.blocks(doc);
  const file = new Document({
    title,
    numbering: {
      config: [
        {
          reference: ORDERED_LIST,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(file);
}

class DocxConverter {
  private orderedListCount = 0;

  constructor(private readonly readImage: ImageReader) {}

  async blocks(parent: Node, list?: ListContext, quoted = false): Promise<Block[]> {
    const blocks: Block[] = [];
    for (const node of children(parent)) blocks.push(...(await this.block(node, list, quoted)));
    return blocks;
  }

  private async block(node: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const base: IParagraphOptions = {
      alignment: alignments[node.attrs.textAlign as keyof typeof alignments],
      ...(quoted && { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 12 } } }),
      ...listOptions(list),
    };

    switch (node.type.name) {
      case "paragraph":
        return [new Paragraph({ ...base, children: await this.inline(node) })];
      case "heading":
        return [new Paragraph({ ...base, heading: headings[node.attrs.level - 1], children: await this.inline(node) })];
      case "blockquote":
        return this.blocks(node, list, true);
      case "bulletList":
        return this.blocks(node, { kind: "bullet", level: nextLevel(list), instance: 0 }, quoted);
      case "orderedList":
        return this.blocks(node, { kind: "ordered", level: nextLevel(list), instance: ++this.orderedListCount }, quoted);
      case "listItem":
        return this.listItem(node, list, quoted);
      case "codeBlock":
        return [
          new Paragraph({
            ...base,
            shading: { type: ShadingType.CLEAR, fill: "F1F3F4" },
            children: node.textContent
              .split("\n")
              .map((line, index) => new TextRun({ text: line, font: "Courier New", break: index > 0 ? 1 : 0 })),
          }),
        ];
      case "horizontalRule":
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } })];
      case "image":
        return [new Paragraph({ ...base, children: [await this.image(node)] })];
      case "table":
        return [await this.table(node)];
      default:
        return [new Paragraph({ ...base, children: [new TextRun(node.textContent)] })];
    }
  }

  /** Only the first paragraph of an item carries the bullet or number; nested lists need the context for their level. */
  private async listItem(item: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const blocks: Block[] = [];
    for (const [index, child] of children(item).entries()) {
      const isNestedList = child.type.name === "bulletList" || child.type.name === "orderedList";
      blocks.push(...(await this.block(child, index === 0 || isNestedList ? list : undefined, quoted)));
    }
    return blocks;
  }

  private async table(table: Node): Promise<Table> {
    const rows: TableRow[] = [];
    for (const row of children(table)) {
      const cells: TableCell[] = [];
      for (const cell of children(row)) {
        const content = (await this.blocks(cell)).filter((block): block is Paragraph => block instanceof Paragraph);
        cells.push(
          new TableCell({
            children: content.length > 0 ? content : [new Paragraph("")],
            columnSpan: cell.attrs.colspan,
            rowSpan: cell.attrs.rowspan,
            ...(cell.type.name === "tableHeader" && { shading: { type: ShadingType.CLEAR, fill: "F1F3F4" } }),
          }),
        );
      }
      rows.push(new TableRow({ children: cells }));
    }
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }

  private async image(node: Node): Promise<ParagraphChild> {
    const data = await this.readImage(node.attrs.src);
    const size = data ? safeImageSize(data) : null;
    if (!data || !size) return new TextRun({ text: `[Image: ${node.attrs.alt || node.attrs.src}]`, italics: true });

    const scale = Math.min(1, MAX_IMAGE_WIDTH_PX / size.width);
    return new ImageRun({
      type: size.type,
      data,
      transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) },
      altText: node.attrs.alt ? { name: node.attrs.alt, description: node.attrs.alt, title: node.attrs.alt } : undefined,
    });
  }

  private async inline(parent: Node): Promise<ParagraphChild[]> {
    const runs: ParagraphChild[] = [];
    for (const node of children(parent)) {
      if (node.type.name === "hardBreak") {
        runs.push(new TextRun({ text: "", break: 1 }));
      } else if (node.type.name === "image") {
        runs.push(await this.image(node));
      } else if (node.isText) {
        const run = textRun(node.text ?? "", node.marks);
        const link = node.marks.find((mark) => mark.type.name === "link");
        runs.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
      }
    }
    return runs;
  }
}

function textRun(text: string, marks: readonly Mark[]): TextRun {
  const has = (name: string) => marks.some((mark) => mark.type.name === name);
  const attr = (name: string, key: string) => marks.find((mark) => mark.type.name === name)?.attrs[key];
  const color = hexColor(attr("textStyle", "color"));
  const highlight = hexColor(attr("highlight", "color") ?? (has("highlight") ? "#FFFF00" : undefined));
  return new TextRun({
    text,
    bold: has("bold"),
    italics: has("italic"),
    strike: has("strike"),
    underline: has("underline") || has("link") ? {} : undefined,
    font: has("code") ? "Courier New" : undefined,
    color: has("link") ? "1155CC" : color,
    shading: highlight ? { type: ShadingType.CLEAR, fill: highlight } : undefined,
  });
}

function listOptions(list: ListContext | undefined): Partial<IParagraphOptions> {
  if (!list) return {};
  return list.kind === "bullet"
    ? { bullet: { level: list.level } }
    : { numbering: { reference: ORDERED_LIST, level: list.level, instance: list.instance } };
}

function nextLevel(list: ListContext | undefined): number {
  return list ? Math.min(list.level + 1, 8) : 0;
}

function children(node: Node): Node[] {
  const result: Node[] = [];
  node.forEach((child) => result.push(child));
  return result;
}

/** Accepts `#rgb`, `#rrggbb` and `rgb(r, g, b)`; returns `RRGGBB` or undefined. */
export function hexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) return (hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex).toUpperCase();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase();
  return undefined;
}

function safeImageSize(data: Buffer): { width: number; height: number; type: "png" | "jpg" | "gif" | "bmp" } | null {
  try {
    const { width, height, type } = imageSize(data);
    const docxType = type === "jpeg" ? "jpg" : type;
    if (!width || !height || !(docxType === "png" || docxType === "jpg" || docxType === "gif" || docxType === "bmp")) return null;
    return { width, height, type: docxType };
  } catch {
    return null;
  }
}
