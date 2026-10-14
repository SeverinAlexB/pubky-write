// Tab stops and tab characters (docs/spec/15-tab-stops.md).
//
// A paragraph's tab stops are its `tabStops` attribute: a list of { pos, kind } sorted by
// position, where `pos` is in points from the left margin (the ruler's 0, and Word's origin for
// tab stops), or null for none. A tab character is the inline leaf node `tab`; the editor gives it
// its width after layout (client/src/editor/tabLayout.ts) with `tabAdvance`.
import { Extension, Node as TiptapNode } from "@tiptap/core";
import { Fragment, Slice, type Node, type NodeType } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { MAX_INDENT_PT } from "./indents.ts";

export type TabStopKind = "left" | "center" | "right";
export type TabStop = { pos: number; kind: TabStopKind };

export const tabStopKinds: readonly TabStopKind[] = ["left", "center", "right"];
/** Without stops (and after the last one) a tab advances to the next half inch from the left indent. */
export const DEFAULT_TAB_INTERVAL_PT = 36;
/** A paragraph has at most this many tab stops. */
export const MAX_TAB_STOPS = 64;

const tabbedTypes = ["paragraph", "heading"];

function isTabStop(value: unknown): value is TabStop {
  if (typeof value !== "object" || value === null) return false;
  const { pos, kind } = value as Record<string, unknown>;
  return (
    typeof pos === "number" &&
    Number.isFinite(pos) &&
    pos >= 0 &&
    pos <= MAX_INDENT_PT &&
    tabStopKinds.includes(kind as TabStopKind) &&
    Object.keys(value).length === 2
  );
}

/** Throws unless `value` is null or a sorted list of distinct stops, as stored. */
function validateTabStops(value: unknown): void {
  if (value === null) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TAB_STOPS) throw new RangeError("Invalid tab stops");
  value.forEach((stop: unknown, index) => {
    if (!isTabStop(stop)) throw new RangeError(`Invalid tab stop ${JSON.stringify(stop)}`);
    if (index > 0 && stop.pos <= (value[index - 1] as TabStop).pos) throw new RangeError("Tab stops must be sorted and distinct");
  });
}

/** The tab stops of a paragraph or heading, sorted by position. */
export function tabStopsOf(attrs: Record<string, unknown>): TabStop[] {
  const value = attrs.tabStops;
  return Array.isArray(value) ? value.filter(isTabStop) : [];
}

/**
 * The value to store for `stops`: positions rounded to hundredths of a point and kept within the
 * limits, sorted, one stop per position (the later one wins), or null when there are none.
 */
export function storedTabStops(stops: readonly TabStop[]): TabStop[] | null {
  const byPos = new Map<number, TabStop>();
  for (const stop of stops) {
    if (!tabStopKinds.includes(stop.kind) || !Number.isFinite(stop.pos)) continue;
    const pos = Math.round(Math.min(Math.max(stop.pos, 0), MAX_INDENT_PT) * 100) / 100 || 0;
    byPos.delete(pos);
    byPos.set(pos, { pos, kind: stop.kind });
  }
  const result = [...byPos.values()].sort((a, b) => a.pos - b.pos).slice(0, MAX_TAB_STOPS);
  return result.length > 0 ? result : null;
}

/** Whether two stops are the same, allowing for rounding. */
export function sameTabStop(a: TabStop, b: TabStop): boolean {
  return a.kind === b.kind && Math.abs(a.pos - b.pos) < 0.01;
}

const kindLetters: Record<TabStopKind, string> = { left: "l", center: "c", right: "r" };

/** "l170.08 r396.85": the `data-tab-stops` attribute of a paragraph's HTML. */
export function encodeTabStops(stops: readonly TabStop[]): string {
  return stops.map((stop) => `${kindLetters[stop.kind]}${stop.pos}`).join(" ");
}

export function decodeTabStops(value: string | null | undefined): TabStop[] {
  const stops: TabStop[] = [];
  for (const part of (value ?? "").trim().split(/\s+/)) {
    const match = part.match(/^([lcr])(\d+(?:\.\d+)?)$/);
    if (!match) continue;
    const kind = tabStopKinds.find((candidate) => kindLetters[candidate] === match[1])!;
    stops.push({ pos: Number(match[2]), kind });
  }
  return stops;
}

export type TabAdvanceInput = {
  /** Where the tab character starts, in points from the left margin. */
  at: number;
  stops: readonly TabStop[];
  /** The paragraph's left indent, in points from the left margin: default stops count from here. */
  indent: number;
  /** Width of the text after the tab, up to the next tab or the end of the line, in points. */
  following: number;
  /** Where the line ends (the right indent), in points from the left margin. */
  lineEnd: number;
};

