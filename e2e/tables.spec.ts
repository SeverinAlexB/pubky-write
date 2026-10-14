import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, menuBarItem, mod, waitUntilSaved } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

function insertMenu(page: Page) {
  return page.getByRole("menu", { name: "Insert" });
}

/** Insert > Table, then the grid cell for `columns` × `rows`. */
async function insertTable(page: Page, columns: number, rows: number) {
  await menuBarItem(page, "Insert").click();
  await insertMenu(page).getByRole("menuitem", { name: "Table" }).hover();
  await page.getByRole("menuitem", { name: `${columns} x ${rows}`, exact: true }).click();
}

/** Types one text per cell, moving on with Tab. */
async function fillCells(page: Page, texts: string[]) {
  for (const [index, value] of texts.entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await page.keyboard.type(value);
  }
}

const rowTexts = (page: Page) => editor(page).locator("tr").evaluateAll((rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent)));
const columnWidths = (page: Page) =>
  editor(page)
    .locator("table")
    .first()
    .evaluate((table) => [...table.querySelectorAll("tr:first-child > *")].map((cell) => Math.round(cell.getBoundingClientRect().width)));

test("the size picker starts at 5 × 5, grows while hovering, shows C x R and inserts that size", async ({ page }) => {
  await createDocument(page);
  await menuBarItem(page, "Insert").click();
  await insertMenu(page).getByRole("menuitem", { name: "Table" }).hover();
  const picker = page.getByRole("group", { name: "Table" });
  const cells = picker.locator(".table-picker-cell");
  await expect(cells).toHaveCount(25);
  await expect(cells.first()).toHaveCSS("width", "18px");
  await expect(cells.first()).toHaveCSS("height", "18px");

  await page.getByRole("menuitem", { name: "3 x 2", exact: true }).hover();
  await expect(picker).toContainText("3 x 2");
  await expect(picker.locator(".table-picker-cell.is-selected")).toHaveCount(6);
  await expect(page.getByRole("menuitem", { name: "3 x 2", exact: true })).toHaveCSS("background-color", "rgb(211, 227, 253)");

  // Hovering the edge grows the grid one step, up to 20 × 20.
  await page.getByRole("menuitem", { name: "5 x 5", exact: true }).hover();
  await expect(cells).toHaveCount(36);
  for (let size = 6; size <= 19; size++) await page.getByRole("menuitem", { name: `${size} x ${size}`, exact: true }).hover();
  await expect(cells).toHaveCount(400);
  await page.getByRole("menuitem", { name: "20 x 20", exact: true }).hover();
  await expect(cells).toHaveCount(400);

  await page.getByRole("menuitem", { name: "3 x 2", exact: true }).hover();
  await page.getByRole("menuitem", { name: "3 x 2", exact: true }).click();
  await expect(editor(page).locator("tr")).toHaveCount(2);
  await expect(editor(page).locator("tr").first().locator("td")).toHaveCount(3);
  // The cursor is in the first cell.
  await page.keyboard.type("First");
  await expect(editor(page).locator("td").first()).toHaveText("First");
  // The toolbar has no table button.
  await expect(page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: /table/i })).toHaveCount(0);
});

test("tables fill the content width with equal columns, black 1px borders and 7px padding", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await insertTable(page, 3, 2);
  const paragraphWidth = await editor(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  const table = editor(page).locator("table");
  expect(Math.round((await table.boundingBox())!.width)).toBe(Math.round(paragraphWidth));
  const widths = await columnWidths(page);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

  const cell = editor(page).locator("td").first();
  for (const side of ["top", "right", "bottom", "left"]) {
    await expect(cell).toHaveCSS(`border-${side}-width`, "1px");
    await expect(cell).toHaveCSS(`border-${side}-style`, "solid");
    await expect(cell).toHaveCSS(`border-${side}-color`, "rgb(0, 0, 0)");
    await expect(cell).toHaveCSS(`padding-${side}`, "7px");
  }
  await expect(cell).toHaveCSS("vertical-align", "top");
});

