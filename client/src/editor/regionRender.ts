// Static HTML of header, footer and footnote content (see shared/src/pageElements.ts), for the
// pages that are not being edited and for measuring.
import type { RegionContent } from "@docs/shared";
import { DOMSerializer, type Schema } from "@tiptap/pm/model";

const html = new WeakMap<RegionContent, string>();

/** The HTML of region content, cached per content object (content is replaced, never changed). */
export function regionHTML(schema: Schema, content: RegionContent): string {
  let result = html.get(content);
  if (result === undefined) {
    const doc = schema.nodeFromJSON({ type: "doc", content });
    const container = document.createElement("div");
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    // Static copies are not editable: their fields and footnote references must not take focus.
    for (const element of container.querySelectorAll("[contenteditable]")) element.removeAttribute("contenteditable");
    result = container.innerHTML;
    html.set(content, result);
  }
  return result;
}

/** The header starts and the footer ends 1.27 cm (48px) from the page's edge. */
export const HEADER_OFFSET = 48;
