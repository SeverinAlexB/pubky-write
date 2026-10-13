import { toMarkdown, type CommentThread, type OpenedDocument, type Revision, type RevisionWithContent } from "@docs/shared";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { getVersion } from "prosemirror-collab";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, stepsTransport } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { shortcut } from "../components/shortcuts.ts";
import type { EditorActions } from "./actions.ts";
import { getCommentAnchors, updateCommentAnchors } from "./commentAnchors.ts";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { editorExtensions } from "./extensions.ts";
import { FindBar } from "./FindBar.tsx";
import { HistoryPanel, RevisionPreview } from "./HistoryPanel.tsx";
import { MenuBar } from "./MenuBar.tsx";
import { OutlinePanel } from "./OutlinePanel.tsx";
import { DocumentSync, type SaveStatus } from "./sync.ts";
import { Toolbar } from "./toolbar/Toolbar.tsx";
import type { Zoom } from "./toolbar/ZoomControl.tsx";
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
  const [zoom, setZoom] = useState<Zoom>(1);
  const fitZoom = useFitZoom();
  const [menusHidden, setMenusHidden] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ href: string } | null>(null);
  const [imageUrlDialog, setImageUrlDialog] = useState(false);
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
      const pressed = `${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.code}`;
      const action = {
        "Alt+Shift+KeyH": () => handlers.current.openHistory(),
        KeyF: () => openFind(false),
        "Shift+KeyH": () => openFind(true),
        "Shift+KeyC": () => setWordCountOpen(true),
        "Shift+KeyF": () => setMenusHidden((hidden) => !hidden),
        KeyO: () => navigate("/"),
      }[pressed];
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

  function insertImageFromUrl(url: string) {
    setImageUrlDialog(false);
    const src = url.trim();
    if (!/^https?:\/\//i.test(src)) return editor.commands.focus();
    editor.chain().focus().insertContent({ type: "image", attrs: { src } }).run();
  }

  // Menu and toolbar actions. Optional actions of features not built yet are left out (see actions.ts).
  const actions: EditorActions = {
    newDocument: async () => navigate(`/d/${(await api.createDocument()).id}`),
    openDocumentList: () => navigate("/"),
    makeCopy: async () => {
      await sync.current?.flushNow();
      navigate(`/d/${(await api.copyDocument(doc.id)).id}`);
    },
    download: async (format) => {
      if (format === "pdf") return window.print();
      if (format === "txt") return downloadText(`${savedTitle}.txt`, editor.getText({ blockSeparator: "\n" }));
      await sync.current?.flushNow();
      window.location.assign(api.exportUrl(doc.id, format));
    },
    rename: () => titleInput.current?.focus(),
    moveToBin: async () => {
      if (!confirm(`Move "${savedTitle}" to the bin? This can't be undone.`)) return;
      sync.current?.destroy();
      await api.deleteDocument(doc.id);
      navigate("/");
    },
    openVersionHistory: openHistory,
    print: () => window.print(),
    cut: () => editor.commands.focus() && document.execCommand("cut"),
    copy: () => editor.commands.focus() && document.execCommand("copy"),
    copyAsMarkdown: () => {
      const { from, to } = editor.state.selection;
      void navigator.clipboard.writeText(toMarkdown(editor.state.doc.cut(from, to)).trimEnd());
    },
    paste: () => void pasteFromClipboard(editor, true),
    pasteWithoutFormatting: () => void pasteFromClipboard(editor, false),
    findAndReplace: () => openFind(true),
    showAllComments: () => setCommentsOpen(true),
    toggleOutline: () => setOutlineOpen((open) => !open),
    fullScreen: () => void document.documentElement.requestFullscreen?.(),
    uploadImage: () => imageInput.current?.click(),
    insertImageByUrl: () => setImageUrlDialog(true),
    insertLink: () => handlers.current.openLinkDialog(),
    addComment: startComment,
    wordCount: () => setWordCountOpen(true),
  };

  const openCommentCount = threads.filter((thread) => !thread.resolved).length;
  const effectiveZoom = zoom === "fit" ? fitZoom.value : zoom;

  return (
    <div className="editor-app">
      {!menusHidden && (
        <header className="editor-header">
          <Link to="/" className="doc-logo" aria-label="Docs home" data-tooltip="Docs home">
            <img src="/favicon.svg" alt="" width={24} height={32} />
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
            <MenuBar
              editor={editor}
              actions={actions}
              view={{ outlineOpen, printLayout: true, rulerVisible: false, nonPrintingCharacters: false }}
            />
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`header-action${historyOpen ? " is-active" : ""}`}
              aria-label="Version history"
              data-tooltip={`Version history (${shortcut("⌘+Option+Shift+H")})`}
              aria-pressed={historyOpen}
              onClick={() => (historyOpen ? closeHistory() : openHistory())}
            >
              <Icon name="history" size={24} />
            </button>
            <button
              type="button"
              className={`header-action${commentsOpen ? " is-active" : ""}`}
              aria-label={`Show all comments (${openCommentCount} open)`}
              data-tooltip="Show all comments"
              aria-pressed={commentsOpen}
              onClick={() => (commentsOpen ? closeComments() : setCommentsOpen(true))}
            >
              <Icon name="comment" size={24} />
            </button>
          </div>
        </header>
      )}

      {!historyOpen && (
        <Toolbar
          editor={editor}
          actions={actions}
          zoom={zoom}
          onZoomChange={setZoom}
          menusHidden={menusHidden}
          onToggleMenus={() => setMenusHidden((hidden) => !hidden)}
        />
      )}
      {/* Reserved for the horizontal ruler. */}
      <div className="ruler-band" aria-hidden />

      <div className="editor-workspace">
        {outlineOpen && !historyOpen && <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />}
        {find && !historyOpen && (
          <FindBar editor={editor} showReplace={find.replace} focusRequest={find.request} onClose={() => setFind(null)} />
        )}
        <div className="editor-scroll" ref={fitZoom.ref}>
          <div className="page" style={{ zoom: effectiveZoom }} hidden={preview !== null}>
            <EditorContent editor={editor} />
          </div>
          {preview && (
            <div className="page page-preview" style={{ zoom: effectiveZoom }}>
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

      {imageUrlDialog && (
        <PromptDialog
          title="Insert image"
          label="Image URL"
          placeholder="Paste the URL of an image"
          confirmLabel="Insert image"
          onConfirm={insertImageFromUrl}
          onCancel={() => {
            setImageUrlDialog(false);
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
    saved: { icon: <Icon name="cloud_done" size={20} />, text: "Saved" },
    saving: { icon: <Icon name="sync" size={20} className="spin" />, text: "Saving…" },
    offline: { icon: <Icon name="cloud_off" size={20} />, text: "Offline – changes will be saved when you reconnect" },
    error: { icon: <Icon name="error" size={20} />, text: "Couldn't save your last changes. Reload the page." },
  }[status];
  return (
    <span className={`save-status save-status-${status}`} role="status" title={content.text}>
      {content.icon}
      <span>{content.text}</span>
    </span>
  );
}

/** Width of the page including its border, before zooming. */
const PAGE_WIDTH = 818;
/** Space kept on each side of the page when zoomed to fit. */
const FIT_MARGIN = 16;

/** The zoom at which the page is as wide as the editor area. */
function useFitZoom() {
  const [value, setValue] = useState(1);
  const [element, ref] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setValue((element.clientWidth - 2 * FIT_MARGIN) / PAGE_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { value, ref };
}

/** Edit > Paste and Paste without formatting, which have to read the clipboard themselves. */
async function pasteFromClipboard(editor: Editor, withFormatting: boolean): Promise<void> {
  try {
    if (withFormatting) {
      for (const item of await navigator.clipboard.read()) {
        if (!item.types.includes("text/html")) continue;
        editor.view.pasteHTML(await (await item.getType("text/html")).text());
        return;
      }
    }
    editor.view.pasteText(await navigator.clipboard.readText());
  } catch {
    alert(`The browser didn't allow reading the clipboard. Use ${shortcut(withFormatting ? "⌘V" : "⌘+Shift+V")} instead.`);
  }
}

function downloadText(fileName: string, text: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
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
