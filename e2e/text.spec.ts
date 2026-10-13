// Acceptance criteria of docs/spec/04-text-and-paragraphs.md.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDocument, editor, mod, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** Checks a length in CSS pixels against a size in points. */
async function expectPoints(locator: Locator, property: string, points: number): Promise<void> {
  await expect.poll(async () => Number.parseFloat(await css(locator, property))).toBeCloseTo((points * 4) / 3, 2);
}

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

/** Opens Format, walks the submenus and clicks the last item. */
async function chooseFormat(page: Page, ...path: string[]): Promise<void> {
  await page.getByRole("button", { name: "Format", exact: true }).click();
  let parent = menu(page, "Format");
  for (const [index, label] of path.entries()) {
    const item = parent
      .getByRole("menuitem", { name: label, exact: true })
      .or(parent.getByRole("menuitemcheckbox", { name: label, exact: true }));
    if (index === path.length - 1) {
      await item.click();
    } else {
      await item.hover();
      parent = menu(page, label);
      await expect(parent).toBeVisible();
    }
  }
}

async function css(locator: Locator, property: string, pseudo?: string): Promise<string> {
  return locator.evaluate(
    (element, [name, pseudoElement]) => getComputedStyle(element, pseudoElement).getPropertyValue(name!),
    [property, pseudo] as const,
  );
}

test("each paragraph style has the size, colour and italics of the spec", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("A ");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("bold");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type(" word");

  const expected = [
    { style: "Title", selector: 'p[data-paragraph-style="title"]', size: 26, color: "rgb(0, 0, 0)", italic: false },
    { style: "Subtitle", selector: 'p[data-paragraph-style="subtitle"]', size: 15, color: "rgb(102, 102, 102)", italic: false },
    { style: "Heading 1", selector: "h1", size: 20, color: "rgb(0, 0, 0)", italic: false },
    { style: "Heading 2", selector: "h2", size: 16, color: "rgb(0, 0, 0)", italic: false },
    { style: "Heading 3", selector: "h3", size: 14, color: "rgb(67, 67, 67)", italic: false },
    { style: "Heading 4", selector: "h4", size: 12, color: "rgb(102, 102, 102)", italic: false },
    { style: "Heading 5", selector: "h5", size: 11, color: "rgb(102, 102, 102)", italic: false },
    { style: "Heading 6", selector: "h6", size: 11, color: "rgb(102, 102, 102)", italic: true },
    { style: "Normal text", selector: "p:not([data-paragraph-style])", size: 11, color: "rgb(0, 0, 0)", italic: false },
  ];
  for (const { style, selector, size, color, italic } of expected) {
    await chooseFormat(page, "Paragraph styles", style);
    // A document ending in a heading gets an empty paragraph after it.
    const block = editor(page).locator(selector).first();
    await expect(block).toHaveText("A bold word");
    await expectPoints(block, "font-size", size);
    await expect(block).toHaveCSS("color", color);
    await expect(block).toHaveCSS("font-style", italic ? "italic" : "normal");
    await expect(page.getByRole("button", { name: "Styles" })).toHaveText(style);
    // Character formatting is kept.
    await expect(block.locator("strong")).toHaveText("bold");
  }

  // ⌘+Option+0…6 apply styles (and pressing one again keeps it).
  for (const level of [1, 2, 3, 4, 5, 6]) {
    await page.keyboard.press(`${mod}+Alt+Digit${level}`);
    await expect(editor(page).locator(`h${level}`)).toHaveText("A bold word");
  }
  await page.keyboard.press(`${mod}+Alt+Digit6`);
  await expect(editor(page).locator("h6")).toHaveText("A bold word");
  await page.keyboard.press(`${mod}+Alt+Digit0`);
  await expect(editor(page).locator("p").first()).toHaveText("A bold word");

  // Styles survive a reload.
  await chooseFormat(page, "Paragraph styles", "Title");
  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).locator('p[data-paragraph-style="title"]')).toHaveText("A bold word");
});

