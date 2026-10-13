import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDocument, editor, lineEnd, lineStart, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

/** Types `text`, then selects `word` (its last occurrence) with the keyboard. */
async function typeAndSelect(page: Page, text: string, word: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.type(text);
  await selectBack(page, text, word);
}

/** With the cursor at the end of `text`, selects `word` (its last occurrence in `text`) with the keyboard. */
async function selectBack(page: Page, text: string, word: string): Promise<void> {
  const end = text.lastIndexOf(word) + word.length;
  for (let i = 0; i < text.length - end; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < word.length; i++) await page.keyboard.press("Shift+ArrowLeft");
  // The editor reads the browser selection asynchronously; wait until it has caught up.
  await page.waitForFunction((expected) => {
    const view = (document.querySelector(".ProseMirror") as HTMLElement & { editor?: any }).editor;
    const { from, to } = view.state.selection;
    return view.state.doc.textBetween(from, to) === expected;
  }, word);
}

/** The comment margin beside the pages. */
function margin(page: Page) {
  return page.getByRole("complementary", { name: "Comments", exact: true });
}

function allComments(page: Page) {
  return page.getByRole("complementary", { name: "All comments" });
}

function card(page: Page, quote: string) {
  return margin(page).getByRole("article", { name: `Comment on "${quote}"` });
}

function pill(page: Page) {
  return page.getByRole("toolbar", { name: "Selection actions" });
}

/** Starts a comment from the floating pill and submits it. */
async function addComment(page: Page, body: string): Promise<void> {
  await pill(page).getByRole("button", { name: "Add comment" }).click();
  await margin(page).getByLabel("Comment", { exact: true }).fill(body);
  await margin(page).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(margin(page).getByRole("article", { name: "New comment" })).toHaveCount(0);
  await expect(margin(page).locator(".comment-body", { hasText: body })).toBeVisible();
}

/** Replies on the active card and waits until the reply is saved. */
async function reply(thread: Locator, body: string): Promise<void> {
  await thread.getByRole("textbox", { name: "Reply" }).fill(body);
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread.locator(".comment-body", { hasText: body })).toBeVisible();
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("not visible");
  return result;
}

/** Waits until the card's top is level with the top of its highlighted text. */
async function expectBeside(cardLocator: Locator, highlight: Locator): Promise<void> {
  await expect.poll(async () => Math.abs((await box(cardLocator)).y - (await box(highlight)).y)).toBeLessThanOrEqual(2);
}

async function chooseCommentsMenu(page: Page, item: string): Promise<void> {
  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("menuitem", { name: "Comments" }).hover();
  await page.getByRole("menuitem", { name: item }).or(page.getByRole("menuitemcheckbox", { name: item })).click();
}

test("a comment stays attached to its text through edits and reloads", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "The quick brown fox", "brown");
  await addComment(page, "Which shade of brown?");
  await expect(editor(page).locator(".comment-highlight")).toHaveText("brown");

  // Edits before and right next to the commented text.
  await editor(page).locator("p").click();
  await page.keyboard.press(lineStart);
  await page.keyboard.type("Look: ");
  await page.keyboard.press(lineEnd);
  await page.keyboard.type(" jumps");
  await expect(editor(page).locator(".comment-highlight")).toHaveText("brown");
  await waitUntilSaved(page);

  await page.reload();
  await expect(editor(page)).toHaveText("Look: The quick brown fox jumps");
  await expect(editor(page).locator(".comment-highlight")).toHaveText("brown");
  await expect(card(page, "brown")).toContainText("Which shade of brown?");
  await expect(card(page, "brown")).toContainText("You");
  await expect(card(page, "brown").locator("time")).toHaveText(/^\d{2}:\d{2} Today$/);
  await expect(page.getByRole("button", { name: "Show all comments (1 open)" })).toBeVisible();
});

test("adding a comment shows its card beside the line and shifts the page left", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createDocument(page);
  const sheet = page.locator(".page").first();
  const centred = (await box(sheet)).x;
  await typeAndSelect(page, "Some text to comment on", "comment");
  await addComment(page, "Beside its line");

  const thread = card(page, "comment");
  await expectBeside(thread, editor(page).locator(".comment-highlight"));
  const shifted = (await box(sheet)).x;
  expect(shifted).toBeLessThan(centred - 150);
  // The card sits right of the page, and the ruler follows the page.
  expect((await box(thread)).x).toBeGreaterThan(shifted + (await box(sheet)).width);
  await expect.poll(async () => (await box(page.locator(".horizontal-ruler"))).x).toBeCloseTo(shifted, 0);
  await expect(thread).toHaveCSS("width", "389px");
});

