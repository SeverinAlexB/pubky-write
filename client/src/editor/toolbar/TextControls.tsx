import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon.tsx";
import { Menu, type MenuEntry } from "../../components/Menu.tsx";
import { MenuList } from "../../components/MenuList.tsx";
import { usePopover } from "../../components/usePopover.ts";
import { shortcut, withShortcut } from "../../components/shortcuts.ts";
import type { EditorActions } from "../actions.ts";
import { changeFontSize, setFontSize } from "../extensions.ts";
import { DEFAULT_FONT, fontFamilies, fontSizes, recentFonts, rememberRecentFont } from "../fonts.ts";
import { applyParagraphStyle, paragraphStyles, type ParagraphStyle } from "../paragraphStyles.ts";
import { ToolButton } from "./ToolButton.tsx";

function DropdownLabel({ value }: { value: string }) {
  return (
    <>
      <span className="tool-dropdown-value">{value}</span>
      <Icon name="arrow_drop_down" size={20} />
    </>
  );
}

/** The Styles dropdown: each style's name drawn in that style. */
export function StylesControl({
  editor,
  current,
  actions,
}: {
  editor: Editor;
  current: ParagraphStyle | null;
  actions: EditorActions;
}) {
  const entries: MenuEntry[] = paragraphStyles
    .filter((style) => style.inToolbar)
    .flatMap((style): MenuEntry[] => [styleEntry(editor, style, current), "separator"]);
  entries.push({ label: "Options", onSelect: actions.styleOptions });

  return (
    <Menu
      label={<DropdownLabel value={current?.label ?? ""} />}
      ariaLabel="Styles"
      buttonClassName="tool-dropdown styles-dropdown"
      listClassName="styles-menu"
      entries={entries}
    />
  );
}

/**
 * A paragraph style as a menu entry. The Styles dropdown draws each name in its style
 * (`preview`); Format > Paragraph styles uses plain menu text.
 */
export function styleEntry(editor: Editor, style: ParagraphStyle, current: ParagraphStyle | null, preview = true): MenuEntry {
  const apply = () => applyParagraphStyle(editor, style);
  return {
    label: style.label,
    content: preview ? (
      <span className="style-preview" style={style.preview}>
        {style.label}
      </span>
    ) : undefined,
    checked: current?.id === style.id,
    onSelect: apply,
    submenu: [
      { label: `Apply '${style.label}'`, shortcut: style.shortcut && shortcut(style.shortcut), onSelect: apply },
      // P2: { label: `Update '${style.label}' to match` }
    ],
  };
}

/** The Font dropdown: recently used fonts, then every font, each drawn in its own typeface. */
export function FontControl({ editor, current, actions }: { editor: Editor; current: string | null; actions: EditorActions }) {
  const fontEntry = (font: string): MenuEntry => ({
    label: font,
    content: <span style={{ fontFamily: font }}>{font}</span>,
    checked: font === current,
    onSelect: () => {
      rememberRecentFont(font);
      const chain = editor.chain().focus();
      if (font === DEFAULT_FONT) chain.unsetFontFamily().run();
      else chain.setFontFamily(font).run();
    },
  });
  const recent = recentFonts();

  return (
    <Menu
      label={<DropdownLabel value={current ?? ""} />}
      ariaLabel="Font"
      buttonClassName="tool-dropdown font-dropdown"
      listClassName="font-menu"
      entries={[
        { label: "More fonts", icon: "text_format", onSelect: actions.moreFonts },
        "separator",
        ...(recent.length > 0 ? [{ heading: "RECENT" }, ...recent.map(fontEntry), "separator" as const] : []),
        ...fontFamilies.map(fontEntry),
      ]}
    />
  );
}

/** −, the size box (click for the size list, or type a size and press Enter), and +. */
export function FontSizeControl({ editor, size }: { editor: Editor; size: number | null }) {
  const { open, setOpen, close, root } = usePopover();
  const shown = size === null ? "" : String(size);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const value = Number(draft);
    if (draft.trim() && Number.isFinite(value) && value > 0) setFontSize(editor, value);
    else setDraft(shown);
    close();
  };

  return (
    <>
      <ToolButton
        label={withShortcut("Decrease font size", "⌘+Shift+comma")}
        className="font-size-step"
        onClick={() => changeFontSize(editor, -1)}
      >
        <Icon name="remove" size={20} />
      </ToolButton>
      <div className="menu" ref={root}>
        <input
          className="font-size-input"
          aria-label="Font size"
          data-tooltip="Font size"
          aria-expanded={open}
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onClick={() => setOpen(true)}
          onBlur={() => setDraft(shown)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") setDraft(shown);
          }}
        />
        {open && (
          <MenuList
            label="Font size"
            className="menu-list-start font-size-menu"
            onClose={close}
            entries={fontSizes.map((option) => ({
              label: String(option),
              checked: option === size,
              onSelect: () => setFontSize(editor, option),
            }))}
          />
        )}
      </div>
      <ToolButton
        label={withShortcut("Increase font size", "⌘+Shift+full stop")}
        className="font-size-step"
        onClick={() => changeFontSize(editor, 1)}
      >
        <Icon name="add" size={20} />
      </ToolButton>
    </>
  );
}
