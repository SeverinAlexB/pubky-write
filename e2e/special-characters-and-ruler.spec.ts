// Acceptance criteria of docs/spec/14-special-characters-and-ruler.md: the special characters
// dialog, dragging the ruler's markers and margins, and the Page setup dialog.
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { chooseDownload, createDocument, editor, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** One centimetre on screen at 100% zoom. */
const CM = 96 / 2.54;

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

async function openSymbols(page: Page, item: "Special characters" | "Emoji") {
  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Symbols" }).hover();
  await menu(page, "Symbols").getByRole("menuitem", { name: item }).click();
  return page.getByRole("dialog", { name: "Insert special characters" });
}

async function openPageSetup(page: Page) {
  await menuBarItem(page, "File").click();
  await page.getByRole("menuitem", { name: "Page setup" }).click();
  return page.getByRole("dialog", { name: "Page setup" });
}

async function box(locator: Locator) {
  return (await locator.boundingBox())!;
}

function firstSheet(page: Page) {
  return page.locator(".page-sheets > .page").first();
}

/** Left edges of the lines of the first text node in `locator`. */
function lineStarts(locator: Locator): Promise<number[]> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lefts: { top: number; left: number }[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && !lefts.some((line) => Math.abs(line.top - rect.top) < 2)) lefts.push({ top: rect.top, left: rect.left });
    }
    return lefts.sort((a, b) => a.top - b.top).map((line) => line.left);
  });
}

/** Drags the centre of `marker` sideways by `dx` pixels; `during` runs before the button is released. */
async function dragBy(page: Page, marker: Locator, dx: number, during?: () => Promise<void>) {
  const start = await box(marker);
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 3 });
  await during?.();
  await page.mouse.up();
}

const ruler = (page: Page) => page.locator(".horizontal-ruler");
const leftMarker = (page: Page) => page.locator(".ruler-marker.left-indent");
const firstLineMarker = (page: Page) => page.locator(".ruler-marker.first-line-indent");
const rightMarker = (page: Page) => page.locator(".ruler-marker.right-indent");

/** The left edge of the writable area: the page's left margin. */
async function contentLeft(page: Page) {
  return (await box(page.locator(".horizontal-ruler .ruler-writable"))).x;
}

const sentence = "The committee reviews the quarterly figures and drafts a careful reply to every question raised. ";

