// Acceptance criteria of docs/spec/13-page-elements.md: headers, footers, page numbers,
// footnotes and tables of contents.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDocument, editor, lineEnd, lineStart, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** A4 at 96 dpi plus the 10px gap between pages. */
const PAGE_STRIDE = 1123 + 10;

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

/** Opens Insert > Page elements and hovers or clicks through `path`. */
async function pageElements(page: Page, ...path: string[]): Promise<void> {
  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Page elements" }).hover();
  const submenu = menu(page, "Page elements");
  const [first, second] = path;
  if (second === undefined) return submenu.getByRole("menuitem", { name: first, exact: true }).click();
  await submenu.getByRole("menuitem", { name: first, exact: true }).hover();
  await page.getByRole("group", { name: first }).getByRole("menuitem", { name: second, exact: true }).click();
}

/** Appends `count` paragraphs to the document (one undo step). */
async function addParagraphs(page: Page, count: number, prefix = "Line"): Promise<void> {
  await page.evaluate(
    ([total, label]) => {
      type Editor = { commands: { insertContentAt: (pos: number, content: unknown) => boolean }; state: { doc: { content: { size: number } } } };
      const instance = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
      const paragraphs = Array.from({ length: total }, (_, index) => ({ type: "paragraph", content: [{ type: "text", text: `${label} ${index + 1}` }] }));
      instance.commands.insertContentAt(instance.state.doc.content.size, paragraphs);
    },
    [count, prefix] as const,
  );
}

async function pageCount(page: Page): Promise<number> {
  return Number(await page.locator(".page-stack").getAttribute("data-page-count"));
}

/** The page (0-based) an element is on, and its offset from that page's top edge. */
async function placeOf(page: Page, locator: Locator): Promise<{ page: number; offset: number }> {
  const stack = (await page.locator(".page-stack").boundingBox())!;
  const box = (await locator.boundingBox())!;
  const y = box.y - stack.y;
  return { page: Math.floor(y / PAGE_STRIDE), offset: Math.round(y - Math.floor(y / PAGE_STRIDE) * PAGE_STRIDE) };
}

function headerSlots(page: Page) {
  return page.locator(".page-region-slot.is-header");
}

function footerSlots(page: Page) {
  return page.locator(".page-region-slot.is-footer");
}

test("a header shows on every page, Different first page leaves page 1 empty, and it persists", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addParagraphs(page, 110);
  await expect.poll(() => pageCount(page)).toBe(3);

  await pageElements(page, "Header");
  const header = page.getByRole("textbox", { name: "Header" });
  await expect(header).toBeFocused();
  await page.keyboard.type("Annual report");
  await page.keyboard.press("Escape");
  await expect(header).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  await expect(headerSlots(page)).toHaveText(["Annual report", "Annual report", "Annual report"]);
  // The header area starts 1.27 cm (48px) below each page's top edge.
  for (const [index, slot] of (await headerSlots(page).all()).entries()) {
    expect(await placeOf(page, slot)).toEqual({ page: index, offset: 48 });
  }

  // Double-clicking the top margin of page 2 edits the header there.
  await headerSlots(page).nth(1).scrollIntoViewIfNeeded();
  const stack = (await page.locator(".page-stack").boundingBox())!;
  await page.mouse.dblclick(stack.x + 300, stack.y + PAGE_STRIDE + 30);
  await expect(header).toBeFocused();
  await page.getByRole("checkbox", { name: "Different first page" }).check();
  await page.keyboard.press("Escape");
  await expect(headerSlots(page)).toHaveCount(2);
  for (const slot of await headerSlots(page).all()) expect((await placeOf(page, slot)).page).toBeGreaterThan(0);

  await waitUntilSaved(page);
  await page.reload();
  await expect(headerSlots(page)).toHaveText(["Annual report", "Annual report"]);
  expect((await placeOf(page, headerSlots(page).first())).page).toBe(1);
});

