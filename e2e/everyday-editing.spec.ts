// docs/spec/17-everyday-editing.md: link bubble, preferences and automatic formatting, the
// keyboard shortcuts dialog, paste, and edits kept while offline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createDocument, editor, lineEnd, menuBarItem, mod, selectionSynced, waitUntilSaved } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** The automatic formatting defaults (the test configuration turns some off for the other tests). */
async function useDefaultPreferences(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("docs.preferences"));
}

async function newDocument(page: Page) {
  await useDefaultPreferences(page);
  await createDocument(page);
  await editor(page).click();
}

/** The document's text content (paragraphs joined by "|"). */
function documentText(page: Page): Promise<string> {
  return page.evaluate(() => {
    type View = { state: { doc: { textBetween: (from: number, to: number, separator: string) => string; content: { size: number } } } };
    const { doc } = (document.querySelector(".ProseMirror") as unknown as { editor: { view: View } }).editor.view.state;
    return doc.textBetween(0, doc.content.size, "|");
  });
}

/** Pastes `html` (and `text`) as a paste event from the clipboard would. */
async function paste(page: Page, data: { html?: string; text?: string }) {
  await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();
    if (html !== undefined) transfer.setData("text/html", html);
    transfer.setData("text/plain", text ?? "");
    document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
}

async function openPreferences(page: Page) {
  await menuBarItem(page, "Tools").click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  const dialog = page.getByRole("dialog", { name: "Preferences" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("link bubble", () => {
  test("shows under a link at the cursor with Copy, Edit and Remove; Escape and typing hide it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await newDocument(page);
    await page.keyboard.type("Read ");
    await page.keyboard.press(`${mod}+k`);
    await page.getByLabel("Link URL").fill("https://example.com/guide/");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.keyboard.type(" now");
    const link = editor(page).locator("a");
    await expect(link).toHaveText("https://example.com/guide/");

    const bubble = page.getByRole("dialog", { name: "Change or remove link." });
    // Clicks at different places, so quick clicks are not taken for a double or triple click.
    const clickLink = (x: number) => link.click({ position: { x, y: 5 } });
    await expect(bubble).toHaveCount(0);
    await clickLink(20);
    await expect(bubble).toBeVisible();
    const box = (await bubble.boundingBox())!;
    expect(Math.round(box.width)).toBe(324);
    expect(Math.round(box.height)).toBe(67);
    // Just below the link's line, left-aligned with its start.
    const linkBox = (await link.boundingBox())!;
    expect(Math.abs(box.x - linkBox.x)).toBeLessThanOrEqual(2);
    expect(box.y).toBeGreaterThanOrEqual(linkBox.y + linkBox.height - 2);
    expect(box.y).toBeLessThan(linkBox.y + linkBox.height + 12);
    // The title (the address until the page's title is known) opens the link in a new tab; the address has no scheme.
    const title = bubble.getByRole("link");
    await expect(title).toHaveAttribute("href", "https://example.com/guide/");
    await expect(title).toHaveAttribute("target", "_blank");
    await expect(bubble.locator(".link-bubble-url")).toHaveText("example.com/guide");
    await expect(bubble.locator(".link-bubble-site")).toBeVisible();

    await bubble.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied to clipboard" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/guide/");

    await page.keyboard.press("Escape");
    await expect(bubble).toHaveCount(0);
    await clickLink(60);
    await expect(bubble).toBeVisible();
    // Moving off the link with the keyboard hides it; moving back shows it.
    await page.keyboard.press(lineEnd);
    await expect(bubble).toHaveCount(0);
    await clickLink(100);
    await expect(bubble).toBeVisible();
    await page.keyboard.type("x");
    await expect(bubble).toHaveCount(0);
    await page.keyboard.press("Backspace");

    await clickLink(140);
    await bubble.getByRole("button", { name: "Edit link" }).click();
    await expect(page.getByRole("heading", { name: "Edit link" })).toBeVisible();
    await expect(page.getByLabel("Link URL")).toHaveValue("https://example.com/guide/");
    await page.keyboard.press("Escape");

    await clickLink(40);
    await bubble.getByRole("button", { name: "Remove link" }).click();
    await expect(editor(page).locator("a")).toHaveCount(0);
    await expect(bubble).toHaveCount(0);
    expect(await documentText(page)).toBe("Read https://example.com/guide/ now");
  });

  test("clicking the title opens the link in a new tab", async ({ page, context }) => {
    // Serve the linked page locally so the test does not depend on the network.
    await context.route("https://example.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Guide</title><p>Linked page</p>" }),
    );
    await newDocument(page);
    await page.keyboard.type("Read ");
    await page.keyboard.press(`${mod}+k`);
    await page.getByLabel("Link URL").fill("https://example.com/guide/");
    await page.getByRole("button", { name: "Apply" }).click();
    await editor(page).locator("a").click({ position: { x: 20, y: 5 } });
    const bubble = page.getByRole("dialog", { name: "Change or remove link." });
    await expect(bubble).toBeVisible();

    // Hold the button like a person does (about 150 ms), so the card has frames to react in.
    const opened = context.waitForEvent("page", { timeout: 5000 });
    await bubble.getByRole("link").click({ delay: 150 });
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe("https://example.com/guide/");
    await expect(tab.getByText("Linked page")).toBeVisible();
    // The document keeps its cursor in the link.
    await expect(editor(page)).toBeFocused();
  });

  test("is not shown when Show link details is off", async ({ page }) => {
    await newDocument(page);
    const dialog = await openPreferences(page);
    await dialog.getByRole("checkbox", { name: "Show link details" }).uncheck();
    await dialog.getByRole("button", { name: "OK" }).click();
    await editor(page).click();
    await page.keyboard.type("Go to example.org ");
    await editor(page).locator("a").click();
    await page.waitForTimeout(200);
    await expect(page.getByRole("dialog", { name: "Change or remove link." })).toHaveCount(0);
  });
});

