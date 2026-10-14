import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { chooseDownload, createDocument, editor, lineEnd, lineStart, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const GREEN = "rgb(53, 113, 58)";
/** The first key of the chords (Ctrl+⌘O, then a letter). */
const chordModifiers = process.platform === "darwin" ? "Control+Meta" : "Control+Alt";

/** The comment margin, which holds the suggestion cards too. */
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

/** Three lines typed in Editing mode, saved. */
async function threeLines(page: Page): Promise<void> {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Third item here");
  await waitUntilSaved(page);
}

async function chooseMode(page: Page, from: "Editing" | "Suggesting" | "Viewing", to: "Editing" | "Suggesting" | "Viewing") {
  await modeButton(page, from).click();
  await page.getByRole("menuitemcheckbox", { name: to }).click();
  await expect(modeButton(page, to)).toBeVisible();
}

/** Moves the cursor to the end of line `line` (1-based) of the three lines. */
async function endOfLine(page: Page, line: number): Promise<void> {
  await page.keyboard.press(`${mod}+ArrowUp`);
  for (let i = 1; i < line; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
}

/** Selects the last `count` characters before the cursor. */
async function selectBack(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+ArrowLeft");
  await selectionSynced(page);
}

/** Insert " suggested" after "First item", delete "Second item" and bold "here", in Suggesting mode. */
async function threeSuggestions(page: Page): Promise<void> {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  await endOfLine(page, 1);
  await page.keyboard.type(" suggested");
  await endOfLine(page, 2);
  await selectBack(page, "Second item".length);
  await page.keyboard.press("Backspace");
  await endOfLine(page, 3);
  await selectBack(page, "here".length);
  await page.keyboard.press(`${mod}+b`);
  await expect(suggestionCards(page)).toHaveCount(3);
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

test("the mode button and View > Mode switch between Editing, Suggesting and Viewing", async ({ page }) => {
  await threeLines(page);
  await modeButton(page, "Editing").click();
  const items = page.getByRole("menuitemcheckbox");
  await expect(items).toHaveText([
    /Editing\s*Edit document directly/,
    /Suggesting\s*Edits become suggestions/,
    /Viewing\s*Read or print final document/,
  ]);
  await expect(page.getByRole("menuitemcheckbox", { name: "Editing" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Suggesting" }).click();

  await expect(page.locator(".snackbar")).toHaveText("You're suggesting");
  await expect(modeButton(page, "Suggesting")).toHaveCSS("background-color", "rgb(211, 227, 253)");
  // The snackbar goes away after 4 seconds.
  await expect(page.locator(".snackbar")).toHaveCount(0, { timeout: 6000 });

  await menuBarItem(page, "View").click();
  await page.getByRole("menuitem", { name: "Mode" }).hover();
  await expect(page.getByRole("menuitemcheckbox", { name: "Suggesting" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Viewing" }).click();
  await expect(modeButton(page, "Viewing")).toBeVisible();

  // ⌘+Option+Shift+Z sets Editing; ⌘+Option+Shift+X toggles Suggesting and Editing.
  await page.keyboard.press(`${mod}+Alt+Shift+KeyZ`);
  await expect(modeButton(page, "Editing")).toBeVisible();
  await editor(page).click();
  await page.keyboard.press(`${mod}+Alt+Shift+KeyX`);
  await expect(modeButton(page, "Suggesting")).toBeVisible();
  await page.keyboard.press(`${mod}+Alt+Shift+KeyX`);
  await expect(modeButton(page, "Editing")).toBeVisible();
  await page.keyboard.press(`${mod}+Alt+Shift+KeyX`);

  // The mode is remembered per document.
  await page.reload();
  await expect(modeButton(page, "Suggesting")).toBeVisible();
  await createDocument(page);
  await expect(modeButton(page, "Editing")).toBeVisible();
});

test("typed text becomes a green insertion with an Add card", async ({ page }) => {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  await expect(page.locator(".snackbar")).toHaveText("You're suggesting");
  await endOfLine(page, 1);
  await page.keyboard.type(" suggested");

  const inserted = editor(page).locator(".suggestion-insert");
  await expect(inserted).toHaveText(" suggested");
  await expect(inserted).toHaveCSS("color", GREEN);
  await expect(card(page, "Add: “suggested”")).toBeVisible();
  await expect(card(page, "Add: “suggested”").locator("em")).toHaveText("suggested");
  await expect(card(page, "Add: “suggested”")).toContainText("You");
  await expect(suggestionCards(page)).toHaveCount(1);
});

test("a tab typed at the start of a line becomes a green insertion", async ({ page }) => {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  await endOfLine(page, 2);
  await page.keyboard.press(lineStart);
  await selectionSynced(page);
  await page.keyboard.press("Tab");

  const second = editor(page).locator("p").nth(1);
  await expect(second.locator(".suggestion-insert .tab-char")).toHaveCount(1);
  await expect(second).toHaveText("\tSecond item");
  await expect(second).toHaveCSS("margin-left", "0px");
  await expect(suggestionCards(page)).toHaveCount(1);
  // Rejecting it removes the tab.
  await suggestionCards(page).first().getByRole("button", { name: "Reject suggestion" }).click();
  await expect(second).toHaveText("Second item");
  await expect(editor(page).locator(".tab-char")).toHaveCount(0);
});

test("the \"You're suggesting\" snackbar is a 48px dark bar 16px from the bottom left", async ({ page }) => {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  const snackbar = page.locator(".snackbar");
  await expect(snackbar).toHaveText("You're suggesting");
  await expect(snackbar).toHaveCSS("background-color", "rgb(50, 50, 50)");
  await expect(snackbar).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(snackbar).toHaveCSS("font-size", "14px");
  await expect(snackbar).toHaveCSS("border-radius", "4px");
  const box = (await snackbar.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(288);
  expect(box.height).toBe(48);
  expect(box.x).toBe(16);
  expect(900 - (box.y + box.height)).toBe(16);
});

test("the suggestion being made is the active card while the cursor stays at it", async ({ page }) => {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  await endOfLine(page, 1);
  const scroller = page.locator(".editor-scroll");
  const scrollTop = await scroller.evaluate((element) => element.scrollTop);

  await page.keyboard.type(" sug");
  const active = margin(page).locator(".suggestion-card[aria-current]");
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAccessibleName("Suggestion: Add: “sug”");
  await expect(active.getByRole("button", { name: "Accept suggestion" })).toBeVisible();
  await expect(editor(page).locator(".suggestion-active")).toHaveText(" sug");
  // The document keeps the focus and does not scroll, so typing goes on.
  await expect(editor(page)).toBeFocused();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await page.keyboard.type("gested");
  await expect(active).toHaveAccessibleName("Suggestion: Add: “suggested”");
  await expect(editor(page).locator("p").first()).toHaveText("First item suggested");

  // Moving within or next to it keeps it active; moving away makes it inactive.
  await page.keyboard.press("ArrowLeft");
  await selectionSynced(page);
  await expect(active).toHaveCount(1);
  await page.keyboard.press(`${mod}+ArrowDown`);
  await selectionSynced(page);
  await expect(active).toHaveCount(0);
  await expect(editor(page).locator(".suggestion-active")).toHaveCount(0);

  // Deleting and formatting activate their suggestion too.
  await endOfLine(page, 2);
  await page.keyboard.press("Backspace");
  await expect(active).toHaveAccessibleName("Suggestion: Delete: “m”");
  await endOfLine(page, 3);
  await selectBack(page, "here".length);
  await page.keyboard.press(`${mod}+b`);
  await expect(active).toHaveAccessibleName("Suggestion: Format: bold");
  await expect(editor(page)).toBeFocused();
  await expect(suggestionCards(page)).toHaveCount(3);

  // A click elsewhere in the document makes it inactive, as before.
  await editor(page).locator("p").first().click({ position: { x: 2, y: 5 } });
  await expect(active).toHaveCount(0);
});

test("deleted text stays, struck through in green, with a Delete card; Backspace skips it", async ({ page }) => {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  await endOfLine(page, 2);
  await selectBack(page, "Second item".length);
  await page.keyboard.press("Backspace");

  const deleted = editor(page).locator(".suggestion-delete");
  await expect(deleted).toHaveText("Second item");
  await expect(deleted).toHaveCSS("color", GREEN);
  expect(await css(deleted, "text-decoration-line")).toBe("line-through");
  await expect(card(page, "Delete: “Second item”")).toBeVisible();

  // Backspace after struck-through text deletes the character before it.
  await endOfLine(page, 3);
  await selectBack(page, "here".length);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator(".suggestion-delete").nth(1)).toHaveText(" here");
  await expect(editor(page).locator("p").nth(2)).toHaveText("Third item here");
});

test("bolding text creates a Format: bold card", async ({ page }) => {
  await threeLines(page);
  await chooseMode(page, "Editing", "Suggesting");
  await endOfLine(page, 3);
  await selectBack(page, "here".length);
  await page.keyboard.press(`${mod}+b`);

  await expect(editor(page).locator("strong")).toHaveText("here");
  await expect(editor(page).locator("strong .suggestion-format")).toHaveCSS("color", GREEN);
  await expect(card(page, "Format: bold")).toBeVisible();
});

test("accepting an insertion leaves normal text; rejecting a deletion restores it; each is one undo step", async ({ page }) => {
  await threeSuggestions(page);

  await editor(page).locator(".suggestion-insert").click();
  const addCard = card(page, "Add: “suggested”");
  await expect(addCard).toHaveAttribute("aria-current", "true");
  // The active suggestion has a 1px border in the suggestion colour.
  const active = editor(page).locator(".suggestion-active").first();
  await expect(active).toHaveCSS("box-shadow", `${GREEN} 0px 0px 0px 1px`);
  await expect(active).toHaveCSS("border-radius", "2px");
  await addCard.getByRole("button", { name: "Accept suggestion" }).click();
  await expect(addCard).toHaveCount(0);
  await expect(editor(page).locator(".suggestion-insert")).toHaveCount(0);
  await expect(editor(page).locator("p").first()).toHaveText("First item suggested");
  await expect(editor(page).locator("p").first()).toHaveCSS("color", "rgb(0, 0, 0)");

  await editor(page).locator(".suggestion-delete").click();
  const deleteCard = card(page, "Delete: “Second item”");
  await deleteCard.getByRole("button", { name: "Reject suggestion" }).click();
  await expect(deleteCard).toHaveCount(0);
  await expect(editor(page).locator(".suggestion-delete")).toHaveCount(0);
  await expect(editor(page).locator("p").nth(1)).toHaveText("Second item");

  // One undo brings the deletion back, a second one the insertion.
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page).locator(".suggestion-delete")).toHaveText("Second item");
  await expect(editor(page).locator(".suggestion-insert")).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page).locator(".suggestion-insert")).toHaveText(" suggested");
});

test("a reply on a suggestion is saved", async ({ page }) => {
  await threeSuggestions(page);
  await editor(page).locator(".suggestion-insert").click();
  const addCard = card(page, "Add: “suggested”");
  await addCard.getByRole("textbox", { name: "Reply" }).fill("Good idea");
  await addCard.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(addCard.locator(".comment-body")).toHaveText("Good idea");
  await waitUntilSaved(page);
  await page.reload();
  await expect(card(page, "Add: “suggested”").locator(".comment-body")).toHaveText("Good idea");
});

test("Review suggested edits steps through suggestions and accepts all in one undo step", async ({ page }) => {
  await threeSuggestions(page);
  await menuBarItem(page, "Tools").click();
  await page.getByRole("menuitem", { name: "Review suggested edits" }).click();
  const review = page.getByRole("dialog", { name: "Suggested edits" });
  await expect(review).toBeVisible();
  await expect(review).toHaveCSS("width", "408px");
  // The suggestion just made stays selected; Next wraps around to the first one.
  await expect(card(page, "Format: bold")).toHaveAttribute("aria-current", "true");
  await review.getByRole("button", { name: "Next" }).click();
  await expect(card(page, "Add: “suggested”")).toHaveAttribute("aria-current", "true");

  await review.getByRole("button", { name: "Next" }).click();
  await expect(card(page, "Delete: “Second item”")).toHaveAttribute("aria-current", "true");
  await review.getByRole("button", { name: "Next" }).click();
  await expect(card(page, "Format: bold")).toHaveAttribute("aria-current", "true");
  await review.getByRole("button", { name: "Previous" }).click();
  await expect(card(page, "Delete: “Second item”")).toHaveAttribute("aria-current", "true");

  // A full-width outlined dropdown, 40px tall.
  const viewButton = review.getByRole("button", { name: "Show suggested edits" });
  const reviewBox = (await review.boundingBox())!;
  const viewBox = (await viewButton.boundingBox())!;
  expect(viewBox.height).toBe(40);
  expect(viewBox.x).toBe(reviewBox.x + 16);
  expect(viewBox.width).toBe(reviewBox.width - 32);
  await expect(viewButton).toHaveCSS("border-radius", "4px");
  await expect(viewButton).toHaveCSS("border-top-width", "1px");
  await expect(viewButton).toHaveCSS("font-size", "14px");
  const arrowBox = (await viewButton.locator(".icon").last().boundingBox())!;
  expect(viewBox.x + viewBox.width - (arrowBox.x + arrowBox.width)).toBeLessThanOrEqual(12);

  // Split buttons 36px tall, the ▾ part 28px wide after a 1px divider, in a right-aligned row.
  for (const [main, more] of [
    ["Reject", "More reject options"],
    ["Accept", "More accept options"],
  ] as const) {
    const mainButton = review.getByRole("button", { name: main, exact: true });
    const moreButton = review.getByRole("button", { name: more });
    expect((await mainButton.locator("..").boundingBox())!.height).toBe(36);
    await expect(mainButton).toHaveCSS("font-size", "14px");
    expect((await moreButton.boundingBox())!.width).toBe(28);
    await expect(moreButton.locator("..")).toHaveCSS("border-left-width", "1px");
  }
  const acceptMore = (await review.getByRole("button", { name: "More accept options" }).boundingBox())!;
  expect(reviewBox.x + reviewBox.width - (acceptMore.x + acceptMore.width)).toBe(16);

  // The previews are read-only and without suggestion styling.
  await review.getByRole("button", { name: "Show suggested edits" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Preview accept all" }).click();
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await expect(editor(page).locator(".suggestion-delete")).toBeHidden();
  await expect(editor(page).locator(".suggestion-insert")).toHaveCSS("color", "rgb(0, 0, 0)");
  await review.getByRole("button", { name: "Preview accept all" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Preview reject all" }).click();
  await expect(editor(page).locator(".suggestion-insert")).toBeHidden();
  await expect(editor(page).locator(".suggestion-delete")).toHaveCSS("text-decoration-line", "none");
  await review.getByRole("button", { name: "Preview reject all" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show suggested edits" }).click();
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");

  await review.getByRole("button", { name: "More accept options" }).click();
  await page.getByRole("menuitem", { name: "Accept all (3)" }).click();
  await expect(suggestionCards(page)).toHaveCount(0);
  await expect(editor(page).locator("p")).toHaveText(["First item suggested", "", "Third item here"]);
  await expect(editor(page).locator("strong")).toHaveText("here");

  await editor(page).click();
  await page.keyboard.press(`${mod}+z`);
  await expect(suggestionCards(page)).toHaveCount(3);
  await expect(editor(page).locator(".suggestion-delete")).toHaveText("Second item");
});

test("Reject and Accept act on the selected suggestion; Ctrl+⌘O Ctrl+⌘U opens the card", async ({ page }) => {
  await threeSuggestions(page);
  // Away from the suggestion just made, so the card starts at the first suggestion.
  await page.keyboard.press(`${mod}+ArrowUp`);
  await expect(margin(page).locator("[aria-current]")).toHaveCount(0);
  await page.keyboard.press(`${chordModifiers}+KeyO`);
  await page.keyboard.press(`${chordModifiers}+KeyU`);
  const review = page.getByRole("dialog", { name: "Suggested edits" });
  await expect(review).toBeVisible();

  await review.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(editor(page).locator(".suggestion-insert")).toHaveCount(0);
  await expect(card(page, "Delete: “Second item”")).toHaveAttribute("aria-current", "true");
  await review.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(editor(page).locator("p")).toHaveText(["First item", "", "Third item here"]);
  await review.getByRole("button", { name: "More reject options" }).click();
  await page.getByRole("menuitem", { name: "Reject all (1)" }).click();
  await expect(editor(page).locator("strong")).toHaveCount(0);
  await expect(suggestionCards(page)).toHaveCount(0);
  await review.getByRole("button", { name: "Close" }).click();
  await expect(review).toHaveCount(0);
});

test("suggestions survive a reload, and Viewing mode shows the accepted result read-only", async ({ page }) => {
  await threeSuggestions(page);
  await waitUntilSaved(page);
  await page.reload();
  await expect(suggestionCards(page)).toHaveCount(3);
  await expect(editor(page).locator(".suggestion-insert")).toHaveText(" suggested");
  await expect(editor(page).locator(".suggestion-delete")).toHaveText("Second item");

  await chooseMode(page, "Suggesting", "Viewing");
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await expect(editor(page).locator(".suggestion-delete")).toBeHidden();
  await expect(editor(page).locator(".suggestion-insert")).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(margin(page)).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: /^Bold/ })).toBeDisabled();
  await expect(page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: /^Print/ })).toBeEnabled();
  await menuBarItem(page, "Format").click();
  await expect(page.getByRole("menuitem", { name: "Text" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await editor(page).click();
  await page.keyboard.type("nothing");
  await page.keyboard.press(`${mod}+b`);
  await expect(editor(page)).not.toContainText("nothing");
  await expect(editor(page).locator("strong")).toHaveText("here");
});

test("Word export writes tracked changes and importing the file brings the suggestions back", async ({ page }) => {
  await threeSuggestions(page);
  await waitUntilSaved(page);
  const download = page.waitForEvent("download");
  await chooseDownload(page, "Microsoft Word (.docx)");
  const file = await readFile(await (await download).path());
  const xml = await (await JSZip.loadAsync(file)).file("word/document.xml")!.async("string");
  expect(xml).toMatch(/<w:ins w:id="\d+" w:author="You" w:date="[^"]+">\s*<w:r>(?:(?!<\/w:r>).)*<w:t xml:space="preserve"> suggested<\/w:t>/s);
  expect(xml).toMatch(/<w:del w:id="\d+" w:author="You" w:date="[^"]+">\s*<w:r>(?:(?!<\/w:r>).)*<w:delText xml:space="preserve">Second item<\/w:delText>/s);
  expect(xml).toContain("<w:rPrChange");

  await page.goto("/");
  await page.getByRole("button", { name: "Open file picker" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog", { name: "Open a file" }).getByRole("button", { name: "Browse" }).click();
  await (await chooser).setFiles({
    name: "Suggestions.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: file,
  });
  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(editor(page).locator(".suggestion-insert")).toHaveText(" suggested");
  await expect(editor(page).locator(".suggestion-delete")).toHaveText("Second item");
  await expect(card(page, "Add: “suggested”")).toBeVisible();
  await expect(card(page, "Delete: “Second item”")).toBeVisible();
  await expect(card(page, "Format: bold")).toBeVisible();
});

test("version history shows suggestions and restoring a version keeps them", async ({ page }) => {
  await threeSuggestions(page);
  // The e2e server starts a new version after one second without edits.
  await waitUntilSaved(page);
  await page.waitForTimeout(1500);
  const preview = page.getByLabel("Version preview");
  const versions = page.getByRole("complementary", { name: "Version history" }).getByRole("listitem");

  // Accepting everything, then restoring the version with the suggestions, brings them back.
  await page.keyboard.press(`${chordModifiers}+KeyO`);
  await page.keyboard.press(`${chordModifiers}+KeyU`);
  await page.getByRole("dialog", { name: "Suggested edits" }).getByRole("button", { name: "More accept options" }).click();
  await page.getByRole("menuitem", { name: "Accept all (3)" }).click();
  await expect(suggestionCards(page)).toHaveCount(0);
  await waitUntilSaved(page);

  await page.getByRole("button", { name: "Version history" }).click();
  await expect(versions.nth(1)).toBeVisible();
  await versions.nth(1).getByRole("button").first().click();
  await expect(preview.locator(".suggestion-insert")).toHaveText(" suggested");
  await expect(preview.locator(".suggestion-delete")).toHaveText("Second item");
  await versions.nth(1).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Restore this version" }).click();
  await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore" }).click();
  await expect(suggestionCards(page)).toHaveCount(3);
  await expect(editor(page).locator(".suggestion-delete")).toHaveText("Second item");
});
