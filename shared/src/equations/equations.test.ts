import { describe, expect, it } from "vitest";
import {
  backspace,
  caretPositions,
  endOf,
  equationMathML,
  insertAtoms,
  mathMLString,
  mathPlainText,
  moveLeft,
  moveRight,
  moveVertically,
  nextSlot,
  parseLatex,
  startOf,
  toLatex,
  typeChar,
  commandAtoms,
  type EditResult,
  type EquationState,
} from "./index.ts";

/** Types each character of `keys`; "→" "←" "↓" "↑" "⇥" and "⌫" stand for the arrow keys, Tab and Backspace. */
function type(keys: string, state: EquationState = startOf([])): EquationState {
  let current: EditResult = state;
  for (const key of keys) {
    if (typeof current === "string") throw new Error(`Left the equation (${current}) before "${key}"`);
    const s: EquationState = current;
    if (key === "→") current = moveRight(s);
    else if (key === "←") current = moveLeft(s);
    else if (key === "↓") current = moveVertically(s, "down") ?? s;
    else if (key === "↑") current = moveVertically(s, "up") ?? s;
    else if (key === "⇥") current = nextSlot(s);
    else if (key === "⌫") current = backspace(s);
    else current = typeChar(s, key);
  }
  if (typeof current === "string") throw new Error(`Left the equation (${current})`);
  return current;
}

const latexOf = (keys: string) => toLatex(type(keys).row);

describe("LaTeX", () => {
  it.each([
    "x^2",
    "x_i^2",
    "x_{ij}^{n+1}",
    "\\frac{a}{b}",
    "\\sqrt{x}",
    "\\sqrt[n]{x}",
    "\\sum_{i=1}^ni",
    "\\lim_{a\\rightarrow b}",
    "\\left(a+b\\right)",
    "\\left\\{x\\right\\}",
    "\\left|x\\right|",
    "\\hat{x}+\\bar{y}+\\overline{z}",
    "\\alpha\\beta\\Gamma",
    "\\sin x",
    "\\text{if }x",
    "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}",
    "{}^2x",
    "x_a{}^b",
    "\\mathbb{R}",
    "f'",
  ])("reads and writes %s unchanged", (latex) => {
    expect(toLatex(parseLatex(latex))).toBe(latex);
  });

  it("reads common spellings", () => {
    expect(toLatex(parseLatex("x^{2}"))).toBe("x^2");
    expect(toLatex(parseLatex("\\le \\to \\ne"))).toBe("\\leq\\rightarrow\\neq");
    expect(toLatex(parseLatex("\\frac12"))).toBe("\\frac{1}{2}");
    expect(toLatex(parseLatex("\\nroot{3}{x}"))).toBe("\\sqrt[3]{x}");
    expect(toLatex(parseLatex("a \\, b"))).toBe("a\\,b");
  });

  it("keeps LaTeX it does not cover as written", () => {
    expect(parseLatex("\\mathbb{R}^n")).toEqual([
      { kind: "raw", latex: "\\mathbb{R}" },
      { kind: "scripts", sub: null, sup: [{ kind: "char", char: "n" }] },
    ]);
    expect(toLatex(parseLatex("\\begin{array}{cc}a&b\\end{array}"))).toBe("\\begin{array}{cc}a&b\\end{array}");
  });

  it("separates a command from a letter after it", () => {
    expect(toLatex([{ kind: "char", char: "α" }, { kind: "char", char: "x" }])).toBe("\\alpha x");
  });

  it("gives the characters in reading order as plain text", () => {
    expect(mathPlainText(parseLatex("\\frac{a+b}{2}+\\sqrt{x}"))).toBe("a+b2+x");
  });
});

describe("typing", () => {
  it("^ starts a superscript and _ a subscript", () => {
    expect(latexOf("x^2")).toBe("x^2");
    expect(latexOf("x_i→^2")).toBe("x_i^2");
    expect(latexOf("x_i^2")).toBe("x_{i^2}");
    expect(latexOf("x^2→+1")).toBe("x^2+1");
  });

  it("backslash commands followed by a space become symbols and structures", () => {
    expect(latexOf("\\alpha ")).toBe("\\alpha");
    expect(latexOf("\\alpha+")).toBe("\\alpha+");
    expect(latexOf("\\frac a↓b")).toBe("\\frac{a}{b}");
    expect(latexOf("\\sqrt x")).toBe("\\sqrt{x}");
    expect(latexOf("\\nroot 3⇥x")).toBe("\\sqrt[3]{x}");
    expect(latexOf("\\sum i=1⇥n⇥i")).toBe("\\sum_{i=1}^ni");
    expect(latexOf("\\lim a\\to b")).toBe("\\lim_{a\\rightarrow b}");
  });

  it("keeps an unknown command as its text", () => {
    expect(mathPlainText(type("\\foo ").row)).toBe("\\foo");
  });

  it("brackets close themselves, and typing the closing bracket steps out", () => {
    expect(latexOf("(a+b)^2")).toBe("\\left(a+b\\right)^2");
    expect(latexOf("[x]")).toBe("\\left[x\\right]");
    expect(latexOf("\\{x}")).toBe("\\left\\{x\\right\\}");
  });

  it("arrows move through the structure", () => {
    const state = type("\\frac a↓b");
    expect(state.caret).toEqual({ path: [{ index: 0, slot: "den" }], offset: 1 });
    const up = moveVertically(state, "up")!;
    expect(up.caret.path[0]!.slot).toBe("num");
    let result: EditResult = up;
    result = moveRight(result as EquationState); // to the denominator
    expect((result as EquationState).caret.path[0]!.slot).toBe("den");
    result = moveRight(moveRight(result as EquationState) as EquationState); // after b, then out
    expect(result).toEqual({ row: state.row, caret: { path: [], offset: 1 } });
    expect(moveRight(result as EquationState)).toBe("after");
    expect(moveLeft(startOf(state.row))).toBe("before");
  });

  it("Backspace at the start of an empty slot removes the structure; at the start of the equation it leaves", () => {
    expect(latexOf("x^⌫")).toBe("x");
    expect(latexOf("\\frac a↓⌫")).toBe("a");
    expect(latexOf("(⌫")).toBe("");
    expect(latexOf("x^2→⌫⌫⌫")).toBe("x");
    expect(backspace(startOf(parseLatex("x")))).toBe("before");
  });

  it("menu structures put the caret in their first slot", () => {
    const state = insertAtoms(endOf(parseLatex("a")), commandAtoms("sqrt"));
    expect(toLatex(typeChar(state, "x").row)).toBe("a\\sqrt{x}");
  });

  it("lists every caret position once", () => {
    const row = parseLatex("\\frac{a}{b}c");
    expect(caretPositions(row)).toHaveLength(7);
  });
});

describe("MathML", () => {
  it("draws structures with MathML elements", () => {
    const html = mathMLString(equationMathML(parseLatex("x^2+\\frac{a}{b}+\\sqrt{x}+\\sum_{a}^{b}"), { editing: false }));
    expect(html).toContain("<msup><mi>x</mi><mrow><mn>2</mn></mrow></msup>");
    expect(html).toContain("<mfrac>");
    expect(html).toContain("<msqrt>");
    expect(html).toContain("<munderover>");
  });

  it("annotates rows and atoms and shows empty slots while editing", () => {
    const html = mathMLString(equationMathML(parseLatex("\\frac{}{b}"), { editing: true }));
    expect(html).toContain('data-path="0.num"');
    expect(html).toContain('class="eq-slot"');
  });
});
