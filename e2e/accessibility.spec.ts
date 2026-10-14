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
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeHidden();

  // A menu bar menu.
  await menuBarItem(page, "Format").click();
  await expect(page.getByRole("menu", { name: "Format" })).toBeVisible();
  await expectAccessible(page, "Format menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page.getByRole("complementary", { name: "Version history" }).getByRole("listitem").first()).toBeVisible();
  await expectAccessible(page, "Version history");
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
