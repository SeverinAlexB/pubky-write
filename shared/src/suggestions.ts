// Suggestions: proposed edits stored in the document until they are accepted or rejected.
// See docs/design/suggesting.md.
//
// Inserted, deleted and reformatted text carries one of three marks; paragraph format changes and
// suggested paragraph breaks are attributes of paragraphs and headings. Every part of one
// suggestion has the same id.
import { Extension, Mark as TiptapMark, mergeAttributes, type JSONContent } from "@tiptap/core";
import { Fragment, Mark, Slice, type MarkType, type Node, type NodeType, type Schema } from "@tiptap/pm/model";
import { liftListItem, sinkListItem, wrapInList } from "@tiptap/pm/schema-list";
import { EditorState, TextSelection, type Command } from "@tiptap/pm/state";
import { canSplit, Transform } from "@tiptap/pm/transform";
import { regionKeys, type RegionContent, type RegionKey } from "./pageElements.ts";

export type SuggestionMeta = { id: string; author: string; createdAt: number };
export type SuggestionMarkName = "suggestionInsert" | "suggestionDelete" | "suggestionFormat";
export const suggestionMarkNames: readonly SuggestionMarkName[] = ["suggestionInsert", "suggestionDelete", "suggestionFormat"];

/** A mark as JSON, as kept in a format suggestion's `before`. */
export type MarkJSON = { type: string; attrs?: Record<string, unknown> };

/** The list a textblock is in: its kind, preset and (when nested) how many lists it is nested in. */
export type ListInfo = { type: string; preset: unknown; level?: number } | null;
/** A textblock's type, attributes (without the suggestion attributes) and list, before a paragraph format suggestion. */
export type BlockFormat = { type: string; attrs: Record<string, unknown>; list: ListInfo };

export type FormatSuggestion = SuggestionMeta & { before: BlockFormat };
export type BreakSuggestion = SuggestionMeta & { kind: "insert" | "delete" };
/** An image's attributes (without the suggestion ones) before a suggested change of its size, wrapping, rotation, crop… */
export type ImageFormatSuggestion = SuggestionMeta & { before: Record<string, unknown> };

/**
 * Blocks that are inserted or deleted whole as a suggestion: attributes `suggestionInsert` and
 * `suggestionDelete` (`null` or a `SuggestionMeta`). Table rows and cells too, for suggested rows
 * and columns. Footnote references are inline and use the marks like text.
 */
export const suggestedObjectTypes = [
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "pageBreak",
  "columnBreak",
  "horizontalRule",
  "tableOfContents",
] as const;
const objectTypeNames = new Set<string>(suggestedObjectTypes);

/** How a card names an inserted or deleted object ("Add: Image"). */
const objectLabels: Record<string, string> = {
  image: "Image",
  table: "Table",
  tableRow: "Table row",
  tableCell: "Table column",
  tableHeader: "Table column",
  pageBreak: "Page break",
  columnBreak: "Column break",
  horizontalRule: "Horizontal line",
  tableOfContents: "Table of contents",
  footnote: "Footnote",
};

/** Image attributes a "Format: image" suggestion may restore. */
const imageFormatKeys = new Set([
  "src",
  "alt",
  "title",
  "width",
  "height",
  "wrap",
  "wrapMargin",
  "positioning",
  "offsetX",
  "offsetY",
  "rotation",
  "crop",
  "recolor",
  "transparency",
  "brightness",
  "contrast",
]);

export function isSuggestedObject(node: Node): boolean {
  return objectTypeNames.has(node.type.name);
}

/** The pending insertion or deletion of a whole object, if any. */
export function objectSuggestion(node: Node, kind: "insert" | "delete"): SuggestionMeta | null {
  const value = node.attrs[kind === "insert" ? "suggestionInsert" : "suggestionDelete"] as SuggestionMeta | null | undefined;
  return value ?? null;
}

/** The author of every suggestion while there is one user. */
export const SUGGESTION_AUTHOR = "You";

const MAX_ID_LENGTH = 64;
const MAX_AUTHOR_LENGTH = 200;
const textblockTypes = ["paragraph", "heading"];
const listTypes = new Set(["bulletList", "orderedList", "taskList"]);
const listItemTypes = new Set(["listItem", "taskItem"]);

export function newSuggestionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isMeta(value: unknown): value is SuggestionMeta {
  if (!value || typeof value !== "object") return false;
  const { id, author, createdAt } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    typeof author === "string" &&
    author.length <= MAX_AUTHOR_LENGTH &&
    typeof createdAt === "number" &&
    Number.isFinite(createdAt)
  );
}

function isMarkList(value: unknown): value is MarkJSON[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (mark) =>
        mark &&
        typeof mark === "object" &&
        typeof (mark as MarkJSON).type === "string" &&
        !suggestionMarkNames.includes((mark as MarkJSON).type as SuggestionMarkName) &&
        ((mark as MarkJSON).attrs === undefined || typeof (mark as MarkJSON).attrs === "object"),
    )
  );
}

function validateMetaAttribute(name: keyof SuggestionMeta) {
  return (value: unknown) => {
    if (!isMeta({ id: "x", author: "", createdAt: 0, [name]: value })) throw new RangeError(`Invalid suggestion ${name}`);
  };
}

function jsonAttribute(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const metaAttributes = {
  id: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-suggestion-id") ?? "",
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-suggestion-id": attributes.id }),
    validate: validateMetaAttribute("id"),
  },
  author: {
    default: SUGGESTION_AUTHOR,
    parseHTML: (element: HTMLElement) => element.getAttribute("data-suggestion-author") ?? SUGGESTION_AUTHOR,
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-suggestion-author": attributes.author }),
    validate: validateMetaAttribute("author"),
  },
  createdAt: {
    default: 0,
    parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-suggestion-time")) || 0,
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-suggestion-time": attributes.createdAt }),
    validate: validateMetaAttribute("createdAt"),
  },
};

