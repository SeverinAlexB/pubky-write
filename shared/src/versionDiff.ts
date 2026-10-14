// Comparing two versions of a document: the smallest replacement that turns one into the
// other (used to restore versions), and the changed ranges between them (used to
// highlight changes in version history).
import type { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { ChangeSet, simplifyChanges } from "@tiptap/pm/changeset";
import { pageElementKeys } from "./pageElements.ts";
import { pageSetupKeys } from "./pageSetup.ts";

/**
 * A transform that turns `doc` into `target` by replacing only the range where they differ,
 * and setting the page settings that differ.
 */
export function replaceDifference(doc: Node, target: Node): Transform {
  const transform = new Transform(doc);
  for (const key of [...pageSetupKeys, ...pageElementKeys]) {
    if (JSON.stringify(doc.attrs[key]) !== JSON.stringify(target.attrs[key])) transform.setDocAttribute(key, target.attrs[key]);
  }
  const start = doc.content.findDiffStart(target.content);
  if (start === null) return transform;
  let { a: endA, b: endB } = doc.content.findDiffEnd(target.content)!;
  // When the differing ranges overlap (for example a repeated character), move both ends past the start.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return transform.replace(start, endA, target.slice(start, endB));
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
 * The edits that turn `before` into `after`, in document order. Top-level blocks are matched
 * first, then the text of each run of changed blocks is compared character by character and
 * simplified to whole words, so retyping part of a word marks the word. Formatting and page
 * setting changes are not edits.
 */
export function versionEdits(before: Node, after: Node): VersionEdit[] {
  const transform = new Transform(before);
  // From the end, so the positions of earlier runs stay valid.
  for (const run of changedBlockRuns(before, after).reverse()) {
    transform.replace(run.fromA, run.toA, after.slice(run.fromB, run.toB));
  }
  const changes = ChangeSet.create(before).addSteps(transform.doc, transform.mapping.maps, null).changes;
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
