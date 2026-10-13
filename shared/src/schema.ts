// The document schema shared by the editor and the server.
// The server applies client steps against this schema, so both sides must use the same extensions.
import { getSchema, type AnyExtension, type JSONContent } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { ParagraphFormat } from "./paragraphFormat.ts";

export const documentExtensions: AnyExtension[] = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    // Undo history is configured by the editor so it can be left out on the server.
    undoRedo: false,
  }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  ParagraphFormat,
  Image.configure({ inline: false, allowBase64: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

export const documentSchema = getSchema(documentExtensions);

export const emptyDocument: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
