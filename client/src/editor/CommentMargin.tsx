// The comment margin right of the pages: one card per open thread and per suggestion, level with
// the line of its text (see commentLayout.ts), plus the draft card while a new comment is written.
import {
  describeSuggestion,
  descriptionText,
  isCollapsed,
  type Anchor,
  type CommentMessage,
  type CommentThread,
  type Suggestion,
  type SuggestionDescription,
} from "@pubky-write/shared";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { formatCommentTime } from "../format.ts";
import { getCommentAnchors } from "./commentAnchors.ts";
import { layoutCards } from "./commentLayout.ts";
import { lazyComponent } from "../components/lazyComponent.tsx";
import type { PickerAnchor } from "./emoji/EmojiPicker.tsx";
import { ReactionChips } from "./ReactionChips.tsx";

const EmojiPicker = lazyComponent(() => import("./emoji/EmojiPicker.tsx").then((module) => module.EmojiPicker));

/** Width of the margin: the 389px cards and the gap between them and the page. */
export const COMMENT_MARGIN_WIDTH = 401;

/** The single local user (a display name preference is P2). */
export const AUTHOR_NAME = "You";

type CardKey = number | "draft" | `s:${string}`;

export type CommentHandlers = {
  onCreate: (body: string) => Promise<void>;
  onCancelDraft: () => void;
  onActivate: (id: number | null) => void;
  onReply: (id: number, body: string) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onEditMessage: (id: number, messageId: number, body: string) => Promise<void>;
  onDeleteReply: (id: number, messageId: number) => Promise<void>;
  onCopyLink: (id: number) => void;
  /** Adds (`on`) or removes the user's emoji reaction to a message. */
  onReact: (id: number, messageId: number, emoji: string, on: boolean) => Promise<void>;
};

export type SuggestionHandlers = {
  /** A click on a card (its id) or on the margin's background (null). */
  onActivateSuggestion: (id: string | null) => void;
  onResolveSuggestion: (action: "accept" | "reject", id: string) => void;
  onReplyToSuggestion: (id: string, body: string) => Promise<void>;
  onDeleteSuggestionReply: (id: string, replyId: number) => Promise<void>;
};

/** Live anchors of every thread, the active thread and the draft, from the editor's comment plugin. */
export function useCommentAnchors(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = getCommentAnchors(current.state);
      return {
        anchors: Object.fromEntries(state.anchors.map((anchor) => [anchor.id, { from: anchor.from, to: anchor.to }])) as Record<
          number,
          Anchor
        >,
        activeId: state.activeId,
        draft: state.draft,
      };
    },
  });
}

/** The threads shown in the margin, in document order: open ones, and the active one even if resolved. */
export function marginThreads(threads: CommentThread[], anchors: Record<number, Anchor>, activeId: number | null) {
  return threads
    .filter((thread) => !thread.resolved || thread.id === activeId)
    .map((thread) => ({ thread, anchor: anchors[thread.id] ?? { from: thread.from, to: thread.to } }))
    .sort((a, b) => a.anchor.from - b.anchor.from || a.thread.id - b.thread.id);
}

type CommentMarginProps = CommentHandlers &
  SuggestionHandlers & {
    editor: Editor;
    threads: CommentThread[];
    /** The suggestions shown as cards, in document order. */
    suggestions: Suggestion[];
    /** The header, footer or footnote being edited, whose suggestions' cards follow its lines. */
    regionEditor?: Editor | null;
    /** The top (in the window) of a header's, footer's or footnote's suggestion. */
    regionTop?: (suggestion: Suggestion) => number | null;
    activeSuggestion: string | null;
    suggestionReplies: Record<string, CommentMessage[]>;
  };

