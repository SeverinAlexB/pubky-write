// Structured editing of an equation (spec 20, "Editing an equation"): the keys typed at the caret
// and what they do to the model. Every function takes the state and returns a new one, or says
// that the caret leaves the equation ("before" or "after" it).
import {
  getSlot,
  isEmptyRow,
  isEmptyStructure,
  isStructure,
  replaceRowAt,
  rowAt,
  setSlot,
  slotNames,
  type Caret,
  type MathAtom,
  type MathRow,
  type PathStep,
} from "./model.ts";
import { accents, closingBracket, isAccentCommand, operatorNames, symbolForCommand } from "./symbols.ts";

export type EquationState = { row: MathRow; caret: Caret };
export type Exit = "before" | "after";
export type EditResult = EquationState | Exit;

export const startOf = (row: MathRow): EquationState => ({ row, caret: { path: [], offset: 0 } });
export const endOf = (row: MathRow): EquationState => ({ row, caret: { path: [], offset: row.length } });

function currentRow(state: EquationState): MathRow {
  return rowAt(state.row, state.caret.path);
}

function withRow(state: EquationState, row: MathRow, offset: number): EquationState {
  return { row: replaceRowAt(state.row, state.caret.path, row), caret: { path: state.caret.path, offset } };
}

/** The first slot of the first structure in `atoms` (inserted at `index` of the row at `path`), if any. */
function firstSlotCaret(path: PathStep[], index: number, atoms: MathRow): Caret | null {
  for (let at = 0; at < atoms.length; at++) {
    const atom = atoms[at]!;
    const slot = slotNames(atom)[0];
    if (isStructure(atom) && slot !== undefined) return { path: [...path, { index: index + at, slot }], offset: 0 };
  }
  return null;
}

/**
 * Inserts atoms at the caret. With `enterSlot`, the caret goes into the first slot of the first
 * structure inserted (a fraction's numerator); otherwise after them.
 */
export function insertAtoms(state: EquationState, atoms: MathRow, enterSlot = true): EquationState {
  const row = currentRow(state);
  const { offset, path } = state.caret;
  const updated = [...row.slice(0, offset), ...atoms, ...row.slice(offset)];
  const next = withRow(state, updated, offset + atoms.length);
  const inside = enterSlot ? firstSlotCaret(path, offset, atoms) : null;
  return inside ? { row: next.row, caret: inside } : next;
}

/** What a backslash command becomes: a symbol, a structure with empty slots, or (unknown) its text. */
export function commandAtoms(name: string): MathRow {
  const command = `\\${name}`;
  const empty = (): MathRow => [];
  switch (command) {
    case "\\frac":
      return [{ kind: "frac", num: empty(), den: empty() }];
    case "\\sqrt":
      return [{ kind: "sqrt", index: null, body: empty() }];
    case "\\nroot":
      return [{ kind: "sqrt", index: empty(), body: empty() }];
    case "\\sum":
    case "\\prod":
    case "\\coprod":
    case "\\bigcap":
    case "\\bigcup":
    case "\\int":
    case "\\oint":
      return [{ kind: "char", char: symbolForCommand(command)!.char }, { kind: "scripts", sub: empty(), sup: empty() }];
    case "\\lim":
      return [{ kind: "name", name: "lim" }, { kind: "scripts", sub: empty(), sup: null }];
  }
  if (isAccentCommand(command) && accents[command].char) return [{ kind: "accent", command, body: empty() }];
  if (operatorNames.includes(name)) return [{ kind: "name", name }];
  const symbol = symbolForCommand(command);
  if (symbol && name) return [{ kind: "char", char: symbol.char }];
  // Unknown: stays as the typed text.
  return [...command].map((char) => ({ kind: "char", char }));
}

/** Turns a command being typed (the atom before the caret) into what it names. */
function finishCommandBeforeCaret(state: EquationState): EquationState {
  const row = currentRow(state);
  const { offset } = state.caret;
  const atom = row[offset - 1];
  if (atom?.kind !== "command") return state;
  const removed = withRow(state, [...row.slice(0, offset - 1), ...row.slice(offset)], offset - 1);
  return insertAtoms(removed, commandAtoms(atom.name));
}

