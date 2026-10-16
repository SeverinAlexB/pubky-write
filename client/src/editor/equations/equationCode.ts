// The equation code that is loaded with the first equation (see equations.ts): drawing equations
// as MathML, the caret, and the keys typed while the cursor is in an equation.
import { registerEquationRenderer } from "@pubky-write/shared";
import {
  backspace,
  caretPositions,
  deleteForward,
  endOf,
  equationMathML,
  finishCommands,
  HTML_NAMESPACE,
  insertAtoms,
  isStructure,
  MATHML_NAMESPACE,
  moveLeft,
  moveRight,
  moveVertically,
  nextSlot,
  parseLatex,
  pathKey,
  previousSlot,
  startOf,
  toLatex,
  typeChar,
  validCaret,
  type Caret,
  type EditResult,
  type EquationState,
  type MathElement,
  type MathRow,
} from "@pubky-write/shared/equations";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { equationsKey, type EquationEditing } from "./equations.ts";

// Drawing ---------------------------------------------------------------------------------------

type Temml = { renderToString: (latex: string, options?: Record<string, unknown>) => string };
let temml: Temml | null = null;
let temmlLoading: Promise<void> | null = null;
const temmlListeners = new Set<() => void>();

/** LaTeX the model does not cover is drawn by temml (MIT), loaded the first time it is needed. */
function loadTemml(): void {
  temmlLoading ??= import("temml").then((module) => {
    temml = (module.default ?? module) as Temml;
    for (const listener of temmlListeners) listener();
    temmlListeners.clear();
  });
}

function rawElement(latex: string): MathElement | null {
  if (!temml) {
    loadTemml();
    return null;
  }
  return { tag: "html:temml", attrs: { latex }, children: [] };
}

function hasRaw(row: MathRow): boolean {
  return /"raw"/.test(JSON.stringify(row));
}

/** DOM elements of a MathML tree; `html:temml` placeholders become temml's MathML for that LaTeX. */
function toDOM(node: MathElement | string): globalThis.Node {
  if (typeof node === "string") return document.createTextNode(node);
  if (node.tag === "html:temml" && temml) {
    const holder = document.createElement("span");
    try {
      holder.innerHTML = temml.renderToString(node.attrs.latex!, { throwOnError: false });
    } catch {
      return document.createTextNode(node.attrs.latex!);
    }
    const math = holder.querySelector("math");
    const row = document.createElementNS(MATHML_NAMESPACE, "mrow");
    if (math) row.append(...math.childNodes);
    return row;
  }
  const html = node.tag.startsWith("html:");
  const element = html ? document.createElementNS(HTML_NAMESPACE, node.tag.slice(5)) : document.createElementNS(MATHML_NAMESPACE, node.tag);
  for (const [key, value] of Object.entries(node.attrs)) element.setAttribute(key, value);
  for (const child of node.children) element.append(toDOM(child));
  return element;
}

/** The MathML of an equation; while it is edited, with its slots and annotations for the caret. */
export function mathElement(row: MathRow, editing: boolean): Element {
  return toDOM(equationMathML(row, { editing, raw: rawElement })) as Element;
}

/** Static HTML of an equation (copies of headers, the clipboard). */
export function staticEquation(latex: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "equation";
  span.dataset.latex = latex;
  span.append(mathElement(parseLatex(latex), false));
  return span;
}

/**
 * Draws an equation into its node view's element: from its LaTeX, or, while it is edited, from
 * the editor's model with the caret. `redraw` is called once temml has loaded, when it is needed.
 */
export function drawEquation(dom: HTMLElement, latex: string, editing: EquationEditing | null, redraw: () => void): void {
  const row = editing ? editing.row : parseLatex(latex);
  if (!temml && hasRaw(row)) temmlListeners.add(redraw);
  const math = mathElement(row, editing !== null);
  dom.replaceChildren(math);
  dom.dataset.latex = latex;
  dom.classList.toggle("is-empty", row.length === 0);
  if (editing) {
    const caret = dom.appendChild(document.createElement("span"));
    caret.className = "equation-caret";
    caret.setAttribute("aria-hidden", "true");
    placeCaret(dom, caret, editing.caret);
  }
}