export function CommentMargin({
  editor,
  threads,
  suggestions,
  regionEditor = null,
  regionTop,
  activeSuggestion,
  suggestionReplies,
  ...handlers
}: CommentMarginProps) {
  const { anchors, activeId, draft } = useCommentAnchors(editor);
  const visible = marginThreads(threads, anchors, activeId);
  const margin = useRef<HTMLElement>(null);
  const cards = useRef(new Map<CardKey, HTMLElement>());
  const [tops, setTops] = useState<Map<CardKey, number>>(new Map());
  // The emoji picker of "Add emoji reaction", for one message.
  const [reactionPicker, setReactionPicker] = useState<{ threadId: number; messageId: number; anchor: PickerAnchor } | null>(null);
  const openReactionPicker = (threadId: number, messageId: number, element: HTMLElement) => {
    const { left, top, bottom } = element.getBoundingClientRect();
    setReactionPicker((current) => (current?.messageId === messageId ? null : { threadId, messageId, anchor: { left, top, bottom } }));
  };

  const entries: { key: CardKey; pos: number; suggestion?: Suggestion }[] = [
    ...visible.map(({ thread, anchor }) => ({ key: thread.id as CardKey, pos: anchor.from })),
    ...suggestions.map((suggestion) => ({ key: `s:${suggestion.id}` as CardKey, pos: suggestion.from, suggestion })),
  ].sort((a, b) => a.pos - b.pos);
  if (draft) {
    const index = entries.findIndex((entry) => entry.pos > draft.from);
    entries.splice(index < 0 ? entries.length : index, 0, { key: "draft", pos: draft.from });
  }
  const activeKey: CardKey | null = draft ? "draft" : activeSuggestion !== null ? `s:${activeSuggestion}` : activeId;
  const layoutKey = `${activeKey}|${entries.map((entry) => `${entry.key}@${entry.pos}`).join(",")}`;

  // Reads the editor's line positions (which include page spacers and zoom) and the card heights.
  const measure = useCallback(() => {
    const element = margin.current;
    if (!element || editor.isDestroyed) return;
    const marginTop = element.getBoundingClientRect().top;
    const boxes = entries.map(({ key, pos, suggestion }) => ({
      key,
      // A header's, footer's or footnote's suggestion is beside its line in that region.
      anchorTop: ((suggestion?.region && regionTop?.(suggestion)) ?? lineTop(editor, pos)) - marginTop,
      height: cards.current.get(key)?.offsetHeight ?? 0,
    }));
    const next = layoutCards(boxes, activeKey);
    setTops((previous) => (sameTops(previous, next) ? previous : next));
    // The callback changes whenever the cards or their anchors do.
  }, [editor, layoutKey, regionEditor]);

  useLayoutEffect(measure, [measure]);

  // Typing, pagination, zoom, resizing and cards growing all move the cards; measure once per frame.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
    };
    const observer = new ResizeObserver(schedule);
    if (margin.current) observer.observe(margin.current);
    for (const card of cards.current.values()) observer.observe(card);
    editor.on("transaction", schedule);
    regionEditor?.on("transaction", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off("transaction", schedule);
      regionEditor?.off("transaction", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, regionEditor, measure]);

  const cardRef = (key: CardKey) => (element: HTMLElement | null) => {
    if (element) cards.current.set(key, element);
    else cards.current.delete(key);
  };
  const place = (key: CardKey) => {
    const top = tops.get(key);
    // Unmeasured cards are laid out (so their height can be read) but not shown yet.
    return top === undefined ? { top: 0, opacity: 0 } : { top };
  };

  return (
    <aside
      ref={margin}
      className="comment-margin"
      aria-label="Comments"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        handlers.onActivate(null);
        handlers.onActivateSuggestion(null);
      }}
    >
      {draft && (
        <DraftCard
          cardRef={cardRef("draft")}
          style={place("draft")}
          ready={tops.has("draft")}
          onCreate={handlers.onCreate}
          onCancel={handlers.onCancelDraft}
        />
      )}
      {visible.map(({ thread, anchor }) => (
        <ThreadCard
          key={thread.id}
          cardRef={cardRef(thread.id)}
          style={place(thread.id)}
          thread={thread}
          deleted={isCollapsed(anchor)}
          active={thread.id === activeId && !draft && activeSuggestion === null}
          handlers={handlers}
          onAddReaction={(messageId, element) => openReactionPicker(thread.id, messageId, element)}
        />
      ))}
      {reactionPicker && (
        <EmojiPicker
          anchor={reactionPicker.anchor}
          label="Add emoji reaction"
          onPick={(emoji) => {
            setReactionPicker(null);
            void handlers.onReact(reactionPicker.threadId, reactionPicker.messageId, emoji, true);
          }}
          onClose={() => setReactionPicker(null)}
        />
      )}
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={`s:${suggestion.id}`}
          cardRef={cardRef(`s:${suggestion.id}`)}
          style={place(`s:${suggestion.id}`)}
          suggestion={suggestion}
          replies={suggestionReplies[suggestion.id] ?? []}
          active={suggestion.id === activeSuggestion && !draft}
          handlers={handlers}
        />
      ))}
    </aside>
  );
}