/** Turns every command still being typed into what it names (when the caret leaves the equation). */
export function finishCommands(row: MathRow): MathRow {
  return row.flatMap((atom): MathRow => {
    if (atom.kind === "command") return commandAtoms(atom.name);
    if (!isStructure(atom)) return [atom];
    let result: MathAtom = atom;
    for (const slot of slotNames(atom)) result = setSlot(result, slot, finishCommands(getSlot(atom, slot)));
    return [result];
  });
}

const openingBrackets: Record<string, string> = { "(": "(", "[": "[", "{": "{" };

/** Typing one character at the caret. */
export function typeChar(state: EquationState, char: string): EquationState {
  const row = currentRow(state);
  const { offset } = state.caret;
  const before = row[offset - 1];
  if (before?.kind === "command") {
    if (/^[a-zA-Z]$/.test(char)) return withRow(state, row.map((atom, index) => (index === offset - 1 ? { kind: "command", name: before.name + char } : atom)), offset);
    if (before.name === "") {
      // `\{` is a brace; `\|` a double bar; any other `\` and non-letter is that character.
      const removed = withRow(state, [...row.slice(0, offset - 1), ...row.slice(offset)], offset - 1);
      if (char === "{") return insertAtoms(removed, [{ kind: "fence", open: "{", close: "}", body: [] }]);
      if (char === " ") return insertAtoms(removed, [{ kind: "char", char: "\\" }]);
      return insertAtoms(removed, [{ kind: "char", char: char === "|" ? "‖" : char }]);
    }
    // Any other character ends the command; a space only ends it.
    const finished = finishCommandBeforeCaret(state);
    return char === " " ? finished : typeChar(finished, char);
  }
  if (char === "\\") return insertAtoms(state, [{ kind: "command", name: "" }]);
  if (char === "^" || char === "_") return startScript(state, char === "^" ? "sup" : "sub");
  if (char === " ") return state;
  const open = openingBrackets[char];
  if (open) return insertAtoms(state, [{ kind: "fence", open, close: closingBracket[open]!, body: [] }]);
  if (")]}".includes(char)) {
    // Typing the closing bracket at the end of brackets steps out of them.
    const step = state.caret.path[state.caret.path.length - 1];
    const parent = step && rowAt(state.row, state.caret.path.slice(0, -1))[step.index];
    if (parent?.kind === "fence" && parent.close === char && offset === row.length) {
      return { row: state.row, caret: { path: state.caret.path.slice(0, -1), offset: step!.index + 1 } };
    }
  }
  return insertAtoms(state, [{ kind: "char", char: char === "~" ? "∼" : char === "*" ? "∗" : char }]);
}

/** `^` or `_`: into the superscript or subscript of the atom before the caret, made if needed. */
function startScript(state: EquationState, slot: "sub" | "sup"): EquationState {
  const row = currentRow(state);
  const { offset, path } = state.caret;
  for (const index of [offset - 1, offset]) {
    const atom = row[index];
    if (atom?.kind !== "scripts") continue;
    const existing = atom[slot];
    const updated: MathAtom = existing ? atom : { ...atom, [slot]: [] };
    const next = withRow(state, row.map((candidate, at) => (at === index ? updated : candidate)), offset);
    return { row: next.row, caret: { path: [...path, { index, slot }], offset: existing?.length ?? 0 } };
  }
  return insertAtoms(state, [{ kind: "scripts", sub: slot === "sub" ? [] : null, sup: slot === "sup" ? [] : null }]);
}

/** The parent structure of the caret's row: its row's path, its index and the slot the caret is in. */
function parentOf(caret: Caret): { path: PathStep[]; index: number; slot: string } | null {
  const step = caret.path[caret.path.length - 1];
  return step ? { path: caret.path.slice(0, -1), index: step.index, slot: step.slot } : null;
}

