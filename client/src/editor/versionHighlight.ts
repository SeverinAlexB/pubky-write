// Highlight changes in the version history preview: text added in the shown version is marked,
// text it removed is shown struck through where it was. Every element of edit `i` carries
// `data-edit="i"`, so Previous edit and Next edit can find it.
import type { VersionEdit } from "@pubky-write/shared";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const versionHighlightKey = new PluginKey<DecorationSet>("versionHighlight");

export const VersionHighlight = Extension.create<{ edits: VersionEdit[] }>({
  name: "versionHighlight",
  addOptions: () => ({ edits: [] }),
  addProseMirrorPlugins() {
    const { edits } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: versionHighlightKey,
        state: {
          init: (_config, state) => editDecorations(state.doc, edits),
          // The preview is read-only; only page spacers change, and they are decorations too.
          apply: (tr, set) => set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => versionHighlightKey.getState(state) },
      }),
    ];
  },
});

function editDecorations(doc: Node, edits: VersionEdit[]): DecorationSet {
  return DecorationSet.create(
    doc,
    edits.flatMap((edit, index) => {
      const decorations: Decoration[] = [];
      if (edit.deleted.trim()) {
        decorations.push(
          Decoration.widget(edit.from, () => removedText(edit.deleted, index), {
            side: -1,
            ignoreSelection: true,
            key: `removed:${index}`,
          }),
        );
      }
      if (edit.to > edit.from) {
        decorations.push(Decoration.inline(edit.from, edit.to, { class: "version-added", "data-edit": String(index) }));
      }
      return decorations;
    }),
  );
}

function removedText(text: string, index: number): HTMLElement {
  const element = document.createElement("span");
  element.className = "version-removed";
  element.dataset.edit = String(index);
  element.textContent = text;
  return element;
}
