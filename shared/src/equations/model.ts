// The equation model: what the editor edits, what LaTeX, MathML and Office Math (OMML) are read
// into and written from. An equation is a row of atoms; structures (fractions, roots, scripts,
// brackets, accents, matrices) hold rows of their own, their slots.
import type { AccentCommand } from "./symbols.ts";

export type MathRow = MathAtom[];

export type MathAtom =
  /** One character: a letter, digit, operator or symbol ("x", "2", "+", "α", "∑"). */
  | { kind: "char"; char: string }
  /** An upright operator name: `\sin`, `\lim`, or `\operatorname{name}`. */
  | { kind: "name"; name: string }
  /** Upright text: `\text{…}` (style "text") or `\mathrm{…}` (style "rm"). */
  | { kind: "text"; text: string; style: "text" | "rm" }
  | { kind: "frac"; num: MathRow; den: MathRow }
  /** A square root, or an n-th root with `index`. */
  | { kind: "sqrt"; index: MathRow | null; body: MathRow }
  /** Subscript and superscript of the atom before it (or of nothing, at the start of a row). */
  | { kind: "scripts"; sub: MathRow | null; sup: MathRow | null }
  /** Brackets that grow with their content (`\left( … \right)`); "" is an invisible bracket. */
  | { kind: "fence"; open: string; close: string; body: MathRow }
  /** An accent or another one-argument wrapper: `\hat{x}`, `\overline{x}`, `\boxed{x}`. */
  | { kind: "accent"; command: AccentCommand; body: MathRow }
  /** `\begin{env} a & b \\ c & d \end{env}`: rows of cells. */
  | { kind: "matrix"; env: string; rows: MathRow[][] }
  /** A backslash command being typed in the editor (`\alp`); never stored. */
  | { kind: "command"; name: string }
  /** LaTeX the model does not cover, kept as written (`\mathbb{R}`). */
  | { kind: "raw"; latex: string };

export type StructureAtom = Extract<MathAtom, { kind: "frac" | "sqrt" | "scripts" | "fence" | "accent" | "matrix" }>;

/** A step into a structure: the atom's index in its row and the name of the slot. */
export type PathStep = { index: number; slot: string };

/** A place between atoms: the row (a path of steps from the equation's row) and the offset in it. */
export type Caret = { path: PathStep[]; offset: number };

export const matrixEnvironments = ["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "cases", "aligned", "gathered"];

export function isStructure(atom: MathAtom): atom is StructureAtom {
  return ["frac", "sqrt", "scripts", "fence", "accent", "matrix"].includes(atom.kind);
}

/** The slots of a structure, in the order the caret moves through them. */
export function slotNames(atom: MathAtom): string[] {
  switch (atom.kind) {
    case "frac":
      return ["num", "den"];
    case "sqrt":
      return atom.index ? ["index", "body"] : ["body"];
    case "scripts":
      return [...(atom.sub ? ["sub"] : []), ...(atom.sup ? ["sup"] : [])];
    case "fence":
    case "accent":
      return ["body"];
    case "matrix":
      return atom.rows.flatMap((row, r) => row.map((_cell, c) => `cell:${r}:${c}`));
    default:
      return [];
  }
}

export function getSlot(atom: MathAtom, slot: string): MathRow {
  if (atom.kind === "matrix") {
    const [, r, c] = slot.split(":");
    return atom.rows[Number(r)]?.[Number(c)] ?? [];
  }
  const value = (atom as Record<string, unknown>)[slot];
  return Array.isArray(value) ? (value as MathRow) : [];
}

export function setSlot(atom: MathAtom, slot: string, row: MathRow): MathAtom {
  if (atom.kind === "matrix") {
    const [, r, c] = slot.split(":").map(Number);
    return { ...atom, rows: atom.rows.map((cells, ri) => (ri === r ? cells.map((cell, ci) => (ci === c ? row : cell)) : cells)) };
  }
  return { ...atom, [slot]: row } as MathAtom;
}

/** The row at `path`. */
export function rowAt(root: MathRow, path: readonly PathStep[]): MathRow {
  let row = root;
  for (const step of path) row = getSlot(row[step.index]!, step.slot);
  return row;
}

/** `root` with the row at `path` replaced. */
export function replaceRowAt(root: MathRow, path: readonly PathStep[], row: MathRow): MathRow {
  if (path.length === 0) return row;
  const [step, ...rest] = path as [PathStep, ...PathStep[]];
  const atom = root[step.index]!;
  const updated = setSlot(atom, step.slot, replaceRowAt(getSlot(atom, step.slot), rest, row));
  return root.map((candidate, index) => (index === step.index ? updated : candidate));
}

export function isEmptyRow(row: MathRow | null): boolean {
  return !row || row.length === 0;
}

/** Whether every slot of a structure is empty. */
export function isEmptyStructure(atom: MathAtom): boolean {
  return isStructure(atom) && slotNames(atom).every((slot) => getSlot(atom, slot).length === 0);
}

/**
 * The characters of an equation in reading order, without separators (as Word stores the text
 * of an equation): for word counts, searching and checking that imports keep every word.
 */
export function mathPlainText(row: MathRow): string {
  return row
    .map((atom) => {
      switch (atom.kind) {
        case "char":
          return atom.char;
        case "name":
          return atom.name;
        case "text":
          return atom.text;
        case "command":
          return `\\${atom.name}`;
        case "raw":
          return rawText(atom.latex);
        case "matrix":
          return atom.rows.map((cells) => cells.map(mathPlainText).join("")).join("");
        default:
          return slotNames(atom)
            .map((slot) => mathPlainText(getSlot(atom, slot)))
            .join("");
      }
    })
    .join("");
}

/** The readable characters of LaTeX the model does not cover: its arguments' text. */
function rawText(latex: string): string {
  return latex.replace(/\\[a-zA-Z]+\*?/g, "").replace(/[{}[\]\\]/g, "");
}

/** Removes `command` atoms (a command still being typed counts as its text). */
export function withoutCommands(row: MathRow): MathRow {
  return row.flatMap((atom): MathRow => {
    if (atom.kind === "command") return [...`\\${atom.name}`].map((char) => ({ kind: "char", char }));
    if (!isStructure(atom)) return [atom];
    let result: MathAtom = atom;
    for (const slot of slotNames(atom)) result = setSlot(result, slot, withoutCommands(getSlot(atom, slot)));
    return [result];
  });
}
