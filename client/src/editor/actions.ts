import type { ListKind, TocStyle } from "@docs/shared";
import type { PageNumberOptions } from "./pageElementCommands.ts";
import type { EditorMode } from "./suggesting.ts";

// Everything the menu bar and toolbar can do beyond plain editor commands.
//
// Optional actions belong to features that are not built yet. Menu items and toolbar
// buttons that call a missing action are shown disabled; providing the action in
// DocumentEditor enables them.

export type DownloadFormat = "docx" | "pdf" | "txt" | "md";
/** File > Download of a document with several tabs: the current tab or all of them. */
export type DownloadScope = "current" | "all";
export type { ListKind };
export type Capitalisation = "lowercase" | "uppercase" | "titleCase";

export type EditorActions = {
  // File
  newDocument: () => void;
  openDocumentList: () => void;
  makeCopy: () => void;
  download: (format: DownloadFormat, scope?: DownloadScope) => void;
  rename: () => void;
  moveToBin: () => void;
  openVersionHistory: () => void;
  nameCurrentVersion?: () => void;
  showDetails?: () => void;
  pageSetup?: () => void;
  print: () => void;

  // Edit
  cut: () => void;
  copy: () => void;
  copyAsMarkdown: () => void;
  paste: () => void;
  pasteWithoutFormatting: () => void;
  pasteFromMarkdown?: () => void;
  findAndReplace: () => void;

  // View
  setMode?: (mode: EditorMode) => void;
  hideComments?: () => void;
  showAllComments: () => void;
  toggleOutline: () => void;
  togglePrintLayout?: () => void;
  toggleRuler?: () => void;
  toggleNonPrintingCharacters?: () => void;
  toggleEquationToolbar?: () => void;
  fullScreen: () => void;

  // Insert
  uploadImage: () => void;
  insertImageByUrl: () => void;
  insertLink: () => void;
  insertSpecialCharacter?: () => void;
  insertEquation?: () => void;
  insertEmoji?: () => void;
  insertPageBreak?: () => void;
  insertColumnBreak?: () => void;
  insertTableOfContents?: (style: TocStyle) => void;
  insertHeader?: () => void;
  insertFooter?: () => void;
  insertPageNumbers?: (options: PageNumberOptions) => void;
  /** Page numbers > More options: the Page numbers dialog. */
  pageNumberOptions?: () => void;
  insertPageCount?: () => void;
  insertFootnote?: () => void;
  addComment: () => void;

  // Format
  toggleSuperscript?: () => void;
  toggleSubscript?: () => void;
  setCapitalisation?: (capitalisation: Capitalisation) => void;
  indentationOptions?: () => void;
  toggleSpaceBefore?: () => void;
  toggleSpaceAfter?: () => void;
  customSpacing?: () => void;
  toggleKeepWithNext?: () => void;
  toggleKeepLinesTogether?: () => void;
  togglePreventSingleLines?: () => void;
  togglePageBreakBefore?: () => void;
  toggleChecklist?: () => void;
  applyListPreset?: (kind: ListKind, preset: number) => void;
  /** Format > Columns: one of the presets, or the Column options dialog. */
  setColumns?: (columns: number) => void;
  columnOptions?: () => void;
  setPageOrientation?: () => void;
  switchToPageless?: () => void;
  tableOptions?: () => void;
  /** Format > Table > Split cell: the Split cell dialog. */
  splitCell?: () => void;
  imageOptions?: () => void;
  /** Crop image (toolbar, while an image is selected). */
  cropImage?: () => void;
  /** Replace image ▸ Upload from computer / By URL: the same size and settings with another picture. */
  replaceImage?: (source: "upload" | "url") => void;

  // Tools
  wordCount: () => void;
  reviewSuggestedEdits?: () => void;
  preferences?: () => void;
  keyboardShortcuts?: () => void;

  // Toolbar only
  searchMenus?: () => void;
  moreFonts?: () => void;
  styleOptions?: () => void;
};

/** State of the View menu's toggles. */
export type ViewSettings = {
  outlineOpen: boolean;
  printLayout: boolean;
  rulerVisible: boolean;
  nonPrintingCharacters: boolean;
  /** View > Show equation toolbar. */
  equationToolbar?: boolean;
  commentsHidden: boolean;
  mode: EditorMode;
  /** Viewing mode or a suggestion preview: nothing may change the document. */
  readOnly: boolean;
  /** The document has more than one tab: File > Download offers the current tab or all tabs. */
  multipleTabs?: boolean;
};
