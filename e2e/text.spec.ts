// Acceptance criteria of docs/spec/04-text-and-paragraphs.md.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDocument, editor, menuBarItem, mod, waitUntilSaved, selectionSynced } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Checks a length in CSS pixels against a size in points. Firefox computes font sizes in steps of
 * 1/64 px (26pt is 34.6875px there), so it is checked to 0.05px instead of 0.005px.
 */
async function expectPoints(locator: Locator, property: string, points: number): Promise<void> {
  const precision = test.info().project.name === "firefox" ? 1 : 2;
  await expect.poll(async () => Number.parseFloat(await css(locator, property))).toBeCloseTo((points * 4) / 3, precision);
}

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

/** Opens Format, walks the submenus and clicks the last item. */
async function chooseFormat(page: Page, ...path: string[]): Promise<void> {
  await menuBarItem(page, "Format").click();
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

/** Opens Format and hovers through the submenus, leaving the last one open. */
async function chooseFormatHover(page: Page, ...path: string[]): Promise<void> {
  await menuBarItem(page, "Format").click();
  let parent = menu(page, "Format");
  for (const label of path) {
    await parent.getByRole("menuitem", { name: label, exact: true }).hover();
    parent = page.getByRole("menu", { name: label, exact: true }).or(page.getByRole("group", { name: label, exact: true }));
    await expect(parent).toBeVisible();
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
  await selectionSynced(page);
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
  await selectionSynced(page);
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
  await expect(editor(page).locator("ul").first()).toHaveAttribute("data-list-preset", "star");

  await waitUntilSaved(page);
  await page.reload();
  // Polled: the editor can be mounted twice while the page loads.
  await expect.poll(glyphs).toEqual(['"★"', '"○"', '"■"', '"★"']);

  // A numbered preset turns the list into a numbered list.
  await editor(page).locator("li p").first().click();
  await page.getByRole("button", { name: "Numbered list menu" }).click();
  await page.getByRole("button", { name: "1) a) i)" }).click();
  await expect(editor(page).locator("ol").first()).toHaveAttribute("data-list-preset", "decimal-parenthesis");
  expect(await css(editor(page).locator("ol > li").first(), "content", "::before")).toBe('counter(list-item) ")"');
});

test("list menus show six presets in 3 × 2 grids and the bulleted list menu ends with the checklist presets", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("One");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Two");
  await page.keyboard.press(`${mod}+a`);

  await page.getByRole("button", { name: "Bulleted list menu" }).click();
  const bullets = page.getByRole("group", { name: "bullet presets" });
  const bulletTiles = bullets.getByRole("button");
  await expect(bulletTiles).toHaveCount(6);
  await expect(bulletTiles.first()).toHaveCSS("border", "1px solid rgb(196, 199, 197)");
  await expect(bulletTiles.first()).toHaveCSS("border-radius", "2px");
  const boxes = await bulletTiles.evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().toJSON()));
  // Three columns, two rows; tiles of about 60 × 75px.
  expect(new Set(boxes.map((box) => box.x)).size).toBe(3);
  expect(new Set(boxes.map((box) => box.y)).size).toBe(2);
  expect(boxes[0].width).toBeCloseTo(60, 0);
  expect(boxes[0].height).toBeCloseTo(75, 0);
  // Each tile previews five lines: levels 1, 2, 2, 3 and 1.
  await expect(bulletTiles.nth(2).locator(".list-preset-glyph")).toHaveText(["❏", "❏", "❏", "❏", "❏"]);
  await expect(bulletTiles.nth(3).locator(".list-preset-glyph")).toHaveText(["➔", "◆", "◆", "●", "➔"]);
  await expect(bulletTiles.nth(5).locator(".list-preset-glyph")).toHaveText(["➢", "○", "○", "■", "➢"]);

  // Not in a list yet: no tile is current.
  await expect(bullets.locator(".is-current")).toHaveCount(0);
  await bulletTiles.nth(2).click();
  const firstItem = editor(page).locator("li").first();
  await expect.poll(() => css(firstItem, "content", "::before")).toBe('"❏"');
  await page.getByRole("button", { name: "Bulleted list menu" }).click();
  await expect(bulletTiles.nth(2)).toHaveClass(/is-current/);
  await expect(bulletTiles.nth(2)).toHaveCSS("border-top-color", "rgb(11, 87, 208)");

  // The menu ends with a separator and "Checklist menu ▸" opening the two checklist presets.
  await page.keyboard.press("Escape");
  await editor(page).getByText("One").click();
  await page.getByRole("button", { name: "Bulleted list menu" }).click();
  const popover = page.locator(".list-popover");
  await expect(popover.locator(".menu-separator")).toHaveCount(1);
  await popover.getByRole("menuitem", { name: "Checklist menu" }).hover();
  const checklists = page.getByRole("group", { name: "Checklist menu" });
  await expect(checklists.getByRole("button")).toHaveText([/☐/, /☑/]);
  await checklists.getByRole("button", { name: "Checklist with strike-through" }).click();
  await expect(editor(page).getByRole("checkbox")).toHaveCount(2);
  await expect(editor(page).locator('ul[data-type="taskList"]')).toHaveAttribute("data-list-preset", "strike-through");

  // Numbered presets: 1. a. i.; 1) a) i); 1. 1.1. 1.1.1.; A. a. i.; I. A. 1.; 01. a. i.
  await page.getByRole("button", { name: "Numbered list menu" }).click();
  const numberTiles = page.getByRole("group", { name: "numbered presets" }).getByRole("button");
  await expect(numberTiles).toHaveCount(6);
  const markers = (index: number) => numberTiles.nth(index).locator(".list-preset-glyph");
  await expect(markers(0)).toHaveText(["1.", "a.", "b.", "i.", "2."]);
  await expect(markers(1)).toHaveText(["1)", "a)", "b)", "i)", "2)"]);
  await expect(markers(2)).toHaveText(["1.", "1.1.", "1.2.", "1.2.1.", "2."]);
  await expect(markers(3)).toHaveText(["A.", "a.", "b.", "i.", "B."]);
  await expect(markers(4)).toHaveText(["I.", "A.", "B.", "1.", "II."]);
  await expect(markers(5)).toHaveText(["01.", "a.", "b.", "i.", "02."]);

  const numbers = async () =>
    Promise.all([0, 1].map(async (index) => editor(page).locator("ol > li").nth(index).evaluate((item) => {
      const list = item.parentElement!;
      return getComputedStyle(item, "::before").content + "|" + list.getAttribute("data-list-preset");
    })));
  await numberTiles.nth(4).click();
  await expect.poll(numbers).toEqual(['counter(list-item, upper-roman) "."|upper-roman', 'counter(list-item, upper-roman) "."|upper-roman']);
  await page.getByRole("button", { name: "Numbered list menu" }).click();
  await numberTiles.nth(5).click();
  await expect.poll(() => css(editor(page).locator("ol > li").first(), "content", "::before")).toBe(
    'counter(list-item, decimal-leading-zero) "."',
  );

  // Format > Bullets and numbering shows the same grids.
  await chooseFormatHover(page, "Bullets and numbering", "Bulleted list menu");
  await expect(page.getByRole("group", { name: "bullet presets" }).getByRole("button")).toHaveCount(6);
  await expect(page.getByRole("group", { name: "Bulleted list menu" }).getByRole("menuitem", { name: "Checklist menu" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a numbered list inside a bulleted list uses its own preset", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+8`);
  await page.keyboard.type("Bullet");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Nested");
  await page.getByRole("button", { name: "Numbered list menu" }).click();
  await page.getByRole("button", { name: "I. A. 1." }).click();

  const nested = editor(page).locator("ul > li ol > li").first();
  // The second level of I. A. 1. is A.
  await expect.poll(() => css(nested, "content", "::before")).toBe('counter(list-item, upper-alpha) "."');
  expect(await css(editor(page).locator("ul > li").first(), "content", "::before")).toBe('"●"');
});

test("lists saved with presets in the old order keep their glyphs and numbering", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+7`);
  await page.keyboard.type("Old numbering");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${mod}+Shift+8`);
  await page.keyboard.type("Old bullets");

  // Before presets had ids, the attribute held the index in the old menu order:
  // numbered 1 was A. a. i. and bulleted 2 was → ◆ ●.
  await page.evaluate(() => {
    type View = { state: { doc: { forEach: (visit: (node: { type: { name: string } }, offset: number) => void) => void }; tr: { setNodeAttribute: (pos: number, name: string, value: unknown) => unknown } }; dispatch: (tr: unknown) => void };
    const view = (document.querySelector(".ProseMirror") as unknown as { editor: { view: View } }).editor.view;
    const tr = view.state.tr;
    view.state.doc.forEach((node, offset) => {
      if (node.type.name === "orderedList") tr.setNodeAttribute(offset, "listPreset", 1);
      if (node.type.name === "bulletList") tr.setNodeAttribute(offset, "listPreset", 2);
    });
    view.dispatch(tr);
  });
  await expect(editor(page).locator("ol")).toHaveAttribute("data-list-preset", "upper-alpha");
  await expect(editor(page).locator("ul")).toHaveAttribute("data-list-preset", "arrow");
  await expect.poll(() => css(editor(page).locator("ol > li").first(), "content", "::before")).toBe(
    'counter(list-item, upper-alpha) "."',
  );
  await expect.poll(() => css(editor(page).locator("ul > li").first(), "content", "::before")).toBe('"➔"');

  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).locator("ol")).toHaveAttribute("data-list-preset", "upper-alpha");
  await page.getByText("Old numbering").click();
  await page.getByRole("button", { name: "Numbered list menu" }).click();
  await expect(page.getByRole("group", { name: "numbered presets" }).getByRole("button", { name: "A. a. i." })).toHaveClass(/is-current/);
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

  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Break" }).hover();
  await menu(page, "Break").getByRole("menuitem", { name: /^Page break/ }).click();
  await expect(pageBreak).toHaveCount(2);

  await waitUntilSaved(page);
  await page.reload();
  await expect(pageBreak).toHaveCount(2);
  // Printing prints the pages as laid out on screen: the text after a break is on the next page.
  await page.emulateMedia({ media: "print" });
  const pageTwoTop = await page.evaluate(() => {
    const stack = document.querySelector(".page-stack")!;
    const paragraph = [...stack.querySelectorAll("p")].find((element) => element.textContent === "Page two")!;
    return paragraph.getBoundingClientRect().top - stack.getBoundingClientRect().top;
  });
  expect(pageTwoTop).toBeGreaterThan(1123);
  // Without print layout the browser breaks the printed pages itself.
  await page.emulateMedia({ media: "screen" });
  await menuBarItem(page, "View").click();
  await menu(page, "View").getByRole("menuitemcheckbox", { name: "Show print layout" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(pageBreak.first()).toHaveCSS("break-after", "page");
});
