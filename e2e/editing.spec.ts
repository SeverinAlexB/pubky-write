import { expect, test } from "@playwright/test";
import { createDocument, editor, lineEnd, lineStart, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test("font, font size, line spacing and indent are kept", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();

  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Georgia" }).click();
  await page.getByRole("combobox", { name: "Font size" }).fill("18");
  await page.getByRole("combobox", { name: "Font size" }).press("Enter");
  await editor(page).click();
  await page.keyboard.type("Large serif text");
  await page.keyboard.press(`${mod}+Shift+.`); // next size up from 18 is 24
  await page.keyboard.type("!");
  await page.getByRole("button", { name: "Line & paragraph spacing" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Double" }).click();
  // ⌘+] indents by half an inch.
  await page.keyboard.press(`${mod}+]`);
  await page.keyboard.press(`${mod}+]`);
  await waitUntilSaved(page);

  await page.reload();
  const paragraph = editor(page).locator("p").first();
  await expect(paragraph).toHaveCSS("line-height", /px$/);
  await expect(paragraph).toHaveAttribute("style", /line-height: 2/);
  // Two half-inch steps.
  await expect(paragraph).toHaveCSS("margin-left", "96px");
  await expect(paragraph.locator("span").first()).toHaveAttribute("style", /font-family: Georgia; font-size: 18pt/);
  await expect(paragraph.locator("span").last()).toHaveAttribute("style", /font-size: 24pt/);

  await paragraph.click();
  await expect(page.getByRole("button", { name: "Font", exact: true })).toHaveText("Georgia");
});

test("Tab nests list items instead of indenting the paragraph", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+8`);
  await page.keyboard.type("Parent");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Child");
  await expect(editor(page).locator("ul ul li")).toHaveText("Child");
});

test("the find bar counts matches, moves between them with wrapping and keeps the current match selected", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("An item, another item, a third item and a last item.");
  await page.keyboard.press(`${mod}+ArrowUp`); // the cursor at the start
  await selectionSynced(page);

  await page.keyboard.press(`${mod}+f`);
  const find = page.getByRole("search", { name: "Find in document" });
  await expect(find).toBeVisible();
  const field = find.getByRole("textbox", { name: "Find in document" });
  await expect(field).toBeFocused();
  for (const name of ["Previous", "Next", "More options", "Close"]) {
    await expect(find.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // A 408 × 72 card at the top right of the editor area.
  const card = (await find.boundingBox())!;
  const area = (await page.locator(".editor-area").boundingBox())!;
  expect(card.width).toBe(408);
  expect(card.height).toBe(72);
  expect(Math.round(area.x + area.width - (card.x + card.width))).toBe(28);
  expect(Math.round(card.y - area.y)).toBe(0);

  await field.fill("item");
  await expect(find.getByText("1 of 4")).toBeVisible();
  const matches = editor(page).locator(".search-match");
  await expect(matches).toHaveCount(4);
  await expect(matches.nth(1)).toHaveCSS("background-color", "rgb(204, 237, 210)");
  await expect(editor(page).locator(".search-match-current")).toHaveCSS("background-color", "rgb(135, 211, 146)");

  await field.press("Enter");
  await expect(find.getByText("2 of 4")).toBeVisible();
  await expect(matches.nth(1)).toHaveClass(/search-match-current/);
  await field.press("Shift+Enter");
  await field.press("Shift+Enter");
  await expect(find.getByText("4 of 4")).toBeVisible(); // wrapped to the last
  await field.press("Enter");
  await expect(find.getByText("1 of 4")).toBeVisible(); // and back to the first
  await find.getByRole("button", { name: "Next", exact: true }).click();
  await find.getByRole("button", { name: "Next", exact: true }).click();
  await expect(find.getByText("3 of 4")).toBeVisible();

  await field.press("Escape");
  await expect(find).toBeHidden();
  await expect(matches).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  // The third match is selected: typing replaces it.
  await page.keyboard.type("ITEM");
  await expect(editor(page)).toHaveText("An item, another item, a third ITEM and a last item.");
});

test("the find bar starts at the cursor, takes the selection as its query and closes with the Close button", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("one two one two one");
  await page.keyboard.press(lineStart);
  for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowRight");
  await selectionSynced(page);

  await page.keyboard.press(`${mod}+f`);
  const find = page.getByRole("search", { name: "Find in document" });
  await find.getByRole("textbox", { name: "Find in document" }).fill("one");
  await expect(find.getByText("2 of 3")).toBeVisible(); // the first match at or after the cursor
  await find.getByRole("button", { name: "Close" }).click();
  await expect(find).toBeHidden();
  await expect(editor(page).locator(".search-match")).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  await page.keyboard.press(lineStart);
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await selectionSynced(page);
  await page.keyboard.press(`${mod}+f`);
  await expect(find.getByRole("textbox", { name: "Find in document" })).toHaveValue("one");
  await expect(find.getByText("1 of 3")).toBeVisible();

  // More options opens the dialog with the same query.
  await find.getByRole("button", { name: "More options" }).click();
  const dialog = page.getByRole("dialog", { name: "Find and replace" });
  await expect(dialog).toBeVisible();
  await expect(find).toBeHidden();
  await expect(dialog.getByRole("textbox", { name: "Find", exact: true })).toHaveValue("one");
  await expect(dialog.getByText("1 of 3")).toBeVisible();
});

test("the find bar scrolls the current match into view on a later page", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First page");
  for (let line = 0; line < 120; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("needle in a haystack");
  await expect(page.locator(".page-stack")).toHaveAttribute("data-page-count", "3");
  await page.locator(".editor-scroll").evaluate((element) => element.scrollTo(0, 0));
  await editor(page).getByText("First page").click();
  await selectionSynced(page);

  await page.keyboard.press(`${mod}+f`);
  await page.getByRole("textbox", { name: "Find in document" }).fill("needle");
  await expect(page.getByRole("search").getByText("1 of 1")).toBeVisible();
  await expect(editor(page).locator(".search-match-current")).toBeInViewport();
});

test("the Find and replace dialog has its controls in order and ignores diacritics by default", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Un café, a cafe and a CAFÉ.");

  await page.keyboard.press(`${mod}+Shift+h`);
  const dialog = page.getByRole("dialog", { name: "Find and replace" });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBe(396);
  await expect(dialog).toHaveCSS("border-radius", "28px");
  const controls = await dialog.locator("input, button").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? (element.closest("label") ?? element).textContent!.trim()),
  );
  expect(controls).toEqual([
    "Close",
    "Find",
    "Replace with",
    "Match case",
    "Use regular expressions (e.g. \\n for newline, \\t for tab)",
    "Help",
    "Ignore diacritics (e.g. ä = a, E = É)",
    "Replace",
    "Replace all",
    "Previous",
    "Next",
  ]);
  await expect(dialog.getByRole("checkbox", { name: /Ignore diacritics/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Match case" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Use regular expressions/ })).not.toBeChecked();

  // No scrim: the document behind the dialog is not dimmed.
  expect(await dialog.evaluate((element) => getComputedStyle(element, "::backdrop").backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const findField = dialog.getByRole("textbox", { name: "Find", exact: true });
  await expect(findField).toBeFocused();
  await findField.fill("cafe");
  await expect(dialog.getByText("1 of 3")).toBeVisible();
  // The matches stay highlighted in the document behind the dialog.
  await expect(editor(page).locator(".search-match")).toHaveCount(3);
  await expect(editor(page).locator(".search-match-current")).toHaveText("café");

  await dialog.getByRole("checkbox", { name: "Match case" }).check();
  await expect(dialog.getByText("1 of 2")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Ignore diacritics/ }).uncheck();
  await expect(dialog.getByText("1 of 1")).toBeVisible();
  await expect(editor(page).locator(".search-match-current")).toHaveText("cafe");
  await dialog.getByRole("checkbox", { name: "Match case" }).uncheck();
  await dialog.getByRole("checkbox", { name: /Ignore diacritics/ }).check();

  await dialog.getByRole("button", { name: "Help" }).click();
  await expect(dialog.getByRole("note")).toContainText("regular expression");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(editor(page).locator(".search-match")).toHaveCount(0);

  // Edit > Find and replace opens the same dialog.
  await menuBarItem(page, "Edit").click();
  await page.getByRole("menuitem", { name: "Find and replace" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("⌘+Shift+H only opens Find and replace, with the selected text in the Find field selected", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Mark this word");
  await page.keyboard.press(lineEnd);
  for (let step = 0; step < 4; step++) await page.keyboard.press("Shift+ArrowLeft");
  await selectionSynced(page);
  const before = await editor(page).innerHTML();

  await page.keyboard.press(`${mod}+Shift+h`);
  const dialog = page.getByRole("dialog", { name: "Find and replace" });
  await expect(dialog).toBeVisible();
  const findField = dialog.getByRole("textbox", { name: "Find", exact: true });
  await expect(findField).toBeFocused();
  await expect(findField).toHaveValue("word");
  expect(await findField.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 4]);
  // The shortcut neither highlights the selection nor changes the document in any other way.
  await expect(editor(page).locator("mark")).toHaveCount(0);

  // Focus stays in the dialog: Tab from the last control wraps to the first, Shift+Tab back.
  const inDialog = () => dialog.evaluate((element) => element.contains(document.activeElement));
  for (let step = 0; step < 15; step++) {
    await page.keyboard.press("Tab");
    expect(await inDialog()).toBe(true);
  }
  await findField.focus();
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inDialog()).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await editor(page).innerHTML()).toBe(before);
  await expect(editor(page).locator("mark")).toHaveCount(0);
});

test("default editor shortcuts do not collide with the documented ones", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();

  // ⌘+Option+1 twice keeps Heading 1 (the heading extension's own shortcut would toggle it off).
  await page.keyboard.type("Heading");
  await page.keyboard.press(`${mod}+Alt+1`);
  await page.keyboard.press(`${mod}+Alt+1`);
  await expect(editor(page).locator("h1")).toHaveText("Heading");
  await page.keyboard.press(`${mod}+Alt+0`);
  await expect(editor(page).locator("h1")).toHaveCount(0);

  // ⌘+Enter is a page break, never a line break, even in a code block.
  await page.keyboard.press(lineEnd);
  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor(page).locator(".page-break")).toHaveCount(1);
  await expect(editor(page).locator("br:not(.ProseMirror-trailingBreak)")).toHaveCount(0);
  await page.keyboard.type("``` ");
  await page.keyboard.type("code");
  await expect(editor(page).locator("pre")).toHaveCount(1);
  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor(page).locator("pre")).toHaveText("code");
  await expect(editor(page).locator("br:not(.ProseMirror-trailingBreak)")).toHaveCount(0);
});

