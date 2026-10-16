// The symbols and structures of the equation editor (spec 20): what the equation toolbar's menus
// offer, what backslash commands turn into, and how each character is written in LaTeX and drawn
// in MathML.

/**
 * How a character is drawn: `ord` as an identifier (italic when it is a single letter), `op` as an
 * operator with spacing on both sides, `large` as a big operator whose limits go under and over it,
 * `integral` as a big operator whose limits go beside it, `open` and `close` as brackets.
 */
export type SymbolClass = "ord" | "op" | "large" | "integral" | "open" | "close" | "punct";

export type MathSymbol = { char: string; command: string; class: SymbolClass };

const ord = (char: string, command: string): MathSymbol => ({ char, command, class: "ord" });
const op = (char: string, command: string): MathSymbol => ({ char, command, class: "op" });

/** Greek letters (αβΔ), in menu order. */
export const greekLetters: MathSymbol[] = [
  ord("α", "\\alpha"),
  ord("β", "\\beta"),
  ord("γ", "\\gamma"),
  ord("δ", "\\delta"),
  ord("ϵ", "\\epsilon"),
  ord("ε", "\\varepsilon"),
  ord("ζ", "\\zeta"),
  ord("η", "\\eta"),
  ord("θ", "\\theta"),
  ord("ϑ", "\\vartheta"),
  ord("ι", "\\iota"),
  ord("κ", "\\kappa"),
  ord("λ", "\\lambda"),
  ord("μ", "\\mu"),
  ord("ν", "\\nu"),
  ord("ξ", "\\xi"),
  ord("π", "\\pi"),
  ord("ϖ", "\\varpi"),
  ord("ρ", "\\rho"),
  ord("ϱ", "\\varrho"),
  ord("σ", "\\sigma"),
  ord("ς", "\\varsigma"),
  ord("τ", "\\tau"),
  ord("υ", "\\upsilon"),
  ord("ϕ", "\\phi"),
  ord("φ", "\\varphi"),
  ord("χ", "\\chi"),
  ord("ψ", "\\psi"),
  ord("ω", "\\omega"),
  ord("Γ", "\\Gamma"),
  ord("Δ", "\\Delta"),
  ord("Θ", "\\Theta"),
  ord("Λ", "\\Lambda"),
  ord("Ξ", "\\Xi"),
  ord("Π", "\\Pi"),
  ord("Σ", "\\Sigma"),
  ord("Υ", "\\Upsilon"),
  ord("Φ", "\\Phi"),
  ord("Ψ", "\\Psi"),
  ord("Ω", "\\Omega"),
];

/** Miscellaneous operations (×÷∃), in menu order. */
export const miscellaneousOperations: MathSymbol[] = [
  op("×", "\\times"),
  op("÷", "\\div"),
  op("·", "\\cdot"),
  op("±", "\\pm"),
  op("∓", "\\mp"),
  op("∗", "\\ast"),
  op("⋆", "\\star"),
  op("∘", "\\circ"),
  op("•", "\\bullet"),
  op("⊕", "\\oplus"),
  op("⊖", "\\ominus"),
  op("⊘", "\\oslash"),
  op("⊗", "\\otimes"),
  op("⊙", "\\odot"),
  op("†", "\\dagger"),
  op("‡", "\\ddagger"),
  op("∨", "\\vee"),
  op("∧", "\\wedge"),
  op("∩", "\\cap"),
  op("∪", "\\cup"),
  ord("ℵ", "\\aleph"),
  ord("ℜ", "\\Re"),
  ord("ℑ", "\\Im"),
  ord("⊤", "\\top"),
  ord("⊥", "\\bot"),
  ord("∞", "\\infty"),
  ord("∂", "\\partial"),
  op("∀", "\\forall"),
  op("∃", "\\exists"),
  op("¬", "\\neg"),
  ord("△", "\\triangle"),
  op("⋄", "\\diamond"),
];

/** Relations (<≠⊃), in menu order. */
export const relations: MathSymbol[] = [
  op("≤", "\\leq"),
  op("≥", "\\geq"),
  op("≺", "\\prec"),
  op("≻", "\\succ"),
  op("⪯", "\\preceq"),
  op("⪰", "\\succeq"),
  op("≪", "\\ll"),
  op("≫", "\\gg"),
  op("≡", "\\equiv"),
  op("∼", "\\sim"),
  op("≃", "\\simeq"),
  op("≍", "\\asymp"),
  op("≈", "\\approx"),
  op("≠", "\\neq"),
  op("⊂", "\\subset"),
  op("⊃", "\\supset"),
  op("⊆", "\\subseteq"),
  op("⊇", "\\supseteq"),
  op("∈", "\\in"),
  op("∋", "\\ni"),
  op("∉", "\\notin"),
];

