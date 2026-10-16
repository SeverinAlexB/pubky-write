// Draws an equation as MathML, which the browsers lay out themselves (MathML Core). While an
// equation is edited, every row carries `data-path` and every atom `data-atom` (its index in the
// row), so the editor can place the caret from their boxes, and empty slots show a dotted box.
import { type MathAtom, type MathRow, type PathStep } from "./model.ts";
import { accents, classOfChar, namesWithLimitsUnder } from "./symbols.ts";

export const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** An element: its name (HTML elements as `html:span`), attributes and children. */
export type MathElement = { tag: string; attrs: Record<string, string>; children: (MathElement | string)[] };

type RenderOptions = {
  /** Annotate rows and atoms and show empty slots, for the editor. */
  editing: boolean;
  /** Draws LaTeX the model does not cover (temml, when loaded); without it, the LaTeX shows as text. */
  raw?: (latex: string) => MathElement | null;
};

const element = (tag: string, attrs: Record<string, string> = {}, ...children: (MathElement | string)[]): MathElement => ({
  tag,
  attrs,
  children,
});

/** The `<math>` element of an equation. */
export function equationMathML(row: MathRow, options: RenderOptions): MathElement {
  return element("math", {}, renderRow(row, [], options));
}

export function pathKey(path: readonly PathStep[]): string {
  return path.map((step) => `${step.index}.${step.slot}`).join("/");
}

function renderRow(row: MathRow, path: PathStep[], options: RenderOptions): MathElement {
  const attrs: Record<string, string> = options.editing ? { "data-path": pathKey(path) } : {};
  if (row.length === 0) {
    if (!options.editing) return element("mrow", attrs);
    return element("mrow", { ...attrs, class: "eq-empty" }, element("mtext", {}, element("html:span", { class: "eq-slot" })));
  }
  const out: MathElement[] = [];
  row.forEach((atom, index) => {
    const annotate = (rendered: MathElement) => {
      if (options.editing) rendered.attrs["data-atom"] = String(index);
      return rendered;
    };
    if (atom.kind === "scripts") {
      // Scripts take the element before them as their base (an empty one at the start of a row).
      const previous = row[index - 1];
      const base = previous && previous.kind !== "scripts" ? out.pop()! : element("mrow");
      const slot = (name: "sub" | "sup", script: MathRow) => renderRow(script, [...path, { index, slot: name }], options);
      const under = previous && limitsUnder(previous);
      const tags = under ? (["munderover", "munder", "mover"] as const) : (["msubsup", "msub", "msup"] as const);
      let rendered: MathElement;
      if (atom.sub && atom.sup) rendered = element(tags[0], {}, base, slot("sub", atom.sub), slot("sup", atom.sup));
      else if (atom.sub) rendered = element(tags[1], {}, base, slot("sub", atom.sub));
      else rendered = element(tags[2], {}, base, slot("sup", atom.sup ?? []));
      out.push(annotate(rendered));
      return;
    }
    out.push(annotate(renderAtom(atom, index, path, options)));
  });
  return element("mrow", attrs, ...out);
}

/** Whether scripts after this atom are drawn under and over it (∑, ∏, lim) rather than beside it. */
function limitsUnder(atom: MathAtom): boolean {
  if (atom.kind === "char") return classOfChar(atom.char) === "large";
  if (atom.kind === "name") return namesWithLimitsUnder.has(atom.name);
  return false;
}

const uprightGreek = /^[Α-Ω]$/;

function renderChar(char: string): MathElement {
  if (/^[0-9]$/.test(char)) return element("mn", {}, char);
  // A typed hyphen is a minus sign.
  if (char === "-") return element("mo", {}, "−");
  switch (classOfChar(char)) {
    case "op":
      return element("mo", {}, char);
    case "punct":
      return element("mo", { separator: "true" }, char);
    case "open":
    case "close":
      return element("mo", { stretchy: "false" }, char);
    case "large":
      return element("mo", { class: "eq-large", movablelimits: "false" }, char);
    case "integral":
      return element("mo", { class: "eq-large eq-integral" }, char);
    default:
      if (char === " ") return element("mspace", { width: "0.25em" });
      if (char === ".") return element("mn", {}, char);
      return uprightGreek.test(char) ? element("mi", { mathvariant: "normal" }, char) : element("mi", {}, char);
  }
}

function renderAtom(atom: MathAtom, index: number, path: PathStep[], options: RenderOptions): MathElement {
  const slot = (name: string, row: MathRow) => renderRow(row, [...path, { index, slot: name }], options);
  switch (atom.kind) {
    case "char":
      return renderChar(atom.char);
    case "name":
      return element("mrow", {}, element("mi", {}, atom.name), element("mo", {}, "⁡"));
    case "text":
      return atom.style === "rm" ? element("mi", { mathvariant: "normal" }, atom.text) : element("mtext", {}, atom.text);
    case "frac":
      return element("mfrac", {}, slot("num", atom.num), slot("den", atom.den));
    case "sqrt":
      return atom.index ? element("mroot", {}, slot("body", atom.body), slot("index", atom.index)) : element("msqrt", {}, slot("body", atom.body));
    case "fence":
      return element(
        "mrow",
        {},
        element("mo", { fence: "true", stretchy: "true", form: "prefix" }, atom.open),
        slot("body", atom.body),
        element("mo", { fence: "true", stretchy: "true", form: "postfix" }, atom.close),
      );
    case "accent": {
      const accent = accents[atom.command];
      const body = slot("body", atom.body);
      if (atom.command === "\\boxed") return element("mrow", { class: "eq-boxed" }, body);
      if (atom.command === "\\phantom") return element("mphantom", {}, body);
      const mark = element("mo", { stretchy: "stretch" in accent && accent.stretch ? "true" : "false" }, accent.char);
      return accent.over ? element("mover", { accent: "true" }, body, mark) : element("munder", { accentunder: "true" }, body, mark);
    }
    case "matrix": {
      const table = element(
        "mtable",
        {},
        ...atom.rows.map((cells, r) => element("mtr", {}, ...cells.map((cell, c) => element("mtd", {}, slot(`cell:${r}:${c}`, cell))))),
      );
      const fences: Record<string, [string, string]> = {
        pmatrix: ["(", ")"],
        bmatrix: ["[", "]"],
        Bmatrix: ["{", "}"],
        vmatrix: ["|", "|"],
        Vmatrix: ["‖", "‖"],
        cases: ["{", ""],
      };
      const fence = fences[atom.env];
      if (!fence) return table;
      return element("mrow", {}, element("mo", { fence: "true" }, fence[0]), table, element("mo", { fence: "true" }, fence[1]));
    }
    case "command":
      return element("mtext", { class: "eq-command" }, `\\${atom.name}`);
    case "raw":
      return options.raw?.(atom.latex) ?? element("mtext", { class: "eq-raw" }, atom.latex);
    case "scripts":
      // Drawn with the atom before them (renderRow).
      return element("mrow");
  }
}

/** The element as HTML text (for the server and tests). */
export function mathMLString(node: MathElement | string): string {
  if (typeof node === "string") return node.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);
  const tag = node.tag.replace(/^html:/, "");
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${value.replace(/[&"<]/g, (char) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;" })[char]!)}"`)
    .join("");
  return `<${tag}${attrs}>${node.children.map(mathMLString).join("")}</${tag}>`;
}