test("Find and replace replaces one match at a time, all of them in one undo step, and with regular expressions", async ({
  page,
}) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("red fish, blue fish, Red fish, red fish");
  await page.keyboard.press(`${mod}+ArrowUp`);
  await selectionSynced(page);

  await page.keyboard.press(`${mod}+Shift+h`);
  const dialog = page.getByRole("dialog", { name: "Find and replace" });
  await dialog.getByRole("textbox", { name: "Find", exact: true }).fill("red");
  await dialog.getByRole("textbox", { name: "Replace with" }).fill("green");
  await expect(dialog.getByText("1 of 3")).toBeVisible();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByText("2 of 3")).toBeVisible();
  await dialog.getByRole("button", { name: "Previous" }).click();
  await expect(dialog.getByText("1 of 3")).toBeVisible();

  await dialog.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(editor(page)).toHaveText("green fish, blue fish, Red fish, red fish");
  await expect(dialog.getByText("1 of 2")).toBeVisible();
  await expect(editor(page).locator(".search-match-current")).toHaveText("Red");

  await dialog.getByRole("button", { name: "Replace all" }).click();
  await expect(editor(page)).toHaveText("green fish, blue fish, green fish, green fish");
  await expect(dialog.getByText("0 of 0")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press(`${mod}+z`); // Replace all is one step
  await expect(editor(page)).toHaveText("green fish, blue fish, Red fish, red fish");
  await waitUntilSaved(page);

  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Mail ann@x, bob@y and cy@x.");
  await page.keyboard.press(`${mod}+Shift+h`);
  await dialog.getByRole("checkbox", { name: /Use regular expressions/ }).check();
  const findField = dialog.getByRole("textbox", { name: "Find", exact: true });
  await findField.fill("(\\w+");
  await expect(dialog.getByText("0 of 0")).toBeVisible(); // not a valid expression
  await findField.fill("(\\w+)@x");
  await expect(dialog.getByText("1 of 2")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Replace with" }).fill("$1");
  await dialog.getByRole("button", { name: "Replace all" }).click();
  await expect(editor(page)).toHaveText("Mail ann, bob@y and cy.");
  await waitUntilSaved(page);
});