test("editing a header keeps the body as it is, shows its band and supports formatting, undo and the shortcuts", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Body text");

  // Ctrl+⌘O, Ctrl+⌘H (Ctrl+Alt elsewhere) opens the header.
  const chordModifiers = process.platform === "darwin" ? "Control+Meta" : "Control+Alt";
  await page.keyboard.press(`${chordModifiers}+o`);
  await page.keyboard.press(`${chordModifiers}+h`);
  const header = page.getByRole("textbox", { name: "Header" });
  await expect(header).toBeFocused();

  // The body keeps its normal appearance.
  await expect(page.locator(".page-stack")).toHaveClass(/is-editing-region/);
  await expect(editor(page)).toHaveCSS("opacity", "1");
  // A 24px white band across the page, lines top and bottom, directly under the header area.
  const bar = page.locator(".region-bar");
  await expect(bar).toHaveCSS("height", "24px");
  await expect(bar).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(bar).toHaveCSS("border-top", "1px solid rgb(196, 199, 197)");
  await expect(bar).toHaveCSS("border-bottom", "1px solid rgb(196, 199, 197)");
  const stackBox = (await page.locator(".page-stack").boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  const headerBox = (await header.boundingBox())!;
  expect(Math.round(barBox.x)).toBe(Math.round(stackBox.x));
  expect(Math.round(barBox.width)).toBe(794);
  expect(Math.round(barBox.y)).toBe(Math.round(headerBox.y + headerBox.height));
  const label = bar.locator(".region-bar-label");
  await expect(label).toHaveText("Header");
  await expect(label).toHaveCSS("font-size", "12px");
  await expect(label).toHaveCSS("font-weight", "500");
  await expect(label).toHaveCSS("color", "rgb(31, 31, 31)");
  // The label starts 8px inside the left margin (1 in).
  expect(Math.round((await label.boundingBox())!.x - stackBox.x)).toBe(96 + 8);
  await expect(bar.getByRole("checkbox", { name: "Different first page" })).toBeVisible();
  await expect(bar.getByText("Different first page")).toHaveCSS("font-size", "12px");
  await expect(bar.getByRole("button", { name: "Header options" })).toHaveText("Options");
  await expect(bar.getByRole("button", { name: "Header options" })).toHaveCSS("color", "rgb(11, 87, 208)");

  // Character formatting from the keyboard; typing is one undo step, undone from the header.
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("Bold title");
  await expect(header.locator("strong")).toHaveText("Bold title");
  await page.keyboard.press(`${mod}+z`);
  await expect(header).toHaveText("");
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(header).toHaveText("Bold title");
  await expect(editor(page)).toHaveText("Body text");

  // Alignment from the toolbar applies to the header.
  await page.getByRole("button", { name: "Align and indent" }).click();
  await page.getByRole("group", { name: "Align and indent" }).getByRole("button", { name: /^Right align/ }).click();
  await expect(header.locator("p")).toHaveCSS("text-align", "right");
  await expect(header).toBeFocused();

  // A click in the body ends editing.
  await editor(page).getByText("Body text").click();
  await expect(header).toHaveCount(0);
  await expect(page.locator(".page-stack")).not.toHaveClass(/is-editing-region/);
  await expect(headerSlots(page)).toHaveText(["Bold title"]);

  // The footer chord, then Options > Remove footer.
  await page.keyboard.press(`${chordModifiers}+o`);
  await page.keyboard.press(`${chordModifiers}+f`);
  const footer = page.getByRole("textbox", { name: "Footer" });
  await expect(footer).toBeFocused();
  await page.keyboard.type("Confidential");
  await expect(page.locator(".region-bar-label")).toHaveText("Footer");
  // The footer's band sits directly above the footer area.
  const footerBand = (await page.locator(".region-bar").boundingBox())!;
  expect(Math.round(footerBand.y + footerBand.height)).toBe(Math.round((await footer.boundingBox())!.y));
  await page.keyboard.press("Escape");
  await expect(footerSlots(page)).toHaveText(["Confidential"]);
  // The footer area ends 1.27 cm (48px) above the bottom edge.
  const slot = (await footerSlots(page).boundingBox())!;
  const stack = (await page.locator(".page-stack").boundingBox())!;
  expect(Math.round(stack.y + 1123 - (slot.y + slot.height))).toBe(48);

  // Double-clicking the bottom margin (here, on the footer's text) edits the footer.
  await footerSlots(page).scrollIntoViewIfNeeded();
  const footerBox = (await footerSlots(page).boundingBox())!;
  await page.mouse.dblclick(footerBox.x + 20, footerBox.y + footerBox.height / 2);
  await expect(footer).toBeFocused();
  await page.getByRole("button", { name: "Footer options" }).click();
  await page.getByRole("menuitem", { name: "Remove footer" }).click();
  await expect(footer).toHaveCount(0);
  await expect(footerSlots(page)).toHaveCount(0);
  await expect(headerSlots(page)).toHaveText(["Bold title"]);
});

