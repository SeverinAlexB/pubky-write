import type { ListKind } from "@docs/shared";

// Everything the menu bar and toolbar can do beyond plain editor commands.
//
// Optional actions belong to features that are not built yet. Menu items and toolbar
// buttons that call a missing action are shown disabled; providing the action in
// DocumentEditor enables them.

export type DownloadFormat = "docx" | "pdf" | "txt" | "md";
export type { ListKind };
export type Capitalisation = "lowercase" | "uppercase" | "titleCase";

export type EditorActions = {
  // File
  newDocument: () => void;
  openDocumentList: () => void;
  makeCopy: () => void;
  download: (format: DownloadFormat) => void;
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
  setViewingMode?: (viewing: boolean) => void;
  hideComments?: () => void;
  showAllComments: () => void;
  toggleOutline: () => void;
  togglePrintLayout?: () => void;
  toggleRuler?: () => void;
  toggleNonPrintingCharacters?: () => void;
  fullScreen: () => void;

  // Insert
  uploadImage: () => void;
  insertImageByUrl: () => void;
  insertLink: () => void;
  insertSpecialCharacter?: () => void;
  insertEmoji?: () => void;
  insertPageBreak?: () => void;
  insertTableOfContents?: () => void;
  insertHeader?: () => void;
  insertFooter?: () => void;
  insertPageNumbers?: () => void;
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
  setPageOrientation?: () => void;
  switchToPageless?: () => void;

  // Tools
  wordCount: () => void;
  preferences?: () => void;

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
};