test("cards sit beside lines far apart and stack with an 8px gap on the same line", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "alpha beta gamma", "alpha");
  await addComment(page, "On alpha");
  await editor(page).press(lineEnd);
  await selectionSynced(page);
  for (let line = 0; line < 30; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("far below");
  await selectBack(page, "far below", "below");
  await addComment(page, "On below");

  const highlights = editor(page).locator(".comment-highlight");
  await expectBeside(card(page, "alpha"), highlights.filter({ hasText: "alpha" }));
  await expectBeside(card(page, "below"), highlights.filter({ hasText: "below" }));

  // A second comment on the first line: the active (new) card stays at its line, the other moves up.
  await editor(page).focus();
  await page.keyboard.press(`${mod}+ArrowUp`);
  await selectionSynced(page);
  await page.keyboard.press(lineEnd);
  await selectionSynced(page);
  await selectBack(page, "alpha beta gamma", "gamma");
  await addComment(page, "On gamma");
  await expectBeside(card(page, "gamma"), highlights.filter({ hasText: "gamma" }));
  await expect
    .poll(async () => {
      const upper = await box(card(page, "alpha"));
      return Math.round((await box(card(page, "gamma"))).y - (upper.y + upper.height));
    })
    .toBe(8);
});

test("cards follow their lines when the zoom, the text or the window changes", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  for (let line = 0; line < 20; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("moving target");
  await selectBack(page, "moving target", "target");
  await addComment(page, "Follow me");
  const thread = card(page, "target");
  const highlight = editor(page).locator(".comment-highlight");
  await expectBeside(thread, highlight);

  const zoom = page.getByRole("combobox", { name: "Zoom" });
  await zoom.fill("150");
  await zoom.press("Enter");
  await expect(page.locator(".page-stack")).toHaveCSS("zoom", "1.5");
  await expectBeside(thread, highlight);

  // Lines added above push the text, and its card, down.
  await editor(page).focus();
  await page.keyboard.press(`${mod}+ArrowUp`);
  await selectionSynced(page);
  const before = (await box(highlight)).y;
  for (let line = 0; line < 5; line++) await page.keyboard.press("Enter");
  await expect(highlight).toHaveText("target");
  await expect.poll(async () => (await box(highlight)).y).toBeGreaterThan(before + 50);
  await expectBeside(thread, highlight);

  await page.setViewportSize({ width: 1000, height: 700 });
  await expectBeside(thread, highlight);
});

test("active and idle cards, and the colours of commented text", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "one two three", "one");
  await addComment(page, "First");
  await editor(page).press(lineEnd);
  await selectionSynced(page);
  await selectBack(page, "one two three", "three");
  await addComment(page, "Second");

  const first = card(page, "one");
  const second = card(page, "three");
  const highlightOf = (word: string) => editor(page).locator(".comment-highlight", { hasText: word });
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(second).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await css(second, "box-shadow")).not.toBe("none");
  await expect(second).toHaveCSS("border-radius", "12px");
  await expect(second.getByRole("button", { name: "Mark as resolved and hide discussion" })).toHaveCSS("color", "rgb(11, 87, 208)");
  await expect(second.getByRole("textbox", { name: "Reply" })).toBeVisible();
  await expect(first).toHaveCSS("background-color", "rgb(241, 244, 248)");
  await expect(first).toHaveCSS("box-shadow", "none");
  await expect(first).toHaveCSS("padding", "12px");
  await expect(first.getByRole("button", { name: "More options" })).toHaveCount(0);
  await expect(highlightOf("three")).toHaveCSS("background-color", "rgb(242, 191, 66)");
  await expect(highlightOf("one")).toHaveCSS("background-color", "rgb(252, 242, 209)");

  // Clicking commented text activates its thread, clicking a card too, clicking elsewhere neither.
  await highlightOf("one").click();
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(highlightOf("one")).toHaveCSS("background-color", "rgb(242, 191, 66)");
  await expect(second).toHaveCSS("box-shadow", "none");
  await second.click();
  await expect(second).toHaveAttribute("aria-current", "true");
  await editor(page).getByText("two").click();
  await expect(margin(page).locator("[aria-current]")).toHaveCount(0);
  await expect(highlightOf("three")).toHaveCSS("background-color", "rgb(252, 242, 209)");
});