test("opening the footer from the top of a long page scrolls the page's bottom into view", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addParagraphs(page, 45);
  await page.keyboard.press(`${mod}+Home`);
  await selectionSynced(page);
  const scroller = page.locator(".editor-scroll");
  await scroller.evaluate((element) => (element.scrollTop = 0));
  const stackTop = (await page.locator(".page-stack").boundingBox())!.y;
  expect(stackTop + 1123).toBeGreaterThan(900);

  await pageElements(page, "Footer");
  const footer = page.getByRole("textbox", { name: "Footer" });
  await expect(footer).toBeFocused();
  await expect(footer).toBeInViewport();
  await expect(page.locator(".region-bar")).toBeInViewport();
  // The bottom edge of page 1 is visible.
  await expect.poll(async () => (await page.locator(".page-stack").boundingBox())!.y + 1123).toBeLessThanOrEqual(900);
  await page.keyboard.type("Page footer");
  await expect(footer).toHaveText("Page footer");

  // Back at the top, the header opens in view the same way.
  await page.keyboard.press("Escape");
  await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await pageElements(page, "Header");
  await expect(page.getByRole("textbox", { name: "Header" })).toBeInViewport();
});

test("a tall header moves the body down", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First line");
  const before = (await placeOf(page, editor(page).locator("p").first())).offset;
  await pageElements(page, "Header");
  for (let line = 0; line < 4; line++) await page.keyboard.type(`Header line ${line}\n`);
  await page.keyboard.press("Escape");
  const after = (await placeOf(page, editor(page).locator("p").first())).offset;
  expect(before).toBe(96);
  // 48px plus five header lines of 11pt text.
  expect(after).toBeGreaterThan(48 + 5 * 16);
});

test("a footer with page numbers shows 1, 2, 3 on consecutive pages", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addParagraphs(page, 110);
  await expect.poll(() => pageCount(page)).toBe(3);

  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Page elements" }).hover();
  await menu(page, "Page elements").getByRole("menuitem", { name: "Page numbers" }).hover();
  const presets = page.getByRole("group", { name: "Page numbers" });
  for (const name of ["Header, right, all pages", "Header, right, skip first page", "Footer, right, all pages", "Footer, right, skip first page"]) {
    await expect(presets.getByRole("menuitem", { name })).toBeVisible();
  }
  await expect(presets.getByRole("menuitem", { name: "More options" })).toBeVisible();
  await presets.getByRole("menuitem", { name: "Footer, right, all pages" }).click();

  await expect(footerSlots(page)).toHaveText(["1", "2", "3"]);
  for (const [index, slot] of (await footerSlots(page).all()).entries()) expect((await placeOf(page, slot)).page).toBe(index);
  await expect(footerSlots(page).first().locator("p")).toHaveCSS("text-align", "right");

  // Page numbers follow the pagination.
  await addParagraphs(page, 60, "More");
  await expect(footerSlots(page)).toHaveText(["1", "2", "3", "4"]);

  // More options: start at 5, not on the first page.
  await pageElements(page, "Page numbers", "More options");
  const dialog = page.getByRole("dialog", { name: "Page numbers" });
  await expect(dialog).toHaveCSS("width", "304px");
  await expect(dialog.getByRole("radio", { name: "Footer" })).toBeChecked();
  // "Start at" with its number field and arrows comes before the disabled "Continue from previous section".
  const numbering = dialog.getByRole("group", { name: "Numbering" });
  await expect(numbering.getByRole("radio")).toHaveCount(2);
  await expect(numbering.getByRole("radio").first()).toHaveAccessibleName("Start at");
  await expect(numbering.getByRole("radio").first()).toBeChecked();
  await expect(numbering.getByRole("radio").nth(1)).toHaveAccessibleName("Continue from previous section");
  await expect(dialog.getByRole("radio", { name: "Continue from previous section" })).toBeDisabled();
  const startAt = dialog.getByRole("spinbutton", { name: "Start at" });
  await expect(startAt).toHaveValue("1");
  expect((await startAt.boundingBox())!.y).toBeLessThan((await numbering.getByText("Continue from previous section").boundingBox())!.y);
  await dialog.getByRole("button", { name: "Increase start page" }).click();
  await expect(startAt).toHaveValue("2");
  await dialog.getByRole("button", { name: "Decrease start page" }).click();
  await dialog.getByRole("button", { name: "Decrease start page" }).click();
  await dialog.getByRole("button", { name: "Decrease start page" }).click();
  await expect(startAt).toHaveValue("0");
  await dialog.getByRole("checkbox", { name: "Show on first page" }).uncheck();
  await startAt.fill("5");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  await expect(footerSlots(page)).toHaveText(["6", "7", "8"]);
  expect((await placeOf(page, footerSlots(page).first())).page).toBe(1);

  // Page count at the cursor.
  await editor(page).locator("p").first().click();
  await pageElements(page, "Page numbers", "Page count");
  await expect(editor(page).locator('.page-field[data-field="count"]')).toHaveText("4");

  await waitUntilSaved(page);
  await page.reload();
  await expect(footerSlots(page)).toHaveText(["6", "7", "8"]);
});

