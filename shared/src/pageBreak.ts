// Insert > Break > Page break (⌘+Enter). On screen it is a dashed line; when printing,
// the content after it starts on a new page.
import { Node } from "@tiptap/core";
import { NodeSelection, Selection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  // Before the hard break extension, which also uses ⌘+Enter.
  priority: 110,

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  renderHTML() {
    return ["div", { "data-type": "page-break", class: "page-break", role: "separator", "aria-label": "Page break" }];
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            // Continue typing after the break rather than with the break selected.
            .command(({ tr }) => {
              if (!(tr.selection instanceof NodeSelection) && tr.selection.$from.parent.isTextblock) return true;
              const after = tr.selection.to;
              const $after = tr.doc.resolve(after);
              if (!$after.nodeAfter?.isTextblock) tr.insert(after, tr.doc.type.schema.nodes.paragraph!.create());
              tr.setSelection(Selection.near(tr.doc.resolve(after + 1)));
              return true;
            })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertPageBreak() };
  },
});
