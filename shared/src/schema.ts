// The document schema shared by the editor and the server.
// The server applies client steps against this schema, so both sides must use the same extensions.
import { getSchema, type AnyExtension, type JSONContent } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Strike from "@tiptap/extension-strike";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import StarterKit from "@tiptap/starter-kit";
import { checklistExtensions, ListPreset } from "./lists.ts";
import { PageBreak } from "./pageBreak.ts";
import { ParagraphFormat } from "./paragraphFormat.ts";
import { headingLevels, ParagraphStyle } from "./paragraphStyles.ts";

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
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  ParagraphFormat,
  ParagraphStyle,
  ListPreset,
  ...checklistExtensions,
  PageBreak,
  Image.configure({ inline: false, allowBase64: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

export const documentSchema = getSchema(documentExtensions);

export const emptyDocument: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
