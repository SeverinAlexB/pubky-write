// Pasting from web pages and word processors (docs/spec/17-everyday-editing.md): the HTML is
// cleaned before the editor reads it, and pasted images are copied into the app's uploads with a
// grey placeholder in the meantime, so documents never depend on other sites' images.
//
// Paste without formatting (⌘+Shift+V) is ProseMirror's own: with Shift held it reads only the
// plain text. A URL pasted onto selected text makes it a link (the link extension's linkOnPaste).
import { Extension } from "@tiptap/core";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { api } from "../api.ts";
import { DEFAULT_FONT } from "./fonts.ts";

/** The `src` of a pasted image while it is being uploaded. */
export const PENDING_IMAGE = "pending:";

/** Styles that pasted content keeps: basic text formatting and alignment. */
const keptStyles = new Set([
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
  "vertical-align",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "text-align",
]);
const blockElements = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "BODY", "TABLE", "TBODY", "THEAD", "TR"]);
const droppedElements = "script, style, meta, link, title, xml, template, object, embed, iframe, noscript, head";
/** The default text size, 11pt (about 14.67px). */
function isDefaultSize(value: string): boolean {
  const match = /^(\d+(?:\.\d+)?)(pt|px)$/i.exec(value.replace(/\s+/g, ""));
  if (!match) return false;
  const points = match[2]!.toLowerCase() === "pt" ? Number(match[1]) : (Number(match[1]) * 3) / 4;
  return Math.abs(points - 11) < 0.05;
}

/**
 * Cleans HTML from the clipboard: Word's markup (mso- styles, conditional comments, o:p, list
 * paragraphs that become real nested lists), classes, comments, scripts and unknown elements;
 * font families and sizes equal to the defaults, and background colours on whole blocks.
 * `image` decides what each image's `src` becomes (null drops the image).
 */
