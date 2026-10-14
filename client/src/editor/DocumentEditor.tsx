import {
  acceptedDocument,
  commentQuote,
  lengthUnit,
  pageGeometry,
  pageSetupKeys,
  pageSetupOf,
  type CommentThread,
  type OpenedDocument,
  type PageSetup,
  type Revision,
} from "@docs/shared";
import { getText, getTextSerializersFromSchema } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { closeHistory as startUndoStep } from "@tiptap/pm/history";
import { getVersion } from "prosemirror-collab";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";
import { api, ApiError } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { lazyComponent } from "../components/lazyComponent.tsx";
import { focusToolbar } from "../components/useRovingToolbar.ts";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { isMac, shortcut } from "../components/shortcuts.ts";
import type { EditorActions } from "./actions.ts";
import { capitaliseSelection } from "./capitalisation.ts";
import { getCommentAnchors, updateCommentAnchors } from "./commentAnchors.ts";
import { AllCommentsPanel } from "./AllCommentsPanel.tsx";
import { COMMENT_MARGIN_WIDTH, CommentMargin, useCommentAnchors } from "./CommentMargin.tsx";
import { CommentPill } from "./CommentPill.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { ImagePill } from "./ImagePill.tsx";
import { editorExtensions } from "./extensions.ts";
import { FindBar } from "./FindBar.tsx";
import { paragraphSpacingAt, type ParagraphSpacingState } from "./formatMenus.ts";
import { MenuBar } from "./MenuBar.tsx";
import { storedMode, storeMode } from "./modes.tsx";
import {
  addPageNumbers,
  currentPageNumberOptions,
  insertFootnote,
  insertTableOfContents,
  type PageNumberOptions,
  type RegionTarget,
} from "./pageElementCommands.ts";
import { PageElements } from "./PageElements.tsx";
import { TocPill } from "./TocPill.tsx";
import { OutlinePanel, OutlineToggle } from "./OutlinePanel.tsx";
import { useFitZoom, usePrintPageRule } from "./pageView.ts";
import { cursorPage, resetPagination } from "./pagination.ts";
import { HorizontalRuler, VerticalRuler } from "./Rulers.tsx";
import { stepsTransport } from "./stepsTransport.ts";
import {
  getSuggesting,
  resolveSuggestions,
  setSuggesting,
  type EditorMode,
  type SuggestionView,
} from "./suggesting.ts";
import type { ImportNotice } from "../home/HomePage.tsx";
import { DocumentSync, type SaveStatus } from "./sync.ts";
import { ColorPalette } from "./toolbar/ColorPicker.tsx";
import { Toolbar } from "./toolbar/Toolbar.tsx";
import type { Zoom } from "./toolbar/ZoomControl.tsx";
import { LiveWordCount, useLiveCountSetting } from "./LiveWordCount.tsx";

// Parts used now and then are in their own chunks, fetched once the editor is idle (or when
// first opened, if that is sooner), so they are not in the way of opening the document.
const HistoryMode = lazyComponent(() => import("./HistoryMode.tsx").then((module) => module.HistoryMode));
const FindReplaceDialog = lazyComponent(() => import("./FindReplaceDialog.tsx").then((module) => module.FindReplaceDialog));
const WordCountDialog = lazyComponent(() => import("./WordCountDialog.tsx").then((module) => module.WordCountDialog));
const PageSetupDialog = lazyComponent(() => import("./PageSetupDialog.tsx").then((module) => module.PageSetupDialog));
const CustomSpacingDialog = lazyComponent(() => import("./CustomSpacingDialog.tsx").then((module) => module.CustomSpacingDialog));
const TableOptionsPanel = lazyComponent(() => import("./OptionsPanels.tsx").then((module) => module.TableOptionsPanel));
const ImageOptionsPanel = lazyComponent(() => import("./OptionsPanels.tsx").then((module) => module.ImageOptionsPanel));
const PageNumbersDialog = lazyComponent(() => import("./PageNumbersDialog.tsx").then((module) => module.PageNumbersDialog));
const ReviewSuggestions = lazyComponent(() => import("./ReviewSuggestions.tsx").then((module) => module.ReviewSuggestions));
const SpecialCharactersDialog = lazyComponent(() =>
  import("./characters/SpecialCharactersDialog.tsx").then((module) => module.SpecialCharactersDialog),
);
const onDemand = [
  HistoryMode,
  FindReplaceDialog,
  WordCountDialog,
  PageSetupDialog,
  CustomSpacingDialog,
  ColorPalette,
  TableOptionsPanel,
  ImageOptionsPanel,
  PageNumbersDialog,
  SpecialCharactersDialog,
  ReviewSuggestions,
];

/** The second key of a header (H), footer (F) or review (U) chord must follow Ctrl+⌘O within this time. */
const CHORD_TIMEOUT_MS = 2000;

