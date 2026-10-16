// Equations in Word files: Office Math (OMML) to the equation model and back. Every structure the
// equation editor makes has a native OMML form, so Word shows and edits exported equations as its
// own; LaTeX the model does not cover is written as normal text in its equation.
import {
  accents,
  classOfChar,
  namesWithLimitsUnder,
  operatorNames,
  type AccentCommand,
  type MathAtom,
  type MathRow,
} from "@docs/shared/equations";

/** An OMML element with namespace prefixes removed, as the Word import reads XML. */
export type OmmlElement = { name: string; attributes: Record<string, string>; children: OmmlElement[]; text: string };

/** An element to write: its name with prefix (`m:f`), attributes and children. */
export type XmlTree = { name: string; attributes?: Record<string, string>; children?: (XmlTree | string)[] };

// Office Math to the model ---------------------------------------------------------------------

/** Accent characters of `m:acc` and the commands they become. */
const accentByChar: Record<string, AccentCommand> = {
  "̂": "\\hat",
  "^": "\\hat",
  "̄": "\\bar",
  "̅": "\\bar",
  "¯": "\\bar",
  "̃": "\\tilde",
  "~": "\\tilde",
  "⃗": "\\vec",
  "⃑": "\\vec",
  "̇": "\\dot",
  "̈": "\\ddot",
  "̌": "\\check",
  "̆": "\\breve",
  "́": "\\acute",
  "̀": "\\grave",
};

/** The OMML accent character of each accent command (the reverse of `accentByChar`). */
const accentChars: Partial<Record<AccentCommand, string>> = {
  "\\hat": "̂",
  "\\widehat": "̂",
  "\\bar": "̅",
  "\\tilde": "̃",
  "\\widetilde": "̃",
  "\\vec": "⃗",
  "\\dot": "̇",
  "\\ddot": "̈",
  "\\check": "̌",
  "\\breve": "̆",
  "\\acute": "́",
  "\\grave": "̀",
};

const MAX_DEPTH = 100;

const childOf = (element: OmmlElement | undefined, name: string) => element?.children.find((candidate) => candidate.name === name);
const property = (element: OmmlElement, properties: string, name: string): string | undefined =>
  childOf(childOf(element, properties), name)?.attributes.val;
const isOn = (element: OmmlElement, properties: string, name: string): boolean => {
  const found = childOf(childOf(element, properties), name);
  return !!found && !["0", "false", "off"].includes(found.attributes.val ?? "1");
};

/** The equation in an `m:oMath` (or `m:oMathPara`) element. */
export function ommlToMath(element: OmmlElement): MathRow {
  return new OmmlReader().row(element.children, 0);
}

class OmmlReader {
  row(elements: OmmlElement[], depth: number): MathRow {
    const row: MathRow = [];
    for (const element of elements) row.push(...this.element(element, depth + 1));
    return row;
  }

  /** The content of a child part (`m:e`, `m:num`…), empty when it is missing. */
  private part(element: OmmlElement, name: string, depth: number): MathRow {
    const found = childOf(element, name);
    return found ? this.row(found.children, depth) : [];
  }