export function cleanPastedHtml(html: string, image: (src: string) => string | null = (src) => src): string {
  // The editor's own copies keep everything.
  if (html.includes("data-pm-slice")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const { body } = doc;

  const comments = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const commentNodes: globalThis.Node[] = [];
  while (comments.nextNode()) commentNodes.push(comments.currentNode);
  for (const comment of commentNodes) comment.parentNode?.removeChild(comment);
  for (const element of [...body.querySelectorAll(droppedElements)]) element.remove();

  convertWordLists(body);

  for (const element of [...body.querySelectorAll("*")]) {
    const name = element.tagName;
    if (name.includes(":")) {
      // o:p holds only a non-breaking space; other Office elements are unwrapped.
      if (name === "O:P") element.remove();
      else element.replaceWith(...element.childNodes);
      continue;
    }
    if (name === "FONT") {
      element.replaceWith(...element.childNodes);
      continue;
    }
    if (name === "IMG") {
      const src = image(element.getAttribute("src") ?? "");
      if (src === null) element.remove();
      else element.setAttribute("src", src);
    }
    const className = element.getAttribute("class") ?? "";
    if (name === "P" && /\bMso(Title|Subtitle)\b/.test(className)) {
      element.setAttribute("data-paragraph-style", className.includes("MsoTitle") ? "title" : "subtitle");
    }
    for (const attribute of ["class", "id", "lang", "align", "face", "size"]) element.removeAttribute(attribute);
    const style = element.getAttribute("style");
    if (style !== null) {
      const cleaned = cleanStyle(style, blockElements.has(name));
      if (cleaned) element.setAttribute("style", cleaned);
      else element.removeAttribute("style");
    }
  }
  return body.innerHTML;
}

/** The declarations of a style attribute that pasted content keeps. */
export function cleanStyle(style: string, isBlock: boolean): string {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!value || !keptStyles.has(property)) continue;
    if ((property === "background-color" || property === "background") && isBlock) continue;
    if (property === "font-family" && firstFamily(value) === DEFAULT_FONT.toLowerCase()) continue;
    if (property === "font-size" && isDefaultSize(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.join("; ");
}

function firstFamily(value: string): string {
  return (value.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
}

/**
 * Word writes list items as paragraphs with `mso-list: l0 level2 lfo1` and the bullet or number
 * as text in a `mso-list: Ignore` span. Consecutive ones become nested `<ul>` / `<ol>` lists.
 */
function convertWordLists(root: HTMLElement): void {
  const doc = root.ownerDocument;
  /** The Word list a paragraph belongs to ("l0"), or null. */
  const listOf = (node: Element | null): string | null =>
    node?.tagName === "P" ? (/mso-list:\s*(l\d+)\s+level\d+/i.exec(node.getAttribute("style") ?? "")?.[1] ?? null) : null;

  for (const first of [...root.querySelectorAll("p")]) {
    const id = listOf(first);
    if (!first.isConnected || id === null || listOf(first.previousElementSibling) === id) continue;
    const items: HTMLElement[] = [];
    for (let node: Element | null = first; node && listOf(node) === id; node = node.nextElementSibling) items.push(node as HTMLElement);

    const top = { level: 0, list: null as HTMLElement | null, item: null as HTMLElement | null };
    const stack: (typeof top)[] = [];
    let container: HTMLElement | null = null;
    for (const paragraph of items) {
      const level = Number(/level(\d+)/i.exec(paragraph.getAttribute("style") ?? "")![1]);
      const marker = [...paragraph.querySelectorAll<HTMLElement>("[style]")].find((element) =>
        /mso-list:\s*ignore/i.test(element.getAttribute("style") ?? ""),
      );
      const ordered = /^\(?[0-9a-zA-Z]{1,5}[.)]/.test((marker?.textContent ?? "").trim());
      marker?.remove();
      while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();
      let current = stack[stack.length - 1];
      // A numbered item after bullets at the same level (or the other way round) starts a new list.
      if (current && current.level === level && current.list!.tagName !== (ordered ? "OL" : "UL") && stack.length > 1) {
        stack.pop();
        current = stack[stack.length - 1];
      }
      if (!current || current.level < level) {
        const list = doc.createElement(ordered ? "ol" : "ul");
        if (current?.item) current.item.append(list);
        else if (!container) container = list;
        else container.append(list);
        current = { level, list, item: null };
        stack.push(current);
      }
      const item = doc.createElement("li");
      const content = doc.createElement("p");
      content.append(...paragraph.childNodes);
      item.append(content);
      current.list!.append(item);
      current.item = item;
    }
    first.before(container!);
    for (const paragraph of items) paragraph.remove();
  }
}

/** Uploaded images by the id in their placeholder's src, so undoing and redoing a paste brings back the upload. */
const uploadedImages = new Map<string, string>();

/**
 * The src a pasted image gets: images already in the uploads keep theirs; web and data images
 * get a placeholder while they are uploaded (their uploads go into `pending`); others are dropped.
 */
function pastedImageSource(src: string, pending: Map<string, Promise<string>>): string | null {
  if (src.startsWith("/uploads/") || src.startsWith(`${location.origin}/uploads/`)) return src.replace(location.origin, "");
  if (!/^(https?:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(src)) return null;
  const id = crypto.randomUUID();
  pending.set(id, uploadImage(src));
  return `${PENDING_IMAGE}${id}`;
}

async function uploadImage(src: string): Promise<string> {
  if (src.startsWith("data:")) {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], `pasted.${blob.type.split("/")[1] ?? "png"}`, { type: blob.type });
    return (await api.uploadImage(file)).url;
  }
  return (await api.uploadRemoteImage(src)).url;
}

/** Positions and ids of the pending images in `doc`. */
function pendingImagesIn(doc: Node): { pos: number; id: string }[] {
  const found: { pos: number; id: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "image" && typeof node.attrs.src === "string" && node.attrs.src.startsWith(PENDING_IMAGE)) {
      found.push({ pos, id: node.attrs.src.slice(PENDING_IMAGE.length) });
    }
    return !node.isTextblock;
  });
  return found;
}

