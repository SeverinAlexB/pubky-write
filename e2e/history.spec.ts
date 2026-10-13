import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, lineEnd, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

/** Saves what was typed and waits past the e2e server's session gap, so the next edit starts a new version. */
async function endVersion(page: Page): Promise<void> {
  await waitUntilSaved(page);
  await page.waitForTimeout(1500);
}

function panel(page: Page) {
  return page.getByRole("complementary", { name: "Version history" });
}

function versions(page: Page) {
  return panel(page).getByRole("listitem");
}

function preview(page: Page) {
  return page.getByLabel("Version preview");
}

async function openHistory(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(versions(page).first()).toBeVisible();
}

/** Selects the version at `index` (0 is the newest). */
async function selectVersion(page: Page, index: number): Promise<void> {
  await versions(page).nth(index).getByRole("button").first().click();
  await expect(versions(page).nth(index)).toHaveClass(/is-selected/);
}

async function chooseVersionAction(page: Page, index: number, action: string): Promise<void> {
  await versions(page).nth(index).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** Three versions: "First draft", then " and more" appended, then a second paragraph. */
async function createThreeVersions(page: Page): Promise<void> {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First draft");
  await endVersion(page);
  await page.keyboard.type(" and more");
  await endVersion(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second paragraph");
}

test("version history mode replaces the header and toolbar with a top bar and lists versions by day", async ({ page }) => {
  await createThreeVersions(page);
  // Opening history saves pending edits first, so the newest version is what was just typed.
  await openHistory(page);

  await expect(page.getByLabel("Rename")).toBeHidden();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeHidden();
  await expect(editor(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Today, \d\d:\d\d$/);
  const toolbar = page.getByRole("toolbar", { name: "Version history toolbar" });
  await expect(toolbar.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(toolbar.getByRole("combobox", { name: "Zoom" })).toBeVisible();

  await expect(panel(page).getByRole("heading", { name: "Version history" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Show versions" })).toHaveText("All versions");
  await expect(panel(page).getByRole("region", { name: "Today" }).getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(versions(page)).toHaveCount(3);
  await expect(versions(page).first()).toContainText("Current version");
  await expect(versions(page).first()).toContainText("You");
  await expect(versions(page).first()).toHaveClass(/is-selected/);
  await expect(versions(page).nth(1)).not.toContainText("Current version");
  await expect(versions(page).first()).toContainText(/\d{1,2} \w+, \d\d:\d\d/);
  await expect(page.getByRole("checkbox", { name: "Highlight changes" })).toBeChecked();
  await expect(preview(page)).toHaveText("First draft and moreSecond paragraph");
  // The pages look like the editor's.
  await expect(page.locator(".history-mode .page-sheets .page")).toHaveCount(1);
  await expect(preview(page)).toHaveAttribute("contenteditable", "false");

  // The menu item and the shortcut open it too.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Version history" }).hover();
  await page.getByRole("menuitem", { name: "See version history" }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.keyboard.press(`${mod}+Alt+Shift+KeyH`);
  await expect(panel(page)).toBeVisible();
});

test("an older version shows its additions highlighted and the number of edits", async ({ page }) => {
  await createThreeVersions(page);
  await openHistory(page);

  await selectVersion(page, 1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Today, \d\d:\d\d$/);
  await expect(preview(page)).toHaveText("First draft and more");
  await expect(preview(page).locator(".version-added")).toHaveText([" and more"]);
  await expect(page.getByText("Total: 1 edit", { exact: true })).toBeVisible();
  const added = preview(page).locator(".version-added").first();
  await expect(added).toHaveCSS("color", "rgb(82, 164, 154)");
  await expect(added).toHaveCSS("background-color", "rgb(221, 237, 235)");

  // The oldest version is compared with an empty document.
  await selectVersion(page, 2);
  await expect(preview(page).locator(".version-added")).toHaveText(["First draft"]);

  // Without highlighting there are no marks and no count.
  await page.getByRole("checkbox", { name: "Highlight changes" }).uncheck();
  await expect(preview(page)).toHaveText("First draft");
  await expect(preview(page).locator(".version-added")).toHaveCount(0);
  await expect(page.getByText(/^Total:/)).toBeHidden();
  await page.getByRole("checkbox", { name: "Highlight changes" }).check();
  await expect(preview(page).locator(".version-added")).toHaveCount(1);
});

test("removed text is shown struck through in red", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  const ending = " sentence, which stays exactly the same";
  await page.keyboard.type(`Keep this and remove that${ending}`);
  await endVersion(page);
  for (let i = 0; i < ending.length; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < " and remove that".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.press(lineEnd);
  await page.keyboard.type(" now");
  await openHistory(page);

  await expect(page.getByText("Total: 2 edits", { exact: true })).toBeVisible();
  const removed = preview(page).locator(".version-removed");
  await expect(removed).toHaveText(["and remove that "]);
  await expect(removed).toHaveCSS("text-decoration-line", "line-through");
  await expect(removed).toHaveCSS("color", "rgb(197, 34, 31)");
  await expect(preview(page).locator(".version-added")).toHaveText([" now"]);
});

test("Previous edit and Next edit scroll between the highlighted changes", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Opening line");
  for (let i = 1; i <= 60; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Line ${i}`);
  }
  await endVersion(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Added at the end");
  await page.keyboard.press(`${mod}+ArrowUp`);
  await page.keyboard.press(lineEnd);
  await page.keyboard.type(" added at the start");
  await openHistory(page);

  await expect(page.getByText("Total: 2 edits", { exact: true })).toBeVisible();
  const first = preview(page).locator(".version-added", { hasText: "added at the start" });
  const last = preview(page).locator(".version-added", { hasText: "Added at the end" });
  const previous = page.getByRole("button", { name: "Previous edit" });
  const next = page.getByRole("button", { name: "Next edit" });
  await expect(previous).toBeDisabled();

  await next.click();
  await expect(first).toBeInViewport();
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(last).toBeInViewport();
  await expect(first).not.toBeInViewport();
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(first).toBeInViewport();
  await expect(last).not.toBeInViewport();
});

test("restoring a version from its menu returns to editing with that content", async ({ page }) => {
  await createThreeVersions(page);
  await openHistory(page);

  // The current version cannot be restored.
  await versions(page).first().getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Make a copy" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Restore this version" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Cancel keeps history mode and the document.
  await chooseVersionAction(page, 2, "Restore this version");
  const dialog = page.getByRole("dialog", { name: "Restore this version?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel(page)).toBeVisible();

  await chooseVersionAction(page, 2, "Restore this version");
  await dialog.getByRole("button", { name: "Restore" }).click();

  await expect(editor(page)).toHaveText("First draft");
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await page.reload();
  await expect(editor(page)).toHaveText("First draft");

  // The restore is a new version.
  await openHistory(page);
  await expect(versions(page)).toHaveCount(4);
  await expect(versions(page).first()).toContainText("Current version");
  await expect(versions(page).first()).toContainText("Restored version");
});

test("Back returns to editing without changing the document", async ({ page }) => {
  await createThreeVersions(page);
  await openHistory(page);
  await selectVersion(page, 2);
  await expect(preview(page)).toHaveText("First draft");

  await page.getByRole("button", { name: "Back" }).click();

  await expect(panel(page)).toBeHidden();
  await expect(page.getByLabel("Rename")).toBeVisible();
  await expect(editor(page).locator("p")).toHaveText(["First draft and more", "Second paragraph"]);
  // Editing continues where it was.
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("!");
  await expect(editor(page).locator("p")).toHaveText(["First draft and more", "Second paragraph!"]);
  await openHistory(page);
  await expect(versions(page)).toHaveCount(3);
});

test("Make a copy creates a new document from a version", async ({ page }) => {
  await createThreeVersions(page);
  const originalUrl = page.url();
  await openHistory(page);

  await chooseVersionAction(page, 1, "Make a copy");

  await expect(page).not.toHaveURL(originalUrl);
  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(page.getByLabel("Rename")).toHaveValue("Copy of Untitled document");
  await expect(editor(page)).toHaveText("First draft and more");
  await page.goto(originalUrl);
  await expect(editor(page).locator("p")).toHaveText(["First draft and more", "Second paragraph"]);
});

test("versions can be named and filtered to named versions", async ({ page }) => {
  await createThreeVersions(page);
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Version history" }).hover();
  await page.getByRole("menuitem", { name: "Name current version" }).click();
  await page.getByRole("textbox", { name: "Version name" }).fill("Final");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText('Version named "Final"')).toBeVisible();

  await openHistory(page);
  await expect(versions(page).first()).toContainText("Final");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Final");
  await chooseVersionAction(page, 2, "Name this version");
  await page.getByRole("textbox", { name: "Version name" }).fill("Outline");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(versions(page).nth(2)).toContainText("Outline");

  await panel(page).getByRole("button", { name: "Show versions" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Named versions" }).click();
  await expect(versions(page)).toHaveCount(2);
  await expect(versions(page).nth(0)).toContainText("Final");
  await expect(versions(page).nth(1)).toContainText("Outline");
  // Changes are compared with the named version below.
  await selectVersion(page, 0);
  await expect(preview(page).locator(".version-added")).toHaveText([" and more", "Second paragraph"]);
});

test("history mode hides the comment margin and leaves comments unchanged", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Commented words");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await selectionSynced(page);
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const margin = page.getByRole("complementary", { name: "Comments", exact: true });
  await margin.getByLabel("Comment", { exact: true }).fill("A note");
  await margin.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(margin.getByText("A note")).toBeVisible();

  await openHistory(page);
  await expect(margin).toBeHidden();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(margin.getByText("A note")).toBeVisible();
});
