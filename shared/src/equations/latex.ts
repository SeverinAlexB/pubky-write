// Reading and writing the LaTeX of an equation. Equations are stored as LaTeX; the model
// (model.ts) covers what the editor can make and what Office Math holds. LaTeX outside it is kept
// as written in `raw` atoms, so reading and writing it again never changes it.
import {
  matrixEnvironments,
  type MathAtom,
  type MathRow,
} from "./model.ts";
import {
  fenceDelimiters,
  isAccentCommand,
  operatorNames,
  symbolForChar,
  symbolForCommand,
} from "./symbols.ts";

// Writing ---------------------------------------------------------------------------------------

/** The LaTeX of a row. */
export function toLatex(row: MathRow): string {
  const pieces: string[] = [];
  row.forEach((atom, index) => {
    // Scripts at the start of a row, or after other scripts, need an empty base.
    if (atom.kind === "scripts" && (index === 0 || row[index - 1]!.kind === "scripts")) pieces.push("{}");
    pieces.push(atomLatex(atom));
  });
  return joinLatex(pieces);
}

/** Joins pieces of LaTeX, with a space where a command would otherwise run into a letter. */
function joinLatex(pieces: string[]): string {
  let result = "";
  for (const piece of pieces) {
    if (!piece) continue;
    if (/\\[a-zA-Z]+$/.test(result) && /^[a-zA-Z]/.test(piece)) result += " ";
    result += piece;
  }
  return result;
}

/** An argument: one character without braces where that reads the same (`x^2`), else in braces. */
function argument(row: MathRow): string {
  const latex = toLatex(row);
  if (row.length === 1 && row[0]!.kind === "char" && /^[a-zA-Z0-9]$/.test(latex)) return latex;
  return `{${latex}}`;
}

function charLatex(char: string): string {
  if (char === "′") return "'";
  return symbolForChar(char)?.command ?? char;
}

function escapeText(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, (char) => (char === "\\" ? "\\textbackslash{}" : char === "^" ? "\\textasciicircum{}" : char === "~" ? "\\textasciitilde{}" : `\\${char}`));
}

function atomLatex(atom: MathAtom): string {
  switch (atom.kind) {
    case "char":
      return charLatex(atom.char);
    case "name":
      return operatorNames.includes(atom.name) ? `\\${atom.name}` : `\\operatorname{${escapeText(atom.name)}}`;
    case "text":
      return `${atom.style === "rm" ? "\\mathrm" : "\\text"}{${escapeText(atom.text)}}`;
    case "frac":
      return `\\frac{${toLatex(atom.num)}}{${toLatex(atom.den)}}`;
    case "sqrt": {
      if (!atom.index) return `\\sqrt{${toLatex(atom.body)}}`;
      // A `]` in the index would end it: then the index is in braces.
      const index = toLatex(atom.index);
      return `\\sqrt[${atom.index.some((part) => part.kind === "char" && part.char === "]") ? `{${index}}` : index}]{${toLatex(atom.body)}}`;
    }
    case "scripts":
      return `${atom.sub ? `_${argument(atom.sub)}` : ""}${atom.sup ? `^${argument(atom.sup)}` : ""}`;
    case "fence":
      return joinLatex([`\\left${delimiterLatex(atom.open)}`, toLatex(atom.body), `\\right${delimiterLatex(atom.close)}`]);
    case "accent":
      return `${atom.command}{${toLatex(atom.body)}}`;
    case "matrix": {
      const rows: string[][] = atom.rows.map((cells) => cells.map(toLatex));
      // A last row of empty cells is written as `{}`: a final `\\` alone ends the matrix.
      const last = rows[rows.length - 1];
      if (rows.length > 1 && last?.every((cell) => !cell)) last[0] = "{}";
      return `\\begin{${atom.env}}${rows.map((cells) => cells.join(" & ")).join(" \\\\ ")}\\end{${atom.env}}`;
    }
    case "command":
      return `\\backslash ${atom.name}`;
    case "raw":
      return atom.latex;
  }
}

