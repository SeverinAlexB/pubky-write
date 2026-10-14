import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, menuBarItem, mod, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Colour contrast failures caused by colours the specification sets, which are kept as
 * specified. Each entry is a class of the elements axe reports.
 */
const specifiedColours = [
  // Text a version added, teal #52a49a on #ddedeb (2.4:1), docs/spec/08-version-history.md.
  ".version-added",
];

/** Selects the first occurrence of `text` in the document. */
async function selectText(page: Page, text: string) {
  await page.evaluate((wanted) => {
    type Editor = {
      state: { doc: { descendants: (visit: (node: { isText: boolean; text?: string }, pos: number) => void) => void } };
      commands: { setTextSelection: (range: { from: number; to: number }) => boolean };
    };
    const editor = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      const index = node.isText ? node.text!.indexOf(wanted) : -1;
      if (from < 0 && index >= 0) from = pos + index;
    });
    editor.commands.setTextSelection({ from, to: from + wanted.length });
  }, text);
}

/** Runs axe (WCAG 2.1 A and AA) and fails on serious or critical violations. */
async function expectAccessible(page: Page, scene: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const problems = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      ...violation,
      nodes: violation.nodes.filter(
        (node) =>
          !(
            violation.id === "color-contrast" &&
            node.target.some((target) => specifiedColours.some((selector) => String(target).includes(selector)))
          ),
      ),
    }))
    .filter((violation) => violation.nodes.length > 0)
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
      .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary?.replace(/\n/g, " ")}`)
      .join("\n")}`);
  expect(problems, `${scene}:\n${problems.join("\n")}`).toEqual([]);
}

