// An inline equation (spec 20): a leaf node whose `latex` attribute is the equation's LaTeX
// source. The editor edits it in place (client/src/editor/equations/); see docs/design/equations.md.
import { Node as TiptapNode } from "@tiptap/core";
import type { DOMOutputSpec, Node } from "@tiptap/pm/model";
import type { TokenEncoder } from "@tiptap/pm/changeset";

export const EQUATION = "equation";
export const MAX_EQUATION_LENGTH = 10_000;

/**
 * Draws an equation's static HTML. The client registers MathML drawing once the equation code has
 * loaded (registerEquationRenderer); until then, and on the server, the HTML holds the LaTeX as text.
 */
let renderer: ((latex: string) => HTMLElement) | null = null;
let rendererVersion = 0;

export function registerEquationRenderer(render: (latex: string) => HTMLElement): void {
  renderer = render;
  rendererVersion++;
}

/** Changes when equations start to be drawn differently (static copies cached before then are stale). */
export function equationRendererVersion(): number {
  return rendererVersion;
}

export function isEquation(node: Node | null | undefined): boolean {
  return node?.type.name === EQUATION;
}

export const DocsEquation = TiptapNode.create({
  name: EQUATION,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: "",
        rendered: false,
        validate: (value: unknown) => {
          if (typeof value !== "string" || value.length > MAX_EQUATION_LENGTH) throw new RangeError("An equation's LaTeX must be a string");
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: "span[data-latex]", getAttrs: (element) => ({ latex: (element as HTMLElement).getAttribute("data-latex") ?? "" }) },
      {
        // MathML from other applications, when it carries its LaTeX source.
        tag: "math",
        getAttrs: (element) => {
          const annotation = (element as HTMLElement).querySelector('annotation[encoding="application/x-tex"]');
          return annotation?.textContent ? { latex: annotation.textContent.trim() } : false;
        },
      },
    ];
  },

  renderHTML({ node }): DOMOutputSpec {
    const latex = node.attrs.latex as string;
    if (renderer) return renderer(latex);
    return ["span", { class: "equation", "data-latex": latex }, latex];
  },

  renderText({ node }) {
    return node.attrs.latex as string;
  },
});

/**
 * Tokens for comparing documents (prosemirror-changeset) in which an equation is equal only to
 * an equation with the same LaTeX, so a changed equation is a change: in version history and when
 * an edit becomes a suggestion. Everything else is compared as by the default encoder.
 */
export const equationTokens: TokenEncoder<unknown> = {
  encodeCharacter: (char) => char,
  encodeNodeStart: (node) => (node.type.name === EQUATION ? `${EQUATION} ${String(node.attrs.latex)}` : node.type.name),
  encodeNodeEnd: (node) => `/${node.type.name}`,
  compareTokens: (a, b) => a === b,
};