test.describe("automatic formatting", () => {
  test("smart quotes, dashes and substitutions; ⌘Z right after one restores what was typed", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.type('"hi" -- (c) 1/2 ');
    expect(await documentText(page)).toBe("“hi” – © ½ ");

    await page.keyboard.type("(r)");
    expect(await documentText(page)).toBe("“hi” – © ½ ®");
    await page.keyboard.press(`${mod}+z`);
    expect(await documentText(page)).toBe("“hi” – © ½ (r)");

    await page.keyboard.type(" a -->");
    expect(await documentText(page)).toBe("“hi” – © ½ (r) a →");
    await page.keyboard.press(`${mod}+z`);
    expect(await documentText(page)).toBe("“hi” – © ½ (r) a -->");
  });

  test("capitalises sentences and i", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.type("first words. then i said hi. ok then i ");
    expect(await documentText(page)).toBe("First words. Then I said hi. Ok then I ");
    // ⌘Z right after it gives back the small i.
    await page.keyboard.press(`${mod}+z`);
    expect(await documentText(page)).toBe("First words. Then I said hi. Ok then i ");
  });

  test("lists, headings and Markdown at the start of a paragraph", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.type("1. One");
    await expect(editor(page).locator("ol li")).toHaveText("One");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("* Bullet");
    await expect(editor(page).locator("ul li")).toHaveText("Bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("## Section");
    await expect(editor(page).locator("h2")).toHaveText("Section");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Make **bold** and *slanted* and ~~gone~~ and `code` text");
    await expect(editor(page).locator("strong")).toHaveText("bold");
    await expect(editor(page).locator("em")).toHaveText("slanted");
    await expect(editor(page).locator("s")).toHaveText("gone");
    await expect(editor(page).locator("code")).toHaveText("code");
    await expect(editor(page).locator("p", { hasText: "Make" })).toHaveText("Make bold and slanted and gone and code text");
    await page.keyboard.press("Enter");
    await page.keyboard.type("---");
    await expect(editor(page).locator("hr")).toHaveCount(1);

    // ⌘Z right after a list starts leaves "1. " as typed.
    await page.keyboard.type("1. ");
    await expect(editor(page).locator("ol")).toHaveCount(2);
    await page.keyboard.press(`${mod}+z`);
    await expect(editor(page).locator("ol")).toHaveCount(1);
    await expect(editor(page).locator("p", { hasText: "1." })).toHaveText("1. ");
  });

  test("a typed address becomes a link when followed by a space or Enter", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.type("Visit example.com ");
    await expect(editor(page).locator('a[href="https://example.com"]')).toHaveText("example.com");
    await page.keyboard.type("or https://www.example.org/path.");
    await page.keyboard.press("Enter");
    await expect(editor(page).locator('a[href="https://www.example.org/path"]')).toHaveText("https://www.example.org/path");
  });

  test("works in Suggesting mode, as suggestions", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.press(`${mod}+Alt+Shift+x`);
    await page.keyboard.type("## Plan with **bold** -- (c) ");
    await expect(editor(page).locator("h2")).toHaveCount(1);
    await expect(editor(page).locator("h2 strong")).toHaveText("bold");
    await expect(editor(page).locator("h2")).toHaveText("Plan with bold – © ");
    await expect(editor(page).locator(".suggestion-insert").first()).toBeVisible();
  });

  test("each preference can be turned off, and the settings persist", async ({ page }) => {
    await newDocument(page);
    let dialog = await openPreferences(page);
    for (const name of [
      "Automatically capitalise words",
      "Use smart quotes",
      "Automatically detect links",
      "Automatically detect lists",
      "Enable Markdown",
      "Show link details",
    ]) {
      await expect(dialog.getByRole("checkbox", { name })).toBeChecked();
      await dialog.getByRole("checkbox", { name }).uncheck();
    }
    await dialog.getByRole("tab", { name: "Substitutions" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Automatic substitution" })).toBeChecked();
    await dialog.getByRole("checkbox", { name: "Automatic substitution" }).uncheck();
    await dialog.getByRole("button", { name: "OK" }).click();

    await editor(page).click();
    await page.keyboard.type('hello "x" (c) example.com ');
    await page.keyboard.press("Enter");
    await page.keyboard.type("1. ## **b**");
    expect(await documentText(page)).toBe('hello "x" (c) example.com |1. ## **b**');
    await expect(editor(page).locator("a, ol, h2, strong")).toHaveCount(0);

    await page.reload();
    dialog = await openPreferences(page);
    await expect(dialog.getByRole("checkbox", { name: "Use smart quotes" })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Enable Markdown" })).not.toBeChecked();
    await dialog.getByRole("tab", { name: "Substitutions" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Automatic substitution" })).not.toBeChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("the substitutions list can be edited: add, switch off and remove pairs", async ({ page }) => {
    await newDocument(page);
    const dialog = await openPreferences(page);
    await dialog.getByRole("tab", { name: "Substitutions" }).click();
    // The default pairs, in order.
    await expect(dialog.getByRole("textbox", { name: "Replace (c)", exact: true })).toHaveValue("(c)");
    await expect(dialog.getByRole("textbox", { name: "With for (c)" })).toHaveValue("©");
    await expect(dialog.getByRole("textbox", { name: "Replace ---", exact: true })).toHaveValue("---");
    // The empty row at the top adds a pair.
    await dialog.getByRole("textbox", { name: "New replace text" }).fill("omw");
    await dialog.getByRole("textbox", { name: "With for omw" }).fill("on my way");
    await dialog.getByRole("checkbox", { name: "Use (r)" }).uncheck();
    await dialog.getByRole("button", { name: "Remove tm" }).click();
    await expect(dialog.getByRole("textbox", { name: "Replace tm", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "OK" }).click();

    await editor(page).click();
    await page.keyboard.type("Hi omw (r) tm (c) ");
    expect(await documentText(page)).toBe("Hi on my way (r) tm © ");
  });

  test("work in headers too", async ({ page }) => {
    await newDocument(page);
    await menuBarItem(page, "Insert").click();
    await page.getByRole("menuitem", { name: "Page elements" }).hover();
    await page.getByRole("menuitem", { name: "Header" }).click();
    const header = page.getByRole("textbox", { name: "Header" });
    await expect(header).toBeFocused();
    await page.keyboard.type('"draft" -- ');
    await expect(header).toHaveText("“draft” – ");
    await page.keyboard.press(`${mod}+z`);
    await expect(header).toHaveText("“draft” -- ");
  });
});

test.describe("keyboard shortcuts dialog", () => {
  test("⌘+/ opens it; the search filters the rows, shown with key caps", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.press(`${mod}+/`);
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    expect(Math.round((await dialog.boundingBox())!.width)).toBe(600);
    for (const group of ["Text formatting", "Paragraph formatting", "Actions", "Comments", "Menus", "Navigation"]) {
      await expect(dialog.getByRole("heading", { name: group })).toBeVisible();
    }
    await expect(dialog.getByRole("searchbox", { name: "Search" })).toBeFocused();
    // A filled 40px pill with the icon at the left; focused, a 2px primary outline.
    const pill = dialog.locator(".shortcuts-search");
    const pillStyle = await pill.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, height: style.height, border: style.borderTopStyle, outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}` };
    });
    expect(pillStyle).toEqual({ background: "rgb(241, 244, 248)", height: "40px", border: "none", outline: "solid 2px rgb(11, 87, 208)" });
    const pillBox = (await pill.boundingBox())!;
    const iconBox = (await pill.locator("svg").first().boundingBox())!;
    expect(iconBox.x - pillBox.x).toBeLessThan(24);
    await dialog.getByRole("button", { name: "Close dialogue" }).focus();
    await expect(pill).toHaveCSS("outline-style", "none");
    // Section headers in the text colour, 14px medium, 16px above and 8px below.
    const header = dialog.getByRole("heading", { name: "Text formatting" });
    const headerStyle = await header.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, size: style.fontSize, weight: style.fontWeight, top: style.marginTop, bottom: style.marginBottom };
    });
    expect(headerStyle).toEqual({ color: "rgb(31, 31, 31)", size: "14px", weight: "500", top: "16px", bottom: "8px" });
    // 44px rows with a 1px divider between them.
    const section = dialog.getByRole("region", { name: "Text formatting" });
    const sectionRows = section.getByRole("row");
    expect(Math.round((await sectionRows.nth(0).boundingBox())!.height)).toBe(44);
    await expect(sectionRows.nth(0)).toHaveCSS("border-top-style", "none");
    await expect(sectionRows.nth(1)).toHaveCSS("border-top", "1px solid rgb(225, 227, 225)");
    await dialog.getByRole("searchbox", { name: "Search" }).focus();
    await page.keyboard.type("bold");
    const rows = dialog.getByRole("row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByRole("rowheader")).toHaveText("Bold");
    const caps = rows.first().locator("kbd");
    await expect(caps).toHaveText(process.platform === "darwin" ? ["⌘", "B"] : ["Ctrl", "B"]);
    const capStyle = await caps.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { border: style.borderTopColor, radius: style.borderTopLeftRadius, size: style.fontSize };
    });
    expect(capStyle).toEqual({ border: "rgb(116, 119, 117)", radius: "4px", size: "12px" });

    await dialog.getByRole("searchbox", { name: "Search" }).fill("redo");
    await expect(dialog.getByRole("row").first()).toContainText("or");
    await dialog.getByRole("button", { name: "Close dialogue" }).click();
    await expect(dialog).toHaveCount(0);

    await menuBarItem(page, "Tools").click();
    await expect(page.getByRole("menuitem", { name: "Keyboard shortcuts" })).toContainText(process.platform === "darwin" ? "⌘+/" : "Ctrl+/");
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("paste", () => {
  test("HTML from a word processor keeps headings, lists, tables and formatting and drops Word's markup", async ({ page }) => {
    await newDocument(page);
    await paste(page, { html: readFileSync(join(import.meta.dirname, "fixtures/word-paste.html"), "utf8"), text: "Quarterly review" });
    const content = editor(page);
    await expect(content.locator('p[data-paragraph-style="title"]')).toHaveText("Quarterly review");
    await expect(content.locator("h1")).toHaveText("Summary");
    await expect(content.locator("ul").first().locator(":scope > li")).toHaveCount(2);
    await expect(content.locator("ul > li ul > li")).toHaveText("Nested point");
    await expect(content.locator("ul").first().locator(":scope > li").first()).toContainText("First point");
    await expect(content.locator("ol > li")).toHaveText(["Step one", "Step two"]);
    await expect(content.locator("table tr")).toHaveCount(2);
    await expect(content.locator("table")).toContainText("£1.2m");
    await expect(content.locator("strong").first()).toHaveText("twelve percent");
    await expect(content.locator("em")).toHaveText("flat");
    await expect(content.locator('a[href="https://example.com/report"]')).toHaveText("the full report");
    await expect(content.locator("sub")).toHaveText("2");
    await expect(content.locator("sup")).toHaveText("2");
    await expect(content.locator("u")).toHaveText("underlined");
    await expect(content.locator("s")).toHaveText("struck");
    const html = await content.innerHTML();
    expect(html).not.toMatch(/mso-|Mso|o:p|supportLists|font-family|background/);
    // The list markers Word writes as text are gone.
    expect(await documentText(page)).not.toContain("·");
  });

  test("web images are uploaded with a placeholder in the meantime, script and classes dropped", async ({ page, request }) => {
    await newDocument(page);
    // An image on "another site": an upload served by the API server, fetched again by URL.
    const form = { file: { name: "dot.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") } };
    const uploaded = (await (await request.post("http://localhost:3101/api/uploads", { multipart: form })).json()).url as string;
    const remote = `http://127.0.0.1:3101${uploaded}`;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/uploads/remote", async (route) => {
      await held;
      await route.continue();
    });
    await paste(page, {
      html: `<meta charset="utf-8"><div class="post" style="background-color:#eee"><h2 class="title">From the web</h2><p class="lead" style="background-color: #ffe"><span style="font-family: Arial; font-size: 11pt; color: rgb(200, 0, 0)">Red text</span><script>window.pasted = true</script></p><img src="${remote}" width="120" height="80" alt="dot"><img src="data:image/png;base64,${PNG_BASE64}" width="30" height="20"></div>`,
      text: "From the web",
    });
    const content = editor(page);
    await expect(content.locator("h2")).toHaveText("From the web");
    // The remote image waits for its upload as a grey placeholder of its size.
    const placeholder = content.locator(".image-frame.is-uploading img");
    await expect(placeholder).toHaveCount(1);
    expect(Math.round((await placeholder.boundingBox())!.width)).toBe(120);
    release();
    await expect(content.locator(".image-frame.is-uploading")).toHaveCount(0);
    const sources = await content.locator(".image-frame img").evaluateAll((images) => images.map((image) => image.getAttribute("src")));
    expect(sources).toHaveLength(2);
    for (const src of sources) {
      expect(src).toMatch(/^\/uploads\/[\w-]+\.png$/);
      expect(src).not.toBe(uploaded);
    }
    const html = await content.innerHTML();
    expect(html).not.toMatch(/class="(post|title|lead)"|script|font-family|background/);
    await expect(content.locator('span[style*="color"]')).toHaveText("Red text");
    expect(await page.evaluate(() => (window as unknown as { pasted?: boolean }).pasted)).toBeUndefined();
  });

  test("a URL pasted onto selected text links it; with Shift held only the text is pasted", async ({ page }) => {
    await newDocument(page);
    await page.keyboard.type("See the docs");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await selectionSynced(page);
    await paste(page, { text: "https://example.com/docs" });
    await expect(editor(page).locator('a[href="https://example.com/docs"]')).toHaveText("docs");

    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.down("Shift");
    await paste(page, { html: "<h1>Big <i>title</i></h1>", text: "Plain words" });
    await page.keyboard.up("Shift");
    await expect(editor(page).locator("h1")).toHaveCount(0);
    // The plain text takes the formatting at the cursor.
    await expect(editor(page).locator("strong")).toHaveText("Plain words");
  });
});

