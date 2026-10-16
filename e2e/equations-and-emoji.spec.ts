// Acceptance criteria of docs/spec/20-equations-and-emoji.md: equations and the equation toolbar,
// the emoji picker, the colon picker and comment reactions.
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import {
  allowClipboard,
  chooseDownload,
  createDocument as createBlankDocument,
  editor,
  focusEditor,
  lineStart,
  menuBarItem,
  mod,
  selectionSynced,
  waitUntilSaved,
} from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** A new document with the cursor in it, ready for typing (Firefox can lose keys typed sooner). */
async function createDocument(page: Page) {
  await createBlankDocument(page);
  await focusEditor(page);
  await selectionSynced(page);
}

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

async function insertSymbol(page: Page, item: "Equation" | "Emoji") {
  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Symbols" }).hover();
  await menu(page, "Symbols").getByRole("menuitem", { name: item }).click();
}

function equationToolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Equation" });
}

function equations(page: Page) {
  return editor(page).locator(".equation");
}

/** The LaTeX of each equation in the document. */
function latexOf(page: Page): Promise<string[]> {
  return equations(page).evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.latex ?? ""));
}

/** Inserts an equation at the cursor and waits until the cursor is in it. */
async function newEquation(page: Page) {
  await insertSymbol(page, "Equation");
  await expect(editor(page).locator(".equation.is-editing")).toHaveCount(1);
}

