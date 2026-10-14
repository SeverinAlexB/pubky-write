// The thumbnail content of a document in the document list: the blocks at the top of its first
// page, cut to about a page of text so the stored preview stays small for any document.
import type { JSONContent } from "@tiptap/core";
import { Fragment, type Node } from "@tiptap/pm/model";

/** More lines than fit on a page, so the thumbnail is never cut short. */
const PREVIEW_LINES = 64;
const CHARS_PER_LINE = 90;
const IMAGE_LINES = 12;

export function documentPreview(doc: Node): JSONContent {
  const blocks: Node[] = [];
  let budget = PREVIEW_LINES;
  doc.forEach((block) => {
    // A page break ends the first page.
    if (budget <= 0 || block.type.name === "pageBreak") {
      budget = 0;
      return;
    }
    const [kept, lines] = truncate(block, budget);
    blocks.push(kept);
    budget -= lines;
  });
  return doc.copy(Fragment.from(blocks)).toJSON();
}

/** The part of `node` that fits in `budget` lines, and the lines it takes. */
function truncate(node: Node, budget: number): [Node, number] {
  if (node.isTextblock) {
    const lines = Math.max(1, Math.ceil(node.textContent.length / CHARS_PER_LINE));
    if (lines <= budget) return [node, lines];
    return [node.cut(0, Math.min(node.content.size, budget * CHARS_PER_LINE)), budget];
  }
  if (node.isLeaf) return [node, node.type.name === "image" ? IMAGE_LINES : 1];

  // The cells of a row sit side by side: the row takes as many lines as its tallest cell.
  if (node.type.name === "tableRow") {
    const cells: Node[] = [];
    let tallest = 1;
    node.forEach((cell) => {
      const [kept, lines] = truncate(cell, budget);
      cells.push(kept);
      tallest = Math.max(tallest, lines);
    });
    return [node.copy(Fragment.from(cells)), tallest];
  }

  const children: Node[] = [];
  let used = 0;
  node.forEach((child) => {
    if (used >= budget) return;
    const [kept, lines] = truncate(child, budget - used);
    children.push(kept);
    used += lines;
  });
  return [node.copy(Fragment.from(children)), Math.max(used, 1)];
}
