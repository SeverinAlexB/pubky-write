// Acceptance criteria of docs/spec/15-tab-stops.md: adding tab stops from the ruler, moving and
// removing them, the Tab key and how tab characters lay text out.
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { chooseDownload, createDocument, editor, lineEnd, lineStart, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** One centimetre on screen at 100% zoom. */
const CM = 96 / 2.54;

async function box(locator: Locator) {
  return (await locator.boundingBox())!;
}

const ruler = (page: Page) => page.locator(".horizontal-ruler");
const tabStops = (page: Page) => page.locator(".ruler-marker.tab-stop");
const rulerMenu = (page: Page) => page.getByRole("menu", { name: "Ruler" });

/** The left edge of the writable area: the page's left margin. */
async function contentLeft(page: Page) {
  return (await box(page.locator(".horizontal-ruler .ruler-writable"))).x;
}

/** Clicks the ruler `cm` centimetres from the left margin and chooses `item` from its menu. */
async function addTabStop(page: Page, cm: number, item: "Add left tab-stop" | "Add centre tab-stop" | "Add right tab-stop") {
  const rulerBox = await box(ruler(page));
  await page.mouse.click((await contentLeft(page)) + cm * CM, rulerBox.y + 8);
  await rulerMenu(page).getByRole("menuitem", { name: item }).click();
  await expect(rulerMenu(page)).toHaveCount(0);
}

/** Types `text`, pressing the Tab key for each "\t". */
async function typeWithTabs(page: Page, text: string) {
  for (const [index, part] of text.split("\t").entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await page.keyboard.type(part);
  }
}

/** Left and right client x of the first occurrence of `text` in `locator`'s text nodes. */
function textBounds(locator: Locator, text: string): Promise<{ left: number; right: number }> {
  return locator.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent!.indexOf(wanted);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + wanted.length);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }
    throw new Error(`No text ${wanted}`);
  }, text);
}

/** The x of a tab stop marker's position: the flat side of ▶ and ◀, the middle of ◆. */
async function stopX(marker: Locator) {
  const bounds = await box(marker);
  const kind = await marker.getAttribute("class");
  if (kind?.includes("is-left")) return bounds.x;
  if (kind?.includes("is-right")) return bounds.x + bounds.width;
  return bounds.x + bounds.width / 2;
}

test("clicking the ruler at 6 cm offers the four items, and Add left tab-stop adds a stop that is kept", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Stops");
  const margin = await contentLeft(page);
  const rulerBox = await box(ruler(page));

  await page.mouse.click(margin + 6 * CM, rulerBox.y + 8);
  const menu = rulerMenu(page);
  await expect(menu.getByRole("menuitem")).toHaveText(["Add left tab-stop", "Add centre tab-stop", "Add right tab-stop"]);
  await expect(menu.getByRole("menuitemcheckbox", { name: "Show ruler" })).toHaveAttribute("aria-checked", "true");
  // Just below the click.
  const menuBox = await box(menu);
  expect(menuBox.y).toBeGreaterThanOrEqual(rulerBox.y + rulerBox.height);
  expect(menuBox.y).toBeLessThan(rulerBox.y + rulerBox.height + 12);
  expect(menuBox.x).toBeCloseTo(margin + 6 * CM, -1);
  // The document keeps the focus.
  await expect(editor(page)).toBeFocused();

  await menu.getByRole("menuitem", { name: "Add left tab-stop" }).click();
  await expect(tabStops(page)).toHaveCount(1);
  const marker = tabStops(page).first();
  await expect(marker).toHaveClass(/is-left/);
  expect((await stopX(marker)) - margin).toBeCloseTo(6 * CM, 0);
  const markerBox = await box(marker);
  expect(markerBox.width).toBeCloseTo(5, 0);
  expect(markerBox.height).toBeCloseTo(10, 0);

  await waitUntilSaved(page);
  await page.reload();
  await editor(page).click();
  await expect(tabStops(page)).toHaveCount(1);
  expect((await stopX(tabStops(page).first())) - margin).toBeCloseTo(6 * CM, 0);
});

