// The equation toolbar (spec 20): under the main toolbar while View > Show equation toolbar is on.
// "New equation", five menus of symbols and structures (enabled while the cursor is in an
// equation), and a button that hides the bar.
import {
  arrows,
  greekLetters,
  miscellaneousOperations,
  parseLatex,
  relations,
  type MathRow,
} from "@pubky-write/shared/equations";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../../components/Icon.tsx";
import { usePopover } from "../../components/usePopover.ts";
import { insertIntoEquation, mathElement } from "./equationCode.ts";
import { editingEquation, insertEquation } from "./equations.ts";

type Choice = { label: string; atoms: MathRow; preview: ReactNode };

const symbolChoices = (symbols: { char: string; command: string }[]): Choice[] =>
  symbols.map(({ char, command }) => ({ label: command.slice(1), atoms: [{ kind: "char", char }], preview: char }));

/** Maths operations: structures with empty slots, shown as rendered previews. */
const structures: { label: string; insert: string; preview: string }[] = [
  { label: "Fraction", insert: "\\frac{}{}", preview: "\\frac{a}{b}" },
  { label: "Square root", insert: "\\sqrt{}", preview: "\\sqrt{x}" },
  { label: "N-th root", insert: "\\sqrt[]{}", preview: "\\sqrt[n]{x}" },
  { label: "Subscript and superscript", insert: "{}_{}^{}", preview: "x_a^b" },
  { label: "Subscript", insert: "{}_{}", preview: "x_a" },
  { label: "Superscript", insert: "{}^{}", preview: "x^b" },
  { label: "Overline", insert: "\\overline{}", preview: "\\overline{x}" },
  { label: "Hat", insert: "\\hat{}", preview: "\\hat{x}" },
  { label: "Big intersection", insert: "\\bigcap_{}^{}", preview: "\\bigcap_a^b" },
  { label: "Big union", insert: "\\bigcup_{}^{}", preview: "\\bigcup_a^b" },
  { label: "Product", insert: "\\prod_{}^{}", preview: "\\prod_a^b" },
  { label: "Coproduct", insert: "\\coprod_{}^{}", preview: "\\coprod_a^b" },
  { label: "Parentheses", insert: "\\left(\\right)", preview: "\\left(x\\right)" },
  { label: "Brackets", insert: "\\left[\\right]", preview: "\\left[x\\right]" },
  { label: "Braces", insert: "\\left\\{\\right\\}", preview: "\\left\\{x\\right\\}" },
  { label: "Absolute value", insert: "\\left|\\right|", preview: "\\left|x\\right|" },
  { label: "Integral", insert: "\\int_{}^{}", preview: "\\int_a^b" },
  { label: "Contour integral", insert: "\\oint_{}^{}", preview: "\\oint_a^b" },
  { label: "Sum", insert: "\\sum_{}^{}", preview: "\\sum_a^b" },
  { label: "Limit", insert: "\\lim_{}", preview: "\\lim_{a\\rightarrow b}" },
];

function Preview({ latex }: { latex: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    holder.current?.replaceChildren(mathElement(parseLatex(latex), false));
  }, [latex]);
  return <span ref={holder} className="equation-preview" aria-hidden />;
}

const menus: { label: string; sample: string; choices: Choice[] }[] = [
  { label: "Greek letters", sample: "αβΔ", choices: symbolChoices(greekLetters) },
  { label: "Miscellaneous operations", sample: "×÷∃", choices: symbolChoices(miscellaneousOperations) },
  { label: "Relations", sample: "<≠⊃", choices: symbolChoices(relations) },
  {
    label: "Maths operations",
    sample: "√()x",
    choices: structures.map(({ label, insert, preview }) => ({ label, atoms: parseLatex(insert), preview: <Preview latex={preview} /> })),
  },
  { label: "Arrows", sample: "←↑⇒", choices: symbolChoices(arrows) },
];

const COLUMNS = 6;

type EquationToolbarProps = { editor: Editor; onHide: () => void };

export function EquationToolbar({ editor, onHide }: EquationToolbarProps) {
  const inEquation = useEditorState({ editor, selector: ({ editor: current }) => editingEquation(current.state) !== null });
  return (
    <div className="equation-toolbar" role="toolbar" aria-label="Equation">
      <button
        type="button"
        className={`equation-new${inEquation ? " is-active" : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => insertEquation(editor.view).catch(() => {})}
      >
        New equation
      </button>
      {menus.map((menu) => (
        <EquationMenu
          key={menu.label}
          label={menu.label}
          sample={menu.sample}
          choices={menu.choices}
          disabled={!inEquation}
          onChoose={(choice) => {
            const editing = editingEquation(editor.state);
            if (editing) insertIntoEquation(editor.view, editing, choice.atoms);
            editor.view.focus();
          }}
        />
      ))}
      <button
        type="button"
        className="icon-button equation-toolbar-hide"
        aria-label="Hide equation toolbar"
        data-tooltip="Hide equation toolbar"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onHide}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

type EquationMenuProps = { label: string; sample: string; choices: Choice[]; disabled: boolean; onChoose: (choice: Choice) => void };

function EquationMenu({ label, sample, choices, disabled, onChoose }: EquationMenuProps) {
  const { open, setOpen, close, root } = usePopover();
  const button = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const fromKeyboard = useRef(false);

  // Escape closes the menu, before the equation (which has the focus after a click) sees it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || grid.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  useEffect(() => {
    if (open && fromKeyboard.current) grid.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cells = [...(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = cells.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = index < 0 ? 0 : Math.min(Math.max(index + step, 0), cells.length - 1);
      cells[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      button.current?.focus();
    }
  };

  return (
    <div className="menu equation-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="equation-menu-button"
        aria-label={label}
        data-tooltip={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          fromKeyboard.current = event.detail === 0;
          setOpen((value) => !value);
        }}
      >
        <span className="equation-menu-sample">{sample}</span>
        <Icon name="arrow_drop_down" size={18} />
      </button>
      {open && (
        <div ref={grid} className="equation-menu-grid" role="menu" aria-label={label} onKeyDown={onGridKeyDown}>
          {choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitem"
              className="equation-menu-cell"
              aria-label={choice.label}
              data-tooltip={choice.label}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                close();
                onChoose(choice);
              }}
            >
              {choice.preview}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