/** Arrows (←↑⇒), in menu order. */
export const arrows: MathSymbol[] = [
  op("←", "\\leftarrow"),
  op("→", "\\rightarrow"),
  op("↔", "\\leftrightarrow"),
  op("⇐", "\\Leftarrow"),
  op("⇒", "\\Rightarrow"),
  op("⇔", "\\Leftrightarrow"),
  op("↑", "\\uparrow"),
  op("↓", "\\downarrow"),
  op("↕", "\\updownarrow"),
  op("⇑", "\\Uparrow"),
  op("⇓", "\\Downarrow"),
  op("⇕", "\\Updownarrow"),
];

/** Big operators: drawn large, their limits under and over them (or beside them, for integrals). */
export const largeOperators: MathSymbol[] = [
  { char: "∑", command: "\\sum", class: "large" },
  { char: "∏", command: "\\prod", class: "large" },
  { char: "∐", command: "\\coprod", class: "large" },
  { char: "⋂", command: "\\bigcap", class: "large" },
  { char: "⋃", command: "\\bigcup", class: "large" },
  { char: "∫", command: "\\int", class: "integral" },
  { char: "∮", command: "\\oint", class: "integral" },
  { char: "∬", command: "\\iint", class: "integral" },
  { char: "∭", command: "\\iiint", class: "integral" },
  { char: "∯", command: "\\oiint", class: "integral" },
  { char: "∰", command: "\\oiiint", class: "integral" },
  { char: "⋁", command: "\\bigvee", class: "large" },
  { char: "⋀", command: "\\bigwedge", class: "large" },
  { char: "⨀", command: "\\bigodot", class: "large" },
  { char: "⨁", command: "\\bigoplus", class: "large" },
  { char: "⨂", command: "\\bigotimes", class: "large" },
  { char: "⨄", command: "\\biguplus", class: "large" },
];

/** Other symbols LaTeX writers use, recognised when reading LaTeX and typing commands. */
const otherSymbols: MathSymbol[] = [
  ord("∇", "\\nabla"),
  ord("ℏ", "\\hbar"),
  ord("ℓ", "\\ell"),
  ord("∅", "\\emptyset"),
  ord("′", "\\prime"),
  ord("…", "\\ldots"),
  ord("⋯", "\\cdots"),
  ord("⋮", "\\vdots"),
  ord("⋱", "\\ddots"),
  ord("°", "\\degree"),
  ord("\\", "\\backslash"),
  ord("∠", "\\angle"),
  op("∣", "\\mid"),
  op("∥", "\\parallel"),
  op("∝", "\\propto"),
  op("⊢", "\\vdash"),
  op("⊨", "\\models"),
  op("↦", "\\mapsto"),
  op("⟶", "\\longrightarrow"),
  op("⟵", "\\longleftarrow"),
  op("⟹", "\\Longrightarrow"),
  op("⟸", "\\Longleftarrow"),
  op("⟺", "\\Longleftrightarrow"),
  op("↗", "\\nearrow"),
  op("↘", "\\searrow"),
  op("∖", "\\setminus"),
  op("⊎", "\\uplus"),
  op("≅", "\\cong"),
  op("≐", "\\doteq"),
  op("⊄", "\\not\\subset"),
  op("∌", "\\not\\ni"),
  op("∤", "\\nmid"),
  op("≮", "\\not<"),
  op("≯", "\\not>"),
  op("∵", "\\because"),
  op("∴", "\\therefore"),
  { char: "⟨", command: "\\langle", class: "open" },
  { char: "⟩", command: "\\rangle", class: "close" },
  { char: "⌊", command: "\\lfloor", class: "open" },
  { char: "⌋", command: "\\rfloor", class: "close" },
  { char: "⌈", command: "\\lceil", class: "open" },
  { char: "⌉", command: "\\rceil", class: "close" },
  { char: "{", command: "\\{", class: "open" },
  { char: "}", command: "\\}", class: "close" },
  { char: "‖", command: "\\|", class: "ord" },
  ord("#", "\\#"),
  ord("%", "\\%"),
  ord("&", "\\&"),
  ord("$", "\\$"),
  ord("_", "\\_"),
  ord(" ", "\\ "),
];

/** Commands that name the same symbol as one above (written back with the first name). */
const aliases: Record<string, string> = {
  "\\le": "\\leq",
  "\\ge": "\\geq",
  "\\ne": "\\neq",
  "\\to": "\\rightarrow",
  "\\gets": "\\leftarrow",
  "\\lnot": "\\neg",
  "\\land": "\\wedge",
  "\\lor": "\\vee",
  "\\owns": "\\ni",
  "\\iff": "\\Longleftrightarrow",
  "\\implies": "\\Longrightarrow",
  "\\dots": "\\ldots",
  "\\lbrace": "\\{",
  "\\rbrace": "\\}",
  "\\vert": "∣",
  "\\Vert": "\\|",
  "\\varnothing": "\\emptyset",
  "\\colon": ":",
  "\\lt": "<",
  "\\gt": ">",
};

