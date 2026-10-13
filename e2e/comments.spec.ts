import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, lineEnd, lineStart, mod, waitUntilSaved } from "./helpers.ts";

/** Types `text`, then selects `word` (its last occurrence) with the keyboard. */
async function typeAndSelect(page: Page, text: string, word: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.type(text);
  const end = text.indexOf(word) + word.length;
  for (let i = 0; i < text.length - end; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < word.length; i++) await page.keyboard.press("Shift+ArrowLeft");
  // The editor reads the browser selection asynchronously; wait until it has caught up.
  await page.waitForFunction((expected) => {
    const view = (document.querySelector(".ProseMirror") as HTMLElement & { editor?: any }).editor;
    const { from, to } = view.state.selection;
    return view.state.doc.textBetween(from, to) === expected;
  }, word);
}

function panel(page: Page) {
  return page.getByRole("complementary", { name: "Comments" });
}

async function addComment(page: Page, body: string): Promise<void> {
  await page.getByRole("button", { name: /Add comment/ }).click();
  await panel(page).getByLabel("Comment", { exact: true }).fill(body);
  await panel(page).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel(page).getByText(body)).toBeVisible();
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
  await expect(panel(page).getByRole("article", { name: 'Comment on "brown"' })).toContainText("Which shade of brown?");
  await expect(page.getByRole("button", { name: "Show all comments (1 open)" })).toBeVisible();
});

test("replies, resolving and reopening a thread", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "Ship it on Friday", "Friday");
  await addComment(page, "Too soon?");
  const thread = panel(page).getByRole("article", { name: 'Comment on "Friday"' });

  await thread.getByLabel("Reply").fill("Agreed, Monday");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread.locator(".comment-body")).toHaveText(["Too soon?", "Agreed, Monday"]);

  await thread.getByRole("button", { name: /Mark as resolved/ }).click();
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show all comments (0 open)" })).toBeVisible();
  await expect(thread).toBeHidden();

  await panel(page).getByLabel("Show resolved (1)").check();
  await thread.getByRole("button", { name: "Reopen" }).click();
  await expect(editor(page).locator(".comment-highlight")).toHaveText("Friday");
});

test("clicking commented text opens its thread", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "alpha beta gamma", "beta");
  await addComment(page, "On beta");
  await page.getByRole("button", { name: "Close comments" }).click();
  await expect(panel(page)).toBeHidden();

  await editor(page).locator(".comment-highlight").click();
  await expect(panel(page).getByRole("article", { name: 'Comment on "beta"' })).toHaveAttribute("aria-current", "true");
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

  const thread = panel(page).getByRole("article", { name: 'Comment on "remove"' });
  await expect(thread).toContainText("Original content deleted");
  await expect(editor(page).locator(".comment-highlight")).toHaveCount(0);
});

test("comments are added with the keyboard shortcut and deleted", async ({ page }) => {
  await createDocument(page);
  await typeAndSelect(page, "one two", "two");
  await page.keyboard.press(`${mod}+Alt+m`);
  await panel(page).getByLabel("Comment", { exact: true }).fill("Via shortcut");
  await panel(page).getByLabel("Comment", { exact: true }).press(`${mod}+Enter`);
  const thread = panel(page).getByRole("article", { name: 'Comment on "two"' });
  await expect(thread).toContainText("Via shortcut");

  page.once("dialog", (dialog) => dialog.accept());
  await thread.getByRole("button", { name: "Delete comment thread" }).click();
  await expect(thread).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show all comments (0 open)" })).toBeVisible();
});