  private element(element: OmmlElement, depth: number): MathRow {
    if (depth > MAX_DEPTH) return textAtoms(allText(element), "text");
    const part = (name: string) => this.part(element, name, depth);
    switch (element.name) {
      case "r":
        return this.run(element);
      case "f":
        return [{ kind: "frac", num: part("num"), den: part("den") }];
      case "sSup":
        return withScripts(part("e"), null, part("sup"));
      case "sSub":
        return withScripts(part("e"), part("sub"), null);
      case "sSubSup":
        return withScripts(part("e"), part("sub"), part("sup"));
      case "sPre":
        return [{ kind: "scripts", sub: part("sub"), sup: part("sup") }, ...part("e")];
      case "rad": {
        const degree = part("deg");
        const hidden = isOn(element, "radPr", "degHide");
        return [{ kind: "sqrt", index: hidden && degree.length === 0 ? null : degree, body: part("e") }];
      }
      case "nary": {
        const char = property(element, "naryPr", "chr") ?? "∫";
        const sub = isOn(element, "naryPr", "subHide") ? null : part("sub");
        const sup = isOn(element, "naryPr", "supHide") ? null : part("sup");
        const scripts: MathRow = sub || sup ? [{ kind: "scripts", sub, sup }] : [];
        return [{ kind: "char", char }, ...scripts, ...part("e")];
      }
      case "d": {
        const open = property(element, "dPr", "begChr") ?? "(";
        const close = property(element, "dPr", "endChr") ?? ")";
        const separator = property(element, "dPr", "sepChr") ?? "|";
        const parts = element.children.filter((candidate) => candidate.name === "e").map((part) => this.row(part.children, depth));
        // A matrix in brackets is a pmatrix, bmatrix… (as the export writes them).
        const only = parts.length === 1 && parts[0]!.length === 1 ? parts[0]![0]! : null;
        const env = Object.entries(matrixFences).find(([, pair]) => pair[0] === open && pair[1] === close)?.[0];
        if (only?.kind === "matrix" && only.env === "matrix" && env) return [{ ...only, env }];
        const body = parts.flatMap((content, index): MathRow => (index > 0 ? [{ kind: "char", char: separator }, ...content] : content));
        return [{ kind: "fence", open, close, body }];
      }
      case "m": {
        const rows = element.children
          .filter((candidate) => candidate.name === "mr")
          .map((row) => row.children.filter((cell) => cell.name === "e").map((cell) => this.row(cell.children, depth)));
        if (rows.length === 0) return [];
        const columns = Math.max(1, ...rows.map((row) => row.length));
        return [{ kind: "matrix", env: "matrix", rows: rows.map((row) => [...row, ...Array.from({ length: columns - row.length }, () => [])]) }];
      }
      case "eqArr": {
        const rows = element.children.filter((candidate) => candidate.name === "e").map((row) => [this.row(row.children, depth)]);
        return rows.length > 0 ? [{ kind: "matrix", env: "gathered", rows }] : [];
      }
      case "func":
        return [...part("fName"), ...part("e")];
      case "limLow":
        return withScripts(part("e"), part("lim"), null);
      case "limUpp":
        return withScripts(part("e"), null, part("lim"));
      case "acc": {
        const char = property(element, "accPr", "chr") ?? "̂";
        return [{ kind: "accent", command: accentByChar[char] ?? "\\hat", body: part("e") }];
      }
      case "bar": {
        const top = property(element, "barPr", "pos") === "top";
        return [{ kind: "accent", command: top ? "\\overline" : "\\underline", body: part("e") }];
      }
      case "groupChr": {
        const char = property(element, "groupChrPr", "chr") ?? "⏟";
        const top = (property(element, "groupChrPr", "pos") ?? (char === "⏞" ? "top" : "bot")) === "top";
        return [{ kind: "accent", command: top ? "\\overbrace" : "\\underbrace", body: part("e") }];
      }
      case "borderBox":
        return [{ kind: "accent", command: "\\boxed", body: part("e") }];
      case "phant":
        return [{ kind: "accent", command: "\\phantom", body: part("e") }];
      case "box":
      case "e":
      case "oMath":
      case "oMathPara":
        return this.row(element.children, depth);
      default:
        // Properties hold no content; tracked changes, bookmarks and other wrappers hold runs.
        if (element.name.endsWith("Pr") || element.name === "rPr") return [];
        return this.row(element.children, depth);
    }
  }

  /** A run's text: characters, or upright text (`m:sty` "p"), an operator name, or normal text (`m:nor`). */
  private run(run: OmmlElement): MathRow {
    const text = run.children
      .filter((candidate) => candidate.name === "t" || candidate.name === "delText")
      .map((candidate) => candidate.text)
      .join("");
    if (!text) return [];
    const properties = childOf(run, "rPr");
    if (childOf(properties, "nor")) return textAtoms(text, "text");
    const style = childOf(properties, "sty")?.attributes.val;
    if (style === "p" && /\p{L}/u.test(text)) {
      if (operatorNames.includes(text)) return [{ kind: "name", name: text }];
      return textAtoms(text, "rm");
    }
    return [...text].map((char): MathAtom => {
      // `^` and `~` have no character of their own in LaTeX maths.
      if (char === "^") return { kind: "text", text: char, style: "text" };
      if (char === "~") return { kind: "char", char: "∼" };
      return { kind: "char", char };
    });
  }
}

