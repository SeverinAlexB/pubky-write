// A read-only rendering of the top of a document's first page, scaled down to a thumbnail.
// It renders the stored JSON directly with the editor's content styles (.page-content), so the
// document list does not load the editor.
import { normalizePageSetup, pageGeometry, paragraphIndents } from "@pubky-write/shared";
import type { JSONContent } from "@tiptap/core";
import { createElement, memo, type CSSProperties, type ReactNode } from "react";

type PagePreviewProps = {
  content: JSONContent;
  /** The thumbnail's width in pixels; the page is scaled to fit it. */
  width: number;
};

/** Decorative: hidden from assistive technology, which reads the document's title instead. */
export const PagePreview = memo(function PagePreview({ content, width }: PagePreviewProps) {
  const setup = normalizePageSetup(content.attrs ?? {});
  const page = pageGeometry(setup);
  const style: CSSProperties = {
    background: setup.pageColor,
    width: page.width,
    minHeight: page.height,
    padding: `${page.marginTop}px ${page.marginRight}px 0 ${page.marginLeft}px`,
    transform: `scale(${width / page.width})`,
  };
  return (
    <div className="page-preview" aria-hidden inert>
      <div className="page-content page-preview-page" style={style}>
        {blocks(content.content)}
      </div>
    </div>
  );
});

function blocks(content: JSONContent[] | undefined): ReactNode[] {
  const result: ReactNode[] = [];
  for (const [index, node] of (content ?? []).entries()) {
    // Only the first page is shown.
    if (node.type === "pageBreak") break;
    result.push(block(node, index));
  }
  return result;
}

function block(node: JSONContent, key: number): ReactNode {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} data-paragraph-style={attrs.paragraphStyle ?? undefined} style={paragraphStyle(attrs)}>
          {inline(node.content)}
        </p>
      );
    case "heading":
      return createElement(`h${attrs.level ?? 1}`, { key, style: paragraphStyle(attrs) }, inline(node.content));
    case "bulletList":
      return (
        <ul key={key} data-list-preset={preset(attrs)}>
          {blocks(node.content)}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={attrs.start ?? 1} data-list-preset={preset(attrs)}>
          {blocks(node.content)}
        </ol>
      );
    case "listItem":
      return <li key={key}>{blocks(node.content)}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList" data-list-preset={preset(attrs)}>
          {blocks(node.content)}
        </ul>
      );
    case "taskItem":
      return (
        <li key={key} data-checked={attrs.checked === true}>
          <label>
            <span className="page-preview-checkbox" data-checked={attrs.checked === true} />
          </label>
          <div>{blocks(node.content)}</div>
        </li>
      );
    case "blockquote":
      return <blockquote key={key}>{blocks(node.content)}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{node.content?.map((text) => text.text).join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "image":
      return <img key={key} src={attrs.src} alt="" width={attrs.width ?? undefined} loading="lazy" />;
    case "table":
      return (
        <table key={key}>
          <tbody>{blocks(node.content)}</tbody>
        </table>
      );
    case "tableRow":
      return <tr key={key}>{blocks(node.content)}</tr>;
    case "tableCell":
    case "tableHeader":
      return createElement(
        node.type === "tableHeader" ? "th" : "td",
        { key, colSpan: attrs.colspan ?? 1, rowSpan: attrs.rowspan ?? 1 },
        blocks(node.content),
      );
    default:
      return null;
  }
}

/** The preset attribute as the editor renders it; older numeric presets show as the default. */
function preset(attrs: Record<string, unknown>): string | undefined {
  return typeof attrs.listPreset === "string" ? attrs.listPreset : undefined;
}

/** Alignment, line spacing, space before and after, and indentation, as the editor renders them. */
function paragraphStyle(attrs: Record<string, unknown>): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (typeof attrs.textAlign === "string") style.textAlign = attrs.textAlign as CSSProperties["textAlign"];
  if (typeof attrs.lineSpacing === "number") style.lineHeight = attrs.lineSpacing;
  if (typeof attrs.spaceBefore === "number") style.paddingTop = `${attrs.spaceBefore}pt`;
  if (typeof attrs.spaceAfter === "number") style.paddingBottom = `${attrs.spaceAfter}pt`;
  const indents = paragraphIndents(attrs);
  if (indents.left) style.marginLeft = `${indents.left}pt`;
  if (indents.firstLine) style.textIndent = `${indents.firstLine}pt`;
  if (indents.right) style.marginRight = `${indents.right}pt`;
  return Object.keys(style).length > 0 ? style : undefined;
}

function inline(content: JSONContent[] | undefined): ReactNode[] {
  return (content ?? []).map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    // Thumbnails do not lay tabs out: each is half an inch wide.
    if (node.type === "tab") return <span key={index} className="tab-char" />;
    if (node.type !== "text") return null;
    let result: ReactNode = node.text;
    for (const mark of node.marks ?? []) result = withMark(result, mark);
    return <span key={index}>{result}</span>;
  });
}

function withMark(children: ReactNode, mark: { type: string; attrs?: Record<string, unknown> }): ReactNode {
  const attrs = mark.attrs ?? {};
  switch (mark.type) {
    case "bold":
      return <strong>{children}</strong>;
    case "italic":
      return <em>{children}</em>;
    case "underline":
      return <u>{children}</u>;
    case "strike":
      return <s>{children}</s>;
    case "code":
      return <code>{children}</code>;
    case "superscript":
      return <sup>{children}</sup>;
    case "subscript":
      return <sub>{children}</sub>;
    // Not a real link, so the thumbnail has nothing to focus.
    case "link":
      return <span className="page-preview-link">{children}</span>;
    case "highlight":
      return <mark style={{ backgroundColor: (attrs.color as string | undefined) ?? "#ffff00" }}>{children}</mark>;
    case "textStyle":
      return (
        <span
          style={{
            color: (attrs.color as string | undefined) ?? undefined,
            fontSize: (attrs.fontSize as string | undefined) ?? undefined,
            fontFamily: (attrs.fontFamily as string | undefined) ?? undefined,
          }}
        >
          {children}
        </span>
      );
    default:
      return children;
  }
}
