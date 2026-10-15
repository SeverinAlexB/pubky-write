import { expect, test, type Page } from "@playwright/test";
import { createDocument, dblclickText, editor, menuBarItem, mod, waitUntilSaved } from "./helpers.ts";

/** Shortcut text as the app writes it on this platform (see client/src/components/shortcuts.ts). */
function shortcut(mac: string): string {
  if (process.platform === "darwin") return mac;
  return mac.replace(/⌘\+?/g, "Ctrl+").replace(/Option/g, "Alt");
}
const named = (name: string, mac: string) => `${name} (${shortcut(mac)})`;

function toolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Formatting" });
}

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

async function typeAndSelectAll(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.type(text);
  await page.keyboard.press(`${mod}+a`);
}

test.use({ viewport: { width: 1440, height: 900 } });

test("the window bands have the specified heights", async ({ page }) => {
  await createDocument(page);
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  expect((await box(".editor-header")).height).toBe(58);
  expect(await box(".toolbar")).toMatchObject({ x: 16, y: 65, height: 40, width: 1408 });
  expect(await box(".ruler-band")).toMatchObject({ y: 113, height: 16 });
  expect((await box(".page >> nth=0")).y).toBe(145);
  await expect(page.locator(".page").first()).toHaveCSS("border", "1px solid rgb(196, 199, 197)");
});

test("toolbar controls are in order and named after their tooltips", async ({ page }) => {
  await createDocument(page);
  const names = await toolbar(page)
    .locator("button[aria-label], input[aria-label]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  expect(names).toEqual([
    named("Search the menus", "Option+/"),
    named("Undo", "⌘Z"),
    named("Redo", "⌘Y"),
    named("Print", "⌘P"),
    "Paint format",
    "Zoom",
    "Zoom options",
    "Styles",
    "Font",
    named("Decrease font size", "⌘+Shift+comma"),
    "Font size",
    named("Increase font size", "⌘+Shift+full stop"),
    named("Bold", "⌘B"),
    named("Italic", "⌘I"),
    named("Underline", "⌘U"),
    "Text colour",
    "Highlight colour",
    named("Insert link", "⌘K"),
    named("Add comment", "⌘+Option+M"),
    "Insert image",
    "Align and indent",
    "Line & paragraph spacing",
    named("Checklist", "⌘+Shift+9"),
    "Checklist menu",
    named("Bulleted list", "⌘+Shift+8"),
    "Bulleted list menu",
    named("Numbered list", "⌘+Shift+7"),
    "Numbered list menu",
    named("Decrease indent", "⌘+["),
    named("Increase indent", "⌘+]"),
    named("Clear formatting", "⌘+\\"),
    "Editing mode",
    named("Hide the menus", "⌘+Shift+F"),
  ]);
  await expect(page.getByRole("button", { name: /Strikethrough/ })).toHaveCount(0);

  await toolbar(page).getByRole("button", { name: named("Bold", "⌘B") }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(named("Bold", "⌘B"));
});

test("bold shows as pressed and strikethrough uses ⌘+Shift+X", async ({ page }) => {
  await createDocument(page);
  await typeAndSelectAll(page, "Struck");
  await page.keyboard.press(`${mod}+Shift+x`);
  await expect(editor(page).locator("s")).toHaveText("Struck");
  await page.keyboard.press(`${mod}+Shift+s`);
  await expect(editor(page).locator("s")).toHaveText("Struck");

  const bold = toolbar(page).getByRole("button", { name: named("Bold", "⌘B") });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page).locator("strong")).toHaveText("Struck");
});

