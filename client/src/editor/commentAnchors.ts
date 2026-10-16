// Tracks comment anchors in the editor: highlights them, moves them with every edit
// (using the same rule as the server) and reports clicks on commented text.
//
// The server moves anchors through the steps in the order it applied them. When the editor's own
// edits are rebased over another session's (prosemirror-collab), mapping the anchors through the
// rebase could end elsewhere than that (mapping is not the same along every path around a deleted
// range). So the editor also keeps the anchors as of its confirmed version, moves those through the
// confirmed steps in the server's order, and shows them moved through its unconfirmed steps.
import { isCollapsed, mapAnchor, type Anchor } from "@pubky-write/shared";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, type Step } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { collabKey, getVersion, sendableSteps } from "./collab.ts";

export type CommentAnchor = Anchor & { id: number; resolved: boolean };

export type CommentAnchorState = {
  /** As shown: in the current document. */
  anchors: CommentAnchor[];
  /** At the confirmed version (the server's anchors when the editor last heard from it), by thread id. */
  confirmed: Map<number, Anchor>;
  activeId: number | null;
  /** The selection being commented on while a new comment is written. */
  draft: Anchor | null;
  /** View > Comments > Hide comments: no highlights, and clicks on commented text do nothing. */
  hidden: boolean;
};

type CommentAnchorMeta =
  /** `confirmed`: the thread's range at the confirmed version, when it differs from `anchor` (or is new). */
  | { type: "upsert"; anchor: CommentAnchor; confirmed?: Anchor }
  | { type: "remove"; id: number }
  | { type: "activate"; id: number | null }
  | { type: "draft"; anchor: Anchor | null }
  | { type: "hide"; hidden: boolean };

export const commentAnchorsKey = new PluginKey<CommentAnchorState>("commentAnchors");

export function getCommentAnchors(state: EditorState): CommentAnchorState {
  return commentAnchorsKey.getState(state) ?? { anchors: [], confirmed: new Map(), activeId: null, draft: null, hidden: false };
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
      const { id, from, to } = meta.anchor;
      const others = state.anchors.filter((anchor) => anchor.id !== id);
      // A thread that changes otherwise (resolved) keeps its confirmed range.
      const confirmed = new Map(state.confirmed).set(id, meta.confirmed ?? state.confirmed.get(id) ?? { from, to });
      return { ...state, confirmed, anchors: [...others, meta.anchor].sort((a, b) => a.from - b.from || a.id - b.id) };
    }
    case "remove": {
      const confirmed = new Map(state.confirmed);
      confirmed.delete(meta.id);
      return {
        ...state,
        confirmed,
        anchors: state.anchors.filter((anchor) => anchor.id !== meta.id),
        activeId: state.activeId === meta.id ? null : state.activeId,
      };
    }
    case "activate":
      return { ...state, activeId: meta.id };
    case "draft":
      return { ...state, draft: meta.anchor };
    case "hide":
      return { ...state, hidden: meta.hidden, activeId: meta.hidden ? null : state.activeId };
  }
}

/** The collab plugin's state that a transaction receiving the server's steps sets. */
type CollabMeta = { version: number; unconfirmed: readonly { step: Step }[] };

const hasCollab = (state: EditorState) => collabKey.get(state) !== undefined;

/**
 * The anchors after the editor received confirmed steps (`tr`, made by receiveTransaction): the
 * confirmed anchors move through the steps in the server's order (the editor's own confirmed steps,
 * then the others'), and the shown ones are those moved through the steps still unconfirmed.
 */
function receive(value: CommentAnchorState, tr: Transaction, oldState: EditorState, collab: CollabMeta): CommentAnchorState {
  const before = sendableSteps(oldState)?.steps ?? [];
  // The collab plugin's new state (its plugin comes after this one, so not in the new state yet).
  const after = collab.unconfirmed.map((rebaseable) => rebaseable.step);
  // receiveTransaction's steps: the inverted unconfirmed steps ("rebased" of them), the others' steps, the rebased ones.
  const remaining = (tr.getMeta("rebased") as number | undefined) ?? after.length;
  const ours = before.length - remaining;
  const theirs = tr.steps.slice(remaining, remaining + collab.version - getVersion(oldState) - ours);
  const serverOrder = mappingOf([...before.slice(0, ours), ...theirs]);
  const confirmed = new Map([...value.confirmed].map(([id, anchor]) => [id, mapAnchor(serverOrder, anchor)]));
  const unconfirmed = mappingOf(after);
  return {
    ...value,
    confirmed,
    anchors: value.anchors.map((anchor) => ({ ...anchor, ...mapAnchor(unconfirmed, confirmed.get(anchor.id) ?? anchor) })),
    draft: value.draft && mapAnchor(tr.mapping, value.draft),
  };
}

function mappingOf(steps: readonly Step[]): Mapping {
  return new Mapping(steps.map((step) => step.getMap()));
}

type CommentAnchorOptions = {
  initial: CommentAnchor[];
  initiallyHidden: boolean;
  /** A click in the document: on commented text (its thread's id) or elsewhere (null). */
  onActivate: (id: number | null) => void;
};

export const CommentAnchors = Extension.create<CommentAnchorOptions>({
  name: "commentAnchors",

  addOptions() {
    return { initial: [], initiallyHidden: false, onActivate: () => {} };
  },

  addProseMirrorPlugins() {
    const { initial, initiallyHidden, onActivate } = this.options;
    return [
      new Plugin<CommentAnchorState>({
        key: commentAnchorsKey,
        state: {
          init: () => ({
            anchors: initial,
            confirmed: new Map(initial.map(({ id, from, to }) => [id, { from, to }])),
            activeId: null,
            draft: null,
            hidden: initiallyHidden,
          }),
          apply(tr, value, oldState, newState) {
            let next = value;
            const collab = tr.getMeta(collabKey) as CollabMeta | undefined;
            if (collab && collab.version !== getVersion(oldState)) {
              next = receive(next, tr, oldState, collab);
            } else if (tr.docChanged) {
              const anchors = next.anchors.map((anchor) => ({ ...anchor, ...mapAnchor(tr.mapping, anchor) }));
              next = {
                ...next,
                anchors,
                // Without the collab plugin (tests) every edit counts as confirmed.
                ...(!hasCollab(newState) && { confirmed: new Map(anchors.map(({ id, from, to }) => [id, { from, to }])) }),
                draft: next.draft && mapAnchor(tr.mapping, next.draft),
              };
            }
            const meta = tr.getMeta(commentAnchorsKey) as CommentAnchorMeta | undefined;
            return meta ? applyMeta(next, meta) : next;
          },
        },
        props: {
          decorations(state) {
            const { anchors, activeId, draft, hidden } = getCommentAnchors(state);
            if (hidden) return DecorationSet.empty;
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
            const state = getCommentAnchors(view.state);
            onActivate(state.hidden ? null : commentAt(state, pos));
            return false; // keep normal cursor placement
          },
        },
      }),
    ];
  },
});
