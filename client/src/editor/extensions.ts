import { documentExtensions } from "@docs/shared";
import { Extension, type AnyExtension } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { collab } from "prosemirror-collab";

type EditorExtensionOptions = {
  /** Server version of the loaded document. */
  version: number;
  clientId: string;
  onLinkShortcut: () => void;
};

/** The shared document schema plus the editor-only behaviour: undo, step tracking and shortcuts. */
export function editorExtensions({ version, clientId, onLinkShortcut }: EditorExtensionOptions): AnyExtension[] {
  return [
    ...documentExtensions,
    UndoRedo,
    Extension.create({
      name: "collab",
      addProseMirrorPlugins: () => [collab({ version, clientID: clientId })],
    }),
    Extension.create({
      name: "documentShortcuts",
      addKeyboardShortcuts() {
        return {
          "Mod-k": () => {
            onLinkShortcut();
            return true;
          },
          "Mod-\\": () => this.editor.chain().unsetAllMarks().setTextAlign("left").run(),
        };
      },
    }),
  ];
}