test("dragging a column border changes the widths, which persist after reload", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await insertTable(page, 3, 2);
  await fillCells(page, ["A", "B", "C"]);
  const before = await columnWidths(page);

  const first = (await editor(page).locator("td").first().boundingBox())!;
  await page.mouse.move(first.x + first.width - 1, first.y + first.height / 2);
  await expect(editor(page)).toHaveClass(/is-column-resize/);
  await expect(editor(page).locator("td").first()).toHaveCSS("cursor", "col-resize");
  await page.mouse.down();
  await page.mouse.move(first.x + first.width + 120, first.y + first.height / 2, { steps: 5 });
  await page.mouse.up();

  const after = await columnWidths(page);
  expect(after[0]).toBeCloseTo(before[0]! + 120, -1);
  expect(after[1]).toBeCloseTo(before[1]! - 120, -1);
  expect(after[2]).toBeCloseTo(before[2]!, -1);
  // The table keeps its width.
  expect(after.reduce((sum, width) => sum + width, 0)).toBeCloseTo(before.reduce((sum, width) => sum + width, 0), -1);

  // One undo step restores equal columns.
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => columnWidths(page)).toEqual(before);
  await page.keyboard.press(`${mod}+y`);
  await expect.poll(() => columnWidths(page)).toEqual(after);

  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).locator("table")).toBeVisible();
  expect(await columnWidths(page)).toEqual(after);
});

test("right-clicking in a table shows the table items, and Sort ascending sorts the rows in one undo step", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await insertTable(page, 2, 3);
  await fillCells(page, ["Pear", "3", "apple", "10", "Banana", "2"]);

  await editor(page).locator("td").nth(1).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Context menu" });
  await expect(menu).toBeVisible();
  const labels = await menu.locator(":scope > li").evaluateAll((items) =>
    items.map((item) => (item.classList.contains("menu-separator") ? "—" : item.querySelector("button")?.getAttribute("aria-label"))),
  );
  expect(labels.slice(labels.indexOf("Delete") + 1, labels.indexOf("Comment"))).toEqual([
    "—",
    "Insert row above",
    "Insert row below",
    "Insert column to the left",
    "Insert column to the right",
    "—",
    "Delete row",
    "Delete column",
    "Delete table",
    "—",
    "Distribute rows",
    "Distribute columns",
    "Sort table",
    "Table options",
    "—",
  ]);

  // By the cursor's column: the numbers, by value.
  await menu.getByRole("menuitem", { name: "Sort table" }).hover();
  await page.getByRole("menuitem", { name: "Sort ascending" }).click();
  await expect(menu).toBeHidden();
  expect(await rowTexts(page)).toEqual([
    ["Banana", "2"],
    ["Pear", "3"],
    ["apple", "10"],
  ]);

  await editor(page).locator("td").first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Sort table" }).hover();
  await page.getByRole("menuitem", { name: "Sort ascending" }).click();
  expect(await rowTexts(page)).toEqual([
    ["apple", "10"],
    ["Banana", "2"],
    ["Pear", "3"],
  ]);
  await page.keyboard.press(`${mod}+z`);
  expect(await rowTexts(page)).toEqual([
    ["Banana", "2"],
    ["Pear", "3"],
    ["apple", "10"],
  ]);

  await waitUntilSaved(page);
  await page.reload();
  await expect.poll(() => rowTexts(page)).toEqual([
    ["Banana", "2"],
    ["Pear", "3"],
    ["apple", "10"],
  ]);
});

test("the right-click table items insert and delete rows and columns", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await insertTable(page, 2, 2);
  const menu = page.getByRole("menu", { name: "Context menu" });
  const choose = async (name: string) => {
    await editor(page).locator("td").first().click({ button: "right" });
    await menu.getByRole("menuitem", { name, exact: true }).click();
  };
  await choose("Insert row above");
  await expect(editor(page).locator("tr")).toHaveCount(3);
  await choose("Insert column to the right");
  await expect(editor(page).locator("tr").first().locator("td")).toHaveCount(3);
  await choose("Delete column");
  await expect(editor(page).locator("tr").first().locator("td")).toHaveCount(2);
  await choose("Delete row");
  await expect(editor(page).locator("tr")).toHaveCount(2);
  await choose("Delete table");
  await expect(editor(page).locator("table")).toHaveCount(0);
});

