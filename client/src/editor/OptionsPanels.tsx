// Table options and Image options: side panels right of the pages for the table at the cursor
// or the selected image. Table alignment and column width are not available yet.
import {
  DEFAULT_TABLE_BORDER_COLOR,
  DEFAULT_TABLE_BORDER_WIDTH_PT,
  imageLayoutOf,
  imageMarginLabel,
  imageMarginPresets,
  isSize,
  normalizeRotation,
} from "@pubky-write/shared";
import { NodeSelection } from "@tiptap/pm/state";
import { isInTable, selectedRect } from "@tiptap/pm/tables";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { setImageAttributes, setImagePositioning, setImageWrap } from "./imageCommands.ts";
import { positionOptions, wrapOptions } from "./ImagePill.tsx";
import { ColorPicker } from "./toolbar/ColorPicker.tsx";

const borderWidths = [0, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

function SidePanel({
  title,
  icon,
  onClose,
  closeLabel = `Close ${title.toLowerCase()}`,
  children,
}: {
  title: string;
  icon: IconName;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    <aside className="side-panel" aria-label={title}>
      <div className="side-panel-header">
        <Icon name={icon} size={24} />
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={closeLabel} data-tooltip={closeLabel} onClick={onClose}>
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
  const { width, height, alt, title, src } = selection.node.attrs;
  return {
    pos: selection.from,
    src: src as string,
    width: isSize(width) ? width : null,
    height: isSize(height) ? height : null,
    alt: (alt as string | null) ?? "",
    title: (title as string | null) ?? "",
    layout: imageLayoutOf(selection.node.attrs),
  };
}

type SectionName = "size" | "wrapping" | "position" | "recolour" | "adjustments" | "alt";

/**
 * Format > Image > Image options (or the pill's or toolbar's Image options): size and rotation,
 * text wrapping, position, re-colour, adjustments and alt text of the selected image. Changes apply
 * at once and are undone like any other edit.
 */
export function ImageOptionsPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const image = useEditorState({ editor, selector: selectImage, equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const [keepRatio, setKeepRatio] = useState(true);
  const [open, setOpen] = useState<Set<SectionName>>(() => new Set(["size", "wrapping"]));
  const [alt, setAlt] = useState(image?.alt ?? "");
  const [title, setTitle] = useState(image?.title ?? "");
  useEffect(() => setAlt(image?.alt ?? ""), [image?.pos, image?.alt]);
  useEffect(() => setTitle(image?.title ?? ""), [image?.pos, image?.title]);
  // A slider gesture (from pressing to releasing it) is one undo step.
  const sliding = useRef(false);

  const update = (attrs: Record<string, unknown>, merge = false) => setImageAttributes(editor.view, attrs, merge);

  /** The shown size: the stored one, or the image's size on the page. */
  const shownSize = () => {
    const element = image && editor.view.nodeDOM(image.pos);
    const box = element instanceof HTMLElement ? element.querySelector<HTMLElement>(".image-crop.is-cropped") ?? element.querySelector("img") : null;
    return { width: image?.width ?? box?.offsetWidth ?? 0, height: image?.height ?? box?.offsetHeight ?? 0 };
  };

  /** The visible part of the picture at its natural size, for the scale. */
  const naturalSize = () => {
    const element = image && editor.view.nodeDOM(image.pos);
    const img = element instanceof HTMLElement ? element.querySelector("img") : null;
    const crop = image?.layout.crop;
    if (!img?.naturalWidth) return null;
    return {
      width: img.naturalWidth * (crop ? 1 - crop.left - crop.right : 1),
      height: img.naturalHeight * (crop ? 1 - crop.top - crop.bottom : 1),
    };
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

  const setScale = (percent: number | null) => {
    const natural = naturalSize();
    if (!percent || percent <= 0 || !natural) return;
    update({ width: Math.round((natural.width * percent) / 100), height: Math.round((natural.height * percent) / 100) });
  };

  const toggle = (name: SectionName) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const slider = (label: string, name: "transparency" | "brightness" | "contrast", min: number) => (
    <label className="side-panel-field side-panel-slider">
      <span>
        {label} <output>{image!.layout[name]}%</output>
      </span>
      <input
        type="range"
        min={min}
        max={100}
        step={1}
        aria-label={label}
        value={image!.layout[name]}
        onPointerDown={() => (sliding.current = false)}
        onKeyDown={() => (sliding.current = false)}
        onChange={(event) => {
          update({ [name]: Number(event.target.value) }, sliding.current);
          sliding.current = true;
        }}
      />
    </label>
  );

  const natural = image ? naturalSize() : null;
  const size = image ? shownSize() : null;
  return (
    <SidePanel title="Image options" icon="imagesmode" onClose={onClose} closeLabel="Close side sheet">
      {!image ? (
        <p className="side-panel-empty">Select an image to see image options.</p>
      ) : (
        <>
          <CollapsibleSection title="Size and rotation" open={open.has("size")} onToggle={() => toggle("size")}>
            <div className="side-panel-pair">
              <NumberField label="Width (px)" value={image.width ?? size!.width} onCommit={(value) => setSize("width", value)} />
              <NumberField label="Height (px)" value={image.height ?? size!.height} onCommit={(value) => setSize("height", value)} />
            </div>
            <label className="side-panel-check">
              <input type="checkbox" checked={keepRatio} onChange={(event) => setKeepRatio(event.target.checked)} />
              Lock aspect ratio
            </label>
            <NumberField
              label="Scale (%)"
              value={natural && size ? Math.round((size.width / natural.width) * 100) : null}
              onCommit={setScale}
            />
            <NumberField
              label="Rotation angle (°)"
              value={image.layout.rotation}
              onCommit={(value) => value !== null && update({ rotation: normalizeRotation(value) })}
            />
          </CollapsibleSection>
          <CollapsibleSection title="Text wrapping" open={open.has("wrapping")} onToggle={() => toggle("wrapping")}>
            <div className="side-panel-wraps" role="radiogroup" aria-label="Text wrapping">
              {wrapOptions.map(({ wrap, label, icon }) => (
                <button
                  key={wrap}
                  type="button"
                  role="radio"
                  aria-checked={image.layout.wrap === wrap}
                  aria-label={label}
                  data-tooltip={label}
                  className={`side-panel-wrap${image.layout.wrap === wrap ? " is-current" : ""}`}
                  onClick={() => setImageWrap(editor.view, wrap)}
                >
                  <Icon name={icon} size={24} />
                </button>
              ))}
            </div>
            {image.layout.wrap !== "inline" && (
              <label className="side-panel-row">
                <span>Margin</span>
                <select
                  aria-label="Margin"
                  value={imageMarginPresets.find((points) => Math.abs(points - image.layout.wrapMargin) < 0.01) ?? "custom"}
                  onChange={(event) => event.target.value !== "custom" && update({ wrapMargin: Number(event.target.value) })}
                >
                  {imageMarginPresets.map((points) => (
                    <option key={points} value={points}>
                      {imageMarginLabel(points).replace(" margin", "")}
                    </option>
                  ))}
                  {!imageMarginPresets.some((points) => Math.abs(points - image.layout.wrapMargin) < 0.01) && (
                    <option value="custom">{imageMarginLabel(image.layout.wrapMargin).replace(" margin", "")}</option>
                  )}
                </select>
              </label>
            )}
          </CollapsibleSection>
          <CollapsibleSection title="Position" open={open.has("position")} onToggle={() => toggle("position")}>
            {image.layout.wrap === "inline" ? (
              <p className="side-panel-note">Images in line with text move with the text.</p>
            ) : (
              <>
                <div className="side-panel-radios" role="radiogroup" aria-label="Position">
                  {positionOptions.map(({ positioning, label }) => (
                    <label key={positioning} className="side-panel-check">
                      <input
                        type="radio"
                        name="image-position"
                        checked={image.layout.positioning === positioning}
                        onChange={() => setImagePositioning(editor.view, positioning)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="side-panel-pair">
                  <NumberField label="X (px)" min={-20000} value={image.layout.offsetX} onCommit={(value) => value !== null && update({ offsetX: value })} />
                  <NumberField label="Y (px)" min={-20000} value={image.layout.offsetY} onCommit={(value) => value !== null && update({ offsetY: value })} />
                </div>
                <p className="side-panel-note">
                  {image.layout.positioning === "fixed" ? "From the top left corner of the page." : "From the paragraph the image is anchored to."}
                </p>
              </>
            )}
          </CollapsibleSection>
          <CollapsibleSection title="Re-colour" open={open.has("recolour")} onToggle={() => toggle("recolour")}>
            <label className="side-panel-row">
              <span>Re-colour</span>
              <select
                aria-label="Re-colour"
                value={image.layout.recolor ?? "none"}
                onChange={(event) => update({ recolor: event.target.value === "none" ? null : event.target.value })}
              >
                <option value="none">No re-colour</option>
                <option value="greyscale">Greyscale</option>
                <option value="sepia">Sepia</option>
              </select>
            </label>
          </CollapsibleSection>
          <CollapsibleSection title="Adjustments" open={open.has("adjustments")} onToggle={() => toggle("adjustments")}>
            {slider("Transparency", "transparency", 0)}
            {slider("Brightness", "brightness", -100)}
            {slider("Contrast", "contrast", -100)}
            <button
              type="button"
              className="button-secondary side-panel-reset"
              onClick={() => update({ transparency: 0, brightness: 0, contrast: 0 })}
            >
              Reset
            </button>
          </CollapsibleSection>
          <CollapsibleSection title="Alt text" open={open.has("alt")} onToggle={() => toggle("alt")}>
            <label className="side-panel-field">
              <span>Title</span>
              <input
                type="text"
                aria-label="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => title !== image.title && update({ title: title.trim() || null })}
              />
            </label>
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
          </CollapsibleSection>
        </>
      )}
    </SidePanel>
  );
}

/** A section whose title button shows or hides its content. */
function CollapsibleSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = `side-panel-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="side-panel-section is-collapsible">
      <h3>
        <button type="button" className="side-panel-section-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span>{title}</span>
          <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} />
        </button>
      </h3>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** A number input that applies its value on Enter or when it loses focus. */
function NumberField({
  label,
  value,
  onCommit,
  min = 0,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  min?: number;
}) {
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
        min={min}
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