test("word count shows pages, words and characters, for the selection too", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("One two three four");

  await page.keyboard.press(`${mod}+Shift+c`);
  const dialog = page.getByRole("dialog", { name: "Word count" });
  expect((await dialog.boundingBox())!.width).toBe(349);
  await expect(dialog.getByRole("heading", { name: "Word count" })).toHaveCSS("font-size", "24px");
  const rowHeights = await dialog.getByRole("row").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  // 52px rows; the dividers between rows add their pixel.
  for (const height of rowHeights) expect(height).toBeGreaterThanOrEqual(52);
  for (const height of rowHeights) expect(height).toBeLessThanOrEqual(53);
  const firstLabel = dialog.getByRole("rowheader").first();
  await expect(firstLabel).toHaveCSS("font-size", "14px");
  await expect(firstLabel).toHaveCSS("padding-left", "16px");
  await expect(dialog.getByRole("cell").first()).toHaveCSS("padding-right", "16px");
  await expect(dialog.getByRole("checkbox", { name: "Display word count while typing" })).toHaveCSS("width", "18px");
  await expect(dialog.locator(".word-count-live")).toHaveCSS("font-size", "16px");
  await expect(dialog.getByRole("row")).toHaveText([
    /^Pages\s*1 of 1$/,
    /^Words\s*4$/,
    /^Characters\s*18$/,
    /^Characters excluding spaces\s*15$/,
  ]);
  await expect(dialog.getByRole("checkbox", { name: "Display word count while typing" })).not.toBeChecked();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(editor(page)).toBeFocused();

  for (let step = 0; step < 4; step++) await page.keyboard.press("Shift+ArrowLeft");
  await selectionSynced(page);
  await menuBarItem(page, "Tools").click();
  await page.getByRole("menuitem", { name: "Word count" }).click();
  await expect(dialog.getByRole("row", { name: /^Words/ })).toContainText("1 of 4");
  await expect(dialog.getByRole("row", { name: /^Characters excluding/ })).toContainText("4 of 15");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(editor(page)).toBeFocused();

  // Pages shows the page of the cursor.
  await page.keyboard.press(lineEnd);
  await page.keyboard.press(`${mod}+Enter`);
  await page.keyboard.press(`${mod}+Enter`);
  await page.keyboard.type("Last page");
  await expect(page.locator(".page-stack")).toHaveAttribute("data-page-count", "3");
  await page.keyboard.press(`${mod}+Shift+c`);
  await expect(dialog.getByRole("row", { name: /^Pages/ })).toContainText("3 of 3");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editor(page)).toBeFocused();
  await editor(page).getByText("One two").click();
  await selectionSynced(page);
  await page.keyboard.press(`${mod}+Shift+c`);
  await expect(dialog.getByRole("row", { name: /^Pages/ })).toContainText("1 of 3");
});

