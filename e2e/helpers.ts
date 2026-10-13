import { expect, type Page } from "@playwright/test";

export const mod = process.platform === "darwin" ? "Meta" : "Control";
/** Start and end of the line: Home/End scroll the page in Chrome on macOS. */
export const lineStart = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";
export const lineEnd = process.platform === "darwin" ? "Meta+ArrowRight" : "End";

export async function createDocument(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Blank document" }).click();
  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(editor(page)).toBeVisible();
}

export function editor(page: Page) {
  return page.getByLabel("Document content");
}

export async function waitUntilSaved(page: Page): Promise<void> {
  await expect(page.getByRole("status").first()).toHaveAttribute("title", "Saved");
}

/** Opens the toolbar's Styles menu and applies a paragraph style. */
export async function chooseStyle(page: Page, style: string): Promise<void> {
  await page.getByRole("button", { name: "Styles" }).click();
  await page.getByRole("menuitemcheckbox", { name: style, exact: true }).click();
}

/** Chooses File > Download > `format`. */
export async function chooseDownload(page: Page, format: string): Promise<void> {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Download" }).hover();
  await page.getByRole("menuitem", { name: format }).click();
}

/**
 * Waits until the editor has read the browser's selection. The editor picks up selection changes
 * made by the browser (clicks, arrow keys) asynchronously, so a shortcut pressed right after could
 * still see the old selection.
 */
export async function selectionSynced(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        type View = {
          state: { selection: { head: number } };
          posAtDOM: (node: globalThis.Node, offset: number) => number;
        };
        const view = (document.querySelector(".ProseMirror") as unknown as { editor: { view: View } }).editor.view;
        const selection = getSelection();
        if (!selection?.focusNode) return true;
        return view.posAtDOM(selection.focusNode, selection.focusOffset) === view.state.selection.head;
      }),
    )
    .toBe(true);
}
