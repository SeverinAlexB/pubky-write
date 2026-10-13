import type { OpenedDocument, Revision, RevisionWithContent } from "@docs/shared";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { CloudAlert, CloudCheck, CloudOff, History, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, stepsTransport } from "../api.ts";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { editorExtensions } from "./extensions.ts";
import { HistoryPanel, RevisionPreview } from "./HistoryPanel.tsx";
import { MenuBar, type MenuActions } from "./MenuBar.tsx";
import { DocumentSync, type SaveStatus } from "./sync.ts";
import { Toolbar } from "./Toolbar.tsx";

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
  const sync = useRef<DocumentSync | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  // Editor callbacks are created once, so they reach the latest handlers through this ref.
  const handlers = useRef({ openLinkDialog: () => {}, insertImages: (_files: File[], _at?: number) => {} });

  const extensions = useMemo(
    () =>
      editorExtensions({
        version: doc.version,
        clientId: crypto.randomUUID(),
        onLinkShortcut: () => handlers.current.openLinkDialog(),
      }),
    [doc.version],
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
    const openHistoryShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.altKey && event.shiftKey && event.code === "KeyH") {
        event.preventDefault();
        setHistoryOpen(true);
      }
    };
    window.addEventListener("keydown", openHistoryShortcut);
    return () => window.removeEventListener("keydown", openHistoryShortcut);
  }, []);

  handlers.current.openLinkDialog = () => setLinkDialog({ href: editor.getAttributes("link").href ?? "" });
  handlers.current.insertImages = (files, at) => void insertImages(editor, files, at);

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
    openHistory: () => setHistoryOpen(true),
    print: () => window.print(),
    deleteDocument: async () => {
      if (!confirm(`Delete "${savedTitle}"? This can't be undone.`)) return;
      sync.current?.destroy();
      await api.deleteDocument(doc.id);
      navigate("/");
    },
    insertLink: () => handlers.current.openLinkDialog(),
    insertImage: () => imageInput.current?.click(),
  };

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
          <MenuBar editor={editor} actions={actions} />
        </div>
        <button
          type="button"
          className="icon-button history-button"
          aria-label="Version history"
          title="Version history"
          onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
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
          onPrint={() => window.print()}
        />
      )}

      <div className="editor-workspace">
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
