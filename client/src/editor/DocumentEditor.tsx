import type { CommentThread, OpenedDocument, Revision, RevisionWithContent } from "@docs/shared";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { CloudAlert, CloudCheck, CloudOff, History, LoaderCircle, MessageSquareText } from "lucide-react";
import { getVersion } from "prosemirror-collab";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, stepsTransport } from "../api.ts";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { getCommentAnchors, updateCommentAnchors } from "./commentAnchors.ts";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { editorExtensions } from "./extensions.ts";
import { FindBar } from "./FindBar.tsx";
import { HistoryPanel, RevisionPreview } from "./HistoryPanel.tsx";
import { MenuBar, type MenuActions } from "./MenuBar.tsx";
import { OutlinePanel } from "./OutlinePanel.tsx";
import { DocumentSync, type SaveStatus } from "./sync.ts";
import { Toolbar } from "./Toolbar.tsx";
import { WordCountDialog } from "./WordCountDialog.tsx";

const OUTLINE_SETTING = "docs.outlineOpen";

type DocumentEditorProps = {
  document: OpenedDocument;
  onReload: () => Promise<void>;
};

export function DocumentEditor({ document: doc, onReload }: DocumentEditorProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(doc.title);
  const [savedTitle, setSavedTitle] = useState(doc.title);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [zoom, setZoom] = useState(1);
  const [linkDialog, setLinkDialog] = useState<{ href: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<RevisionWithContent | null>(null);
  const [find, setFind] = useState<{ replace: boolean; request: number } | null>(null);
  const [wordCountOpen, setWordCountOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(() => localStorage.getItem(OUTLINE_SETTING) !== "false");
  const [threads, setThreads] = useState<CommentThread[]>(doc.comments);
  const [commentsOpen, setCommentsOpen] = useState(() => doc.comments.some((thread) => !thread.resolved));
  const sync = useRef<DocumentSync | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  // Editor callbacks are created once, so they reach the latest handlers through this ref.
  const handlers = useRef({
    openLinkDialog: () => {},
    insertImages: (_files: File[], _at?: number) => {},
    startComment: () => {},
    selectComment: (_id: number) => {},
    openHistory: () => {},
  });

  const extensions = useMemo(
    () =>
      editorExtensions({
        version: doc.version,
        clientId: crypto.randomUUID(),
        onLinkShortcut: () => handlers.current.openLinkDialog(),
        onCommentShortcut: () => handlers.current.startComment(),
        comments: doc.comments.map(({ id, from, to, resolved }) => ({ id, from, to, resolved })),
        onCommentClick: (id) => handlers.current.selectComment(id),
      }),
    // The document is fixed for the life of this component; a reload remounts it.
    [],
  );

  const editor = useEditor({
    extensions,
    content: doc.content,
    autofocus: "start",
    editorProps: {
      attributes: { class: "page-content", "aria-label": "Document content" },
      handlePaste: (_view, event) => {
        const images = imageFiles(event.clipboardData?.files);
        if (images.length === 0) return false;
        handlers.current.insertImages(images);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const images = imageFiles(event.dataTransfer?.files);
        if (moved || images.length === 0) return false;
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        handlers.current.insertImages(images, position);
        return true;
      },
    },
    onUpdate: () => sync.current?.notifyChange(),
  });

  useEffect(() => {
    const documentSync = new DocumentSync(
      {
        get state() {
          return editor.state;
        },
        dispatch: (transaction) => {
          if (!editor.isDestroyed) editor.view.dispatch(transaction);
        },
      },
      stepsTransport(doc.id),
      { onStatusChange: setStatus },
    );
    sync.current = documentSync;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (documentSync.hasUnsavedChanges) event.preventDefault();
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void documentSync.flushNow();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      void documentSync.flushNow().then(() => documentSync.destroy());
    };
  }, [editor, doc.id]);

  useEffect(() => {
    document.title = `${title || "Untitled document"} - Docs`;
  }, [title]);

  useEffect(() => {
    localStorage.setItem(OUTLINE_SETTING, String(outlineOpen));
  }, [outlineOpen]);

  // Shortcuts that work anywhere on the page, overriding the browser's own find.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const shortcut = `${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.code}`;
      const action = {
        "Alt+Shift+KeyH": () => handlers.current.openHistory(),
        KeyF: () => openFind(false),
        "Shift+KeyH": () => openFind(true),
        "Shift+KeyC": () => setWordCountOpen(true),
      }[shortcut];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openFind(replace: boolean) {
    setFind((previous) => ({ replace: replace || (previous?.replace ?? false), request: (previous?.request ?? 0) + 1 }));
  }

  handlers.current.openLinkDialog = () => setLinkDialog({ href: editor.getAttributes("link").href ?? "" });
  handlers.current.insertImages = (files, at) => void insertImages(editor, files, at);
  handlers.current.startComment = startComment;
  handlers.current.openHistory = openHistory;
  handlers.current.selectComment = selectComment;

  function startComment() {
    const { from, to, empty } = editor.state.selection;
    if (empty || historyOpen) return;
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "draft", anchor: { from, to } }));
    setCommentsOpen(true);
  }

  function cancelComment() {
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "draft", anchor: null }));
    editor.commands.focus();
  }

  /** Saves pending edits first, so the anchor's positions match the server's version of the document. */
  async function createComment(body: string) {
    for (let attempt = 0; ; attempt++) {
      await sync.current?.flushNow();
      const draft = getCommentAnchors(editor.state).draft;
      if (!draft || draft.from === draft.to) throw new Error("The text you selected was deleted");
      if (sync.current?.hasUnsavedChanges) throw new Error("Couldn't save your latest changes. Try again.");
      try {
        const thread = await api.createComment(doc.id, { version: getVersion(editor.state), ...draft, body });
        setThreads((current) => [...current, thread]);
        // One update per transaction: each update replaces the transaction's previous one.
        const anchor = getCommentAnchors(editor.state).draft ?? draft;
        editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "draft", anchor: null }));
        editor.view.dispatch(
          updateCommentAnchors(editor.state.tr, { type: "upsert", anchor: { id: thread.id, ...anchor, resolved: false } }),
        );
        editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "activate", id: thread.id }));
        return;
      } catch (error) {
        // Another save landed in between; save again and retry once.
        if (!(error instanceof ApiError && error.status === 409) || attempt > 0) throw error;
      }
    }
  }

  function selectComment(id: number) {
    setCommentsOpen(true);
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "activate", id }));
    const anchor = getCommentAnchors(editor.state).anchors.find((candidate) => candidate.id === id);
    if (!anchor || anchor.from === anchor.to) return;
    const { node } = editor.view.domAtPos(anchor.from);
    const element = node instanceof HTMLElement ? node : node.parentElement;
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function replaceThread(updated: CommentThread) {
    setThreads((current) => current.map((thread) => (thread.id === updated.id ? updated : thread)));
  }

  async function resolveComment(id: number, resolved: boolean) {
    const updated = await api.setCommentResolved(doc.id, id, resolved);
    replaceThread(updated);
    const anchor = getCommentAnchors(editor.state).anchors.find((candidate) => candidate.id === id);
    if (anchor) editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "upsert", anchor: { ...anchor, resolved } }));
    if (resolved) editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "activate", id: null }));
  }

  async function deleteComment(id: number) {
    await api.deleteComment(doc.id, id);
    setThreads((current) => current.filter((thread) => thread.id !== id));
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "remove", id }));
  }

  function closeComments() {
    setCommentsOpen(false);
    if (getCommentAnchors(editor.state).draft) cancelComment();
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "activate", id: null }));
  }

  async function commitTitle() {
    const trimmed = title.trim();
    if (trimmed === savedTitle) return setTitle(savedTitle);
    const renamed = await api.renameDocument(doc.id, trimmed);
    setTitle(renamed.title);
    setSavedTitle(renamed.title);
  }

  function applyLink(href: string) {
    setLinkDialog(null);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href.trim()) return chain.unsetLink().run();
    const url = /^[a-z][a-z0-9+.-]*:/i.test(href.trim()) ? href.trim() : `https://${href.trim()}`;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href.trim(), marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else {
      chain.setLink({ href: url }).run();
    }
  }

  async function restore(revision: Revision) {
    await sync.current?.flushNow();
    await api.restoreRevision(doc.id, revision.id);
    await onReload();
  }

  function openHistory() {
    closeComments();
    setHistoryOpen(true);
  }

  function closeHistory() {
    setHistoryOpen(false);
    setPreview(null);
  }

  const actions: MenuActions = {
    newDocument: async () => navigate(`/d/${(await api.createDocument()).id}`),
    rename: () => titleInput.current?.focus(),
    download: async (format) => {
      if (format === "pdf") return window.print();
      await sync.current?.flushNow();
      window.location.assign(api.exportUrl(doc.id, format));
    },
    openHistory,
    print: () => window.print(),
    deleteDocument: async () => {
      if (!confirm(`Delete "${savedTitle}"? This can't be undone.`)) return;
      sync.current?.destroy();
      await api.deleteDocument(doc.id);
      navigate("/");
    },
    insertLink: () => handlers.current.openLinkDialog(),
    insertImage: () => imageInput.current?.click(),
    find: openFind,
    wordCount: () => setWordCountOpen(true),
    toggleOutline: () => setOutlineOpen((open) => !open),
    addComment: startComment,
  };

  const openCommentCount = threads.filter((thread) => !thread.resolved).length;

  return (
    <div className="editor-app">
      <header className="editor-header">
        <Link to="/" className="doc-logo" aria-label="Docs home" title="Docs home">
          <img src="/favicon.svg" alt="" width={27} height={36} />
        </Link>
        <div className="editor-header-main">
          <div className="title-row">
            <input
              ref={titleInput}
              className="doc-title"
              aria-label="Rename"
              value={title}
              size={Math.max(title.length, 8)}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setTitle(savedTitle);
                  editor.commands.focus();
                }
              }}
            />
            <SaveIndicator status={status} />
          </div>
          <MenuBar editor={editor} actions={actions} outlineOpen={outlineOpen} />
        </div>
        <button
          type="button"
          className={`comments-button${commentsOpen ? " is-active" : ""}`}
          aria-label={`Show all comments (${openCommentCount} open)`}
          title="Show all comments"
          aria-pressed={commentsOpen}
          onClick={() => (commentsOpen ? closeComments() : setCommentsOpen(true))}
        >
          <MessageSquareText size={20} />
          {openCommentCount > 0 && <span className="comments-count">{openCommentCount}</span>}
        </button>
        <button
          type="button"
          className="icon-button history-button"
          aria-label="Version history"
          title="Version history"
          onClick={() => (historyOpen ? closeHistory() : openHistory())}
        >
          <History size={22} />
        </button>
      </header>

      {!historyOpen && (
        <Toolbar
          editor={editor}
          zoom={zoom}
          onZoomChange={setZoom}
          onLink={() => handlers.current.openLinkDialog()}
          onImage={() => imageInput.current?.click()}
          onComment={startComment}
          onPrint={() => window.print()}
        />
      )}

      <div className="editor-workspace">
        {outlineOpen && !historyOpen && <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />}
        {find && !historyOpen && (
          <FindBar editor={editor} showReplace={find.replace} focusRequest={find.request} onClose={() => setFind(null)} />
        )}
        <div className="editor-scroll">
          <div className="page" style={{ zoom }} hidden={preview !== null}>
            <EditorContent editor={editor} />
          </div>
          {preview && (
            <div className="page page-preview" style={{ zoom }}>
              <RevisionPreview revision={preview} />
            </div>
          )}
        </div>
        {commentsOpen && !historyOpen && (
          <CommentsPanel
            editor={editor}
            threads={threads}
            onCreate={createComment}
            onCancelDraft={cancelComment}
            onSelect={selectComment}
            onReply={async (id, body) => replaceThread(await api.replyToComment(doc.id, id, body))}
            onResolve={resolveComment}
            onDelete={deleteComment}
            onClose={closeComments}
          />
        )}
        {historyOpen && (
          <HistoryPanel
            documentId={doc.id}
            selected={preview}
            onSelect={setPreview}
            onRestore={(revision) => void restore(revision)}
            onClose={closeHistory}
          />
        )}
      </div>

      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          void insertImages(editor, imageFiles(event.target.files));
          event.target.value = "";
        }}
      />

      {wordCountOpen && (
        <WordCountDialog
          editor={editor}
          onClose={() => {
            setWordCountOpen(false);
            editor.commands.focus();
          }}
        />
      )}

      {linkDialog && (
        <PromptDialog
          title={linkDialog.href ? "Edit link" : "Insert link"}
          label="Link URL"
          placeholder="Paste a link"
          initialValue={linkDialog.href}
          confirmLabel="Apply"
          onConfirm={applyLink}
          onCancel={() => {
            setLinkDialog(null);
            editor.commands.focus();
          }}
        />
      )}
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const content = {
    saved: { icon: <CloudCheck size={18} />, text: "Saved" },
    saving: { icon: <LoaderCircle size={18} className="spin" />, text: "Saving…" },
    offline: { icon: <CloudOff size={18} />, text: "Offline – changes will be saved when you reconnect" },
    error: { icon: <CloudAlert size={18} />, text: "Couldn't save your last changes. Reload the page." },
  }[status];
  return (
    <span className={`save-status save-status-${status}`} role="status" title={content.text}>
      {content.icon}
      <span>{content.text}</span>
    </span>
  );
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

async function insertImages(editor: Editor, files: File[], at?: number): Promise<void> {
  for (const file of files) {
    try {
      const { url } = await api.uploadImage(file);
      const image = { type: "image", attrs: { src: url, alt: file.name } };
      if (at === undefined) editor.chain().focus().insertContent(image).run();
      else editor.chain().focus().insertContentAt(at, image).run();
    } catch (error) {
      alert(`Couldn't upload ${file.name}: ${(error as Error).message}`);
    }
  }
}
