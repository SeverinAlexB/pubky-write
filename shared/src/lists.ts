// List presets (Format > Bullets and numbering) and checklists.
//
// The preset is an attribute of the outermost list of its kind. Nested lists of the same kind use
// the glyphs or numbers of that list for their level, so the attribute of a nested list is only
// used once it becomes an outermost list itself.
//
// The attribute holds the preset's id. Documents saved before presets had ids hold the preset's
// index in the old menu order instead; `listPresetIndex` reads both.
import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";

export type ListKind = "bullet" | "numbered" | "checklist";
type ListType = "bulletList" | "orderedList" | "taskList";

export const listNodeTypes: Record<ListKind, { list: ListType; item: string }> = {
  bullet: { list: "bulletList", item: "listItem" },
  numbered: { list: "orderedList", item: "listItem" },
  checklist: { list: "taskList", item: "taskItem" },
};

/** Bulleted presets in menu order, with the glyphs of levels 1–3; deeper levels repeat them. */
export const bulletPresets = [
  { id: "disc", label: "Disc, circle, square", glyphs: ["●", "○", "■"] },
  { id: "diamond", label: "Diamond, arrowhead, square", glyphs: ["❖", "➢", "■"] },
  { id: "shadowed-square", label: "Shadowed square", glyphs: ["❏", "❏", "❏"] },
  { id: "arrow", label: "Arrow, diamond, disc", glyphs: ["➔", "◆", "●"] },
  { id: "star", label: "Star, circle, square", glyphs: ["★", "○", "■"] },
  { id: "arrowhead", label: "Arrowhead, circle, square", glyphs: ["➢", "○", "■"] },
] as const;

export type NumberFormat =
  | "decimal"
  | "decimal-leading-zero"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";

export type NumberedPreset = {
  id: string;
  label: string;
  /** The numbering of levels 1–3; deeper levels repeat them. */
  formats: readonly NumberFormat[];
  suffix: string;
  /** Numbers include the parent levels' numbers (1.1.). */
  nested: boolean;
};

/** Numbered presets in menu order. */
export const numberedPresets: readonly NumberedPreset[] = [
  { id: "decimal", label: "1. a. i.", formats: ["decimal", "lower-alpha", "lower-roman"], suffix: ".", nested: false },
  { id: "decimal-parenthesis", label: "1) a) i)", formats: ["decimal", "lower-alpha", "lower-roman"], suffix: ")", nested: false },
  { id: "outline", label: "1. 1.1. 1.1.1.", formats: ["decimal", "decimal", "decimal"], suffix: ".", nested: true },
  { id: "upper-alpha", label: "A. a. i.", formats: ["upper-alpha", "lower-alpha", "lower-roman"], suffix: ".", nested: false },
  { id: "upper-roman", label: "I. A. 1.", formats: ["upper-roman", "upper-alpha", "decimal"], suffix: ".", nested: false },
  {
    id: "zero-padded",
    label: "01. a. i.",
    formats: ["decimal-leading-zero", "lower-alpha", "lower-roman"],
    suffix: ".",
    nested: false,
  },
];

/** Checklist presets: plain, and with checked items struck through. */
export const checklistPresets = [
  { id: "plain", label: "Checklist" },
  { id: "strike-through", label: "Checklist with strike-through" },
] as const;

const presetIds: Record<ListType, readonly string[]> = {
  bulletList: bulletPresets.map((preset) => preset.id),
  orderedList: numberedPresets.map((preset) => preset.id),
  taskList: checklistPresets.map((preset) => preset.id),
};

/**
 * The presets that numbers stored by earlier versions refer to, by their old index. Bullets were
 * ● ○ ■, ❖ ➢ ■, → ◆ ●, ★ ○ ■ and numbering 1. a. i., A. a. i., 1) a) i), 1. 1.1. 1.1.1.
 */
const legacyPresets: Record<ListType, readonly number[]> = {
  bulletList: [0, 1, 3, 4],
  orderedList: [0, 3, 1, 2],
  taskList: [0, 1],
};

/** The menu index of a list's preset attribute: an id, an index in the old order, or the default 0. */
export function listPresetIndex(listType: string, value: unknown): number {
  if (!(listType in presetIds)) return 0;
  const type = listType as ListType;
  if (typeof value === "string") return Math.max(0, presetIds[type].indexOf(value));
  if (typeof value === "number") return legacyPresets[type][value] ?? 0;
  return 0;
}

