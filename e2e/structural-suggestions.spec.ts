// Acceptance criteria of the round 4 amendment of docs/spec/16-suggesting.md: structural
// suggestions (objects, table rows and columns, image changes) and suggestions in headers,
// footers and footnotes.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDocument, editor, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const GREEN = "rgb(53, 113, 58)";
const chordModifiers = process.platform === "darwin" ? "Control+Meta" : "Control+Alt";

function margin(page: Page) {
  return page.getByRole("complementary", { name: "Comments", exact: true });
}

function card(page: Page, description: string) {
  return margin(page).getByRole("article", { name: `Suggestion: ${description}` });
}

function suggestionCards(page: Page) {
  return margin(page).locator(".suggestion-card");
}

function modeButton(page: Page, mode: "Editing" | "Suggesting" | "Viewing") {
  return page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: `${mode} mode` });
}

async function suggest(page: Page): Promise<void> {
  await modeButton(page, "Editing").click();
  await page.getByRole("menuitemcheckbox", { name: "Suggesting" }).click();
  await expect(modeButton(page, "Suggesting")).toBeVisible();
}

/** Clicks Accept or Reject on a card (activating it first). */
async function resolveCard(cardLocator: Locator, action: "Accept" | "Reject"): Promise<void> {
  await cardLocator.click();
  await cardLocator.getByRole("button", { name: `${action} suggestion` }).click();
}

/** Uploads a 300 × 150 PNG drawn in the page at the cursor. */
async function uploadImage(page: Page): Promise<void> {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#4a86e8";
    context.fillRect(0, 0, 300, 150);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .locator('input[type="file"][accept^="image"]')
    .setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(editor(page).locator(".image-frame img")).toHaveJSProperty("naturalWidth", 300);
}

async function insertTable(page: Page, columns: number, rows: number): Promise<void> {
  await menuBarItem(page, "Insert").click();
  await page.getByRole("menu", { name: "Insert" }).getByRole("menuitem", { name: "Table" }).hover();
  await page.getByRole("menuitem", { name: `${columns} x ${rows}`, exact: true }).click();
}

/** A 2 × 2 table with A1, B1 / A2, B2, typed in Editing mode. */
async function tableDocument(page: Page): Promise<void> {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Before the table");
  await page.keyboard.press("Enter");
  await insertTable(page, 2, 2);
  for (const [index, value] of ["A1", "B1", "A2", "B2"].entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await page.keyboard.type(value);
  }
  await waitUntilSaved(page);
}

async function tableMenuItem(page: Page, cell: Locator, item: string): Promise<void> {
  await cell.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: item, exact: true }).click();
}

const rowTexts = (page: Page) =>
  editor(page)
    .locator("tr")
    .evaluateAll((rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent)));

test("inserting an image in Suggesting mode shows a dashed outline and an Add: Image card; rejecting removes it", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Text above the image");
  await page.keyboard.press("Enter");
  await suggest(page);
  await uploadImage(page);

  const frame = editor(page).locator(".image-frame");
  await expect(frame).toHaveClass(/suggestion-node-insert/);
  await expect(frame).toHaveCSS("outline-style", "dashed");
  await expect(frame).toHaveCSS("outline-color", GREEN);
  await expect(frame).toHaveCSS("outline-width", "2px");
  await expect(card(page, "Add: Image")).toBeVisible();
  await expect(card(page, "Add: Image")).toContainText("Add: Image");

  await waitUntilSaved(page);
  await page.reload();
  await expect(card(page, "Add: Image")).toBeVisible();

  await resolveCard(card(page, "Add: Image"), "Reject");
  await expect(editor(page).locator(".image-frame")).toHaveCount(0);
  await expect(suggestionCards(page)).toHaveCount(0);
  await expect(editor(page)).toHaveText("Text above the image");
});

test("deleting an image in Suggesting mode overlays it with stripes; accepting removes it", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Text");
  await page.keyboard.press("Enter");
  await uploadImage(page);
  await waitUntilSaved(page);
  await suggest(page);
  await editor(page).locator(".image-frame img").click();
  await page.keyboard.press("Backspace");

  const frame = editor(page).locator(".image-frame");
  await expect(frame).toHaveClass(/suggestion-node-delete/);
  const overlay = await frame.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return { image: style.backgroundImage, opacity: style.opacity };
  });
  expect(overlay.image).toContain("repeating-linear-gradient");
  expect(overlay.opacity).toBe("0.5");
  await expect(card(page, "Delete: Image")).toBeVisible();

  await resolveCard(card(page, "Delete: Image"), "Accept");
  await expect(editor(page).locator(".image-frame")).toHaveCount(0);
});