test("footnotes sit at the bottom of their page, numbered in order", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Alpha");
  await page.keyboard.press(`${mod}+Alt+f`);
  const first = page.getByRole("textbox", { name: "Footnote 1" });
  await expect(first).toBeFocused();
  await page.keyboard.type("First note");
  await editor(page).getByText("Alpha").click();
  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
  await page.keyboard.type(" Beta");
  await pageElements(page, "Footnote");
  await expect(page.getByRole("textbox", { name: "Footnote 2" })).toBeFocused();
  await page.keyboard.type("Second note");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  // Escape puts the cursor after the reference, ready to type.
  await page.keyboard.type(" Gamma");
  await expect(editor(page).locator("p").first()).toHaveText("Alpha1 Beta2 Gamma");

  const area = page.locator(".footnote-area");
  await expect(area).toHaveCount(1);
  await expect(area.locator(".footnote-number")).toHaveText(["1", "2"]);
  await expect(area.locator(".footnote-text")).toHaveText(["First note", "Second note"]);
  await expect(editor(page).locator("sup.footnote-ref")).toHaveText(["1", "2"]);
  // At the bottom of page 1: the area ends at the bottom margin, under a 192px separator.
  const areaBox = (await area.boundingBox())!;
  const stack = (await page.locator(".page-stack").boundingBox())!;
  expect(Math.round(stack.y + 1123 - 96 - (areaBox.y + areaBox.height))).toBe(0);
  await expect(area.locator(".footnote-separator")).toHaveCSS("width", "192px");
  await expect(area.locator(".footnote-separator")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  // 10pt.
  expect(Number.parseFloat(await area.locator(".footnote-text").first().evaluate((element) => getComputedStyle(element).fontSize))).toBeCloseTo(13.333, 2);

  // A footnote before them renumbers them 1, 2, 3.
  await editor(page).getByText("Alpha").click();
  await page.keyboard.press(lineStart);
  await selectionSynced(page);
  await page.keyboard.press(`${mod}+Alt+f`);
  await expect(page.getByRole("textbox", { name: "Footnote 1" })).toBeFocused();
  await page.keyboard.type("New first");
  await page.keyboard.press("Escape");
  await expect(area.locator(".footnote-number")).toHaveText(["1", "2", "3"]);
  await expect(area.locator(".footnote-text")).toHaveText(["New first", "First note", "Second note"]);
  await expect(editor(page).locator("sup.footnote-ref")).toHaveText(["1", "2", "3"]);

  // Clicking a footnote edits it; deleting its reference deletes it.
  await area.locator(".footnote-text").nth(2).click();
  await expect(page.getByRole("textbox", { name: "Footnote 3" })).toBeFocused();
  await page.keyboard.type(" edited");
  await expect(page.getByRole("textbox", { name: "Footnote 3" })).toHaveText("Second note edited");
  await editor(page).locator("sup.footnote-ref").nth(1).click();
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator("sup.footnote-ref")).toHaveCount(2);
  await expect(area.locator(".footnote-text")).toHaveText(["New first", "Second note edited"]);

  await waitUntilSaved(page);
  await page.reload();
  await expect(page.locator(".footnote-area .footnote-text")).toHaveText(["New first", "Second note edited"]);
});