test("the colour palettes have the 80 standard swatches", async ({ page }) => {
  await createDocument(page);
  await typeAndSelectAll(page, "Colourful");

  await page.getByRole("button", { name: "Text colour" }).click();
  const palette = page.getByRole("dialog", { name: "Text colour" });
  const swatches = palette.getByRole("group", { name: "Standard colours" }).getByRole("button");
  await expect(swatches).toHaveCount(80);
  await expect(swatches.first()).toHaveAccessibleName("#000000");
  await expect(swatches.nth(11)).toHaveAccessibleName("#ff0000");
  await expect(swatches.last()).toHaveAccessibleName("#4c1130");
  await expect(palette.getByRole("button", { name: "None" })).toHaveCount(0);
  await expect(palette.getByText("CUSTOM")).toBeVisible();
  await swatches.nth(11).click();
  await expect(editor(page).locator("span[style*='color']")).toHaveAttribute("style", /color: (#ff0000|rgb\(255, 0, 0\))/);

  await page.getByRole("button", { name: "Highlight colour" }).click();
  const highlight = page.getByRole("dialog", { name: "Highlight colour" });
  await expect(highlight.getByRole("button").first()).toHaveText("None");
  await expect(highlight.getByRole("group", { name: "Standard colours" }).getByRole("button")).toHaveCount(80);
  await highlight.getByRole("button", { name: "#ffff00" }).click();
  await expect(editor(page).locator("mark")).toHaveText("Colourful");
});

test("font size steps through the standard sizes and accepts a typed size", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  const size = page.getByRole("combobox", { name: "Font size" });
  await expect(size).toHaveValue("11");

  await page.getByRole("button", { name: named("Increase font size", "⌘+Shift+full stop") }).click();
  await expect(size).toHaveValue("12");
  await page.getByRole("button", { name: named("Increase font size", "⌘+Shift+full stop") }).click();
  await expect(size).toHaveValue("14");
  await page.getByRole("button", { name: named("Decrease font size", "⌘+Shift+comma") }).click();
  await expect(size).toHaveValue("12");

  await size.click();
  await expect(menu(page, "Font size").getByRole("menuitemcheckbox")).toHaveText(
    ["8", "9", "10", "11", "12", "14", "18", "24", "30", "36", "48", "60", "72", "96"].map((value) => value),
  );
  await size.fill("13");
  await size.press("Enter");
  await editor(page).click();
  await page.keyboard.type("Thirteen");
  await expect(editor(page).locator("span")).toHaveAttribute("style", /font-size: 13pt/);
  await expect(size).toHaveValue("13");
});

test("styles and fonts are listed in their own look and applied", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.getByRole("button", { name: "Styles" }).click();
  const styles = menu(page, "Styles");
  await expect(styles.getByRole("menuitemcheckbox")).toHaveText([
    "Normal text",
    "Title",
    "Subtitle",
    "Heading 1",
    "Heading 2",
    "Heading 3",
  ]);
  await expect(styles.getByRole("menuitemcheckbox", { name: "Normal text" })).toHaveAttribute("aria-checked", "true");
  await styles.getByRole("menuitemcheckbox", { name: "Heading 1" }).hover();
  await expect(menu(page, "Heading 1").getByRole("menuitem", { name: "Apply 'Heading 1'" })).toBeVisible();
  await menu(page, "Heading 1").getByRole("menuitem", { name: "Apply 'Heading 1'" }).click();
  await page.keyboard.type("Title");
  await expect(editor(page).locator("h1")).toHaveText("Title");
  await expect(page.getByRole("button", { name: "Styles" })).toHaveText("Heading 1");

  await page.getByRole("button", { name: "Font", exact: true }).click();
  const fonts = menu(page, "Font");
  await expect(fonts.getByRole("menuitem", { name: "More fonts" })).toBeDisabled();
  await expect(fonts.getByRole("menuitemcheckbox", { name: "Impact" }).locator("span[style]")).toHaveCSS(
    "font-family",
    "Impact",
  );
  await fonts.getByRole("menuitemcheckbox", { name: "Verdana" }).click();
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(fonts.getByText("RECENT")).toBeVisible();
  await expect(fonts.getByRole("menuitemcheckbox", { name: "Verdana" })).toHaveCount(2);
});