function suggestionMark(name: SuggestionMarkName, className: string, withBefore = false) {
  return TiptapMark.create({
    name,
    // Text typed at the edge of a suggestion in Editing mode is not part of it.
    inclusive: false,
    // Insertions and deletions are separate suggestions with their own ids.
    excludes: name,
    addAttributes() {
      return {
        ...metaAttributes,
        ...(withBefore && {
          before: {
            default: [],
            parseHTML: (element: HTMLElement) => jsonAttribute(element.getAttribute("data-suggestion-before")) ?? [],
            renderHTML: (attributes: Record<string, unknown>) => ({ "data-suggestion-before": JSON.stringify(attributes.before) }),
            validate: (value: unknown) => {
              if (!isMarkList(value)) throw new RangeError("Invalid formatting before a suggestion");
            },
          },
        }),
      };
    },
    parseHTML() {
      return [{ tag: `span.${className}[data-suggestion-id]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes({ class: className }, HTMLAttributes), 0];
    },
  });
}

export const SuggestionInsert = suggestionMark("suggestionInsert", "suggestion-insert");
export const SuggestionDelete = suggestionMark("suggestionDelete", "suggestion-delete");
export const SuggestionFormat = suggestionMark("suggestionFormat", "suggestion-format", true);

function isBlockFormat(value: unknown): value is BlockFormat {
  if (!value || typeof value !== "object") return false;
  const { type, attrs, list } = value as Record<string, unknown>;
  const validList =
    list === null || (typeof list === "object" && list !== null && typeof (list as Record<string, unknown>).type === "string");
  return textblockTypes.includes(type as string) && !!attrs && typeof attrs === "object" && !Array.isArray(attrs) && validList;
}

function validateFormatSuggestion(value: unknown): void {
  if (value === null) return;
  if (!isMeta(value) || !isBlockFormat((value as FormatSuggestion).before)) throw new RangeError("Invalid paragraph format suggestion");
}

function validateBreakSuggestion(value: unknown): void {
  if (value === null) return;
  const kind = (value as Record<string, unknown> | null)?.kind;
  if (!isMeta(value) || (kind !== "insert" && kind !== "delete")) throw new RangeError("Invalid paragraph break suggestion");
}

function validateObjectSuggestion(value: unknown): void {
  if (value !== null && !isMeta(value)) throw new RangeError("Invalid object suggestion");
}

function isImageFormatValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  // A crop.
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((side) => typeof side === "number" && Number.isFinite(side));
}

function validateImageFormat(value: unknown): void {
  if (value === null) return;
  const before = (value as Record<string, unknown> | null)?.before;
  const valid =
    isMeta(value) &&
    !!before &&
    typeof before === "object" &&
    !Array.isArray(before) &&
    Object.entries(before).every(([key, item]) => imageFormatKeys.has(key) && isImageFormatValue(item));
  if (!valid) throw new RangeError("Invalid image format suggestion");
}

const objectAttribute = (name: "insert" | "delete") => ({
  default: null,
  keepOnSplit: false,
  parseHTML: (element: HTMLElement) => jsonAttribute(element.getAttribute(`data-suggestion-${name}`)),
  renderHTML: (attributes: Record<string, unknown>) => {
    const value = attributes[name === "insert" ? "suggestionInsert" : "suggestionDelete"];
    return value ? { [`data-suggestion-${name}`]: JSON.stringify(value) } : {};
  },
  validate: validateObjectSuggestion,
});

/**
 * `suggestionFormat` and `suggestionBreak` of paragraphs and headings, `suggestionInsert` and
 * `suggestionDelete` of whole objects, and `suggestionFormat` of images.
 */
export const SuggestionAttributes = Extension.create({
  name: "suggestionAttributes",
  addGlobalAttributes() {
    return [
      {
        types: [...suggestedObjectTypes],
        attributes: { suggestionInsert: objectAttribute("insert"), suggestionDelete: objectAttribute("delete") },
      },
      {
        types: ["image"],
        attributes: {
          suggestionFormat: {
            default: null,
            parseHTML: (element) => jsonAttribute(element.getAttribute("data-suggestion-image")),
            renderHTML: (attributes) =>
              attributes.suggestionFormat ? { "data-suggestion-image": JSON.stringify(attributes.suggestionFormat) } : {},
            validate: validateImageFormat,
          },
        },
      },
      {
        types: textblockTypes,
        attributes: {
          suggestionFormat: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => jsonAttribute(element.getAttribute("data-suggestion-format")),
            renderHTML: (attributes) =>
              attributes.suggestionFormat ? { "data-suggestion-format": JSON.stringify(attributes.suggestionFormat) } : {},
            validate: validateFormatSuggestion,
          },
          suggestionBreak: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => jsonAttribute(element.getAttribute("data-suggestion-break")),
            renderHTML: (attributes) =>
              attributes.suggestionBreak ? { "data-suggestion-break": JSON.stringify(attributes.suggestionBreak) } : {},
            validate: validateBreakSuggestion,
          },
        },
      },
    ];
  },
});

export const suggestionExtensions = [SuggestionAttributes, SuggestionInsert, SuggestionDelete, SuggestionFormat];

// Reading suggestions --------------------------------------------------------------------------

export function isSuggestionMark(mark: Mark): boolean {
  return suggestionMarkNames.includes(mark.type.name as SuggestionMarkName);
}

export function findSuggestionMark(node: Node, name: SuggestionMarkName): Mark | undefined {
  return node.marks.find((mark) => mark.type.name === name);
}

/** The formatting marks of inline content as JSON: everything but the suggestion marks. */
export function formatMarks(marks: readonly Mark[]): MarkJSON[] {
  return marks.filter((mark) => !isSuggestionMark(mark)).map((mark) => mark.toJSON() as MarkJSON);
}

/** A textblock's format: its type, its attributes without the suggestion ones and the list it is in. */
export function blockFormat(doc: Node, pos: number): BlockFormat | null {
  const node = doc.nodeAt(pos);
  if (!node || !node.isTextblock) return null;
  const { suggestionFormat: _format, suggestionBreak: _break, ...attrs } = node.attrs;
  const $pos = doc.resolve(pos);
  let list: ListInfo = null;
  if ($pos.depth >= 2 && listItemTypes.has($pos.parent.type.name) && $pos.index() === 0) {
    const listNode = $pos.node($pos.depth - 1);
    if (listTypes.has(listNode.type.name)) {
      let level = 0;
      for (let depth = $pos.depth - 2; depth > 0; depth--) if (listTypes.has($pos.node(depth).type.name)) level++;
      list = { type: listNode.type.name, preset: listNode.attrs.listPreset ?? null, ...(level > 0 && { level }) };
    }
  }
  return { type: node.type.name, attrs, list };
}

export function sameJSON(a: unknown, b: unknown): boolean {
  return stableJSON(a) === stableJSON(b);
}

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJSON(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** One suggestion: its parts, in document order. */
export type Suggestion = SuggestionMeta & {
  /** From the start of its first part to the end of its last. */
  from: number;
  to: number;
  /** Inline ranges and textblocks it covers, for highlighting the active suggestion. */
  ranges: { from: number; to: number }[];
  inserted: string;
  deleted: string;
  insertedBreaks: number;
  deletedBreaks: number;
  /** Suggested paragraph breaks, at the end of the paragraph before them. */
  breaks: { pos: number; kind: "insert" | "delete" }[];
  /** Changed text formatting, such as "bold" or "font". */
  formatChanges: string[];
  /** Changed paragraph formatting, such as "alignment". */
  paragraphChanges: string[];
  /** The new list of a list change ("Bulleted list", "None"), or null. */
  listChange: string | null;
  /** Objects it inserts or deletes, as named on the card ("Image", "Table row"), each once. */
  insertedObjects: string[];
  deletedObjects: string[];
  /** Objects it inserts, deletes or reformats, for drawing them (positions in the document). */
  nodes: { pos: number; size: number; kind: "insert" | "delete" | "format" }[];
  /**
   * Set for a suggestion in a header, footer or footnote. `from` and `to` are then where the
   * region is (the start of the document for headers, the end for footers, the reference for a
   * footnote), and the region's own positions are here.
   */
  region: SuggestionRegion | null;
};

export type SuggestionRegion = { key: RegionKey | "footnote"; footnotePos: number | null; from: number; to: number };

const markLabels: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
  superscript: "superscript",
  subscript: "subscript",
  code: "code",
  link: "link",
  highlight: "highlight colour",
};
const textStyleLabels: Record<string, string> = { color: "text colour", fontFamily: "font", fontSize: "font size" };
const formatOrder = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "superscript",
  "subscript",
  "code",
  "link",
  "text colour",
  "highlight colour",
  "font",
  "font size",
];

/** What changed between two sets of formatting marks, as labels in a fixed order. */
export function formatChangeLabels(before: MarkJSON[], after: MarkJSON[]): string[] {
  const labels = new Set<string>();
  const find = (marks: MarkJSON[], type: string) => marks.find((mark) => mark.type === type);
  for (const type of new Set([...before, ...after].map((mark) => mark.type))) {
    const a = find(before, type);
    const b = find(after, type);
    if (type === "textStyle") {
      for (const [key, label] of Object.entries(textStyleLabels)) {
        if ((a?.attrs?.[key] ?? null) !== (b?.attrs?.[key] ?? null)) labels.add(label);
      }
    } else if (!sameJSON(a ?? null, b ?? null)) {
      labels.add(markLabels[type] ?? type);
    }
  }
  return [...labels].sort((x, y) => orderOf(formatOrder, x) - orderOf(formatOrder, y));
}

const paragraphAttributeLabels: Record<string, string> = {
  textAlign: "alignment",
  lineSpacing: "line spacing",
  spaceBefore: "paragraph spacing",
  spaceAfter: "paragraph spacing",
  indent: "indent",
  indentLeft: "indent",
  indentFirstLine: "indent",
  indentRight: "indent",
  tabStops: "tab stops",
  paragraphStyle: "paragraph style",
  level: "paragraph style",
};
const paragraphOrder = ["paragraph style", "alignment", "line spacing", "paragraph spacing", "indent", "tab stops"];

const listNames: Record<string, string> = { bulletList: "Bulleted list", orderedList: "Numbered list", taskList: "Checklist" };

/** What changed between two block formats: paragraph labels and the new list, if the list changed. */
export function blockChangeLabels(before: BlockFormat, after: BlockFormat): { labels: string[]; list: string | null } {
  const labels = new Set<string>();
  if (before.type !== after.type) labels.add("paragraph style");
  for (const key of Object.keys(after.attrs)) {
    // Attributes only one of the types has (a heading's level) are covered by the type change.
    if (!(key in before.attrs) || sameJSON(before.attrs[key] ?? null, after.attrs[key] ?? null)) continue;
    labels.add(paragraphAttributeLabels[key] ?? key);
  }
  const list = sameJSON(before.list, after.list) ? null : after.list ? (listNames[after.list.type] ?? after.list.type) : "None";
  return { labels: [...labels].sort((x, y) => orderOf(paragraphOrder, x) - orderOf(paragraphOrder, y)), list };
}

function orderOf(order: string[], label: string): number {
  const index = order.indexOf(label);
  return index < 0 ? order.length : index;
}

/** Text of an inline node as shown in a card: tabs and line breaks as spaces, other objects left out. */
function inlineText(node: Node): string {
  if (node.isText) return node.text ?? "";
  return node.type.name === "tab" || node.type.name === "hardBreak" ? " " : "";
}

/** Every suggestion in the document, in document order. */
export function collectSuggestions(doc: Node): Suggestion[] {
  const byId = new Map<string, Suggestion & { lastBlock: number }>();
  const entry = (meta: SuggestionMeta) => {
    let found = byId.get(meta.id);
    if (!found) {
      found = {
        id: meta.id,
        author: meta.author,
        createdAt: meta.createdAt,
        from: Infinity,
        to: -Infinity,
        ranges: [],
        inserted: "",
        deleted: "",
        insertedBreaks: 0,
        deletedBreaks: 0,
        breaks: [],
        formatChanges: [],
        paragraphChanges: [],
        listChange: null,
        insertedObjects: [],
        deletedObjects: [],
        nodes: [],
        region: null,
        lastBlock: -1,
      };
      byId.set(meta.id, found);
    }
    return found;
  };
  const cover = (suggestion: Suggestion, from: number, to: number) => {
    suggestion.from = Math.min(suggestion.from, from);
    suggestion.to = Math.max(suggestion.to, to);
    const last = suggestion.ranges[suggestion.ranges.length - 1];
    if (last && last.to === from) last.to = to;
    else suggestion.ranges.push({ from, to });
  };
  const addAll = (list: string[], labels: string[]) => {
    for (const label of labels) if (!list.includes(label)) list.push(label);
  };
  /** Objects are outlined as a whole, so they widen the suggestion without adding inline ranges. */
  const extend = (suggestion: Suggestion, from: number, to: number) => {
    suggestion.from = Math.min(suggestion.from, from);
    suggestion.to = Math.max(suggestion.to, to);
  };
  const footnotes: { pos: number; node: Node }[] = [];
  let block = -1;
  let previousTextblockEnd = -1;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      block = pos;
      const format = node.attrs.suggestionFormat as FormatSuggestion | null;
      if (format) {
        const suggestion = entry(format);
        const after = blockFormat(doc, pos);
        if (after) {
          const { labels, list } = blockChangeLabels(format.before, after);
          addAll(suggestion.paragraphChanges, labels);
          // Turning paragraphs into a list is "Format: bulleted list"; changing a list's kind a "Format bullet" line.
          if (list && format.before.list === null && after.list) addAll(suggestion.paragraphChanges, [list.toLowerCase()]);
          else if (list) suggestion.listChange = list;
        }
        cover(suggestion, pos, pos + node.nodeSize);
      }
      const brk = node.attrs.suggestionBreak as BreakSuggestion | null;
      if (brk) {
        const suggestion = entry(brk);
        if (brk.kind === "insert") {
          suggestion.insertedBreaks += 1;
          if (suggestion.inserted) suggestion.inserted += " ";
        } else {
          suggestion.deletedBreaks += 1;
          if (suggestion.deleted) suggestion.deleted += " ";
        }
        suggestion.lastBlock = pos;
        if (previousTextblockEnd >= 0) suggestion.breaks.push({ pos: previousTextblockEnd, kind: brk.kind });
        cover(suggestion, previousTextblockEnd >= 0 ? previousTextblockEnd : pos, pos + 1);
      }
      previousTextblockEnd = pos + node.nodeSize - 1;
      return true;
    }
    if (!node.isInline) {
      if (objectTypeNames.has(node.type.name)) {
        for (const kind of ["insert", "delete"] as const) {
          const meta = objectSuggestion(node, kind);
          if (!meta || !isMeta(meta)) continue;
          const suggestion = entry(meta);
          addAll(kind === "insert" ? suggestion.insertedObjects : suggestion.deletedObjects, [objectLabels[node.type.name]!]);
          suggestion.nodes.push({ pos, size: node.nodeSize, kind });
          extend(suggestion, pos, pos + node.nodeSize);
        }
        const imageFormat = node.type.name === "image" ? (node.attrs.suggestionFormat as ImageFormatSuggestion | null) : null;
        if (imageFormat && isMeta(imageFormat)) {
          const suggestion = entry(imageFormat);
          addAll(suggestion.formatChanges, ["image"]);
          suggestion.nodes.push({ pos, size: node.nodeSize, kind: "format" });
          extend(suggestion, pos, pos + node.nodeSize);
        }
      }
      return true;
    }
    if (node.type.name === "footnote" && regionHasSuggestions(node.attrs.content)) footnotes.push({ pos, node });
    for (const mark of node.marks) {
      if (!isSuggestionMark(mark) || !isMeta(mark.attrs)) continue;
      const suggestion = entry(mark.attrs as SuggestionMeta);
      const text = inlineText(node);
      const separator = suggestion.lastBlock >= 0 && suggestion.lastBlock !== block ? " " : "";
      const object = objectLabels[node.type.name];
      if (mark.type.name === "suggestionInsert") {
        suggestion.inserted += (suggestion.inserted && separator) + text;
        if (object) addAll(suggestion.insertedObjects, [object]);
      } else if (mark.type.name === "suggestionDelete") {
        suggestion.deleted += (suggestion.deleted && separator) + text;
        if (object) addAll(suggestion.deletedObjects, [object]);
      } else {
        addAll(suggestion.formatChanges, formatChangeLabels((mark.attrs as Record<string, unknown>).before as MarkJSON[], formatMarks(node.marks)));
      }
      suggestion.lastBlock = block;
      cover(suggestion, pos, pos + node.nodeSize);
    }
    return false;
  });
  const suggestions = [...byId.values()].map(({ lastBlock: _lastBlock, ...suggestion }) => {
    suggestion.formatChanges.sort((x, y) => orderOf(formatOrder, x) - orderOf(formatOrder, y));
    return suggestion;
  });
  // Suggestions in headers and footers (shared by all tabs) and in footnote text.
  const inRegion = (content: unknown, key: SuggestionRegion["key"], at: number, footnotePos: number | null) => {
    for (const suggestion of collectSuggestions(regionNode(doc.type.schema, content as RegionContent))) {
      suggestions.push({
        ...suggestion,
        from: at,
        to: at,
        ranges: [],
        breaks: [],
        nodes: [],
        region: { key, footnotePos, from: suggestion.from, to: suggestion.to },
      });
    }
  };
  for (const key of regionKeys) {
    if (regionHasSuggestions(doc.attrs[key])) inRegion(doc.attrs[key], key, key.endsWith("Header") || key === "header" ? 0 : doc.content.size, null);
  }
  for (const { pos, node } of footnotes) inRegion(node.attrs.content, "footnote", pos, pos);
  return suggestions.sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
}

export function hasSuggestions(doc: Node): boolean {
  if (regionKeys.some((key) => regionHasSuggestions(doc.attrs[key]))) return true;
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (hasSuggestionAttributes(node)) found = true;
    else if (node.isInline && (node.marks.some(isSuggestionMark) || (node.type.name === "footnote" && regionHasSuggestions(node.attrs.content)))) found = true;
    return !found && !node.isInline;
  });
  return found;
}

const suggestionAttributeNames = ["suggestionFormat", "suggestionBreak", "suggestionInsert", "suggestionDelete"];

/** Whether a block carries a paragraph, break, object or image suggestion. */
function hasSuggestionAttributes(node: Node): boolean {
  if (node.isInline) return false;
  return suggestionAttributeNames.some((name) => !!node.attrs[name]);
}

// Suggestions in headers, footers and footnotes ----------------------------------------------

const regionSuggestionCache = new WeakMap<object, boolean>();

/** Whether header, footer or footnote content (block JSON) holds suggestions. */
export function regionHasSuggestions(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  let found = regionSuggestionCache.get(content);
  if (found === undefined) {
    found = content.some(jsonHasSuggestions);
    regionSuggestionCache.set(content, found);
  }
  return found;
}

function jsonHasSuggestions(node: JSONContent): boolean {
  if (node.marks?.some((mark) => mark.type.startsWith("suggestion"))) return true;
  if (node.attrs && suggestionAttributeNames.some((name) => !!node.attrs![name])) return true;
  return node.content?.some(jsonHasSuggestions) ?? false;
}

const regionNodes = new WeakMap<object, Node>();

/** Region content as a document node (parsed once per content array). */
export function regionNode(schema: Schema, content: RegionContent): Node {
  let node = regionNodes.get(content);
  if (!node) {
    node = schema.nodeFromJSON({ type: "doc", content });
    regionNodes.set(content, node);
  }
  return node;
}

const MAX_QUOTE_LENGTH = 50;

/** Text quoted in a card: trimmed, and cut at about 50 characters with "…". */
export function quoteText(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const characters = [...trimmed];
  return characters.length > MAX_QUOTE_LENGTH ? `${characters.slice(0, MAX_QUOTE_LENGTH).join("").trimEnd()}…` : trimmed;
}

/** The lines of a suggestion card's description. */
/**
 * The lines of a suggestion card's description. Text is quoted ("Add: “text”"); an object is
 * named instead ("Add: Image"), marked by `insertedObject` / `deletedObject`.
 */
export type SuggestionDescription =
  | { action: "Add"; inserted: string; insertedObject?: boolean }
  | { action: "Delete"; deleted: string; deletedObject?: boolean }
  | { action: "Replace"; deleted: string; inserted: string; insertedObject?: boolean; deletedObject?: boolean }
  | { action: "Format"; changes: string }
  | { action: "Format bullet"; changes: string };

export function describeSuggestion(suggestion: Suggestion): SuggestionDescription[] {
  const lines: SuggestionDescription[] = [];
  // Objects are named rather than quoted: the text in an inserted table is part of "Add: Table".
  const insertedObject = suggestion.insertedObjects.length > 0;
  const deletedObject = suggestion.deletedObjects.length > 0;
  const inserted = insertedObject
    ? suggestion.insertedObjects.join(", ")
    : quoteText(suggestion.inserted) || (suggestion.insertedBreaks > 0 ? "↵" : "");
  // An object put in place of an empty paragraph removes that paragraph's break: still "Add: Table".
  const deleted = deletedObject
    ? suggestion.deletedObjects.join(", ")
    : quoteText(suggestion.deleted) || (suggestion.deletedBreaks > 0 && !insertedObject ? "↵" : "");
  const objects = { ...(insertedObject && { insertedObject }), ...(deletedObject && { deletedObject }) };
  if (inserted && deleted) lines.push({ action: "Replace", deleted, inserted, ...objects });
  else if (inserted) lines.push({ action: "Add", inserted, ...(insertedObject && { insertedObject }) });
  else if (deleted) lines.push({ action: "Delete", deleted, ...(deletedObject && { deletedObject }) });
  const changes = [...suggestion.formatChanges, ...suggestion.paragraphChanges.filter((label) => !suggestion.formatChanges.includes(label))];
  if (changes.length > 0) lines.push({ action: "Format", changes: changes.join(", ") });
  if (suggestion.listChange) lines.push({ action: "Format bullet", changes: suggestion.listChange });
  if (lines.length === 0) lines.push({ action: "Format", changes: "paragraph" });
  return lines;
}

/** One line of a description as plain text, as in "Add: “text”". */
export function descriptionText(line: SuggestionDescription): string {
  const quote = (text: string, object?: boolean) => (object ? text : `“${text}”`);
  switch (line.action) {
    case "Add":
      return `Add: ${quote(line.inserted, line.insertedObject)}`;
    case "Delete":
      return `Delete: ${quote(line.deleted, line.deletedObject)}`;
    case "Replace":
      return `Replace: ${quote(line.deleted, line.deletedObject)} with ${quote(line.inserted, line.insertedObject)}`;
    default:
      return `${line.action}: ${line.changes}`;
  }
}

// Accepting and rejecting ----------------------------------------------------------------------

type InlinePart = { from: number; to: number; node: Node; mark: Mark };

/**
 * Accepts or rejects the suggestions with the given ids (all when `ids` is null), as steps on
 * `tr`. Steps that keep positions come first, then deletions from the end of the document to the
 * start, then list changes being reverted.
 */
export function applySuggestions(tr: Transform, action: "accept" | "reject", ids: ReadonlySet<string> | null = null): Transform {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const selected = (meta: SuggestionMeta | null | undefined) => !!meta && (ids === null || ids.has(meta.id));
  const inserts: InlinePart[] = [];
  const deletes: InlinePart[] = [];
  const formats: InlinePart[] = [];
  const blocks: { pos: number; node: Node; format: FormatSuggestion | null; brk: BreakSuggestion | null }[] = [];
  /** The textblocks in document order, with the end of their content. */
  const textblocks: { pos: number; end: number }[] = [];
  const breaks: { pos: number; brk: BreakSuggestion }[] = [];
  const objects: { pos: number; node: Node; kind: "insert" | "delete" }[] = [];
  const images: { pos: number; node: Node; format: ImageFormatSuggestion }[] = [];
  const footnotes: { pos: number; node: Node }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const format = node.attrs.suggestionFormat as FormatSuggestion | null;
      const brk = node.attrs.suggestionBreak as BreakSuggestion | null;
      if (selected(format) || selected(brk)) {
        blocks.push({ pos, node, format: selected(format) ? format : null, brk: selected(brk) ? brk : null });
      }
      if (selected(brk)) breaks.push({ pos, brk: brk! });
      textblocks.push({ pos, end: pos + node.nodeSize - 1 });
      return true;
    }
    if (!node.isInline) {
      if (objectTypeNames.has(node.type.name)) {
        for (const kind of ["insert", "delete"] as const) if (selected(objectSuggestion(node, kind))) objects.push({ pos, node, kind });
        const imageFormat = node.type.name === "image" ? (node.attrs.suggestionFormat as ImageFormatSuggestion | null) : null;
        if (imageFormat && selected(imageFormat)) images.push({ pos, node, format: imageFormat });
      }
      return true;
    }
    if (node.type.name === "footnote" && regionHasSuggestions(node.attrs.content)) footnotes.push({ pos, node });
    for (const mark of node.marks) {
      if (!selected(mark.attrs as SuggestionMeta) || !isSuggestionMark(mark)) continue;
      const part = { from: pos, to: pos + node.nodeSize, node, mark };
      if (mark.type.name === "suggestionInsert") inserts.push(part);
      else if (mark.type.name === "suggestionDelete") deletes.push(part);
      else formats.push(part);
    }
    return false;
  });

  // Steps that keep every position.
  for (const part of action === "accept" ? inserts : deletes) tr.removeMark(part.from, part.to, part.mark);
  for (const part of formats) {
    if (action === "reject") restoreFormat(tr, schema, part);
    tr.removeMark(part.from, part.to, part.mark);
  }
  const listReverts: { pos: number; list: ListInfo }[] = [];
  const typeRestores: { pos: number; type: NodeType; attrs: Record<string, unknown> }[] = [];
  for (const { pos, node, format, brk } of blocks) {
    if (format) {
      if (action === "reject") {
        const type = schema.nodes[format.before.type];
        const attrs = { ...format.before.attrs, suggestionFormat: null, suggestionBreak: node.attrs.suggestionBreak };
        const $pos = doc.resolve(pos);
        const fits = !!type && type.validContent(node.content);
        if (fits && $pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) tr.setNodeMarkup(pos, type, attrs, node.marks);
        else tr.setNodeAttribute(pos, "suggestionFormat", null);
        // A heading in a list item: its type comes back once it is out of the list.
        if (fits && type !== node.type && !$pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) typeRestores.push({ pos, type, attrs });
        const current = blockFormat(doc, pos);
        if (current && !sameJSON(current.list, format.before.list)) listReverts.push({ pos, list: format.before.list });
      } else {
        tr.setNodeAttribute(pos, "suggestionFormat", null);
      }
    }
    if (brk) tr.setNodeAttribute(pos, "suggestionBreak", null);
  }
  // Objects that stay lose their suggestion; the others are removed below.
  const removedObjects = new Set<number>();
  for (const { pos, node, kind } of objects) {
    if ((action === "accept") === (kind === "insert")) tr.setNodeAttribute(pos, kind === "insert" ? "suggestionInsert" : "suggestionDelete", null);
    else removedObjects.add(pos);
  }
  for (const { pos, node, format } of images) {
    if (removedObjects.has(pos)) continue;
    if (action === "reject") {
      for (const [key, value] of Object.entries(format.before)) {
        if (key in node.attrs && !sameJSON(node.attrs[key] ?? null, value)) tr.setNodeAttribute(pos, key, value);
      }
    }
    tr.setNodeAttribute(pos, "suggestionFormat", null);
  }
  // Headers, footers and footnote text: their content is replaced by the result.
  const resolveRegion = (content: unknown): RegionContent | null => {
    const before = regionNode(schema, content as RegionContent);
    const after = applySuggestions(new Transform(before), action, ids).doc;
    return after.eq(before) ? null : (after.content.toJSON() as RegionContent);
  };
  for (const key of regionKeys) {
    if (!regionHasSuggestions(doc.attrs[key])) continue;
    const content = resolveRegion(doc.attrs[key]);
    if (content) tr.setDocAttribute(key, content);
  }
  for (const { pos, node } of footnotes) {
    const content = resolveRegion(node.attrs.content);
    if (content) tr.setNodeAttribute(pos, "content", content);
  }

  // Deletions, from the end of the document to the start.
  const removals: { from: number; to: number }[] = (action === "accept" ? deletes : inserts).map(({ from, to }) => ({ from, to }));
  const removedRanges = objectRemovals(doc, removedObjects);
  removals.push(...removedRanges);
  const joinKind = action === "accept" ? "delete" : "insert";
  for (const { pos, brk } of breaks) {
    if (brk.kind !== joinKind) continue;
    // The textblock before, leaving out those inside objects that go (the cells of a rejected table).
    const previous = textblocks.findLast(
      (block) => block.end < pos && !removedRanges.some((range) => block.pos >= range.from && block.end <= range.to),
    );
    if (previous && joinable(doc, previous.end, pos + 1, removedObjects)) removals.push({ from: previous.end, to: pos + 1 });
  }
  // Lists are put back first (paragraphs taken out of a list, or put in one), then the content goes:
  // a join across lists then joins what was there before.
  const start = tr.steps.length;
  for (const { pos, list } of listReverts) {
    const mapped = tr.mapping.slice(start).map(pos, 1);
    if (tr.doc.nodeAt(mapped)?.isTextblock) revertList(tr, mapped + 1, list);
  }
  for (const { pos, type, attrs } of typeRestores) {
    const mapped = tr.mapping.slice(start).map(pos, 1);
    const node = tr.doc.nodeAt(mapped);
    if (!node?.isTextblock) continue;
    const $pos = tr.doc.resolve(mapped);
    if ($pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) tr.setNodeMarkup(mapped, type, { ...attrs, suggestionBreak: node.attrs.suggestionBreak }, node.marks);
  }
  const moved = tr.mapping.slice(start);
  const ranges = mergeRanges(removals).map(({ from, to }) => ({ from: moved.map(from, 1), to: moved.map(to, -1) }));
  for (const { from, to } of ranges.reverse()) if (to > from) tr.delete(from, to);
  return tr;
}

/** Replaces the formatting of reformatted text with the formatting it had before. */
function restoreFormat(tr: Transform, schema: Schema, part: InlinePart): void {
  for (const mark of part.node.marks) if (!isSuggestionMark(mark)) tr.removeMark(part.from, part.to, mark);
  for (const json of part.mark.attrs.before as MarkJSON[]) {
    try {
      tr.addMark(part.from, part.to, Mark.fromJSON(schema, json));
    } catch {
      // A mark type that no longer exists.
    }
  }
}

/**
 * The ranges of objects being removed. A table row whose cells all go, or a table whose rows all
 * go, is removed whole (a table cannot be empty).
 */
function objectRemovals(doc: Node, positions: ReadonlySet<number>): { from: number; to: number }[] {
  const removed = new Set(positions);
  for (let changed = removed.size > 0; changed; ) {
    changed = false;
    for (const pos of [...removed]) {
      const $pos = doc.resolve(pos);
      if ($pos.depth === 0) continue;
      const parentPos = $pos.before();
      const role = $pos.parent.type.spec.tableRole as string | undefined;
      if (removed.has(parentPos) || (role !== "row" && role !== "table")) continue;
      let all = true;
      $pos.parent.forEach((_child, offset) => {
        if (!removed.has(parentPos + 1 + offset)) all = false;
      });
      if (all) {
        removed.add(parentPos);
        changed = true;
      }
    }
  }
  return [...removed].map((pos) => ({ from: pos, to: pos + doc.nodeAt(pos)!.nodeSize }));
}

/** Overlapping or touching ranges joined, in document order. */
function mergeRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
  const merged: { from: number; to: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Whether only the closing and opening tokens of textblocks, list items and lists lie between
 * `from` and `to`, apart from objects at the positions in `removed`, which are removed with them.
 */
export function joinable(doc: Node, from: number, to: number, removed: ReadonlySet<number> = new Set()): boolean {
  if (to <= from) return false;
  let ok = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok) return false;
    const end = pos + node.nodeSize;
    if (removed.has(pos) && pos >= from && end <= to) return false;
    // Ancestors around the whole range and the two textblocks at its ends.
    if (pos < from && end > to) return true;
    if (node.isTextblock || listTypes.has(node.type.name) || listItemTypes.has(node.type.name)) {
      if (pos >= from && end <= to) ok = false;
      return !node.isTextblock;
    }
    ok = false;
    return false;
  });
  return ok;
}

/** Puts the textblock with content at `pos` back into the list it was in (or out of any list). */
function revertList(tr: Transform, pos: number, list: ListInfo): void {
  const schema = tr.doc.type.schema;
  const run = (command: Command, at: number) => {
    const state = EditorState.create({ doc: tr.doc, selection: TextSelection.create(tr.doc, at) });
    let applied = false;
    command(state, (result) => {
      for (const step of result.steps) tr.step(step);
      applied = result.steps.length > 0;
    });
    return applied;
  };
  let current = pos;
  for (let depth = 0; depth < 10; depth++) {
    const $pos = tr.doc.resolve(current);
    const item = $pos.depth >= 2 ? $pos.node($pos.depth - 1) : null;
    if (!item || !listItemTypes.has(item.type.name)) break;
    const before = tr.steps.length;
    // A paragraph after the first one of its item (joined into it) becomes an item of its own
    // first, so lifting it does not take the item's first paragraph with it.
    if ($pos.index($pos.depth - 1) > 0 && canSplit(tr.doc, $pos.before())) {
      tr.split($pos.before());
      current = tr.mapping.slice(before).map(current);
      continue;
    }
    if (!run(liftListItem(item.type), current)) break;
    current = tr.mapping.slice(before).map(current);
  }
  if (!list) return;
  const listType = schema.nodes[list.type];
  if (!listType) return;
  const before = tr.steps.length;
  if (!run(wrapInList(listType, { listPreset: list.preset }), current)) return;
  // Join it with lists of the same kind right after and before it, as it was before.
  const mapped = tr.mapping.slice(before).map(current);
  const $pos = tr.doc.resolve(mapped);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type !== listType) continue;
    const list = $pos.node(depth);
    const listPos = $pos.before(depth);
    const next = tr.doc.resolve(listPos + list.nodeSize).nodeAfter;
    if (next && next.type === listType && sameJSON(next.attrs, list.attrs)) tr.join(listPos + list.nodeSize);
    const previous = tr.doc.resolve(listPos).nodeBefore;
    if (previous && previous.type === listType && sameJSON(previous.attrs, list.attrs)) tr.join(listPos);
    break;
  }
  // Nested as deep as it was (each level under the item before it).
  current = tr.mapping.slice(before).map(current);
  for (let level = 0; level < (list.level ?? 0); level++) {
    const $item = tr.doc.resolve(current);
    const item = $item.node($item.depth - 1);
    const steps = tr.steps.length;
    if (!listItemTypes.has(item.type.name) || !run(sinkListItem(item.type), current)) break;
    current = tr.mapping.slice(steps).map(current);
  }
}

/** The document as if every suggestion were accepted. */
export function acceptedDocument(doc: Node): Node {
  if (!hasSuggestions(doc)) return doc;
  return applySuggestions(new Transform(doc), "accept").doc;
}

// Text as if suggestions were accepted -------------------------------------------------------

/** Text suggested for deletion, or an object (a table row…) suggested for deletion. */
function isDeleted(node: Node): boolean {
  if (!node.isInline) return !!node.attrs.suggestionDelete;
  return node.marks.some((mark) => mark.type.name === "suggestionDelete");
}

/** Like `Node.textBetween`, without text suggested for deletion: the text word count and the outline read. */
export function acceptedTextBetween(
  node: Node,
  from: number,
  to: number,
  blockSeparator?: string,
  leafText?: (leaf: Node) => string,
): string {
  let text = "";
  let first = true;
  node.nodesBetween(from, to, (child, pos) => {
    if (isDeleted(child)) return false;
    const childText = child.isText
      ? child.text!.slice(Math.max(from, pos) - pos, to - pos)
      : !child.isLeaf
        ? ""
        : leafText
          ? leafText(child)
          : (child.type.spec.leafText?.(child) ?? "");
    if (child.isBlock && ((child.isLeaf && childText) || child.isTextblock) && blockSeparator) {
      if (first) first = false;
      else text += blockSeparator;
    }
    text += childText;
    return true;
  });
  return text;
}

/**
 * A textblock's text without deleted suggestions, and the offset in the block's content of each of
 * its UTF-16 units (for mapping search matches back to the document). Every inline leaf is one
 * character of `leafText`.
 */
export function acceptedTextOffsets(block: Node, leafText: (leaf: Node) => string): { text: string; offsets: number[] | null } {
  let hasDeleted = false;
  block.forEach((child) => {
    if (isDeleted(child)) hasDeleted = true;
  });
  if (!hasDeleted) return { text: block.textBetween(0, block.content.size, undefined, leafText), offsets: null };
  let text = "";
  const offsets: number[] = [];
  block.forEach((child, offset) => {
    if (isDeleted(child)) return;
    const value = child.isText ? child.text! : leafText(child);
    for (let index = 0; index < value.length; index++) offsets.push(offset + Math.min(index, child.nodeSize - 1));
    text += value;
  });
  return { text, offsets };
}

/** A slice without suggestion marks and attributes, for pasted content. */
export function stripSuggestions(slice: Slice): Slice {
  return new Slice(stripFragment(slice.content), slice.openStart, slice.openEnd);
}

function stripFragment(fragment: Fragment): Fragment {
  const children: Node[] = [];
  fragment.forEach((node) => {
    let next = node;
    if (node.isText) {
      next = node.mark(node.marks.filter((mark) => !isSuggestionMark(mark)));
    } else {
      let attrs = node.attrs;
      for (const name of suggestionAttributeNames) if (attrs[name]) attrs = { ...attrs, [name]: null };
      if (node.type.name === "footnote" && regionHasSuggestions(node.attrs.content)) {
        attrs = { ...attrs, content: (node.attrs.content as JSONContent[]).map(stripJSON) };
      }
      next = node.type.create(attrs, stripFragment(node.content), node.marks.filter((mark) => !isSuggestionMark(mark)));
    }
    children.push(next);
  });
  return Fragment.from(children);
}

function stripJSON(node: JSONContent): JSONContent {
  const result: JSONContent = { ...node };
  if (node.marks) result.marks = node.marks.filter((mark) => !mark.type.startsWith("suggestion"));
  if (node.attrs) {
    result.attrs = { ...node.attrs };
    for (const name of suggestionAttributeNames) if (result.attrs[name]) result.attrs[name] = null;
  }
  if (node.content) result.content = node.content.map(stripJSON);
  return result;
}

/** A suggestion mark of `type` for the given suggestion. */
export function suggestionMarkOf(type: MarkType, meta: SuggestionMeta, extra: Record<string, unknown> = {}): Mark {
  return type.create({ id: meta.id, author: meta.author, createdAt: meta.createdAt, ...extra });
}
