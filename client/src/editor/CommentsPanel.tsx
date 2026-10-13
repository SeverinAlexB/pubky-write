import type { CommentThread } from "@docs/shared";
import { isCollapsed } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { formatShortDate } from "../format.ts";
import { getCommentAnchors } from "./commentAnchors.ts";

type CommentsPanelProps = {
  editor: Editor;
  threads: CommentThread[];
  onCreate: (body: string) => Promise<void>;
  onCancelDraft: () => void;
  onSelect: (id: number) => void;
  onReply: (id: number, body: string) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
};

/** Comment threads in document order. Resolved threads are hidden unless asked for. */
export function CommentsPanel({
  editor,
  threads,
  onCreate,
  onCancelDraft,
  onSelect,
  onReply,
  onResolve,
  onDelete,
  onClose,
}: CommentsPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const { anchors, activeId, hasDraft } = useEditorState({
    editor,
    selector: ({ editor }) => {
      const state = getCommentAnchors(editor.state);
      return {
        anchors: Object.fromEntries(state.anchors.map((anchor) => [anchor.id, { from: anchor.from, to: anchor.to }])),
        activeId: state.activeId,
        hasDraft: state.draft !== null,
      };
    },
  });
  const cards = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (activeId !== null) cards.current.get(activeId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const visible = threads
    .filter((thread) => showResolved || !thread.resolved || thread.id === activeId)
    .map((thread) => ({ thread, anchor: anchors[thread.id] ?? { from: thread.from, to: thread.to } }))
    .sort((a, b) => a.anchor.from - b.anchor.from || a.thread.id - b.thread.id);
  const resolvedCount = threads.filter((thread) => thread.resolved).length;

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="panel-header">
        <h2>Comments</h2>
        <button type="button" className="icon-button" aria-label="Close comments" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {resolvedCount > 0 && (
        <label className="comments-filter">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          Show resolved ({resolvedCount})
        </label>
      )}

      <div className="comment-list">
        {hasDraft && (
          <article className="comment-thread is-active" aria-label="New comment">
            <CommentInput
              label="Comment"
              placeholder="Add a comment"
              submitLabel="Comment"
              autoFocus
              onSubmit={onCreate}
              onCancel={onCancelDraft}
            />
          </article>
        )}
        {visible.length === 0 && !hasDraft && (
          <p className="empty comments-empty">
            No comments yet. Select some text and choose Insert &gt; Comment to start a discussion.
          </p>
        )}
        {visible.map(({ thread, anchor }) => {
          const active = thread.id === activeId;
          return (
            <article
              key={thread.id}
              ref={(element) => {
                if (element) cards.current.set(thread.id, element);
                else cards.current.delete(thread.id);
              }}
              className={`comment-thread${active ? " is-active" : ""}${thread.resolved ? " is-resolved" : ""}`}
              aria-label={`Comment on "${thread.quote}"`}
              aria-current={active || undefined}
              onClick={() => onSelect(thread.id)}
            >
              <div className="comment-thread-header">
                {isCollapsed(anchor) ? (
                  <p className="comment-quote is-deleted">
                    <span>Original content deleted</span>
                    <s>{thread.quote}</s>
                  </p>
                ) : (
                  <p className="comment-quote">{thread.quote}</p>
                )}
                <div className="comment-actions">
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={thread.resolved ? "Reopen" : "Mark as resolved and hide discussion"}
                    title={thread.resolved ? "Reopen" : "Mark as resolved"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onResolve(thread.id, !thread.resolved);
                    }}
                  >
                    <Icon name={thread.resolved ? "restart_alt" : "check_circle"} />
                  </button>
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label="Delete comment thread"
                    title="Delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirm("Delete this comment thread?")) void onDelete(thread.id);
                    }}
                  >
                    <Icon name="delete" />
                  </button>
                </div>
              </div>
              {thread.messages.map((message) => (
                <div key={message.id} className="comment-message">
                  <div className="comment-meta">
                    <span className="comment-author">You</span>
                    <time dateTime={new Date(message.createdAt).toISOString()}>{formatShortDate(message.createdAt)}</time>
                  </div>
                  <p className="comment-body">{message.body}</p>
                </div>
              ))}
              {thread.resolved && <p className="comment-resolved-note">Resolved</p>}
              {active && !thread.resolved && (
                <CommentInput
                  label="Reply"
                  placeholder="Reply"
                  submitLabel="Reply"
                  onSubmit={(body) => onReply(thread.id, body)}
                />
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}

type CommentInputProps = {
  label: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
};

/** A growing text area; ⌘/Ctrl+Enter submits and Escape cancels. */
function CommentInput({ label, placeholder, submitLabel, autoFocus, onSubmit, onCancel }: CommentInputProps) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
      setBody("");
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setBody("");
    onCancel?.();
  };

  return (
    <div className="comment-input" onClick={(event) => event.stopPropagation()}>
      <textarea
        aria-label={label}
        placeholder={placeholder}
        value={body}
        rows={body.includes("\n") ? 3 : 1}
        autoFocus={autoFocus}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          if (event.key === "Escape") cancel();
        }}
      />
      {error && <p className="error">{error}</p>}
      {(body || onCancel) && (
        <div className="comment-input-actions">
          <button type="button" className="button-secondary small" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="button-primary small" disabled={!body.trim() || busy} onClick={() => void submit()}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