/** Replaces the placeholders of uploaded images with their upload, or removes those that failed. */
function resolveImages(state: EditorState, resolve: (id: string) => string | null | undefined): Transaction | null {
  const tr = state.tr;
  // From the end, so earlier positions stay valid when an image is removed.
  for (const { pos, id } of pendingImagesIn(state.doc).reverse()) {
    const url = resolve(id);
    if (url === undefined) continue;
    const node = tr.doc.nodeAt(pos);
    if (!node) continue;
    if (url === null) tr.delete(pos, pos + node.nodeSize);
    else tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url });
  }
  // Not an undo step: undoing the paste removes the image, whatever its src.
  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}

function insertsPendingImage(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as { slice?: { content: { descendants: (f: (node: Node) => boolean | void) => void } } }).slice;
    let found = false;
    slice?.content.descendants((node) => {
      if (node.type.name === "image" && String(node.attrs.src).startsWith(PENDING_IMAGE)) found = true;
      return !found;
    });
    return found;
  });
}

type PasteCleanupOptions = { onImageError: (message: string) => void };

export const PasteCleanup = Extension.create<PasteCleanupOptions>({
  name: "pasteCleanup",

  addOptions() {
    return { onImageError: () => {} };
  },

  addProseMirrorPlugins() {
    const { onImageError } = this.options;
    // This editor's pasted images whose upload has started, until they are seen in the document.
    const pendingImages = new Map<string, Promise<string>>();
    const waitFor = (view: EditorView) => {
      const uploads = [...pendingImages];
      // Images of a paste that did not happen are not waited for.
      pendingImages.clear();
      const present = new Set(pendingImagesIn(view.state.doc).map(({ id }) => id));
      for (const [id, result] of uploads) {
        if (!present.has(id)) continue;
        result.then(
          (url) => {
            uploadedImages.set(id, url);
            if (view.isDestroyed) return;
            const tr = resolveImages(view.state, (candidate) => (candidate === id ? url : undefined));
            if (tr) view.dispatch(tr);
          },
          (error: Error) => {
            if (view.isDestroyed) return;
            const tr = resolveImages(view.state, (candidate) => (candidate === id ? null : undefined));
            if (tr) view.dispatch(tr);
            onImageError(`Couldn't upload a pasted image: ${error.message}`);
          },
        );
      }
    };
    return [
      new Plugin({
        key: new PluginKey("pasteCleanup"),
        props: {
          transformPastedHTML: (html) => cleanPastedHtml(html, (src) => pastedImageSource(src, pendingImages)),
          // Pasted into an empty paragraph, the first pasted block keeps its own style (a title or heading).
          transformPasted: (slice, view) => {
            const { selection } = view.state;
            const first = slice.content.firstChild;
            if (slice.openStart === 0 || !selection.empty || selection.$from.parent.content.size > 0 || !first?.isTextblock) return slice;
            return new Slice(slice.content, 0, slice.openEnd);
          },
          // Plain text (Paste without formatting, or text without HTML) takes the formatting at the cursor.
          clipboardTextParser: (text, $context, _plain, view) => {
            const { schema } = view.state;
            if ($context.parent.type.spec.code) return new Slice(Fragment.from(text ? schema.text(text.replace(/\r\n?/g, "\n")) : []), 0, 0);
            const marks = (view.state.storedMarks ?? $context.marks()).filter((mark) => !mark.type.name.startsWith("suggestion"));
            const paragraphs = text
              .replace(/\r\n?/g, "\n")
              .split("\n")
              .map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line, marks) : null));
            return new Slice(Fragment.from(paragraphs), 1, 1);
          },
        },
        // Undo and redo can bring back a placeholder whose image has been uploaded since.
        appendTransaction(transactions, _old, state) {
          if (uploadedImages.size === 0 || !transactions.some(insertsPendingImage)) return null;
          return resolveImages(state, (id) => uploadedImages.get(id));
        },
        view: () => ({
          update(view, previous) {
            if (pendingImages.size > 0 && view.state.doc !== previous.doc) waitFor(view);
          },
        }),
      }),
    ];
  },
});
