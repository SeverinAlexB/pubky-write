// Acceptance criteria of docs/spec/19-columns-images-tables.md: columns, image wrapping, rotation,
// crop and Image options, Split cell and pinned header rows.
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createDocument, editor, lineEnd, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

/** A4 at 96 dpi plus the 10px gap between pages. */
const PAGE_STRIDE = 1123 + 10;
/** 2.54 cm margins. */
const MARGIN = 96;
/** A4's width between 2.54 cm margins, two columns 1.27 cm (48px) apart. */
const CONTENT_WIDTH = 794 - 2 * MARGIN;
const COLUMN_WIDTH = (CONTENT_WIDTH - 48) / 2;

const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

function menu(page: Page, name: string) {
  return page.getByRole("menu", { name, exact: true });
}

/** Appends paragraphs to the document, in place of an empty last paragraph (one undo step). */
async function addParagraphs(page: Page, texts: string[]): Promise<void> {
  await page.evaluate((list) => {
    type Editor = {
      commands: { insertContentAt: (range: number | { from: number; to: number }, content: unknown) => boolean };
      state: { doc: { content: { size: number }; lastChild: { nodeSize: number; content: { size: number }; type: { name: string } } } };
    };
    const instance = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    const paragraphs = list.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
    const { doc } = instance.state;
    const last = doc.lastChild;
    const empty = last.type.name === "paragraph" && last.content.size === 0;
    const end = doc.content.size;
    instance.commands.insertContentAt(empty ? { from: end - last.nodeSize, to: end } : end, paragraphs);
  }, texts);
}

/**
 * Where a locator starts: page (0-based), offset from the page's top and from the content's left
 * edge. The first of its boxes: a paragraph broken across columns has one per column, and
 * `boundingBox()` is the first of them in Chrome but all of them in Firefox; WebKit's union also
 * includes empty boxes at the column spanners.
 */
async function placeOf(page: Page, locator: Locator): Promise<{ page: number; top: number; left: number }> {
  const stack = (await page.locator(".page-stack").boundingBox())!;
  const box = await locator.evaluate((element) => {
    const first = [...element.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0) ?? element.getBoundingClientRect();
    return { x: first.left, y: first.top };
  });
  const y = box.y - stack.y;
  const index = Math.floor(y / PAGE_STRIDE);
  return { page: index, top: Math.round(y - index * PAGE_STRIDE), left: Math.round(box.x - stack.x - MARGIN) };
}

async function chooseColumns(page: Page, preset: string): Promise<void> {
  await menuBarItem(page, "Format").click();
  await menu(page, "Format").getByRole("menuitem", { name: "Columns" }).hover();
  await page.getByRole("group", { name: "Columns" }).getByRole("menuitemradio", { name: preset }).click();
}