test("Format > Paragraph styles lists the styles as plain menu text; only the Styles dropdown previews them", async ({
  page,
}) => {
  await createDocument(page);
  await editor(page).click();
  await menuBarItem(page, "Format").click();
  await menu(page, "Format").getByRole("menuitem", { name: "Paragraph styles" }).hover();
  const styles = menu(page, "Paragraph styles");
  await expect(styles.locator(":scope > li > button")).toHaveText([
    "Normal text",
    "Title",
    "Subtitle",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Heading 4",
    "Heading 5",
    "Heading 6",
    "Options",
  ]);
  await expect(styles.locator(":scope > .menu-separator")).toHaveCount(1);
  await expect(styles.locator(".style-preview")).toHaveCount(0);
  // Every entry uses the normal menu font.
  const fonts = await styles
    .locator(".menu-item-label")
    .evaluateAll((labels) => labels.map((label) => `${getComputedStyle(label).fontSize} ${getComputedStyle(label).fontWeight}`));
  expect(new Set(fonts)).toEqual(new Set(["14px 400"]));
  await styles.getByRole("menuitemcheckbox", { name: "Heading 4" }).hover();
  await menu(page, "Heading 4").getByRole("menuitem", { name: "Apply 'Heading 4'" }).click();
  await expect(editor(page).locator("h4")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Styles" }).click();
  await expect(menu(page, "Styles").locator(".style-preview")).toHaveCount(6);
});

test("menus switch on hover, open submenus with hover and →, and close with Escape", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();

  await menuBarItem(page, "File").click();
  await expect(menu(page, "File")).toBeVisible();
  await menuBarItem(page, "Edit").hover();
  await expect(menu(page, "Edit")).toBeVisible();
  await expect(menu(page, "File")).toBeHidden();
  await expect(menu(page, "Edit").getByRole("menuitem", { name: "Cut" })).toBeDisabled();
  await expect(menu(page, "Edit").getByRole("menuitem", { name: "Cut" })).toContainText(shortcut("⌘X"));

  await menuBarItem(page, "Format").hover();
  await menu(page, "Format").getByRole("menuitem", { name: "Text", exact: true }).hover();
  await expect(menu(page, "Text").getByRole("menuitem", { name: "Strikethrough" })).toContainText(shortcut("⌘+Shift+X"));
  await page.keyboard.press("Escape");
  await expect(menu(page, "Format")).toBeHidden();
  await expect(menu(page, "Text")).toBeHidden();

  // Keyboard: ↓ highlights Text, → opens its submenu at Bold, ← closes it again.
  await page.keyboard.type("Keys");
  await page.keyboard.press(`${mod}+a`);
  await menuBarItem(page, "Format").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(menu(page, "Text")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(menu(page, "Text")).toBeHidden();
  await expect(menu(page, "Format")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(menu(page, "Format")).toBeHidden();
  await expect(editor(page).locator("strong")).toHaveText("Keys");

  // → on an item without a submenu moves to the next menu.
  await menuBarItem(page, "Insert").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(menu(page, "Format")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("menus list their items in order without omitted ones", async ({ page }) => {
  await createDocument(page);
  const items = (name: string) =>
    expect.poll(() =>
      menu(page, name)
        .locator(":scope > li > button")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    );

  await menuBarItem(page, "File").click();
  await items("File").toEqual([
    "New",
    "Open",
    "Make a copy",
    "Download",
    "Rename",
    "Move to bin",
    "Version history",
    "Details",
    "Page setup",
    "Print",
  ]);
  await menu(page, "File").getByRole("menuitem", { name: "New" }).hover();
  await items("New").toEqual(["Document"]);
  await menu(page, "File").getByRole("menuitem", { name: "Download" }).hover();
  await items("Download").toEqual(
    ["Microsoft Word (.docx)", "PDF document (.pdf)", "Plain text (.txt)", "Markdown (.md)"],
  );
  await expect(menu(page, "File").getByRole("menuitem", { name: "Page setup" })).toBeEnabled();
  await expect(menu(page, "File").getByRole("menuitem", { name: "Details" })).toBeDisabled();

  await menuBarItem(page, "Edit").hover();
  await items("Edit").toEqual([
    "Undo",
    "Redo",
    "Cut",
    "Copy",
    "Copy as Markdown",
    "Paste",
    "Paste without formatting",
    "Paste from Markdown",
    "Select all",
    "Delete",
    "Find and replace",
  ]);

  await menuBarItem(page, "Insert").hover();
  await items("Insert").toEqual([
    "Image",
    "Table",
    "Link",
    "Symbols",
    "Horizontal line",
    "Break",
    "Page elements",
    "Comment",
  ]);
  await menu(page, "Insert").getByRole("menuitem", { name: "Symbols" }).hover();
  await items("Symbols").toEqual(["Special characters", "Emoji"]);

  await menuBarItem(page, "Tools").hover();
  await items("Tools").toEqual(["Word count", "Review suggested edits", "Preferences", "Keyboard shortcuts"]);

  for (const omitted of [
    "Share",
    "Email",
    "Move",
    "Add a shortcut to Drive",
    "Make available offline",
    "Language",
    "Spelling and grammar",
    "Dictionary",
    "Translate document",
    "Voice typing",
    "Citations",
    "Bookmark",
    "Equation",
    "Suggesting",
    "From template gallery",
  ]) {
    await expect(page.getByRole("menuitem", { name: omitted, exact: true })).toHaveCount(0);
  }
});

test("controls that do not fit are reachable through More", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Formatted");
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+b`);

  const clear = page.getByRole("button", { name: named("Clear formatting", "⌘+\\") });
  await expect(clear).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const row = page.getByRole("toolbar", { name: "More formatting" });
  await expect(row.getByRole("button", { name: named("Clear formatting", "⌘+\\") })).toBeVisible();
  await row.getByRole("button", { name: named("Clear formatting", "⌘+\\") }).click();
  await expect(editor(page).locator("strong")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
  await expect(clear).toBeVisible();
});

test("zoom offers Fit, presets and typed values", async ({ page }) => {
  await createDocument(page);
  const zoom = page.getByRole("combobox", { name: "Zoom" });
  await expect(zoom).toHaveValue("100%");

  await zoom.click();
  await expect(menu(page, "Zoom").getByRole("menuitem")).toHaveText(["Fit", "50%", "75%", "90%", "100%", "125%", "150%", "200%"]);
  await menu(page, "Zoom").getByRole("menuitem", { name: "150%" }).click();
  await expect(page.locator(".page-stack")).toHaveCSS("zoom", "1.5");
  // Choosing a zoom returns focus to the document.
  await expect(editor(page)).toBeFocused();

  await zoom.fill("80");
  await zoom.press("Enter");
  await expect(zoom).toHaveValue("80%");
  await expect(page.locator(".page-stack")).toHaveCSS("zoom", "0.8");

  await zoom.click();
  await menu(page, "Zoom").getByRole("menuitem", { name: "Fit" }).click();
  await expect(zoom).toHaveValue("Fit");
  const scroll = (await page.locator(".editor-scroll").boundingBox())!;
  const pageBox = (await page.locator(".page").first().boundingBox())!;
  expect(Math.abs(pageBox.width - (scroll.width - 32))).toBeLessThan(2);
});

test("Insert > Table inserts the size picked in the grid", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Table" }).hover();
  await page.getByRole("menuitem", { name: "3 x 2" }).hover();
  await expect(page.getByRole("group", { name: "Table" })).toContainText("3 x 2");
  await page.getByRole("menuitem", { name: "3 x 2" }).click();
  await expect(editor(page).locator("tr")).toHaveCount(2);
  await expect(editor(page).locator("tr").first().locator("td")).toHaveCount(3);
});

test("File > Make a copy opens a copy with the same content", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Copied text");
  await waitUntilSaved(page);
  const original = page.url();

  await menuBarItem(page, "File").click();
  await menu(page, "File").getByRole("menuitem", { name: "Make a copy" }).click();
  await expect(page).not.toHaveURL(original);
  await expect(page.getByLabel("Rename")).toHaveValue("Copy of Untitled document");
  await expect(editor(page)).toHaveText("Copied text");
});

test("paint format copies formatting to the next selection", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.type("source");
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.type(" target");

  await editor(page).locator("em").click();
  await page.getByRole("button", { name: "Paint format" }).click();
  await expect(page.getByRole("button", { name: "Paint format" })).toHaveAttribute("aria-pressed", "true");
  await dblclickText(page, editor(page), "target");
  await expect(editor(page).locator("em")).toHaveText(["source", "target"]);
  await expect(page.getByRole("button", { name: "Paint format" })).toHaveAttribute("aria-pressed", "false");
});

test("Hide the menus collapses the header", async ({ page }) => {
  await createDocument(page);
  await page.getByRole("button", { name: named("Hide the menus", "⌘+Shift+F") }).click();
  await expect(page.getByRole("menubar", { name: "Menu bar" })).toBeHidden();
  await page.keyboard.press(`${mod}+Shift+f`);
  await expect(page.getByRole("menubar", { name: "Menu bar" })).toBeVisible();
});
