import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, mod, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const sentence = "The committee reviews the quarterly figures and drafts a careful reply to every question. ";

function sheets(page: Page) {
  return page.locator(".page-sheets > .page");
}

async function box(page: Page, selector: string) {
  return (await page.locator(selector).boundingBox())!;
}

/** The line boxes of the text in the document, in page coordinates. */
function textLines(page: Page) {
  return editor(page).evaluate((root) => {
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const lines: { top: number; bottom: number; text: string }[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!lines.some((line) => Math.abs(line.top - rect.top) < 2)) lines.push({ top: rect.top, bottom: rect.bottom, text: node.textContent!.slice(0, 20) });
      }
    }
    return lines.sort((a, b) => a.top - b.top);
  });
}

/** Clicking the editor scrolls it into view; measurements start from the top. */
async function scrollToTop(page: Page) {
  await page.locator(".editor-scroll").evaluate((element) => (element.scrollTop = 0));
}

async function openPageSetup(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Page setup" }).click();
  return page.getByRole("dialog", { name: "Page setup" });
}

async function chooseView(page: Page, item: string) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: item }).click();
}

test("a new document shows one A4 page with 2.54 cm margins and rulers aligned to it", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Hello");
  await scrollToTop(page);

  await expect(sheets(page)).toHaveCount(1);
  const sheet = (await sheets(page).first().boundingBox())!;
  expect(sheet).toMatchObject({ y: 145, width: 794, height: 1123 });
  const paragraph = (await editor(page).locator("p").first().boundingBox())!;
  expect(paragraph.x - sheet.x).toBe(96);
  expect(paragraph.y - sheet.y).toBe(96);
  expect(paragraph.width).toBe(794 - 2 * 96);

  expect(await box(page, ".ruler-band")).toMatchObject({ y: 113, height: 16 });
  // The ruler's 0 (the start of its white writable area) is the page's left margin.
  const writable = await box(page, ".horizontal-ruler .ruler-writable");
  expect(writable.x).toBeCloseTo(paragraph.x, 0);
  expect(writable.width).toBeCloseTo(paragraph.width, 0);
  expect((await box(page, ".horizontal-ruler")).x).toBeCloseTo(sheet.x, 0);
  await expect(page.locator(".horizontal-ruler .ruler-label").first()).toHaveText("-2");
  const vertical = await box(page, ".vertical-ruler .ruler-writable");
  expect(vertical.y).toBeCloseTo(sheet.y + 96, 0);
  expect(vertical.width).toBe(16);

  // The left indent marker follows the paragraph's indent.
  const marker = async () => (await box(page, ".ruler-marker.left-indent")).x;
  const before = await marker();
  expect(before + 5).toBeCloseTo(paragraph.x, 0);
  await page.keyboard.press(`${mod}+]`);
  await expect.poll(marker).toBeCloseTo(before + 48, 0);
});

test("text that does not fit continues at the top margin of the next page", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.insertText("Opening line.");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(sentence.repeat(70));

  await expect(sheets(page)).toHaveCount(2);
  const [first, second] = [(await sheets(page).nth(0).boundingBox())!, (await sheets(page).nth(1).boundingBox())!];
  expect(second.y - (first.y + first.height)).toBe(10);
  expect(second.height).toBe(1123);

  const lines = await textLines(page);
  const onFirst = lines.filter((line) => line.top < first.y + first.height);
  const onSecond = lines.filter((line) => line.top > second.y);
  expect(onFirst.at(-1)!.bottom).toBeLessThanOrEqual(first.y + first.height - 96 + 1);
  expect(onSecond[0]!.top).toBeGreaterThanOrEqual(second.y + 96 - 1);
  expect(onSecond[0]!.top).toBeLessThan(second.y + 96 + 4);
  // The paragraph was split between two lines, not moved whole.
  expect(await editor(page).locator("p").count()).toBe(2);

  // Deleting the text brings the document back to one page, and undo restores the second.
  await page.keyboard.press(`${mod}+z`);
  await expect(sheets(page)).toHaveCount(1);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(sheets(page)).toHaveCount(2);
});

test("⌘Enter starts a new page", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First page");
  await page.keyboard.press(`${mod}+Enter`);
  await page.keyboard.type("Second page");

  await expect(sheets(page)).toHaveCount(2);
  const second = (await sheets(page).nth(1).boundingBox())!;
  const paragraph = (await editor(page).getByText("Second page").boundingBox())!;
  expect(paragraph.y - second.y).toBeCloseTo(96, 0);
  // In print layout the break itself is not drawn as a line.
  await expect(editor(page).locator(".page-break")).toHaveCSS("border-top-style", "none");
});