test("image changes in Suggesting mode are a Format: image suggestion; rejecting restores the previous values", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Text");
  await page.keyboard.press("Enter");
  await uploadImage(page);
  await waitUntilSaved(page);
  await suggest(page);
  await editor(page).locator(".image-frame img").click();
  await page.getByRole("button", { name: "Wrap text options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Break text" }).click();
  await expect(editor(page).locator(".image-frame")).toHaveAttribute("data-wrap", "break");
  await expect(card(page, "Format: image")).toBeVisible();

  await resolveCard(card(page, "Format: image"), "Reject");
  await expect(editor(page).locator(".image-frame")).not.toHaveAttribute("data-wrap", "break");
  await expect(suggestionCards(page)).toHaveCount(0);
});

test("deleting a table row in Suggesting mode strikes it through with a Delete: Table row card; accepting removes the row", async ({ page }) => {
  await tableDocument(page);
  await suggest(page);
  await tableMenuItem(page, editor(page).locator("td").first(), "Delete row");

  const row = editor(page).locator("tr").first();
  await expect(row).toHaveClass(/suggestion-node-delete/);
  await expect(row.locator("td").first()).toHaveCSS("text-decoration-line", "line-through");
  await expect(row.locator("td").first()).toHaveCSS("color", GREEN);
  await expect(card(page, "Delete: Table row")).toBeVisible();
  expect(await rowTexts(page)).toEqual([
    ["A1", "B1"],
    ["A2", "B2"],
  ]);

  await resolveCard(card(page, "Delete: Table row"), "Accept");
  expect(await rowTexts(page)).toEqual([["A2", "B2"]]);
  await expect(suggestionCards(page)).toHaveCount(0);
});

test("inserted rows and columns are outlined suggestions; merging cells is applied directly", async ({ page }) => {
  await tableDocument(page);
  await suggest(page);
  await tableMenuItem(page, editor(page).locator("td").first(), "Insert row below");
  const inserted = editor(page).locator("tr").nth(1);
  await expect(inserted).toHaveClass(/suggestion-node-insert/);
  await expect(inserted.locator("td").first()).toHaveCSS("outline-style", "dashed");
  await expect(card(page, "Add: Table row")).toBeVisible();

  await tableMenuItem(page, editor(page).locator("td").first(), "Insert column to the right");
  await expect(card(page, "Add: Table column")).toBeVisible();
  await expect(editor(page).locator("td.suggestion-node-insert")).toHaveCount(2);

  // Reject all removes both.
  await page.keyboard.press(`${chordModifiers}+KeyO`);
  await page.keyboard.press(`${chordModifiers}+KeyU`);
  const review = page.getByRole("dialog", { name: "Suggested edits" });
  await review.getByRole("button", { name: "More reject options" }).click();
  await page.getByRole("menuitem", { name: "Reject all (2)" }).click();
  expect(await rowTexts(page)).toEqual([
    ["A1", "B1"],
    ["A2", "B2"],
  ]);
  await review.getByRole("button", { name: "Close" }).click();

  // Merging is not a suggestion.
  const [a, b] = [editor(page).locator("td").nth(0), editor(page).locator("td").nth(1)];
  await a.click();
  await page.keyboard.down("Shift");
  await b.click();
  await page.keyboard.up("Shift");
  await menuBarItem(page, "Format").click();
  await page.getByRole("menu", { name: "Format" }).getByRole("menuitem", { name: "Table", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Merge cells", exact: true }).click();
  await expect(editor(page).locator("td").first()).toHaveAttribute("colspan", "2");
  await expect(suggestionCards(page)).toHaveCount(0);
});

test("a page break, a horizontal line and a bulleted list become suggestions with their cards", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("One");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Two");
  await waitUntilSaved(page);
  await suggest(page);

  await page.keyboard.press(`${mod}+Enter`);
  await expect(card(page, "Add: Page break")).toBeVisible();
  await expect(editor(page).locator(".page-break")).toHaveClass(/suggestion-node-insert/);

  await menuBarItem(page, "Insert").click();
  await page.getByRole("menu", { name: "Insert" }).getByRole("menuitem", { name: "Horizontal line" }).click();
  await expect(card(page, "Add: Horizontal line")).toBeVisible();
  await expect(editor(page).locator("hr")).toHaveCSS("border-top-style", "dashed");

  await editor(page).getByText("One").click();
  await page.keyboard.press(`${mod}+ArrowUp`);
  await selectionSynced(page);
  await page.getByRole("button", { name: /^Bulleted list \(/ }).click();
  await expect(card(page, "Format: bulleted list")).toBeVisible();

  // Accept all applies all three in one undo step.
  await page.keyboard.press(`${chordModifiers}+KeyO`);
  await page.keyboard.press(`${chordModifiers}+KeyU`);
  const review = page.getByRole("dialog", { name: "Suggested edits" });
  await review.getByRole("button", { name: "More accept options" }).click();
  await page.getByRole("menuitem", { name: "Accept all (3)" }).click();
  await expect(suggestionCards(page)).toHaveCount(0);
  await expect(editor(page).locator(".page-break")).toHaveCount(1);
  await expect(editor(page).locator("hr")).toHaveCount(1);
  await expect(editor(page).locator("ul li")).toHaveText("One");
});

test("typing in the header in Suggesting mode makes a suggestion with a card; accepting makes it normal header text", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Body text");
  await waitUntilSaved(page);
  await suggest(page);

  await page.keyboard.press(`${chordModifiers}+KeyO`);
  await page.keyboard.press(`${chordModifiers}+KeyH`);
  const header = page.getByRole("textbox", { name: "Header" });
  await expect(header).toBeFocused();
  await page.keyboard.type("Draft header");
  await expect(header.locator(".suggestion-insert")).toHaveText("Draft header");
  await expect(header.locator(".suggestion-insert")).toHaveCSS("color", GREEN);

  // The card is in the margin, level with the header.
  const headerCard = card(page, "Add: “Draft header”");
  await expect(headerCard).toBeVisible();
  await expect(headerCard).toHaveClass(/is-active/);
  const [cardBox, headerBox] = [(await headerCard.boundingBox())!, (await header.boundingBox())!];
  expect(Math.abs(cardBox.y - headerBox.y)).toBeLessThan(40);

  // Leaving the header hides its cards from the margin, but Review suggested edits still lists it.
  await page.keyboard.press("Escape");
  await expect(header).toHaveCount(0);
  await expect(page.locator(".page-region-slot.is-header .suggestion-insert")).toHaveText("Draft header");
  await editor(page).getByText("Body text").click();
  await expect(headerCard).toHaveCount(0);
  await page.keyboard.press(`${chordModifiers}+KeyO`);
  await page.keyboard.press(`${chordModifiers}+KeyU`);
  const review = page.getByRole("dialog", { name: "Suggested edits" });
  await review.getByRole("button", { name: "Next" }).click();
  await expect(headerCard).toBeVisible();
  await review.getByRole("button", { name: "Accept", exact: true }).click();

  await expect(suggestionCards(page)).toHaveCount(0);
  const text = page.locator(".page-region-slot.is-header").first();
  await expect(text).toHaveText("Draft header");
  await expect(text.locator(".suggestion-insert")).toHaveCount(0);
  await waitUntilSaved(page);
  await page.reload();
  await expect(page.locator(".page-region-slot.is-header").first()).toHaveText("Draft header");
  await expect(suggestionCards(page)).toHaveCount(0);
});

test("a deletion in a footnote is a suggestion, and rejecting it in the margin restores the text", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Claim");
  await page.keyboard.press(`${mod}+Alt+KeyF`);
  const footnote = page.getByRole("textbox", { name: "Footnote 1" });
  await expect(footnote).toBeFocused();
  await page.keyboard.type("Source text");
  await page.keyboard.press("Escape");
  await waitUntilSaved(page);
  await suggest(page);

  await page.locator(".footnote-entry .footnote-text").click();
  await expect(footnote).toBeFocused();
  await page.keyboard.press("End");
  for (let i = 0; i < " text".length; i++) await page.keyboard.press("Backspace");
  await expect(footnote.locator(".suggestion-delete")).toHaveText(" text");
  const footnoteCard = card(page, "Delete: “text”");
  await expect(footnoteCard).toBeVisible();
  await resolveCard(footnoteCard, "Reject");
  await expect(footnote.locator(".suggestion-delete")).toHaveCount(0);
  await expect(footnote).toHaveText("Source text");
});