test("space before and after follows the style, can be toggled and set in Custom spacing", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Alt+Digit1`);
  await page.keyboard.type("First heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Body text");
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${mod}+Alt+Digit1`);
  await page.keyboard.type("Second heading");

  const [first, second] = [editor(page).locator("h1").first(), editor(page).locator("h1").last()];
  const body = editor(page).locator("p", { hasText: "Body text" });
  // No space before at the top of the document; 20pt before and 6pt after otherwise.
  await expect(first).toHaveCSS("padding-top", "0px");
  await expectPoints(second, "padding-top", 20);
  await expectPoints(second, "padding-bottom", 6);

  // The menu item reads "Remove" when the paragraph has space, and "Add" once it is removed.
  const spacingButton = page.getByRole("button", { name: "Line & paragraph spacing" });
  await spacingButton.click();
  await page.getByRole("menuitem", { name: "Remove space before paragraph" }).click();
  await expect(second).toHaveCSS("padding-top", "0px");
  await spacingButton.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "1.15" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitem", { name: "Add space before paragraph" }).click();
  await expectPoints(second, "padding-top", 10);

  // Custom spacing applies to every paragraph in the selection.
  await body.click();
  await page.keyboard.press("Shift+ArrowDown");
  await spacingButton.click();
  await page.getByRole("menuitem", { name: "Custom spacing…" }).click();
  const dialog = page.getByRole("dialog", { name: "Custom spacing" });
  await expect(dialog.getByLabel("Line spacing")).toHaveValue("1.15");
  await expect(dialog.getByLabel("Before")).toHaveValue("0");
  await expect(dialog.getByLabel("After")).toHaveValue("0");
  await dialog.getByLabel("Line spacing").fill("2");
  await dialog.getByLabel("Before").fill("5");
  await dialog.getByLabel("After").fill("12");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  for (const block of [body, second]) {
    await expectPoints(block, "padding-top", 5);
    await expectPoints(block, "padding-bottom", 12);
    await expect(block).toHaveAttribute("style", /line-height: 2/);
  }
  await spacingButton.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Double" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await waitUntilSaved(page);
  await page.reload();
  await expectPoints(body, "padding-bottom", 12);
  await expectPoints(editor(page).locator("h1").last(), "padding-top", 5);
});

test("superscript, subscript, strikethrough and capitalisation survive a reload", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("E = mc");
  await page.keyboard.press(`${mod}+.`);
  await page.keyboard.type("2");
  await page.keyboard.press(`${mod}+.`);
  await page.keyboard.type(" H");
  await page.keyboard.press(`${mod}+,`);
  await page.keyboard.type("2");
  await page.keyboard.press(`${mod}+,`);
  await page.keyboard.type("O ");
  await page.keyboard.press(`${mod}+Shift+x`);
  await page.keyboard.type("gone");
  await page.keyboard.press(`${mod}+Shift+x`);
  await page.keyboard.type(" make this title case");

  await expect(editor(page).locator("sup")).toHaveText("2");
  await expect(editor(page).locator("sub")).toHaveText("2");
  await expect(editor(page).locator("s")).toHaveText("gone");

  // Select "make this title case" and change it.
  for (let i = 0; i < "make this title case".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await chooseFormat(page, "Text", "Capitalisation", "Title Case");
  await expect(editor(page).locator("p")).toHaveText("E = mc2 H2O gone Make This Title Case");
  await chooseFormat(page, "Text", "Capitalisation", "UPPERCASE");
  await expect(editor(page).locator("p")).toHaveText("E = mc2 H2O gone MAKE THIS TITLE CASE");
  // One undo step per change.
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page).locator("p")).toHaveText("E = mc2 H2O gone Make This Title Case");
  await page.keyboard.press(`${mod}+a`);
  await chooseFormat(page, "Text", "Capitalisation", "lowercase");
  await expect(editor(page).locator("p")).toHaveText("e = mc2 h2o gone make this title case");

  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).locator("p")).toHaveText("e = mc2 h2o gone make this title case");
  await expect(editor(page).locator("sup")).toHaveText("2");
  await expect(editor(page).locator("sub")).toHaveText("2");
  await expect(editor(page).locator("s")).toHaveText("gone");
});