/** Upright operator names: `\sin x`, `\lim_{a \to b}`. */
export const operatorNames = [
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "coth",
  "log",
  "ln",
  "lg",
  "exp",
  "lim",
  "liminf",
  "limsup",
  "max",
  "min",
  "sup",
  "inf",
  "det",
  "dim",
  "ker",
  "deg",
  "gcd",
  "arg",
  "hom",
  "Pr",
  "mod",
];

/** Names whose limits go under them, like the big operators. */
export const namesWithLimitsUnder = new Set(["lim", "liminf", "limsup", "max", "min", "sup", "inf", "det", "gcd", "Pr"]);

/** Accents and other one-argument wrappers, by command. */
export const accents = {
  "\\hat": { char: "ˆ", over: true },
  "\\widehat": { char: "ˆ", over: true },
  "\\bar": { char: "¯", over: true },
  "\\overline": { char: "‾", over: true, stretch: true },
  "\\underline": { char: "_", over: false, stretch: true },
  "\\tilde": { char: "˜", over: true },
  "\\widetilde": { char: "˜", over: true },
  "\\vec": { char: "→", over: true },
  "\\dot": { char: "˙", over: true },
  "\\ddot": { char: "¨", over: true },
  "\\check": { char: "ˇ", over: true },
  "\\breve": { char: "˘", over: true },
  "\\acute": { char: "´", over: true },
  "\\grave": { char: "`", over: true },
  "\\overbrace": { char: "⏞", over: true, stretch: true },
  "\\underbrace": { char: "⏟", over: false, stretch: true },
  "\\boxed": { char: "", over: true },
  "\\phantom": { char: "", over: true },
} as const satisfies Record<string, { char: string; over: boolean; stretch?: boolean }>;
export type AccentCommand = keyof typeof accents;

export function isAccentCommand(command: string): command is AccentCommand {
  return Object.hasOwn(accents, command);
}

/** Brackets a fence (`\left … \right`) can have, with their LaTeX. "" is an invisible bracket (`.`). */
export const fenceDelimiters: Record<string, string> = {
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "{": "\\{",
  "}": "\\}",
  "|": "|",
  "‖": "\\|",
  "⟨": "\\langle",
  "⟩": "\\rangle",
  "⌊": "\\lfloor",
  "⌋": "\\rfloor",
  "⌈": "\\lceil",
  "⌉": "\\rceil",
  "": ".",
};

/** The closing bracket of each opening one, for brackets typed in the editor. */
export const closingBracket: Record<string, string> = { "(": ")", "[": "]", "{": "}", "|": "|", "⟨": "⟩", "⌊": "⌋", "⌈": "⌉" };

const allSymbols = [...greekLetters, ...miscellaneousOperations, ...relations, ...arrows, ...largeOperators, ...otherSymbols];

const byCommand = new Map<string, MathSymbol>(allSymbols.map((symbol) => [symbol.command, symbol]));
const byChar = new Map<string, MathSymbol>();
for (const symbol of allSymbols) if (!byChar.has(symbol.char)) byChar.set(symbol.char, symbol);

/** The symbol a command names (`\alpha`, `\le`), or undefined. */
export function symbolForCommand(command: string): MathSymbol | undefined {
  const alias = aliases[command];
  if (alias !== undefined) return byCommand.get(alias) ?? { char: alias, command: alias, class: classOfChar(alias) };
  return byCommand.get(command);
}

/** The symbol entry of a character, when it has a command. */
export function symbolForChar(char: string): MathSymbol | undefined {
  return byChar.get(char);
}

const operatorChars = new Set([..."+-−=<>*/∕:!?,;"]);

/** How a character is drawn (see SymbolClass). */
export function classOfChar(char: string): SymbolClass {
  const symbol = byChar.get(char);
  if (symbol) return symbol.class;
  if ("([".includes(char)) return "open";
  if (")]".includes(char)) return "close";
  if (",;".includes(char)) return "punct";
  if (operatorChars.has(char)) return "op";
  return "ord";
}

/** Structures the editor inserts with empty slots (typed as commands or chosen in Maths operations). */
export const structureCommands = [
  "\\frac",
  "\\sqrt",
  "\\nroot",
  "\\sum",
  "\\prod",
  "\\coprod",
  "\\bigcap",
  "\\bigcup",
  "\\int",
  "\\oint",
  "\\lim",
  "\\bar",
  "\\hat",
  "\\overline",
] as const;
