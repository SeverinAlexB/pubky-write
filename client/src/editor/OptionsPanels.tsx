// Table options and Image options: side panels right of the pages for the table at the cursor
// or the selected image. Alignment, column width and rotation are not available yet.
import { DEFAULT_TABLE_BORDER_COLOR, DEFAULT_TABLE_BORDER_WIDTH_PT, isSize } from "@docs/shared";
import { NodeSelection } from "@tiptap/pm/state";
import { isInTable, selectedRect } from "@tiptap/pm/tables";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { ColorPicker } from "./toolbar/ColorPicker.tsx";

const borderWidths = [0, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

function SidePanel({ title, icon, onClose, children }: { title: string; icon: IconName; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="side-panel" aria-label={title}>
      <div className="side-panel-header">
        <Icon name={icon} size={24} />
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} data-tooltip="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="side-panel-body">{children}</div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="side-panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function selectTable({ editor }: { editor: Editor }) {
  const { state } = editor;
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const cell = rect.table.nodeAt(rect.map.map[rect.top * rect.map.width + rect.left]!);
  return {
    tablePos: rect.tableStart - 1,
    columns: rect.map.width,
    rows: rect.map.height,
    borderColor: (rect.table.attrs.borderColor as string | null) ?? DEFAULT_TABLE_BORDER_COLOR,
    borderWidth: (rect.table.attrs.borderWidth as number | null) ?? DEFAULT_TABLE_BORDER_WIDTH_PT,
    rowHeight: (rect.table.child(rect.top).attrs.height as number | null) ?? null,
    background: (cell?.attrs.backgroundColor as string | null) ?? null,
    selectedRows: Array.from({ length: rect.bottom - rect.top }, (_, index) => rect.top + index),
  };
}

export function TableOptionsPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const table = useEditorState({ editor, selector: selectTable, equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

  const setTableAttribute = (name: string, value: unknown) => {
    if (!table) return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(table.tablePos, name, value));
  };

  const setRowHeight = (height: number | null) => {
    if (!table) return;
    const tableNode = editor.state.doc.nodeAt(table.tablePos)!;
    const tr = editor.state.tr;
    let offset = table.tablePos + 1;
    tableNode.forEach((row, _, index) => {
      if (table.selectedRows.includes(index)) tr.setNodeAttribute(offset, "height", height);
      offset += row.nodeSize;
    });
    editor.view.dispatch(tr);
  };

  return (
    <SidePanel title="Table options" icon="table" onClose={onClose}>
      {!table ? (
        <p className="side-panel-empty">Select a table to see table options.</p>
      ) : (
        <>
          <Section title="Table">
            <div className="side-panel-row">
              <span>Columns</span>
              <output aria-label="Columns">{table.columns}</output>
            </div>
            <div className="side-panel-row">
              <span>Rows</span>
              <output aria-label="Rows">{table.rows}</output>
            </div>
          </Section>
          <Section title="Size">
            <NumberField
              label="Minimum row height (px)"
              value={table.rowHeight}
              onCommit={(value) => setRowHeight(value && value > 0 ? Math.round(value) : null)}
            />
          </Section>
          <Section title="Colour">
            <div className="side-panel-row">
              <span>Border colour</span>
              <ColorPicker
                label="Border colour"
                icon={<span className="side-panel-swatch" style={{ background: table.borderColor }} />}
                current={table.borderColor}
                onPick={(color) => setTableAttribute("borderColor", color && color !== DEFAULT_TABLE_BORDER_COLOR ? color : null)}
              />
            </div>
            <label className="side-panel-row">
              <span>Border width</span>
              <select
                aria-label="Border width"
                value={table.borderWidth}
                onChange={(event) => {
                  const width = Number(event.target.value);
                  setTableAttribute("borderWidth", width === DEFAULT_TABLE_BORDER_WIDTH_PT ? null : width);
                }}
              >
                {borderWidths.map((width) => (
                  <option key={width} value={width}>
                    {width}pt
                  </option>
                ))}
              </select>
            </label>
            <div className="side-panel-row">
              <span>Cell background colour</span>
              <ColorPicker
                label="Cell background colour"
                icon={<span className="side-panel-swatch" style={{ background: table.background ?? "#ffffff" }} />}
                current={table.background}
                allowNone
                onPick={(color) => editor.chain().setCellAttribute("backgroundColor", color).run()}
              />
            </div>
          </Section>
        </>
      )}
    </SidePanel>
  );
}

function selectImage({ editor }: { editor: Editor }) {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return null;
  const { width, height, alt, src } = selection.node.attrs;
  return {
    pos: selection.from,
    src: src as string,
    width: isSize(width) ? width : null,
    height: isSize(height) ? height : null,
    alt: (alt as string | null) ?? "",
  };
}

export function ImageOptionsPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const image = useEditorState({ editor, selector: selectImage, equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const [keepRatio, setKeepRatio] = useState(true);
  const [alt, setAlt] = useState(image?.alt ?? "");
  useEffect(() => setAlt(image?.alt ?? ""), [image?.pos, image?.alt]);

  const update = (attrs: Record<string, unknown>) => {
    if (!image) return;
    const node = editor.state.doc.nodeAt(image.pos);
    if (node?.type.name !== "image") return;
    const tr = editor.state.tr.setNodeMarkup(image.pos, undefined, { ...node.attrs, ...attrs });
    editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, image.pos)));
  };

  /** The shown size: the stored one, or the image's size on the page. */
  const shownSize = () => {
    const element = image && editor.view.nodeDOM(image.pos);
    const img = element instanceof HTMLElement ? element.querySelector("img") : null;
    return { width: image?.width ?? img?.offsetWidth ?? 0, height: image?.height ?? img?.offsetHeight ?? 0 };
  };

  const setSize = (dimension: "width" | "height", value: number | null) => {
    if (!value || value <= 0) return;
    const size = shownSize();
    const ratio = size.width && size.height ? size.width / size.height : 1;
    const next = { ...size, [dimension]: Math.round(value) };
    if (keepRatio) {
      if (dimension === "width") next.height = Math.round(next.width / ratio);
      else next.width = Math.round(next.height * ratio);
    }
    update(next);
  };

  return (
    <SidePanel title="Image options" icon="imagesmode" onClose={onClose}>
      {!image ? (
        <p className="side-panel-empty">Select an image to see image options.</p>
      ) : (
        <>
          <Section title="Size">
            <NumberField label="Width (px)" value={image.width ?? shownSize().width} onCommit={(value) => setSize("width", value)} />
            <NumberField label="Height (px)" value={image.height ?? shownSize().height} onCommit={(value) => setSize("height", value)} />
            <label className="side-panel-check">
              <input type="checkbox" checked={keepRatio} onChange={(event) => setKeepRatio(event.target.checked)} />
              Lock aspect ratio
            </label>
          </Section>
          <Section title="Alt text">
            <label className="side-panel-field">
              <span>Description</span>
              <textarea
                aria-label="Alt text"
                rows={3}
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                onBlur={() => alt !== image.alt && update({ alt: alt.trim() || null })}
              />
            </label>
          </Section>
        </>
      )}
    </SidePanel>
  );
}

/** A number input that applies its value on Enter or when it loses focus. */
function NumberField({ label, value, onCommit }: { label: string; value: number | null; onCommit: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const parsed = Number.parseFloat(text);
    const next = Number.isFinite(parsed) ? parsed : null;
    if (next !== value) onCommit(next);
  };
  return (
    <label className="side-panel-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}