test("Format > Table has the specified items; merge, unmerge and distribute work", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Intro\n");
  await insertTable(page, 3, 2);
  await fillCells(page, ["A", "B", "C", "Tall\nTaller\nTallest", "E", "F"]);

  const openTableMenu = async () => {
    await menuBarItem(page, "Format").click();
    await page.getByRole("menu", { name: "Format" }).getByRole("menuitem", { name: "Table", exact: true }).hover();
    return page.getByRole("menu", { name: "Table" });
  };
  let tableMenu = await openTableMenu();
  const labels = await tableMenu.locator(":scope > li").evaluateAll((items) =>
    items.map((item) => (item.classList.contains("menu-separator") ? "—" : item.querySelector("button")?.getAttribute("aria-label"))),
  );
  expect(labels).toEqual([
    "Insert row above",
    "Insert row below",
    "Insert column left",
    "Insert column right",
    "—",
    "Delete row",
    "Delete column",
    "Delete table",
    "—",
    "Distribute rows",
    "Distribute columns",
    "—",
    "Merge cells",
    "Unmerge cells",
    "—",
    "Sort ascending",
    "Sort descending",
    "—",
    "Table options",
  ]);
  // A cursor in one unmerged cell can neither merge nor unmerge.
  await expect(tableMenu.getByRole("menuitem", { name: "Merge cells", exact: true })).toBeDisabled();
  await expect(tableMenu.getByRole("menuitem", { name: "Unmerge cells" })).toBeDisabled();

  // Distribute rows: every row as tall as the tallest.
  await tableMenu.getByRole("menuitem", { name: "Distribute rows" }).click();
  const heights = await editor(page).locator("tr").evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(heights[0]).toBe(heights[1]);

  // Select A and B, then merge and unmerge.
  const [a, b] = [editor(page).locator("td").nth(0), editor(page).locator("td").nth(1)];
  await a.click();
  await page.keyboard.down("Shift");
  await b.click();
  await page.keyboard.up("Shift");
  tableMenu = await openTableMenu();
  await tableMenu.getByRole("menuitem", { name: "Merge cells", exact: true }).click();
  await expect(editor(page).locator("tr").first().locator("td")).toHaveCount(2);
  await expect(editor(page).locator('td[colspan="2"]')).toBeVisible();
  tableMenu = await openTableMenu();
  await expect(tableMenu.getByRole("menuitem", { name: "Unmerge cells" })).toBeEnabled();
  await tableMenu.getByRole("menuitem", { name: "Unmerge cells" }).click();
  await expect(editor(page).locator("tr").first().locator("td")).toHaveCount(3);

  // Distribute columns makes resized columns equal again.
  const first = (await editor(page).locator("td").first().boundingBox())!;
  await page.mouse.move(first.x + first.width - 1, first.y + 5);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width + 100, first.y + 5, { steps: 4 });
  await page.mouse.up();
  const resized = await columnWidths(page);
  expect(resized[0]! - resized[2]!).toBeGreaterThan(80);
  await editor(page).locator("td").nth(2).click();
  tableMenu = await openTableMenu();
  await tableMenu.getByRole("menuitem", { name: "Distribute columns" }).click();
  const distributed = await columnWidths(page);
  expect(Math.max(...distributed) - Math.min(...distributed)).toBeLessThanOrEqual(1);

  // Format > Table is disabled outside a table.
  await editor(page).getByText("Intro").click();
  await menuBarItem(page, "Format").click();
  await expect(page.getByRole("menu", { name: "Format" }).getByRole("menuitem", { name: "Table", exact: true })).toBeDisabled();
});

test("Table options shows the table's size and sets the border and cell background", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Intro\n");
  await insertTable(page, 4, 3);
  await editor(page).locator("td").first().click({ button: "right" });
  await page.getByRole("menu", { name: "Context menu" }).getByRole("menuitem", { name: "Table options" }).click();

  const panel = page.getByRole("complementary", { name: "Table options" });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("width", "360px");
  await expect(panel.getByLabel("Columns")).toHaveText("4");
  await expect(panel.getByLabel("Rows")).toHaveText("3");

  await panel.getByLabel("Border width").selectOption("1.5");
  await expect(editor(page).locator("td").first()).toHaveCSS("border-top-width", "2px");
  await panel.getByRole("button", { name: "Border colour" }).click();
  await page.getByRole("button", { name: "#cc0000" }).first().click();
  await expect(editor(page).locator("td").first()).toHaveCSS("border-top-color", "rgb(204, 0, 0)");
  await panel.getByRole("button", { name: "Cell background colour" }).click();
  await page.getByRole("button", { name: "#fff2cc" }).first().click();
  await expect(editor(page).locator("td").first()).toHaveCSS("background-color", "rgb(255, 242, 204)");
  await expect(editor(page).locator("td").nth(1)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).locator("td").first()).toHaveCSS("border-top-color", "rgb(204, 0, 0)");
  await expect(editor(page).locator("td").first()).toHaveCSS("background-color", "rgb(255, 242, 204)");

  // Format > Table > Table options opens it too; outside a table it says so.
  await editor(page).locator("td").first().click();
  await menuBarItem(page, "Format").click();
  await page.getByRole("menu", { name: "Format" }).getByRole("menuitem", { name: "Table", exact: true }).hover();
  await page.getByRole("menu", { name: "Table" }).getByRole("menuitem", { name: "Table options" }).click();
  await expect(panel.getByLabel("Columns")).toHaveText("4");
  await editor(page).getByText("Intro").click();
  await expect(panel).toContainText("Select a table to see table options.");
  await panel.getByRole("button", { name: "Close table options" }).click();
  await expect(panel).toBeHidden();
});
