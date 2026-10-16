// The document list (docs/spec/10-home.md).
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Document, HeadingLevel, LevelFormat, AlignmentType, FootnoteReferenceRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { editor, mod } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** Creates documents through the API; a unique word in each title lets a search isolate them. */
async function createDocuments(page: Page, titles: string[]): Promise<void> {
  for (const title of titles) {
    const response = await page.request.post("/api/documents", { data: { title } });
    expect(response.ok()).toBe(true);
  }
}

/** Template tiles are named by their name and subtitle; the preview inside is hidden from assistive technology. */
async function expectButtonNames(list: Locator, names: string[]): Promise<void> {
  const buttons = list.getByRole("button");
  await expect(buttons).toHaveCount(names.length);
  for (const [index, name] of names.entries()) await expect(buttons.nth(index)).toHaveAccessibleName(name);
}

/**
 * A search word unique to this browser: the projects of one run (npm run e2e:all) share the server
 * and its data, so documents created by the same test in another browser would match too.
 */
function unique(word: string): string {
  return `${word}${test.info().project.name}`;
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test("the header, template band and grid tiles have the specified sizes at 1440px", async ({ page }) => {
  await createDocuments(page, ["Size 1", "Size 2", "Size 3", "Size 4", "Size 5", "Size 6"]);
  await page.goto("/");
  await expect(page.locator(".document-tile").nth(5)).toBeVisible();

  expect(await box(page, ".home-header")).toMatchObject({ y: 0, height: 64, width: 1440 });
  expect(await box(page, ".home-menu-button")).toMatchObject({ width: 48, height: 48 });
  const search = await box(page, ".search");
  expect(search).toMatchObject({ width: 720, height: 48 });
  expect(search.x + search.width / 2).toBeCloseTo(720, 0);
  expect(await box(page, ".templates-band")).toMatchObject({ y: 64, height: 316 });
  expect(await box(page, ".template-preview")).toMatchObject({ width: 144, height: 186 });
  const templateTiles = page.locator(".template-preview");
  expect((await templateTiles.nth(1).boundingBox())!.x - (await templateTiles.nth(0).boundingBox())!.x).toBe(144 + 18);
  await expectButtonNames(page.getByRole("list", { name: "Templates" }), [
    "Blank document",
    "Letter Formal letter",
    "Resume Classic",
    "Project proposal Overview and milestones",
    "Report Sections and summary",
  ]);

  const tiles = page.locator(".document-tile");
  expect(await tiles.first().boundingBox()).toMatchObject({ width: 210 });
  expect(await box(page, ".document-thumbnail")).toMatchObject({ width: 208, height: 268 });
  const tops = await tiles.evaluateAll((elements) => elements.slice(0, 6).map((element) => element.getBoundingClientRect()));
  // Five tiles per row, 20px apart.
  expect(tops.slice(0, 5).every((rect) => rect.top === tops[0]!.top)).toBe(true);
  expect(tops[5]!.top).toBe(tops[0]!.bottom + 20);
  expect(tops[1]!.left - tops[0]!.right).toBe(20);
});

test("tiles show a thumbnail of the first page, the title and when it was opened", async ({ page }) => {
  await page.request.post("/api/documents", { data: { template: "project-proposal" } });
  await page.goto("/");
  const tile = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /^Project proposal/ }) }).first();
  await expect(tile.locator(".document-thumbnail h1").first()).toHaveText("Overview");
  await expect(tile.locator(".document-thumbnail table")).toBeVisible();
  await expect(tile.getByRole("link")).toContainText(/Opened \d\d:\d\d/);
  // The thumbnail is decoration: its text is not part of the link's name.
  await expect(tile.getByRole("link")).toHaveAccessibleName(/^Project proposal Opened/);
});

test("the view toggle switches between the grid and the list grouped by date, and is remembered", async ({ page }) => {
  const word = unique("Viewtoggle");
  await createDocuments(page, [`${word} alpha`]);
  await page.goto("/");
  await page.getByLabel("Search documents").fill(word);
  await expect(page.getByRole("list", { name: "Documents" }).getByRole("link")).toHaveText([new RegExp(`${word} alpha`)]);

  await page.getByRole("button", { name: "List view" }).click();
  const list = page.getByRole("group", { name: "Documents" });
  await expect(list.getByRole("list", { name: "Today" }).getByRole("link")).toHaveText([new RegExp(`${word} alpha\\s*me\\s*\\d\\d:\\d\\d`)]);
  // The header row names the first group and the columns.
  await expect(page.locator(".recent-header h2")).toHaveText("Today");
  await expect(page.locator(".recent-date-label")).toHaveText("Last opened by me");
  expect((await box(page, ".document-row")).height).toBe(48);

  await page.reload();
  await expect(page.getByRole("group", { name: "Documents" })).toBeVisible();
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.getByRole("list", { name: "Documents" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "List view" })).toBeVisible();
});