test.describe("special characters", () => {
  test("searching arrow shows arrows; clicking one inserts it and the dialog stays open", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const loadedData = () => requests.some((url) => url.includes("characterData"));
    await createDocument(page);
    await editor(page).click();
    await page.keyboard.type("Go ");
    // The names are loaded when the dialog first opens, not with the editor.
    expect(loadedData()).toBe(false);

    const dialog = await openSymbols(page, "Special characters");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "false");
    await expect.poll(loadedData).toBe(true);
    // 604 × 425, centred near the bottom of the editor area.
    const area = await box(page.locator(".editor-area"));
    const placed = await box(dialog);
    expect(placed.width).toBe(604);
    expect(placed.height).toBe(425);
    expect(placed.x + placed.width / 2).toBeCloseTo(area.x + area.width / 2, -1);
    expect(area.y + area.height - (placed.y + placed.height)).toBeCloseTo(24, 0);

    await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue("Symbol");
    await expect(dialog.getByLabel("Subcategory").locator("option")).toContainText(["Arrows", "Currency", "Letterlike", "Math", "Shapes", "Stars", "Technical"]);
    const cells = dialog.locator(".special-character");
    expect(await box(cells.first())).toMatchObject({ width: 24, height: 24 });

    // Hovering shows a larger preview with the code point and name.
    await dialog.getByRole("button", { name: "Rightwards arrow U+2192", exact: true }).hover();
    await expect(dialog.locator(".special-characters-preview")).toContainText("→");
    await expect(dialog.locator(".special-characters-preview")).toContainText("U+2192 Rightwards arrow");

    const search = dialog.getByPlaceholder("Search by keyword (e.g. arrow) or code point");
    await expect(search).toBeFocused();
    await search.fill("arrow");
    await expect(dialog.getByRole("group", { name: "Search results" })).toBeVisible();
    const labels = await cells.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
    expect(labels.length).toBeGreaterThan(50);
    expect(labels.every((label) => /arrow/i.test(label))).toBe(true);

    await dialog.getByRole("button", { name: "Rightwards arrow U+2192", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(editor(page)).toHaveText("Go →");
    await dialog.getByRole("button", { name: "Leftwards arrow U+2190", exact: true }).click();
    await expect(editor(page)).toHaveText("Go →←");

    // Code points, with or without U+, search all categories.
    await search.fill("U+00E9");
    await expect(cells.first()).toHaveAccessibleName("Latin small letter e with acute U+00E9");
    await search.fill("20ac");
    await expect(cells.first()).toHaveText("€");
    await cells.first().click();
    await expect(editor(page)).toHaveText("Go →←€");

    // The dialog does not block the document.
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await expect(editor(page)).toHaveText("Go →←€!");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await waitUntilSaved(page);
    await page.reload();
    await expect(editor(page)).toHaveText("Go →←€!");
  });

  test("categories and subcategories pick the characters; Emoji opens on the emoji; Escape closes", async ({ page }) => {
    await createDocument(page);
    await editor(page).click();
    const dialog = await openSymbols(page, "Special characters");
    await dialog.getByLabel("Category", { exact: true }).selectOption("Number");
    await dialog.getByLabel("Subcategory").selectOption({ label: "Fractions" });
    await expect(dialog.getByRole("group", { name: "Fractions" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Vulgar fraction one half U+00BD" })).toBeVisible();

    // Arrow keys move between characters; Enter inserts.
    await dialog.getByRole("button", { name: "Vulgar fraction one half U+00BD" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("button", { name: "Vulgar fraction one quarter U+00BC" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(editor(page)).toHaveText("¼");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const emoji = await openSymbols(page, "Emoji");
    await expect(emoji.getByLabel("Category", { exact: true })).toHaveValue("Emoji");
    await expect(emoji.getByRole("button", { name: "Grinning face U+1F600" })).toBeVisible();
  });
});

test.describe("ruler", () => {
  test("dragging the left indent marker to 2 cm indents the paragraph and persists; the first line marker makes a hanging indent", async ({ page }) => {
    await createDocument(page);
    await editor(page).click();
    await page.keyboard.type(sentence.repeat(3));
    const paragraph = editor(page).locator("p").first();
    const margin = await contentLeft(page);

    // While dragging: a dotted guide line down the page and the value.
    await dragBy(page, leftMarker(page), 2 * CM + 4, async () => {
      const guide = page.locator(".ruler-guide");
      await expect(guide).toBeVisible();
      await expect(guide).toHaveCSS("border-left-style", "dotted");
      expect((await box(guide)).x).toBeCloseTo(margin + 2 * CM, 0);
      expect((await box(guide)).height).toBeGreaterThan(500);
      await expect(page.locator(".ruler-tooltip")).toHaveText("Left indent 2.00 cm");
    });
    await expect(page.locator(".ruler-guide")).toHaveCount(0);
    await expect(page.locator(".ruler-tooltip")).toHaveCount(0);
    // The value snapped to 2 cm, and the first line moved with the left indent.
    await expect.poll(async () => (await lineStarts(paragraph))[0]! - margin).toBeCloseTo(2 * CM, 0);
    expect((await lineStarts(paragraph))[1]! - margin).toBeCloseTo(2 * CM, 0);
    expect((await box(firstLineMarker(page))).x + 5 - margin).toBeCloseTo(2 * CM, 0);

    // The first line marker alone, back to the margin: a hanging indent.
    await dragBy(page, firstLineMarker(page), -2 * CM, async () => {
      await expect(page.locator(".ruler-tooltip")).toHaveText("First line indent -2.00 cm");
    });
    await expect.poll(async () => (await lineStarts(paragraph))[0]! - margin).toBeCloseTo(0, 0);
    const [first, second, third] = await lineStarts(paragraph);
    expect(first! - margin).toBeCloseTo(0, 0);
    expect(second! - margin).toBeCloseTo(2 * CM, 0);
    expect(third! - margin).toBeCloseTo(2 * CM, 0);
    // The left marker stays at 2 cm.
    expect((await box(leftMarker(page))).x + 5 - margin).toBeCloseTo(2 * CM, 0);

    // One undo step per drag.
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await lineStarts(paragraph))[0]! - margin).toBeCloseTo(2 * CM, 0);
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(async () => (await lineStarts(paragraph))[0]! - margin).toBeCloseTo(0, 0);

    await waitUntilSaved(page);
    await page.reload();
    await editor(page).click();
    await expect.poll(async () => (await lineStarts(editor(page).locator("p").first()))[1]! - margin).toBeCloseTo(2 * CM, 0);
    expect((await lineStarts(editor(page).locator("p").first()))[0]! - margin).toBeCloseTo(0, 0);
    expect((await box(leftMarker(page))).x + 5 - margin).toBeCloseTo(2 * CM, 0);
    expect((await box(firstLineMarker(page))).x + 5 - margin).toBeCloseTo(0, 0);
  });

  test("the right indent, Alt without snapping, every selected paragraph and ⌘+] after a drag", async ({ page }) => {
    await createDocument(page);
    await editor(page).click();
    await page.keyboard.type("First paragraph");
    await page.keyboard.press("Enter");
    await page.keyboard.type(sentence.repeat(2));
    await page.keyboard.press("Enter");
    await page.keyboard.type("Last paragraph");
    const paragraphs = editor(page).locator("p");
    const margin = await contentLeft(page);

    // Alt turns snapping off: 47px is 1.24 cm, not 1.25 cm. (A whole number of pixels: Firefox and
    // WebKit move the mouse to whole pixels.)
    await page.keyboard.down("Alt");
    await dragBy(page, leftMarker(page), 47, async () => {
      await expect(page.locator(".ruler-tooltip")).toHaveText("Left indent 1.24 cm");
    });
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await box(paragraphs.nth(2))).x - margin).toBeCloseTo(47, 0);
    // Only the paragraph with the cursor.
    expect((await box(paragraphs.nth(0))).x - margin).toBeCloseTo(0, 0);

    // ⌘+] moves on to the next half inch.
    await page.keyboard.press(`${mod}+]`);
    await expect.poll(async () => (await box(paragraphs.nth(2))).x - margin).toBeCloseTo(48, 0);

    // With all paragraphs selected the ruler shows the first one's indents, and a drag sets the indent of each.
    await page.keyboard.press(`${mod}+a`);
    await selectionSynced(page);
    await dragBy(page, leftMarker(page), CM);
    for (const index of [0, 1, 2]) await expect.poll(async () => (await box(paragraphs.nth(index))).x - margin).toBeCloseTo(CM, 0);

    // The right indent: 3 cm in from the right margin.
    const sheet = await box(firstSheet(page));
    const rightEdge = sheet.x + sheet.width - CM * 2.54;
    await dragBy(page, rightMarker(page), -3 * CM, async () => {
      await expect(page.locator(".ruler-tooltip")).toHaveText("Right indent 3.00 cm");
    });
    for (const index of [0, 1, 2]) {
      await expect.poll(async () => {
        const bounds = await box(paragraphs.nth(index));
        return rightEdge - (bounds.x + bounds.width);
      }).toBeCloseTo(3 * CM, 0);
    }
    expect((await box(rightMarker(page))).x + 5).toBeCloseTo(rightEdge - 3 * CM, 0);
  });

  test("dragging the margin areas changes the page margins", async ({ page }) => {
    await createDocument(page);
    await editor(page).click();
    await page.keyboard.type("Margins");
    const sheet = await box(firstSheet(page));
    const writable = await box(page.locator(".horizontal-ruler .ruler-writable"));
    const rulerBox = await box(ruler(page));

    // Away from the indent markers, which can be grabbed up to 8px around their shape.
    await page.mouse.move(writable.x - 20, rulerBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(writable.x - 20 + CM, rulerBox.y + 8, { steps: 4 });
    // 2.54 cm + 1 cm, snapped to a quarter centimetre.
    await expect(page.locator(".ruler-tooltip")).toHaveText("Left margin 3.50 cm");
    await page.mouse.up();
    await expect.poll(async () => (await box(editor(page).locator("p").first())).x - sheet.x).toBeCloseTo(3.5 * CM, 0);

    await page.mouse.move(writable.x + writable.width + 20, rulerBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(writable.x + writable.width + 20 + 1.04 * CM, rulerBox.y + 8, { steps: 4 });
    await expect(page.locator(".ruler-tooltip")).toHaveText("Right margin 1.50 cm");
    await page.mouse.up();

    const dialog = await openPageSetup(page);
    await expect(dialog.getByLabel("Left")).toHaveValue("3.5");
    await expect(dialog.getByLabel("Right")).toHaveValue("1.5");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await waitUntilSaved(page);
    await page.reload();
    await expect.poll(async () => (await box(editor(page).locator("p").first())).x - sheet.x).toBeCloseTo(3.5 * CM, 0);
  });

  test("dragging the left indent while a header is edited indents the header", async ({ page }) => {
    await createDocument(page);
    await editor(page).click();
    await page.keyboard.type("Body");
    await menuBarItem(page, "Insert").click();
    await menu(page, "Insert").getByRole("menuitem", { name: "Page elements" }).hover();
    await menu(page, "Page elements").getByRole("menuitem", { name: "Header", exact: true }).click();
    const header = page.getByRole("textbox", { name: "Header" });
    await expect(header).toBeFocused();
    await page.keyboard.type("Report");
    const margin = await contentLeft(page);

    await dragBy(page, leftMarker(page), CM);
    await expect.poll(async () => (await box(header.locator("p").first())).x - margin).toBeCloseTo(CM, 0);
    await expect(header).toBeFocused();
    // The body is unchanged.
    await page.keyboard.press("Escape");
    expect((await box(editor(page).locator("p").first())).x - margin).toBeCloseTo(0, 0);
    expect((await box(page.locator(".page-region-slot.is-header p").first())).x - margin).toBeCloseTo(CM, 0);
  });
});

test.describe("page setup", () => {
  test("has Pages and Pageless tabs and the page colour swatch; the colour applies to the pages and the export", async ({ page }) => {
    await createDocument(page);
    await editor(page).click();
    await page.keyboard.type("Coloured");
    const dialog = await openPageSetup(page);
    await expect(dialog.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tab", { name: "Pageless" })).toHaveAttribute("aria-selected", "false");
    await expect(dialog.getByLabel("Apply to")).toHaveValue("document");
    await expect(dialog.getByLabel("Apply to").locator("option")).toHaveText(["Whole document"]);
    await expect(dialog.getByLabel("Paper size").locator("option:checked")).toHaveText("A4 (21.0 cm x 29.7 cm)");
    await expect(dialog.getByText("Margins (centimetres)")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Set as default" })).toBeVisible();
    expect((await box(dialog)).width).toBe(396);

    await dialog.getByRole("button", { name: "Page colour #ffffff" }).click();
    const palette = dialog.getByRole("dialog", { name: "Page colour" });
    await expect(palette).toBeVisible();
    // Escape closes the palette, not the dialog.
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Page colour #ffffff" }).click();
    await palette.getByRole("button", { name: "#fce5cd" }).click();
    await expect(palette).toBeHidden();
    await expect(dialog.getByRole("button", { name: "Page colour #fce5cd" })).toBeVisible();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toBeHidden();
    await expect(firstSheet(page)).toHaveCSS("background-color", "rgb(252, 229, 205)");

    await waitUntilSaved(page);
    await page.reload();
    await expect(firstSheet(page)).toHaveCSS("background-color", "rgb(252, 229, 205)");

    const download = page.waitForEvent("download");
    await chooseDownload(page, "Microsoft Word (.docx)");
    const zip = await JSZip.loadAsync(await readFile(await (await download).path()));
    expect(await zip.file("word/document.xml")!.async("string")).toContain('<w:background w:color="FCE5CD"/>');
  });

  test("the Pageless tab switches to pageless format and the Pages tab back", async ({ page }) => {
    await createDocument(page);
    const dialog = await openPageSetup(page);
    await dialog.getByRole("tab", { name: "Pageless" }).click();
    await expect(dialog.getByRole("tabpanel")).toContainText("one continuous sheet");
    await expect(dialog.getByLabel("Paper size")).toHaveCount(0);
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(page.locator(".page-stack")).toHaveClass(/is-pageless/);

    const reopened = await openPageSetup(page);
    await expect(reopened.getByRole("tab", { name: "Pageless" })).toHaveAttribute("aria-selected", "true");
    // The tabs follow the tabs pattern: arrow keys move between them.
    await reopened.getByRole("tab", { name: "Pageless" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(reopened.getByRole("tab", { name: "Pages" })).toBeFocused();
    await expect(reopened.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
    await reopened.getByRole("button", { name: "OK" }).click();
    await expect(page.locator(".page-stack")).not.toHaveClass(/is-pageless/);
  });

  test("Set as default is used for new documents", async ({ page }) => {
    await createDocument(page);
    const dialog = await openPageSetup(page);
    await dialog.getByLabel("Top").fill("2");
    await dialog.getByLabel("Landscape").check();
    await dialog.getByRole("button", { name: "Page colour #ffffff" }).click();
    await dialog.getByRole("dialog", { name: "Page colour" }).getByRole("button", { name: "#d9ead3" }).click();
    await dialog.getByRole("button", { name: "Set as default" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Saved as default");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    // Cancel leaves this document as it was.
    await expect(firstSheet(page)).toHaveCSS("width", "794px");

    await createDocument(page);
    await expect(firstSheet(page)).toHaveCSS("width", "1123px");
    await expect(firstSheet(page)).toHaveCSS("background-color", "rgb(217, 234, 211)");
    const fresh = await openPageSetup(page);
    await expect(fresh.getByLabel("Top")).toHaveValue("2");
    await expect(fresh.getByLabel("Landscape")).toBeChecked();
  });
});
