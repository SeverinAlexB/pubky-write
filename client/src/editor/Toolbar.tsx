import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Columns3,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListChevronsUpDown,
  Minus,
  Plus,
  Printer,
  Redo2,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { DEFAULT_LINE_SPACING, lineSpacings } from "@docs/shared";
import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "../components/Menu.tsx";
import { ColorPicker } from "./ColorPicker.tsx";
import { changeFontSize, currentFontSize, setFontSize } from "./extensions.ts";
import { DEFAULT_FONT, fontFamilies } from "./fonts.ts";

export const zoomLevels = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

export type ParagraphStyle = "paragraph" | "h1" | "h2" | "h3";

export const paragraphStyles: { value: ParagraphStyle; label: string }[] = [
  { value: "paragraph", label: "Normal text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
];

export function applyParagraphStyle(editor: Editor, style: ParagraphStyle): void {
  const chain = editor.chain().focus();
  if (style === "paragraph") chain.setParagraph().run();
  else chain.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 }).run();
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl+";

type ToolbarProps = {
  editor: Editor;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onLink: () => void;
  onImage: () => void;
  onPrint: () => void;
};

export function Toolbar({ editor, zoom, onZoomChange, onLink, onImage, onPrint }: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      style: (["h1", "h2", "h3"] as const).find((style) =>
        editor.isActive("heading", { level: Number(style.slice(1)) }),
      ) ?? ("paragraph" as ParagraphStyle),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      link: editor.isActive("link"),
      color: editor.getAttributes("textStyle").color as string | undefined,
      highlight: editor.getAttributes("highlight").color as string | undefined,
      align: (["center", "right", "justify"] as const).find((align) => editor.isActive({ textAlign: align })) ?? "left",
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      inTable: editor.isActive("table"),
      fontFamily: (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? DEFAULT_FONT,
      fontSize: currentFontSize(editor),
      lineSpacing: (editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").lineSpacing as number | null) ?? DEFAULT_LINE_SPACING,
    }),
  });

  const run = () => editor.chain().focus();

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton label={`Undo (${modKey}Z)`} disabled={!state.canUndo} onClick={() => run().undo().run()}>
        <Undo2 size={18} />
      </ToolButton>
      <ToolButton label={`Redo (${modKey}Shift+Z)`} disabled={!state.canRedo} onClick={() => run().redo().run()}>
        <Redo2 size={18} />
      </ToolButton>
      <ToolButton label={`Print (${modKey}P)`} onClick={onPrint}>
        <Printer size={18} />
      </ToolButton>
      <select
        className="tool-select zoom-select"
        aria-label="Zoom"
        value={zoom}
        onChange={(event) => onZoomChange(Number(event.target.value))}
      >
        {zoomLevels.map((level) => (
          <option key={level} value={level}>
            {Math.round(level * 100)}%
          </option>
        ))}
      </select>
      <Divider />
      <select
        className="tool-select style-select"
        aria-label="Styles"
        value={state.style}
        onChange={(event) => applyParagraphStyle(editor, event.target.value as ParagraphStyle)}
      >
        {paragraphStyles.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Divider />
      <select
        className="tool-select font-select"
        aria-label="Font"
        value={state.fontFamily}
        onChange={(event) =>
          event.target.value === DEFAULT_FONT
            ? run().unsetFontFamily().run()
            : run().setFontFamily(event.target.value).run()
        }
      >
        {[...new Set([...fontFamilies, state.fontFamily])].map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>
      <Divider />
      <ToolButton label={`Decrease font size (${modKey}Shift+,)`} onClick={() => changeFontSize(editor, -1)}>
        <Minus size={16} />
      </ToolButton>
      <FontSizeInput size={state.fontSize} onChange={(size) => setFontSize(editor, size)} />
      <ToolButton label={`Increase font size (${modKey}Shift+.)`} onClick={() => changeFontSize(editor, 1)}>
        <Plus size={16} />
      </ToolButton>
      <Divider />
      <ToolButton label={`Bold (${modKey}B)`} active={state.bold} onClick={() => run().toggleBold().run()}>
        <Bold size={18} />
      </ToolButton>
      <ToolButton label={`Italic (${modKey}I)`} active={state.italic} onClick={() => run().toggleItalic().run()}>
        <Italic size={18} />
      </ToolButton>
      <ToolButton label={`Underline (${modKey}U)`} active={state.underline} onClick={() => run().toggleUnderline().run()}>
        <Underline size={18} />
      </ToolButton>
      <ToolButton label={`Strikethrough (${modKey}Shift+S)`} active={state.strike} onClick={() => run().toggleStrike().run()}>
        <Strikethrough size={18} />
      </ToolButton>
      <ColorPicker
        label="Text colour"
        icon={<Baseline size={18} />}
        current={state.color}
        resetLabel="Default colour"
        onPick={(color) => (color ? run().setColor(color).run() : run().unsetColor().run())}
      />
      <ColorPicker
        label="Highlight colour"
        icon={<Highlighter size={18} />}
        current={state.highlight}
        resetLabel="None"
        onPick={(color) => (color ? run().setHighlight({ color }).run() : run().unsetHighlight().run())}
      />
      <Divider />
      <ToolButton label={`Insert link (${modKey}K)`} active={state.link} onClick={onLink}>
        <Link2 size={18} />
      </ToolButton>
      <ToolButton label="Insert image" onClick={onImage}>
        <ImagePlus size={18} />
      </ToolButton>
      <ToolButton
        label="Insert table"
        disabled={state.inTable}
        onClick={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 size={18} />
      </ToolButton>
      <Divider />
      <ToolButton label={`Left align (${modKey}Shift+L)`} active={state.align === "left"} onClick={() => run().setTextAlign("left").run()}>
        <AlignLeft size={18} />
      </ToolButton>
      <ToolButton label={`Centre align (${modKey}Shift+E)`} active={state.align === "center"} onClick={() => run().setTextAlign("center").run()}>
        <AlignCenter size={18} />
      </ToolButton>
      <ToolButton label={`Right align (${modKey}Shift+R)`} active={state.align === "right"} onClick={() => run().setTextAlign("right").run()}>
        <AlignRight size={18} />
      </ToolButton>
      <ToolButton label={`Justify (${modKey}Shift+J)`} active={state.align === "justify"} onClick={() => run().setTextAlign("justify").run()}>
        <AlignJustify size={18} />
      </ToolButton>
      <Menu
        label={<ListChevronsUpDown size={18} />}
        buttonClassName="tool-button"
        ariaLabel="Line & paragraph spacing"
        title="Line & paragraph spacing"
        entries={lineSpacings.map((spacing) => ({
          label: lineSpacingLabel(spacing),
          checked: state.lineSpacing === spacing,
          onSelect: () => run().setLineSpacing(spacing).run(),
        }))}
      />
      <Divider />
      <ToolButton label={`Bulleted list (${modKey}Shift+8)`} active={state.bulletList} onClick={() => run().toggleBulletList().run()}>
        <List size={18} />
      </ToolButton>
      <ToolButton label={`Numbered list (${modKey}Shift+7)`} active={state.orderedList} onClick={() => run().toggleOrderedList().run()}>
        <ListOrdered size={18} />
      </ToolButton>
      <ToolButton label="Decrease indent (Shift+Tab)" onClick={() => run().changeIndent(-1).run()}>
        <IndentDecrease size={18} />
      </ToolButton>
      <ToolButton label="Increase indent (Tab)" onClick={() => run().changeIndent(1).run()}>
        <IndentIncrease size={18} />
      </ToolButton>
      <ToolButton label={`Clear formatting (${modKey}\\)`} onClick={() => run().unsetAllMarks().setTextAlign("left").run()}>
        <RemoveFormatting size={18} />
      </ToolButton>
      {state.inTable && (
        <>
          <Divider />
          <ToolButton label="Insert row below" onClick={() => run().addRowAfter().run()}>
            <Rows3 size={18} />
          </ToolButton>
          <ToolButton label="Insert column right" onClick={() => run().addColumnAfter().run()}>
            <Columns3 size={18} />
          </ToolButton>
          <ToolButton label="Delete row" onClick={() => run().deleteRow().run()}>
            <Rows3 size={18} className="icon-danger" />
          </ToolButton>
          <ToolButton label="Delete column" onClick={() => run().deleteColumn().run()}>
            <Columns3 size={18} className="icon-danger" />
          </ToolButton>
          <ToolButton label="Delete table" onClick={() => run().deleteTable().run()}>
            <Trash2 size={18} />
          </ToolButton>
        </>
      )}
    </div>
  );
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool-button${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function lineSpacingLabel(spacing: number): string {
  if (spacing === 1) return "Single";
  if (spacing === 2) return "Double";
  return String(spacing);
}

/** Shows the size at the cursor; typing a number and pressing Enter applies it. */
function FontSizeInput({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const [draft, setDraft] = useState(String(size));
  useEffect(() => setDraft(String(size)), [size]);

  const commit = () => {
    const value = Number(draft);
    if (Number.isFinite(value) && value > 0 && value !== size) onChange(value);
    else setDraft(String(size));
  };

  return (
    <input
      className="font-size-input"
      aria-label="Font size"
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") setDraft(String(size));
      }}
    />
  );
}

function Divider() {
  return <span className="toolbar-divider" aria-hidden />;
}
