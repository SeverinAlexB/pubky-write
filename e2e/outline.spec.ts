import { expect, test, type Page } from "@playwright/test";
import { chooseStyle, createDocument, editor, menuBarItem, mod, selectionSynced } from "./helpers.ts";

function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Tabs and outlines" });
}

function outlineItems(page: Page) {
  return sidebar(page).getByRole("list", { name: "Outline" }).getByRole("button");
}

async function box(page: Page, selector: string) {
  const result = await page.locator(selector).first().boundingBox();
  if (!result) throw new Error(`${selector} is not visible`);
  return result;
}

/** Types a paragraph in `style` and starts a new Normal text paragraph. */
async function typeParagraph(page: Page, style: string, text: string): Promise<void> {
  await chooseStyle(page, style);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await chooseStyle(page, "Normal text");
}

test("the collapsed button opens the sidebar, which re-centres the page and is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createDocument(page);
  const open = page.getByRole("button", { name: "Show tabs and outlines" });
  await expect(sidebar(page)).toBeHidden();
  await expect(open).toBeVisible();

  // Top left of the editor area: right of the vertical ruler, below the horizontal one.
  const button = (await open.boundingBox())!;
  const ruler = await box(page, ".vertical-ruler");
  const rulerBand = await box(page, ".ruler-band");
  expect(button.width).toBe(40);
  expect(button.height).toBe(40);
  expect(button.x - (ruler.x + ruler.width)).toBeCloseTo(16, 0);
  expect(button.y - (rulerBand.y + rulerBand.height)).toBeCloseTo(18, 0);
  await expect(open).toHaveCSS("border-radius", "50%");

  const centred = (await box(page, ".page")).x;
  await open.click();
  await expect(sidebar(page)).toBeVisible();
  await expect(open).toBeHidden();
  await expect(sidebar(page)).toHaveCSS("width", "280px");
  await expect(sidebar(page)).toHaveCSS("background-color", "rgb(248, 250, 253)");
  // The page is centred in the space right of the sidebar.
  await expect.poll(async () => Math.round((await box(page, ".page")).x - centred)).toBe(140);

  await page.reload();
  await expect(sidebar(page)).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Hide tabs and outlines" }).click();
  await expect(sidebar(page)).toBeHidden();
  await page.reload();
  await expect(sidebar(page)).toBeHidden();

  await menuBarItem(page, "View").click();
  await page.getByRole("menuitem", { name: "Expand tabs and outlines sidebar" }).click();
  await expect(sidebar(page)).toBeVisible();
  await menuBarItem(page, "View").click();
  await page.getByRole("menuitem", { name: "Collapse tabs and outlines sidebar" }).click();
  await expect(sidebar(page)).toBeHidden();
});

test("the sidebar shows the tab and the headings nested by level, with a guide line", async ({ page }) => {
  await createDocument(page);
  await page.getByRole("button", { name: "Show tabs and outlines" }).click();
  await expect(sidebar(page).getByRole("heading", { name: "Document tabs" })).toHaveCSS("font-weight", "500");
  const tab = sidebar(page).locator(".outline-tab");
  await expect(tab).toContainText("Tab 1");
  await expect(tab).toHaveCSS("background-color", "rgb(211, 227, 253)");
  await expect(tab).toHaveCSS("height", "40px");
  await expect(tab).toHaveCSS("border-radius", "20px");
  await expect(sidebar(page)).toContainText("Headings that you add to the document will appear here.");

  await editor(page).click();
  await typeParagraph(page, "Title", "Annual report");
  await page.keyboard.type("Intro text");
  await page.keyboard.press("Enter");
  await typeParagraph(page, "Heading 1", "Summary");
  await typeParagraph(page, "Heading 2", "Numbers");
  await typeParagraph(page, "Heading 3", "Revenue in the very long last quarter of the year that does not fit");
  // An empty heading is not listed.
  await chooseStyle(page, "Heading 2");
  await page.keyboard.press("Enter");
  await chooseStyle(page, "Normal text");
  await typeParagraph(page, "Heading 1", "Outlook");

  await expect(outlineItems(page)).toHaveText([
    "Annual report",
    "Summary",
    "Numbers",
    "Revenue in the very long last quarter of the year that does not fit",
    "Outlook",
  ]);
  await expect(sidebar(page)).not.toContainText("Headings that you add");
  const left = (index: number) => outlineItems(page).nth(index).evaluate((element) => getComputedStyle(element).paddingLeft);
  // Title is the highest level used; each level below it is indented 12px more.
  expect([await left(0), await left(1), await left(2), await left(3), await left(4)]).toEqual([
    "16px",
    "28px",
    "40px",
    "52px",
    "28px",
  ]);
  await expect(outlineItems(page).first()).toHaveCSS("height", "36px");
  await expect(outlineItems(page).first()).toHaveCSS("font-size", "14px");
  await expect(outlineItems(page).nth(3)).toHaveCSS("text-overflow", "ellipsis");
  expect((await outlineItems(page).nth(3).boundingBox())!.height).toBe(36); // a single line
  await expect(sidebar(page).locator(".outline-list")).toHaveCSS("border-left", "1px solid rgb(199, 199, 199)");
});

