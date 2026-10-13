// List presets (Format > Bullets and numbering) and checklists.
//
// The preset is an attribute of the outermost list. Nested lists use the glyphs or numbers of
// their outermost list for their level, so the attribute of a nested list is only used once it
// becomes an outermost list itself.
import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { Node, ResolvedPos } from "@tiptap/pm/model";

export type ListKind = "bullet" | "numbered" | "checklist";

export const listNodeTypes: Record<ListKind, { list: string; item: string }> = {
  bullet: { list: "bulletList", item: "listItem" },
  numbered: { list: "orderedList", item: "listItem" },
  checklist: { list: "taskList", item: "taskItem" },
};

/** Glyphs of each bulleted preset for levels 1–3; deeper levels repeat them. */
export const bulletPresets = [
  ["●", "○", "■"],
  ["❖", "➢", "■"],
  ["→", "◆", "●"],
  ["★", "○", "■"],
] as const;

export type NumberFormat = "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman";

/** Numbering of each numbered preset for levels 1–3; `nested` numbers include the parent levels (1.1.). */
export const numberedPresets: { formats: readonly NumberFormat[]; suffix: string; nested: boolean }[] = [
  { formats: ["decimal", "lower-alpha", "lower-roman"], suffix: ".", nested: false },
  { formats: ["upper-alpha", "lower-alpha", "lower-roman"], suffix: ".", nested: false },
  { formats: ["decimal", "lower-alpha", "lower-roman"], suffix: ")", nested: false },
  { formats: ["decimal", "decimal", "decimal"], suffix: ".", nested: true },
];

/** Checklist presets: plain, and with checked items struck through. */
export const checklistPresets = ["plain", "strikeThrough"] as const;

const presetCounts: Record<string, number> = {
  bulletList: bulletPresets.length,
  orderedList: numberedPresets.length,
  taskList: checklistPresets.length,
};

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

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    listPreset: {
      /** Turns the selection into a list of `kind` if needed and gives its outermost list the preset. */
      applyListPreset: (kind: ListKind, preset: number) => ReturnType;
    };
  }
}

export const ListPreset = Extension.create({
  name: "listPreset",

  addGlobalAttributes() {
    return [
      {
        types: Object.keys(presetCounts),
        attributes: {
          listPreset: {
            default: 0,
            parseHTML: (element) => {
              const value = Number(element.getAttribute("data-list-preset"));
              return Number.isInteger(value) && value > 0 ? value : 0;
            },
            renderHTML: (attributes) =>
              attributes.listPreset ? { "data-list-preset": String(attributes.listPreset) } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      applyListPreset:
        (kind, preset) =>
        ({ chain }) => {
          const { list, item } = listNodeTypes[kind];
          if (!Number.isInteger(preset) || preset < 0 || preset >= presetCounts[list]!) return false;
          return chain()
            .command(({ state, commands }) =>
              outermostList(state.selection.$from, list) ? true : commands.toggleList(list, item),
            )
            .command(({ tr }) => {
              const found = outermostList(tr.selection.$from, list);
              if (!found) return false;
              if (found.node.attrs.listPreset !== preset) tr.setNodeAttribute(found.pos, "listPreset", preset);
              return true;
            })
            .run();
        },
    };
  },
});

/** Checklists: ⌘+Shift+9 toggles them; items can hold nested checklists. */
export const checklistExtensions = [TaskList, TaskItem.configure({ nested: true })];
