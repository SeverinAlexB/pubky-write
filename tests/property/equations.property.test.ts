// Property tests of equations: random equations read back unchanged from their LaTeX, from the
// Office Math a Word export writes and from the `$…$` a Markdown export writes. PROPERTY_RUNS and
// PROPERTY_SEED as in sync.property.test.ts.
import { documentSchema, toMarkdown } from "@pubky-write/shared";
import {
  arrows,
  greekLetters,
  largeOperators,
  miscellaneousOperations,
  operatorNames,
  parseLatex,
  relations,
  toLatex,
  type AccentCommand,
  type MathAtom,
  type MathRow,
} from "@pubky-write/shared/equations";
import { Node } from "@tiptap/pm/model";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { xml2js } from "xml-js";
import { markdownToDocument } from "../../server/src/import/markdown.ts";
import { mathToOmml, ommlToMath, xmlString, type OmmlElement } from "../../server/src/omml.ts";

const runs = Number(process.env.PROPERTY_RUNS) || 100;
const seed = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : undefined;
const settings = { numRuns: runs, ...(seed !== undefined && { seed }) };

const symbolChars = [...greekLetters, ...miscellaneousOperations, ...relations, ...arrows, ...largeOperators].map((symbol) => symbol.char);
const chars = [..."abcxyzABXY0123456789+-=<>,.()[]|!/:;′{}#%&$ \\", ...symbolChars];
const accentCommands: AccentCommand[] = [
  "\\hat",
  "\\bar",
  "\\overline",
  "\\underline",
  "\\tilde",
  "\\vec",
  "\\dot",
  "\\ddot",
  "\\check",
  "\\breve",
  "\\acute",
  "\\grave",
  "\\overbrace",
  "\\underbrace",
  "\\boxed",
  "\\phantom",
];
const fences: [string, string][] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["|", "|"],
  ["‖", "‖"],
  ["⟨", "⟩"],
  ["⌊", "⌋"],
  ["(", ""],
  ["", ")"],
];
const environments = ["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "cases", "gathered"];

const letters = fc.string({ unit: fc.constantFrom(..."abcdefxyzKLM"), minLength: 1, maxLength: 4 });

/** Random equations: every kind of atom the editor and imports make (no raw LaTeX, no command being typed). */
const { row } = fc.letrec<{ row: MathRow; atom: MathAtom }>((tie) => {
  const row = () => fc.array(tie("atom"), { maxLength: 4 }) as fc.Arbitrary<MathRow>;
  const scriptsRow = fc.option(row(), { nil: null });
  return {
    row: row(),
    atom: fc.oneof(
      { maxDepth: 3, withCrossShrink: true },
      { weight: 6, arbitrary: fc.constantFrom(...chars).map((char): MathAtom => ({ kind: "char", char })) },
      fc.constantFrom(...operatorNames).map((name): MathAtom => ({ kind: "name", name })),
      letters.filter((text) => !operatorNames.includes(text)).map((text): MathAtom => ({ kind: "text", text, style: "rm" })),
      fc.string({ unit: fc.constantFrom(..."ab if,"), minLength: 1, maxLength: 5 }).map((text): MathAtom => ({ kind: "text", text, style: "text" })),
      fc.record({ num: row(), den: row() }).map((parts): MathAtom => ({ kind: "frac", ...parts })),
      fc.record({ index: scriptsRow, body: row() }).map((parts): MathAtom => ({ kind: "sqrt", ...parts })),
      fc
        .record({ sub: scriptsRow, sup: scriptsRow })
        .filter((parts) => parts.sub !== null || parts.sup !== null)
        .map((parts): MathAtom => ({ kind: "scripts", ...parts })),
      fc.record({ fence: fc.constantFrom(...fences), body: row() }).map(({ fence, body }): MathAtom => ({ kind: "fence", open: fence[0], close: fence[1], body })),
      fc.record({ command: fc.constantFrom(...accentCommands), body: row() }).map((parts): MathAtom => ({ kind: "accent", ...parts })),
      fc
        .record({ env: fc.constantFrom(...environments), rows: fc.integer({ min: 1, max: 2 }), columns: fc.integer({ min: 1, max: 2 }), cells: fc.array(row(), { minLength: 4, maxLength: 4 }) })
        .map(({ env, rows, columns, cells }): MathAtom => {
          const width = env === "gathered" ? 1 : columns;
          return { kind: "matrix", env, rows: Array.from({ length: rows }, (_, r) => Array.from({ length: width }, (_, c) => cells[r * 2 + c]!)) };
        }),
    ),
  };
});

/** What a row is once written and read again: adjacent scripts are kept apart by `{}`, so nothing changes. */
const equal = (actual: MathRow, expected: MathRow) => expect(actual).toEqual(expected);

/** Reads OMML text as the Word import does. */
function parseOmml(xml: string): OmmlElement {
  type XmlNode = { type: string; name?: string; attributes?: Record<string, string>; elements?: XmlNode[]; text?: string };
  const convert = (node: XmlNode): OmmlElement => ({
    name: (node.name ?? "").replace(/^\w+:/, ""),
    attributes: Object.fromEntries(Object.entries(node.attributes ?? {}).map(([key, value]) => [key.replace(/^\w+:/, ""), String(value)])),
    children: (node.elements ?? []).filter((child) => child.type === "element").map(convert),
    text: (node.elements ?? []).filter((child) => child.type === "text").map((child) => String(child.text)).join(""),
  });
  const root = xml2js(xml, { compact: false, captureSpacesBetweenElements: true }) as XmlNode;
  return convert(root.elements![0]!);
}

/** Office Math has no form for a bracket pair around a plain matrix other than the bracketed matrix itself. */
function ommlForm(row: MathRow): boolean {
  return row.every((atom) => {
    if (atom.kind === "fence" && atom.body.length === 1 && atom.body[0]!.kind === "matrix" && atom.body[0]!.env === "matrix") return false;
    if (atom.kind === "matrix") return atom.rows.every((cells) => cells.every(ommlForm));
    if (atom.kind === "frac") return ommlForm(atom.num) && ommlForm(atom.den);
    if (atom.kind === "sqrt") return ommlForm(atom.body) && (!atom.index || ommlForm(atom.index));
    if (atom.kind === "scripts") return (!atom.sub || ommlForm(atom.sub)) && (!atom.sup || ommlForm(atom.sup));
    if (atom.kind === "fence" || atom.kind === "accent") return ommlForm(atom.body);
    return true;
  });
}

describe("equations", () => {
  it("read back unchanged from their LaTeX", () => {
    fc.assert(
      fc.property(row, (equation) => {
        const latex = toLatex(equation);
        equal(parseLatex(latex), equation);
        expect(toLatex(parseLatex(latex))).toBe(latex);
      }),
      settings,
    );
  });

  it("read back unchanged from the Office Math of a Word export", () => {
    fc.assert(
      fc.property(row.filter(ommlForm), (equation) => {
        const xml = xmlString(mathToOmml(equation));
        expect(toLatex(ommlToMath(parseOmml(xml)))).toBe(toLatex(equation));
      }),
      settings,
    );
  });

  it("read back unchanged from the $…$ of a Markdown export", async () => {
    await fc.assert(
      fc.asyncProperty(
        row.filter((equation) => toLatex(equation).trim() === toLatex(equation) && toLatex(equation) !== ""),
        async (equation) => {
          const latex = toLatex(equation);
          const doc = Node.fromJSON(documentSchema, {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "a " }, { type: "equation", attrs: { latex } }, { type: "text", text: " b" }] }],
          });
          const { doc: imported } = await markdownToDocument(toMarkdown(doc), { storeImage: async () => null });
          expect(imported.toJSON()).toEqual(doc.toJSON());
        },
      ),
      settings,
    );
  });
});
