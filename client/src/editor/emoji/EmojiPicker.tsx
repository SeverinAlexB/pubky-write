// The emoji picker (spec 20), one component for Insert > Symbols > Emoji, comment reactions and
// tab emoji: a search field, nine categories (and Recently used), and the emoji in a scrolling
// grid with a section per category. Its code and data are loaded the first time it opens.
import emojiActivitiesSvg from "@material-symbols/svg-400/outlined/celebration.svg?raw";
import chevronLeftSvg from "@material-symbols/svg-400/outlined/chevron_left.svg?raw";
import chevronRightSvg from "@material-symbols/svg-400/outlined/chevron_right.svg?raw";
import emojiFoodSvg from "@material-symbols/svg-400/outlined/emoji_food_beverage.svg?raw";
import emojiNatureSvg from "@material-symbols/svg-400/outlined/emoji_nature.svg?raw";
import emojiObjectsSvg from "@material-symbols/svg-400/outlined/emoji_objects.svg?raw";
import emojiPeopleSvg from "@material-symbols/svg-400/outlined/emoji_people.svg?raw";
import emojiSymbolsSvg from "@material-symbols/svg-400/outlined/emoji_symbols.svg?raw";
import emojiTravelSvg from "@material-symbols/svg-400/outlined/emoji_transportation.svg?raw";
import flagSvg from "@material-symbols/svg-400/outlined/flag.svg?raw";
import moodSvg from "@material-symbols/svg-400/outlined/mood.svg?raw";
import scheduleSvg from "@material-symbols/svg-400/outlined/schedule.svg?raw";
import searchSvg from "@material-symbols/svg-400/outlined/search.svg?raw";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../components/useDismiss.ts";
import { loadedEmoji, loadEmoji, recentEmoji, rememberEmoji, searchEmoji, type Emoji, type EmojiCategory } from "./emojiData.ts";

export const PICKER_WIDTH = 370;
export const PICKER_HEIGHT = 404;
const LONG_PRESS_MS = 500;

const categoryIcons: Record<string, string> = {
  recent: scheduleSvg,
  smileys: moodSvg,
  people: emojiPeopleSvg,
  nature: emojiNatureSvg,
  food: emojiFoodSvg,
  travel: emojiTravelSvg,
  activities: emojiActivitiesSvg,
  objects: emojiObjectsSvg,
  symbols: emojiSymbolsSvg,
  flags: flagSvg,
};

