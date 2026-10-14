import type { Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../../components/Icon.tsx";
import { codePointLabel, searchCharacters, toInfo, type CharacterData, type CharacterInfo } from "./characterSearch.ts";

const DIALOG_WIDTH = 604;
const DIALOG_HEIGHT = 425;
/** Space between the dialog and the bottom of the editor area. */
const BOTTOM_GAP = 24;
/** Characters per row of the 24px grid. */
const COLUMNS = 14;

// The names are in their own chunk, fetched when the dialog first opens.
let dataPromise: Promise<CharacterData> | null = null;
function loadCharacterData(): Promise<CharacterData> {
  return (dataPromise ??= import("./characterData.json").then((module) => module.default as CharacterData));
}

type SpecialCharactersDialogProps = {
  /** The editor characters are inserted into (the body, or the header, footer or footnote being edited). */
  editor: Editor;
  initialCategory?: string;
  onClose: () => void;
};

/**
 * Insert > Symbols > Special characters: a non-modal dialog near the bottom of the editor area.
 * Clicking a character inserts it at the cursor and leaves the dialog open. The handwriting
 * area ("Draw a symbol here") is not built; its place shows the preview of the character under
 * the pointer.
 */
export function SpecialCharactersDialog({ editor, initialCategory = "Symbol", onClose }: SpecialCharactersDialogProps) {
  const [data, setData] = useState<CharacterData | null>(null);
  const [categoryName, setCategoryName] = useState(initialCategory);
  const [subcategoryIndex, setSubcategoryIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<CharacterInfo | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    void loadCharacterData().then((loaded) => current && setData(loaded));
    return () => {
      current = false;
    };
  }, []);

  // Near the bottom centre of the editor area, so the cursor in the upper part stays visible.
  useLayoutEffect(() => {
    const area = document.querySelector(".editor-area")?.getBoundingClientRect();
    const bounds = area ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    setPosition({
      left: Math.max(8, Math.round(bounds.left + (bounds.width - DIALOG_WIDTH) / 2)),
      top: Math.max(8, Math.round(Math.min(bounds.bottom, window.innerHeight) - DIALOG_HEIGHT - BOTTOM_GAP)),
    });
  }, []);

  // After the menu that opened the dialog has returned the focus to the document.
  useEffect(() => {
    const timer = setTimeout(() => searchField.current?.focus());
    return () => clearTimeout(timer);
  }, []);

  const category = data?.categories.find((candidate) => candidate.name === categoryName) ?? data?.categories[0];
  const subcategory = category?.subcategories[subcategoryIndex] ?? category?.subcategories[0];
  const characters = useMemo(() => {
    if (!data) return [];
    if (query.trim()) return searchCharacters(data, query);
    return (subcategory?.characters ?? []).map(toInfo);
  }, [data, query, subcategory]);

  useEffect(() => setFocusIndex(0), [characters]);

  const insert = (info: CharacterInfo) => {
    if (editor.isDestroyed) return;
    const { from, to } = editor.state.selection;
    // insertText keeps the formatting at the cursor.
    editor.view.dispatch(editor.state.tr.insertText(info.char, from, to).scrollIntoView());
  };

  const moveFocus = (index: number) => {
    const next = Math.min(Math.max(index, 0), characters.length - 1);
    setFocusIndex(next);
    setPreview(characters[next] ?? null);
    grid.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      moveFocus(focusIndex + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(characters.length - 1);
    }
  };

  return (
    <div
      ref={root}
      className="special-characters-dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby="special-characters-title"
      style={position ?? { visibility: "hidden" }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-title-row">
        <h2 id="special-characters-title">Insert special characters</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={24} />
        </button>
      </div>
      <div className="special-characters-body">
        <div className="special-characters-browse">
          <div className="special-characters-selects">
            <select
              className="select-field"
              aria-label="Category"
              value={category?.name ?? categoryName}
              onChange={(event) => {
                setCategoryName(event.target.value);
                setSubcategoryIndex(0);
                setQuery("");
              }}
            >
              {(data?.categories ?? [{ name: categoryName }]).map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
            <select
              className="select-field"
              aria-label="Subcategory"
              value={subcategoryIndex}
              onChange={(event) => {
                setSubcategoryIndex(Number(event.target.value));
                setQuery("");
              }}
            >
              {(category?.subcategories ?? []).map((option, index) => (
                <option key={option.name} value={index}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div
            ref={grid}
            className="special-characters-grid"
            role="group"
            aria-label={query.trim() ? "Search results" : (subcategory?.name ?? "Characters")}
            onKeyDown={onGridKeyDown}
            onMouseLeave={() => setPreview(null)}
          >
            {characters.map((info, index) => (
              <button
                key={info.code}
                type="button"
                className="special-character"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={info.name ? `${info.name} ${codePointLabel(info.code)}` : codePointLabel(info.code)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setPreview(info)}
                onFocus={() => {
                  setFocusIndex(index);
                  setPreview(info);
                }}
                onClick={() => insert(info)}
              >
                {info.char}
              </button>
            ))}
            {data && characters.length === 0 && <p className="special-characters-empty">No characters found</p>}
          </div>
        </div>
        <div className="special-characters-side">
          <label className="text-field special-characters-search">
            <input
              ref={searchField}
              placeholder="Search by keyword (e.g. arrow) or code point"
              aria-label="Search by keyword (e.g. arrow) or code point"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Icon name="search" size={20} />
          </label>
          <div className="special-characters-preview" aria-live="polite">
            {preview && (
              <>
                <span className="special-characters-preview-char">{preview.char}</span>
                <span className="special-characters-preview-name">
                  {codePointLabel(preview.code)}
                  {preview.name && ` ${preview.name}`}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
