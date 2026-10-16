// Equations in the editor (spec 20): the node view that draws an equation and the plugin that
// lets the cursor into it. While the cursor is in an equation, the equation is the selected node
// (a NodeSelection) and the plugin keeps the caret inside it with the equation's model; keys typed
// change the model (equationCode.ts) and every change of its LaTeX is an ordinary step. See
// docs/design/equations.md.
import { DocsEquation } from "@docs/shared";
import type { Caret, MathRow } from "@docs/shared/equations";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import { closeHistory } from "../tabHistory.ts";
import { resetPagination } from "../pagination.ts";
import { equationCode, loadEquationCode, whenEquationCodeLoaded } from "./load.ts";

/** The equation the cursor is in: its position, its model with commands being typed, the caret and its stored LaTeX. */
export type EquationEditing = { pos: number; row: MathRow; caret: Caret; latex: string };

type EquationsState = { editing: EquationEditing | null };
type EquationsMeta = { editing: EquationEditing | null } | { start: "start" | "end" | Caret };

export const equationsKey = new PluginKey<EquationsState>("equations");

/** The equation being edited, or null. */
export function editingEquation(state: EditorState): EquationEditing | null {
  return equationsKey.getState(state)?.editing ?? null;
}

const isEquationNode = (node: Node | null | undefined) => node?.type.name === "equation";

/** Views whose layout must be measured again once equations are drawn as maths. */
const waitingViews = new WeakSet<EditorView>();

class EquationView implements NodeView {
  dom: HTMLElement;
  private editing: EquationEditing | null = null;

  constructor(
    private node: Node,
    private readonly view: EditorView,
  ) {
    this.dom = document.createElement("span");
    this.dom.className = "equation";
    this.render();
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.editing = (decorations.find((decoration) => (decoration.spec as { equation?: EquationEditing }).equation)?.spec as { equation?: EquationEditing } | undefined)?.equation ?? null;
    this.dom.classList.toggle("is-editing", this.editing !== null);
    this.render();
    return true;
  }