test.describe("offline", () => {
  test("edits made while the server is unreachable are kept, restored after reopening, and saved once", async ({ page, context }) => {
    await newDocument(page);
    await page.keyboard.type("Saved text.");
    await waitUntilSaved(page);
    const url = page.url();

    await page.route("**/api/documents/*/steps", (route) => route.abort("internetdisconnected"));
    await page.keyboard.type(" Offline edit.");
    const indicator = page.getByRole("status").first();
    await expect(indicator).toHaveAttribute("title", "Offline – changes will be saved when you reconnect");
    await expect(indicator).toContainText("Offline – changes will be saved when you reconnect");
    const snackbar = page.getByRole("status").filter({ hasText: "You're offline. Changes will be saved when you reconnect." });
    await expect(snackbar).toBeVisible();
    await snackbar.getByRole("button", { name: "Dismiss" }).click();
    await expect(snackbar).toHaveCount(0);
    // The edits are in the browser's storage before the tab closes.
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
      const open = indexedDB.open("docs-offline");
      open.onsuccess = () => {
        const all = open.result.transaction("pendingSteps").objectStore("pendingSteps").getAll();
        all.onsuccess = () => resolve(all.result.length);
      };
    }))).toBe(1);
    await page.close();

    // The server is reachable again: opening the document restores and saves the edits.
    const reopened = await context.newPage();
    await reopened.goto(url);
    await expect(editor(reopened)).toHaveText("Saved text. Offline edit.");
    await waitUntilSaved(reopened);
    await reopened.reload();
    await expect(editor(reopened)).toHaveText("Saved text. Offline edit.");
  });

  test("a batch the server applied before the tab closed is not applied twice", async ({ page, context }) => {
    await newDocument(page);
    await page.keyboard.type("Start.");
    await waitUntilSaved(page);
    const url = page.url();
    // The server applies the batch but the answer never arrives (as if the tab crashed meanwhile).
    await page.route("**/api/documents/*/steps", async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    });
    await page.keyboard.type(" Once.");
    await expect(page.getByRole("status").first()).toHaveAttribute("title", /Offline/);
    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(url);
    await waitUntilSaved(reopened);
    await reopened.reload();
    await expect(editor(reopened)).toHaveText("Start. Once.");
  });

  test("shows the offline snackbar once, and offers the unsaved text if the document was deleted", async ({ page, context }) => {
    await newDocument(page);
    await page.keyboard.type("Keep.");
    await waitUntilSaved(page);
    const url = page.url();
    const id = url.split("/").pop()!;

    const snackbar = page.getByRole("status").filter({ hasText: "You're offline." });
    await page.route("**/api/documents/*/steps", (route) => route.abort("internetdisconnected"));
    await page.keyboard.type(" One.");
    await expect(snackbar).toBeVisible();
    await page.unroute("**/api/documents/*/steps");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitUntilSaved(page);
    await expect(snackbar).toHaveCount(0);
    await page.route("**/api/documents/*/steps", (route) => route.abort("internetdisconnected"));
    await page.keyboard.type(" Two.");
    await expect(page.getByRole("status").first()).toHaveAttribute("title", /Offline/);
    await page.waitForTimeout(500);
    await expect(snackbar).toHaveCount(0);
    await page.close();

    // The document is deleted before the edits could be saved.
    const removed = await context.request.delete(`/api/documents/${id}`);
    expect(removed.status()).toBe(204);
    const reopened = await context.newPage();
    await reopened.goto(url);
    await expect(reopened.getByRole("heading", { name: "Document not found" })).toBeVisible();
    const dialog = reopened.getByRole("dialog", { name: "Couldn't restore unsaved changes" });
    await expect(dialog).toBeVisible();
    const download = reopened.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download unsaved text" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("Deleted document (unsaved changes).txt");
    expect(readFileSync(await file.path(), "utf8")).toContain("Two.");
    await expect(dialog).toHaveCount(0);
  });
});