/** The top of the line containing `pos` (or the nearest text position), in client coordinates. */
function lineTop(editor: Editor, pos: number): number {
  const { doc } = editor.state;
  try {
    const near = TextSelection.near(doc.resolve(Math.min(Math.max(pos, 0), doc.content.size))).from;
    return editor.view.coordsAtPos(near, 1).top;
  } catch {
    return editor.view.dom.getBoundingClientRect().top;
  }
}

function sameTops(a: Map<CardKey, number>, b: Map<CardKey, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, top] of b) {
    const previous = a.get(key);
    if (previous === undefined || Math.abs(previous - top) > 0.5) return false;
  }
  return true;
}

type CardPlacement = { top: number; opacity?: number };

function DraftCard({
  cardRef,
  style,
  ready,
  onCreate,
  onCancel,
}: {
  cardRef: (element: HTMLElement | null) => void;
  style: CardPlacement;
  ready: boolean;
  onCreate: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <article ref={cardRef} className="comment-card is-active is-draft" style={style} aria-label="New comment">
      <div className="comment-author-row">
        <Avatar name={AUTHOR_NAME} />
        <span className="comment-author">{AUTHOR_NAME}</span>
      </div>
      <CommentField
        label="Comment"
        placeholder="Comment"
        submitLabel="Comment"
        focus={ready}
        alwaysShowActions
        onSubmit={onCreate}
        onCancel={onCancel}
      />
    </article>
  );
}

type ThreadCardProps = {
  cardRef: (element: HTMLElement | null) => void;
  style: CardPlacement;
  thread: CommentThread;
  deleted: boolean;
  active: boolean;
  handlers: CommentHandlers;
  /** "Add emoji reaction" on a message: opens the emoji picker under `element`. */
  onAddReaction: (messageId: number, element: HTMLElement) => void;
};

function ThreadCard({ cardRef, style, thread, deleted, active, handlers, onAddReaction }: ThreadCardProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [first, ...replies] = thread.messages;

  const remove = () => {
    if (confirm("Delete this comment thread?")) void handlers.onDelete(thread.id);
  };
  const removeReply = (message: CommentMessage) => {
    if (confirm("Delete this reply?")) void handlers.onDeleteReply(thread.id, message.id);
  };
  // Reactions can be changed on the active card; idle cards show them.
  const reactionProps = (message: CommentMessage) =>
    active
      ? {
          onReact: (emoji: string, on: boolean) => void handlers.onReact(thread.id, message.id, emoji, on),
          onAddReaction: (element: HTMLElement) => onAddReaction(message.id, element),
        }
      : {};

  const headerActions = active && (
    <div className="comment-header-actions">
      {thread.resolved ? (
        <button
          type="button"
          className="icon-button comment-action"
          aria-label="Reopen"
          data-tooltip="Reopen"
          onClick={() => void handlers.onResolve(thread.id, false)}
        >
          <Icon name="restart_alt" />
        </button>
      ) : (
        <button
          type="button"
          className="icon-button comment-action comment-resolve"
          aria-label="Mark as resolved and hide discussion"
          data-tooltip="Mark as resolved and hide discussion"
          onClick={() => void handlers.onResolve(thread.id, true)}
        >
          <Icon name="check" />
        </button>
      )}
      <Menu
        label={<Icon name="more_vert" />}
        ariaLabel="More options"
        buttonClassName="icon-button comment-action"
        align="end"
        listClassName="comment-menu"
        entries={[
          { label: "Edit", onSelect: () => first && setEditing(first.id) },
          { label: "Delete", onSelect: remove },
          { label: "Get link to this comment", onSelect: () => handlers.onCopyLink(thread.id) },
        ]}
      />
    </div>
  );

  return (
    <article
      ref={cardRef}
      className={`comment-card${active ? " is-active" : ""}${thread.resolved ? " is-resolved" : ""}`}
      style={style}
      aria-label={`Comment on "${thread.quote}"`}
      aria-current={active || undefined}
      onClick={() => {
        if (!active) handlers.onActivate(thread.id);
      }}
    >
      {first && (
        <Message
          message={first}
          actions={headerActions}
          editing={editing === first.id}
          onSave={(body) => handlers.onEditMessage(thread.id, first.id, body)}
          onStopEditing={() => setEditing(null)}
          {...reactionProps(first)}
        >
          {deleted && (
            <p className="comment-deleted">
              <span>Original content deleted</span>
              <s>{thread.quote}</s>
            </p>
          )}
        </Message>
      )}
      {replies.map((reply) => (
        <Message
          key={reply.id}
          message={reply}
          isReply
          actions={
            <Menu
              label={<Icon name="more_vert" />}
              ariaLabel="More options for this reply"
              buttonClassName="icon-button comment-action"
              align="end"
              listClassName="comment-menu"
              entries={[
                { label: "Edit", onSelect: () => setEditing(reply.id) },
                { label: "Delete", onSelect: () => removeReply(reply) },
              ]}
            />
          }
          editing={editing === reply.id}
          onSave={(body) => handlers.onEditMessage(thread.id, reply.id, body)}
          onStopEditing={() => setEditing(null)}
          {...reactionProps(reply)}
        />
      ))}
      {thread.resolved && <p className="comment-resolved-note">Resolved</p>}
      {active && !thread.resolved && (
        <CommentField label="Reply" placeholder="Reply" submitLabel="Reply" onSubmit={(body) => handlers.onReply(thread.id, body)} />
      )}
    </article>
  );
}