test("the live word count appears after enabling it, updates while typing and is remembered", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("One two three four");
  const chip = page.locator(".live-word-count").getByRole("button");
  await expect(chip).toBeHidden();

  await page.keyboard.press(`${mod}+Shift+c`);
  const dialog = page.getByRole("dialog", { name: "Word count" });
  await dialog.getByRole("checkbox", { name: "Display word count while typing" }).check();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(chip).toBeHidden(); // Cancel discards the change

  await page.keyboard.press(`${mod}+Shift+c`);
  await dialog.getByRole("checkbox", { name: "Display word count while typing" }).check();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(chip).toHaveText("4 words");
  // At the bottom left of the editor area.
  const area = (await page.locator(".editor-area").boundingBox())!;
  const box = (await chip.boundingBox())!;
  expect(box.x - area.x).toBeLessThan(40);
  expect(area.y + area.height - (box.y + box.height)).toBeLessThan(40);

  await page.keyboard.type(" five");
  await expect(chip).toHaveText("5 words");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await selectionSynced(page);
  await expect(chip).toHaveText("1 of 5 words");

  await chip.click();
  await page.getByRole("menuitemcheckbox", { name: "Characters", exact: true }).click();
  await expect(chip).toHaveText("4 of 23 characters");
  await chip.click();
  await page.getByRole("menuitemcheckbox", { name: "Characters excluding spaces" }).click();
  await expect(chip).toHaveText("4 of 19 characters excluding spaces");
  await waitUntilSaved(page);

  await page.reload();
  await expect(chip).toHaveText("19 characters excluding spaces");
  await chip.click();
  await page.getByRole("menuitem", { name: "Hide word count" }).click();
  await expect(chip).toBeHidden();
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(chip).toBeHidden();
});