test("sort options and the owner filter work and are remembered", async ({ page }) => {
  const word = unique("Sorttest");
  await createDocuments(page, [`${word} banana`, `${word} apple`, `${word} cherry`]);
  await page.goto("/");
  await page.getByLabel("Search documents").fill(word);
  const links = page.getByRole("list", { name: "Documents" }).getByRole("link");
  // Last opened first: the newest document is first.
  await expect(links).toHaveText([/cherry/, /apple/, /banana/]);

  await page.getByRole("button", { name: "Sort options" }).click();
  const menu = page.getByRole("menu", { name: "Sort options" });
  await expect(menu.getByRole("menuitemcheckbox")).toHaveText(["Last opened by me", "Last modified by me", "Last modified", "Title"]);
  await expect(menu.getByRole("menuitemcheckbox", { name: "Last opened by me" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemcheckbox", { name: "Title" }).click();
  await expect(links).toHaveText([/apple/, /banana/, /cherry/]);

  await page.getByRole("button", { name: "Sort options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Last modified", exact: true }).click();
  await expect(links.first()).toContainText("Modified");

  await page.getByRole("button", { name: "Owned by anyone" }).click();
  await expect(page.getByRole("menuitemcheckbox")).toHaveText(["Owned by anyone", "Owned by me"]);
  await page.getByRole("menuitemcheckbox", { name: "Owned by me" }).click();
  await expect(page.getByRole("button", { name: "Owned by me" })).toBeVisible();
  await expect(links).toHaveCount(3);

  await page.reload();
  await page.getByLabel("Search documents").fill(word);
  await expect(page.getByRole("button", { name: "Owned by me" })).toBeVisible();
  await expect(links).toHaveCount(3);
  await page.getByRole("button", { name: "Sort options" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Last modified", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemcheckbox", { name: "Title" })).toHaveAttribute("aria-checked", "false");
});

test("the ⋮ menu renames, removes after confirmation and opens in a new tab", async ({ page, context }) => {
  const word = unique("Tilemenu");
  await createDocuments(page, [`${word} draft`]);
  await page.goto("/");
  await page.getByLabel("Search documents").fill(word);

  await page.getByRole("button", { name: `More actions for ${word} draft` }).click();
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Rename", "Remove", "Open in new tab"]);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Document name").fill(`${word} final`);
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("list", { name: "Documents" }).getByRole("link")).toHaveText([new RegExp(`${word} final`)]);

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: `More actions for ${word} final` }).click();
  await page.getByRole("menuitem", { name: "Open in new tab" }).click();
  const tab = await opened;
  await expect(tab).toHaveURL(/\/d\/[\w-]+$/);
  await tab.close();

  await page.getByRole("button", { name: `More actions for ${word} final` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove document?" });
  await expect(confirm).toContainText(`"${word} final" will be deleted permanently.`);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("list", { name: "Documents" }).getByRole("link")).toHaveCount(1);

  await page.getByRole("button", { name: `More actions for ${word} final` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(`No documents match "${word}".`)).toBeVisible();
});

test("a template creates a new document with its content", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Resume/ }).click();
  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(editor(page).locator('p[data-paragraph-style="title"]')).toHaveText("Your Name");
  await expect(editor(page).locator("h1").first()).toHaveText("Experience");
  await expect(page.getByLabel("Rename")).toHaveValue("Resume");
});

