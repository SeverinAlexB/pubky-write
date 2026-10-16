// Loading the equation code (MathML drawing and editing) on demand: with a document that holds an
// equation, before it is shown, or with the first equation inserted or pasted. Documents without
// equations never load it.
type EquationCode = typeof import("./equationCode.ts");

let code: EquationCode | null = null;
let loading: Promise<EquationCode> | null = null;
const listeners = new Set<(loaded: EquationCode) => void>();

export function loadEquationCode(): Promise<EquationCode> {
  loading ??= import("./equationCode.ts").then(
    (module) => {
      code = module;
      for (const listener of listeners) listener(module);
      listeners.clear();
      return module;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The equation code, or null until it has loaded. */
export function equationCode(): EquationCode | null {
  return code;
}

/** Calls `listener` once the code has loaded (at once if it has). */
export function whenEquationCodeLoaded(listener: (loaded: EquationCode) => void): void {
  if (code) listener(code);
  else listeners.add(listener);
}

/** Whether document JSON holds an equation, in the content or in headers, footers and footnotes. */
export function containsEquation(json: unknown): boolean {
  const stack: unknown[] = [json];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if (value && typeof value === "object") {
      const node = value as { type?: unknown; content?: unknown; attrs?: Record<string, unknown> };
      if (node.type === "equation") return true;
      if (node.content) stack.push(node.content);
      if (node.attrs) for (const attr of Object.values(node.attrs)) if (Array.isArray(attr)) stack.push(attr);
    }
  }
  return false;
}