/** The box of an atom's element and of a row's, relative to the equation. */
function boxes(dom: HTMLElement, caret: Caret) {
  const rowElement = dom.querySelector(`[data-path="${pathKey(caret.path)}"]`);
  if (!rowElement) return null;
  const atoms = [...rowElement.querySelectorAll("[data-atom]")].filter((element) => element.parentElement?.closest("[data-path]") === rowElement);
  const atom = (index: number) => atoms.find((element) => element.getAttribute("data-atom") === String(index));
  return { rowElement, atom };
}

function placeCaret(dom: HTMLElement, caret: HTMLElement, position: Caret): void {
  const point = caretPoint(dom, position);
  if (!point) return;
  const origin = dom.getBoundingClientRect();
  const zoom = dom.offsetWidth ? origin.width / dom.offsetWidth : 1;
  caret.style.left = `${(point.x - origin.left) / zoom}px`;
  caret.style.top = `${(point.top - origin.top) / zoom}px`;
  caret.style.height = `${Math.max(point.bottom - point.top, 4) / zoom}px`;
}

/** Where the caret is drawn for a position: x and the top and bottom of its row, in the window. */
function caretPoint(dom: HTMLElement, position: Caret): { x: number; top: number; bottom: number } | null {
  const found = boxes(dom, position);
  if (!found) return null;
  const { rowElement, atom } = found;
  // Right of the atom before (scripts are drawn around their base, which is the atom before them),
  // or left of the one after, or in the empty slot.
  const before = atom(position.offset - 1)?.getBoundingClientRect();
  const after = atom(position.offset)?.getBoundingClientRect();
  const slot = (rowElement.querySelector(".eq-slot") ?? rowElement).getBoundingClientRect();
  const x = before ? before.right : after ? after.left : slot.left + slot.width / 2;
  const neighbour = before ?? after ?? slot;
  return { x, top: neighbour.top, bottom: neighbour.bottom };
}

/** The caret position nearest to a point in the window (a click), measured on the equation being edited. */
export function caretAtPoint(dom: HTMLElement, row: MathRow, x: number, y: number): Caret {
  let best: Caret = { path: [], offset: row.length };
  let distance = Infinity;
  for (const caret of caretPositions(row)) {
    const point = caretPoint(dom, caret);
    if (!point) continue;
    const dy = y < point.top ? point.top - y : y > point.bottom ? y - point.bottom : 0;
    const score = Math.abs(point.x - x) + dy * 2;
    if (score < distance) {
      distance = score;
      best = caret;
    }
  }
  return best;
}

// Editing ---------------------------------------------------------------------------------------

/** What is stored: the LaTeX of the model without a command still being typed. */
export function storedLatex(row: MathRow): string {
  return toLatex(withoutPendingCommands(row));
}

function withoutPendingCommands(row: MathRow): MathRow {
  return row.flatMap((atom): MathRow => {
    if (atom.kind === "command") return [];
    if (!isStructure(atom)) return [atom];
    return [JSON.parse(JSON.stringify(atom), (_key, value) => (Array.isArray(value) ? value.filter((part: { kind?: string }) => part?.kind !== "command") : value))];
  });
}

/** Starts editing the equation at `pos`, the caret at its start, its end or a given place. */
export function startEditing(node: Node, pos: number, at: "start" | "end" | Caret): EquationEditing {
  const latex = node.attrs.latex as string;
  const row = parseLatex(latex);
  const state = at === "start" ? startOf(row) : at === "end" ? endOf(row) : { row, caret: validCaret(row, at) };
  return { pos, row: state.row, caret: state.caret, latex };
}