test("an inserted footnote is a suggestion; its text is part of it and rejecting removes both", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Claim");
  await waitUntilSaved(page);
  await suggest(page);
  await page.keyboard.press(`${mod}+Alt+KeyF`);
  const footnote = page.getByRole("textbox", { name: "Footnote 1" });
  await expect(footnote).toBeFocused();
  await page.keyboard.type("Source");
  // The footnote's text is part of the insertion, not a suggestion of its own.
  await expect(footnote.locator(".suggestion-insert")).toHaveCount(0);
  await expect(page.locator(".footnote-entry")).toHaveClass(/is-suggested-insert/);
  await page.keyboard.press("Escape");
  await resolveCard(card(page, "Add: Footnote"), "Reject");
  await expect(page.locator(".footnote-entry")).toHaveCount(0);
  await expect(editor(page).locator("sup.footnote-ref")).toHaveCount(0);
});

test("Viewing mode hides a deleted table row and shows an inserted image without its outline", async ({ page }) => {
  await tableDocument(page);
  await suggest(page);
  await tableMenuItem(page, editor(page).locator("td").first(), "Delete row");
  await expect(card(page, "Delete: Table row")).toBeVisible();
  await modeButton(page, "Suggesting").click();
  await page.getByRole("menuitemcheckbox", { name: "Viewing" }).click();
  await expect(editor(page).locator("tr").first()).toBeHidden();
  await expect(editor(page).locator("tr").nth(1)).toBeVisible();
});
