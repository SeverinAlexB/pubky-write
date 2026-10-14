// The document schema shared by the editor and the server.
// The server applies client steps against this schema, so both sides must use the same extensions.
import { getSchema, Node as TiptapNode, type AnyExtension, type JSONContent } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Strike from "@tiptap/extension-strike";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import StarterKit from "@tiptap/starter-kit";
import { ColumnAttributes, ColumnBreak } from "./columns.ts";
import { DocsImage } from "./images.ts";
import { DOCUMENT_TAB, DocumentTab } from "./documentTabs.ts";
import { checklistExtensions, ListPreset } from "./lists.ts";
import { PageBreak } from "./pageBreak.ts";
import { Footnote, PageElementAttributes, PageField, registerRegionSchema } from "./pageElements.ts";
import { PageSetupAttributes } from "./pageSetupAttributes.ts";
import { ParagraphFormat } from "./paragraphFormat.ts";
import { headingLevels, ParagraphStyle } from "./paragraphStyles.ts";
import { DocsTable, DocsTableCell, DocsTableHeader, DocsTableRow } from "./tables.ts";
import { TableOfContents, TocEntry } from "./tableOfContents.ts";
import { suggestionExtensions } from "./suggestions.ts";
import { Tab, TabStops } from "./tabStops.ts";

export const documentExtensions: AnyExtension[] = [
  StarterKit.configure({
    heading: { levels: [...headingLevels] },
    // Typed addresses become links in the editor (Tools > Preferences), not through the extension.
    link: { openOnClick: false, autolink: false, defaultProtocol: "https" },
    // Undo history is configured by the editor so it can be left out on the server.
    undoRedo: false,
    strike: false,
    document: false,
  }),
  // Blocks, or one tab node per document tab (documentTabs.ts). Blocks come first, so an
  // emptied document is filled with a paragraph.
  TiptapNode.create({ name: "doc", topNode: true, content: `block+ | ${DOCUMENT_TAB}+` }),
  DocumentTab,
  // Strikethrough is ⌘+Shift+X, as in Format > Text.
  Strike.extend({
    addKeyboardShortcuts() {
      return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
    },
  }),
  // Superscript (⌘.) and subscript (⌘,) exclude each other.
  Superscript.extend({ excludes: "subscript" }),
  Subscript.extend({ excludes: "superscript" }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  // ⌘+Shift+H opens Find and replace, so the highlight has no shortcut of its own.
  Highlight.extend({ addKeyboardShortcuts: () => ({}) }).configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  ParagraphFormat,
  ParagraphStyle,
  ListPreset,
  ...checklistExtensions,
  PageBreak,
  ColumnBreak,
  PageSetupAttributes,
  ColumnAttributes,
  DocsImage,
  DocsTable,
  DocsTableRow,
  DocsTableHeader,
  DocsTableCell,
  PageElementAttributes,
  PageField,
  Footnote,
  TableOfContents,
  TocEntry,
  TabStops,
  Tab,
  // Last, so suggestion marks are the innermost spans and their colour wins.
  ...suggestionExtensions,
];

export const documentSchema = getSchema(documentExtensions);
registerRegionSchema(documentSchema);

export const emptyDocument: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
