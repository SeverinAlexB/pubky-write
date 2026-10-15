// The tabs and outline sidebar (docs/spec/07-outline.md, 18-document-tabs.md): the document's
// tabs, nested, each with a ⋮ menu, and under the shown tab (and tabs with "Show outline") an
// outline of its headings.
import { acceptedTextBetween, tabTree, type DocTab, type TabEntry } from "@docs/shared";
import type { Node } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { Menu, type MenuEntry } from "../components/Menu.tsx";
import { useDismiss } from "../components/useDismiss.ts";
import {
  addSubtab,
  canAddSubtab,
  canMoveTab,
  currentTab,
  deleteTab,
  duplicateTab,
  moveTab,
  moveTabInto,
  moveTargets,
  setTabAttribute,
} from "./documentTabs.ts";

/** A heading in the outline; level 0 is the Title. */
export type OutlineHeading = { level: number; text: string; pos: number };

// The outline of each tab, kept while the editor shows it: the selector runs on every transaction.
const outlines = new WeakMap<Node, { from: number; headings: OutlineHeading[] }>();

/** Title and Heading 1–6 blocks with text in a tab, in document order. */
export function outlineHeadings(tab: Pick<DocTab, "node" | "pos" | "from">): OutlineHeading[] {
  const cached = outlines.get(tab.node);
  if (cached && cached.from === tab.from) return cached.headings;
  // A tab node's content starts one position after it; a document's at 0.
  const offset = tab.pos === null ? 0 : tab.from;
  const headings: OutlineHeading[] = [];
  tab.node.descendants((node, pos) => {
    const level = node.type.name === "heading" ? (node.attrs.level as number) : node.attrs.paragraphStyle === "title" ? 0 : null;
    if (level !== null && node.isTextblock) {
      // Without text suggested for deletion.
      const text = acceptedTextBetween(node, 0, node.content.size).trim();
      if (text) headings.push({ level, text, pos: pos + offset });
    }
    return node.isBlock && !node.isTextblock; // headings only live at block level
  });
  outlines.set(tab.node, { from: tab.from, headings });
  return headings;
}

/** The round button at the top left of the editor area that opens the sidebar. */
export function OutlineToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="outline-toggle"
      aria-label="Show tabs and outlines"
      data-tooltip="Show tabs and outlines"
      onClick={onOpen}
    >
      <Icon name="list" />
    </button>
  );
}

/** Emoji offered by Choose emoji. */
const TAB_EMOJI = [
  "📄", "📝", "📌", "📎", "📁", "📊", "📈", "📅", "✅", "⭐", "🔥", "💡",
  "🚀", "🎯", "🎉", "❤️", "👍", "👋", "🙂", "🤔", "⚠️", "❗", "❓", "🔒",
  "🔑", "🛠️", "⚙️", "🧪", "📚", "🎨", "🌍", "🏠", "💬", "📣", "🕒", "💰",
];

/** What the sidebar shows of a tab: comparable by value, so the sidebar renders only when it changes. */
type TabRow = Pick<TabEntry, "id" | "name" | "emoji" | "depth" | "showOutline" | "parent"> & { hasChildren: boolean };

export type TabActions = {
  /** Shows a tab (remembering where the current one was); `reveal`: the caller scrolls to something in it. */
  onSwitch: (id: string, reveal?: boolean) => void;
  /** Runs a tab command; null means it was not possible. */
  onCommand: (command: (state: EditorState) => Transaction | null) => void;
  onAddTab: () => void;
  onCopyLink: (id: string) => void;
};

type OutlinePanelProps = {
  editor: Editor;
  /** Open comments by tab id, for the badges. */
  openComments: Record<string, number>;
  onClose: () => void;
  /** Without them the sidebar only lists the tabs (the version history preview). */
  actions?: TabActions;
  /** Switching tabs when there are no actions (the preview). */
  onSwitch?: (id: string, reveal?: boolean) => void;
};

