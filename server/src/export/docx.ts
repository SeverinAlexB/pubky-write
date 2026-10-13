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
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type INumberingOptions,
  type IParagraphOptions,
  type IStylesOptions,
  type ParagraphChild,
} from "docx";
import { imageSize } from "image-size";
import type { Mark, Node } from "@tiptap/pm/model";
import {
  bulletPresets,
  DEFAULT_LINE_SPACING,
  numberedPresets,
  paragraphStyleDefinitions,
  type NumberFormat,
  type ParagraphStyleDefinition,
} from "@docs/shared";

export type ImageReader = (src: string) => Promise<Buffer | null>;

type Block = Paragraph | Table;
type ListKind = "bullet" | "ordered" | "task";
/** Nested lists of the same kind use the preset and numbering instance of their outermost list. */
type ListContext = { kind: ListKind; level: number; instance: number; preset: number };

const MAX_IMAGE_WIDTH_PX = 600;
/** Half an inch, matching the editor's indent step. */
const TWIPS_PER_INDENT = 720;
const TWIPS_PER_POINT = 20;
const LIST_LEVELS = 9;
const SUBTITLE_STYLE = "Subtitle";

const alignments = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const headings = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const numberFormats: Record<NumberFormat, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  decimal: LevelFormat.DECIMAL,
  "lower-alpha": LevelFormat.LOWER_LETTER,
  "upper-alpha": LevelFormat.UPPER_LETTER,
  "lower-roman": LevelFormat.LOWER_ROMAN,
};

export async function toDocx(doc: Node, title: string, readImage: ImageReader): Promise<Buffer> {
  const converter = new DocxConverter(readImage);
  const children = await converter.blocks(doc);
  const file = new Document({ title, styles, numbering, sections: [{ children }] });
  return Packer.toBuffer(file);
}

/** Word's paragraph style for one of the editor's styles. */
function wordStyle(style: ParagraphStyleDefinition, id: string, name: string) {
  return {
    id,
    name,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
    run: {
      font: "Arial",
      size: style.fontSize * 2,
      color: style.color.slice(1).toUpperCase(),
      italics: style.italic,
      bold: false,
    },
    paragraph: {
      spacing: { before: style.spaceBefore * TWIPS_PER_POINT, after: style.spaceAfter * TWIPS_PER_POINT },
      keepNext: true,
    },
  };
}

const styles: IStylesOptions = {
  default: {
    document: {
      run: { font: "Arial", size: paragraphStyleDefinitions.normal.fontSize * 2 },
      paragraph: { spacing: { line: Math.round(240 * DEFAULT_LINE_SPACING), before: 0, after: 0 } },
    },
    title: wordStyle(paragraphStyleDefinitions.title, "Title", "Title"),
    heading1: wordStyle(paragraphStyleDefinitions.h1, "Heading1", "Heading 1"),
    heading2: wordStyle(paragraphStyleDefinitions.h2, "Heading2", "Heading 2"),
    heading3: wordStyle(paragraphStyleDefinitions.h3, "Heading3", "Heading 3"),
    heading4: wordStyle(paragraphStyleDefinitions.h4, "Heading4", "Heading 4"),
    heading5: wordStyle(paragraphStyleDefinitions.h5, "Heading5", "Heading 5"),
    heading6: wordStyle(paragraphStyleDefinitions.h6, "Heading6", "Heading 6"),
  },
  paragraphStyles: [wordStyle(paragraphStyleDefinitions.subtitle, SUBTITLE_STYLE, "Subtitle")],
};

/** Hanging indent of list level `level`: text at 0.5 in per level, the glyph 0.25 in before it. */
const listIndent = (level: number) => ({ paragraph: { indent: { left: TWIPS_PER_INDENT * (level + 1), hanging: 360 } } });

const bulletReference = (preset: number) => `bullet-${preset}`;
const orderedReference = (preset: number) => `ordered-${preset}`;

/** One Word numbering definition per bulleted and numbered preset. */
const numbering: INumberingOptions = {
  config: [
    ...bulletPresets.map((glyphs, preset) => ({
      reference: bulletReference(preset),
      levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
        level,
        format: LevelFormat.BULLET,
        text: glyphs[level % glyphs.length]!,
        alignment: AlignmentType.START,
        style: listIndent(level),
      })),
    })),
    ...numberedPresets.map(({ formats, suffix, nested }, preset) => ({
      reference: orderedReference(preset),
      levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
        level,
        format: numberFormats[formats[level % formats.length]!],
        text: nested
          ? `${Array.from({ length: level + 1 }, (_, parent) => `%${parent + 1}`).join(".")}${suffix}`
          : `%${level + 1}${suffix}`,
        alignment: AlignmentType.START,
        style: listIndent(level),
      })),
    })),
  ],
};

class DocxConverter {
  private listCount = 0;

  constructor(private readonly readImage: ImageReader) {}

  async blocks(parent: Node, list?: ListContext, quoted = false): Promise<Block[]> {
    const blocks: Block[] = [];
    for (const node of children(parent)) blocks.push(...(await this.block(node, list, quoted)));
    return blocks;
  }