test("replies, resolving and reopening from All comments", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "Ship it on Friday", "Friday");
  await addComment(page, "Too soon?");
  const thread = card(page, "Friday");

  const reply = thread.getByRole("textbox", { name: "Reply" });
  await expect(thread.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0); // until something is typed
  await reply.fill("Agreed, Monday");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread.locator(".comment-body")).toHaveText(["Too soon?", "Agreed, Monday"]);

  await thread.getByRole("button", { name: "Mark as resolved and hide discussion" }).click();
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show all comments (0 open)" })).toBeVisible();
  await expect(thread).toBeHidden();

  await page.getByRole("button", { name: "Show all comments (0 open)" }).click();
  const panel = allComments(page);
  await expect(panel.getByRole("heading", { name: "All comments" })).toBeVisible();
  await expect(panel.getByRole("article")).toHaveCount(0); // the filter starts at Open
  await panel.getByRole("button", { name: "Filter comments" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Resolved" }).click();
  const resolved = panel.getByRole("article", { name: 'Comment on "Friday"' });
  await expect(resolved).toContainText("Too soon?");
  await expect(resolved).toContainText("1 reply");
  await resolved.getByRole("button", { name: "Reopen" }).click();
  await expect(editor(page).locator(".comment-highlight")).toHaveText("Friday");
  await expect(resolved).toBeHidden();
  await expect(thread).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all comments (1 open)" })).toBeVisible();
});

test("All comments lists threads in document order and activates the clicked one", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "first second", "second");
  await addComment(page, "On second");
  await editor(page).press(lineEnd);
  await selectionSynced(page);
  for (let line = 0; line < 50; line++) await page.keyboard.press("Enter");
  await page.keyboard.type("last");
  await selectBack(page, "last", "last");
  await addComment(page, "On last");
  await editor(page).getByText("first").click();
  await page.keyboard.press(`${mod}+Alt+Shift+a`);

  const panel = allComments(page);
  await expect(panel).toHaveCSS("width", "360px");
  await expect(panel.getByRole("article")).toHaveText([/second.*On second/, /last.*On last/]);
  await expect(panel.getByRole("article").first().locator(".all-comments-quote")).toHaveCSS(
    "border-left-color",
    "rgb(242, 191, 66)",
  );
  await panel.getByRole("article", { name: 'Comment on "last"' }).click();
  await expect(card(page, "last")).toHaveAttribute("aria-current", "true");
  await expect(editor(page).locator(".comment-highlight", { hasText: "last" })).toBeInViewport();
  await expect(panel).toBeVisible(); // clicking a card closes nothing

  await panel.getByRole("button", { name: "Close all comments" }).click();
  await expect(panel).toBeHidden();
});