function delimiterLatex(char: string): string {
  return fenceDelimiters[char] ?? char;
}

// Reading ---------------------------------------------------------------------------------------

type Token =
  | { type: "command"; name: string; start: number; end: number }
  | { type: "char"; char: string; start: number; end: number }
  | { type: "open" | "close" | "sup" | "sub" | "amp"; start: number; end: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const start = index;
    if (char === "\\") {
      const letters = /^[a-zA-Z]+\*?/.exec(source.slice(index + 1));
      if (letters) {
        index += 1 + letters[0].length;
        tokens.push({ type: "command", name: `\\${letters[0]}`, start, end: index });
        continue;
      }
      const next = String.fromCodePoint(source.codePointAt(index + 1) ?? 92);
      index += 1 + (index + 1 < source.length ? next.length : 0);
      tokens.push({ type: "command", name: `\\${index - start > 1 ? next : ""}`, start, end: index });
      continue;
    }
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    const code = String.fromCodePoint(source.codePointAt(index)!);
    index += code.length;
    if (char === "{") tokens.push({ type: "open", start, end: index });
    else if (char === "}") tokens.push({ type: "close", start, end: index });
    else if (char === "^") tokens.push({ type: "sup", start, end: index });
    else if (char === "_") tokens.push({ type: "sub", start, end: index });
    else if (char === "&") tokens.push({ type: "amp", start, end: index });
    else tokens.push({ type: "char", char: code, start, end: index });
  }
  return tokens;
}

/** The atoms of a LaTeX equation. LaTeX the model does not cover is kept in `raw` atoms. */
export function parseLatex(source: string): MathRow {
  return new LatexParser(source).parseAll();
}

/** Commands that end a row: `\right`, `\end`, and the row separator `\\`. */
const rowEnders = new Set(["\\right", "\\end", "\\\\"]);