/** Scripts after `base`; scripts of a base that ends in scripts with that part free join them (`lim` with limits under and over). */
function withScripts(base: MathRow, sub: MathRow | null, sup: MathRow | null): MathRow {
  const last = base[base.length - 1];
  if (last?.kind === "scripts" && (!sub || !last.sub) && (!sup || !last.sup) && base.length > 1) {
    return [...base.slice(0, -1), { kind: "scripts", sub: sub ?? last.sub, sup: sup ?? last.sup }];
  }
  return [...base, { kind: "scripts", sub, sup }];
}

function textAtoms(text: string, style: "text" | "rm"): MathRow {
  return text ? [{ kind: "text", text, style }] : [];
}

function allText(element: OmmlElement): string {
  return element.text + element.children.map(allText).join("");
}

// The model to Office Math ---------------------------------------------------------------------

const m = (name: string, children: (XmlTree | string)[] = [], attributes?: Record<string, string>): XmlTree => ({
  name: `m:${name}`,
  children,
  ...(attributes && { attributes }),
});
const value = (name: string, val: string) => m(name, [], { "m:val": val });

/** Cambria Math, which Word uses for equations. */
const mathFont: XmlTree = {
  name: "w:rPr",
  children: [{ name: "w:rFonts", attributes: { "w:ascii": "Cambria Math", "w:hAnsi": "Cambria Math" } }],
};

function run(text: string, style?: "p" | "nor"): XmlTree {
  const properties = style === "nor" ? [m("rPr", [m("nor")])] : style === "p" ? [m("rPr", [value("sty", "p")])] : [];
  const preserve = /^\s|\s$/.test(text) ? { "xml:space": "preserve" } : undefined;
  return m("r", [...properties, mathFont, m("t", [text], preserve)]);
}

/** A part (`m:e`, `m:num`…) with the content of a row. */
const part = (name: string, row: MathRow) => m(name, mathElements(row));

/** One atom's OMML, before runs of plain characters are joined. */
type Item = { xml: XmlTree; text?: string };

/** The `m:oMath` element of an equation. */
export function mathToOmml(row: MathRow): XmlTree {
  return m("oMath", mathElements(row));
}

function mathElements(row: MathRow): XmlTree[] {
  const items: Item[] = [];
  row.forEach((atom, index) => {
    if (atom.kind !== "scripts") {
      items.push(atomItem(atom));
      return;
    }
    const previous = row[index - 1];
    const base = previous && previous.kind !== "scripts" ? items.pop()!.xml : null;
    items.push({ xml: scriptsXml(atom, previous && previous.kind !== "scripts" ? previous : null, base) });
  });
  // Consecutive characters are one run, as Word writes them.
  const result: XmlTree[] = [];
  let text = "";
  const flush = () => {
    if (text) result.push(run(text));
    text = "";
  };
  for (const item of items) {
    if (item.text !== undefined) text += item.text;
    else {
      flush();
      result.push(item.xml);
    }
  }
  flush();
  return result;
}

function atomItem(atom: MathAtom): Item {
  switch (atom.kind) {
    case "char":
      return { xml: run(atom.char), text: atom.char };
    case "name":
      return { xml: run(atom.name, "p") };
    case "text":
      return { xml: run(atom.text, atom.style === "rm" ? "p" : "nor") };
    case "frac":
      return { xml: m("f", [part("num", atom.num), part("den", atom.den)]) };
    case "sqrt":
      return {
        xml: m("rad", [
          ...(atom.index ? [] : [m("radPr", [value("degHide", "1")])]),
          part("deg", atom.index ?? []),
          part("e", atom.body),
        ]),
      };
    case "fence":
      return { xml: m("d", [m("dPr", [value("begChr", atom.open), value("endChr", atom.close)]), part("e", atom.body)]) };
    case "accent":
      return { xml: accentXml(atom.command, atom.body) };
    case "matrix":
      return { xml: matrixXml(atom.env, atom.rows) };
    case "command":
      return { xml: run(`\\${atom.name}`, "nor") };
    case "raw":
      return { xml: run(atom.latex, "nor") };
    case "scripts":
      return { xml: scriptsXml(atom, null, null) };
  }
}

