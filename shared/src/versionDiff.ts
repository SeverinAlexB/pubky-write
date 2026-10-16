// Comparing two versions of a document: the smallest replacement that turns one into the
// other (used to restore versions), and the changed ranges between them (used to
// highlight changes in version history).
import type { Fragment, Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { ChangeSet, simplifyChanges } from "@tiptap/pm/changeset";
import { documentTabs, hasTabNodes, wrapInTab } from "./documentTabs.ts";
import { columnKeys } from "./columns.ts";
import { pageElementKeys } from "./pageElements.ts";
import { pageSetupKeys } from "./pageSetup.ts";
import { equationTokens } from "./equation.ts";

/**
 * A transform that turns `doc` into `target` by replacing only the ranges where they differ,
 * and setting the page settings that differ. With tabs, each tab is compared with the tab with
 * the same id: tabs only in `doc` are deleted, tabs only in `target` added, and the others get
 * the target's attributes (name, emoji, place) by attribute steps and their differing content
 * replaced, so comments on unchanged text keep their anchors. A target from before the document
 * had tab nodes is compared as its first tab.
 */
export function replaceDifference(doc: Node, source: Node): Transform {
  const transform = new Transform(doc);
  for (const key of [...pageSetupKeys, ...pageElementKeys, ...columnKeys]) {
    if (JSON.stringify(doc.attrs[key]) !== JSON.stringify(source.attrs[key])) transform.setDocAttribute(key, source.attrs[key]);
  }
  if (!hasTabNodes(doc) && !hasTabNodes(source)) {
    replaceChanged(transform, 0, doc.content, source);
    return transform;
  }
  const target = hasTabNodes(source) ? source : wrapInTab(new Transform(source)).doc;
  wrapInTab(transform);
  const wanted = new Map(documentTabs(target).map((tab) => [tab.id, tab]));
  // From the end, so the positions of the tabs before stay valid.
  for (const tab of [...documentTabs(transform.doc)].reverse()) {
    const goal = wanted.get(tab.id);
    if (!goal) {
      transform.delete(tab.pos!, tab.pos! + tab.node.nodeSize);
      continue;
    }
    for (const [key, value] of Object.entries(goal.node.attrs)) {
      if (JSON.stringify(tab.node.attrs[key]) !== JSON.stringify(value)) transform.setNodeAttribute(tab.pos!, key, value);
    }
    replaceChanged(transform, tab.from, tab.node.content, goal.node);
  }
  const kept = new Set(documentTabs(transform.doc).map((tab) => tab.id));
  for (const tab of documentTabs(target)) {
    if (kept.has(tab.id)) continue;
    // Deleting every tab of the document leaves a paragraph in place of the tab nodes.
    if (!hasTabNodes(transform.doc)) transform.replaceWith(0, transform.doc.content.size, tab.node);
    else transform.insert(transform.doc.content.size, tab.node);
  }
  return transform;
}

/** Replaces the part of `content` (starting at `offset`) that differs from `target`'s content. */
function replaceChanged(transform: Transform, offset: number, content: Fragment, target: Node): void {
  const start = content.findDiffStart(target.content);
  if (start === null) return;
  let { a: endA, b: endB } = content.findDiffEnd(target.content)!;
  // When the differing ranges overlap (for example a repeated character), move both ends past the start.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  transform.replace(offset + start, offset + endA, target.slice(start, endB));
}

/** One changed range: `from`–`to` was added in the newer version, `deleted` is the text it replaced. */
export type VersionEdit = {
  /** Range in the newer document; empty when text was only removed. */
  from: number;
  to: number;
  /** Text of the older version that this range replaced, blocks separated by a space. */
  deleted: string;
};

/**
 * The edits that turn `before` into `after`, in document order. Each tab of `after` is compared
 * with the tab of `before` with the same id (a new tab with nothing): its blocks are matched
 * first, then the text of each run of changed blocks is compared character by character and
 * simplified to whole words, so retyping part of a word marks the word. Formatting, page
 * setting and tab name changes are not edits.
 */
export function versionEdits(before: Node, after: Node): VersionEdit[] {
  if (!hasTabNodes(before) && !hasTabNodes(after)) return blockEdits(before, after);
  const beforeTabs = new Map(documentTabs(before).map((tab) => [tab.id, tab]));
  const blocksOf = (node: Node) => after.type.create(null, node.content);
  const empty = after.type.createAndFill()!;
  return documentTabs(after).flatMap((tab) => {
    const previous = beforeTabs.get(tab.id);
    return blockEdits(previous ? blocksOf(previous.node) : empty, blocksOf(tab.node)).map((edit) => ({
      ...edit,
      from: edit.from + tab.from,
      to: edit.to + tab.from,
    }));
  });
}

/** The edits between two documents of blocks. */
function blockEdits(before: Node, after: Node): VersionEdit[] {
  const transform = new Transform(before);
  // From the end, so the positions of earlier runs stay valid.
  for (const run of changedBlockRuns(before, after).reverse()) {
    transform.replace(run.fromA, run.toA, after.slice(run.fromB, run.toB));
  }
  const changes = ChangeSet.create(before, undefined, equationTokens).addSteps(transform.doc, transform.mapping.maps, null).changes;
  return simplifyChanges(changes, transform.doc).map((change) => ({
    from: change.fromB,
    to: change.toB,
    deleted: before.textBetween(change.fromA, change.toA, " ", " "),
  }));
}

type BlockRun = { fromA: number; toA: number; fromB: number; toB: number };

/**
 * Runs of top-level blocks that differ between the documents, from a longest common
 * subsequence of equal blocks. Positions are in `before` (A) and `after` (B).
 */
export function changedBlockRuns(before: Node, after: Node): BlockRun[] {
  const a = children(before);
  const b = children(after);
  // Equal blocks at the start and end need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start]!.node.eq(b[start]!.node)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1]!.node.eq(b[endB - 1]!.node)) {
    endA--;
    endB--;
  }

  // common[i][j]: length of the longest common subsequence of a[start + i..endA) and b[start + j..endB).
  const rows = endA - start;
  const columns = endB - start;
  const common = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      common[i]![j] = a[start + i]!.node.eq(b[start + j]!.node)
        ? common[i + 1]![j + 1]! + 1
        : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }

  const runs: BlockRun[] = [];
  let run: { i: number; j: number } | null = null;
  const closeRun = (i: number, j: number) => {
    if (!run) return;
    runs.push({
      fromA: blockStart(a, start + run.i, before),
      toA: blockStart(a, start + i, before),
      fromB: blockStart(b, start + run.j, after),
      toB: blockStart(b, start + j, after),
    });
    run = null;
  };
  let i = 0;
  let j = 0;
  while (i < rows || j < columns) {
    if (i < rows && j < columns && a[start + i]!.node.eq(b[start + j]!.node)) {
      closeRun(i, j);
      i++;
      j++;
      continue;
    }
    run ??= { i, j };
    if (j < columns && (i === rows || common[i]![j + 1]! >= common[i + 1]![j]!)) j++;
    else i++;
  }
  closeRun(i, j);
  return runs;
}

type Child = { node: Node; pos: number };

function children(doc: Node): Child[] {
  const result: Child[] = [];
  doc.forEach((node, pos) => result.push({ node, pos }));
  return result;
}

/** Position of block `index`, or the end of the content after the last block. */
function blockStart(blocks: Child[], index: number, doc: Node): number {
  return blocks[index]?.pos ?? doc.content.size;
}
