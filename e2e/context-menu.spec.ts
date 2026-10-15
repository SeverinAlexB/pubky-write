import { expect, test, type Page } from "@playwright/test";
import { allowClipboard, createDocument, editor, mod, readClipboard, selectionSynced } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

function contextMenu(page: Page) {
  return page.getByRole("menu", { name: "Context menu" });
}

/** The menu's top-level entries: labels, "—" for separators. */
function entries(page: Page) {
  return contextMenu(page)
    .locator(":scope > li")
    .evaluateAll((items) =>
      items.map((item) => (item.classList.contains("menu-separator") ? "—" : item.querySelector("button")?.getAttribute("aria-label"))),
    );
}

const selection = (page: Page) =>
  page.evaluate(() => {
    const view = (document.querySelector(".ProseMirror") as unknown as { editor: { state: { selection: { from: number; to: number } } } })
      .editor;
    return { from: view.state.selection.from, to: view.state.selection.to };
  });

async function typeParagraph(page: Page, text: string) {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type(text);
}

test("right-click shows the app's menu with the specified items; Cut, Copy and Delete need a selection", async ({ page }) => {
  await typeParagraph(page, "Some words to click on");
  const paragraph = editor(page).locator("p").first();
  const box = (await paragraph.boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height / 2, { button: "right" });

  const menu = contextMenu(page);
  await expect(menu).toBeVisible();
  // At the pointer.
  const menuBox = (await menu.boundingBox())!;
  expect(Math.round(menuBox.x)).toBe(Math.round(box.x + 30));
  expect(Math.round(menuBox.y)).toBe(Math.round(box.y + box.height / 2));
  expect(menuBox.width).toBeGreaterThanOrEqual(260);

  expect(await entries(page)).toEqual([
    "Cut",
    "Copy",
    "Copy as Markdown",
    "Paste",
    "Paste without formatting",
    "Paste from Markdown",
    "Delete",
    "—",
    "Comment",
    "—",
    "Insert link",
    "—",
    "Format options",
    "Clear formatting",
  ]);
  for (const name of ["Cut", "Copy", "Copy as Markdown", "Delete", "Comment"]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeDisabled();
  }
  await expect(menu.getByRole("menuitem", { name: "Paste", exact: true })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Paste without formatting" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Clear formatting" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Cut", exact: true })).toContainText(process.platform === "darwin" ? "⌘X" : "Ctrl+X");
  await expect(menu.getByRole("menuitem", { name: "Insert link" })).toContainText(process.platform === "darwin" ? "⌘K" : "Ctrl+K");
  // Icons sit in the icon column.
  await expect(menu.getByRole("menuitem", { name: "Cut", exact: true }).locator(".menu-item-icon svg")).toHaveCount(1);

  // Format options has the four format submenus.
  await menu.getByRole("menuitem", { name: "Format options" }).hover();
  const format = page.getByRole("menu", { name: "Format options" });
  for (const name of ["Text", "Paragraph styles", "Align and indent", "Line & paragraph spacing"]) {
    await expect(format.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("a right-click in a selection keeps it and enables Cut, Copy, Delete and Comment", async ({ page }) => {
  await typeParagraph(page, "Alpha beta gamma");
  await editor(page).getByText("Alpha beta gamma").dblclick({ position: { x: 5, y: 5 } });
  await selectionSynced(page);
  const selected = await selection(page);
  expect(selected.to).toBeGreaterThan(selected.from);

  const paragraph = (await editor(page).locator("p").first().boundingBox())!;
  await page.mouse.click(paragraph.x + 10, paragraph.y + paragraph.height / 2, { button: "right" });
  await expect(contextMenu(page)).toBeVisible();
  expect(await selection(page)).toEqual(selected);
  for (const name of ["Cut", "Copy", "Copy as Markdown", "Delete", "Comment"]) {
    await expect(contextMenu(page).getByRole("menuitem", { name, exact: true })).toBeEnabled();
  }
  await contextMenu(page).getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(editor(page).locator("p").first()).toHaveText(" beta gamma");
});

test("a right-click outside the selection moves the cursor to the pointer first", async ({ page }) => {
  await typeParagraph(page, "Alpha beta gamma");
  // Inside a selection of everything: it stays selected.
  await page.keyboard.press(`${mod}+a`);
  const everything = await selection(page);
  await editor(page).getByText("Alpha beta gamma").click({ button: "right", position: { x: 40, y: 5 } });
  await expect(contextMenu(page)).toBeVisible();
  expect(await selection(page)).toEqual(everything);
  await page.keyboard.press("Escape");

  // Now with a selection of the first word only, right-click on the last word.
  await page.keyboard.press(`${mod}+ArrowLeft`);
  await page.keyboard.press("Shift+Alt+ArrowRight");
  await selectionSynced(page);
  const gamma = await editor(page).evaluate(() => {
    const text = document.querySelector(".ProseMirror p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 13);
    range.setEnd(text, 14);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(gamma.x, gamma.y, { button: "right" });
  await expect(contextMenu(page)).toBeVisible();
  const moved = await selection(page);
  expect(moved.from).toBe(moved.to);
  expect(moved.from).toBeGreaterThanOrEqual(14);
  await expect(contextMenu(page).getByRole("menuitem", { name: "Copy", exact: true })).toBeDisabled();
});

test("Shift+right-click leaves the browser's menu", async ({ page, browserName }) => {
  await typeParagraph(page, "Spelling");
  await page.evaluate(() => {
    (window as unknown as { lastContextMenu: boolean | null }).lastContextMenu = null;
    window.addEventListener("contextmenu", (event) => {
      (window as unknown as { lastContextMenu: boolean | null }).lastContextMenu = event.defaultPrevented;
    });
  });
  await editor(page).getByText("Spelling").click({ button: "right", modifiers: ["Shift"] });
  // Firefox does not send the contextmenu event to the page for Shift+right-click (it always shows
  // its own menu), so there is no event to check there.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { lastContextMenu: boolean | null }).lastContextMenu))
    .toBe(browserName === "firefox" ? null : false);
  await expect(contextMenu(page)).toBeHidden();

  await editor(page).getByText("Spelling").click({ button: "right" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { lastContextMenu: boolean | null }).lastContextMenu)).toBe(true);
  await expect(contextMenu(page)).toBeVisible();
});

test("the menu flips to stay inside the window", async ({ page }) => {
  await typeParagraph(page, "Line");
  for (let line = 0; line < 30; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("Bottom line");
  const bottom = (await editor(page).getByText("Bottom line").boundingBox())!;
  expect(bottom.y).toBeGreaterThan(600);
  await page.mouse.click(bottom.x + 20, bottom.y + 5, { button: "right" });
  const menu = (await contextMenu(page).boundingBox())!;
  // Opens upwards, ending at the pointer.
  expect(menu.y + menu.height).toBeLessThanOrEqual(900);
  expect(Math.abs(menu.y + menu.height - (bottom.y + 5))).toBeLessThanOrEqual(1);
  expect(Math.abs(menu.x - (bottom.x + 20))).toBeLessThanOrEqual(1);
});

test("the menu works from the keyboard", async ({ page }) => {
  await typeParagraph(page, "Make this bold");
  await page.keyboard.press(`${mod}+a`);
  await editor(page).getByText("Make this bold").click({ button: "right" });
  const menu = contextMenu(page);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Cut", exact: true })).toHaveClass(/is-highlighted/);
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Clear formatting" })).toHaveClass(/is-highlighted/);
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Format options" })).toHaveClass(/is-highlighted/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter"); // Text
  await page.keyboard.press("Enter"); // Bold
  await expect(menu).toBeHidden();
  await expect(editor(page).locator("strong")).toHaveText("Make this bold");
});

test("on a link the menu offers Edit link, Copy link and Remove link", async ({ page, context, browserName }) => {
  await allowClipboard(context, browserName);
  await typeParagraph(page, "Visit ");
  await page.keyboard.press(`${mod}+k`);
  await page.getByLabel("Link URL").fill("example.com");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(editor(page).locator("a")).toHaveText("example.com");

  await editor(page).locator("a").click({ button: "right" });
  const labels = await entries(page);
  expect(labels.slice(labels.indexOf("Edit link"), labels.indexOf("Edit link") + 3)).toEqual(["Edit link", "Copy link", "Remove link"]);
  expect(labels).not.toContain("Insert link");

  await contextMenu(page).getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied to clipboard" })).toBeVisible();
  expect(await readClipboard(page, browserName)).toBe("https://example.com");

  await editor(page).locator("a").click({ button: "right" });
  await contextMenu(page).getByRole("menuitem", { name: "Remove link" }).click();
  await expect(editor(page).locator("a")).toHaveCount(0);
  await expect(editor(page)).toContainText("Visit example.com");

  await editor(page).getByText("Visit example.com").click({ button: "right" });
  expect(await entries(page)).toContain("Insert link");
});

test("a right-click on an image selects it", async ({ page }) => {
  await typeParagraph(page, "Above");
  await page.keyboard.press("Enter");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 60;
    canvas.getContext("2d")!.fillRect(0, 0, 120, 60);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .locator('input[type="file"][accept^="image"]')
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await editor(page).getByText("Above").click();
  await editor(page).locator(".image-frame img").click({ button: "right" });
  await expect(contextMenu(page).getByRole("menuitem", { name: "Copy", exact: true })).toBeEnabled();
  await expect(editor(page).locator(".image-frame.ProseMirror-selectednode")).toBeVisible();
  await contextMenu(page).getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(editor(page).locator("img")).toHaveCount(0);
});