test("footnote text takes space from its page, so the body breaks earlier", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addParagraphs(page, 54);
  await expect.poll(() => pageCount(page)).toBe(1);
  // A note on the first line: its text pushes the last lines to page 2.
  await editor(page).getByText("Line 1", { exact: true }).click();
  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
  await page.keyboard.press(`${mod}+Alt+f`);
  await page.keyboard.type("A footnote long enough to need two lines at the bottom of the first page of this document.");
  await page.keyboard.press("Escape");
  await expect.poll(() => pageCount(page)).toBe(2);
  const area = (await page.locator(".footnote-area").boundingBox())!;
  const lastOnPageOne = editor(page).getByText("Line 49", { exact: true });
  expect((await placeOf(page, lastOnPageOne)).page).toBe(0);
  expect((await lastOnPageOne.boundingBox())!.y + 17).toBeLessThanOrEqual(area.y);
  expect((await placeOf(page, editor(page).getByText("Line 54", { exact: true }))).page).toBe(1);
});

test("each table of contents preset lists the headings; Update refreshes it", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press("Enter");
  for (const [name, level, lines] of [
    ["Introduction", 1, 50],
    ["Background", 2, 10],
    ["Results", 1, 0],
  ] as const) {
    await page.keyboard.press(`${mod}+Alt+${level}`);
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    if (lines) {
      await addParagraphs(page, lines, name);
      await page.keyboard.press(`${mod}+End`);
      await page.keyboard.press("Enter");
    }
  }
  await page.keyboard.press(`${mod}+ArrowUp`);

  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Page elements" }).hover();
  await menu(page, "Page elements").getByRole("menuitem", { name: "Table of contents" }).hover();
  const presets = page.getByRole("group", { name: "Table of contents" });
  await expect(presets.getByRole("menuitem")).toHaveCount(3);
  await presets.getByRole("menuitem", { name: "Plain text" }).click();

  const toc = editor(page).locator(".toc");
  await expect(toc).toHaveAttribute("data-style", "plain");
  await expect(toc.locator(".toc-text")).toHaveText(["Introduction", "Background", "Results"]);
  await expect(toc.locator(".toc-page").first()).toHaveAttribute("data-number", "1");
  await expect(toc.locator(".toc-page").nth(2)).toHaveAttribute("data-number", "2");
  // One more step of indent (0.5 in) for Heading 2.
  await expect(toc.locator(".toc-entry").nth(1)).toHaveCSS("padding-left", "48px");
  // Entries of the highest level used are bold, deeper ones regular; the block has no border.
  await expect(toc.locator(".toc-text").nth(0)).toHaveCSS("font-weight", "700");
  await expect(toc.locator(".toc-text").nth(1)).toHaveCSS("font-weight", "400");
  await expect(toc.locator(".toc-text").nth(2)).toHaveCSS("font-weight", "700");
  await expect(toc).toHaveCSS("border-top-style", "none");
  // Only while it is selected (as after inserting it) a faint outline shows.
  await expect(toc).toHaveClass(/ProseMirror-selectednode/);
  // The longhands: browsers write the outline shorthand in different orders.
  await expect(toc).toHaveCSS("outline-color", "rgb(211, 227, 253)");
  await expect(toc).toHaveCSS("outline-style", "solid");
  await expect(toc).toHaveCSS("outline-width", "1px");
  // The page number is right-aligned at the right margin.
  const page1 = (await toc.locator(".toc-page").first().boundingBox())!;
  const stack = (await page.locator(".page-stack").boundingBox())!;
  expect(Math.round(stack.x + 794 - 96 - (page1.x + page1.width))).toBe(0);

  // The pill: Update and ⋮ Delete.
  await toc.click();
  const pill = page.getByRole("toolbar", { name: "Table of contents actions" });
  await expect(pill).toBeVisible();
  await editor(page).getByRole("heading", { name: "Background" }).click();
  await expect(pill).toBeHidden();
  await expect(toc).toHaveCSS("outline-style", "none");
  await expect(toc).toHaveCSS("border-top-style", "none");
  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
  await page.keyboard.type(" and context");
  // It does not update by itself.
  await expect(toc.locator(".toc-text").nth(1)).toHaveText("Background");
  await toc.click();
  await pill.getByRole("button", { name: "Update table of contents" }).click();
  await expect(toc.locator(".toc-text")).toHaveText(["Introduction", "Background and context", "Results"]);
  await pill.getByRole("button", { name: "More table of contents options" }).click();
  await page.getByRole("menuitem", { name: "Delete table of contents" }).click();
  await expect(toc).toHaveCount(0);

  // Dotted: the same with a dotted leader.
  await editor(page).locator("p").first().click();
  await pageElements(page, "Table of contents", "Dotted");
  await expect(toc).toHaveAttribute("data-style", "dotted");
  await expect(toc.locator(".toc-leader").first()).toHaveCSS("border-bottom-style", "dotted");
  await expect(toc.locator(".toc-page").nth(2)).toHaveAttribute("data-number", "2");
  await toc.click();
  await page.keyboard.press("Delete");
  await expect(toc).toHaveCount(0);

  // With blue links: no page numbers, and an entry jumps to its heading.
  await editor(page).locator("p").first().click();
  await pageElements(page, "Table of contents", "With blue links");
  await expect(toc).toHaveAttribute("data-style", "links");
  await expect(toc.locator(".toc-text").first()).toHaveCSS("color", "rgb(17, 85, 204)");
  await expect(toc.locator(".toc-text").first()).toHaveCSS("text-decoration-line", "underline");
  await expect(toc.locator(".toc-page").first()).toBeHidden();
  await toc.getByText("Results").click();
  await expect(editor(page).getByRole("heading", { name: "Results" })).toBeInViewport();
  const cursorInResults = await page.evaluate(() => {
    const instance = (document.querySelector(".ProseMirror") as unknown as { editor: { state: { selection: { $from: { parent: { textContent: string } } } } } }).editor;
    return instance.state.selection.$from.parent.textContent;
  });
  expect(cursorInResults).toBe("Results");

  // Find does not match page numbers.
  await page.keyboard.press(`${mod}+f`);
  const find = page.getByRole("search", { name: "Find in document" });
  await find.getByRole("textbox", { name: "Find in document" }).fill("Results");
  await expect(find.getByText(/^\d of 2$/)).toBeVisible();
});