/** The preset index of the (first) outermost list of `kind` in the selection, or null without such a list. */
export function listPresetAt(state: { doc: Node; selection: Selection }, kind: ListKind): number | null {
  const { list } = listNodeTypes[kind];
  const found = outermostListsInSelection(state, list)[0];
  return found ? listPresetIndex(list, found.node.attrs.listPreset) : null;
}

/** `value` written in a list numbering format, like CSS counter styles do. */
export function formatListNumber(format: NumberFormat, value: number): string {
  switch (format) {
    case "decimal":
      return String(value);
    case "decimal-leading-zero":
      return value >= 0 && value < 10 ? `0${value}` : String(value);
    case "lower-alpha":
      return alphabetic(value);
    case "upper-alpha":
      return alphabetic(value).toUpperCase();
    case "lower-roman":
      return roman(value).toLowerCase();
    case "upper-roman":
      return roman(value);
  }
}

/** The number of an item of a numbered preset; `path` holds the item's number at each level, outermost first. */
export function listNumberLabel(preset: NumberedPreset, path: readonly number[]): string {
  const format = (value: number, level: number) => formatListNumber(preset.formats[level % preset.formats.length]!, value);
  if (preset.nested) return `${path.map(format).join(".")}${preset.suffix}`;
  return `${format(path[path.length - 1]!, path.length - 1)}${preset.suffix}`;
}

/** 1 → a, 26 → z, 27 → aa. */
function alphabetic(value: number): string {
  if (value < 1) return String(value);
  let result = "";
  for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    result = String.fromCharCode(97 + ((rest - 1) % 26)) + result;
  }
  return result;
}

const romanNumerals: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function roman(value: number): string {
  if (value < 1 || value > 3999) return String(value);
  let rest = value;
  let result = "";
  for (const [amount, numeral] of romanNumerals) {
    for (; rest >= amount; rest -= amount) result += numeral;
  }
  return result;
}

/** The outermost list of `typeName` around a position, with its position. */
export function outermostList(
  $pos: ResolvedPos,
  typeName: string,
): { node: Node; pos: number } | null {
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth);
    if (node.type.name === typeName) return { node, pos: $pos.before(depth) };
  }
  return null;
}

/** The outermost lists of `typeName` around or inside the selection (which may be all of the document). */
function outermostListsInSelection(
  { doc, selection }: { doc: Node; selection: Selection },
  typeName: string,
): { node: Node; pos: number }[] {
  const around = outermostList(selection.$from, typeName);
  const found = around ? [around] : [];
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name !== typeName) return true;
    if (!found.some((list) => list.pos === pos) && !outermostList(doc.resolve(pos), typeName)) found.push({ node, pos });
    return false;
  });
  return found;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    listPreset: {
      /** Turns the selection into a list of `kind` if needed and gives its outermost list the preset at `preset` in menu order. */
      applyListPreset: (kind: ListKind, preset: number) => ReturnType;
    };
  }
}

export const ListPreset = Extension.create({
  name: "listPreset",

  addGlobalAttributes() {
    return (Object.keys(presetIds) as ListType[]).map((type) => ({
      types: [type],
      attributes: {
        listPreset: {
          // 0 is the first preset in the old order and the new one, so it stays the default.
          default: 0,
          parseHTML: (element: HTMLElement) => {
            const value = element.getAttribute("data-list-preset");
            if (value === null) return 0;
            const index = /^\d+$/.test(value) ? listPresetIndex(type, Number(value)) : listPresetIndex(type, value);
            return index > 0 ? presetIds[type][index] : 0;
          },
          renderHTML: (attributes: Record<string, unknown>) => {
            const index = listPresetIndex(type, attributes.listPreset);
            return index > 0 ? { "data-list-preset": presetIds[type][index] } : {};
          },
        },
      },
    }));
  },

  addCommands() {
    return {
      applyListPreset:
        (kind, preset) =>
        ({ chain }) => {
          const { list, item } = listNodeTypes[kind];
          const id = Number.isInteger(preset) ? presetIds[list][preset] : undefined;
          if (id === undefined) return false;
          return chain()
            .command(({ state, commands }) =>
              outermostListsInSelection(state, list).length > 0 ? true : commands.toggleList(list, item),
            )
            .command(({ tr }) => {
              const found = outermostListsInSelection(tr, list);
              for (const { node, pos } of found) {
                if (node.attrs.listPreset !== id) tr.setNodeAttribute(pos, "listPreset", id);
              }
              return found.length > 0;
            })
            .run();
        },
    };
  },
});

/** Checklists: ⌘+Shift+9 toggles them; items can hold nested checklists. */
export const checklistExtensions = [TaskList, TaskItem.configure({ nested: true })];
