import { listPresetAt } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useCallback, useRef, type ReactNode } from "react";
import { Icon } from "../../components/Icon.tsx";
import { Menu } from "../../components/Menu.tsx";
import { usePopover } from "../../components/usePopover.ts";
import { useRovingToolbar } from "../../components/useRovingToolbar.ts";
import { withShortcut } from "../../components/shortcuts.ts";
import type { EditorActions } from "../actions.ts";
import { clearFormatting, selectedFontFamily, selectedFontSize } from "../extensions.ts";
import { paragraphSpacingAt } from "../formatMenus.ts";
import { currentParagraphStyle } from "../paragraphStyles.ts";
import { ColorPicker } from "./ColorPicker.tsx";
import { AlignControl, LineSpacingControl, ListControl, type Alignment } from "./ParagraphControls.tsx";
import { FontControl, FontSizeControl, StylesControl } from "./TextControls.tsx";
import { Divider, ToolButton } from "./ToolButton.tsx";
import { usePaintFormat } from "./usePaintFormat.ts";
import { useToolbarOverflow } from "./useToolbarOverflow.ts";
import { ZoomControl, type Zoom } from "./ZoomControl.tsx";

type ToolbarProps = {
  editor: Editor;
  actions: EditorActions;
  zoom: Zoom;
  onZoomChange: (zoom: Zoom) => void;
  menusHidden: boolean;
  onToggleMenus: () => void;
};

