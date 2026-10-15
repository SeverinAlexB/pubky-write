import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

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

/** A menu in the editor's menu bar (File, Edit, View, Insert, Format, Tools). */
export function menuBarItem(page: Page, name: string) {
  return page.getByRole("menubar", { name: "Menu bar" }).getByRole("menuitem", { name, exact: true });
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
  await menuBarItem(page, "File").click();
  await page.getByRole("menuitem", { name: "Download" }).hover();
  await page.getByRole("menuitem", { name: format }).click();
}

/**
 * Waits until the editor has read the browser's selection. The editor picks up selection changes
 * made by the browser (clicks, arrow keys) asynchronously, so a shortcut pressed right after could
 * still see the old selection. It also waits until 20ms after the editor got the focus, when
 * ProseMirror puts its selection back into the page once more; keys pressed before that can be
 * undone by it (seen in Firefox).
 */
export async function selectionSynced(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        type View = {
          state: { selection: { head: number } };
          posAtDOM: (node: globalThis.Node, offset: number) => number;
          input?: { lastFocus?: number };
        };
        const view = (document.querySelector(".ProseMirror") as unknown as { editor: { view: View } }).editor.view;
        if (Date.now() - (view.input?.lastFocus ?? 0) < 40) return false;
        const selection = getSelection();
        if (!selection?.focusNode) return true;
        return view.posAtDOM(selection.focusNode, selection.focusOffset) === view.state.selection.head;
      }),
    )
    .toBe(true);
}

/**
 * Double-clicks the middle of `text` inside `locator`. A double-click on a locator hits the middle
 * of its element, which for a paragraph is often past the end of its text, where browsers select
 * different things (Chrome the last word, Firefox the whole line).
 */
export async function dblclickText(page: Page, locator: Locator, text: string): Promise<void> {
  const rect = await locator.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent!.indexOf(wanted);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + wanted.length);
      const { left, top, width, height } = range.getBoundingClientRect();
      return { left, top, width, height };
    }
    throw new Error(`No text ${wanted}`);
  }, text);
  await page.mouse.dblclick(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/**
 * Lets the page use the clipboard. Chrome needs the permissions; Firefox has no such permissions
 * (playwright.config.ts sets preferences that let the tests read the clipboard there), and WebKit
 * allows writing on a click and reading only by a real paste (see `readClipboard`).
 */
export async function allowClipboard(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

/** The clipboard's text. WebKit has no permission for reading it, so it is pasted into a scratch field there. */
export async function readClipboard(page: Page, browserName: string): Promise<string> {
  if (browserName !== "webkit") return page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => {
    const field = document.createElement("textarea");
    field.id = "clipboard-reader";
    document.body.append(field);
    (window as unknown as { focusBeforeClipboard: Element | null }).focusBeforeClipboard = document.activeElement;
    field.focus();
  });
  await page.keyboard.press(`${mod}+v`);
  return page.evaluate(() => {
    const field = document.getElementById("clipboard-reader") as HTMLTextAreaElement;
    field.remove();
    ((window as unknown as { focusBeforeClipboard: Element | null }).focusBeforeClipboard as HTMLElement | null)?.focus();
    return field.value;
  });
}