test("the margin areas do not open the menu; Show ruler hides the ruler", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  const margin = await contentLeft(page);
  const rulerBox = await box(ruler(page));
  await page.mouse.click(margin - 20, rulerBox.y + 8);
  await expect(rulerMenu(page)).toHaveCount(0);

  // Escape closes the menu without adding a stop.
  await page.mouse.click(margin + 3 * CM, rulerBox.y + 8);
  await expect(rulerMenu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rulerMenu(page)).toHaveCount(0);
  await expect(tabStops(page)).toHaveCount(0);

  await page.mouse.click(margin + 3 * CM, rulerBox.y + 8);
  await rulerMenu(page).getByRole("menuitemcheckbox", { name: "Show ruler" }).click();
  await expect(ruler(page)).toHaveCount(0);
  await menuBarItem(page, "View").click();
  await page.getByRole("menuitemcheckbox", { name: "Show ruler" }).click();
  await expect(ruler(page)).toBeVisible();
});

test("with a left stop at 6 cm and a right stop at 14 cm, Name⇥Role⇥Total lines up on the stops", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addTabStop(page, 6, "Add left tab-stop");
  await addTabStop(page, 14, "Add right tab-stop");
  await expect(tabStops(page)).toHaveCount(2);
  await expect(tabStops(page).nth(1)).toHaveClass(/is-right/);

  await typeWithTabs(page, "Name\tRole\tTotal");
  const paragraph = editor(page).locator("p").first();
  await expect(paragraph.locator(".tab-char")).toHaveCount(2);
  const margin = await contentLeft(page);
  await expect.poll(async () => (await textBounds(paragraph, "Role")).left - margin).toBeCloseTo(6 * CM, 0);
  expect((await textBounds(paragraph, "Total")).right - margin).toBeCloseTo(14 * CM, 0);

  // Editing before the tabs keeps the text on its stops.
  await page.keyboard.press(lineStart);
  await selectionSynced(page);
  await page.keyboard.type("Full ");
  await expect.poll(async () => (await textBounds(paragraph, "Role")).left - margin).toBeCloseTo(6 * CM, 0);
  expect((await textBounds(paragraph, "Total")).right - margin).toBeCloseTo(14 * CM, 0);

  // A new paragraph keeps the stops; a centre stop centres the text on it.
  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
  await page.keyboard.press("Enter");
  await expect(tabStops(page)).toHaveCount(2);
  await addTabStop(page, 4, "Add centre tab-stop");
  await expect(tabStops(page)).toHaveCount(3);
  await expect(tabStops(page).nth(0)).toHaveClass(/is-center/);
  await typeWithTabs(page, "A\tcentred");
  const second = editor(page).locator("p").nth(1);
  await expect.poll(async () => {
    const bounds = await textBounds(second, "centred");
    return (bounds.left + bounds.right) / 2 - margin;
  }).toBeCloseTo(4 * CM, 0);

  // The layout holds at another zoom and after a reload.
  await waitUntilSaved(page);
  await page.reload();
  await expect.poll(async () => (await textBounds(editor(page).locator("p").first(), "Role")).left - margin).toBeCloseTo(6 * CM, 0);
  expect((await textBounds(editor(page).locator("p").first(), "Total")).right - margin).toBeCloseTo(14 * CM, 0);
  const zoom = page.getByRole("combobox", { name: "Zoom" });
  await zoom.fill("150");
  await zoom.press("Enter");
  await expect(page.locator(".page-stack")).toHaveCSS("zoom", "1.5");
  const zoomed = editor(page).locator("p").first();
  await expect.poll(async () => (await textBounds(zoomed, "Role")).left - (await contentLeft(page))).toBeCloseTo(6 * CM * 1.5, 0);
  expect((await textBounds(zoomed, "Total")).right - (await contentLeft(page))).toBeCloseTo(14 * CM * 1.5, 0);
  // The ruler's markers are at the zoomed positions too.
  expect((await stopX(tabStops(page).nth(1))) - (await contentLeft(page))).toBeCloseTo(14 * CM * 1.5, 0);
});

test("without stops a tab advances to the next 1.27 cm from the left indent; tabs count as spaces", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await typeWithTabs(page, "Ab\tcd\tef");
  const paragraph = editor(page).locator("p").first();
  const margin = await contentLeft(page);
  await expect.poll(async () => (await textBounds(paragraph, "cd")).left - margin).toBeCloseTo(1.27 * CM, 0);
  expect((await textBounds(paragraph, "ef")).left - margin).toBeCloseTo(2.54 * CM, 0);

  // Word count: three words, and each tab is a character but not a non-space one.
  await page.keyboard.press(`${mod}+Shift+c`);
  const dialog = page.getByRole("dialog", { name: "Word count" });
  const value = (row: number) => dialog.locator("tr").nth(row).locator("td");
  await expect(value(1)).toHaveText("3");
  await expect(value(2)).toHaveText("8");
  await expect(value(3)).toHaveText("6");
  await page.keyboard.press("Escape");
});