  private render(): void {
    const latex = this.node.attrs.latex as string;
    const code = equationCode();
    if (code) {
      code.drawEquation(this.dom, latex, this.editing, () => this.render());
      return;
    }
    // Until the equation code has loaded: the LaTeX, then the maths (and the pages laid out again).
    this.dom.textContent = latex;
    this.dom.dataset.latex = latex;
    if (!waitingViews.has(this.view)) {
      waitingViews.add(this.view);
      whenEquationCodeLoaded(() => {
        waitingViews.delete(this.view);
        if (!this.view.isDestroyed) resetPagination(this.view);
      });
    }
    void loadEquationCode().then(() => this.render());
  }

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/** The equation the selection is on, or null. */
function selectedEquation(state: EditorState): { pos: number; node: Node } | null {
  const { selection } = state;
  return selection instanceof NodeSelection && isEquationNode(selection.node) ? { pos: selection.from, node: selection.node } : null;
}

/** After an edit in Suggesting mode, the edited equation may be a new copy next to the old one: the one with its LaTeX. */
function findEdited(doc: Node, editing: EquationEditing): number | null {
  for (const pos of [editing.pos, editing.pos + 1, editing.pos - 1, editing.pos + 2]) {
    if (pos < 0 || pos >= doc.content.size) continue;
    const node = doc.nodeAt(pos);
    if (isEquationNode(node) && node!.attrs.latex === editing.latex && !node!.marks.some((mark) => mark.type.name === "suggestionDelete")) return pos;
  }
  return null;
}

function equationsPlugin(): Plugin<EquationsState> {
  return new Plugin<EquationsState>({
    key: equationsKey,
    state: {
      init: () => ({ editing: null }),
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(equationsKey) as EquationsMeta | undefined;
        const code = equationCode();
        if (meta && "editing" in meta) {
          if (!meta.editing) return { editing: null };
          const pos = findEdited(newState.doc, meta.editing);
          return { editing: pos === null ? null : { ...meta.editing, pos } };
        }
        const selected = selectedEquation(newState);
        if (!selected || !code) return { editing: null };
        const latex = selected.node.attrs.latex as string;
        if (value.editing) {
          const mapped = tr.mapping.mapResult(value.editing.pos, 1);
          if (!mapped.deleted && mapped.pos === selected.pos) return { editing: code.followLatex(value.editing, latex, selected.pos) };
        }
        // The cursor came into the equation: from the left at its start, from the right at its end.
        const at = meta?.start ?? (oldState.selection.from <= selected.pos ? "start" : "end");
        return { editing: code.startEditing(selected.node, selected.pos, at) };
      },
    },
    appendTransaction(transactions, oldState, newState) {
      const before = equationsKey.getState(oldState)?.editing ?? null;
      const now = equationsKey.getState(newState)?.editing ?? null;
      const code = equationCode();
      // The edited equation keeps the selection (an edit in Suggesting mode may have moved it to a new copy).
      if (now && !(newState.selection instanceof NodeSelection && newState.selection.from === now.pos)) {
        return newState.tr.setSelection(NodeSelection.create(newState.doc, now.pos)).setMeta(equationsKey, { editing: now });
      }
      if (!before || !code) return null;
      let pos = before.pos;
      for (const tr of transactions) {
        const mapped = tr.mapping.mapResult(pos, 1);
        if (mapped.deleted) return null;
        pos = mapped.pos;
      }
      if (now?.pos === pos) return null;
      // The cursor left the equation: commands still being typed become what they name, and an
      // empty equation goes.
      const node = newState.doc.nodeAt(pos);
      if (!isEquationNode(node) || node!.attrs.latex !== before.latex) return null;
      const latex = code.finishedLatex(before.row);
      if (!latex) return newState.tr.delete(pos, pos + 1);
      if (latex !== node!.attrs.latex) return newState.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, latex });
      return null;
    },
    props: {
      decorations(state) {
        const editing = equationsKey.getState(state)?.editing;
        if (!editing) return null;
        return DecorationSet.create(state.doc, [Decoration.node(editing.pos, editing.pos + 1, { class: "is-editing" }, { equation: editing })]);
      },
      handleKeyDown(view, event) {
        const editing = editingEquation(view.state);
        const code = equationCode();
        if (!editing || !code || !view.editable) return false;
        return code.handleKey(view, editing, event);
      },
      handleTextInput(view, _from, _to, text) {
        const editing = editingEquation(view.state);
        const code = equationCode();
        if (!editing || !code) return false;
        code.typeText(view, editing, text);
        return true;
      },
      handlePaste(view, event, slice) {
        const editing = editingEquation(view.state);
        const code = equationCode();
        if (!editing || !code) return false;
        // Pasted into an equation: a copied equation's maths, or text read as LaTeX.
        let latex = "";
        slice.content.descendants((node) => {
          if (isEquationNode(node)) latex += node.attrs.latex as string;
          else if (node.isText) latex += node.text!;
        });
        if (!latex) latex = event.clipboardData?.getData("text/plain") ?? "";
        code.pasteLatex(view, editing, latex);
        return true;
      },
      handleClickOn(view, _pos, node, nodePos, event) {
        if (!isEquationNode(node) || !view.editable) return false;
        const code = equationCode();
        if (!code) {
          void loadEquationCode();
          return false;
        }
        // Into the equation (drawn for editing), then the caret where it was clicked.
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)).setMeta(equationsKey, { start: "end" }));
        const editing = editingEquation(view.state);
        const dom = view.nodeDOM(nodePos);
        if (editing && dom instanceof HTMLElement) {
          const caret = code.caretAtPoint(dom, editing.row, event.clientX, event.clientY);
          view.dispatch(view.state.tr.setMeta(equationsKey, { editing: { ...editing, caret } }));
        }
        return true;
      },
      handleDoubleClickOn(_view, _pos, node) {
        return isEquationNode(node);
      },
    },
  });
}

/** Inserts an empty equation at the cursor and puts the cursor in it (Insert > Symbols > Equation, New equation). */
export async function insertEquation(view: EditorView): Promise<void> {
  await loadEquationCode();
  if (view.isDestroyed || !view.editable) return;
  const type = view.state.schema.nodes.equation!;
  const editing = editingEquation(view.state);
  const tr = view.state.tr;
  // From inside an equation: the new one after it.
  if (editing) tr.setSelection(NodeSelection.create(tr.doc, editing.pos)).insert(editing.pos + 1, type.create({ latex: "" }));
  else {
    closeHistory(tr);
    tr.replaceSelectionWith(type.create({ latex: "" }), true);
  }
  const pos = editing ? editing.pos + 1 : tr.selection.from - 1;
  if (!isEquationNode(tr.doc.nodeAt(pos))) return;
  tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta(equationsKey, { start: "start" });
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** The editor's equation: the shared node with the node view and, unless `editable` is false, the editing plugin. */
export const EditorEquation = DocsEquation.extend<{ editable: boolean }>({
  // Its keys are handled before every key binding while the cursor is in an equation.
  priority: 950,
  addOptions() {
    return { editable: true };
  },
  addNodeView() {
    return ({ node, view }) => new EquationView(node, view);
  },
  addProseMirrorPlugins() {
    return this.options.editable ? [equationsPlugin()] : [];
  },
});

/** A transaction that ends editing the equation (the toolbar's Hide button keeps the cursor). */
export function stopEditing(tr: Transaction): Transaction {
  return tr.setMeta(equationsKey, { editing: null });
}