const OUTLINE_SETTING = "docs.outlineOpen";
const RULER_SETTING = "docs.rulerVisible";
const PRINT_LAYOUT_SETTING = "docs.printLayout";
const COMMENTS_HIDDEN_SETTING = "docs.commentsHidden";

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
  const [rulerVisible, setRulerVisible] = useState(() => localStorage.getItem(RULER_SETTING) !== "false");
  const [printLayout, setPrintLayout] = useState(() => localStorage.getItem(PRINT_LAYOUT_SETTING) !== "false");
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [stack, setStack] = useState<HTMLDivElement | null>(null);
  const [menusHidden, setMenusHidden] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ href: string } | null>(null);
  const [imageUrlDialog, setImageUrlDialog] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [namingVersion, setNamingVersion] = useState(false);
  // The find bar (⌘F) or the Find and replace dialog (⌘⇧H); `request` counts ⌘F presses.
  const [find, setFind] = useState<{ mode: "bar" | "dialog"; request: number } | null>(null);
  const [wordCountOpen, setWordCountOpen] = useState(false);
  const [liveCount, setLiveCount] = useLiveCountSetting();
  const [customSpacing, setCustomSpacing] = useState<ParagraphSpacingState | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(() => localStorage.getItem(OUTLINE_SETTING) === "true");
  const [threads, setThreads] = useState<CommentThread[]>(doc.comments);
  const [allCommentsOpen, setAllCommentsOpen] = useState(false);
  // Table options or Image options, in place of All comments.
  const [optionsPanel, setOptionsPanel] = useState<"table" | "image" | null>(null);
  const [commentsHidden, setCommentsHidden] = useState(() => localStorage.getItem(COMMENTS_HIDDEN_SETTING) === "true");
  // The header, footer or footnote being edited, and its editor (which the toolbar then acts on).
  const [regionTarget, setRegionTarget] = useState<RegionTarget | null>(null);
  const [regionEditor, setRegionEditor] = useState<Editor | null>(null);
  const [pageNumbersDialog, setPageNumbersDialog] = useState<Required<PageNumberOptions> | null>(null);
  // Insert > Symbols > Special characters (or Emoji), opened on that category.
  const [specialCharacters, setSpecialCharacters] = useState<{ category: string } | null>(null);
  // Editing, Suggesting or Viewing, remembered per document.
  const [mode, setMode] = useState<EditorMode>(() => storedMode(doc.id));
  // Tools > Review suggested edits, and its preview of accepting or rejecting all suggestions.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [suggestionView, setSuggestionView] = useState<SuggestionView>("suggestions");
  const [suggestionReplies, setSuggestionReplies] = useState(doc.suggestionReplies ?? {});
  const location = useLocation();
  // A notice from the document list, such as content an import left out.
  const [notice, setNotice] = useState<string | null>(
    () => (location.state as Partial<ImportNotice> | null)?.importNotice ?? null,
  );
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const sync = useRef<DocumentSync | null>(null);
  const scrollBeforeHistory = useRef(0);
  const titleInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  // Editor callbacks are created once, so they reach the latest handlers through this ref.
  const handlers = useRef({
    openLinkDialog: () => {},
    insertImages: (_files: File[], _at?: number) => {},
    startComment: () => {},
    selectComment: (_id: number) => {},
    activateComment: (_id: number | null) => {},
    openHistory: () => {},
    toggleCommentsHidden: () => {},
    insertFootnote: () => {},
    editRegion: (_kind: "header" | "footer") => {},
    activateSuggestion: (_id: string | null) => {},
    changeMode: (_mode: EditorMode) => {},
    toggleSuggesting: () => {},
    openReview: () => {},
    historyOpen: false,
  });

  const extensions = useMemo(
    () =>
      editorExtensions({
        version: doc.version,
        clientId: crypto.randomUUID(),
        onLinkShortcut: () => handlers.current.openLinkDialog(),
        onCommentShortcut: () => handlers.current.startComment(),
        onFootnoteShortcut: () => handlers.current.insertFootnote(),
        comments: doc.comments.map(({ id, from, to, resolved }) => ({ id, from, to, resolved })),
        commentsHidden,
        onCommentClick: (id) => handlers.current.activateComment(id),
        mode: storedMode(doc.id),
        onSuggestionClick: (id) => handlers.current.activateSuggestion(id),
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

  useEffect(() => {
    localStorage.setItem(RULER_SETTING, String(rulerVisible));
  }, [rulerVisible]);

  useEffect(() => {
    localStorage.setItem(COMMENTS_HIDDEN_SETTING, String(commentsHidden));
    if (getCommentAnchors(editor.state).hidden !== commentsHidden) {
      editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "hide", hidden: commentsHidden }));
    }
  }, [editor, commentsHidden]);

  useEffect(() => {
    if (!notice) return;
    // Longer messages stay longer.
    const timer = setTimeout(() => setNotice(null), notice.length > 60 ? 10000 : 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Show the notice once: not again after a reload.
  useEffect(() => {
    if (location.state) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, []);

  // A link to a comment (?comment=<id>) opens the document with that thread active.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("comment"));
    if (!doc.comments.some((thread) => thread.id === id)) return;
    // After the first layout, so the text it scrolls to is on its page.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => handlers.current.selectComment(id)));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    localStorage.setItem(PRINT_LAYOUT_SETTING, String(printLayout));
  }, [printLayout]);

  useEffect(() => {
    const idle = requestIdleCallback(() => onDemand.forEach((component) => void component.preload()));
    return () => cancelIdleCallback(idle);
  }, []);

  const pageSetup = useEditorState({
    editor,
    selector: ({ editor: current }) => pageSetupOf(current.state.doc),
    equalityFn: (a, b) => b !== null && pageSetupKeys.every((key) => a[key] === b[key]),
  });
  const geometry = useMemo(() => pageGeometry(pageSetup), [pageSetup]);
  const unit = useMemo(() => lengthUnit(navigator.language), []);
  // Version history mode sets its own, for the version it shows.
  usePrintPageRule(pageSetup, !historyOpen, printLayout);

  // Shortcuts that work anywhere on the page, overriding the browser's own find.
  useEffect(() => {
    let chordStarted = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+⌘O then Ctrl+⌘H (header) or Ctrl+⌘F (footer); Ctrl+Alt elsewhere.
      const chordModifiers = isMac
        ? event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey
        : event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;
      if (chordModifiers && !handlers.current.historyOpen) {
        if (event.code === "KeyO") {
          event.preventDefault();
          chordStarted = Date.now();
          return;
        }
        if ((event.code === "KeyH" || event.code === "KeyF") && Date.now() - chordStarted < CHORD_TIMEOUT_MS) {
          event.preventDefault();
          chordStarted = 0;
          handlers.current.editRegion(event.code === "KeyH" ? "header" : "footer");
          return;
        }
        if (event.code === "KeyU" && Date.now() - chordStarted < CHORD_TIMEOUT_MS) {
          event.preventDefault();
          chordStarted = 0;
          handlers.current.openReview();
          return;
        }
      }
      // Alt+F10 moves to the toolbar, as in other editors (the document uses Tab for indentation).
      if (event.altKey && event.key === "F10" && !handlers.current.historyOpen) {
        event.preventDefault();
        focusToolbar(document.querySelector<HTMLElement>('.editor-app [role="toolbar"]'));
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const pressed = `${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.code}`;
      // Version history mode is read-only: the editor's shortcuts do nothing there.
      if (handlers.current.historyOpen) {
        if (pressed === "Alt+Shift+KeyH") event.preventDefault();
        return;
      }
      const action = {
        "Alt+Shift+KeyH": () => handlers.current.openHistory(),
        KeyF: () => openFind("bar"),
        "Shift+KeyH": () => openFind("dialog"),
        "Shift+KeyC": () => setWordCountOpen(true),
        "Shift+KeyF": () => setMenusHidden((hidden) => !hidden),
        "Alt+Shift+KeyA": () => setAllCommentsOpen(true),
        "Alt+Shift+KeyJ": () => handlers.current.toggleCommentsHidden(),
        "Alt+Shift+KeyX": () => handlers.current.toggleSuggesting(),
        "Alt+Shift+KeyZ": () => handlers.current.changeMode("editing"),
        "Alt+Shift+KeyC": () => handlers.current.changeMode("viewing"),
        KeyO: () => navigate("/"),
      }[pressed];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openFind(mode: "bar" | "dialog") {
    // ⌘F does nothing while the dialog is open: the dialog has its own Find field.
    setFind((previous) => (previous?.mode === "dialog" ? previous : { mode, request: (previous?.request ?? 0) + 1 }));
  }

  function closeFind() {
    setFind(null);
    editor.commands.focus();
  }

  handlers.current.openLinkDialog = () => setLinkDialog({ href: editor.getAttributes("link").href ?? "" });
  handlers.current.insertImages = (files, at) => void insertImages(editor, files, at);
  handlers.current.startComment = startComment;
  handlers.current.openHistory = openHistory;
  handlers.current.selectComment = selectComment;
  handlers.current.activateComment = activateComment;
  handlers.current.toggleCommentsHidden = () => setCommentsHidden((hidden) => !hidden);
  handlers.current.historyOpen = historyOpen;
  handlers.current.insertFootnote = startFootnote;
  handlers.current.editRegion = editRegion;
  handlers.current.activateSuggestion = activateSuggestion;
  handlers.current.changeMode = changeMode;
  handlers.current.toggleSuggesting = () => changeMode(mode === "suggesting" ? "editing" : "suggesting");
  handlers.current.openReview = openReview;

  // Viewing mode shows the document as if every suggestion were accepted; the review card can preview either.
  const display: SuggestionView = mode === "viewing" ? "accepted" : suggestionView;
  const readOnly = display !== "suggestions";

  useEffect(() => {
    storeMode(doc.id, mode);
    const current = getSuggesting(editor.state);
    if (current.mode !== mode || current.readOnly !== readOnly) {
      editor.view.dispatch(setSuggesting(editor.state.tr, { mode, readOnly, group: null }));
    }
    if (editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, mode, readOnly]);

  function changeMode(next: EditorMode) {
    if (historyOpen) return;
    if (next === "suggesting" && mode !== "suggesting") setNotice("You're suggesting");
    if (next === "viewing") {
      setRegionTarget(null);
      setReviewOpen(false);
      setSuggestionView("suggestions");
      closeComments();
      activateSuggestion(null);
    }
    setMode(next);
    if (next !== "viewing") requestAnimationFrame(() => editor.commands.focus(undefined, { scrollIntoView: false }));
  }

  /** Tools > Review suggested edits: the card, with the first suggestion selected. */
  function openReview() {
    if (historyOpen || mode === "viewing") return;
    setReviewOpen(true);
    const { suggestions, activeId } = getSuggesting(editor.state);
    if (!activeId && suggestions[0]) selectSuggestion(suggestions[0].id);
  }

  function closeReview() {
    setReviewOpen(false);
    setSuggestionView("suggestions");
    editor.commands.focus(undefined, { scrollIntoView: false });
  }

  /** A click on suggested text or a card (its id), or elsewhere (null). */
  function activateSuggestion(id: string | null) {
    if (getSuggesting(editor.state).activeId === id) return;
    if (id !== null && getCommentAnchors(editor.state).activeId !== null) {
      editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "activate", id: null }));
    }
    editor.view.dispatch(setSuggesting(editor.state.tr, { activeId: id }));
  }

  /** Activates a suggestion and scrolls the document to it (review card). */
  function selectSuggestion(id: string) {
    activateSuggestion(id);
    const suggestion = getSuggesting(editor.state).suggestions.find((candidate) => candidate.id === id);
    if (!suggestion) return;
    const { node } = editor.view.domAtPos(Math.min(suggestion.from + 1, editor.state.doc.content.size));
    const element = node instanceof HTMLElement ? node : node.parentElement;
    element?.scrollIntoView({ block: "center" });
  }

  function resolveSuggestion(action: "accept" | "reject", id: string | null) {
    const transaction = resolveSuggestions(editor.state, action, id === null ? null : [id]);
    if (transaction) editor.view.dispatch(transaction);
  }

  async function replyToSuggestion(id: string, body: string) {
    const replies = await api.replyToSuggestion(doc.id, id, body);
    setSuggestionReplies((current) => ({ ...current, [id]: replies }));
  }

  async function deleteSuggestionReply(id: string, replyId: number) {
    const replies = await api.deleteSuggestionReply(doc.id, id, replyId);
    setSuggestionReplies((current) => ({ ...current, [id]: replies }));
  }

  /** Insert > Header or Footer: edits the one on the cursor's page. */
  function editRegion(kind: "header" | "footer") {
    if (!printLayout) setPrintLayout(true);
    setRegionTarget({ kind, page: cursorPage(editor.view).page - 1 });
  }

  /** Insert > Footnote (⌘+Option+F): a reference at the cursor, then the cursor in the footnote's text. */
  function startFootnote() {
    if (regionTarget || historyOpen || readOnly) return;
    const index = insertFootnote(editor);
    if (index !== null) setRegionTarget({ kind: "footnote", index });
  }

  function applyPageNumbers(options: PageNumberOptions) {
    setPageNumbersDialog(null);
    if (!printLayout) setPrintLayout(true);
    editor.view.dispatch(addPageNumbers(editor.state, options));
    if (!regionEditor) editor.commands.focus();
    else regionEditor.commands.focus();
  }

  function startComment() {
    const { from, to, empty } = editor.state.selection;
    if (empty || historyOpen || readOnly || !commentQuote(editor.state.doc, from, to)) return;
    setCommentsHidden(false);
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "draft", anchor: { from, to } }));
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

  /** Activates a thread in the margin and scrolls the document to its text (All comments, links). */
  function selectComment(id: number) {
    setCommentsHidden(false);
    if (getCommentAnchors(editor.state).hidden) {
      editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "hide", hidden: false }));
    }
    activateComment(id);
    const anchor = getCommentAnchors(editor.state).anchors.find((candidate) => candidate.id === id);
    if (!anchor) return;
    const { node } = editor.view.domAtPos(anchor.from);
    const element = node instanceof HTMLElement ? node : node.parentElement;
    element?.scrollIntoView({ block: "center" });
  }

  /** A click on commented text, on a card or elsewhere (null). */
  function activateComment(id: number | null) {
    if (id !== null && getSuggesting(editor.state).activeId !== null) {
      editor.view.dispatch(setSuggesting(editor.state.tr, { activeId: null }));
    }
    if (getCommentAnchors(editor.state).activeId === id) return;
    editor.view.dispatch(updateCommentAnchors(editor.state.tr, { type: "activate", id }));
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

  async function copyCommentLink(id: number) {
    const url = new URL(`/d/${doc.id}`, window.location.origin);
    url.searchParams.set("comment", String(id));
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice("Link copied to clipboard");
    } catch {
      setNotice(`Couldn't copy the link: ${url.href}`);
    }
  }

  /** Leaves comments for version history: no draft, no active thread, no All comments panel. */
  function closeComments() {
    setAllCommentsOpen(false);
    if (getCommentAnchors(editor.state).draft) cancelComment();
    activateComment(null);
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

  /** Restoring reloads the document, which returns to editing with the restored content. */
  async function restore(revision: Revision) {
    await sync.current?.flushNow();
    await api.restoreRevision(doc.id, revision.id);
    await onReload();
  }

  function openHistory() {
    setRegionTarget(null);
    setReviewOpen(false);
    setSuggestionView("suggestions");
    closeComments();
    setFind(null);
    editor.commands.blur();
    scrollBeforeHistory.current = fitZoom.element?.scrollTop ?? 0;
    setHistoryOpen(true);
  }

  function closeHistory() {
    flushSync(() => setHistoryOpen(false));
    editor.commands.focus(undefined, { scrollIntoView: false });
    // After the pages are laid out again, back where editing left off.
    requestAnimationFrame(() => requestAnimationFrame(() => fitZoom.element?.scrollTo({ top: scrollBeforeHistory.current })));
  }

  /** The versions, newest first, after saving pending edits so the newest is what the editor shows. */
  async function loadRevisions() {
    await sync.current?.flushNow();
    return api.listRevisions(doc.id);
  }

  async function nameCurrentVersion(name: string) {
    setNamingVersion(false);
    editor.commands.focus();
    await sync.current?.flushNow();
    await api.nameCurrentVersion(doc.id, name);
    setNotice(name.trim() ? `Version named "${name.trim()}"` : "Version name removed");
  }

  function insertImageFromUrl(url: string) {
    setImageUrlDialog(false);
    const src = url.trim();
    if (!/^https?:\/\//i.test(src)) return editor.commands.focus();
    editor
      .chain()
      .focus()
      .command(({ tr }) => Boolean(startUndoStep(tr)))
      .insertContent({ type: "image", attrs: { src } })
      .run();
  }

  function applyPageSetup(setup: PageSetup) {
    setPageSetupOpen(false);
    // OK on the Pages tab leaves pageless format.
    if (!printLayout) setPrintLayout(true);
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        for (const key of pageSetupKeys) if (tr.doc.attrs[key] !== setup[key]) tr.setDocAttribute(key, setup[key]);
        return true;
      })
      .run();
  }

  // The toolbar and the Format menu act on the header, footer or footnote being edited.
  const activeEditor = regionEditor && !regionEditor.isDestroyed ? regionEditor : editor;

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
      if (format === "txt") {
        // As if every suggestion were accepted, like the Markdown export.
        const text = getText(acceptedDocument(editor.state.doc), {
          blockSeparator: "\n",
          textSerializers: getTextSerializersFromSchema(editor.schema),
        });
        return downloadText(`${savedTitle}.txt`, text);
      }
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
    nameCurrentVersion: () => setNamingVersion(true),
    pageSetup: () => setPageSetupOpen(true),
    print: () => window.print(),
    cut: () => editor.commands.focus() && document.execCommand("cut"),
    copy: () => editor.commands.focus() && document.execCommand("copy"),
    copyAsMarkdown: async () => {
      const { from, to } = editor.state.selection;
      const { toMarkdown } = await import("@docs/shared/markdown");
      await navigator.clipboard.writeText(toMarkdown(editor.state.doc.cut(from, to)).trimEnd());
    },
    paste: () => void pasteFromClipboard(editor, true),
    pasteWithoutFormatting: () => void pasteFromClipboard(editor, false),
    findAndReplace: () => openFind("dialog"),
    setMode: changeMode,
    hideComments: () => {
      if (!commentsHidden && getCommentAnchors(editor.state).draft) cancelComment();
      setCommentsHidden((hidden) => !hidden);
    },
    showAllComments: () => setAllCommentsOpen(true),
    toggleOutline: () => setOutlineOpen((open) => !open),
    togglePrintLayout: () => setPrintLayout((on) => !on),
    toggleRuler: () => setRulerVisible((visible) => !visible),
    fullScreen: () => void document.documentElement.requestFullscreen?.(),
    uploadImage: () => imageInput.current?.click(),
    insertImageByUrl: () => setImageUrlDialog(true),
    insertLink: () => handlers.current.openLinkDialog(),
    insertSpecialCharacter: () => setSpecialCharacters({ category: "Symbol" }),
    insertEmoji: () => setSpecialCharacters({ category: "Emoji" }),
    insertPageBreak: () => editor.chain().focus().insertPageBreak().run(),
    insertTableOfContents: (style) => {
      setRegionTarget(null);
      insertTableOfContents(editor, style);
    },
    insertHeader: () => editRegion("header"),
    insertFooter: () => editRegion("footer"),
    insertPageNumbers: applyPageNumbers,
    pageNumberOptions: () => setPageNumbersDialog(currentPageNumberOptions(editor.state.doc)),
    insertPageCount: () => activeEditor.chain().focus().insertPageField("count").run(),
    insertFootnote: startFootnote,
    addComment: startComment,
    toggleSuperscript: () => activeEditor.chain().focus().toggleSuperscript().run(),
    toggleSubscript: () => activeEditor.chain().focus().toggleSubscript().run(),
    setCapitalisation: (capitalisation) => {
      const transaction = capitaliseSelection(activeEditor.state, capitalisation);
      if (transaction) activeEditor.view.dispatch(transaction);
      activeEditor.commands.focus();
    },
    toggleSpaceBefore: () => activeEditor.chain().focus().toggleParagraphSpace("spaceBefore").run(),
    toggleSpaceAfter: () => activeEditor.chain().focus().toggleParagraphSpace("spaceAfter").run(),
    customSpacing: () => setCustomSpacing(paragraphSpacingAt(activeEditor)),
    toggleChecklist: () => activeEditor.chain().focus().toggleTaskList().run(),
    applyListPreset: (kind, preset) => activeEditor.chain().focus().applyListPreset(kind, preset).run(),
    setPageOrientation: () => setPageSetupOpen(true),
    switchToPageless: () => setPrintLayout(false),
    wordCount: () => setWordCountOpen(true),
    reviewSuggestedEdits: openReview,
    tableOptions: () => openOptionsPanel("table"),
    imageOptions: () => openOptionsPanel("image"),
  };

  function openOptionsPanel(panel: "table" | "image") {
    setAllCommentsOpen(false);
    setOptionsPanel(panel);
  }

  async function copyLink(href: string) {
    try {
      await navigator.clipboard.writeText(href);
      setNotice("Link copied to clipboard");
    } catch {
      setNotice(`Couldn't copy the link: ${href}`);
    }
  }

  const openCommentCount = threads.filter((thread) => !thread.resolved).length;
  const commentState = useCommentAnchors(editor);
  const activeThread = threads.find((thread) => thread.id === commentState.activeId);
  const suggestionState = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { suggestions, activeId } = getSuggesting(current.state);
      return { suggestions, activeId };
    },
    equalityFn: (a, b) => b !== null && a.suggestions === b.suggestions && a.activeId === b.activeId,
  });
  // Suggestion cards are shown with the suggestions, not in the previews.
  const marginSuggestions = display === "suggestions" ? suggestionState.suggestions : [];
  // The margin is there while there is something to show in it; Viewing mode shows only the document.
  const marginShown =
    !commentsHidden &&
    !historyOpen &&
    mode !== "viewing" &&
    (openCommentCount > 0 || commentState.draft !== null || activeThread !== undefined || marginSuggestions.length > 0);
  const marginWidth = marginShown ? COMMENT_MARGIN_WIDTH : 0;
  const fitZoom = useFitZoom(geometry.width, marginWidth);
  const effectiveZoom = zoom === "fit" ? fitZoom.value : zoom;

  // Zoom, the print layout setting and showing the page again all change the layout from outside the editor.
  useEffect(() => {
    if (stack && !editor.isDestroyed) resetPagination(editor.view, printLayout);
  }, [editor, stack, effectiveZoom, printLayout, historyOpen, display]);

  return (
    <>
      {/* Hidden, not unmounted, in version history mode, so unsaved state and undo history survive. */}
      <div className="editor-app" hidden={historyOpen}>
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
                editor={activeEditor}
                actions={actions}
                view={{ outlineOpen, printLayout, rulerVisible, nonPrintingCharacters: false, commentsHidden, mode, readOnly }}
              />
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="header-action"
                aria-label="Version history"
                data-tooltip={`Version history (${shortcut("⌘+Option+Shift+H")})`}
                onClick={openHistory}
              >
                <Icon name="history" size={24} />
              </button>
              <button
                type="button"
                className={`header-action${allCommentsOpen ? " is-active" : ""}`}
                aria-label={`Show all comments (${openCommentCount} open)`}
                data-tooltip={`Show all comments (${shortcut("⌘+Option+Shift+A")})`}
                aria-pressed={allCommentsOpen}
                onClick={() => setAllCommentsOpen((open) => !open)}
              >
                <Icon name="comment" size={24} />
              </button>
            </div>
          </header>
        )}

        {!historyOpen && (
          <Toolbar
            editor={activeEditor}
            actions={actions}
            zoom={zoom}
            onZoomChange={setZoom}
            menusHidden={menusHidden}
            onToggleMenus={() => setMenusHidden((hidden) => !hidden)}
            mode={mode}
            onModeChange={changeMode}
            readOnly={readOnly}
          />
        )}
        {rulerVisible ? (
          <HorizontalRuler
            editor={editor}
            paragraphEditor={activeEditor}
            stack={stack}
            geometry={geometry}
            zoom={effectiveZoom}
            unit={unit}
            onToggleRuler={() => setRulerVisible((visible) => !visible)}
          />
        ) : (
          <div className="ruler-gap" />
        )}

        <div className="editor-workspace">
          {rulerVisible && printLayout && <VerticalRuler stack={stack} geometry={geometry} zoom={effectiveZoom} unit={unit} />}
          {outlineOpen && !historyOpen && (
            <OutlinePanel editor={editor} openComments={openCommentCount} onClose={() => setOutlineOpen(false)} />
          )}
          {/* The editor area: the find bar and the live word count float over it, left of the comment margin. */}
          <div
            className={`editor-area${marginShown ? " has-comment-margin" : ""}`}
            style={
              {
                "--column-width": `${geometry.width * effectiveZoom + marginWidth}px`,
                "--comment-margin-width": `${marginWidth}px`,
              } as CSSProperties
            }
          >
            {!outlineOpen && !historyOpen && <OutlineToggle onOpen={() => setOutlineOpen(true)} />}
            {find?.mode === "bar" && !historyOpen && (
              <FindBar
                editor={editor}
                focusRequest={find.request}
                onMoreOptions={() => setFind({ mode: "dialog", request: find.request })}
                onClose={closeFind}
              />
            )}
            {reviewOpen && !historyOpen && find?.mode !== "bar" && (
              <ReviewSuggestions
                suggestions={suggestionState.suggestions}
                activeId={suggestionState.activeId}
                view={suggestionView}
                onViewChange={setSuggestionView}
                onSelect={selectSuggestion}
                onResolve={resolveSuggestion}
                onClose={closeReview}
              />
            )}
            {liveCount.visible && !historyOpen && <LiveWordCount editor={editor} setting={liveCount} onChange={setLiveCount} />}
            {/* While read-only the document cannot take focus, so the scroll area does, for scrolling with the keyboard. */}
            <div className="editor-scroll" ref={fitZoom.ref} tabIndex={readOnly ? 0 : undefined}>
              {/* The pages and, right of them, the comment margin, centred together. */}
              <div ref={setColumn} className="page-column">
                <div
                  ref={setStack}
                  className={`page-stack${printLayout ? "" : " is-pageless"} suggestions-${display}${mode === "viewing" ? " is-viewing" : ""}`}
                  style={{ zoom: effectiveZoom }}
                >
                  {/* One sheet per page, drawn by the pagination plugin. */}
                  <div className="page-sheets" aria-hidden />
                  <EditorContent editor={editor} />
                  <PageElements
                    editor={editor}
                    target={historyOpen ? null : regionTarget}
                    onTargetChange={(target) => {
                      // Headers, footers and footnotes cannot be edited while the document is read-only.
                      if (!target || !readOnly) setRegionTarget(target);
                    }}
                    onRegionEditor={setRegionEditor}
                    onPageNumbers={(position) => setPageNumbersDialog(currentPageNumberOptions(editor.state.doc, position))}
                  />
                </div>
                {marginShown && (
                  <CommentMargin
                    editor={editor}
                    threads={threads}
                    onCreate={createComment}
                    onCancelDraft={cancelComment}
                    onActivate={activateComment}
                    onReply={async (id, body) => replaceThread(await api.replyToComment(doc.id, id, body))}
                    onResolve={resolveComment}
                    onDelete={deleteComment}
                    onEditMessage={async (id, messageId, body) =>
                      replaceThread(await api.editCommentMessage(doc.id, id, messageId, body))
                    }
                    onDeleteReply={async (id, messageId) => replaceThread(await api.deleteCommentReply(doc.id, id, messageId))}
                    onCopyLink={(id) => void copyCommentLink(id)}
                    suggestions={marginSuggestions}
                    activeSuggestion={display === "suggestions" ? suggestionState.activeId : null}
                    suggestionReplies={suggestionReplies}
                    onActivateSuggestion={activateSuggestion}
                    onResolveSuggestion={resolveSuggestion}
                    onReplyToSuggestion={replyToSuggestion}
                    onDeleteSuggestionReply={deleteSuggestionReply}
                  />
                )}
                {!historyOpen && !readOnly && <CommentPill editor={editor} column={column} onAddComment={startComment} />}
                {!historyOpen && !readOnly && <TocPill editor={editor} column={column} />}
                {!historyOpen && !readOnly && (
                  <ImagePill
                    editor={editor}
                    column={column}
                    onImageOptions={() => openOptionsPanel("image")}
                    onAddComment={startComment}
                  />
                )}
              </div>
            </div>
          </div>
          {allCommentsOpen && !historyOpen && (
            <AllCommentsPanel
              editor={editor}
              threads={threads}
              onSelect={selectComment}
              onReopen={(id) => void resolveComment(id, false)}
              onClose={() => setAllCommentsOpen(false)}
            />
          )}
          {optionsPanel === "table" && !allCommentsOpen && !historyOpen && (
            <TableOptionsPanel editor={editor} onClose={() => setOptionsPanel(null)} />
          )}
          {optionsPanel === "image" && !allCommentsOpen && !historyOpen && (
            <ImageOptionsPanel editor={editor} onClose={() => setOptionsPanel(null)} />
          )}
        </div>

        {!historyOpen && <ContextMenu editor={editor} actions={actions} onCopyLink={(href) => void copyLink(href)} />}

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

        {find?.mode === "dialog" && !historyOpen && <FindReplaceDialog editor={editor} onClose={closeFind} />}

        {wordCountOpen && (
          <WordCountDialog
            editor={editor}
            liveCountVisible={liveCount.visible}
            onConfirm={(visible) => {
              setLiveCount({ ...liveCount, visible });
              setWordCountOpen(false);
              editor.commands.focus();
            }}
            onCancel={() => {
              setWordCountOpen(false);
              editor.commands.focus();
            }}
          />
        )}

        {customSpacing && (
          <CustomSpacingDialog
            initial={customSpacing}
            onApply={(spacing) => {
              setCustomSpacing(null);
              activeEditor.chain().focus().setParagraphSpacing(spacing).run();
            }}
            onCancel={() => {
              setCustomSpacing(null);
              editor.commands.focus();
            }}
          />
        )}

        {pageSetupOpen && (
          <PageSetupDialog
            initial={pageSetup}
            unit={unit}
            pageless={!printLayout}
            onApply={applyPageSetup}
            onSwitchToPageless={() => {
              setPageSetupOpen(false);
              setPrintLayout(false);
              editor.commands.focus();
            }}
            onCancel={() => {
              setPageSetupOpen(false);
              editor.commands.focus();
            }}
          />
        )}

        {pageNumbersDialog && (
          <PageNumbersDialog
            initial={pageNumbersDialog}
            onApply={applyPageNumbers}
            onCancel={() => {
              setPageNumbersDialog(null);
              (regionEditor ?? editor).commands.focus();
            }}
          />
        )}

        {specialCharacters && !historyOpen && (
          <SpecialCharactersDialog
            key={specialCharacters.category}
            editor={activeEditor}
            initialCategory={specialCharacters.category}
            onClose={() => {
              setSpecialCharacters(null);
              activeEditor.commands.focus();
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

        {notice && (
          <div className="snackbar" role="status" aria-live="polite">
            {notice}
          </div>
        )}

        {namingVersion && (
          <PromptDialog
            title="Name current version"
            label="Version name"
            confirmLabel="Save"
            onConfirm={(name) => void nameCurrentVersion(name)}
            onCancel={() => {
              setNamingVersion(false);
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
      {historyOpen && (
        <HistoryMode
          documentId={doc.id}
          loadRevisions={loadRevisions}
          initialZoom={zoom}
          onBack={closeHistory}
          onRestore={restore}
          onMakeCopy={async (revision) => navigate(`/d/${(await api.copyRevision(doc.id, revision.id)).id}`)}
        />
      )}
    </>
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
      // Inserting an image is an undo step of its own.
      const chain = editor.chain().focus().command(({ tr }) => Boolean(startUndoStep(tr)));
      if (at === undefined) chain.insertContent(image).run();
      else chain.insertContentAt(at, image).run();
    } catch (error) {
      alert(`Couldn't upload ${file.name}: ${(error as Error).message}`);
    }
  }
}
