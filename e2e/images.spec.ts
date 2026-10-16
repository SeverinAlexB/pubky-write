import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, mod, waitUntilSaved } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

/** Uploads a 300 × 150 PNG drawn in the page, after a line of text. */
async function insertImage(page: Page) {
  await createDocument(page);
  await editor(page).click();
  await page.keyboard.type("Text above the image");
  await page.keyboard.press("Enter");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#4a86e8";
    context.fillRect(0, 0, 300, 150);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .locator('input[type="file"][accept^="image"]')
    .setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  const image = editor(page).locator(".image-frame img");
  await expect(image).toHaveJSProperty("naturalWidth", 300);
  // A new image is selected; start with the cursor in the text.
  await expect(page.getByRole("toolbar", { name: "Image actions" })).toBeVisible();
  await editor(page).getByText("Text above the image").click();
  return image;
}

const sizeOf = (image: ReturnType<Page["locator"]>) => image.evaluate((element: HTMLImageElement) => [element.offsetWidth, element.offsetHeight]);

/** Drags a selection handle by dx, dy. */
async function dragHandle(page: Page, handle: string, dx: number, dy: number, shift = false) {
  const box = (await editor(page).locator(`.image-handle-${handle}`).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

test("a selected image shows an outline, eight handles, a rotation handle and the floating pill", async ({ page }) => {
  const image = await insertImage(page);
  const pill = page.getByRole("toolbar", { name: "Image actions" });
  await expect(pill).toBeHidden();
  await expect(editor(page).locator(".image-handle")).toHaveCount(8);
  await expect(editor(page).locator(".image-handle").first()).toBeHidden();

  await image.click();
  const handles = editor(page).locator(".image-handle");
  for (let index = 0; index < 8; index++) {
    await expect(handles.nth(index)).toBeVisible();
    await expect(handles.nth(index)).toHaveCSS("width", "6px");
    await expect(handles.nth(index)).toHaveCSS("background-color", "rgb(11, 87, 208)");
  }
  // The longhands: browsers write the outline shorthand in different orders.
  const handlesBox = editor(page).locator(".image-handles");
  await expect(handlesBox).toHaveCSS("outline-color", "rgb(11, 87, 208)");
  await expect(handlesBox).toHaveCSS("outline-style", "solid");
  await expect(handlesBox).toHaveCSS("outline-width", "1px");
  await expect(editor(page).locator(".image-rotate-handle")).toBeVisible();
  await expect(editor(page).locator(".image-rotate-handle")).toHaveCSS("width", "8px");

  // Corner and edge-midpoint handles sit on the image's corners and edges.
  const imageBox = (await image.boundingBox())!;
  const centre = async (name: string) => {
    const box = (await editor(page).locator(`.image-handle-${name}`).boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const [seX, seY] = await centre("se");
  expect(seX).toBeCloseTo(imageBox.x + imageBox.width, -1);
  expect(seY).toBeCloseTo(imageBox.y + imageBox.height, -1);
  const [nX, nY] = await centre("n");
  expect(nX).toBeCloseTo(imageBox.x + imageBox.width / 2, -1);
  expect(nY).toBeCloseTo(imageBox.y, -1);

  // The pill is 8px below the image's bottom-left corner.
  await expect(pill).toBeVisible();
  const pillBox = (await pill.boundingBox())!;
  expect(Math.round(pillBox.x)).toBe(Math.round(imageBox.x));
  expect(Math.round(pillBox.y - (imageBox.y + imageBox.height))).toBe(8);
  for (const name of ["Wrap text options", "Image options", "Add comment", "Add emoji reaction"]) {
    await expect(pill.getByRole("button", { name })).toBeEnabled();
  }

  await pill.getByRole("button", { name: "Wrap text options" }).click();
  const wrap = page.getByRole("menu", { name: "Wrap text options" });
  await expect(wrap.getByRole("menuitemcheckbox", { name: "In line" })).toHaveAttribute("aria-checked", "true");
  for (const name of ["Wrap text", "Break text", "Behind text", "In front of text"]) {
    await expect(wrap.getByRole("menuitemcheckbox", { name })).toHaveAttribute("aria-checked", "false");
  }
  await page.keyboard.press("Escape");

  // Clicking the text deselects the image.
  await editor(page).getByText("Text above the image").click();
  await expect(pill).toBeHidden();
  await expect(handles.first()).toBeHidden();
});

test("while an image is selected the toolbar shows the image controls", async ({ page }) => {
  const image = await insertImage(page);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar.getByRole("button", { name: "Styles" })).toBeVisible();
  await image.click();
  for (const name of ["Border colour", "Border weight", "Border dash"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  // Crop image, then the Image options and Replace image text buttons.
  for (const name of ["Crop image", "Image options", "Replace image"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  for (const name of ["Styles", "Font", "Bold", "Text colour", "Highlight colour"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  // The alignment group stays.
  await expect(toolbar.getByRole("button", { name: /^Align/ }).first()).toBeVisible();

  await editor(page).getByText("Text above the image").click();
  await expect(toolbar.getByRole("button", { name: "Styles" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Crop image" })).toHaveCount(0);
});

test("dragging a corner resizes proportionally and the size persists after reload", async ({ page }) => {
  const image = await insertImage(page);
  await image.click();
  expect(await sizeOf(image)).toEqual([300, 150]);

  await dragHandle(page, "se", 150, 20);
  expect(await sizeOf(image)).toEqual([450, 225]);
  // Still selected, with the pill under the new bottom edge.
  await expect(page.getByRole("toolbar", { name: "Image actions" })).toBeVisible();

  await dragHandle(page, "nw", 50, 0);
  expect(await sizeOf(image)).toEqual([400, 200]);

  await waitUntilSaved(page);
  await page.reload();
  await expect(image).toHaveJSProperty("naturalWidth", 300);
  expect(await sizeOf(image)).toEqual([400, 200]);
});

test("edge handles stretch one side; Shift keeps the proportions; one undo step each", async ({ page }) => {
  const image = await insertImage(page);
  await image.click();
  await dragHandle(page, "e", 100, 30);
  expect(await sizeOf(image)).toEqual([400, 150]);
  await dragHandle(page, "s", 0, 50);
  expect(await sizeOf(image)).toEqual([400, 200]);
  await dragHandle(page, "e", -100, 0, true);
  expect(await sizeOf(image)).toEqual([300, 150]);

  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => sizeOf(image)).toEqual([400, 200]);

  // An image is never wider than the page's content. (Dragged to near the window's right edge:
  // Playwright's Firefox reports a mouse outside the window at x 0.)
  const handle = (await editor(page).locator(".image-handle-se").boundingBox())!;
  await dragHandle(page, "se", page.viewportSize()!.width - 10 - (handle.x + handle.width / 2), 0);
  const contentWidth = await editor(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  expect((await sizeOf(image))[0]).toBe(Math.round(contentWidth));

  await waitUntilSaved(page);
  await page.reload();
  expect((await sizeOf(image))[0]).toBe(Math.round(contentWidth));
});

test("Delete and Backspace remove a selected image", async ({ page }) => {
  const image = await insertImage(page);
  // Edits less than half a second apart are one undo step: keep the deletion apart from the insertion.
  await page.waitForTimeout(600);
  await image.click();
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator("img")).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page).locator("img")).toHaveCount(1);
  await image.click();
  await page.keyboard.press("Delete");
  await expect(editor(page).locator("img")).toHaveCount(0);
  await expect(editor(page)).toContainText("Text above the image");
});

test("Image options sets the size and alt text; Add comment comments on the image", async ({ page }) => {
  const image = await insertImage(page);
  await image.click();
  await page.getByRole("toolbar", { name: "Image actions" }).getByRole("button", { name: "Image options" }).click();
  const panel = page.getByRole("complementary", { name: "Image options" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Width (px)")).toHaveValue("300");

  await panel.getByLabel("Width (px)").fill("200");
  await panel.getByLabel("Width (px)").press("Enter");
  expect(await sizeOf(image)).toEqual([200, 100]);
  await panel.getByRole("button", { name: "Alt text" }).click();
  await panel.getByLabel("Alt text").fill("A blue chart");
  await panel.getByLabel("Alt text").blur();
  await expect(image).toHaveAttribute("alt", "A blue chart");

  await waitUntilSaved(page);
  await page.reload();
  await expect(image).toHaveAttribute("alt", "A blue chart");
  expect(await sizeOf(image)).toEqual([200, 100]);

  await image.click();
  await page.getByRole("toolbar", { name: "Image actions" }).getByRole("button", { name: "Add comment" }).click();
  await page.keyboard.type("Make it red");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.locator(".comment-card").filter({ hasText: "Make it red" })).toBeVisible();
});