/**
 * The width of a tab character, in points, and the stop it advances to (null for a default
 * stop). Left stop: the following text starts at the stop; right stop: it ends there; centre
 * stop: it is centred on it. A tab never reaches past the end of the line, and text that does not
 * fit before a right or centre stop starts where the tab is.
 */
export function tabAdvance({ at, stops, indent, following, lineEnd }: TabAdvanceInput): { width: number; stop: TabStop | null } {
  const stop = stops.find((candidate) => candidate.pos > at + 0.05) ?? null;
  const target = stop?.pos ?? indent + (Math.floor((at - indent) / DEFAULT_TAB_INTERVAL_PT + 1e-6) + 1) * DEFAULT_TAB_INTERVAL_PT;
  let width = target - at;
  if (stop?.kind === "right") width -= following;
  if (stop?.kind === "center") width -= following / 2;
  width = Math.min(Math.max(width, 0), Math.max(lineEnd - at, 0));
  return { width, stop };
}

/** The `tabStops` attribute of paragraphs and headings. */
export const TabStops = Extension.create({
  name: "tabStops",

  addGlobalAttributes() {
    return [
      {
        types: tabbedTypes,
        attributes: {
          tabStops: {
            default: null,
            parseHTML: (element) => storedTabStops(decodeTabStops(element.getAttribute("data-tab-stops"))),
            renderHTML: (attributes) => {
              const stops = tabStopsOf(attributes);
              return stops.length > 0 ? { "data-tab-stops": encodeTabStops(stops) } : {};
            },
            validate: validateTabStops,
          },
        },
      },
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tab: {
      /** Replaces the selection with a tab character. */
      insertTab: () => ReturnType;
    };
  }
}

/**
 * A tab character. Its HTML holds a real tab, so copied text keeps it; the editor sets its width
 * after layout. Find, word count and plain text read it as "\t".
 */
export const Tab = TiptapNode.create({
  name: "tab",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  extendNodeSchema(extension) {
    return extension.name === "tab" ? { leafText: () => "\t" } : {};
  },

  parseHTML() {
    return [{ tag: "span.tab-char" }];
  },

  renderHTML() {
    return ["span", { class: "tab-char" }, "\t"];
  },

  renderText() {
    return "\t";
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        props: {
          // Tab characters typed (or pasted as text) become tab nodes.
          handleTextInput(view, from, to, text) {
            if (!text.includes("\t") || !view.state.doc.resolve(from).parent.type.contentMatch.matchType(type)) return false;
            const marks = view.state.storedMarks ?? view.state.doc.resolve(from).marks();
            view.dispatch(view.state.tr.replaceWith(from, to, withTabNodes(Fragment.from(view.state.schema.text(text, marks)), type)));
            return true;
          },
          // Text pasted at the top level of the slice goes into the block at the cursor (or a code block).
          transformPasted: (slice, view) => {
            const parent = slice.openStart > 0 ? undefined : view.state.selection.$from.parent.type;
            return new Slice(withTabNodes(slice.content, type, parent), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertTab:
        () =>
        ({ tr, dispatch, state }) => {
          const { $from } = state.selection;
          if (!$from.parent.inlineContent || !$from.parent.type.contentMatch.matchType(this.type)) return false;
          if (dispatch) dispatch(tr.replaceSelectionWith(this.type.create(), true).scrollIntoView());
          return true;
        },
    };
  },
});

/** `content` with the tab characters of its text split out into tab nodes, where tabs are allowed. */
export function withTabNodes(content: Fragment, type: NodeType, parentType?: NodeType): Fragment {
  let changed = false;
  const nodes: Node[] = [];
  content.forEach((node) => {
    if (node.isText && node.text!.includes("\t") && (!parentType || parentType.contentMatch.matchType(type))) {
      changed = true;
      node.text!.split("\t").forEach((part, index) => {
        if (index > 0) nodes.push(type.create(null, null, node.marks));
        if (part) nodes.push(node.type.schema.text(part, node.marks));
      });
      return;
    }
    if (!node.isLeaf && !node.isText && node.type.name !== "codeBlock") {
      const inner = withTabNodes(node.content, type, node.type);
      if (inner !== node.content) {
        changed = true;
        nodes.push(node.copy(inner));
        return;
      }
    }
    nodes.push(node);
  });
  return changed ? Fragment.from(nodes) : content;
}