export function moveRight(state: EquationState): EditResult {
  const finished = finishCommandBeforeCaretIfAny(state);
  if (finished !== state) return finished;
  const row = currentRow(state);
  const { offset, path } = state.caret;
  if (offset < row.length) {
    const atom = row[offset]!;
    const slot = slotNames(atom)[0];
    if (slot !== undefined) return { row: state.row, caret: { path: [...path, { index: offset, slot }], offset: 0 } };
    return { row: state.row, caret: { path, offset: offset + 1 } };
  }
  return leaveSlot(state, 1);
}

export function moveLeft(state: EquationState): EditResult {
  const row = currentRow(state);
  const { offset, path } = state.caret;
  if (offset > 0) {
    const atom = row[offset - 1]!;
    const slots = slotNames(atom);
    const slot = slots[slots.length - 1];
    if (slot !== undefined) return { row: state.row, caret: { path: [...path, { index: offset - 1, slot }], offset: getSlot(atom, slot).length } };
    return { row: state.row, caret: { path, offset: offset - 1 } };
  }
  return leaveSlot(state, -1);
}

/** The caret goes to the next (or previous) slot of its structure, or out of it. */
function leaveSlot(state: EquationState, direction: 1 | -1): EditResult {
  const parent = parentOf(state.caret);
  if (!parent) return direction > 0 ? "after" : "before";
  const atom = rowAt(state.row, parent.path)[parent.index]!;
  const slots = slotNames(atom);
  const next = slots[slots.indexOf(parent.slot) + direction];
  if (next !== undefined) {
    return { row: state.row, caret: { path: [...parent.path, { index: parent.index, slot: next }], offset: direction > 0 ? 0 : getSlot(atom, next).length } };
  }
  return { row: state.row, caret: { path: parent.path, offset: parent.index + (direction > 0 ? 1 : 0) } };
}

function finishCommandBeforeCaretIfAny(state: EquationState): EquationState {
  return currentRow(state)[state.caret.offset - 1]?.kind === "command" ? finishCommandBeforeCaret(state) : state;
}

/** Tab (and → at the end of a slot): out of the current slot, to the next one or after the structure. */
export function nextSlot(state: EquationState): EditResult {
  const finished = finishCommandBeforeCaretIfAny(state);
  if (finished !== state) return finished;
  return leaveSlot(state, 1);
}

export function previousSlot(state: EquationState): EditResult {
  return leaveSlot(state, -1);
}

const verticalTargets: Record<string, Record<"up" | "down", string | undefined>> = {
  num: { up: undefined, down: "den" },
  den: { up: "num", down: undefined },
  sup: { up: undefined, down: "sub" },
  sub: { up: "sup", down: undefined },
  index: { up: undefined, down: "body" },
};

/** ↑ / ↓: between a fraction's numerator and denominator (and a script's two parts), or null. */
export function moveVertically(state: EquationState, direction: "up" | "down"): EquationState | null {
  const { path } = state.caret;
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const step = path[depth]!;
    const atom = rowAt(state.row, path.slice(0, depth))[step.index]!;
    let target = verticalTargets[step.slot]?.[direction];
    if (step.slot.startsWith("cell:") && atom.kind === "matrix") {
      const [, r, c] = step.slot.split(":").map(Number) as [string, number, number];
      const row = r + (direction === "down" ? 1 : -1);
      if (row >= 0 && row < atom.rows.length) target = `cell:${row}:${c}`;
    }
    if (!target || !slotNames(atom).includes(target)) continue;
    const offset = Math.min(depth === path.length - 1 ? state.caret.offset : Infinity, getSlot(atom, target).length);
    return { row: state.row, caret: { path: [...path.slice(0, depth), { index: step.index, slot: target }], offset } };
  }
  return null;
}

/** Backspace. "before" when the caret is at the start of the equation: it leaves the equation. */
export function backspace(state: EquationState): EditResult {
  const row = currentRow(state);
  const { offset, path } = state.caret;
  if (offset > 0) {
    const atom = row[offset - 1]!;
    if (atom.kind === "command" && atom.name) {
      return withRow(state, row.map((candidate, index) => (index === offset - 1 ? { kind: "command", name: atom.name.slice(0, -1) } : candidate)), offset);
    }
    if (isStructure(atom) && !isEmptyStructure(atom)) {
      // Into the structure, at the end of its last slot, to delete its content first.
      const slots = slotNames(atom);
      const slot = slots[slots.length - 1]!;
      return { row: state.row, caret: { path: [...path, { index: offset - 1, slot }], offset: getSlot(atom, slot).length } };
    }
    return withRow(state, [...row.slice(0, offset - 1), ...row.slice(offset)], offset - 1);
  }
  const parent = parentOf(state.caret);
  if (!parent) return "before";
  if (!isEmptyRow(row)) return leaveSlot(state, -1);
  return removeStructure(state, parent);
}

