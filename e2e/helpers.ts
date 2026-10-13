import { expect, type Page } from "@playwright/test";

export const mod = process.platform === "darwin" ? "Meta" : "Control";
/** Start and end of the line: Home/End scroll the page in Chrome on macOS. */
export const lineStart = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";
export const lineEnd = process.platform === "darwin" ? "Meta+ArrowRight" : "End";

export async function createDocument(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Blank document" }).click();
  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await expect(editor(page)).toBeVisible();
}

export function editor(page: Page) {
  return page.getByLabel("Document content");
}

export async function waitUntilSaved(page: Page): Promise<void> {
  await expect(page.getByRole("status").first()).toHaveAttribute("title", "Saved");
}
