// Tracks comment anchors in the editor: highlights them, moves them with every edit
// (using the same rule as the server) and reports clicks on commented text.
import { isCollapsed, mapAnchor, type Anchor } from "@docs/shared";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type CommentAnchor = Anchor & { id: number; resolved: boolean };

export type CommentAnchorState = {
  anchors: CommentAnchor[];
  activeId: number | null;
  /** The selection being commented on while a new comment is written. */
  draft: Anchor | null;
};

type CommentAnchorMeta =
  | { type: "upsert"; anchor: CommentAnchor }
  | { type: "remove"; id: number }
  | { type: "activate"; id: number | null }
  | { type: "draft"; anchor: Anchor | null };

export const commentAnchorsKey = new PluginKey<CommentAnchorState>("commentAnchors");

export function getCommentAnchors(state: EditorState): CommentAnchorState {
  return commentAnchorsKey.getState(state) ?? { anchors: [], activeId: null, draft: null };
}

export function updateCommentAnchors(tr: Transaction, meta: CommentAnchorMeta): Transaction {
  return tr.setMeta(commentAnchorsKey, meta);
}

/** The comment whose highlighted text contains `pos`; the innermost one if they overlap. */
export function commentAt(state: CommentAnchorState, pos: number): number | null {
  const hits = state.anchors.filter((anchor) => !anchor.resolved && anchor.from < pos && pos < anchor.to);
  hits.sort((a, b) => a.to - a.from - (b.to - b.from));
  return hits[0]?.id ?? null;
}

function applyMeta(state: CommentAnchorState, meta: CommentAnchorMeta): CommentAnchorState {
  switch (meta.type) {
    case "upsert": {
      const others = state.anchors.filter((anchor) => anchor.id !== meta.anchor.id);
      return { ...state, anchors: [...others, meta.anchor].sort((a, b) => a.from - b.from || a.id - b.id) };
    }
    case "remove":
      return {
        ...state,
        anchors: state.anchors.filter((anchor) => anchor.id !== meta.id),
        activeId: state.activeId === meta.id ? null : state.activeId,
      };
    case "activate":
      return { ...state, activeId: meta.id };
    case "draft":
      return { ...state, draft: meta.anchor };
  }
}

type CommentAnchorOptions = {
  initial: CommentAnchor[];
  onActivate: (id: number) => void;
};

export const CommentAnchors = Extension.create<CommentAnchorOptions>({
  name: "commentAnchors",

  addOptions() {
    return { initial: [], onActivate: () => {} };
  },

  addProseMirrorPlugins() {
    const { initial, onActivate } = this.options;
    return [
      new Plugin<CommentAnchorState>({
        key: commentAnchorsKey,
        state: {
          init: () => ({ anchors: initial, activeId: null, draft: null }),
          apply(tr, value) {
            let next = value;
            if (tr.docChanged) {
              next = {
                ...next,
                anchors: next.anchors.map((anchor) => ({ ...anchor, ...mapAnchor(tr.mapping, anchor) })),
                draft: next.draft && mapAnchor(tr.mapping, next.draft),
              };
            }
            const meta = tr.getMeta(commentAnchorsKey) as CommentAnchorMeta | undefined;
            return meta ? applyMeta(next, meta) : next;
          },
        },
        props: {
          decorations(state) {
            const { anchors, activeId, draft } = getCommentAnchors(state);
            const decorations = anchors
              .filter((anchor) => !anchor.resolved && !isCollapsed(anchor))
              .map((anchor) =>
                Decoration.inline(anchor.from, anchor.to, {
                  class: anchor.id === activeId ? "comment-highlight is-active" : "comment-highlight",
                  "data-comment-id": String(anchor.id),
                }),
              );
            if (draft && !isCollapsed(draft)) {
              decorations.push(Decoration.inline(draft.from, draft.to, { class: "comment-highlight is-active" }));
            }
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(view, pos) {
            const id = commentAt(getCommentAnchors(view.state), pos);
            if (id !== null) onActivate(id);
            return false; // keep normal cursor placement
          },
        },
      }),
    ];
  },
});