  private async block(node: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const base: IParagraphOptions = {
      alignment: alignments[node.attrs.textAlign as keyof typeof alignments],
      ...(spacing(node) && { spacing: spacing(node) }),
      ...(node.attrs.indent && { indent: { left: TWIPS_PER_INDENT * node.attrs.indent } }),
      ...(quoted && { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 12 } } }),
      ...listOptions(list),
    };

    switch (node.type.name) {
      case "paragraph":
        return [
          new Paragraph({
            ...base,
            ...(node.attrs.paragraphStyle === "title" && { heading: HeadingLevel.TITLE }),
            ...(node.attrs.paragraphStyle === "subtitle" && { style: SUBTITLE_STYLE }),
            children: await this.inline(node),
          }),
        ];
      case "heading":
        return [new Paragraph({ ...base, heading: headings[node.attrs.level - 1], children: await this.inline(node) })];
      case "blockquote":
        return this.blocks(node, list, true);
      case "bulletList":
        return this.blocks(node, this.nestedList(node, "bullet", list), quoted);
      case "orderedList":
        return this.blocks(node, this.nestedList(node, "ordered", list), quoted);
      case "taskList":
        return this.blocks(node, this.nestedList(node, "task", list), quoted);
      case "listItem":
        return this.listItem(node, list, quoted);
      case "taskItem":
        return this.taskItem(node, list, quoted);
      case "pageBreak":
        return [new Paragraph({ children: [new PageBreak()] })];
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

  private nestedList(node: Node, kind: ListKind, parent: ListContext | undefined): ListContext {
    const level = parent ? Math.min(parent.level + 1, LIST_LEVELS - 1) : 0;
    if (parent?.kind === kind) return { ...parent, level };
    return { kind, level, instance: ++this.listCount, preset: node.attrs.listPreset ?? 0 };
  }

  /** Only the first paragraph of an item carries the bullet or number; nested lists need the context for their level. */
  private async listItem(item: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const blocks: Block[] = [];
    for (const [index, child] of children(item).entries()) {
      const isNestedList = ["bulletList", "orderedList", "taskList"].includes(child.type.name);
      blocks.push(...(await this.block(child, index === 0 || isNestedList ? list : undefined, quoted)));
    }
    return blocks;
  }

  /** Word has no checkboxes in plain paragraphs, so checklist items start with ☐ or ☑. */
  private async taskItem(item: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const checked = item.attrs.checked === true;
    const strike = checked && list?.preset === 1;
    const indent = { left: TWIPS_PER_INDENT * ((list?.level ?? 0) + 1), hanging: 360 };
    const blocks: Block[] = [];
    for (const [index, child] of children(item).entries()) {
      if (index === 0 && child.type.name === "paragraph") {
        const runs = await this.inline(child, strike);
        blocks.push(
          new Paragraph({
            alignment: alignments[child.attrs.textAlign as keyof typeof alignments],
            indent,
            children: [new TextRun({ text: `${checked ? "☑" : "☐"} `, strike: strike || undefined }), ...runs],
          }),
        );
      } else {
        blocks.push(...(await this.block(child, child.type.name === "taskList" ? list : undefined, quoted)));
      }
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

  private async inline(parent: Node, strike = false): Promise<ParagraphChild[]> {
    const runs: ParagraphChild[] = [];
    for (const node of children(parent)) {
      if (node.type.name === "hardBreak") {
        runs.push(new TextRun({ text: "", break: 1 }));
      } else if (node.type.name === "image") {
        runs.push(await this.image(node));
      } else if (node.isText) {
        const run = textRun(node.text ?? "", node.marks, strike);
        const link = node.marks.find((mark) => mark.type.name === "link");
        runs.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
      }
    }
    return runs;
  }
}

function textRun(text: string, marks: readonly Mark[], strike = false): TextRun {
  const has = (name: string) => marks.some((mark) => mark.type.name === name);
  const attr = (name: string, key: string) => marks.find((mark) => mark.type.name === name)?.attrs[key];
  const color = hexColor(attr("textStyle", "color"));
  const fontFamily = attr("textStyle", "fontFamily") as string | undefined;
  const fontSize = halfPoints(attr("textStyle", "fontSize"));
  const highlight = hexColor(attr("highlight", "color") ?? (has("highlight") ? "#FFFF00" : undefined));
  return new TextRun({
    text,
    // Unset rather than false, so the paragraph style (such as Heading 6's italics) applies.
    bold: has("bold") || undefined,
    italics: has("italic") || undefined,
    strike: strike || has("strike") || undefined,
    superScript: has("superscript") || undefined,
    subScript: has("subscript") || undefined,
    underline: has("underline") || has("link") ? {} : undefined,
    font: has("code") ? "Courier New" : fontFamily?.split(",")[0]?.replace(/["']/g, "").trim(),
    size: fontSize,
    color: has("link") ? "1155CC" : color,
    shading: highlight ? { type: ShadingType.CLEAR, fill: highlight } : undefined,
  });
}

function listOptions(list: ListContext | undefined): Partial<IParagraphOptions> {
  if (!list || list.kind === "task") return {};
  const reference = list.kind === "bullet" ? bulletReference(list.preset) : orderedReference(list.preset);
  return { numbering: { reference, level: list.level, instance: list.instance } };
}

/** Line spacing and the block's own space before and after; the rest comes from its Word style. */
function spacing(node: Node): IParagraphOptions["spacing"] | undefined {
  const { lineSpacing, spaceBefore, spaceAfter } = node.attrs;
  const result = {
    ...(lineSpacing && { line: Math.round(240 * lineSpacing) }),
    ...(typeof spaceBefore === "number" && { before: Math.round(spaceBefore * TWIPS_PER_POINT) }),
    ...(typeof spaceAfter === "number" && { after: Math.round(spaceAfter * TWIPS_PER_POINT) }),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function children(node: Node): Node[] {
  const result: Node[] = [];
  node.forEach((child) => result.push(child));
  return result;
}

/** Converts "11pt" or "16px" to Word's half-point font size. */
export function halfPoints(value: unknown): number | undefined {
  const match = typeof value === "string" ? value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/) : null;
  if (!match) return undefined;
  const points = match[2] === "px" ? Number(match[1]) * 0.75 : Number(match[1]);
  return Math.round(points * 2);
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