/** The rounded formatting bar under the menus. Controls that do not fit move into "More". */
export function Toolbar({ editor, actions, zoom, onZoomChange, menusHidden, onToggleMenus }: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      return {
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        style: currentParagraphStyle(editor),
        fontFamily: selectedFontFamily(editor),
        fontSize: selectedFontSize(editor),
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        color: (editor.getAttributes("textStyle").color as string | undefined) ?? null,
        highlight: (editor.getAttributes("highlight").color as string | undefined) ?? null,
        align: (["center", "right", "justify"] as const).find((align) => editor.isActive({ textAlign: align })) ?? "left",
        bulletList: editor.isActive("bulletList"),
        orderedList: editor.isActive("orderedList"),
        checklist: editor.isActive("taskList"),
        listPresets: {
          bullet: listPresetAt(editor.state, "bullet"),
          numbered: listPresetAt(editor.state, "numbered"),
          checklist: listPresetAt(editor.state, "checklist"),
        },
        hasSelection: !editor.state.selection.empty,
        spacing: paragraphSpacingAt(editor),
      };
    },
  });
  const paintFormat = usePaintFormat(editor);
  // One Tab stop; ← → move between the controls and Escape returns to the document.
  const toolbar = useRef<HTMLDivElement>(null);
  useRovingToolbar(toolbar, useCallback(() => editor.commands.focus(), [editor]));
  const run = () => editor.chain().focus();

  const items: ReactNode[] = [
    <ToolButton key="search" label={withShortcut("Search the menus", "Option+/")} onClick={actions.searchMenus}>
      <Icon name="search" />
    </ToolButton>,
    <ToolButton key="undo" label={withShortcut("Undo", "⌘Z")} disabled={!state.canUndo} onClick={() => run().undo().run()}>
      <Icon name="undo" />
    </ToolButton>,
    <ToolButton key="redo" label={withShortcut("Redo", "⌘Y")} disabled={!state.canRedo} onClick={() => run().redo().run()}>
      <Icon name="redo" />
    </ToolButton>,
    <ToolButton key="print" label={withShortcut("Print", "⌘P")} onClick={actions.print}>
      <Icon name="print" />
    </ToolButton>,
    <ToolButton
      key="paint"
      label="Paint format"
      active={paintFormat.active}
      onClick={() => paintFormat.start(false)}
      onDoubleClick={() => paintFormat.start(true)}
    >
      <Icon name="format_paint" />
    </ToolButton>,
    <ZoomControl
      key="zoom"
      zoom={zoom}
      onChange={(value) => {
        onZoomChange(value);
        editor.commands.focus();
      }}
    />,
    <Divider key="divider-zoom" />,
    <StylesControl key="styles" editor={editor} current={state.style} actions={actions} />,
    <Divider key="divider-styles" />,
    <FontControl key="font" editor={editor} current={state.fontFamily} actions={actions} />,
    <Divider key="divider-font" />,
    <FontSizeControl key="font-size" editor={editor} size={state.fontSize} />,
    <Divider key="divider-size" />,
    <ToolButton key="bold" label={withShortcut("Bold", "⌘B")} active={state.bold} onClick={() => run().toggleBold().run()}>
      <Icon name="format_bold" />
    </ToolButton>,
    <ToolButton
      key="italic"
      label={withShortcut("Italic", "⌘I")}
      active={state.italic}
      onClick={() => run().toggleItalic().run()}
    >
      <Icon name="format_italic" />
    </ToolButton>,
    <ToolButton
      key="underline"
      label={withShortcut("Underline", "⌘U")}
      active={state.underline}
      onClick={() => run().toggleUnderline().run()}
    >
      <Icon name="format_underlined" />
    </ToolButton>,
    <ColorPicker
      key="text-colour"
      label="Text colour"
      icon={<ColorIcon name="format_color_text" color={state.color ?? "#000000"} />}
      current={state.color ?? "#000000"}
      onPick={(color) => (color && color !== "#000000" ? run().setColor(color).run() : run().unsetColor().run())}
    />,
    <ColorPicker
      key="highlight-colour"
      label="Highlight colour"
      icon={<ColorIcon name="ink_highlighter" color={state.highlight ?? "transparent"} />}
      current={state.highlight}
      allowNone
      onPick={(color) => (color ? run().setHighlight({ color }).run() : run().unsetHighlight().run())}
    />,
    <Divider key="divider-colour" />,
    <ToolButton key="link" label={withShortcut("Insert link", "⌘K")} onClick={actions.insertLink}>
      <Icon name="link" />
    </ToolButton>,
    <ToolButton
      key="comment"
      label={withShortcut("Add comment", "⌘+Option+M")}
      disabled={!state.hasSelection}
      onClick={actions.addComment}
    >
      <Icon name="add_comment" />
    </ToolButton>,
    <Menu
      key="image"
      label={
        <>
          <Icon name="image" />
          <Icon name="arrow_drop_down" size={16} className="tool-button-arrow" />
        </>
      }
      ariaLabel="Insert image"
      buttonClassName="tool-button tool-button-with-arrow image-button"
      entries={[
        { label: "Upload from computer", icon: "upload", onSelect: actions.uploadImage },
        { label: "By URL", icon: "link", onSelect: actions.insertImageByUrl },
      ]}
    />,
    <Divider key="divider-insert" />,
    <AlignControl key="align" editor={editor} current={state.align as Alignment} />,
    <LineSpacingControl key="line-spacing" editor={editor} actions={actions} current={state.spacing} />,
    <ListControl
      key="checklist"
      kind="checklist"
      label={withShortcut("Checklist", "⌘+Shift+9")}
      icon="checklist"
      active={state.checklist}
      onToggle={actions.toggleChecklist}
      presets={state.listPresets}
      onPickPreset={actions.applyListPreset}
    />,
    <ListControl
      key="bulleted"
      kind="bullet"
      label={withShortcut("Bulleted list", "⌘+Shift+8")}
      icon="format_list_bulleted"
      active={state.bulletList}
      onToggle={() => run().toggleBulletList().run()}
      presets={state.listPresets}
      onPickPreset={actions.applyListPreset}
    />,
    <ListControl
      key="numbered"
      kind="numbered"
      label={withShortcut("Numbered list", "⌘+Shift+7")}
      icon="format_list_numbered"
      active={state.orderedList}
      onToggle={() => run().toggleOrderedList().run()}
      presets={state.listPresets}
      onPickPreset={actions.applyListPreset}
    />,
    <ToolButton key="outdent" label={withShortcut("Decrease indent", "⌘+[")} onClick={() => run().changeIndent(-1).run()}>
      <Icon name="format_indent_decrease" />
    </ToolButton>,
    <ToolButton key="indent" label={withShortcut("Increase indent", "⌘+]")} onClick={() => run().changeIndent(1).run()}>
      <Icon name="format_indent_increase" />
    </ToolButton>,
    <ToolButton key="clear" label={withShortcut("Clear formatting", "⌘+\\")} onClick={() => clearFormatting(editor)}>
      <Icon name="format_clear" />
    </ToolButton>,
  ];

  const { bar, visibleCount } = useToolbarOverflow(items.length);
  const more = usePopover();
  const overflow = items.slice(visibleCount);

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting" ref={toolbar}>
      <div className="toolbar-items" ref={bar}>
        {items.slice(0, visibleCount).map((item, index) => (
          <div key={index} className="toolbar-item">
            {item}
          </div>
        ))}
      </div>
      {overflow.length > 0 && (
        <div className="menu" ref={more.root}>
          <ToolButton label="More" active={more.open} onClick={() => more.setOpen((open) => !open)}>
            <Icon name="more_vert" />
          </ToolButton>
          {more.open && (
            <div className="toolbar-overflow" role="toolbar" aria-label="More formatting">
              {overflow.map((item, index) => (
                <div key={visibleCount + index} className="toolbar-item">
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ToolButton
        label={withShortcut(menusHidden ? "Show the menus" : "Hide the menus", "⌘+Shift+F")}
        className="hide-menus-button"
        onClick={onToggleMenus}
      >
        <Icon name={menusHidden ? "keyboard_arrow_down" : "keyboard_arrow_up"} />
      </ToolButton>
    </div>
  );
}

/** A colour button's icon with the colour bar under it. */
function ColorIcon({ name, color }: { name: "format_color_text" | "ink_highlighter"; color: string }) {
  return (
    <span className={`color-icon color-icon-${name}`}>
      <Icon name={name} />
      <span className="color-icon-bar" style={{ background: color }} />
    </span>
  );
}