/** The editing state after the equation's LaTeX changed outside the editor (undo, another window). */
export function followLatex(editing: EquationEditing, latex: string, pos: number): EquationEditing {
  if (latex === editing.latex) return editing.pos === pos ? editing : { ...editing, pos };
  const row = parseLatex(latex);
  return { pos, row, caret: validCaret(row, editing.caret), latex };
}

/** The equation once the caret leaves it: commands still being typed become what they name. */
export function finishedLatex(row: MathRow): string {
  return toLatex(finishCommands(row));
}

/** Applies an edit: the new model and caret, and the LaTeX stored in the document when it changed. */
export function applyEdit(view: EditorView, editing: EquationEditing, result: EditResult): void {
  if (result === "before" || result === "after") return leave(view, editing, result);
  const node = view.state.doc.nodeAt(editing.pos);
  if (node?.type.name !== "equation") return;
  const latex = storedLatex(result.row);
  const tr = view.state.tr;
  if (latex !== node.attrs.latex) tr.setNodeMarkup(editing.pos, undefined, { ...node.attrs, latex });
  tr.setSelection(NodeSelection.create(tr.doc, editing.pos));
  tr.setMeta(equationsKey, { editing: { pos: editing.pos, row: result.row, caret: result.caret, latex } satisfies EquationEditing });
  view.dispatch(tr.scrollIntoView());
}

/** The cursor leaves the equation, into the text before or after it. */
export function leave(view: EditorView, editing: EquationEditing, side: "before" | "after"): void {
  const pos = side === "before" ? editing.pos : editing.pos + 1;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView());
}

/** Inserts atoms at the caret (the equation toolbar's symbols and structures). */
export function insertIntoEquation(view: EditorView, editing: EquationEditing, atoms: MathRow): void {
  const state: EquationState = { row: editing.row, caret: editing.caret };
  applyEdit(view, editing, insertAtoms(state, atoms, true));
}

/** LaTeX pasted into an equation, at the caret. */
export function pasteLatex(view: EditorView, editing: EquationEditing, latex: string): void {
  const atoms = parseLatex(latex.trim().replace(/^\$+|\$+$/g, ""));
  applyEdit(view, editing, insertAtoms({ row: editing.row, caret: editing.caret }, atoms, false));
}

/** A key typed while the cursor is in an equation; false for keys the editor handles (shortcuts). */
export function handleKey(view: EditorView, editing: EquationEditing, event: KeyboardEvent): boolean {
  if (event.isComposing || event.metaKey || event.ctrlKey) return false;
  const state: EquationState = { row: editing.row, caret: editing.caret };
  const edit = (result: EditResult) => {
    applyEdit(view, editing, result);
    return true;
  };
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowRight":
      if (event.shiftKey) return false;
      return edit(event.key === "ArrowLeft" ? moveLeft(state) : moveRight(state));
    case "ArrowUp":
    case "ArrowDown": {
      if (event.shiftKey) return false;
      const moved = moveVertically(state, event.key === "ArrowUp" ? "up" : "down");
      if (moved) return edit(moved);
      // Out of the equation, then on to the line above or below.
      leave(view, editing, "after");
      return false;
    }
    case "Tab":
      return edit(event.shiftKey ? previousSlot(state) : nextSlot(state));
    case "Backspace":
      return edit(backspace(state));
    case "Delete":
      return edit(deleteForward(state));
    case "Enter":
    case "Escape":
      return edit("after");
    case "Home":
      return edit(startOf(state.row));
    case "End":
      return edit(endOf(state.row));
  }
  if ([...event.key].length !== 1) return false;
  return edit(typeChar(state, event.key));
}

/** Text typed or pasted as text into an equation (an input method, a paste): each character typed. */
export function typeText(view: EditorView, editing: EquationEditing, text: string): void {
  let state: EquationState = { row: editing.row, caret: editing.caret };
  for (const char of text) if (char !== "\n") state = typeChar(state, char);
  applyEdit(view, editing, state);
}

registerEquationRenderer(staticEquation);