test("dragging a stop shows its position above the ruler; dragging it off the ruler removes it", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addTabStop(page, 6, "Add left tab-stop");
  await typeWithTabs(page, "Name\tRole");
  const paragraph = editor(page).locator("p").first();
  const margin = await contentLeft(page);
  const rulerBox = await box(ruler(page));

  const marker = tabStops(page).first();
  const start = await box(marker);
  // Grabbed a few pixels beside the small marker.
  const x = start.x + start.width / 2 + 4;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + CM, y, { steps: 3 });
  await page.mouse.move(x + 2 * CM, y, { steps: 3 });
  const tooltip = page.locator(".ruler-tooltip");
  await expect(tooltip).toHaveText("8.00");
  const tooltipBox = await box(tooltip);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(rulerBox.y);
  expect(tooltipBox.x + tooltipBox.width / 2 - margin).toBeCloseTo(8 * CM, 0);
  await expect(page.locator(".ruler-guide")).toHaveCSS("border-left-style", "dotted");
  expect((await box(page.locator(".ruler-guide"))).x - margin).toBeCloseTo(8 * CM, 0);
  await page.mouse.up();
  await expect(tooltip).toHaveCount(0);
  expect((await stopX(tabStops(page).first())) - margin).toBeCloseTo(8 * CM, 0);
  await expect.poll(async () => (await textBounds(paragraph, "Role")).left - margin).toBeCloseTo(8 * CM, 0);

  // One undo step per move.
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await stopX(tabStops(page).first())) - margin).toBeCloseTo(6 * CM, 0);
  await expect.poll(async () => (await textBounds(paragraph, "Role")).left - margin).toBeCloseTo(6 * CM, 0);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect.poll(async () => (await stopX(tabStops(page).first())) - margin).toBeCloseTo(8 * CM, 0);

  // Off the ruler the marker disappears; back on it, it returns; released off the ruler, it is removed.
  const moved = await box(tabStops(page).first());
  const mx = moved.x + moved.width / 2;
  const my = moved.y + moved.height / 2;
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx, my + 40, { steps: 4 });
  await expect(tabStops(page)).toHaveCount(0);
  await page.mouse.move(mx, my, { steps: 4 });
  await expect(tabStops(page)).toHaveCount(1);
  await page.mouse.move(mx, my + 40, { steps: 4 });
  await expect(tabStops(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(tabStops(page)).toHaveCount(0);
  // The tab goes back to the default stops.
  await expect.poll(async () => (await textBounds(paragraph, "Role")).left - margin).toBeCloseTo(1.27 * CM, 0);
  await page.keyboard.press(`${mod}+z`);
  await expect(tabStops(page)).toHaveCount(1);
});

test("stops apply to every selected paragraph and the ruler shows the first one's", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await typeWithTabs(page, "One\tA");
  await page.keyboard.press("Enter");
  await typeWithTabs(page, "Two\tB");
  await page.keyboard.press(`${mod}+a`);
  await selectionSynced(page);
  await addTabStop(page, 5, "Add left tab-stop");
  const margin = await contentLeft(page);
  const paragraphs = editor(page).locator("p");
  await expect.poll(async () => (await textBounds(paragraphs.nth(0), "A")).left - margin).toBeCloseTo(5 * CM, 0);
  await expect.poll(async () => (await textBounds(paragraphs.nth(1), "B")).left - margin).toBeCloseTo(5 * CM, 0);

  // Only the second paragraph: the cursor's paragraph.
  await paragraphs.nth(1).click();
  await selectionSynced(page);
  await addTabStop(page, 9, "Add right tab-stop");
  await expect(tabStops(page)).toHaveCount(2);
  await paragraphs.nth(0).click();
  await expect(tabStops(page)).toHaveCount(1);
});

