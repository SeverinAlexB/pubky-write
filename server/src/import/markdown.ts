// Converts a Markdown file (CommonMark with GitHub tables, strikethrough and task lists) into a
// document. It reads what the Markdown export writes: `<u>`, `<sup>`, `<sub>` and `<mark>`, and
// `<!-- page break -->`. Other HTML is dropped.
//
// A level 1 heading stays Heading 1: Markdown cannot tell it apart from a Title.
import type { JSONContent } from "@tiptap/core";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  DroppedContent,
  finishDocument,
  textNode,
  textWithTabs,
  type ImageStore,
  type ImportOptions,
  type ImportResult,
  type MarkJSON,
} from "./content.ts";

const markdown = new MarkdownIt("default", { html: true, linkify: false });

const htmlMarks: Record<string, MarkJSON> = {
  u: { type: "underline" },
  ins: { type: "underline" },
  sup: { type: "superscript" },
  sub: { type: "subscript" },
  mark: { type: "highlight" },
  s: { type: "strike" },
  del: { type: "strike" },
  strike: { type: "strike" },
  b: { type: "bold" },
  strong: { type: "bold" },
  i: { type: "italic" },
  em: { type: "italic" },
};

const tokenMarks: Record<string, MarkJSON> = {
  strong_open: { type: "bold" },
  em_open: { type: "italic" },
  s_open: { type: "strike" },
};

const PAGE_BREAK = /^<!--\s*page\s*break\s*-->\s*$/i;
const TASK_MARKER = /^\[([ xX])\]\s+/;

export async function markdownToDocument(source: string, options: ImportOptions): Promise<ImportResult> {
  const converter = new MarkdownConverter(options.storeImage);
  const blocks = await converter.convert(markdown.parse(source, {}));
  return { doc: finishDocument(blocks, options), dropped: converter.dropped.list() };
}

/** An open block; `hadInline` notes inline content that may all have been dropped (an unreadable image). */
type Frame = { node: JSONContent; content: JSONContent[]; hadInline?: boolean };

class MarkdownConverter {
  readonly dropped = new DroppedContent();

  constructor(private readonly storeImage: ImageStore) {}

  async convert(tokens: Token[]): Promise<JSONContent[]> {
    const root: Frame = { node: { type: "doc" }, content: [] };
    const stack: Frame[] = [root];
    const top = () => stack[stack.length - 1]!;
    const open = (node: JSONContent) => stack.push({ node, content: [] });
    const close = () => {
      const frame = stack.pop()!;
      top().content.push(...this.finish(frame));
    };

    for (const token of tokens) {
      switch (token.type) {
        case "paragraph_open":
          open({ type: "paragraph" });
          break;
        case "heading_open":
          open({ type: "heading", attrs: { level: Number(token.tag.slice(1)) } });
          break;
        case "blockquote_open":
          open({ type: "blockquote" });
          break;
        case "bullet_list_open":
          open({ type: "bulletList" });
          break;
        case "ordered_list_open":
          open({ type: "orderedList", attrs: { start: Number(token.attrGet("start") ?? 1) } });
          break;
        case "list_item_open":
          open({ type: "listItem" });
          break;
        case "table_open":
          open({ type: "table" });
          break;
        case "tr_open":
          open({ type: "tableRow" });
          break;
        case "th_open":
        case "td_open":
          open({ type: token.type === "th_open" ? "tableHeader" : "tableCell", attrs: { align: token.attrGet("style") } });
          // Cell text is inline content without a paragraph token around it.
          open({ type: "paragraph" });
          break;
        case "th_close":
        case "td_close":
          close();
          close();
          break;
        case "paragraph_close":
        case "heading_close":
        case "blockquote_close":
        case "bullet_list_close":
        case "ordered_list_close":
        case "list_item_close":
        case "table_close":
        case "tr_close":
          close();
          break;
        case "inline":
          top().hadInline ||= (token.children ?? []).length > 0;
          top().content.push(...(await this.inline(token.children ?? [])));
          break;
        case "fence":
        case "code_block": {
          const language = token.info.trim().split(/\s+/)[0] || null;
          const text = token.content.replace(/\n$/, "");
          top().content.push({ type: "codeBlock", attrs: { language }, ...(text && { content: [{ type: "text", text }] }) });
          break;
        }
        case "hr":
          top().content.push({ type: "horizontalRule" });
          break;
        case "html_block":
          if (PAGE_BREAK.test(token.content.trim())) top().content.push({ type: "pageBreak" });
          else if (!/^<!--[\s\S]*-->\s*$/.test(token.content.trim())) this.dropped.add("HTML");
          break;
        // thead, tbody and other structural tokens carry nothing of their own.
      }
    }
    return root.content;
  }