export function OutlinePanel({ editor, openComments, onClose, actions, onSwitch }: OutlinePanelProps) {
  const { rows, currentId, outlines: tabOutlines, currentPos } = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { state } = current;
      const tree = tabTree(state.doc);
      const shown = currentTab(state);
      const cursor = state.selection.from;
      const headings: Record<string, OutlineHeading[]> = {};
      for (const tab of tree) if (tab.id === shown.id || tab.showOutline) headings[tab.id] = outlineHeadings(tab);
      const currentHeadings = headings[shown.id] ?? [];
      return {
        rows: tree.map(
          ({ id, name, emoji, depth, showOutline, parent, childIds }): TabRow => ({ id, name, emoji, depth, showOutline, parent, hasChildren: childIds.length > 0 }),
        ),
        currentId: shown.id,
        outlines: headings,
        currentPos: currentHeadings.findLast((heading) => heading.pos < cursor)?.pos ?? null,
      };
    },
  });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TabRow | null>(null);
  const switchTo = actions?.onSwitch ?? onSwitch ?? (() => {});

  // Subtabs of a collapsed tab are not listed; the shown tab's ancestors are always expanded.
  const hidden = new Set<string>();
  for (const row of rows) if (row.parent !== null && (hidden.has(row.parent) || collapsed.has(row.parent))) hidden.add(row.id);

  const jumpTo = (heading: OutlineHeading, tabId: string) => {
    if (tabId !== currentId) switchTo(tabId, true);
    editor.chain().focus().setTextSelection(heading.pos + 1).run();
    // Bring the heading to the top of the view, past any page spacer before it.
    const scroll = () => {
      const dom = editor.view.nodeDOM(heading.pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
    };
    if (tabId === currentId) scroll();
    else requestAnimationFrame(() => requestAnimationFrame(scroll));
  };

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <aside className="outline-panel" aria-label="Tabs and outlines">
      <button
        type="button"
        className="icon-button outline-back"
        aria-label="Hide tabs and outlines"
        data-tooltip="Hide tabs and outlines"
        onClick={onClose}
      >
        <Icon name="arrow_back" />
      </button>
      <div className="outline-tabs-header">
        <h2 className="outline-heading">Document tabs</h2>
        {actions && (
          <button type="button" className="icon-button outline-add-tab" aria-label="Add tab" data-tooltip="Add tab" onClick={actions.onAddTab}>
            <Icon name="add" />
          </button>
        )}
      </div>
      <ul className="outline-tabs" aria-label="Document tabs">
        {rows
          .filter((row) => !hidden.has(row.id))
          .map((row) => {
            const current = row.id === currentId;
            const comments = openComments[row.id] ?? 0;
            const headings = tabOutlines[row.id];
            return (
              <li key={row.id} className="outline-tab-item" data-tab-id={row.id}>
                <div
                  className={`outline-tab${current ? " is-current" : ""}`}
                  style={{ marginLeft: row.depth * 16 }}
                  onClick={(event) => {
                    if (renaming !== row.id && !(event.target as HTMLElement).closest(".menu, .outline-tab-chevron")) switchTo(row.id);
                  }}
                >
                  {row.hasChildren && (
                    <button
                      type="button"
                      className="icon-button outline-tab-chevron"
                      aria-label={collapsed.has(row.id) ? `Expand ${row.name}` : `Collapse ${row.name}`}
                      aria-expanded={!collapsed.has(row.id)}
                      onClick={() => toggleCollapsed(row.id)}
                    >
                      <Icon name={collapsed.has(row.id) ? "arrow_right" : "arrow_drop_down"} size={20} />
                    </button>
                  )}
                  {row.emoji ? (
                    <span className="outline-tab-emoji" aria-hidden>
                      {row.emoji}
                    </span>
                  ) : (
                    <Icon name="description" />
                  )}
                  {renaming === row.id && actions ? (
                    <RenameField
                      name={row.name}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name !== null) actions.onCommand((state) => setTabAttribute(state, row.id, "name", name));
                      }}
                    />
                  ) : (
                    <button type="button" className="outline-tab-name" aria-current={current ? "page" : undefined} title={row.name}>
                      {row.name}
                    </button>
                  )}
                  {comments > 0 && (
                    <span className="outline-tab-badge" aria-label={`${comments} open comments`} title={`${comments} open comments`}>
                      {comments}
                    </span>
                  )}
                  {actions && (
                    <Menu
                      label={<Icon name="more_vert" />}
                      ariaLabel="Tab options"
                      buttonClassName="icon-button outline-tab-menu"
                      align="end"
                      // The sidebar scrolls, which would clip the menu and its Move into submenu.
                      fixed
                      entries={tabMenu(editor, row, rows.length, actions, {
                        rename: () => setRenaming(row.id),
                        chooseEmoji: () => setEmojiFor(row.id),
                        delete: () => setDeleting(row),
                      })}
                    />
                  )}
                </div>
                {emojiFor === row.id && actions && (
                  <EmojiPicker
                    onPick={(emoji) => {
                      setEmojiFor(null);
                      actions.onCommand((state) => setTabAttribute(state, row.id, "emoji", emoji));
                    }}
                    onClose={() => setEmojiFor(null)}
                  />
                )}
                {headings && (
                  <TabOutline
                    headings={headings}
                    currentPos={current ? currentPos : null}
                    indent={row.depth * 16}
                    onJump={(heading) => jumpTo(heading, row.id)}
                  />
                )}
              </li>
            );
          })}
      </ul>
      {deleting && actions && (
        <ConfirmDialog
          title="Delete tab?"
          message={`"${deleting.name}"${deleting.hasChildren ? " and its subtabs" : ""} will be deleted, and its content will be removed.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            actions.onCommand((state) => deleteTab(state, id));
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </aside>
  );
}

function tabMenu(
  editor: Editor,
  row: TabRow,
  tabCount: number,
  actions: TabActions,
  open: { rename: () => void; chooseEmoji: () => void; delete: () => void },
): MenuEntry[] {
  const { doc } = editor.state;
  const targets = moveTargets(doc, row.id);
  return [
    {
      label: "Add subtab",
      icon: "add",
      disabled: !canAddSubtab(doc, row.id),
      onSelect: () => actions.onCommand((state) => addSubtab(state, row.id)),
    },
    { label: "Delete", icon: "delete", disabled: tabCount <= 1, onSelect: open.delete },
    { label: "Duplicate", icon: "content_copy", onSelect: () => actions.onCommand((state) => duplicateTab(state, row.id)) },
    { label: "Rename", icon: "edit", onSelect: open.rename },
    { label: "Choose emoji", icon: "add_reaction", onSelect: open.chooseEmoji },
    ...(row.emoji
      ? [{ label: "Remove emoji", onSelect: () => actions.onCommand((state) => setTabAttribute(state, row.id, "emoji", null)) }]
      : []),
    "separator",
    { label: "Copy link", icon: "link", onSelect: () => actions.onCopyLink(row.id) },
    {
      label: "Show outline",
      checked: row.showOutline,
      onSelect: () => actions.onCommand((state) => setTabAttribute(state, row.id, "showOutline", !row.showOutline)),
    },
    "separator",
    { label: "Move up", icon: "arrow_upward", disabled: !canMoveTab(doc, row.id, -1), onSelect: () => actions.onCommand((state) => moveTab(state, row.id, -1)) },
    { label: "Move down", icon: "arrow_downward", disabled: !canMoveTab(doc, row.id, 1), onSelect: () => actions.onCommand((state) => moveTab(state, row.id, 1)) },
    {
      label: "Move into",
      disabled: targets.tabs.length === 0 && !targets.topLevel,
      submenu: [
        ...targets.tabs.map((tab) => ({
          label: tab.emoji ? `${tab.emoji} ${tab.name}` : tab.name,
          onSelect: () => actions.onCommand((state) => moveTabInto(state, row.id, tab.id)),
        })),
        ...(targets.tabs.length > 0 ? ["separator" as const] : []),
        { label: "Top level", disabled: !targets.topLevel, onSelect: () => actions.onCommand((state) => moveTabInto(state, row.id, null)) },
      ],
    },
  ];
}

/** Rename: the name as a text field in the row. Enter saves, Escape cancels. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result !== null && result.trim() && result.trim() !== name ? result.trim().slice(0, 100) : null);
  };
  return (
    <input
      className="outline-tab-rename"
      aria-label="Tab name"
      value={value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(value);
        }
        if (event.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value)}
    />
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, true, onClose);
  return (
    <div ref={root} className="tab-emoji-picker" role="dialog" aria-label="Choose emoji">
      {TAB_EMOJI.map((emoji) => (
        <button key={emoji} type="button" className="tab-emoji" aria-label={emoji} onClick={() => onPick(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

function TabOutline({
  headings,
  currentPos,
  indent,
  onJump,
}: {
  headings: OutlineHeading[];
  currentPos: number | null;
  indent: number;
  onJump: (heading: OutlineHeading) => void;
}) {
  // A tab without headings shows no outline (and no hint).
  if (headings.length === 0) return null;
  const topLevel = Math.min(...headings.map((heading) => heading.level));
  return (
    <ol className="outline-list" aria-label="Outline" style={{ marginLeft: 12 + indent }}>
      {headings.map((heading, index) => {
        const current = heading.pos === currentPos;
        return (
          // By index: typing above a heading moves its position, which would recreate every item after it.
          <li key={index} className={current ? "is-current" : undefined}>
            <button
              type="button"
              className="outline-item"
              style={{ paddingLeft: 16 + (heading.level - topLevel) * 12 }}
              data-level={heading.level}
              aria-current={current ? "location" : undefined}
              title={heading.text}
              onClick={() => onJump(heading)}
            >
              {heading.text}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