test("editing a comment and a reply persists after reload, and replies can be deleted", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "edit me please", "me");
  await addComment(page, "Original text");
  const thread = card(page, "me");
  await reply(thread, "A reply");
  await reply(thread, "Another reply");
  await expect(thread.locator(".comment-body")).toHaveCount(3);

  await thread.getByRole("button", { name: "More options", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Delete", "Get link to this comment"]);
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const field = thread.getByLabel("Edit comment");
  await expect(field).toHaveValue("Original text");
  await expect(field).toBeFocused();
  await field.fill("Edited text\nwith a second line");
  await thread.getByRole("button", { name: "Save" }).click();
  await expect(thread.locator(".comment-body").first()).toHaveText("Edited text\nwith a second line");

  // A reply's own menu shows on hover.
  const firstReply = thread.locator(".comment-message.is-reply").first();
  await firstReply.hover();
  await firstReply.getByRole("button", { name: "More options for this reply" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await thread.getByLabel("Edit comment").fill("An edited reply");
  await thread.getByLabel("Edit comment").press(`${mod}+Enter`);
  await expect(thread.locator(".comment-body")).toHaveText(["Edited text\nwith a second line", "An edited reply", "Another reply"]);

  const lastReply = thread.locator(".comment-message.is-reply").last();
  await lastReply.hover();
  await lastReply.getByRole("button", { name: "More options for this reply" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(thread.locator(".comment-body")).toHaveCount(2);

  await page.reload();
  await expect(card(page, "me").locator(".comment-body")).toHaveText(["Edited text\nwith a second line", "An edited reply"]);
});

test("deleting the commented text keeps the thread as deleted content", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "keep remove keep", "remove");
  await addComment(page, "Should this go?");

  await editor(page).locator(".comment-highlight").click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type("all new text");
  await waitUntilSaved(page);
  await page.reload();

  const thread = card(page, "remove");
  await expect(thread).toContainText("Original content deleted");
  await expect(thread.locator(".comment-deleted s")).toHaveText("remove");
  await expect(thread.locator(".comment-deleted span")).toHaveCSS("font-style", "italic");
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);
  // It stays where the text was: at the first line.
  await expect.poll(async () => Math.abs((await box(thread)).y - (await box(editor(page).locator("p"))).y)).toBeLessThan(4);
});

test("the draft card: shortcut, empty field, Escape and ⌘Enter; deleting a thread", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "one two", "two");
  await page.keyboard.press(`${mod}+Alt+m`);
  const draft = margin(page).getByRole("article", { name: "New comment" });
  await expect(draft).toContainText("You");
  await expect(draft.locator(".comment-avatar")).toHaveText("Y");
  await expect(draft.locator(".comment-avatar")).toHaveCSS("width", "32px");
  const field = draft.getByLabel("Comment", { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("placeholder", "Comment");
  await expect(field).toHaveCSS("border-radius", "20px");
  await expect(draft.getByRole("button", { name: "Comment", exact: true })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(editor(page).locator(".comment-highlight")).toHaveCSS("background-color", "rgb(242, 191, 66)");

  await field.press("Escape");
  await expect(draft).toBeHidden();
  await expect(margin(page)).toBeHidden(); // nothing left to show
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);

  await page.getByRole("button", { name: "Add comment (⌘+Option+M)" }).click();
  await field.fill("Via shortcut");
  await field.press(`${mod}+Enter`);
  const thread = card(page, "two");
  await expect(thread).toContainText("Via shortcut");

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe("Delete this comment thread?");
    void dialog.accept();
  });
  await thread.getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(thread).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show all comments (0 open)" })).toBeVisible();
});

test("selecting text shows the floating Add comment pill", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "Pick a word here", "word");
  const actions = pill(page);
  await expect(actions.getByRole("button", { name: "Add comment" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Add emoji reaction" })).toBeVisible();

  // Just right of the end of the selection, below its line.
  const selection = await page.evaluate(() => {
    const rect = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { right: rect.right, bottom: rect.bottom };
  });
  const position = await box(actions);
  expect(position.x).toBeGreaterThanOrEqual(selection.right);
  expect(position.x).toBeLessThan(selection.right + 16);
  expect(position.y).toBeGreaterThanOrEqual(selection.bottom);
  expect(position.y).toBeLessThan(selection.bottom + 16);

  // Typing replaces the selection and hides the pill; a new selection shows it again.
  await page.keyboard.type("x");
  await expect(actions).toBeHidden();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(actions).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(actions).toBeHidden();
});

test("Get link copies a link that opens the document with the thread active", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createDocument(page);
  await typeAndSelect(page, "linked text", "linked");
  await addComment(page, "Share me");
  await editor(page).getByText("text").click();
  await card(page, "linked").click();
  await card(page, "linked").getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Get link to this comment" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied to clipboard" })).toBeVisible();

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/d\/[\w-]+\?comment=\d+$/);
  await page.goto(link);
  await expect(card(page, "linked")).toHaveAttribute("aria-current", "true");
  await expect(editor(page).locator(".comment-highlight")).toHaveCSS("background-color", "rgb(242, 191, 66)");
});

test("View > Comments > Hide comments hides the margin and the highlights, and is remembered", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "hidden comment", "hidden");
  await addComment(page, "Now you see me");

  await chooseCommentsMenu(page, "Hide comments");
  await expect(margin(page)).toBeHidden();
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);
  await page.reload();
  await expect(editor(page)).toHaveText("hidden comment");
  await expect(margin(page)).toBeHidden();
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);

  await page.keyboard.press(`${mod}+Alt+Shift+j`);
  await expect(card(page, "hidden")).toBeVisible();
  await expect(editor(page).locator(".comment-highlight")).toHaveText("hidden");
});