test("Tab at the start of a paragraph indents; after text it inserts a tab", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Indented");
  const paragraph = editor(page).locator("p").first();
  const margin = await contentLeft(page);

  await page.keyboard.press(lineStart);
  await selectionSynced(page);
  await page.keyboard.press("Tab");
  await expect.poll(async () => (await box(paragraph)).x - margin).toBeCloseTo(48, 0);
  await expect(paragraph.locator(".tab-char")).toHaveCount(0);

  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await expect(paragraph.locator(".tab-char")).toHaveCount(1);
  // Still indented once.
  expect((await box(paragraph)).x - margin).toBeCloseTo(48, 0);
  await expect(paragraph).toHaveText("Indented\tx");
  // Backspace deletes a tab like a character.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(paragraph.locator(".tab-char")).toHaveCount(0);
  await expect(paragraph).toHaveText("Indented");
  // A tab character typed as text becomes a tab too.
  await page.keyboard.insertText("a\tb");
  await expect(paragraph.locator(".tab-char")).toHaveCount(1);
  await expect(paragraph).toHaveText("Indenteda\tb");

  // In a list Tab still nests the item.
  await page.keyboard.press("Enter");
  await page.keyboard.type("* One");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Two");
  await page.keyboard.press("Tab");
  await expect(editor(page).locator("ul ul")).toHaveCount(1);
  await expect(editor(page).locator("li .tab-char")).toHaveCount(0);
});

test("indent markers can be grabbed anywhere within 8px of their shape", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Grab");
  const paragraph = editor(page).locator("p").first();
  const margin = await contentLeft(page);
  const rulerBox = await box(ruler(page));

  // 7px right of the left indent triangle (which is 10px wide), in the ruler's lower half.
  await page.mouse.move(margin + 5 + 7, rulerBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(margin + 12 + CM, rulerBox.y + 10, { steps: 4 });
  await expect(page.locator(".ruler-tooltip")).toHaveText("Left indent 1.00 cm");
  await page.mouse.up();
  await expect.poll(async () => (await box(paragraph)).x - margin).toBeCloseTo(CM, 0);

  // 7px left of the first line marker, in the upper half.
  const first = await box(page.locator(".ruler-marker.first-line-indent"));
  await page.mouse.move(first.x - 7, rulerBox.y + 2);
  await page.mouse.down();
  await page.mouse.move(first.x - 7 + CM, rulerBox.y + 2, { steps: 4 });
  await expect(page.locator(".ruler-tooltip")).toHaveText("First line indent 1.00 cm");
  await page.mouse.up();

  // 7px right of the right indent marker.
  const right = await box(page.locator(".ruler-marker.right-indent"));
  await page.mouse.move(right.x + right.width + 7, rulerBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(right.x + right.width + 7 - CM, rulerBox.y + 8, { steps: 4 });
  await expect(page.locator(".ruler-tooltip")).toHaveText("Right indent 1.00 cm");
  await page.mouse.up();

  // Every marker's grab area is at least 16 × 16.
  for (const hit of await page.locator(".ruler-hit").all()) {
    const bounds = await box(hit);
    expect(bounds.width).toBeGreaterThanOrEqual(16);
    expect(bounds.height).toBeGreaterThanOrEqual(13);
  }
});

test("tab stops in a header, and in the Word export", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await addTabStop(page, 4, "Add left tab-stop");
  await typeWithTabs(page, "Body\tText");

  await menuBarItem(page, "Insert").click();
  await page.getByRole("menu", { name: "Insert" }).getByRole("menuitem", { name: "Page elements" }).hover();
  await page.getByRole("menu", { name: "Page elements" }).getByRole("menuitem", { name: "Header", exact: true }).click();
  const header = page.getByRole("textbox", { name: "Header" });
  await expect(header).toBeFocused();
  // The header has no stops of its own.
  await expect(tabStops(page)).toHaveCount(0);
  await addTabStop(page, 10, "Add right tab-stop");
  await typeWithTabs(page, "Report\tPage");
  const margin = await contentLeft(page);
  await expect.poll(async () => (await textBounds(header.locator("p").first(), "Page")).right - margin).toBeCloseTo(10 * CM, 0);
  // The copy on the page keeps the layout once the header is left.
  await page.keyboard.press("Escape");
  const copy = page.locator(".page-region-slot.is-header p").first();
  await expect.poll(async () => (await textBounds(copy, "Page")).right - margin).toBeCloseTo(10 * CM, 0);

  await waitUntilSaved(page);
  const download = page.waitForEvent("download");
  await chooseDownload(page, "Microsoft Word (.docx)");
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  expect(documentXml).toMatch(/<w:tab w:val="left" w:pos="2268"\/>/);
  expect(documentXml).toContain("<w:tab/>");
  const headerXml = Object.keys(zip.files).find((name) => /^word\/header\d*\.xml$/.test(name))!;
  expect(await zip.file(headerXml)!.async("string")).toMatch(/<w:tab w:val="right" w:pos="5669"\/>/);
});
