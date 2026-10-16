// Performance with a large document: run with `npm run perf` (see playwright.perf.config.ts).
// Builds a 60-page document and measures opening, pagination settling and typing on pages 1 and 50.
import { writeFileSync } from "node:fs";
import { documentSchema } from "@pubky-write/shared";
import { expect, test, type Page } from "@playwright/test";

type Block = Record<string, unknown>;

const words =
  "the committee reviews quarterly figures and drafts a careful reply to every question raised by members during annual meeting while staff prepare summaries".split(
    " ",
  );

function text(count: number, seed: number): string {
  const result: string[] = [];
  for (let i = 0; i < count; i++) result.push(words[(seed * 7 + i * 3) % words.length]!);
  const sentence = result.join(" ");
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`;
}

const paragraph = (value: string): Block => ({ type: "paragraph", content: [{ type: "text", text: value }] });
const heading = (level: number, value: string): Block => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: value }] });

/** About one page per section: headings, paragraphs, a bulleted list and every tenth section a table. */
function largeDocument(sections: number): Block[] {
  const blocks: Block[] = [];
  for (let s = 0; s < sections; s++) {
    blocks.push(heading(1, `Section ${s + 1}`));
    for (let p = 0; p < 3; p++) blocks.push(paragraph(text(70, s * 10 + p)));
    blocks.push({
      type: "bulletList",
      content: Array.from({ length: 4 }, (_, i) => ({ type: "listItem", content: [paragraph(text(12, s + i))] })),
    });
    blocks.push(heading(2, `Details ${s + 1}`));
    for (let p = 0; p < 2; p++) blocks.push(paragraph(text(60, s * 10 + p + 5)));
    if (s % 10 === 5) {
      blocks.push({
        type: "table",
        content: Array.from({ length: 5 }, (_, row) => ({
          type: "tableRow",
          content: Array.from({ length: 3 }, (_, column) => ({
            type: row === 0 ? "tableHeader" : "tableCell",
            content: [paragraph(row === 0 ? `Column ${column + 1}` : text(4, row + column))],
          })),
        })),
      });
    }
  }
  return blocks;
}

/** Records page count changes and long tasks from the start of every page load. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    // Firefox and Safari do not report long tasks.
    const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const perf = { pageCountChanges: [] as { at: number; count: number }[], longTasks: [] as { at: number; duration: number }[], longTasksSupported };
    (window as unknown as { __perf: typeof perf }).__perf = perf;
    if (longTasksSupported) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) perf.longTasks.push({ at: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    }
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (record.attributeName === "data-page-count") {
          perf.pageCountChanges.push({ at: performance.now(), count: Number(target.dataset.pageCount) });
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-page-count"] });
  });
}

type PerfData = { pageCountChanges: { at: number; count: number }[]; longTasks: { at: number; duration: number }[]; longTasksSupported: boolean };
const perfData = (page: Page) => page.evaluate(() => (window as unknown as { __perf: PerfData }).__perf);

/** Puts the caret at the end of the first paragraph on `pageNumber` and scrolls it into view. */
async function placeCaretOnPage(page: Page, pageNumber: number) {
  await page.evaluate((target) => {
    type View = {
      state: { doc: { descendants: (f: (node: { type: { name: string }; nodeSize: number }, pos: number) => boolean | void) => void } };
      nodeDOM: (pos: number) => Node | null;
    };
    const editor = (document.querySelector(".ProseMirror") as unknown as { editor: { view: View; commands: Record<string, (...args: unknown[]) => boolean> } }).editor;
    const stack = document.querySelector<HTMLElement>(".page-stack")!;
    const sheets = stack.querySelectorAll<HTMLElement>(".page-sheets > .page");
    const sheet = sheets[target - 1]!.getBoundingClientRect();
    let found: number | null = null;
    editor.view.state.doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (node.type.name !== "paragraph") return true;
      const element = editor.view.nodeDOM(pos) as HTMLElement | null;
      const rect = element?.getBoundingClientRect();
      if (rect && rect.top >= sheet.top && rect.bottom <= sheet.bottom) found = pos + node.nodeSize - 1;
      return false;
    });
    if (found === null) throw new Error(`No paragraph on page ${target}`);
    editor.commands.focus();
    editor.commands.setTextSelection(found);
    editor.commands.scrollIntoView();
  }, pageNumber);
}

/**
 * Types `count` characters at a normal pace (one every 120 ms) and returns, per keystroke, the time
 * from the key event to the next frame after it was handled, plus the long tasks while typing.
 */
async function measureTyping(page: Page, count: number) {
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { __keySamples: number[] }).__keySamples = samples;
    document.addEventListener(
      "keydown",
      (event) => {
        const start = event.timeStamp;
        requestAnimationFrame(() => {
          // After this frame's rendering work.
          const channel = new MessageChannel();
          channel.port1.onmessage = () => samples.push(performance.now() - start);
          channel.port2.postMessage(null);
        });
      },
      true,
    );
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => performance.now());
  for (let i = 0; i < count; i++) {
    await page.keyboard.type(i % 6 === 5 ? " " : "x");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
  const result = await page.evaluate((since) => {
    const perf = (window as unknown as { __perf: PerfData }).__perf;
    return {
      samples: (window as unknown as { __keySamples: number[] }).__keySamples,
      longTasks: perf.longTasksSupported ? perf.longTasks.filter((task) => task.at >= since).map((task) => task.duration) : null,
    };
  }, before);
  const sorted = [...result.samples].sort((a, b) => a - b);
  const percentile = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!);
  return {
    keystrokes: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: Math.round(sorted.at(-1)!),
    // null where the browser does not report long tasks.
    longTasks: result.longTasks?.length ?? null,
    longestTask: result.longTasks ? Math.round(Math.max(0, ...result.longTasks)) : null,
  };
}

/** Slows the CPU down by this factor (Chrome DevTools throttling), e.g. PERF_CPU_THROTTLE=4 for a slower laptop. */
const cpuThrottle = Number(process.env.PERF_CPU_THROTTLE ?? 1);
const editorMode = process.env.PERF_MODE || null;

test("@perf a 60-page document opens, paginates and types quickly", async ({ page, request, browserName }) => {
  // CPU throttling and CPU profiles use the Chrome DevTools protocol.
  if (browserName !== "chromium" && (cpuThrottle > 1 || process.env.PERF_PROFILE)) throw new Error("PERF_CPU_THROTTLE and PERF_PROFILE need Chrome");
  const created = await (await request.post("/api/documents", { data: {} })).json();
  const content = largeDocument(80);
  const response = await request.post(`/api/documents/${created.id}/steps`, {
    data: { clientId: "perf", version: 0, steps: [{ stepType: "replace", from: 0, to: 2, slice: { content } }] },
  });
  expect(response.ok()).toBe(true);
  const { version } = await response.json();

  // A comment on the first paragraph of every fourth section, so the comment margin is shown.
  const doc = documentSchema.nodeFromJSON({ type: "doc", content });
  let section = 0;
  const commentRanges: { from: number; to: number }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "heading" && node.attrs.level === 1) section++;
    else if (node.type.name === "paragraph" && section % 4 === 1 && doc.resolve(offset).index() > 0) {
      if (!commentRanges.some((range) => range.from > offset - 2000)) commentRanges.push({ from: offset + 1, to: offset + 20 });
    }
  });
  for (const range of commentRanges) {
    const comment = await request.post(`/api/documents/${created.id}/comments`, { data: { version, ...range, body: "Please check this." } });
    expect(comment.ok()).toBe(true);
  }

  // The outline and the live word count are open, as the heaviest everyday setup.
  // PERF_MODE=suggesting types in Suggesting mode (every keystroke becomes part of a suggestion).
  await page.addInitScript(
    ({ id, mode }) => {
      localStorage.setItem("docs.outlineOpen", "true");
      localStorage.setItem("docs.wordCountVisible", "true");
      if (mode) localStorage.setItem(`docs.mode.${id}`, mode);
    },
    { id: created.id as string, mode: editorMode },
  );
  if (cpuThrottle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  }
  await instrument(page);
  // Warm the HTTP cache and the server like a second visit would.
  await page.goto(`/d/${created.id}`);
  await expect(page.locator(".page-stack[data-page-count]")).toBeVisible();

  const runs: { open: number; settled: number; pages: number; longestTask: number | null }[] = [];
  for (let run = 0; run < 3; run++) {
    await page.goto(`/d/${created.id}`);
    await expect(page.getByLabel("Document content")).toBeVisible();
    // Settled: the page count has not changed for a second.
    await expect
      .poll(async () => {
        const { pageCountChanges } = await perfData(page);
        const now = await page.evaluate(() => performance.now());
        return pageCountChanges.length > 0 && now - pageCountChanges.at(-1)!.at > 1000;
      }, { timeout: 30_000 })
      .toBe(true);
    const data = await perfData(page);
    runs.push({
      // Open: the editor is shown and its first page layout is drawn.
      open: Math.round(data.pageCountChanges[0]!.at),
      settled: Math.round(data.pageCountChanges.at(-1)!.at),
      pages: data.pageCountChanges.at(-1)!.count,
      longestTask: data.longTasksSupported ? Math.round(Math.max(0, ...data.longTasks.map((task) => task.duration))) : null,
    });
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const opening = {
    pages: runs[0]!.pages,
    openMs: median(runs.map((run) => run.open)),
    settledMs: median(runs.map((run) => run.settled)),
    longestTaskMs: runs[0]!.longestTask === null ? null : median(runs.map((run) => run.longestTask!)),
  };

  expect(opening.pages).toBeGreaterThanOrEqual(60);

  await placeCaretOnPage(page, 1);
  const page1 = await measureTyping(page, 40);
  await placeCaretOnPage(page, 50);
  // PERF_PROFILE=<file.cpuprofile> records a CPU profile of typing on page 50 (open it in Chrome DevTools).
  const profiler = process.env.PERF_PROFILE ? await page.context().newCDPSession(page) : null;
  await profiler?.send("Profiler.enable");
  await profiler?.send("Profiler.start");
  const page50 = await measureTyping(page, 40);
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    writeFileSync(process.env.PERF_PROFILE!, JSON.stringify(profile));
  }

  const report = { browser: browserName, cpuThrottle, mode: editorMode ?? "editing", comments: commentRanges.length, opening, typingOnPage1: page1, typingOnPage50: page50 };
  console.log(JSON.stringify(report, null, 2));
  test.info().annotations.push({ type: "perf", description: JSON.stringify(report) });
});
