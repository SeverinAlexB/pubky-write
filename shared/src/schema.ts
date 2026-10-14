// The document schema shared by the editor and the server.
// The server applies client steps against this schema, so both sides must use the same extensions.
import { getSchema, type AnyExtension, type JSONContent } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Strike from "@tiptap/extension-strike";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import StarterKit from "@tiptap/starter-kit";
import { DocsImage } from "./images.ts";
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
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    // Undo history is configured by the editor so it can be left out on the server.
    undoRedo: false,
    strike: false,
  }),
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
  PageSetupAttributes,
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