/** Backspace at the start of an empty slot: the structure goes, keeping what its other slots hold. */
function removeStructure(state: EquationState, parent: { path: PathStep[]; index: number; slot: string }): EquationState {
  const parentRow = rowAt(state.row, parent.path);
  const atom = parentRow[parent.index]!;
  const replaceWith = (atoms: MathRow, caretOffset: number): EquationState => {
    const updated = [...parentRow.slice(0, parent.index), ...atoms, ...parentRow.slice(parent.index + 1)];
    return { row: replaceRowAt(state.row, parent.path, updated), caret: { path: parent.path, offset: caretOffset } };
  };
  if (atom.kind === "scripts") {
    // Only that script goes; the other stays.
    const updated: MathAtom = { ...atom, [parent.slot]: null };
    const remaining = updated.kind === "scripts" && (updated.sub || updated.sup);
    return replaceWith(remaining ? [updated] : [], parent.index);
  }
  if (atom.kind === "sqrt" && parent.slot === "index") {
    const updated = [...parentRow.slice(0, parent.index), { ...atom, index: null }, ...parentRow.slice(parent.index + 1)];
    return { row: replaceRowAt(state.row, parent.path, updated), caret: { path: [...parent.path, { index: parent.index, slot: "body" }], offset: 0 } };
  }
  const slots = slotNames(atom);
  const contents = slots.map((slot) => getSlot(atom, slot));
  const before = contents.slice(0, slots.indexOf(parent.slot)).reduce((sum, content) => sum + content.length, 0);
  return replaceWith(contents.flat(), parent.index + before);
}

/** Delete: the atom after the caret (or into the structure after it). */
export function deleteForward(state: EquationState): EditResult {
  const row = currentRow(state);
  const { offset, path } = state.caret;
  if (offset < row.length) {
    const atom = row[offset]!;
    if (isStructure(atom) && !isEmptyStructure(atom)) {
      return { row: state.row, caret: { path: [...path, { index: offset, slot: slotNames(atom)[0]! }], offset: 0 } };
    }
    return withRow(state, [...row.slice(0, offset), ...row.slice(offset + 1)], offset);
  }
  const parent = parentOf(state.caret);
  if (!parent) return state;
  if (isEmptyRow(row)) return removeStructure(state, parent);
  return leaveSlot(state, 1);
}

/** Every caret position of an equation, in order (for placing the caret where it is clicked). */
export function caretPositions(row: MathRow, path: PathStep[] = []): Caret[] {
  const result: Caret[] = [];
  const current = rowAt(row, path);
  for (let offset = 0; offset <= current.length; offset++) {
    result.push({ path, offset });
    const atom = current[offset];
    if (!atom) continue;
    for (const slot of slotNames(atom)) result.push(...caretPositions(row, [...path, { index: offset, slot }]));
  }
  return result;
}

export function sameCaret(a: Caret, b: Caret): boolean {
  return a.offset === b.offset && a.path.length === b.path.length && a.path.every((step, index) => step.index === b.path[index]!.index && step.slot === b.path[index]!.slot);
}

/** Keeps a caret inside the equation after its row changed outside the editor (undo): the end, if it no longer fits. */
export function validCaret(row: MathRow, caret: Caret): Caret {
  try {
    let current = row;
    for (const step of caret.path) {
      const atom = current[step.index];
      if (!atom || !slotNames(atom).includes(step.slot)) return { path: [], offset: row.length };
      current = getSlot(atom, step.slot);
    }
    return caret.offset <= current.length ? caret : { path: caret.path, offset: current.length };
  } catch {
    return { path: [], offset: row.length };
  }
}