class LatexParser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source);
  }

  parseAll(): MathRow {
    const row: MathRow = [];
    while (this.position < this.tokens.length) {
      row.push(...this.parseRow(true));
      // A stray closing brace or row ender at the top level: keep it as written.
      const token = this.tokens[this.position];
      if (token) {
        this.position++;
        row.push({ kind: "raw", latex: this.source.slice(token.start, token.end) });
      }
    }
    return row;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  /**
   * Atoms until a closing brace, `&`, `\right`, `\end`, `\\` or the end. `topLevel`: `&` is kept;
   * `inBrackets`: an optional argument, which `]` ends.
   */
  private parseRow(topLevel = false, inBrackets = false): MathRow {
    const row: MathRow = [];
    // Scripts after a group (`x_a{}^b`) start new scripts instead of joining the ones before.
    let afterGroup = false;
    for (let token = this.peek(); token; token = this.peek()) {
      const group = afterGroup;
      afterGroup = false;
      if (token.type === "close") break;
      if (inBrackets && token.type === "char" && token.char === "]") break;
      if (token.type === "amp" && !topLevel) break;
      if (token.type === "command" && rowEnders.has(token.name)) break;
      if (token.type === "sup" || token.type === "sub") {
        this.position++;
        const argument = this.parseArgument();
        const last = row[row.length - 1];
        const slot = token.type === "sup" ? "sup" : "sub";
        if (last?.kind === "scripts" && last[slot] === null && !group) {
          row[row.length - 1] = { ...last, [slot]: argument };
        } else {
          row.push({ kind: "scripts", sub: slot === "sub" ? argument : null, sup: slot === "sup" ? argument : null });
        }
        continue;
      }
      if (token.type === "open") {
        // A group: `{}` before scripts is an empty base; other groups are their content.
        this.position++;
        const content = this.parseRow();
        this.expectClose();
        row.push(...content);
        afterGroup = content.length === 0;
        continue;
      }
      row.push(...this.parseAtom());
    }
    return row;
  }

  private expectClose(): void {
    if (this.peek()?.type === "close") this.position++;
  }

  /** A group in braces, or one token: the argument of a command or script. */
  private parseArgument(): MathRow {
    const token = this.peek();
    if (!token) return [];
    if (token.type === "open") {
      this.position++;
      const row = this.parseRow();
      this.expectClose();
      return row;
    }
    if (token.type === "close" || token.type === "amp" || token.type === "sup" || token.type === "sub") return [];
    return this.parseAtom();
  }

  /** `[…]` after a command (`\sqrt[3]{x}`), or null. */
  private parseOptional(): MathRow | null {
    const token = this.peek();
    if (token?.type !== "char" || token.char !== "[") return null;
    this.position++;
    const row = this.parseRow(false, true);
    const close = this.peek();
    if (close?.type === "char" && close.char === "]") this.position++;
    return row;
  }

  /** The text of a `{…}` argument, read as text (`\text{…}`), or null when there is none. */
  private parseTextArgument(): string | null {
    const token = this.peek();
    if (token?.type !== "open") return null;
    let depth = 0;
    let end = token.start;
    for (let index = this.position; index < this.tokens.length; index++) {
      const candidate = this.tokens[index]!;
      if (candidate.type === "open") depth++;
      if (candidate.type === "close") depth--;
      if (depth === 0) {
        end = candidate.start;
        this.position = index + 1;
        return unescapeText(this.source.slice(token.end, end));
      }
    }
    this.position = this.tokens.length;
    return unescapeText(this.source.slice(token.end));
  }

  /** One atom (or none, for a token that draws nothing), consuming its arguments. */
  private parseAtom(): MathRow {
    const token = this.tokens[this.position++]!;
    if (token.type === "char") {
      if (token.char === "'") return [{ kind: "char", char: "′" }];
      return [{ kind: "char", char: token.char }];
    }
    if (token.type !== "command") return [{ kind: "raw", latex: this.source.slice(token.start, token.end) }];
    const name = token.name;
    if (name === "\\frac" || name === "\\dfrac" || name === "\\tfrac") {
      const num = this.parseArgument();
      const den = this.parseArgument();
      return [{ kind: "frac", num, den }];
    }
    if (name === "\\sqrt") {
      const index = this.parseOptional();
      return [{ kind: "sqrt", index, body: this.parseArgument() }];
    }
    if (name === "\\nroot") {
      const index = this.parseArgument();
      return [{ kind: "sqrt", index, body: this.parseArgument() }];
    }
    if (name === "\\left") return this.parseFence(token.start);
    if (name === "\\begin") return this.parseEnvironment(token.start);
    if (isAccentCommand(name)) return [{ kind: "accent", command: name, body: this.parseArgument() }];
    if (name === "\\text" || name === "\\textrm" || name === "\\mathrm" || name === "\\operatorname") {
      const text = this.parseTextArgument();
      if (text === null) return this.rawFrom(token.start);
      if (name === "\\operatorname") return [{ kind: "name", name: text }];
      return [{ kind: "text", text, style: name === "\\mathrm" ? "rm" : "text" }];
    }
    if (name === "\\not") {
      const next = this.peek();
      const negated = next && (next.type === "command" ? symbolForCommand(`\\not${next.name}`) : next.type === "char" ? symbolForCommand(`\\not${next.char}`) : undefined);
      if (negated) {
        this.position++;
        return [{ kind: "char", char: negated.char }];
      }
      return this.rawFrom(token.start);
    }
    const bareName = name.slice(1);
    if (operatorNames.includes(bareName)) return [{ kind: "name", name: bareName }];
    const symbol = symbolForCommand(name);
    if (symbol) return [{ kind: "char", char: symbol.char }];
    // Unknown: the command with its optional and brace arguments, as written.
    return this.rawFrom(token.start);
  }

  /** LaTeX from `start` through the current command's arguments, kept as written. */
  private rawFrom(start: number): MathRow {
    let end = this.tokens[this.position - 1]!.end;
    for (let token = this.peek(); token && (token.type === "open" || (token.type === "char" && token.char === "[")); token = this.peek()) {
      const close = token.type === "open" ? "close" : "]";
      let depth = 0;
      let index = this.position;
      for (; index < this.tokens.length; index++) {
        const candidate = this.tokens[index]!;
        if (close === "close") {
          if (candidate.type === "open") depth++;
          if (candidate.type === "close" && --depth === 0) break;
        } else if (candidate.type === "char" && candidate.char === "]") break;
      }
      if (index >= this.tokens.length) {
        this.position = this.tokens.length;
        end = this.source.length;
        break;
      }
      this.position = index + 1;
      end = this.tokens[index]!.end;
    }
    return [{ kind: "raw", latex: this.source.slice(start, end) }];
  }

  private parseDelimiter(): string | null {
    const token = this.tokens[this.position];
    if (!token) return null;
    this.position++;
    if (token.type === "char") return token.char === "." ? "" : token.char;
    if (token.type === "command") {
      const entry = Object.entries(fenceDelimiters).find(([, latex]) => latex === token.name);
      if (entry) return entry[0];
      const symbol = symbolForCommand(token.name);
      if (symbol) return symbol.char;
    }
    return null;
  }

  private parseFence(start: number): MathRow {
    const open = this.parseDelimiter();
    if (open === null) return [{ kind: "raw", latex: this.source.slice(start, this.tokens[this.position - 1]?.end ?? this.source.length) }];
    const body = this.parseRow();
    const token = this.peek();
    if (token?.type === "command" && token.name === "\\right") {
      this.position++;
      const close = this.parseDelimiter();
      return [{ kind: "fence", open, close: close ?? "", body }];
    }
    return [{ kind: "fence", open, close: "", body }];
  }

  private parseEnvironment(start: number): MathRow {
    const env = this.parseTextArgument();
    if (env === null || !matrixEnvironments.includes(env)) return this.skipEnvironment(start, env);
    const rows: MathRow[][] = [];
    let cells: MathRow[] = [];
    let rowStart = this.position;
    for (;;) {
      cells.push(this.parseRow());
      const token = this.peek();
      if (!token) break;
      if (token.type === "amp") {
        this.position++;
        continue;
      }
      if (token.type === "command" && token.name === "\\\\") {
        this.position++;
        rows.push(cells);
        cells = [];
        rowStart = this.position;
        continue;
      }
      if (token.type === "command" && token.name === "\\end") {
        this.position++;
        this.parseTextArgument();
        break;
      }
      // A stray closing brace inside the environment.
      this.position++;
    }
    // A final `\\` with nothing after it does not start a row.
    const lastRowEmpty = this.tokens[rowStart]?.type === "command" && (this.tokens[rowStart] as { name: string }).name === "\\end";
    if (!lastRowEmpty || rows.length === 0) rows.push(cells);
    const columns = Math.max(...rows.map((row) => row.length));
    return [{ kind: "matrix", env, rows: rows.map((row) => [...row, ...Array.from({ length: columns - row.length }, () => [])]) }];
  }

  /** An environment the model does not cover, kept as written up to its `\end`. */
  private skipEnvironment(start: number, env: string | null): MathRow {
    let depth = 1;
    for (; this.position < this.tokens.length; this.position++) {
      const token = this.tokens[this.position]!;
      if (token.type !== "command") continue;
      if (token.name === "\\begin") depth++;
      if (token.name === "\\end" && --depth === 0) {
        this.position++;
        this.parseTextArgument();
        break;
      }
    }
    void env;
    const end = this.tokens[this.position - 1]?.end ?? this.source.length;
    return [{ kind: "raw", latex: this.source.slice(start, end) }];
  }
}

function unescapeText(text: string): string {
  return text
    .replace(/\\textbackslash(\{\})?/g, "\\")
    .replace(/\\textasciicircum(\{\})?/g, "^")
    .replace(/\\textasciitilde(\{\})?/g, "~")
    .replace(/\\([{}$&#%_])/g, "$1");
}