test("the current heading follows the cursor and clicking a heading jumps to it", async ({ page }) => {
  await createDocument(page);
  await page.getByRole("button", { name: "Show tabs and outlines" }).click();
  await editor(page).click();
  await page.keyboard.press(`${mod}+Alt+1`);
  await page.keyboard.type("Introduction");
  await page.keyboard.press("Enter");
  for (let line = 0; line < 60; line++) await page.keyboard.press("Enter");
  await page.keyboard.press(`${mod}+Alt+2`);
  await page.keyboard.type("Details");

  const introduction = sidebar(page).getByRole("button", { name: "Introduction" });
  const details = sidebar(page).getByRole("button", { name: "Details" });
  await expect(outlineItems(page)).toHaveText(["Introduction", "Details"]);
  await expect(details).toHaveAttribute("aria-current", "location");
  await expect(details).toHaveCSS("color", "rgb(11, 87, 208)");
  await expect(introduction).toHaveCSS("color", "rgb(31, 31, 31)");
  // The 2px primary bar on the guide line, at the current row.
  const bar = await sidebar(page)
    .locator("li.is-current")
    .evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return { width: style.width, background: style.backgroundColor };
    });
  expect(bar).toEqual({ width: "2px", background: "rgb(11, 87, 208)" });

  // Details is on page 2: clicking Introduction scrolls the heading to the top and puts the cursor in it.
  await introduction.click();
  await expect(introduction).toHaveAttribute("aria-current", "location");
  await expect(details).not.toHaveAttribute("aria-current");
  const heading = editor(page).locator("h1");
  await expect.poll(async () => (await heading.boundingBox())!.y - (await box(page, ".editor-scroll")).y).toBeLessThan(40);
  await selectionSynced(page);
  await page.keyboard.type("An ");
  await expect(heading).toHaveText("An Introduction");

  // Moving the cursor with the keyboard moves the highlight. The editor reads the browser's
  // selection asynchronously, so the (idempotent) key is pressed again until it has.
  await expect(async () => {
    await page.keyboard.press(`${mod}+ArrowDown`);
    await expect(details).toHaveAttribute("aria-current", "location", { timeout: 500 });
  }).toPass();
  await expect(introduction).not.toHaveAttribute("aria-current");

  await introduction.click();
  await expect(introduction).toHaveAttribute("aria-current", "location");
  await details.click();
  await expect(details).toHaveAttribute("aria-current", "location");
  await expect.poll(async () => (await editor(page).locator("h2").boundingBox())!.y - (await box(page, ".editor-scroll")).y).toBeLessThan(40);
});

test("the tab shows the number of open comments", async ({ page }) => {
  await createDocument(page);
  await page.getByRole("button", { name: "Show tabs and outlines" }).click();
  const badge = sidebar(page).locator(".outline-tab-badge");
  await expect(badge).toHaveCount(0);

  await editor(page).click();
  await page.keyboard.type("one two");
  for (const word of ["two", "one"]) {
    await page.evaluate((text) => {
      type Chain = { focus: () => Chain; setTextSelection: (range: object) => Chain; run: () => void };
      type Editor = { state: { doc: { textContent: string } }; chain: () => Chain };
      const instance = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
      const from = instance.state.doc.textContent.indexOf(text) + 1;
      instance.chain().focus().setTextSelection({ from, to: from + text.length }).run();
    }, word);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press(`${mod}+Alt+m`);
    await page.getByLabel("Comment", { exact: true }).fill(`On ${word}`);
    await page.getByLabel("Comment", { exact: true }).press(`${mod}+Enter`);
    await expect(page.getByRole("article", { name: `Comment on "${word}"` })).toBeVisible();
  }
  await expect(badge).toHaveText("2");
  await expect(badge).toHaveAccessibleName("2 open comments");
  // A 20px white circle with the number in 12px dark text.
  await expect(badge).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(badge).toHaveCSS("color", "rgb(31, 31, 31)");
  await expect(badge).toHaveCSS("font-size", "12px");
  await expect(badge).toHaveCSS("border-radius", "10px");
  const badgeBox = (await badge.boundingBox())!;
  expect(badgeBox.width).toBe(20);
  expect(badgeBox.height).toBe(20);
  // The "+" next to "Document tabs" adds a tab (docs/spec/18-document-tabs.md).
  await expect(sidebar(page).getByRole("button", { name: "Add tab" })).toBeVisible();

  await page.getByRole("article", { name: 'Comment on "one"' }).click();
  await page.getByRole("button", { name: "Mark as resolved and hide discussion" }).click();
  await expect(badge).toHaveText("1");
});