test("find does not match page number fields", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Pages:");
  await pageElements(page, "Page numbers", "Page count");
  await pageElements(page, "Page numbers", "Footer, right, all pages");
  await expect(footerSlots(page)).toHaveText(["1"]);
  await page.keyboard.press(`${mod}+f`);
  const find = page.getByRole("search", { name: "Find in document" });
  await find.getByRole("textbox", { name: "Find in document" }).fill("1");
  await expect(find.getByText("0 of 0")).toBeVisible();
});

test("printing prints the pages as laid out, with headers, footers and footnotes", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addParagraphs(page, 70);
  await pageElements(page, "Page numbers", "Footer, right, all pages");
  await expect(footerSlots(page)).toHaveText(["1", "2"]);

  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  // No gap between the pages: page 2's footer ends 48px above 2 × 1123.
  const stack = (await page.locator(".page-stack").boundingBox())!;
  const footer = (await footerSlots(page).nth(1).boundingBox())!;
  expect(Math.round(footer.y + footer.height - stack.y)).toBe(2 * 1123 - 48);
  const rule = await page.evaluate(() => document.querySelector("style[data-page-setup]")?.textContent);
  expect(rule).toBe("@page { size: 794px 1123px; margin: 0; }");

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await expect
    .poll(async () => {
      const box = (await footerSlots(page).nth(1).boundingBox())!;
      const top = (await page.locator(".page-stack").boundingBox())!.y;
      return Math.round(box.y + box.height - top);
    })
    .toBe(2 * 1123 + 10 - 48);
});
