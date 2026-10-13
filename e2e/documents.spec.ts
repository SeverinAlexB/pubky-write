import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { chooseDownload, chooseStyle, createDocument, editor, mod, waitUntilSaved } from "./helpers.ts";

test("typing is saved and survives a reload", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Hello from the editor");
  await expect(page.getByRole("status")).toHaveAttribute("title", "Saving…");
  await waitUntilSaved(page);

  await page.reload();
  await expect(editor(page)).toHaveText("Hello from the editor");
});

test("formatting from the toolbar and keyboard is kept", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();

  await chooseStyle(page, "Heading 1");
  await page.keyboard.type("Plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some ");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("bold");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Bulleted list \(/ }).click();
  await page.keyboard.type("First");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  await waitUntilSaved(page);

  await page.reload();
  await expect(editor(page).locator("h1")).toHaveText("Plan");
  await expect(editor(page).locator("strong")).toHaveText("bold");
  await expect(editor(page).locator("ul > li")).toHaveText(["First", "Second"]);
});

test("documents can be renamed, searched and deleted from the list", async ({ page }) => {
  await createDocument(page);
  const title = page.getByLabel("Rename");
  await title.fill("Quarterly report");
  await title.press("Enter");
  await editor(page).click();
  await page.keyboard.type("Revenue grew");
  await waitUntilSaved(page);
  await expect(page).toHaveTitle("Quarterly report - Docs");

  await page.getByLabel("Docs home").click();
  await page.getByLabel("Search documents").fill("revenue");
  await expect(page.getByRole("list", { name: "Documents" }).getByRole("link")).toHaveText([/Quarterly report/]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "More actions for Quarterly report" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(page.getByText('No documents match "revenue".')).toBeVisible();
});

test("an earlier version can be previewed and restored from version history", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First draft");
  await waitUntilSaved(page);
  await page.waitForTimeout(1500); // longer than the e2e server's session gap
  await page.keyboard.type(" and second draft");
  await waitUntilSaved(page);

  await page.getByRole("button", { name: "Version history" }).click();
  const revisions = page.getByRole("complementary", { name: "Version history" }).getByRole("listitem");
  await expect(revisions).toHaveCount(2);
  await expect(revisions.first()).toContainText("Current version");

  await revisions.nth(1).getByRole("button").first().click();
  await expect(page.getByLabel("Version preview")).toHaveText("First draft");
  await revisions.nth(1).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Restore this version" }).click();
  await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore" }).click();

  await expect(editor(page)).toHaveText("First draft");
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(revisions).toHaveCount(3);
  await expect(revisions.first()).toContainText("Restored version");
});

test("exports Markdown and Word files", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await chooseStyle(page, "Heading 2");
  await page.keyboard.type("Export me");
  await waitUntilSaved(page);

  const markdownDownload = page.waitForEvent("download");
  await chooseDownload(page, "Markdown (.md)");
  const markdown = await markdownDownload;
  expect(markdown.suggestedFilename()).toBe("Untitled document.md");
  expect(await readFile(await markdown.path(), "utf8")).toBe("## Export me\n");

  const wordDownload = page.waitForEvent("download");
  await chooseDownload(page, "Microsoft Word (.docx)");
  const word = await wordDownload;
  expect(word.suggestedFilename()).toBe("Untitled document.docx");
  expect((await readFile(await word.path())).subarray(0, 2).toString()).toBe("PK");
});