/** One line of a suggestion's description: "Add: “text”", with the quoted text in italics. */
function DescriptionLine({ line }: { line: SuggestionDescription }) {
  const quote = (text: string) => (
    <>
      “<em>{text}</em>”
    </>
  );
  // Objects are named, not quoted: "Add: Image".
  const part = (text: string, object?: boolean) => (object ? text : quote(text));
  switch (line.action) {
    case "Add":
      return <p className="suggestion-description">Add: {part(line.inserted, line.insertedObject)}</p>;
    case "Delete":
      return <p className="suggestion-description">Delete: {part(line.deleted, line.deletedObject)}</p>;
    case "Replace":
      return (
        <p className="suggestion-description">
          Replace: {part(line.deleted, line.deletedObject)} with {part(line.inserted, line.insertedObject)}
        </p>
      );
    default:
      return (
        <p className="suggestion-description">
          {line.action}: {line.changes}
        </p>
      );
  }
}

type SuggestionCardProps = {
  cardRef: (element: HTMLElement | null) => void;
  style: CardPlacement;
  suggestion: Suggestion;
  replies: CommentMessage[];
  active: boolean;
  handlers: SuggestionHandlers;
};

/** A suggestion's card: who and when, what it changes, and on the active card accept, reject and Reply. */
function SuggestionCard({ cardRef, style, suggestion, replies, active, handlers }: SuggestionCardProps) {
  const lines = describeSuggestion(suggestion);
  const summary = lines.map(descriptionText).join(". ");
  const removeReply = (reply: CommentMessage) => {
    if (confirm("Delete this reply?")) void handlers.onDeleteSuggestionReply(suggestion.id, reply.id);
  };
  const actions = active && (
    <div className="comment-header-actions">
      <button
        type="button"
        className="icon-button comment-action suggestion-accept"
        aria-label="Accept suggestion"
        data-tooltip="Accept suggestion"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onResolveSuggestion("accept", suggestion.id);
        }}
      >
        <Icon name="check" />
      </button>
      <button
        type="button"
        className="icon-button comment-action"
        aria-label="Reject suggestion"
        data-tooltip="Reject suggestion"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onResolveSuggestion("reject", suggestion.id);
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
  return (
    <article
      ref={cardRef}
      className={`comment-card suggestion-card${active ? " is-active" : ""}`}
      style={style}
      aria-label={`Suggestion: ${summary}`}
      aria-current={active || undefined}
      onClick={() => {
        if (!active) handlers.onActivateSuggestion(suggestion.id);
      }}
    >
      <div className="comment-message">
        <div className="comment-message-header">
          <Avatar name={suggestion.author} />
          <div className="comment-meta">
            <span className="comment-author">{suggestion.author}</span>
            <time dateTime={new Date(suggestion.createdAt).toISOString()}>{formatCommentTime(suggestion.createdAt)}</time>
          </div>
          {actions}
        </div>
        {lines.map((line, index) => (
          <DescriptionLine key={index} line={line} />
        ))}
      </div>
      {replies.map((reply) => (
        <div key={reply.id} className="comment-message is-reply">
          <div className="comment-message-header">
            <Avatar name={AUTHOR_NAME} />
            <div className="comment-meta">
              <span className="comment-author">{AUTHOR_NAME}</span>
              <time dateTime={new Date(reply.createdAt).toISOString()}>{formatCommentTime(reply.createdAt)}</time>
            </div>
            <div className="comment-reply-actions">
              <Menu
                label={<Icon name="more_vert" />}
                ariaLabel="More options for this reply"
                buttonClassName="icon-button comment-action"
                align="end"
                listClassName="comment-menu"
                entries={[{ label: "Delete", onSelect: () => removeReply(reply) }]}
              />
            </div>
          </div>
          <p className="comment-body">{reply.body}</p>
        </div>
      ))}
      {active && (
        <CommentField
          label="Reply"
          placeholder="Reply"
          submitLabel="Reply"
          onSubmit={(body) => handlers.onReplyToSuggestion(suggestion.id, body)}
        />
      )}
    </article>
  );
}