function SvgIcon({ svg, size = 20 }: { svg: string; size?: number }) {
  return <span className="icon" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Where the picker opens: below this box (above it when there is no room below). */
export type PickerAnchor = { left: number; top: number; bottom: number };

type EmojiPickerProps = {
  anchor: PickerAnchor;
  /** The dialog's accessible name. */
  label?: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
};

/** The picker's place in the window: below the anchor, or above it, and inside the window. */
function placement(anchor: PickerAnchor): { left: number; top: number } {
  const below = anchor.bottom + 4;
  const top = below + PICKER_HEIGHT <= innerHeight - 8 ? below : Math.max(8, anchor.top - 4 - PICKER_HEIGHT);
  const left = Math.min(Math.max(8, anchor.left), Math.max(8, innerWidth - PICKER_WIDTH - 8));
  return { left, top };
}

export function EmojiPicker({ anchor, label = "Emoji picker", onPick, onClose }: EmojiPickerProps) {
  const [categories, setCategories] = useState<EmojiCategory[] | null>(loadedEmoji);
  const [query, setQuery] = useState("");
  const [recent] = useState(recentEmoji);
  const [current, setCurrent] = useState<string | null>(null);
  const [tones, setTones] = useState<{ emoji: Emoji; left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const [overflow, setOverflow] = useState({ previous: false, next: false });
  useDismiss(root, true, onClose);

  useEffect(() => {
    if (!categories) void loadEmoji().then(setCategories);
    search.current?.focus();
  }, []);

  // Recently used (P2) comes first once emoji have been chosen.
  const sections = useMemo(() => {
    if (!categories) return [];
    const byEmoji = new Map(categories.flatMap((category) => category.emoji.flatMap((emoji) => [emoji.emoji, ...(emoji.tones ?? [])].map((key) => [key, emoji] as const))));
    const recentSection: EmojiCategory = {
      id: "recent",
      name: "Recently used",
      emoji: recent.flatMap((value) => {
        const entry = byEmoji.get(value);
        return entry ? [{ ...entry, emoji: value, tones: entry.emoji === value ? entry.tones : null }] : [];
      }),
    };
    return recentSection.emoji.length > 0 ? [recentSection, ...categories] : categories;
  }, [categories, recent]);
  const results = query.trim() && categories ? searchEmoji(categories, query) : null;
  const shownCategory = current ?? sections[0]?.id ?? null;

  const choose = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
  };

  // The category arrows show while the category row does not fit.
  useLayoutEffect(() => {
    const row = tabs.current;
    if (!row) return;
    const update = () => setOverflow({ previous: row.scrollLeft > 0, next: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
    update();
    row.addEventListener("scroll", update);
    return () => row.removeEventListener("scroll", update);
  }, [sections.length]);

  /** The category whose section is at the top of the grid. */
  const onScroll = () => {
    const element = grid.current;
    if (!element || results) return;
    let found: string | null = null;
    for (const section of element.querySelectorAll<HTMLElement>("[data-section]")) {
      if (section.offsetTop <= element.scrollTop + 1) found = section.dataset.section!;
    }
    setCurrent(found ?? sections[0]?.id ?? null);
  };

  const scrollToCategory = (id: string) => {
    setQuery("");
    setCurrent(id);
    requestAnimationFrame(() => {
      const element = grid.current;
      const section = element?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (element && section) element.scrollTop = section.offsetTop;
    });
  };

  const cells = () => [...(grid.current?.querySelectorAll<HTMLButtonElement>(".emoji-cell") ?? [])];

  /** Arrow keys move to the next cell in that direction, by position (sections have rows of their own). */
  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const all = cells();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return all[0]?.focus();
    let next = index;
    if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") next = Math.min(all.length - 1, index + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    else {
      const from = all[index]!;
      const down = event.key === "ArrowDown";
      let best = -1;
      let score = Infinity;
      all.forEach((cell, candidate) => {
        const dy = down ? cell.offsetTop - from.offsetTop : from.offsetTop - cell.offsetTop;
        if (dy <= 4) return;
        const value = dy * 1000 + Math.abs(cell.offsetLeft - from.offsetLeft);
        if (value < score) {
          score = value;
          best = candidate;
        }
      });
      if (best < 0 && !down) return search.current?.focus();
      if (best >= 0) next = best;
    }
    all[next]?.focus();
    all[next]?.scrollIntoView({ block: "nearest" });
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cells()[0]?.focus();
    } else if (event.key === "Enter" && results?.[0]) {
      event.preventDefault();
      choose(results[0].emoji);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (tones) setTones(null);
    else onClose();
  };

  /** Skin tones (P2): a long press on an emoji that has them shows them. */
  const pressStart = (event: PointerEvent<HTMLButtonElement>, emoji: Emoji) => {
    longPress.current.fired = false;
    if (!emoji.tones) return;
    const cell = event.currentTarget;
    longPress.current.timer = setTimeout(() => {
      longPress.current.fired = true;
      const box = root.current!.getBoundingClientRect();
      const rect = cell.getBoundingClientRect();
      setTones({ emoji, left: Math.min(rect.left - box.left, PICKER_WIDTH - 6 * 40 - 8), top: rect.top - box.top - 46 });
    }, LONG_PRESS_MS);
  };
  const pressEnd = () => {
    if (longPress.current.timer) clearTimeout(longPress.current.timer);
    longPress.current.timer = null;
  };

  const cell = (emoji: Emoji, first: boolean) => (
    <button
      key={`${emoji.category}:${emoji.emoji}`}
      type="button"
      className="emoji-cell"
      aria-label={emoji.name}
      data-tooltip={emoji.name}
      tabIndex={first ? 0 : -1}
      onPointerDown={(event) => pressStart(event, emoji)}
      onPointerUp={pressEnd}
      onPointerLeave={pressEnd}
      onContextMenu={(event) => emoji.tones && event.preventDefault()}
      onClick={() => {
        if (longPress.current.fired) return;
        choose(emoji.emoji);
      }}
    >
      {emoji.emoji}
    </button>
  );

  const position = placement(anchor);
  return createPortal(
    <div
      ref={root}
      className="emoji-picker"
      role="dialog"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        // Keep the focus in the picker (and the editor's selection) while it is used.
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <label className="emoji-search">
        <SvgIcon svg={searchSvg} />
        <input
          ref={search}
          type="text"
          placeholder="Search"
          aria-label="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </label>
      <div className="emoji-categories">
        {overflow.previous && (
          <button type="button" className="emoji-scroll" aria-label="Scroll to previous" data-tooltip="Scroll to previous" onClick={() => tabs.current?.scrollBy({ left: -144 })}>
            <SvgIcon svg={chevronLeftSvg} />
          </button>
        )}
        <div ref={tabs} className="emoji-category-row" role="tablist" aria-label="Emoji categories">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              className="emoji-category"
              aria-label={section.name}
              aria-selected={!results && shownCategory === section.id}
              data-tooltip={section.name}
              onClick={() => scrollToCategory(section.id)}
            >
              <SvgIcon svg={categoryIcons[section.id] ?? moodSvg} />
            </button>
          ))}
        </div>
        {overflow.next && (
          <button type="button" className="emoji-scroll" aria-label="Scroll to next" data-tooltip="Scroll to next" onClick={() => tabs.current?.scrollBy({ left: 144 })}>
            <SvgIcon svg={chevronRightSvg} />
          </button>
        )}
      </div>
      <div ref={grid} className="emoji-grid" role="group" aria-label="Browse emoji list" onScroll={onScroll} onKeyDown={onGridKeyDown}>
        {!categories && <p className="emoji-message">Loading…</p>}
        {results && results.length === 0 && <p className="emoji-message">No emoji found</p>}
        {results ? (
          <div className="emoji-section-cells">{results.map((emoji, index) => cell(emoji, index === 0))}</div>
        ) : (
          sections.map((section, sectionIndex) => (
            <section key={section.id} data-section={section.id} aria-label={section.name}>
              <h3 className="emoji-section-title">{section.name}</h3>
              <div className="emoji-section-cells">{section.emoji.map((emoji, index) => cell(emoji, sectionIndex === 0 && index === 0))}</div>
            </section>
          ))
        )}
      </div>
      {tones && (
        <div className="emoji-tones" role="group" aria-label="Skin tones" style={{ left: tones.left, top: tones.top }}>
          {[tones.emoji.emoji, ...tones.emoji.tones!].map((variant) => (
            <button key={variant} type="button" className="emoji-cell" aria-label={`${tones.emoji.name} ${variant}`} onClick={() => choose(variant)}>
              {variant}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