test("page setup changes the paper size, orientation and margins and persists", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Wide");

  const dialog = await openPageSetup(page);
  await expect(dialog.getByLabel("Portrait")).toBeChecked();
  await expect(dialog.getByLabel("Paper size")).toHaveValue("A4");
  await expect(dialog.getByLabel("Top")).toHaveValue("2.54");
  await dialog.getByLabel("Landscape").check();
  await dialog.getByLabel("Paper size").selectOption("Letter");
  await dialog.getByLabel("Top").fill("1");
  await dialog.getByLabel("Left").fill("2");
  await dialog.getByRole("button", { name: "OK" }).click();

  const check = async () => {
    const sheet = (await sheets(page).first().boundingBox())!;
    expect(sheet).toMatchObject({ width: 1056, height: 816 });
    const paragraph = (await editor(page).locator("p").first().boundingBox())!;
    expect(paragraph.y - sheet.y).toBeCloseTo(37.8, 0);
    expect(paragraph.x - sheet.x).toBeCloseTo(75.6, 0);
  };
  await expect(sheets(page).first()).toHaveCSS("width", "1056px");
  await check();

  // Page setup is an edit like any other: undo goes back to A4 portrait.
  await page.keyboard.press(`${mod}+z`);
  await expect(sheets(page).first()).toHaveCSS("width", "794px");
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(sheets(page).first()).toHaveCSS("width", "1056px");

  await waitUntilSaved(page);
  await page.reload();
  await expect(sheets(page).first()).toHaveCSS("width", "1056px");
  await check();

  const reopened = await openPageSetup(page);
  await expect(reopened.getByLabel("Landscape")).toBeChecked();
  await expect(reopened.getByLabel("Left")).toHaveValue("2");
  await reopened.getByLabel("Right").fill("30");
  await reopened.getByRole("button", { name: "OK" }).click();
  await expect(reopened.getByRole("alert")).toHaveText("The margins are too large for the page.");
  await reopened.getByRole("button", { name: "Cancel" }).click();
  await expect(reopened).toBeHidden();
  await expect(sheets(page).first()).toHaveCSS("width", "1056px");
});

test("View > Show ruler and Show print layout toggle and persist", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Before");
  await page.keyboard.press(`${mod}+Enter`);
  await page.keyboard.type("After");

  await chooseView(page, "Show ruler");
  await expect(page.locator(".ruler-band")).toHaveCount(0);
  await expect(page.locator(".vertical-ruler")).toHaveCount(0);
  await scrollToTop(page);
  expect((await sheets(page).first().boundingBox())!.y).toBe(129);

  await chooseView(page, "Show print layout");
  await expect(page.locator(".page-stack")).toHaveClass(/is-pageless/);
  await expect(sheets(page).first()).toBeHidden();
  await expect(editor(page).locator(".page-break")).toHaveCSS("border-top-style", "dashed");

  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page)).toContainText("After");
  await expect(page.locator(".ruler-band")).toHaveCount(0);
  await expect(page.locator(".page-stack")).toHaveClass(/is-pageless/);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Show ruler" })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  await chooseView(page, "Show print layout");
  await chooseView(page, "Show ruler");
  await expect(sheets(page)).toHaveCount(2);
  await expect(page.locator(".ruler-band")).toHaveCount(1);
});

test("the ruler follows the page when the comment margin shifts it", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Commented");
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+Alt+m`);
  await expect.poll(async () => (await box(page, ".horizontal-ruler")).x).toBeCloseTo(
    (await sheets(page).first().boundingBox())!.x,
    0,
  );
});

test.describe("in the United States", () => {
  test.use({ locale: "en-US" });

  test("new documents use Letter paper and inches", async ({ page }) => {
    await createDocument(page);
    const sheet = (await sheets(page).first().boundingBox())!;
    expect(sheet).toMatchObject({ width: 816, height: 1056 });
    await expect(page.locator(".horizontal-ruler .ruler-label").first()).toHaveText("-1");
    const dialog = await openPageSetup(page);
    await expect(dialog.getByLabel("Paper size")).toHaveValue("Letter");
    await expect(dialog.getByText("Margins (inches)")).toBeVisible();
    await expect(dialog.getByLabel("Bottom")).toHaveValue("1");
  });
});