type MessageProps = {
  message: CommentMessage;
  isReply?: boolean;
  actions: ReactNode;
  editing: boolean;
  onSave: (body: string) => Promise<void>;
  onStopEditing: () => void;
  /** Toggles the user's reaction (active card). */
  onReact?: (emoji: string, on: boolean) => void;
  /** "Add emoji reaction": the emoji picker under the element (active card). */
  onAddReaction?: (element: HTMLElement) => void;
  children?: ReactNode;
};

function Message({ message, isReply = false, actions, editing, onSave, onStopEditing, onReact, onAddReaction, children }: MessageProps) {
  return (
    <div className={`comment-message${isReply ? " is-reply" : ""}`}>
      <div className="comment-message-header">
        <Avatar name={AUTHOR_NAME} />
        <div className="comment-meta">
          <span className="comment-author">{AUTHOR_NAME}</span>
          <time dateTime={new Date(message.createdAt).toISOString()}>{formatCommentTime(message.createdAt)}</time>
        </div>
        {actions && <div className={isReply ? "comment-reply-actions" : undefined}>{actions}</div>}
      </div>
      {children}
      {editing ? (
        <CommentField
          label="Edit comment"
          placeholder="Comment"
          submitLabel="Save"
          initialValue={message.body}
          focus
          alwaysShowActions
          onSubmit={async (body) => {
            await onSave(body);
            onStopEditing();
          }}
          onCancel={onStopEditing}
        />
      ) : (
        <div className="comment-body-row">
          <p className="comment-body">{message.body}</p>
          {onAddReaction && (
            <button
              type="button"
              className="icon-button comment-react"
              aria-label="Add emoji reaction"
              data-tooltip="Add emoji reaction"
              // Not a click outside the picker it toggles.
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onAddReaction(event.currentTarget);
              }}
            >
              <Icon name="add_reaction" size={18} />
            </button>
          )}
        </div>
      )}
      <ReactionChips reactions={message.reactions ?? []} onToggle={onReact} onAdd={onAddReaction} />
    </div>
  );
}

const avatarColours = ["#1e8e3e", "#8430ce", "#d93025", "#e37400", "#1a73e8", "#c5221f", "#12846e"];

/** A 32px round avatar with the name's first letter. */
export function Avatar({ name }: { name: string }) {
  const colour = avatarColours[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarColours.length];
  return (
    <span className="comment-avatar" style={{ background: colour }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

type CommentFieldProps = {
  label: string;
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
  /** Focuses the field (once) when it becomes true. */
  focus?: boolean;
  /** Shows Cancel and the submit button before anything is typed. */
  alwaysShowActions?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
};

/** A rounded, growing text field; ⌘/Ctrl+Enter submits and Escape cancels. */
function CommentField({
  label,
  placeholder,
  submitLabel,
  initialValue = "",
  focus = false,
  alwaysShowActions = false,
  onSubmit,
  onCancel,
}: CommentFieldProps) {
  const [body, setBody] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focus || !field.current) return;
    // The card is already beside its text; focusing must not scroll the editor.
    field.current.focus({ preventScroll: true });
    field.current.setSelectionRange(field.current.value.length, field.current.value.length);
  }, [focus]);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [body]);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const submitted = body;
      await onSubmit(submitted);
      // Keep anything typed while the comment was being sent.
      setBody((current) => (current === submitted ? "" : current));
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setBody(initialValue);
    onCancel?.();
  };

  return (
    <div className="comment-field" onClick={(event) => event.stopPropagation()}>
      <textarea
        ref={field}
        aria-label={label}
        placeholder={placeholder}
        value={body}
        rows={1}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
      {error && <p className="error">{error}</p>}
      {(alwaysShowActions || body) && (
        <div className="comment-field-actions">
          <button type="button" className="button-secondary" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="button-primary" disabled={!body.trim() || busy} onClick={() => void submit()}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