test("the template gallery expands, and templates can be hidden and shown again", async ({ page }) => {
  await page.goto("/");
  const gallery = page.getByRole("button", { name: "Template gallery" });
  await gallery.click();
  await expect(gallery).toHaveAttribute("aria-expanded", "true");
  await expectButtonNames(page.getByRole("list", { name: "Personal" }), ["Letter Formal letter", "Resume Classic"]);
  await expectButtonNames(page.getByRole("list", { name: "Work" }), ["Project proposal Overview and milestones", "Report Sections and summary"]);
  await gallery.click();
  await expect(page.getByRole("list", { name: "Templates" })).toBeVisible();

  await page.getByRole("button", { name: "Template options" }).click();
  await page.getByRole("menuitem", { name: "Hide all templates" }).click();
  await expect(page.getByRole("heading", { name: "Start a new document" })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recent documents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a new document" })).toBeHidden();

  await page.getByRole("button", { name: "Main menu" }).click();
  await page.getByRole("dialog", { name: "Main menu" }).getByLabel("Show templates on the home screen").check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Start a new document" })).toBeVisible();
});

/** A Word file with a title, headings, a list, a table and a footnote. */
async function wordFile(): Promise<Buffer> {
  const cell = (text: string) => new TableCell({ children: [new Paragraph(text)] });
  const file = new Document({
    numbering: {
      config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "●", alignment: AlignmentType.LEFT }] }],
    },
    footnotes: { 1: { children: [new Paragraph("Source")] } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, text: "Launch plan" }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Goals" }),
          new Paragraph({ children: [new TextRun({ text: "Ship it", bold: true }), new FootnoteReferenceRun(1)] }),
          new Paragraph({ text: "Write the docs", numbering: { reference: "bullets", level: 0 } }),
          new Paragraph({ text: "Tell customers", numbering: { reference: "bullets", level: 0 } }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Owners" }),
          new Table({ rows: [new TableRow({ children: [cell("Task"), cell("Owner")] }), new TableRow({ children: [cell("Docs"), cell("Sam")] })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(file);
}

test("uploading a .docx creates a document with the same structure", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open file picker" }).click();
  const dialog = page.getByRole("dialog", { name: "Open a file" });
  await expect(dialog.getByRole("tab", { name: "Upload" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tabpanel")).toContainText("Drag a file here");

  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Browse" }).click();
  await (await chooser).setFiles({
    name: "Launch plan.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await wordFile(),
  });

  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(page.getByLabel("Rename")).toHaveValue("Launch plan");
  await expect(editor(page).locator('p[data-paragraph-style="title"]')).toHaveText("Launch plan");
  await expect(editor(page).locator("h1")).toHaveText("Goals");
  await expect(editor(page).locator("h2")).toHaveText("Owners");
  await expect(editor(page).locator("strong")).toHaveText("Ship it");
  await expect(editor(page).locator("ul > li")).toHaveText(["Write the docs", "Tell customers"]);
  await expect(editor(page).locator("table tr")).toHaveText(["TaskOwner", "DocsSam"]);
  // The footnote is imported too, so nothing was left out.
  await expect(editor(page).locator("sup.footnote-ref")).toHaveCount(1);
  await expect(page.locator(".footnote-area .footnote-text")).toHaveText("Source");
  await expect(page.locator(".snackbar")).toHaveCount(0);
});

test("a real Word file's comments and equations are imported and the document saves", async ({ page }) => {
  const upload = async (path: string, name: string) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open file picker" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("dialog", { name: "Open a file" }).getByRole("button", { name: "Browse" }).click();
    await (await chooser).setFiles({
      name,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await readFile(new URL(`../server/src/import/fixtures/corpus/${path}`, import.meta.url)),
    });
    await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  };
  // A comment with a reply (LibreOffice's test file): one thread in the margin.
  await upload("libreoffice/CommentReply.docx", "Reply.docx");
  const card = page.getByRole("complementary", { name: "Comments", exact: true }).locator(".comment-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Parent");
  await expect(card).toContainText("Child");

  // An equation is kept as linear text, and the notice says so.
  await upload("libreoffice/math-matrix.docx", "Matrix.docx");
  await expect(editor(page)).toContainText("■(1&2@3&4)");
  await expect(page.locator(".snackbar")).toContainText("Equations (kept as text)");
  await editor(page).click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(" and more");
  await expect(page.getByRole("status").first()).toHaveAttribute("title", "Saved");
});

test("dropping a .md file creates a document with the same structure", async ({ page }) => {
  const markdown = "# Notes\n\nSome **bold** text.\n\n- One\n- Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  await page.goto("/");
  await page.getByRole("button", { name: "Open file picker" }).click();
  const zone = page.getByRole("dialog", { name: "Open a file" }).getByRole("tabpanel");
  const dataTransfer = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "Dropped notes.md", { type: "text/markdown" }));
    return transfer;
  }, markdown);
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(zone).toHaveClass(/is-dragging/);
  await zone.dispatchEvent("drop", { dataTransfer });

  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(page.getByLabel("Rename")).toHaveValue("Dropped notes");
  await expect(editor(page).locator("h1")).toHaveText("Notes");
  await expect(editor(page).locator("strong")).toHaveText("bold");
  await expect(editor(page).locator("ul > li")).toHaveText(["One", "Two"]);
  await expect(editor(page).locator("table tr")).toHaveText(["AB", "12"]);
  await expect(page.locator(".snackbar")).toHaveCount(0);
});

test("the file picker refuses other file types", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open file picker" }).click();
  const dialog = page.getByRole("dialog", { name: "Open a file" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "Budget.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(dialog.getByRole("alert")).toHaveText("Choose a Word (.docx) or Markdown (.md) file.");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});
