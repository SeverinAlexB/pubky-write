// The card under a link at the cursor: the site's icon, the page title (or the address), the
// address, and Copy / Edit / Remove (docs/spec/17-everyday-editing.md).
import { getMarkRange } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { getPreferences, subscribePreferences } from "./preferences.ts";

const CARD_WIDTH = 324;
/** Space between the bottom of the link's line and the card. */
const OFFSET = 4;

type Bubble = { href: string; from: number; to: number; left: number; top: number };

type LinkBubbleProps = {
  editor: Editor;
  /** The element the card is placed in, so it scrolls with the text. */
  column: HTMLElement | null;
  onEdit: () => void;
  onCopy: (href: string) => void;
};

/**
 * Shown while the cursor is in a link and the editor has focus. Typing or Escape hides it until
 * the cursor moves again; Tools > Preferences > Show link details turns it off.
 */
export function LinkBubble({ editor, column, onEdit, onCopy }: LinkBubbleProps) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [enabled, setEnabled] = useState(() => getPreferences().linkDetails);

  useEffect(() => subscribePreferences((preferences) => setEnabled(preferences.linkDetails)), []);

  useEffect(() => {
    if (!column || !enabled) {
      setBubble(null);
      return;
    }
    let frame = 0;
    let dismissed = false;
    const update = () => {
      frame = 0;
      const next = dismissed ? null : bubbleAt(editor, column);
      setBubble((previous) => (sameBubble(previous, next) ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean } }) => {
      // Typing hides the card; moving the cursor shows it again.
      if (transaction.docChanged) dismissed = true;
      else if (transaction.selectionSet) dismissed = false;
      schedule();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissed = true;
      setBubble(null);
    };
    const onPointerDown = () => {
      dismissed = false;
    };
    const dom = editor.view.dom;
    editor.on("transaction", onTransaction);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    dom.addEventListener("keydown", onKeyDown);
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", onTransaction);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      dom.removeEventListener("keydown", onKeyDown);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, column, enabled]);

  const title = useLinkTitle(bubble?.href ?? null);
  if (!bubble) return null;
  const address = displayAddress(bubble.href);

  const remove = () => {
    editor.chain().focus().setTextSelection({ from: bubble.from, to: bubble.to }).unsetLink().setTextSelection(bubble.to).run();
  };

  return (
    <div
      className="link-bubble"
      role="dialog"
      aria-label="Change or remove link."
      style={{ left: bubble.left, top: bubble.top }}
      // Keep the editor's focus and cursor. This includes the title link: if the editor lost
      // focus on mousedown, the card would hide before the click and the link would not open.
      onMouseDown={(event) => event.preventDefault()}
    >
      <SiteIcon href={bubble.href} />
      <div className="link-bubble-text">
        <a className="link-bubble-title" href={bubble.href} target="_blank" rel="noopener noreferrer">
          {title ?? address}
        </a>
        <span className="link-bubble-url">{address}</span>
      </div>
      <button type="button" className="icon-button" aria-label="Copy link" data-tooltip="Copy link" onClick={() => onCopy(bubble.href)}>
        <Icon name="content_copy" size={18} />
      </button>
      <button type="button" className="icon-button" aria-label="Edit link" data-tooltip="Edit link" onClick={onEdit}>
        <Icon name="edit" size={18} />
      </button>
      <button type="button" className="icon-button" aria-label="Remove link" data-tooltip="Remove link" onClick={remove}>
        <Icon name="link_off" size={18} />
      </button>
    </div>
  );
}

function bubbleAt(editor: Editor, column: HTMLElement): Bubble | null {
  if (editor.isDestroyed || !editor.view.hasFocus()) return null;
  const { state } = editor;
  const link = state.schema.marks.link;
  if (!link) return null;
  const { selection } = state;
  const range = getMarkRange(selection.$from, link);
  if (!range || selection.to > range.to) return null;
  const node = state.doc.nodeAt(range.from);
  const href = node && link.isInSet(node.marks)?.attrs.href;
  if (typeof href !== "string" || !href) return null;
  const start = editor.view.coordsAtPos(range.from, 1);
  const columnRect = column.getBoundingClientRect();
  const left = Math.max(0, Math.min(start.left - columnRect.left, columnRect.width - CARD_WIDTH - 8));
  return { href, from: range.from, to: range.to, left: Math.round(left), top: Math.round(start.bottom - columnRect.top + OFFSET) };
}

function sameBubble(a: Bubble | null, b: Bubble | null): boolean {
  if (a === null || b === null) return a === b;
  return a.href === b.href && a.from === b.from && a.to === b.to && a.left === b.left && a.top === b.top;
}

/** The address without its scheme: "example.com/page". */
export function displayAddress(href: string): string {
  return href.replace(/^(https?:\/\/|mailto:)/i, "").replace(/\/$/, "");
}

function SiteIcon({ href }: { href: string }) {
  const host = webHost(href);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="link-bubble-site" aria-hidden>
      {host && failed !== host ? (
        <img key={host} src={`https://${host}/favicon.ico`} alt="" referrerPolicy="no-referrer" onError={() => setFailed(host)} />
      ) : (
        <Icon name="language" size={16} />
      )}
    </span>
  );
}

function webHost(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

const titles = new Map<string, Promise<string | null>>();

/** The page's title, fetched once per address by the server (null until known or when there is none). */
function useLinkTitle(href: string | null): string | null {
  const [title, setTitle] = useState<{ href: string; title: string | null } | null>(null);
  useEffect(() => {
    if (!href || !webHost(href)) return;
    let current = true;
    if (!titles.has(href)) titles.set(href, api.linkTitle(href).catch(() => null));
    void titles.get(href)!.then((value) => {
      if (current) setTitle({ href, title: value });
    });
    return () => {
      current = false;
    };
  }, [href]);
  return title?.href === href ? title.title : null;
}
