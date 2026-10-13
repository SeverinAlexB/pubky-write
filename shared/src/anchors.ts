// How a comment's anchor moves when the document changes. The editor and the server both use this,
// so an anchor tracked live in the editor ends up where the server stores it.
import type { Mappable } from "@tiptap/pm/transform";

export type Anchor = { from: number; to: number };

/**
 * Text typed at either edge of the anchor stays outside it, like the reference product. If the anchored
 * text is deleted, the anchor collapses to a single position.
 */
export function mapAnchor(mapping: Mappable, anchor: Anchor): Anchor {
  const from = mapping.map(anchor.from, 1);
  const to = mapping.map(anchor.to, -1);
  return to > from ? { from, to } : { from, to: from };
}

export function isCollapsed(anchor: Anchor): boolean {
  return anchor.from === anchor.to;
}