function accentXml(command: AccentCommand, body: MathRow): XmlTree {
  switch (command) {
    case "\\overline":
    case "\\underline":
      return m("bar", [m("barPr", [value("pos", command === "\\overline" ? "top" : "bot")]), part("e", body)]);
    case "\\overbrace":
    case "\\underbrace": {
      const top = command === "\\overbrace";
      return m("groupChr", [m("groupChrPr", [value("chr", accents[command].char), value("pos", top ? "top" : "bot"), value("vertJc", top ? "bot" : "top")]), part("e", body)]);
    }
    case "\\boxed":
      return m("borderBox", [part("e", body)]);
    case "\\phantom":
      return m("phant", [part("e", body)]);
    default:
      return m("acc", [m("accPr", [value("chr", accentChars[command] ?? "̂")]), part("e", body)]);
  }
}

const matrixFences: Record<string, [string, string]> = {
  pmatrix: ["(", ")"],
  bmatrix: ["[", "]"],
  Bmatrix: ["{", "}"],
  vmatrix: ["|", "|"],
  Vmatrix: ["‖", "‖"],
  cases: ["{", ""],
};

function matrixXml(env: string, rows: MathRow[][]): XmlTree {
  const matrix =
    env === "gathered" || env === "aligned"
      ? m("eqArr", rows.map((cells) => part("e", cells.flat())))
      : m("m", rows.map((cells) => m("mr", cells.map((cell) => part("e", cell)))));
  const fence = matrixFences[env];
  return fence ? m("d", [m("dPr", [value("begChr", fence[0]), value("endChr", fence[1])]), m("e", [matrix])]) : matrix;
}

/** Scripts of `base` (the atom before them, drawn as `baseXml`): an n-ary operator, limits or scripts. */
function scriptsXml(scripts: Extract<MathAtom, { kind: "scripts" }>, base: MathAtom | null, baseXml: XmlTree | null): XmlTree {
  const e = m("e", baseXml ? [baseXml] : []);
  if (base?.kind === "char" && (classOfChar(base.char) === "large" || classOfChar(base.char) === "integral")) {
    const under = classOfChar(base.char) === "large";
    return m("nary", [
      m("naryPr", [
        value("chr", base.char),
        value("limLoc", under ? "undOvr" : "subSup"),
        ...(scripts.sub ? [] : [value("subHide", "1")]),
        ...(scripts.sup ? [] : [value("supHide", "1")]),
      ]),
      part("sub", scripts.sub ?? []),
      part("sup", scripts.sup ?? []),
      m("e"),
    ]);
  }
  if (base?.kind === "name" && namesWithLimitsUnder.has(base.name)) {
    let xml = scripts.sub ? m("limLow", [e, part("lim", scripts.sub)]) : (baseXml ?? m("r"));
    if (scripts.sup) xml = m("limUpp", [m("e", [xml]), part("lim", scripts.sup)]);
    return xml;
  }
  if (scripts.sub && scripts.sup) return m("sSubSup", [e, part("sub", scripts.sub), part("sup", scripts.sup)]);
  if (scripts.sub) return m("sSub", [e, part("sub", scripts.sub)]);
  return m("sSup", [e, part("sup", scripts.sup ?? [])]);
}

/** The XML text of a tree. */
export function xmlString(tree: XmlTree | string): string {
  if (typeof tree === "string") return tree.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);
  const attributes = Object.entries(tree.attributes ?? {})
    .map(([key, val]) => ` ${key}="${val.replace(/[&"<>]/g, (char) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]!)}"`)
    .join("");
  const children = tree.children ?? [];
  return children.length === 0 ? `<${tree.name}${attributes}/>` : `<${tree.name}${attributes}>${children.map(xmlString).join("")}</${tree.name}>`;
}

