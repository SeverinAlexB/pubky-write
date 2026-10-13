import { expect, test } from "@playwright/test";
import { createDocument, editor, mod, waitUntilSaved } from "./helpers.ts";

test("font, font size, line spacing and indent are kept", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();

  await page.getByLabel("Font", { exact: true }).selectOption("Georgia");
  await page.getByLabel("Font size", { exact: true }).fill("18");
  await page.getByLabel("Font size", { exact: true }).press("Enter");
  await editor(page).click();
  await page.keyboard.type("Large serif text");
  await page.keyboard.press(`${mod}+Shift+.`); // next size up from 18 is 24
  await page.keyboard.type("!");
  await page.getByRole("button", { name: "Line & paragraph spacing" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Double" }).click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await waitUntilSaved(page);

  await page.reload();
  const paragraph = editor(page).locator("p").first();
  await expect(paragraph).toHaveCSS("line-height", /px$/);
  await expect(paragraph).toHaveAttribute("style", /line-height: 2/);
  await expect(paragraph).toHaveAttribute("style", /margin-left: 96px/);
  await expect(paragraph.locator("span").first()).toHaveAttribute("style", /font-family: Georgia; font-size: 18pt/);
  await expect(paragraph.locator("span").last()).toHaveAttribute("style", /font-size: 24pt/);

  await paragraph.click();
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("Georgia");
});

test("Tab nests list items instead of indenting the paragraph", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+Shift+8`);
  await page.keyboard.type("Parent");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Child");
  await expect(editor(page).locator("ul ul li")).toHaveText("Child");
});

test("find and replace highlights matches and replaces them", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("red fish, blue fish, Red fish");

  await page.keyboard.press(`${mod}+f`);
  const find = page.getByRole("search", { name: "Find in document" });
  await find.getByLabel("Find in document").fill("red");
  await expect(find.getByText("1 of 2")).toBeVisible();
  await expect(editor(page).locator(".search-match")).toHaveCount(2);

  await find.getByLabel("Match case").check();
  await expect(find.getByText("1 of 1")).toBeVisible();
  await find.getByLabel("Match case").uncheck();

  await page.keyboard.press(`${mod}+Shift+h`);
  await find.getByLabel("Replace with").fill("green");
  await find.getByRole("button", { name: "Replace all" }).click();
  await expect(editor(page)).toHaveText("green fish, blue fish, green fish");
  await expect(find.getByText("0 of 0")).toBeVisible();

  await find.getByLabel("Find in document").press("Escape");
  await expect(find).toBeHidden();
  await expect(editor(page).locator(".search-match")).toHaveCount(0);
  await waitUntilSaved(page);
});

test("the outline lists headings and jumps to them", async ({ page }) => {
  await createDocument(page);
  const outline = page.getByRole("complementary", { name: "Document outline" });
  await expect(outline).toContainText("Headings that you add to the document will appear here.");

  await editor(page).click();
  await page.keyboard.press(`${mod}+Alt+1`);
  await page.keyboard.type("Introduction");
  await page.keyboard.press("Enter");
  for (let line = 0; line < 60; line++) await page.keyboard.press("Enter");
  await page.keyboard.press(`${mod}+Alt+2`);
  await page.keyboard.type("Details");

  await expect(outline.getByRole("list").getByRole("button")).toHaveText(["Introduction", "Details"]);
  await expect(outline.getByRole("button", { name: "Details" })).toHaveAttribute("aria-current", "location");

  await outline.getByRole("button", { name: "Introduction" }).click();
  await expect(outline.getByRole("button", { name: "Introduction" })).toHaveAttribute("aria-current", "location");
  await expect(editor(page).locator("h1")).toBeInViewport();

  await page.getByRole("button", { name: "Close outline" }).click();
  await page.reload();
  await expect(outline).toBeHidden(); // the choice is remembered
  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show outline" }).click();
  await expect(outline).toBeVisible();
});

test("word count shows totals and the selection", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("One two three four");

  await page.keyboard.press(`${mod}+Shift+c`);
  const dialog = page.getByRole("dialog", { name: "Word count" });
  await expect(dialog.getByRole("row", { name: /Words/ })).toContainText("4");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(editor(page)).toBeFocused();

  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: "Word count" }).click();
  await expect(dialog.getByRole("row", { name: /^Words/ })).toContainText("1 of 4");
});