test.describe("equations", () => {
  test("Insert > Symbols > Equation shows the toolbar; x^2, \\alpha, \\frac and √x from Maths operations", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("Area ");
    await expect(equationToolbar(page)).toHaveCount(0);
    await newEquation(page);
    const toolbar = equationToolbar(page);
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "New equation" })).toBeVisible();
    for (const name of ["Greek letters", "Miscellaneous operations", "Relations", "Maths operations", "Arrows"]) {
      await expect(toolbar.getByRole("button", { name })).toBeEnabled();
    }
    await expect(toolbar).toHaveCSS("height", "41px");
    await expect(toolbar).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(toolbar).toHaveCSS("border-bottom-color", "rgb(225, 227, 225)");
    // The equation is grey while the cursor is in it, its empty slot a dotted box.
    const equation = equations(page).first();
    await expect(equation).toHaveCSS("background-color", "rgb(241, 243, 244)");
    await expect(equation.locator(".eq-slot")).toHaveCSS("border-top-style", "dotted");

    // x^2: a superscript.
    await page.keyboard.type("x^2");
    await expect(equation.locator("msup")).toHaveCount(1);
    await expect(equation.locator("msup > mi")).toHaveText("x");
    await expect(equation.locator("msup mn")).toHaveText("2");
    await page.keyboard.press("ArrowRight");

    // \alpha and a space: α.
    await page.keyboard.type("+\\alpha ");
    await expect(equation.locator("mi", { hasText: "α" })).toHaveCount(1);
    await expect(equation.locator(".eq-command")).toHaveCount(0);

    // \frac, a, ↓, b: a fraction a/b.
    await page.keyboard.type("+\\frac a");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("b");
    await expect(equation.locator("mfrac")).toHaveCount(1);
    await expect(equation.locator("mfrac > mrow").first()).toHaveText("a");
    await expect(equation.locator("mfrac > mrow").last()).toHaveText("b");
    await page.keyboard.press("ArrowRight");

    // √x from Maths operations: a root with the cursor inside.
    await toolbar.getByRole("button", { name: "Maths operations" }).click();
    const grid = page.getByRole("menu", { name: "Maths operations" });
    await expect(grid.getByRole("menuitem")).toHaveCount(20);
    await grid.getByRole("menuitem", { name: "Square root" }).click();
    await page.keyboard.type("y");
    await expect(equation.locator("msqrt")).toHaveText("y");
    await expect.poll(() => latexOf(page)).toEqual(["x^2+\\alpha+\\frac{a}{b}\\sqrt{y}"]);

    // Symbols from the menus are inserted at the cursor.
    await page.keyboard.press("ArrowRight");
    await toolbar.getByRole("button", { name: "Relations" }).click();
    await page.getByRole("menu", { name: "Relations" }).getByRole("menuitem", { name: "leq" }).click();
    await page.keyboard.type("1");
    await expect.poll(() => latexOf(page)).toEqual(["x^2+\\alpha+\\frac{a}{b}\\sqrt{y}\\leq1"]);

    // → at the end leaves the equation; the menus are disabled outside equations.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" m²");
    await expect(editor(page).locator("p").first()).toContainText("m²");
    await expect(toolbar.getByRole("button", { name: "Greek letters" })).toBeDisabled();
    await expect(editor(page).locator(".equation.is-editing")).toHaveCount(0);
  });

  test("an equation persists after reload and exports to Word as an equation and to Markdown as $…$", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("Energy ");
    await newEquation(page);
    await page.keyboard.type("E=mc^2");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" holds.");
    await waitUntilSaved(page);
    await page.reload();
    await expect(equations(page).locator("math msup")).toHaveCount(1);
    await expect.poll(() => latexOf(page)).toEqual(["E=mc^2"]);
    await expect(editor(page).locator("p").first()).toContainText("holds.");

    let download = page.waitForEvent("download");
    await chooseDownload(page, "Microsoft Word (.docx)");
    const zip = await JSZip.loadAsync(await readFile(await (await download).path()));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<m:oMath>");
    expect(xml).toMatch(/<m:sSup><m:e><m:r>.*<m:t>c<\/m:t><\/m:r><\/m:e><m:sup><m:r>.*<m:t>2<\/m:t>/);

    download = page.waitForEvent("download");
    await chooseDownload(page, "Markdown (.md)");
    expect(await readFile(await (await download).path(), "utf8")).toBe("Energy $E=mc^2$ holds.\n");
  });

  test("Backspace at the start leaves the equation, an empty equation goes, and undo and redo restore it", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("A");
    await newEquation(page);
    // Left empty: it disappears when the cursor leaves it.
    await page.keyboard.press("Escape");
    await expect(equations(page)).toHaveCount(0);

    await newEquation(page);
    await page.keyboard.type("ab");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Z");
    await expect(editor(page).locator("p").first()).toHaveText(/^AZ/);
    await expect.poll(() => latexOf(page)).toEqual(["ab"]);

    // Click between a and b: the cursor goes there.
    const b = equations(page).locator("mi", { hasText: "b" });
    const box = (await b.boundingBox())!;
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    await expect(editor(page).locator(".equation.is-editing")).toHaveCount(1);
    await page.keyboard.type("+");
    await expect.poll(() => latexOf(page)).toEqual(["a+b"]);

    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await latexOf(page)).join()).not.toBe("a+b");
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(() => latexOf(page)).toEqual(["a+b"]);
  });

  test("copy and paste between documents keeps the equation", async ({ page, context, browserName }) => {
    await allowClipboard(context, browserName);
    await createDocument(page);
    await page.keyboard.type("Copy ");
    await newEquation(page);
    await page.keyboard.type("\\sqrt 2");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" me");
    await focusEditor(page);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press(`${mod}+c`);
    await waitUntilSaved(page);

    await createDocument(page);
    await focusEditor(page);
    await page.keyboard.press(`${mod}+v`);
    await expect(equations(page).locator("msqrt")).toHaveText("2");
    await expect.poll(() => latexOf(page)).toEqual(["\\sqrt{2}"]);
  });

  test("inserting an equation in Suggesting mode is an Add: Equation suggestion", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("Suggested ");
    await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Editing mode" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Suggesting" }).click();
    await expect(editor(page)).toBeFocused();
    await newEquation(page);
    await page.keyboard.type("x_1");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const card = page.locator(".suggestion-card", { hasText: "Add: Equation" });
    await expect(card).toBeVisible();
    await expect.poll(() => latexOf(page)).toEqual(["x_1"]);
    await card.click();
    await card.getByRole("button", { name: "Reject suggestion" }).click();
    await expect(equations(page)).toHaveCount(0);
  });

  test("changing an equation in Suggesting mode is a Replace suggestion; rejecting brings back the old one", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("E ");
    await newEquation(page);
    await page.keyboard.type("x");
    await page.keyboard.press("Escape");
    await page.keyboard.type(" end");
    await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Editing mode" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Suggesting" }).click();
    await expect(editor(page)).toBeFocused();
    const box = (await equations(page).first().boundingBox())!;
    await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
    await expect(editor(page).locator(".equation.is-editing")).toHaveCount(1);
    await page.keyboard.type("+1");
    await page.keyboard.press("Escape");
    await expect.poll(() => latexOf(page)).toEqual(["x", "x+1"]);
    const card = page.locator(".suggestion-card", { hasText: "Replace: Equation with Equation" });
    await expect(card).toBeVisible();
    await expect(editor(page).locator(".suggestion-delete .equation")).toHaveCount(1);
    await card.click();
    await card.getByRole("button", { name: "Reject suggestion" }).click();
    await expect.poll(() => latexOf(page)).toEqual(["x"]);
  });

  test("version history shows equations as maths", async ({ page }) => {
    await createDocument(page);
    await newEquation(page);
    await page.keyboard.type("\\pi r^2");
    await page.keyboard.press("Escape");
    await waitUntilSaved(page);
    await page.getByRole("button", { name: "Version history" }).click();
    await expect(page.getByLabel("Version preview").locator(".equation math msup")).toHaveCount(1);
  });

  test("View > Show equation toolbar hides and shows the toolbar, and the setting persists", async ({ page }) => {
    await createDocument(page);
    await newEquation(page);
    await page.keyboard.press("Escape");
    await expect(equationToolbar(page)).toBeVisible();
    await equationToolbar(page).getByRole("button", { name: "Hide equation toolbar" }).click();
    await expect(equationToolbar(page)).toHaveCount(0);
    await menuBarItem(page, "View").click();
    await expect(menu(page, "View").getByRole("menuitemcheckbox", { name: "Show equation toolbar" })).toHaveAttribute("aria-checked", "false");
    await menu(page, "View").getByRole("menuitemcheckbox", { name: "Show equation toolbar" }).click();
    await expect(equationToolbar(page)).toBeVisible();
    await page.reload();
    await expect(equationToolbar(page)).toBeVisible();
    // New equation inserts one at the cursor.
    await editor(page).click();
    await equationToolbar(page).getByRole("button", { name: "New equation" }).click();
    await expect(editor(page).locator(".equation.is-editing")).toHaveCount(1);
  });
});

