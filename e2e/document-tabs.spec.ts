// Document tabs (docs/spec/18-document-tabs.md).
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { allowClipboard, chooseStyle, createDocument, editor, focusEditor, menuBarItem, mod, readClipboard, selectionSynced, waitUntilSaved } from "./helpers.ts";

function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Tabs and outlines" });
}

/** The sidebar row of the tab named `name`. */
function tabRow(page: Page, name: string) {
  return sidebar(page)
    .locator(".outline-tab")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

function tabNames(page: Page) {
  return sidebar(page).locator(".outline-tab-name");
}

async function openSidebar(page: Page): Promise<void> {
  if (!(await sidebar(page).isVisible())) await page.getByRole("button", { name: "Show tabs and outlines" }).click();
}

/** Chooses `item` in the ⋮ Tab options menu of tab `name`. */
async function tabOption(page: Page, name: string, item: string, role: "menuitem" | "menuitemcheckbox" = "menuitem"): Promise<void> {
  await tabRow(page, name).hover();
  await tabRow(page, name).getByRole("button", { name: "Tab options" }).click();
  await page.getByRole(role, { name: item, exact: true }).click();
}

async function switchTo(page: Page, name: string): Promise<void> {
  await sidebar(page).getByRole("button", { name, exact: true }).click();
  await expect(sidebar(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
}

async function addTab(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Add tab" }).click();
}

/**
 * The text the editor shows: hidden tabs are in the page but not displayed, and Playwright's text
 * assertions read hidden text too.
 */
function shownText(page: Page, locator = editor(page)) {
  return expect.poll(() => locator.innerText().then((text) => text.replace(/\n+/g, " ").trim()));
}

/** The outline under the shown tab. */
function outlineItems(page: Page) {
  return sidebar(page).locator(".outline-tab-item").filter({ has: page.locator(".outline-tab.is-current") }).getByRole("list", { name: "Outline" }).getByRole("button");
}

/** Types a heading and a paragraph of Normal text after it. */
async function typeSection(page: Page, heading: string, body: string): Promise<void> {
  await chooseStyle(page, "Heading 1");
  await page.keyboard.type(heading);
  await page.keyboard.press("Enter");
  await chooseStyle(page, "Normal text");
  await page.keyboard.type(body);
}

test("Add tab creates Tab 2 and switches to it; tabs keep their own content and outline, and persist", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await typeSection(page, "Introduction", "First tab body");
  await openSidebar(page);

  // The + button at the right of "Document tabs".
  const add = sidebar(page).getByRole("button", { name: "Add tab" });
  const heading = (await sidebar(page).getByRole("heading", { name: "Document tabs" }).boundingBox())!;
  const addBox = (await add.boundingBox())!;
  expect(addBox.x).toBeGreaterThan(heading.x + heading.width);
  expect(Math.abs(addBox.y + addBox.height / 2 - (heading.y + heading.height / 2))).toBeLessThan(4);

  await addTab(page);
  await expect(tabNames(page)).toHaveText(["Tab 1", "Tab 2"]);
  await expect(sidebar(page).getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute("aria-current", "page");
  // The new tab is empty with the cursor at its start: typing goes into it right away.
  await shownText(page).toBe("");
  await expect(editor(page)).toBeFocused();
  await typeSection(page, "Second heading", "Second tab body");
  await expect(outlineItems(page)).toHaveText(["Second heading"]);

  // The current tab has the pill; the other tab has no background.
  await expect(tabRow(page, "Tab 2")).toHaveCSS("background-color", "rgb(211, 227, 253)");
  await expect(tabRow(page, "Tab 1")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await switchTo(page, "Tab 1");
  await shownText(page).toBe("Introduction First tab body");
  await expect(outlineItems(page)).toHaveText(["Introduction"]);
  // Only the shown tab is laid out: one page.
  await expect(page.locator(".editor-app .page-sheets .page")).toHaveCount(1);

  await switchTo(page, "Tab 2");
  await shownText(page).toBe("Second heading Second tab body");
  // Other tabs list their outline only with Show outline on.
  await expect(sidebar(page).getByRole("list", { name: "Outline" })).toHaveCount(1);
  await tabOption(page, "Tab 1", "Show outline", "menuitemcheckbox");
  await expect(sidebar(page).getByRole("list", { name: "Outline" }).first().getByRole("button")).toHaveText(["Introduction"]);
  await expect(sidebar(page).getByRole("list", { name: "Outline" })).toHaveCount(2);
  await tabRow(page, "Tab 1").hover();
  await tabRow(page, "Tab 1").getByRole("button", { name: "Tab options" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Show outline" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await waitUntilSaved(page);
  await page.reload();
  await expect(tabNames(page)).toHaveText(["Tab 1", "Tab 2"]);
  await shownText(page).toBe("Introduction First tab body");
  await switchTo(page, "Tab 2");
  await shownText(page).toBe("Second heading Second tab body");
});

test("Rename, Choose emoji, Add subtab, Duplicate, Move up and down, Move into and Delete work and persist", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Plan text");
  await openSidebar(page);

  // A single tab cannot be deleted.
  await tabRow(page, "Tab 1").getByRole("button", { name: "Tab options" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Rename edits the name in the row: Escape cancels, Enter saves.
  await tabOption(page, "Tab 1", "Rename");
  const field = sidebar(page).getByRole("textbox", { name: "Tab name" });
  await expect(field).toBeFocused();
  await field.fill("Ignored");
  await field.press("Escape");
  await expect(tabNames(page)).toHaveText(["Tab 1"]);
  await tabOption(page, "Tab 1", "Rename");
  await field.fill("Plan");
  await field.press("Enter");
  await expect(tabNames(page)).toHaveText(["Plan"]);

  // Choose emoji replaces the document icon; Remove emoji appears once one is set.
  await tabOption(page, "Plan", "Choose emoji");
  await page.getByRole("dialog", { name: "Choose emoji" }).getByRole("textbox", { name: "Search" }).fill("rocket");
  await page.getByRole("dialog", { name: "Choose emoji" }).getByRole("button", { name: "Rocket" }).click();
  await expect(tabRow(page, "Plan").locator(".outline-tab-emoji")).toHaveText("🚀");
  await tabRow(page, "Plan").getByRole("button", { name: "Tab options" }).click();
  await expect(page.getByRole("menuitem", { name: "Remove emoji" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Add subtab: nested 16px under its parent, which gets a chevron.
  await tabOption(page, "Plan", "Add subtab");
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2"]);
  await expect(sidebar(page).getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.type("Subtab text");
  const planBox = (await tabRow(page, "Plan").boundingBox())!;
  const subBox = (await tabRow(page, "Tab 2").boundingBox())!;
  expect(subBox.x - planBox.x).toBe(16);
  const chevron = tabRow(page, "Plan").getByRole("button", { name: "Collapse Plan" });
  await chevron.click();
  await expect(tabNames(page)).toHaveText(["Plan"]);
  await tabRow(page, "Plan").getByRole("button", { name: "Expand Plan" }).click();
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2"]);

  // Duplicate: "Copy of Plan" after Plan and its subtabs, with the same content.
  await tabOption(page, "Plan", "Duplicate");
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);
  await expect(sidebar(page).getByRole("button", { name: "Copy of Plan" })).toHaveAttribute("aria-current", "page");
  await shownText(page).toBe("Plan text");

  // Move up and Move down among the tabs at the same level (with subtabs).
  await tabRow(page, "Copy of Plan").getByRole("button", { name: "Tab options" }).click();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(tabNames(page)).toHaveText(["Copy of Plan", "Plan", "Tab 2"]);
  await tabOption(page, "Copy of Plan", "Move down");
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);

  // Move into ▸ another top-level tab, and back to the top level.
  await tabRow(page, "Copy of Plan").hover();
  await tabRow(page, "Copy of Plan").getByRole("button", { name: "Tab options" }).click();
  await page.getByRole("menuitem", { name: "Move into" }).hover();
  await page.getByRole("menuitem", { name: "🚀 Plan" }).click();
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);
  expect((await tabRow(page, "Copy of Plan").boundingBox())!.x - planBox.x).toBe(16);

  await waitUntilSaved(page);
  await page.reload();
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);
  await expect(tabRow(page, "Plan").locator(".outline-tab-emoji")).toHaveText("🚀");
  expect((await tabRow(page, "Tab 2").boundingBox())!.x - (await tabRow(page, "Plan").boundingBox())!.x).toBe(16);

  await tabRow(page, "Copy of Plan").hover();
  await tabRow(page, "Copy of Plan").getByRole("button", { name: "Tab options" }).click();
  await page.getByRole("menuitem", { name: "Move into" }).hover();
  await page.getByRole("menuitem", { name: "Top level" }).click();
  expect((await tabRow(page, "Copy of Plan").boundingBox())!.x).toBe((await tabRow(page, "Plan").boundingBox())!.x);

  // Delete asks first; deleting a tab deletes its subtabs.
  await tabOption(page, "Plan", "Delete");
  const dialog = page.getByRole("dialog", { name: "Delete tab?" });
  await expect(dialog).toContainText('"Plan" and its subtabs will be deleted, and its content will be removed.');
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);
  await tabOption(page, "Plan", "Delete");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(tabNames(page)).toHaveText(["Copy of Plan"]);
  await shownText(page).toBe("Plan text");

  // Undo brings the deleted tabs back.
  await focusEditor(page);
  await page.keyboard.press(`${mod}+z`);
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);
  await waitUntilSaved(page);
  await page.reload();
  await expect(tabNames(page)).toHaveText(["Plan", "Tab 2", "Copy of Plan"]);
});

test("Copy link copies a ?tab= link that opens the document on that tab", async ({ page, context, browserName }) => {
  await allowClipboard(context, browserName);
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("In the first tab");
  await openSidebar(page);
  await addTab(page);
  await page.keyboard.type("In the second tab");
  await waitUntilSaved(page);

  await tabOption(page, "Tab 2", "Copy link");
  await expect(page.getByRole("status").filter({ hasText: "Link copied to clipboard" })).toBeVisible();
  const link = await readClipboard(page, browserName);
  expect(new URL(link).pathname).toBe(new URL(page.url()).pathname);
  expect(new URL(link).searchParams.get("tab")).toMatch(/^t\./);

  await page.goto("/");
  await page.goto(link);
  await expect(sidebar(page).getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute("aria-current", "page");
  await shownText(page).toBe("In the second tab");
  // Typing goes into the tab the link opened.
  await editor(page).click();
  await page.keyboard.press(`${mod}+ArrowDown`);
  await selectionSynced(page);
  await page.keyboard.type("!");
  await shownText(page).toBe("In the second tab!");
});

test("comments in Tab 2 show in the margin only in Tab 2, and in All comments with the tab name", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("first words");
  await openSidebar(page);
  await addTab(page);
  await page.keyboard.type("second words");
  await page.keyboard.press(`Shift+${mod === "Meta" ? "Alt" : "Control"}+ArrowLeft`);
  await selectionSynced(page);
  await page.keyboard.press(`${mod}+Alt+m`);
  await page.getByLabel("Comment", { exact: true }).fill("On the second tab");
  await page.getByLabel("Comment", { exact: true }).press(`${mod}+Enter`);
  const card = page.locator(".comment-margin").getByRole("article", { name: 'Comment on "words"' });
  await expect(card).toBeVisible();
  await expect(tabRow(page, "Tab 2").locator(".outline-tab-badge")).toHaveText("1");
  await expect(tabRow(page, "Tab 1").locator(".outline-tab-badge")).toHaveCount(0);

  await switchTo(page, "Tab 1");
  await expect(card).toHaveCount(0);
  await expect(page.locator(".comment-margin")).toHaveCount(0);

  await page.getByRole("button", { name: /Show all comments/ }).click();
  const all = page.getByRole("complementary", { name: "All comments" });
  const listed = all.getByRole("article", { name: 'Comment on "words"' });
  await expect(listed).toContainText("Tab 2");
  await expect(listed).toContainText("On the second tab");
  // Choosing it shows its tab with the thread active.
  await listed.click();
  await expect(sidebar(page).getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/is-active/);
});

test("Find, word count, undo and the scroll position follow the shown tab", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("apple apple");
  for (let line = 0; line < 50; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("bottom of tab one");
  await openSidebar(page);
  const scroller = page.locator(".editor-app .editor-scroll");
  const scrolled = await scroller.evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(300);

  await addTab(page);
  await page.keyboard.type("apple pie with three words more");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);

  // Find searches the shown tab.
  await page.keyboard.press(`${mod}+f`);
  await page.getByRole("textbox", { name: "Find in document" }).fill("apple");
  await expect(page.locator(".search-match")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Word count counts the shown tab (closing the find bar selected the match: unselect it).
  await expect(editor(page)).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("apple");
  // After the find bar's focus, which comes a frame later and writes the selection back.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("");
  // The editor reads the moved caret asynchronously.
  await expect
    .poll(() => page.evaluate(() => (document.querySelector(".ProseMirror") as unknown as { editor: { state: { selection: { empty: boolean } } } }).editor.state.selection.empty))
    .toBe(true);
  await page.keyboard.press(`${mod}+Shift+c`);
  const counts = page.getByRole("dialog", { name: "Word count" });
  await expect(counts.getByRole("row", { name: /Words/ })).toHaveText("Words6");
  await counts.getByRole("button", { name: "OK" }).click();

  // Back on Tab 1 where it was left.
  await switchTo(page, "Tab 1");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(300);

  // Undo is the shown tab's: Tab 2's typing is not undone from Tab 1. Adding Tab 2 was Tab 1's
  // latest change (a document-wide one), so that is what ⌘Z undoes here.
  await page.keyboard.press(`${mod}+z`);
  await expect(tabNames(page)).toHaveText(["Tab 1"]);
  await shownText(page).toContain("bottom of tab one");
});

test("undo and redo act on the shown tab, and reach tab commands when they are the tab's latest change", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("One");
  await openSidebar(page);
  await addTab(page);
  await page.keyboard.type("Two");
  await switchTo(page, "Tab 1");
  await focusEditor(page);
  await selectionSynced(page);
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await waitUntilSaved(page);

  // In Tab 2, ⌘Z undoes Tab 2's typing; Tab 1's later edit stays.
  await switchTo(page, "Tab 2");
  await page.keyboard.press(`${mod}+z`);
  await shownText(page).toBe("");
  await switchTo(page, "Tab 1");
  await shownText(page).toBe("One more");

  // In Tab 1: its own edit, then adding Tab 2 (a document-wide change after Tab 1's first edit), then its first edit.
  await page.keyboard.press(`${mod}+z`);
  await shownText(page).toBe("One");
  await page.keyboard.press(`${mod}+z`);
  await expect(tabNames(page)).toHaveText(["Tab 1"]);
  await page.keyboard.press(`${mod}+z`);
  await shownText(page).toBe("");

  // Redo brings them back in order; the toolbar's Redo is the same.
  await page.keyboard.press(`${mod}+y`);
  await shownText(page).toBe("One");
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(tabNames(page)).toHaveText(["Tab 1", "Tab 2"]);
  await page.getByRole("button", { name: /^Redo/ }).click();
  await shownText(page).toBe("One more");
  await expect(page.getByRole("button", { name: /^Redo/ })).toBeDisabled();
  await switchTo(page, "Tab 2");
  await expect(page.getByRole("button", { name: /^Redo/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Redo/ }).click();
  await shownText(page).toBe("Two");

  // Saved like any edit.
  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await openSidebar(page);
  await switchTo(page, "Tab 2");
  await shownText(page).toBe("Two");
  await switchTo(page, "Tab 1");
  await shownText(page).toBe("One more");
});

test("downloads offer the current tab or all tabs, print shows the current tab, and version history shows the tabs", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Alpha text");
  await openSidebar(page);
  await addTab(page);
  await page.keyboard.type("Beta text");
  await waitUntilSaved(page);

  const download = async (name: string) => {
    const pending = page.waitForEvent("download");
    await menuBarItem(page, "File").click();
    await page.getByRole("menuitem", { name: "Download" }).hover();
    await page.getByRole("menuitem", { name, exact: true }).click();
    return readFile(await (await pending).path(), "utf8");
  };
  await menuBarItem(page, "File").click();
  await page.getByRole("menuitem", { name: "Download" }).hover();
  await expect(page.getByRole("menu").last()).toContainText("Current tab");
  await expect(page.getByRole("menu").last()).toContainText("All tabs");
  await page.keyboard.press("Escape");
  expect(await download("Markdown (.md)")).toBe("Beta text\n");
  expect(await download("Markdown (.md), all tabs")).toBe("# Tab 1\n\nAlpha text\n\n<!-- page break -->\n\n# Tab 2\n\nBeta text\n");
  expect(await download("Plain text (.txt)")).toBe("Beta text");

  // Printing prints the shown tab: the other is not displayed.
  await page.emulateMedia({ media: "print" });
  await expect(editor(page).locator(".document-tab").first()).toBeHidden();
  await expect(editor(page).locator(".document-tab").last()).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // The version preview has the same tab sidebar, starting on the shown tab.
  await page.getByRole("button", { name: "Version history" }).click();
  const preview = page.getByRole("region", { name: "Selected version" });
  const historyTabs = page.locator(".history-mode").getByRole("complementary", { name: "Tabs and outlines" });
  await expect(historyTabs.locator(".outline-tab-name")).toHaveText(["Tab 1", "Tab 2"]);
  await expect(historyTabs.getByRole("button", { name: "Add tab" })).toHaveCount(0);
  const previewText = preview.locator(".ProseMirror");
  await shownText(page, previewText).toBe("Beta text");
  await historyTabs.getByRole("button", { name: "Tab 1", exact: true }).click();
  await shownText(page, previewText).toBe("Alpha text");
});

test("the document list's thumbnail shows the first tab", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Shown in the thumbnail");
  await openSidebar(page);
  await addTab(page);
  await page.keyboard.type("Not in the thumbnail");
  // Moved first in the sidebar, Tab 2 becomes the first tab.
  await waitUntilSaved(page);
  const id = new URL(page.url()).pathname.split("/").pop();
  const preview = async () => JSON.stringify(await (await page.request.get(`/api/documents/${id}/preview`)).json());
  expect(await preview()).toContain("Shown in the thumbnail");
  expect(await preview()).not.toContain("Not in the thumbnail");
  await tabOption(page, "Tab 2", "Move up");
  await waitUntilSaved(page);
  expect(await preview()).toContain("Not in the thumbnail");
});