test("list presets change the glyphs and numbering of the current list", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+8`);
  await page.keyboard.type("One");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Two");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Three");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Four");

  const items = editor(page).locator("li");
  const glyphs = async () => Promise.all([0, 1, 2, 3].map(async (index) => css(items.nth(index), "content", "::before")));
  expect(await glyphs()).toEqual(['"●"', '"○"', '"■"', '"●"']);

  // Geometry: glyph about 28px and text 48px right of the edge, 48px more per level.
  const left = (await editor(page).locator("ul").first().boundingBox())!.x;
  const firstText = (await items.first().locator("p").first().boundingBox())!.x;
  expect(firstText - left).toBeCloseTo(48, 0);
  const secondText = (await items.nth(1).locator("p").first().boundingBox())!.x;
  expect(secondText - firstText).toBeCloseTo(48, 0);
  expect(await css(items.first(), "left", "::before")).toBe("-20px");

  await page.getByRole("button", { name: "Bulleted list menu" }).click();
  await page.getByRole("button", { name: "Star, circle, square" }).click();
  expect(await glyphs()).toEqual(['"★"', '"○"', '"■"', '"★"']);
  await expect(editor(page).locator("ul").first()).toHaveAttribute("data-list-preset", "3");

  await waitUntilSaved(page);
  await page.reload();
  // Polled: the editor can be mounted twice while the page loads.
  await expect.poll(glyphs).toEqual(['"★"', '"○"', '"■"', '"★"']);

  // A numbered preset turns the list into a numbered list.
  await editor(page).locator("li p").first().click();
  await page.getByRole("button", { name: "Numbered list menu" }).click();
  await page.getByRole("button", { name: "1) a) i)" }).click();
  await expect(editor(page).locator("ol").first()).toHaveAttribute("data-list-preset", "2");
  expect(await css(editor(page).locator("ol > li").first(), "content", "::before")).toBe('counter(list-item) ")"');
});

test("checklist items can be checked, struck through and stay checked after reload", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+9`);
  await page.keyboard.type("Buy milk");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Walk dog");

  const checkboxes = editor(page).getByRole("checkbox");
  await expect(checkboxes).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Checklist/ }).first()).toHaveAttribute("aria-pressed", "true");
  await checkboxes.first().click();
  await expect(checkboxes.first()).toBeChecked();
  await expect(editor(page).locator('li[data-checked="true"] > div')).toHaveText("Buy milk");

  // Plain preset: checked items are not struck through; the second preset strikes them through.
  const firstText = editor(page).locator('li[data-checked="true"] > div > p');
  await expect(firstText).toHaveCSS("text-decoration-line", "none");
  await page.getByRole("button", { name: "Checklist menu" }).click();
  await page.getByRole("button", { name: "Checklist with strike-through" }).click();
  await expect(firstText).toHaveCSS("text-decoration-line", "line-through");
  await expect(editor(page).locator('li[data-checked="false"] > div > p')).toHaveCSS("text-decoration-line", "none");

  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).getByRole("checkbox").first()).toBeChecked();
  await expect(editor(page).getByRole("checkbox").last()).not.toBeChecked();
  await expect(editor(page).locator('li[data-checked="true"] > div > p')).toHaveCSS("text-decoration-line", "line-through");
});

test("⌘] and ⌘[ change indentation; Tab in a list changes the level instead", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Indented");
  const paragraph = editor(page).locator("p");
  await page.keyboard.press(`${mod}+]`);
  await expect(paragraph).toHaveCSS("margin-left", "48px");
  await page.keyboard.press(`${mod}+]`);
  await expect(paragraph).toHaveCSS("margin-left", "96px");
  await page.keyboard.press(`${mod}+[`);
  await page.keyboard.press(`${mod}+[`);
  await page.keyboard.press(`${mod}+[`);
  await expect(paragraph).toHaveCSS("margin-left", "0px");

  // The first item of a list cannot be nested, and Tab does not indent its paragraph either.
  await page.keyboard.press(`${mod}+Shift+8`);
  await page.keyboard.press("Tab");
  await expect(editor(page).locator("li p")).toHaveCSS("margin-left", "0px");
  await expect(editor(page).locator("ul ul")).toHaveCount(0);
});

test("a page break is inserted with ⌘+Enter or Insert > Break and starts a new page in print", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Page one");
  await page.keyboard.press(`${mod}+Enter`);
  await page.keyboard.type("Page two");

  const pageBreak = editor(page).getByRole("separator", { name: "Page break" });
  await expect(pageBreak).toHaveCount(1);
  await expect(editor(page).locator("p")).toHaveText(["Page one", "Page two"]);

  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Break" }).hover();
  await menu(page, "Break").getByRole("menuitem", { name: /^Page break/ }).click();
  await expect(pageBreak).toHaveCount(2);

  await waitUntilSaved(page);
  await page.reload();
  await expect(pageBreak).toHaveCount(2);
  await page.emulateMedia({ media: "print" });
  await expect(pageBreak.first()).toHaveCSS("break-after", "page");
});
