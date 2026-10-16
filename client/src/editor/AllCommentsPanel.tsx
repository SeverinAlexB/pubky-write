// View > Comments > Show all comments: every thread as a compact card, filtered by state.
import { isCollapsed, type CommentThread } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { ReactionChips } from "./ReactionChips.tsx";
import { Menu } from "../components/Menu.tsx";
import { formatCommentTime } from "../format.ts";
import { AUTHOR_NAME, Avatar, useCommentAnchors } from "./CommentMargin.tsx";

type Filter = "All" | "Open" | "Resolved";
const filters: Filter[] = ["All", "Open", "Resolved"];

type AllCommentsPanelProps = {
  editor: Editor;
  threads: CommentThread[];
  /** The name of each thread's tab, when the document has several tabs. */
  tabNames?: Record<number, string>;
  onSelect: (id: number) => void;
  onReopen: (id: number) => void;
  onClose: () => void;
};

export function AllCommentsPanel({ editor, threads, tabNames = {}, onSelect, onReopen, onClose }: AllCommentsPanelProps) {
  const [filter, setFilter] = useState<Filter>("Open");
  const { anchors, activeId } = useCommentAnchors(editor);
  const listed = threads
    .filter((thread) => filter === "All" || thread.resolved === (filter === "Resolved"))
    .map((thread) => ({ thread, anchor: anchors[thread.id] ?? { from: thread.from, to: thread.to } }))
    .sort((a, b) => a.anchor.from - b.anchor.from || a.thread.id - b.thread.id);

  return (
    <aside className="all-comments-panel" aria-label="All comments">
      <div className="all-comments-header">
        <h2>All comments</h2>
        <button type="button" className="icon-button" aria-label="Close all comments" data-tooltip="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="all-comments-filter">
        <Menu
          label={
            <>
              {filter}
              <Icon name="arrow_drop_down" />
            </>
          }
          ariaLabel="Filter comments"
          buttonClassName="all-comments-filter-button"
          entries={filters.map((option) => ({ label: option, checked: option === filter, onSelect: () => setFilter(option) }))}
        />
      </div>
      <div className="all-comments-list">
        {listed.length === 0 && (
          <p className="all-comments-empty">{filter === "Resolved" ? "No resolved comments" : "No comments yet"}</p>
        )}
        {listed.map(({ thread, anchor }) => {
          const [first, ...replies] = thread.messages;
          return (
            <article
              key={thread.id}
              className={`all-comments-card${thread.id === activeId ? " is-active" : ""}`}
              aria-label={`Comment on "${thread.quote}"`}
              onClick={() => onSelect(thread.id)}
            >
              {tabNames[thread.id] && (
                <p className="all-comments-tab">
                  <Icon name="description" size={16} />
                  {tabNames[thread.id]}
                </p>
              )}
              <p className={`all-comments-quote${isCollapsed(anchor) ? " is-deleted" : ""}`}>
                {isCollapsed(anchor) ? <s>{thread.quote}</s> : thread.quote}
              </p>
              <div className="comment-message-header">
                <Avatar name={AUTHOR_NAME} />
                <div className="comment-meta">
                  <span className="comment-author">{AUTHOR_NAME}</span>
                  {first && <time dateTime={new Date(first.createdAt).toISOString()}>{formatCommentTime(first.createdAt)}</time>}
                </div>
                {thread.resolved && (
                  <button
                    type="button"
                    className="button-secondary all-comments-reopen"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReopen(thread.id);
                    }}
                  >
                    Reopen
                  </button>
                )}
              </div>
              {first && <p className="comment-body">{first.body}</p>}
              {first && <ReactionChips reactions={first.reactions ?? []} />}
              {replies.length > 0 && (
                <p className="all-comments-replies">{replies.length === 1 ? "1 reply" : `${replies.length} replies`}</p>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