test("the document list, editor, dialogs and version history have no serious accessibility violations", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Report");
  await page.keyboard.press(`${mod}+Alt+Digit1`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("The quarterly figures are ready for review.");
  await waitUntilSaved(page);

  await page.goto("/");
  await expect(page.getByRole("list", { name: "Documents" }).getByRole("listitem")).not.toHaveCount(0);
  await expectAccessible(page, "Document list");

  await page.getByRole("list", { name: "Documents" }).getByRole("link").first().click();
  await expect(editor(page)).toBeVisible();
  // A comment on "quarterly", and the outline.
  await editor(page).click();
  await selectText(page, "quarterly");
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const margin = page.getByRole("complementary", { name: "Comments", exact: true });
  await margin.getByLabel("Comment", { exact: true }).fill("Check these numbers");
  await margin.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(margin.locator(".comment-body", { hasText: "Check these numbers" })).toBeVisible();
  await page.getByRole("button", { name: "Show tabs and outlines" }).click();
  await expect(page.getByRole("list", { name: "Outline" })).toBeVisible();
  await expectAccessible(page, "Editor with a comment and the outline");

  await page.keyboard.press(`${mod}+Shift+KeyH`);
  await expect(page.getByRole("dialog", { name: "Find and replace" })).toBeVisible();
  await expectAccessible(page, "Find and replace");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Find and replace" })).toBeHidden();

  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+KeyC`);
  await expect(page.getByRole("dialog", { name: "Word count" })).toBeVisible();
  await expectAccessible(page, "Word count");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Word count" })).toBeHidden();

  await menuBarItem(page, "File").click();
  await page.getByRole("menuitem", { name: "Page setup" }).click();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeVisible();
  await expectAccessible(page, "Page setup");
  await page.getByRole("dialog", { name: "Page setup" }).getByRole("tab", { name: "Pageless" }).click();
  await expectAccessible(page, "Page setup, Pageless tab");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeHidden();

  await menuBarItem(page, "Insert").click();
  await page.getByRole("menuitem", { name: "Symbols" }).hover();
  await page.getByRole("menuitem", { name: "Special characters" }).click();
  const characters = page.getByRole("dialog", { name: "Insert special characters" });
  await expect(characters.locator(".special-character").first()).toBeVisible();
  await characters.locator(".special-character").first().hover();
  await expectAccessible(page, "Insert special characters");
  await page.keyboard.press("Escape");
  await expect(characters).toBeHidden();

  // A menu bar menu.
  await menuBarItem(page, "Format").click();
  await expect(page.getByRole("menu", { name: "Format" })).toBeVisible();
  await expectAccessible(page, "Format menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page.getByRole("complementary", { name: "Version history" }).getByRole("listitem").first()).toBeVisible();
  await expectAccessible(page, "Version history");
});

test("tables, images, their panels and the right-click menu have no serious accessibility violations", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Intro");
  await page.keyboard.press("Enter");
  await menuBarItem(page, "Insert").click();
  await page.getByRole("menu", { name: "Insert" }).getByRole("menuitem", { name: "Table" }).hover();
  await page.getByRole("menuitem", { name: "3 x 2", exact: true }).hover();
  await expectAccessible(page, "Table size picker");
  await page.getByRole("menuitem", { name: "3 x 2", exact: true }).click();
  await page.keyboard.type("Cell");

  await editor(page).locator("td").first().click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Context menu" })).toBeVisible();
  await expectAccessible(page, "Right-click menu in a table");
  await page.getByRole("menu", { name: "Context menu" }).getByRole("menuitem", { name: "Table options" }).click();
  await expect(page.getByRole("complementary", { name: "Table options" })).toBeVisible();
  await expectAccessible(page, "Table options");
  await page.getByRole("button", { name: "Close table options" }).click();
  await editor(page).locator("td").first().click({ button: "right" });
  await page.getByRole("menu", { name: "Context menu" }).getByRole("menuitem", { name: "Split cell" }).click();
  await expect(page.getByRole("dialog", { name: "Split cell" })).toBeVisible();
  await expectAccessible(page, "Split cell");
  await page.getByRole("dialog", { name: "Split cell" }).getByRole("button", { name: "Cancel" }).click();

  await menuBarItem(page, "Format").click();
  await page.getByRole("menu", { name: "Format" }).getByRole("menuitem", { name: "Columns" }).hover();
  await expect(page.getByRole("group", { name: "Columns" })).toBeVisible();
  await expectAccessible(page, "Format > Columns");
  await page.getByRole("group", { name: "Columns" }).getByRole("menuitem", { name: "More options" }).click();
  await expect(page.getByRole("dialog", { name: "Column options" })).toBeVisible();
  await expectAccessible(page, "Column options");
  await page.getByRole("dialog", { name: "Column options" }).getByRole("button", { name: "Cancel" }).click();

  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 60;
    canvas.getContext("2d")!.fillRect(0, 0, 120, 60);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await editor(page).getByText("Intro").click();
  await page
    .locator('input[type="file"][accept^="image"]')
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await editor(page).locator(".image-frame img").click();
  await expect(page.getByRole("toolbar", { name: "Image actions" })).toBeVisible();
  await expectAccessible(page, "Selected image with its pill");
  await page.getByRole("toolbar", { name: "Image actions" }).getByRole("button", { name: "Image options" }).click();
  const panel = page.getByRole("complementary", { name: "Image options" });
  await expect(panel).toBeVisible();
  for (const section of ["Position", "Re-colour", "Adjustments", "Alt text"]) await panel.getByRole("button", { name: section, exact: true }).click();
  await expectAccessible(page, "Image options");

  // Wrap text: the pill's margin and position menus, and the crop handles.
  await editor(page).locator(".image-frame img").click();
  const pill = page.getByRole("toolbar", { name: "Image actions" });
  await pill.getByRole("button", { name: "Wrap text options" }).click();
  await expectAccessible(page, "Wrap text options");
  await page.getByRole("menu", { name: "Wrap text options" }).getByRole("menuitemcheckbox", { name: "Wrap text" }).click();
  await expect(pill.getByRole("button", { name: "Margin" })).toBeVisible();
  await expectAccessible(page, "Image with Wrap text and its pill");
  await editor(page).locator(".image-frame > .image-crop > img").dblclick();
  await expect(editor(page).locator(".image-crop-handle")).toHaveCount(8);
  await expectAccessible(page, "Cropping an image");
  await page.keyboard.press("Escape");
});

test("the document list's views, menus and Open a file dialog have no serious accessibility violations", async ({ page }) => {
  await page.request.post("/api/documents", { data: { template: "report" } });
  await page.goto("/");
  await expect(page.locator(".document-thumbnail .page-preview").first()).toBeVisible();
  await expectAccessible(page, "Grid view with thumbnails");

  await page.getByRole("button", { name: "Sort options" }).click();
  await expect(page.getByRole("menu", { name: "Sort options" })).toBeVisible();
  await expectAccessible(page, "Sort options menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("group", { name: "Documents" })).toBeVisible();
  await expectAccessible(page, "List view");

  await page.getByRole("button", { name: "Open file picker" }).click();
  await expect(page.getByRole("dialog", { name: "Open a file" })).toBeVisible();
  await expectAccessible(page, "Open a file");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Main menu" }).click();
  await expect(page.getByRole("dialog", { name: "Main menu" })).toBeVisible();
  await expectAccessible(page, "Main menu");
});

test("the toolbar and menu bar work with the keyboard", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Hello");

  // Alt+F10 moves into the toolbar; it is one Tab stop and arrow keys move within it,
  // skipping disabled controls (Search the menus is not built yet, Redo has nothing to redo).
  await page.keyboard.press("Alt+F10");
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  const undo = toolbar.getByRole("button", { name: /^Undo/ });
  await expect(undo).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(toolbar.getByRole("button", { name: /^Print/ })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  // Wraps around to the last control.
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", /Hide the menus/);
  await page.keyboard.press("Home");
  await expect(undo).toBeFocused();
  // Enter on a menu button opens its menu; Escape closes it and stays in the toolbar.
  for (let i = 0; i < 30 && (await page.locator(":focus").getAttribute("aria-label")) !== "Insert image"; i++) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Insert image");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Insert image" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Insert image" })).toBeHidden();
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Insert image");
  // Only the current control is in the Tab order.
  expect(await toolbar.locator('[tabindex="0"]').count()).toBe(1);

  // Escape returns to the document, where typing continues.
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(" world");
  await expect(editor(page)).toHaveText("Hello world");

  // Shift+Tab from the toolbar reaches the header and the menu bar.
  await page.keyboard.press("Alt+F10");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(menuBarItem(page, "File")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(menuBarItem(page, "Edit")).toBeFocused();
  await page.keyboard.press("End");
  await expect(menuBarItem(page, "Tools")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(menuBarItem(page, "File")).toBeFocused();

  // ↓ opens the menu with its first item highlighted; → on an item without a submenu moves to the next menu.
  await page.keyboard.press("ArrowDown");
  const fileMenu = page.getByRole("menu", { name: "File" });
  await expect(fileMenu.locator(".is-highlighted")).toHaveText("New");
  await page.keyboard.press("ArrowDown");
  await expect(fileMenu.locator(".is-highlighted")).toContainText("Open");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
  await expect(menuBarItem(page, "Edit")).toBeFocused();
  // Escape closes the menu, a second Escape returns to the document.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Edit" })).toBeHidden();
  await expect(menuBarItem(page, "Edit")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
});

test("the mode menu, suggestions, their cards and the review card have no serious accessibility violations", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Draft text to review");
  await waitUntilSaved(page);
  const modeButton = page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Editing mode" });
  await modeButton.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Suggesting" })).toBeVisible();
  await expectAccessible(page, "Mode menu");
  await page.getByRole("menuitemcheckbox", { name: "Suggesting" }).click();

  await page.keyboard.type(" and more");
  await selectText(page, "Draft");
  await page.keyboard.press("Backspace");
  await selectText(page, "review");
  await page.keyboard.press(`${mod}+b`);
  const margin = page.getByRole("complementary", { name: "Comments", exact: true });
  await expect(margin.locator(".suggestion-card")).toHaveCount(3);
  await editor(page).locator(".suggestion-insert").click();
  await expect(margin.getByRole("button", { name: "Accept suggestion" })).toBeVisible();
  await expectAccessible(page, "Suggestions with an active card");

  await menuBarItem(page, "Tools").click();
  await page.getByRole("menuitem", { name: "Review suggested edits" }).click();
  const review = page.getByRole("dialog", { name: "Suggested edits" });
  await review.getByRole("button", { name: "More accept options" }).click();
  await expect(page.getByRole("menuitem", { name: "Accept all (3)" })).toBeVisible();
  await expectAccessible(page, "Review suggested edits");
  await page.keyboard.press("Escape");

  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Suggesting mode" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Viewing" }).click();
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await expectAccessible(page, "Viewing mode");
});

test("the link bubble, Preferences, Keyboard shortcuts and the offline snackbar have no serious accessibility violations", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Read ");
  await page.keyboard.press(`${mod}+k`);
  await page.getByLabel("Link URL").fill("example.com");
  await page.getByRole("button", { name: "Apply" }).click();
  await editor(page).locator("a").click();
  await expect(page.getByRole("dialog", { name: "Change or remove link." })).toBeVisible();
  await expectAccessible(page, "Link bubble");

  await menuBarItem(page, "Tools").click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  const preferences = page.getByRole("dialog", { name: "Preferences" });
  await expect(preferences).toBeVisible();
  await expectAccessible(page, "Preferences, General tab");
  // The tabs follow the tabs pattern: ← → move between them.
  await preferences.getByRole("tab", { name: "General" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(preferences.getByRole("tab", { name: "Substitutions" })).toBeFocused();
  await expect(preferences.getByRole("tab", { name: "Substitutions" })).toHaveAttribute("aria-selected", "true");
  await expectAccessible(page, "Preferences, Substitutions tab");
  await page.keyboard.press("Escape");
  await expect(preferences).toBeHidden();

  await editor(page).click();
  await page.keyboard.press(`${mod}+Slash`);
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await expectAccessible(page, "Keyboard shortcuts");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeHidden();

  await page.route("**/api/documents/*/steps", (route) => route.abort("internetdisconnected"));
  await editor(page).click();
  await page.keyboard.type(" offline");
  await expect(page.getByRole("status").filter({ hasText: "You're offline." })).toBeVisible();
  await expectAccessible(page, "Offline indicator and snackbar");
});

test("document tabs: the sidebar, the tab menu, the emoji picker and the delete dialog have no serious accessibility violations", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First tab");
  await page.getByRole("button", { name: "Show tabs and outlines" }).click();
  const sidebar = page.getByRole("complementary", { name: "Tabs and outlines" });
  await sidebar.getByRole("button", { name: "Add tab" }).click();
  await page.keyboard.type("Second tab");
  // The ⋮ button shows on hover (and on the current tab).
  const options = (name: string) => ({
    click: async () => {
      const row = sidebar.locator(".outline-tab", { hasText: name });
      await row.hover();
      await row.getByRole("button", { name: "Tab options" }).click();
    },
  });
  await options("Tab 2").click();
  await page.getByRole("menuitem", { name: "Add subtab" }).click();
  await options("Tab 1").click();
  await expect(page.getByRole("menuitem", { name: "Move into" })).toBeVisible();
  await expectAccessible(page, "Tab options menu");
  await page.getByRole("menuitem", { name: "Choose emoji" }).click();
  await expect(page.getByRole("dialog", { name: "Choose emoji" })).toBeVisible();
  await expectAccessible(page, "Choose emoji");
  await page.getByRole("dialog", { name: "Choose emoji" }).getByRole("button", { name: "⭐" }).click();
  await expectAccessible(page, "Tabs with a subtab and an emoji");
  await options("Tab 1").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(sidebar.getByRole("textbox", { name: "Tab name" })).toBeFocused();
  await expectAccessible(page, "Renaming a tab");
  await page.keyboard.press("Escape");
  await options("Tab 1").click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete tab?" })).toBeVisible();
  await expectAccessible(page, "Delete tab?");
  await page.getByRole("dialog", { name: "Delete tab?" }).getByRole("button", { name: "Cancel" }).click();
  await waitUntilSaved(page);
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page.locator(".history-mode").getByRole("complementary", { name: "Tabs and outlines" })).toBeVisible();
  await expectAccessible(page, "Version history with tabs");
});