test.describe("emoji", () => {
  function picker(page: Page, name = "Insert emoji") {
    return page.getByRole("dialog", { name });
  }

  test("Insert > Symbols > Emoji shows the picker with 9 categories; searching thumb shows 👍; choosing inserts it", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("Great ");
    await insertSymbol(page, "Emoji");
    const dialog = picker(page);
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([370, 404]);
    const categories = dialog.getByRole("tab");
    await expect(categories).toHaveCount(9);
    expect(await categories.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")))).toEqual([
      "Smileys and emotions",
      "People",
      "Animals and nature",
      "Food and drink",
      "Travel and places",
      "Activities and events",
      "Objects",
      "Symbols",
      "Flags",
    ]);
    await expect(dialog.getByRole("group", { name: "Browse emoji list" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Smileys and emotions" })).toHaveCSS("text-transform", "uppercase");

    // A category scrolls to its section and is shown as the current one.
    await dialog.getByRole("tab", { name: "Food and drink" }).click();
    await expect(dialog.getByRole("tab", { name: "Food and drink" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("button", { name: "Grapes" })).toBeInViewport();

    await dialog.getByRole("textbox", { name: "Search" }).fill("thumb");
    await expect(dialog.getByRole("button", { name: "Thumbs up" })).toHaveText("👍️");
    await expect(dialog.getByRole("button", { name: "Thumbs down" })).toBeVisible();
    await dialog.getByRole("textbox", { name: "Search" }).fill("zzzz");
    await expect(dialog.getByText("No emoji found")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Search" }).fill("thumb");
    await dialog.getByRole("button", { name: "Thumbs up" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor(page)).toHaveText("Great 👍️");
    await expect(editor(page)).toBeFocused();
  });

  test("the picker works with the keyboard and remembers recently used emoji", async ({ page }) => {
    await createDocument(page);
    await insertSymbol(page, "Emoji");
    const dialog = picker(page);
    await expect(dialog.getByRole("textbox", { name: "Search" })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Grinning face", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("button", { name: "Grinning face", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.locator(".emoji-cell").nth(9)).toBeFocused();
    const chosen = await dialog.locator(".emoji-cell").nth(9).textContent();
    await page.keyboard.press("Enter");
    await expect(editor(page)).toHaveText(chosen!);

    // Escape closes it and returns to the document.
    await insertSymbol(page, "Emoji");
    await expect(picker(page).getByRole("heading", { name: "Recently used" })).toBeVisible();
    await expect(picker(page).getByRole("tab")).toHaveCount(10);
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  });

  test("typing :smi shows a list starting with smiling faces; Enter inserts the first", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("Hello :smi");
    const list = page.getByRole("listbox", { name: "Emoji suggestions" });
    await expect(list).toBeVisible();
    const options = list.getByRole("option");
    await expect(options).toHaveCount(8);
    await expect(options.first()).toContainText("Smiling face");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    const first = (await options.first().locator(".colon-picker-emoji").textContent())!;
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(editor(page)).toHaveText(`Hello ${first}`);

    // ↓ chooses the next one; Escape and a space dismiss the list.
    await page.keyboard.type(" :hear");
    await expect(options.first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await page.keyboard.type("t :sm");
    await expect(list).toBeVisible();
    await page.keyboard.type(" x");
    await expect(list).toHaveCount(0);
    await expect(editor(page)).toHaveText(`Hello ${first} :heart :sm x`);
  });

  test("the colon picker follows its preference", async ({ page }) => {
    await createDocument(page);
    await menuBarItem(page, "Tools").click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    const dialog = page.getByRole("dialog", { name: "Preferences" });
    const option = dialog.getByRole("checkbox", { name: "Insert emoji using the colon character" });
    await expect(option).toBeChecked();
    await option.uncheck();
    await dialog.getByRole("button", { name: "OK" }).click();
    await editor(page).click();
    await page.keyboard.type(":smile");
    await page.waitForTimeout(300);
    await expect(page.getByRole("listbox", { name: "Emoji suggestions" })).toHaveCount(0);
  });
});

test.describe("comment reactions", () => {
  function margin(page: Page) {
    return page.getByRole("complementary", { name: "Comments" });
  }

  async function addComment(page: Page, text: string, body: string): Promise<Locator> {
    await createDocument(page);
    await page.keyboard.type(text);
    await page.keyboard.press(`Shift+${lineStart}`);
    await page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Add comment" }).click();
    await margin(page).getByLabel("Comment", { exact: true }).fill(body);
    await margin(page).getByRole("button", { name: "Comment", exact: true }).click();
    const card = margin(page).getByRole("article", { name: `Comment on "${text}"` });
    await expect(card.locator(".comment-body", { hasText: body })).toBeVisible();
    return card;
  }

  test("adding 😀 to a comment shows a 😀 1 chip that persists after reload; clicking it again removes it", async ({ page }) => {
    const card = await addComment(page, "Reacted text", "Nice work");
    await card.locator(".comment-message").first().hover();
    const add = card.getByRole("button", { name: "Add emoji reaction" });
    await expect(add).toBeVisible();
    await expect(add).toHaveCSS("width", "32px");
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add emoji reaction" });
    await expect(dialog).toBeVisible();
    // Below the button.
    expect((await dialog.boundingBox())!.y).toBeGreaterThan((await add.boundingBox())!.y);
    await dialog.getByRole("button", { name: "Grinning face", exact: true }).click();

    const chip = card.getByRole("button", { name: "😀 1" });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveCSS("height", "24px");
    await expect(chip).toHaveCSS("border-radius", "12px");
    // The user's own reaction: primary container and border.
    await expect(chip).toHaveCSS("background-color", "rgb(211, 227, 253)");
    await expect(chip).toHaveCSS("border-top-color", "rgb(11, 87, 208)");
    await expect(chip).toHaveAttribute("data-tooltip", "You reacted with :grinning_face:");
    await expect(card.locator(".reaction-chip-add")).toBeVisible();

    await page.reload();
    const reloaded = margin(page).getByRole("article", { name: 'Comment on "Reacted text"' });
    // The idle card shows the chip, without the add button.
    await expect(reloaded.locator(".reaction-chip")).toHaveText("😀1");
    await expect(reloaded.locator(".reaction-chip-add")).toHaveCount(0);
    // All comments shows it too.
    await page.getByRole("button", { name: /Show all comments/ }).click();
    await expect(page.getByRole("complementary", { name: "All comments" }).locator(".reaction-chip")).toHaveText("😀1");
    await page.getByRole("complementary", { name: "All comments" }).getByRole("button", { name: "Close" }).click();

    await reloaded.click();
    await reloaded.getByRole("button", { name: "😀 1" }).click();
    await expect(reloaded.locator(".reaction-chip:not(.reaction-chip-add)")).toHaveCount(0);
    await page.reload();
    await expect(margin(page).locator(".reaction-chip")).toHaveCount(0);
  });

  test("Add emoji reaction on selected text starts a comment that is the emoji", async ({ page }) => {
    await createDocument(page);
    await page.keyboard.type("Celebrate this");
    await page.keyboard.press(`Shift+${lineStart}`);
    await page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Add emoji reaction" }).click();
    const dialog = page.getByRole("dialog", { name: "Add emoji reaction" });
    await dialog.getByRole("textbox", { name: "Search" }).fill("party popper");
    await dialog.getByRole("button", { name: "Party popper" }).click();
    await expect(margin(page).getByRole("article", { name: 'Comment on "Celebrate this"' }).locator(".comment-body")).toHaveText("🎉");
  });
});
