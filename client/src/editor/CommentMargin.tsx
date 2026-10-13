// The comment margin right of the pages: one card per open thread, level with the line of its
// commented text (see commentLayout.ts), plus the draft card while a new comment is written.
import { isCollapsed, type Anchor, type CommentMessage, type CommentThread } from "@docs/shared";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { formatCommentTime } from "../format.ts";
import { getCommentAnchors } from "./commentAnchors.ts";
import { layoutCards } from "./commentLayout.ts";

/** Width of the margin: the 389px cards and the gap between them and the page. */
export const COMMENT_MARGIN_WIDTH = 401;

/** The single local user (a display name preference is P2). */
export const AUTHOR_NAME = "You";

type CardKey = number | "draft";

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

type CommentMarginProps = CommentHandlers & { editor: Editor; threads: CommentThread[] };

export function CommentMargin({ editor, threads, ...handlers }: CommentMarginProps) {
  const { anchors, activeId, draft } = useCommentAnchors(editor);
  const visible = marginThreads(threads, anchors, activeId);
  const margin = useRef<HTMLElement>(null);
  const cards = useRef(new Map<CardKey, HTMLElement>());
  const [tops, setTops] = useState<Map<CardKey, number>>(new Map());

  const entries: { key: CardKey; pos: number }[] = visible.map(({ thread, anchor }) => ({ key: thread.id, pos: anchor.from }));
  if (draft) {
    const index = entries.findIndex((entry) => entry.pos > draft.from);
    entries.splice(index < 0 ? entries.length : index, 0, { key: "draft", pos: draft.from });
  }
  const activeKey: CardKey | null = draft ? "draft" : activeId;
  const layoutKey = `${activeKey}|${entries.map((entry) => `${entry.key}@${entry.pos}`).join(",")}`;

  // Reads the editor's line positions (which include page spacers and zoom) and the card heights.
  const measure = useCallback(() => {
    const element = margin.current;
    if (!element || editor.isDestroyed) return;
    const marginTop = element.getBoundingClientRect().top;
    const boxes = entries.map(({ key, pos }) => ({
      key,
      anchorTop: lineTop(editor, pos) - marginTop,
      height: cards.current.get(key)?.offsetHeight ?? 0,
    }));
    const next = layoutCards(boxes, activeKey);
    setTops((previous) => (sameTops(previous, next) ? previous : next));
    // The callback changes whenever the cards or their anchors do.
  }, [editor, layoutKey]);

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
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off("transaction", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, measure]);

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
        if (event.target === event.currentTarget) handlers.onActivate(null);
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
          active={thread.id === activeId && !draft}
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
};

function ThreadCard({ cardRef, style, thread, deleted, active, handlers }: ThreadCardProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [first, ...replies] = thread.messages;

  const remove = () => {
    if (confirm("Delete this comment thread?")) void handlers.onDelete(thread.id);
  };
  const removeReply = (message: CommentMessage) => {
    if (confirm("Delete this reply?")) void handlers.onDeleteReply(thread.id, message.id);
  };

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
        />
      ))}
      {thread.resolved && <p className="comment-resolved-note">Resolved</p>}
      {active && !thread.resolved && (
        <CommentField label="Reply" placeholder="Reply" submitLabel="Reply" onSubmit={(body) => handlers.onReply(thread.id, body)} />
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
  children?: ReactNode;
};

function Message({ message, isReply = false, actions, editing, onSave, onStopEditing, children }: MessageProps) {
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
        <p className="comment-body">{message.body}</p>
      )}
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
