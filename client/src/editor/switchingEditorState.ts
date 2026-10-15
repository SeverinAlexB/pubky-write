import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useCallback, useRef } from "react";

/**
 * `useEditorState` for an editor that changes while the component stays (the body, or the header,
 * footer or footnote being edited). Tiptap's snapshot keeps the previous editor until the new one
 * has a transaction, which it may already have had before the hook started watching it (Safari
 * focuses the header while it is created), so the selector reads the editor of this render. It
 * runs again when the editor changes or has a transaction, not on every render.
 */
export function useSwitchingEditorState<T>(
  editor: Editor,
  selector: (editor: Editor) => T,
  equalityFn?: (a: T, b: T | null) => boolean,
): T {
  const latest = useRef(selector);
  latest.current = selector;
  const select = useCallback(() => latest.current(editor), [editor]);
  return useEditorState({ editor, selector: select, equalityFn });
}