  /** The blocks a closed frame becomes: text blocks split around images, which are blocks here. */
  private finish({ node, content, hadInline }: Frame): JSONContent[] {
    if (node.type === "paragraph" || node.type === "heading") {
      // A paragraph that only held a dropped image is left out rather than kept empty.
      return hadInline && content.length === 0 ? [] : splitAroundBlocks(node, content);
    }
    if (node.type === "tableCell" || node.type === "tableHeader") {
      const { align, ...attrs } = node.attrs ?? {};
      const textAlign = typeof align === "string" ? align.match(/text-align:\s*(left|center|right)/)?.[1] : undefined;
      const blocks = textAlign && textAlign !== "left" ? content.map((block) => withAlignment(block, textAlign)) : content;
      return [{ type: node.type, attrs, content: blocks }];
    }
    if (node.type === "bulletList") return [asTaskList(content) ?? { ...node, content }];
    return [{ ...node, content }];
  }

  /** Inline tokens as text nodes, hard breaks and (block) images. */
  private async inline(tokens: Token[]): Promise<JSONContent[]> {
    const result: JSONContent[] = [];
    let marks: MarkJSON[] = [];
    const removeLast = (type: string) => {
      const index = marks.findLastIndex((mark) => mark.type === type);
      if (index >= 0) marks = marks.toSpliced(index, 1);
    };

    for (const token of tokens) {
      switch (token.type) {
        case "text":
          result.push(...textWithTabs(token.content, marks));
          break;
        case "softbreak":
          result.push(...textNode(" ", marks));
          break;
        case "hardbreak":
          result.push({ type: "hardBreak" });
          break;
        case "code_inline":
          result.push(...textNode(token.content, [{ type: "code" }]));
          break;
        case "strong_open":
        case "em_open":
        case "s_open":
          marks = [...marks, tokenMarks[token.type]!];
          break;
        case "strong_close":
        case "em_close":
        case "s_close":
          removeLast(tokenMarks[token.type.replace("_close", "_open")]!.type);
          break;
        case "link_open":
          marks = [...marks, { type: "link", attrs: { href: token.attrGet("href") ?? "" } }];
          break;
        case "link_close":
          removeLast("link");
          break;
        case "image": {
          const image = await this.image(token);
          if (image) result.push(image);
          break;
        }
        case "html_inline": {
          const tag = token.content.match(/^<(\/?)([a-z]+)\b[^>]*?(\/?)>$/i);
          const name = tag?.[2]?.toLowerCase();
          if (name === "br") result.push({ type: "hardBreak" });
          else if (name && htmlMarks[name]) {
            if (tag![1]) removeLast(htmlMarks[name].type);
            else marks = [...marks, htmlMarks[name]];
          } else if (!token.content.startsWith("<!--")) this.dropped.add("HTML");
          break;
        }
      }
    }
    return result;
  }

  /** Images in the file (data URLs) are stored as uploads; web addresses are kept; local paths cannot be read. */
  private async image(token: Token): Promise<JSONContent | null> {
    const source = token.attrGet("src") ?? "";
    const alt = token.content || null;
    const title = token.attrGet("title");
    let src: string | null = null;
    const data = source.match(/^data:[^;,]+;base64,(.*)$/s);
    if (data) {
      src = await this.storeImage(Buffer.from(data[1]!, "base64"));
      if (!src) this.dropped.add("Images in unsupported formats");
    } else if (/^https?:\/\//i.test(source) || source.startsWith("/uploads/")) {
      src = source;
    } else {
      this.dropped.add("Images from local files");
    }
    return src ? { type: "image", attrs: { src, alt, title } } : null;
  }
}

const isInline = (node: JSONContent) => node.type === "text" || node.type === "hardBreak" || node.type === "tab";

/** A paragraph or heading with images in it becomes the text before, the image and the text after. */
function splitAroundBlocks(node: JSONContent, content: JSONContent[]): JSONContent[] {
  if (content.every(isInline)) return [{ ...node, ...(content.length > 0 && { content }) }];
  const blocks: JSONContent[] = [];
  let run: JSONContent[] = [];
  const flush = () => {
    if (run.some((part) => part.type === "text")) blocks.push({ ...node, content: run });
    run = [];
  };
  for (const part of content) {
    if (isInline(part)) run.push(part);
    else {
      flush();
      blocks.push(part);
    }
  }
  flush();
  return blocks;
}

/** A bulleted list whose items all start with `[ ]` or `[x]` is a checklist. */
function asTaskList(items: JSONContent[]): JSONContent | null {
  const firstTexts = items.map((item) => item.content?.[0]?.content?.[0]);
  if (items.length === 0 || !firstTexts.every((text) => text?.type === "text" && TASK_MARKER.test(text.text ?? ""))) return null;
  return {
    type: "taskList",
    content: items.map((item, index) => {
      const [first, ...rest] = item.content!;
      const [text, ...inline] = first!.content!;
      const checked = TASK_MARKER.exec(text!.text!)![1] !== " ";
      const remaining = text!.text!.replace(TASK_MARKER, "");
      const paragraph = { ...first, content: [...(remaining ? [{ ...firstTexts[index], text: remaining }] : []), ...inline] };
      if (paragraph.content.length === 0) delete (paragraph as JSONContent).content;
      return { type: "taskItem", attrs: { checked }, content: [paragraph, ...rest] };
    }),
  };
}

function withAlignment(block: JSONContent, textAlign: string): JSONContent {
  return block.type === "paragraph" ? { ...block, attrs: { ...block.attrs, textAlign } } : block;
}