test("two columns flow the text down each column and then to the next page, with a line between them when chosen", async ({ page }) => {
  await createDocument(page);
  await addParagraphs(
    page,
    Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1}. ${LOREM}`),
  );
  await expect(page.locator(".page-stack")).not.toHaveAttribute("data-page-count", "1");

  await menuBarItem(page, "Format").click();
  await menu(page, "Format").getByRole("menuitem", { name: "Columns" }).hover();
  const presets = page.getByRole("group", { name: "Columns" });
  for (const name of ["One column", "Two columns", "Three columns"]) await expect(presets.getByRole("menuitemradio", { name })).toBeVisible();
  await expect(presets.getByRole("menuitemradio", { name: "One column" })).toHaveAttribute("aria-checked", "true");
  await expect(presets.getByRole("menuitem", { name: "More options" })).toBeVisible();
  await presets.getByRole("menuitemradio", { name: "Two columns" }).click();

  const stack = page.locator(".page-stack");
  await expect(stack).toHaveAttribute("data-columns", "2");

  // Each paragraph is in the first or the second column of a page, in document order: down the
  // first column, then the second, then the next page.
  const places: { page: number; column: number; top: number }[] = [];
  for (let index = 1; index <= 60; index++) {
    const place = await placeOf(page, editor(page).getByText(`Paragraph ${index}.`, { exact: false }));
    places.push({ page: place.page, column: place.left > COLUMN_WIDTH ? 1 : 0, top: place.top });
    expect([0, Math.round(COLUMN_WIDTH + 48)]).toContainEqual(place.left);
  }
  const order = places.map(({ page: index, column }) => index * 2 + column);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(new Set(order)).toEqual(new Set(Array.from({ length: Math.max(...order) + 1 }, (_, index) => index)));
  // The second column of page 1 and the first of page 2 start at the top margin.
  for (const slot of [1, 2]) {
    const first = places.find((place) => place.page * 2 + place.column === slot)!;
    expect(first.top).toBeLessThanOrEqual(MARGIN + 17 * 4);
  }
  await expect(page.locator(".column-line")).toHaveCount(0);

  // More options: the dialog shows the settings; a line between the columns.
  await menuBarItem(page, "Format").click();
  await menu(page, "Format").getByRole("menuitem", { name: "Columns" }).hover();
  await expect(page.getByRole("group", { name: "Columns" }).getByRole("menuitemradio", { name: "Two columns" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("group", { name: "Columns" }).getByRole("menuitem", { name: "More options" }).click();
  const dialog = page.getByRole("dialog", { name: "Column options" });
  await expect(dialog).toBeVisible();
  expect(Math.round((await dialog.boundingBox())!.width)).toBe(398);
  await expect(dialog.getByLabel("Number of columns")).toHaveValue("2");
  await expect(dialog.getByLabel("Spacing (centimetres)")).toHaveValue("1.27");
  // Three rows: the label at the left, its 100×32px control right-aligned.
  const rows = dialog.locator(".column-options-field");
  await expect(rows).toHaveCount(3);
  const controls = [dialog.getByLabel("Number of columns"), dialog.getByLabel("Spacing (centimetres)"), dialog.locator(".column-options-check")];
  const dialogBox = (await dialog.boundingBox())!;
  const rights = [];
  for (const [index, label] of ["Number of columns", "Spacing (centimetres)", "Line between columns"].entries()) {
    const row = rows.nth(index);
    const labelText = row.locator(":scope > span").first();
    await expect(labelText).toHaveText(label);
    await expect(labelText).toHaveCSS("font-size", "14px");
    const labelBox = (await labelText.boundingBox())!;
    const controlBox = (await controls[index].boundingBox())!;
    expect(Math.round(controlBox.width)).toBe(100);
    expect(Math.round(controlBox.height)).toBe(32);
    expect(labelBox.x - dialogBox.x).toBeLessThan(40);
    expect(Math.abs(labelBox.y + labelBox.height / 2 - (controlBox.y + controlBox.height / 2))).toBeLessThanOrEqual(2);
    rights.push(Math.round(controlBox.x + controlBox.width));
  }
  expect(new Set(rights).size).toBe(1);
  expect(dialogBox.x + dialogBox.width - rights[0]).toBeLessThan(40);
  const checkBox = (await dialog.getByLabel("Line between columns").boundingBox())!;
  expect(Math.round(checkBox.x + checkBox.width)).toBe(rights[0]);
  await dialog.getByLabel("Line between columns").check();
  await dialog.getByRole("button", { name: "Apply" }).click();

  const lines = page.locator(".column-line");
  await expect(lines).toHaveCount(Number(await stack.getAttribute("data-page-count")));
  const line = lines.first();
  await expect(line).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(line).toHaveCSS("width", "1px");
  const place = await placeOf(page, line);
  expect(place).toMatchObject({ page: 0, top: MARGIN });
  expect(Math.abs(place.left - (COLUMN_WIDTH + 24))).toBeLessThanOrEqual(1);
  expect(Math.round((await line.boundingBox())!.height)).toBe(1123 - 2 * MARGIN);

  await waitUntilSaved(page);
  await page.reload();
  await expect(page.locator(".page-stack")).toHaveAttribute("data-columns", "2");
  await expect(page.locator(".column-line").first()).toBeVisible();

  // One column again: no columns and no line.
  await chooseColumns(page, "One column");
  await expect(page.locator(".page-stack")).not.toHaveAttribute("data-columns", /./);
  await expect(page.locator(".column-line")).toHaveCount(0);
});

test("a column break moves the text after it to the next column, and is only offered with columns", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("First column");

  const breakMenu = async () => {
    await menuBarItem(page, "Insert").click();
    await menu(page, "Insert").getByRole("menuitem", { name: "Break" }).hover();
    return menu(page, "Break");
  };
  await expect((await breakMenu()).getByRole("menuitem", { name: "Column break" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await chooseColumns(page, "Two columns");
  await (await breakMenu()).getByRole("menuitem", { name: "Column break" }).click();
  await page.keyboard.type("Second column");

  await expect.poll(async () => (await placeOf(page, editor(page).getByText("Second column"))).left).toBe(Math.round(COLUMN_WIDTH + 48));
  const first = await placeOf(page, editor(page).getByText("First column"));
  const second = await placeOf(page, editor(page).getByText("Second column"));
  expect(first).toMatchObject({ page: 0, left: 0 });
  expect(second.page).toBe(0);
  expect(second.left).toBe(Math.round(COLUMN_WIDTH + 48));
  expect(Math.abs(second.top - first.top)).toBeLessThanOrEqual(1);
  // The column holds what follows the break, even where balancing the columns would move a line
  // back (one line before the break, two after it).
  await page.keyboard.press("Enter");
  await page.keyboard.type("Also second");
  await expect.poll(async () => (await placeOf(page, editor(page).getByText("Also second"))).left).toBe(Math.round(COLUMN_WIDTH + 48));
  expect((await placeOf(page, editor(page).getByText("Second column"))).left).toBe(Math.round(COLUMN_WIDTH + 48));

  // A column break in the last column starts the next page.
  await (await breakMenu()).getByRole("menuitem", { name: "Column break" }).click();
  await page.keyboard.type("Next page");
  await expect.poll(() => placeOf(page, editor(page).getByText("Next page"))).toMatchObject({ page: 1, left: 0 });

  await waitUntilSaved(page);
  await page.reload();
  expect((await placeOf(page, editor(page).getByText("Second column"))).left).toBe(Math.round(COLUMN_WIDTH + 48));
});

/** Uploads a 300 × 150 PNG after a short paragraph, followed by a long one; returns the image. */
async function insertImageBeforeText(page: Page) {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Intro");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#4a86e8";
    context.fillRect(0, 0, 300, 150);
    context.fillStyle = "#e06666";
    context.fillRect(0, 0, 150, 75);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .locator('input[type="file"][accept^="image"]')
    .setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  // The picture itself (crop mode adds copies of it).
  const image = editor(page).locator(".image-frame > .image-crop > img");
  await expect(image).toHaveJSProperty("naturalWidth", 300);
  await addParagraphs(page, [`Wrapped. ${LOREM} ${LOREM} ${LOREM} ${LOREM} ${LOREM} ${LOREM}`, "Last paragraph"]);
  await expect(editor(page).locator(".image-frame + p")).toContainText("Wrapped.");
  return image;
}

/** The client rectangles of the lines of a paragraph's text. */
function lineRects(paragraph: Locator) {
  return paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines: { left: number; top: number; bottom: number }[] = [];
    for (const rect of range.getClientRects()) {
      const last = lines.at(-1);
      if (last && Math.abs(last.top - rect.top) < 2) last.left = Math.min(last.left, rect.left);
      else lines.push({ left: rect.left, top: rect.top, bottom: rect.bottom });
    }
    return lines;
  });
}

async function chooseWrap(page: Page, image: Locator | null, wrap: string) {
  await image?.click();
  const pill = page.getByRole("toolbar", { name: "Image actions" });
  await pill.getByRole("button", { name: "Wrap text options" }).click();
  await page.getByRole("menu", { name: "Wrap text options" }).getByRole("menuitemcheckbox", { name: wrap, exact: true }).click();
}

test("Wrap text flows the text beside the image, Break text above and below it; margin and position change the layout and persist", async ({ page }) => {
  const image = await insertImageBeforeText(page);
  const frame = editor(page).locator(".image-frame");
  const wrapped = editor(page).locator("p", { hasText: "Wrapped." });

  await chooseWrap(page, image, "Wrap text");
  await expect(frame).toHaveAttribute("data-wrap", "wrap");
  const pill = page.getByRole("toolbar", { name: "Image actions" });
  await expect(pill.getByRole("button", { name: "Wrap text options" }).locator("svg").first()).toBeVisible();
  await expect(pill.getByRole("button", { name: "Margin" })).toHaveText(/3\.2mm margin/);
  await expect(pill.getByRole("button", { name: "Position" })).toHaveText(/Move with text/);
  let box = (await image.boundingBox())!;
  let lines = await lineRects(wrapped);
  // The first lines start right of the image and its 3.2mm (12px) margin; later ones under it.
  expect(lines[0]!.top).toBeLessThan(box.y + box.height);
  expect(Math.round(lines[0]!.left - (box.x + box.width))).toBe(12);
  const below = lines.find((line) => line.top >= box.y + box.height + 12)!;
  expect(Math.round(below.left)).toBe(Math.round(box.x));

  // A wider margin moves the text further away.
  await pill.getByRole("button", { name: "Margin" }).click();
  await page.getByRole("menu", { name: "Margin" }).getByRole("menuitemcheckbox", { name: "12.7mm" }).click();
  await expect(pill.getByRole("button", { name: "Margin" })).toHaveText(/12\.7mm margin/);
  lines = await lineRects(wrapped);
  expect(Math.round(lines[0]!.left - (box.x + box.width))).toBe(48);

  // Break text: the paragraph starts below the image and its margin, never beside it.
  await chooseWrap(page, image, "Break text");
  await expect(frame).toHaveAttribute("data-wrap", "break");
  box = (await image.boundingBox())!;
  lines = await lineRects(wrapped);
  expect(lines[0]!.top).toBeGreaterThanOrEqual(box.y + box.height + 47);
  expect(Math.round(lines[0]!.left)).toBe(Math.round(box.x));
  const intro = await lineRects(editor(page).locator("p", { hasText: "Intro" }));
  expect(intro[0]!.bottom).toBeLessThanOrEqual(box.y);

  // Move with text: a new line above moves the image down; Fix position on page keeps it in place.
  await chooseWrap(page, image, "Wrap text");
  // Positions on the page (the view may scroll).
  const frameTop = async () => (await placeOf(page, frame)).top;
  const before = await frameTop();
  await editor(page).getByText("Intro").click({ position: { x: 1, y: 8 } });
  await selectionSynced(page);
  await page.keyboard.press("Enter");
  await expect.poll(async () => Math.round((await frameTop()) - before)).toBe(17);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => Math.round((await frameTop()) - before)).toBe(0);

  await image.click();
  await pill.getByRole("button", { name: "Position" }).click();
  await page.getByRole("menu", { name: "Position" }).getByRole("menuitemcheckbox", { name: "Fix position on page" }).click();
  await expect(pill.getByRole("button", { name: "Position" })).toHaveText(/Fix position on page/);
  await expect.poll(async () => Math.round((await frameTop()) - before)).toBe(0);
  await editor(page).getByText("Intro").click({ position: { x: 1, y: 8 } });
  await selectionSynced(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("p").first()).toHaveText("");
  await expect.poll(async () => Math.round((await frameTop()) - before)).toBe(0);

  await waitUntilSaved(page);
  await page.reload();
  await expect(frame).toHaveAttribute("data-wrap", "wrap");
  await expect(frame).toHaveAttribute("data-positioning", "fixed");
  await expect.poll(async () => Math.round((await frameTop()) - before)).toBe(0);

  // The Word file anchors the image with square wrapping, its margin and its place on the page.
  const download = page.waitForEvent("download");
  await menuBarItem(page, "File").click();
  await page.getByRole("menuitem", { name: "Download" }).hover();
  await page.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click();
  const zip = await JSZip.loadAsync(await readFile(await (await download).path()));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain('<wp:anchor distT="457200" distB="457200" distL="457200" distR="457200"');
  expect(xml).toContain('<wp:wrapSquare wrapText="bothSides"');
  expect(xml).toContain('<wp:positionV relativeFrom="page">');
});

test("images behind and in front of text are placed freely, and dragging moves an image to the paragraph it is dropped at", async ({ page }) => {
  const image = await insertImageBeforeText(page);
  const frame = editor(page).locator(".image-frame");
  await chooseWrap(page, image, "Behind text");
  await expect(frame).toHaveAttribute("data-wrap", "behind");
  await expect(frame).toHaveCSS("position", "absolute");
  await expect(frame).toHaveCSS("z-index", "-1");
  // The text ignores the image: the paragraph starts where the image is.
  const wrappedTop = (await editor(page).locator("p", { hasText: "Wrapped." }).boundingBox())!.y;
  expect(Math.abs(wrappedTop - (await frame.boundingBox())!.y)).toBeLessThanOrEqual(1);

  // The text is over it: it is selected from the keyboard (or by pressing on it where there is no text).
  await editor(page).getByText("Intro").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await selectionSynced(page);
  await expect(page.getByRole("toolbar", { name: "Image actions" })).toBeVisible();
  await chooseWrap(page, null, "In front of text");
  await expect(frame).toHaveCSS("z-index", "3");

  // Drag it down to the last paragraph and to the right.
  await chooseWrap(page, image, "Wrap text");
  const start = (await image.boundingBox())!;
  const target = (await editor(page).getByText("Last paragraph").boundingBox())!;
  // Whole pixels, as Firefox and WebKit move the mouse to whole pixels: the image moves by exactly
  // the distance it is dragged.
  const grab = { x: Math.round(start.x + 40), y: Math.round(start.y + 40) };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 100, grab.y + Math.round(target.y + 45 - (start.y + 40)), { steps: 8 });
  await page.mouse.up();
  await expect(editor(page).locator(".image-frame + p")).toHaveText("Last paragraph");
  const moved = (await image.boundingBox())!;
  expect(Math.abs(moved.x - (start.x + 100))).toBeLessThanOrEqual(2);
  // Anchored to the last paragraph, 5px below its top as dropped (the text above no longer wraps
  // around it, so the paragraph itself moves up).
  const anchor = (await editor(page).getByText("Last paragraph").boundingBox())!;
  expect(Math.round(moved.y - anchor.y)).toBe(5);

  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page).locator(".image-frame + p")).toContainText("Wrapped.");
});

/** The rotation of the image's frame in degrees, from its transform. */
function rotationOf(frame: Locator) {
  return frame.evaluate((element) => {
    const match = /rotate\(([-\d.]+)deg\)/.exec((element as HTMLElement).style.transform);
    return match ? Number(match[1]) : 0;
  });
}

test("the rotation handle rotates the image, Shift snaps to 15°, and the rotation persists", async ({ page }) => {
  const image = await insertImageBeforeText(page);
  const frame = editor(page).locator(".image-frame");
  await image.click();
  const handle = editor(page).locator(".image-rotate-handle");
  const handleBox = (await handle.boundingBox())!;
  const box = (await image.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  // 40° clockwise from straight up, which snaps to 45°.
  const radius = 120;
  const angle = (40 * Math.PI) / 180;
  await page.mouse.move(centre.x + radius * Math.sin(angle), centre.y - radius * Math.cos(angle), { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(() => rotationOf(frame)).toBe(45);

  // Without Shift, any angle. The image stays selected.
  const turned = (await handle.boundingBox())!;
  await page.mouse.move(turned.x + 4, turned.y + 4);
  await page.mouse.down();
  const free = (100 * Math.PI) / 180;
  await page.mouse.move(centre.x + radius * Math.sin(free), centre.y - radius * Math.cos(free), { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => rotationOf(frame)).toBe(100);

  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => rotationOf(frame)).toBe(45);
  await waitUntilSaved(page);
  await page.reload();
  await expect.poll(() => rotationOf(frame)).toBe(45);
});

test("Crop image trims the image with crop handles: Enter or a click outside applies, Escape cancels, and the crop persists", async ({ page }) => {
  const image = await insertImageBeforeText(page);
  const frame = editor(page).locator(".image-frame");
  const visible = () => frame.evaluate((element) => [(element as HTMLElement).offsetWidth, (element as HTMLElement).offsetHeight]);
  await image.click();
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Crop image" }).click();
  await expect(frame).toHaveClass(/is-cropping/);
  await expect(editor(page).locator(".image-crop-handle")).toHaveCount(8);
  await expect(page.getByRole("toolbar", { name: "Image actions" })).toBeHidden();

  const dragCrop = async (name: string, dx: number, dy: number) => {
    const box = (await editor(page).locator(`.image-crop-handle-${name}`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
  };
  // Trim 100px off the right and 50px off the top.
  await dragCrop("e", -100, 0);
  await dragCrop("n", 0, 50);
  await page.keyboard.press("Enter");
  await expect(frame).not.toHaveClass(/is-cropping/);
  await expect.poll(visible).toEqual([200, 100]);
  // The image itself is not changed: the crop is stored as insets.
  await expect(image).toHaveJSProperty("naturalWidth", 300);

  // Double-click crops too; Escape leaves the crop as it was.
  await image.dblclick();
  await expect(frame).toHaveClass(/is-cropping/);
  await dragCrop("w", 50, 0);
  await page.keyboard.press("Escape");
  await expect(frame).not.toHaveClass(/is-cropping/);
  await expect.poll(visible).toEqual([200, 100]);

  // A click outside the image applies.
  await image.dblclick();
  await dragCrop("w", 50, 0);
  await editor(page).getByText("Last paragraph").click();
  await expect(frame).not.toHaveClass(/is-cropping/);
  await expect.poll(visible).toEqual([150, 100]);

  await waitUntilSaved(page);
  await page.reload();
  await expect.poll(visible).toEqual([150, 100]);
  // Cropping again starts from the whole image: the trimmed parts come back.
  await image.click();
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Crop image" }).click();
  await dragCrop("e", 100, 0);
  await page.keyboard.press("Enter");
  await expect.poll(visible).toEqual([250, 100]);
});

test("Image options sets size, rotation, wrapping, position, re-colour, adjustments and alt text; Replace image keeps the settings", async ({
  page,
}) => {
  const image = await insertImageBeforeText(page);
  const frame = editor(page).locator(".image-frame");
  await image.click();
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await toolbar.getByRole("button", { name: "Image options", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Image options" });
  await expect(panel).toBeVisible();
  expect(Math.round((await panel.boundingBox())!.width)).toBe(360);
  await expect(panel.getByRole("button", { name: "Close side sheet" })).toBeVisible();
  for (const name of ["Size and rotation", "Text wrapping", "Position", "Re-colour", "Adjustments", "Alt text"]) {
    await expect(panel.getByRole("button", { name, exact: true })).toBeVisible();
  }

  await expect(panel.getByLabel("Scale (%)")).toHaveValue("100");
  await panel.getByLabel("Scale (%)").fill("50");
  await panel.getByLabel("Scale (%)").press("Enter");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => [element.offsetWidth, element.offsetHeight])).toEqual([150, 75]);
  await panel.getByLabel("Rotation angle (°)").fill("90");
  await panel.getByLabel("Rotation angle (°)").press("Enter");
  await expect.poll(() => rotationOf(frame)).toBe(90);

  await panel.getByRole("radio", { name: "Break text" }).click();
  await expect(frame).toHaveAttribute("data-wrap", "break");
  await panel.getByRole("button", { name: "Position", exact: true }).click();
  await expect(panel.getByRole("radio", { name: "Move with text" })).toBeChecked();
  await panel.getByLabel("X (px)").fill("100");
  await panel.getByLabel("X (px)").press("Enter");
  await expect.poll(async () => (await placeOf(page, frame)).left).toBeGreaterThan(90);

  await panel.getByRole("button", { name: "Re-colour", exact: true }).click();
  await panel.getByLabel("Re-colour").selectOption("greyscale");
  await expect(image).toHaveCSS("filter", /grayscale\(1\)/);
  await panel.getByRole("button", { name: "Adjustments", exact: true }).click();
  await panel.getByRole("slider", { name: "Transparency" }).fill("40");
  await expect(image).toHaveCSS("opacity", "0.6");
  // Changes are undoable.
  await image.click();
  await page.keyboard.press(`${mod}+z`);
  await expect(image).toHaveCSS("opacity", "1");

  await panel.getByRole("button", { name: "Alt text", exact: true }).click();
  await panel.getByLabel("Title").fill("Sales chart");
  await panel.getByLabel("Alt text").fill("Blue and red blocks");
  await panel.getByLabel("Alt text").blur();
  await expect(image).toHaveAttribute("alt", "Blue and red blocks");
  await expect(image).toHaveAttribute("title", "Sales chart");

  // Replace image: another picture with the same size and settings.
  await image.click();
  const chooser = page.waitForEvent("filechooser");
  await toolbar.getByRole("button", { name: "Replace image" }).click();
  await page.getByRole("menu", { name: "Replace image" }).getByRole("menuitem", { name: "Upload from computer" }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 60;
    canvas.height = 60;
    canvas.getContext("2d")!.fillRect(0, 0, 60, 60);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await (await chooser).setFiles({ name: "square.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(image).toHaveJSProperty("naturalWidth", 60);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => [element.offsetWidth, element.offsetHeight])).toEqual([150, 75]);
  await expect(frame).toHaveAttribute("data-wrap", "break");
  await expect.poll(() => rotationOf(frame)).toBe(90);
  await expect(image).toHaveAttribute("alt", "Blue and red blocks");

  await waitUntilSaved(page);
  await page.reload();
  await expect(image).toHaveJSProperty("naturalWidth", 60);
  await expect(image).toHaveCSS("filter", /grayscale\(1\)/);
});

test("Split cell divides a cell into columns and rows; 2 × 2 gives four cells", async ({ page }) => {
  await createDocument(page);
  await editor(page).click();
  await menuBarItem(page, "Insert").click();
  await menu(page, "Insert").getByRole("menuitem", { name: "Table" }).hover();
  await page.getByRole("menuitem", { name: "2 x 2", exact: true }).click();
  await page.keyboard.type("Split me");

  await editor(page).getByText("Split me").click({ button: "right" });
  await page.getByRole("menu", { name: "Context menu" }).getByRole("menuitem", { name: "Split cell" }).click();
  const dialog = page.getByRole("dialog", { name: "Split cell" });
  await expect(dialog).toBeVisible();
  expect(Math.round((await dialog.boundingBox())!.width)).toBe(301);
  await expect(dialog.getByLabel("Columns")).toHaveValue("1");
  await expect(dialog.getByLabel("Rows")).toHaveValue("1");
  await dialog.getByLabel("Columns").fill("2");
  await dialog.getByLabel("Rows").fill("2");
  await dialog.getByRole("button", { name: "Split" }).click();
  await expect(dialog).toBeHidden();

  const table = editor(page).locator("table");
  // A 2 × 2 table: the first cell becomes four cells; the others span the new column and row.
  await expect(table.locator("td")).toHaveCount(7);
  await expect(table.locator("tr")).toHaveCount(3);
  const firstRow = table.locator("tr").first().locator("td");
  await expect(firstRow).toHaveCount(3);
  await expect(firstRow.first()).toHaveText("Split me");
  await expect(table.locator("tr").nth(1).locator("td")).toHaveCount(2);
  await expect(table.locator("tr").first().locator("td").nth(2)).toHaveAttribute("rowspan", "2");

  // One undo step; it persists.
  await page.keyboard.press(`${mod}+z`);
  await expect(table.locator("td")).toHaveCount(4);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(table.locator("td")).toHaveCount(7);
  await waitUntilSaved(page);
  await page.reload();
  await expect(editor(page).locator("table td")).toHaveCount(7);

  // Format > Table has Split cell too.
  await editor(page).getByText("Split me").click();
  await selectionSynced(page);
  await menuBarItem(page, "Format").click();
  await menu(page, "Format").getByRole("menuitem", { name: "Table", exact: true }).hover();
  await expect(menu(page, "Table").getByRole("menuitem", { name: "Split cell" })).toBeEnabled();
});

test("a pinned header row is grey, repeats at the top of the next page and stays on top when sorting; Insert title row adds one", async ({ page }) => {
  await createDocument(page);
  await page.evaluate(() => {
    type Editor = { commands: { setContent: (content: unknown) => boolean } };
    const instance = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    const cell = (text: string) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const rows = [
      { type: "tableRow", content: [cell("Name"), cell("Score")] },
      ...Array.from({ length: 45 }, (_, index) => ({ type: "tableRow", content: [cell(`Person ${45 - index}`), cell(String(index))] })),
    ];
    instance.commands.setContent({ type: "doc", content: [{ type: "paragraph" }, { type: "table", content: rows }, { type: "paragraph" }] });
  });
  // The table breaks between rows: it continues on page 2.
  await expect(page.locator(".page-stack")).toHaveAttribute("data-page-count", "2");
  await expect(page.locator(".table-repeat-row")).toHaveCount(0);

  await editor(page).getByText("Name").click({ button: "right" });
  const contextMenu = page.getByRole("menu", { name: "Context menu" });
  await contextMenu.getByRole("menuitem", { name: "Pin header row" }).click();
  // The table's own header cell, not its copy at the top of page 2.
  const header = editor(page).locator("tr:not(.table-repeat-row) > th", { hasText: "Name" });
  await expect(header).toHaveCSS("background-color", "rgb(217, 217, 217)");

  const repeat = page.locator(".table-repeat-row");
  await expect(repeat).toHaveCount(1);
  await expect(repeat).toContainText("Name");
  await expect(repeat).toContainText("Score");
  expect(await placeOf(page, repeat)).toMatchObject({ page: 1, top: MARGIN });
  expect((await repeat.boundingBox())!.x).toBeCloseTo((await editor(page).locator("tr").first().boundingBox())!.x, 0);
  await expect(repeat.locator("th").first()).toHaveCSS("background-color", "rgb(217, 217, 217)");
  // The first row on page 2 follows right under the repeated header.
  const repeatBox = (await repeat.boundingBox())!;
  const rowsOnPage2 = await editor(page)
    .locator("tbody > tr:not(.table-page-gap)")
    .evaluateAll((rows, top) => rows.filter((row) => Math.abs(row.getBoundingClientRect().top - top) < 2).length, repeatBox.y + repeatBox.height);
  expect(rowsOnPage2).toBe(1);

  // Sorting keeps the pinned row at the top.
  await editor(page).getByText("Person 45").click({ button: "right" });
  await contextMenu.getByRole("menuitem", { name: "Sort table" }).hover();
  await page.getByRole("menuitem", { name: "Sort ascending" }).click();
  await expect(editor(page).locator("tr").first()).toContainText("Name");
  await expect(editor(page).locator("tr").nth(1)).toContainText("Person 1");

  await waitUntilSaved(page);
  await page.reload();
  await expect(page.locator(".table-repeat-row")).toHaveCount(1);

  // In a pinned row the menu unpins.
  await editor(page).getByText("Name").first().click({ button: "right" });
  await expect(contextMenu.getByRole("menuitem", { name: "Pin header row", exact: true })).toHaveCount(0);
  await contextMenu.getByRole("menuitem", { name: "Unpin header rows" }).click();
  await expect(editor(page).locator("th")).toHaveCount(0);
  await expect(page.locator(".table-repeat-row")).toHaveCount(0);

  // Insert title row: an empty pinned row at the top, with the cursor in it.
  await editor(page).getByText("Person 3", { exact: true }).first().click({ button: "right" });
  await contextMenu.getByRole("menuitem", { name: "Insert title row" }).click();
  await page.keyboard.type("Scores");
  await expect(editor(page).locator("tr").first().locator("th")).toHaveCount(2);
  await expect(editor(page).locator("tr").first()).toContainText("Scores");
  await expect(page.locator(".table-repeat-row")).toContainText("Scores");
});

test("with columns a table breaks between rows into the next column and page, repeating its pinned rows", async ({ page }) => {
  await createDocument(page);
  await chooseColumns(page, "Two columns");
  await page.evaluate(() => {
    type Editor = { commands: { setContent: (content: unknown) => boolean } };
    const instance = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    const cell = (type: string, text: string) => ({ type, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const rows = [
      { type: "tableRow", content: [cell("tableHeader", "Name"), cell("tableHeader", "Score")] },
      ...Array.from({ length: 80 }, (_, index) => ({ type: "tableRow", content: [cell("tableCell", `Person ${index + 1}`), cell("tableCell", String(index))] })),
    ];
    instance.commands.setContent({
      type: "doc",
      attrs: { columns: 2 },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Before the table" }] }, { type: "table", content: rows }, { type: "paragraph", content: [{ type: "text", text: "After the table" }] }],
    });
  });
  const stack = page.locator(".page-stack");
  await expect(stack).toHaveAttribute("data-page-count", "2");
  // The table continues in the second column and on the second page, with the pinned row at the
  // top of each.
  const repeat = page.locator(".table-repeat-row");
  await expect(repeat).toHaveCount(2);
  const near = (place: { page: number; top: number; left: number }, page: number, left: number) =>
    place.page === page && Math.abs(place.top - MARGIN) <= 1 && Math.abs(place.left - left) <= 1;
  await expect.poll(async () => near(await placeOf(page, repeat.first()), 0, COLUMN_WIDTH + 48)).toBe(true);
  expect(near(await placeOf(page, repeat.nth(1)), 1, 0)).toBe(true);
  await expect(repeat.first()).toContainText("Name");

  // Every row is in a column, between the margins, and as wide as the column.
  const rows = editor(page).locator("tbody > tr:not(.table-size-row)");
  await expect(rows).toHaveCount(81);
  const places = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const rect = [...row.getClientRects()].find((box) => box.width > 0 && box.height > 0)!;
      return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
    }),
  );
  const stackBox = (await stack.boundingBox())!;
  const columnLefts = [MARGIN, MARGIN + COLUMN_WIDTH + 48].map((left) => stackBox.x + left);
  for (const place of places) {
    expect(columnLefts.some((left) => Math.abs(place.left - left) <= 1)).toBe(true);
    expect(Math.abs(place.width - COLUMN_WIDTH)).toBeLessThanOrEqual(1.5);
    const y = place.top - stackBox.y;
    const pageIndex = Math.floor(y / PAGE_STRIDE);
    expect(y - pageIndex * PAGE_STRIDE).toBeGreaterThanOrEqual(MARGIN - 1);
    expect(place.bottom - stackBox.y - pageIndex * PAGE_STRIDE).toBeLessThanOrEqual(1123 - MARGIN + 1);
  }
  // The row after each repeated pinned row follows right under it.
  for (const index of [0, 1]) {
    const box = (await repeat.nth(index).boundingBox())!;
    expect(places.filter((place) => Math.abs(place.top - (box.y + box.height)) < 2)).toHaveLength(1);
  }
  await expect.poll(async () => (await placeOf(page, editor(page).getByText("After the table"))).page).toBe(1);

  // Typing in a row that moved to the next column edits that row.
  await editor(page).getByText("Person 60", { exact: true }).click();
  await selectionSynced(page);
  await page.keyboard.press(lineEnd);
  await page.keyboard.type(" (moved)");
  await expect(editor(page).getByText("Person 60 (moved)")).toBeVisible();
  await expect(repeat).toHaveCount(2);

  // Printing lays the pages out without gaps: the table still starts page 2 under its pinned row.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  const printed = async () => {
    const top = (await stack.boundingBox())!.y;
    return Math.round((await repeat.nth(1).boundingBox())!.y - top);
  };
  expect(Math.abs((await printed()) - (1123 + MARGIN))).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await expect.poll(async () => Math.abs((await printed()) - (PAGE_STRIDE + MARGIN)) <= 1).toBe(true);

  // One column: the table continues on the next page as before.
  await chooseColumns(page, "One column");
  await expect(page.locator(".table-column-spacer")).toHaveCount(0);
  await expect(page.locator(".table-page-spacer .table-repeat-row")).toHaveCount(2);
});
