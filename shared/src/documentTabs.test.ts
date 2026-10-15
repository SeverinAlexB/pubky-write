import type { JSONContent } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import {
  copyTabContent,
  documentTabs,
  findTab,
  FIRST_TAB_ID,
  firstTab,
  subtreeIds,
  tabAtPos,
  rangeInTabsDocument,
  tabsDocument,
  tabTree,
  wrapInTab,
  type TabAttrs,
} from "./documentTabs.ts";
import { toMarkdown } from "./markdown.ts";
import { documentSchema } from "./schema.ts";
import { replaceDifference, versionEdits } from "./versionDiff.ts";

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });

const tab = (attrs: Partial<TabAttrs> & { id: string }, ...texts: string[]): JSONContent => ({
  type: "documentTab",
  attrs: { name: attrs.id, ...attrs },
  content: texts.map(paragraph),
});

const doc = (...content: JSONContent[]) => {
  const node = Node.fromJSON(documentSchema, { type: "doc", content });
  node.check();
  return node;
};

describe("the schema", () => {
  it("accepts documents of blocks and documents of tabs, but not both mixed", () => {
    expect(() => doc(paragraph("old document"))).not.toThrow();
    expect(() => doc(tab({ id: "a" }, "one"), tab({ id: "b" }, "two"))).not.toThrow();
    expect(() => doc(paragraph("loose"), tab({ id: "a" }, "one"))).toThrow();
  });

  it("rejects invalid tab attributes", () => {
    expect(() => doc(tab({ id: "has space" }, "x"))).toThrow();
    expect(() => doc(tab({ id: "a", name: "  " }, "x"))).toThrow();
    expect(() => doc(tab({ id: "a", order: -1 }, "x"))).toThrow();
  });

  it("fills an emptied document with a paragraph, not a tab", () => {
    expect(documentSchema.topNodeType.createAndFill()!.firstChild!.type.name).toBe("paragraph");
  });

  it("never wraps pasted blocks into a new tab", () => {
    const tabbed = doc(tab({ id: "a" }, "one"));
    const transform = new Transform(tabbed).insert(tabbed.content.size, documentSchema.nodes.paragraph!.create());
    expect(transform.doc.eq(tabbed)).toBe(true);
  });
});

describe("documentTabs", () => {
  it("describes a document without tab nodes as one tab, Tab 1, over the whole content", () => {
    const old = doc(paragraph("hello"), paragraph("world"));
    expect(documentTabs(old)).toEqual([
      expect.objectContaining({ id: FIRST_TAB_ID, name: "Tab 1", pos: null, from: 0, to: old.content.size, node: old }),
    ]);
    expect(tabAtPos(old, 3)?.id).toBe(FIRST_TAB_ID);
    expect(firstTab(old).id).toBe(FIRST_TAB_ID);
  });

  it("lists tab nodes with their content ranges", () => {
    const tabbed = doc(tab({ id: "a" }, "one"), tab({ id: "b" }, "two"));
    const [a, b] = documentTabs(tabbed);
    expect(tabbed.textBetween(a!.from, a!.to)).toBe("one");
    expect(tabbed.textBetween(b!.from, b!.to)).toBe("two");
    expect(tabAtPos(tabbed, b!.from + 1)?.id).toBe("b");
    // Between two tab nodes is in no tab.
    expect(tabAtPos(tabbed, b!.pos!)).toBeNull();
  });
});

describe("tabTree", () => {
  it("orders tabs by their order attribute and nests subtabs under their parent", () => {
    const tabbed = doc(
      tab({ id: "c", order: 3 }, "c"),
      tab({ id: "a", order: 0 }, "a"),
      tab({ id: "a1", order: 1, parentId: "a" }, "a1"),
      tab({ id: "b", order: 2 }, "b"),
    );
    expect(tabTree(tabbed).map(({ id, depth, parent }) => ({ id, depth, parent }))).toEqual([
      { id: "a", depth: 0, parent: null },
      { id: "a1", depth: 1, parent: "a" },
      { id: "b", depth: 0, parent: null },
      { id: "c", depth: 0, parent: null },
    ]);
    expect(firstTab(tabbed).id).toBe("a");
    expect(subtreeIds(tabbed, "a")).toEqual(["a", "a1"]);
  });

  it("puts tabs with a missing parent, a cycle or too deep a nesting at the top level", () => {
    const tabbed = doc(
      tab({ id: "a", order: 0 }, ""),
      tab({ id: "b", order: 1, parentId: "a" }, ""),
      tab({ id: "c", order: 2, parentId: "b" }, ""),
      tab({ id: "d", order: 3, parentId: "c" }, ""),
      tab({ id: "x", order: 4, parentId: "y" }, ""),
      tab({ id: "y", order: 5, parentId: "x" }, ""),
      tab({ id: "z", order: 6, parentId: "gone" }, ""),
    );
    expect(Object.fromEntries(tabTree(tabbed).map(({ id, depth }) => [id, depth]))).toEqual({ a: 0, b: 1, c: 2, d: 0, x: 0, y: 0, z: 0 });
  });
});

describe("wrapInTab", () => {
  it("gives a document of blocks its tab node, moving positions by one", () => {
    const old = doc(paragraph("hello"));
    const transform = wrapInTab(new Transform(old));
    expect(transform.doc.childCount).toBe(1);
    expect(transform.doc.firstChild!.type.name).toBe("documentTab");
    expect(transform.doc.firstChild!.attrs).toMatchObject({ id: FIRST_TAB_ID, name: "Tab 1" });
    expect(transform.doc.firstChild!.content.eq(old.content)).toBe(true);
    expect(transform.mapping.map(1)).toBe(2);
    // A no-op on a document with tabs.
    expect(wrapInTab(new Transform(transform.doc)).steps).toHaveLength(0);
  });

  it("keeps stored steps applicable: steps from before tabs apply first, the wrap after", () => {
    const old = doc(paragraph("hello"));
    const stored = new Transform(old).insert(6, documentSchema.text(" world"));
    const json = stored.steps.map((step) => step.toJSON());
    let replayed = old;
    for (const step of json) replayed = Step.fromJSON(documentSchema, step).apply(replayed).doc!;
    const wrapped = wrapInTab(new Transform(replayed));
    const steps = wrapped.steps.map((step) => Step.fromJSON(documentSchema, step.toJSON()));
    let server = replayed;
    for (const step of steps) server = step.apply(server).doc!;
    expect(server.textContent).toBe("hello world");
    expect(documentTabs(server)[0]!.pos).toBe(0);
  });
});

describe("tabsDocument", () => {
  const tabbed = doc(tab({ id: "b", name: "Second", order: 1 }, "two"), tab({ id: "a", name: "First", order: 0 }, "one"));

  it("is one tab's blocks", () => {
    expect(tabsDocument(tabbed, "b").content.eq(findTab(tabbed, "b")!.node.content)).toBe(true);
    expect(tabsDocument(tabbed, "unknown").textContent).toBe("one");
  });

  it("is all tabs in sidebar order, each from a new page under its name as a Heading 1", () => {
    expect(toMarkdown(tabsDocument(tabbed, "all"))).toBe("# First\n\none\n\n<!-- page break -->\n\n# Second\n\ntwo\n");
  });

  it("keeps the page setup", () => {
    const transform = new Transform(tabbed).setDocAttribute("orientation", "landscape");
    expect(tabsDocument(transform.doc, "a").attrs.orientation).toBe("landscape");
  });

  it("moves comment ranges to where their text is in the exported tabs", () => {
    const rangeOf = (source: Node, text: string) => {
      let found = { from: 0, to: 0 };
      source.descendants((node, pos) => {
        if (node.isText && node.text!.includes(text)) found = { from: pos + node.text!.indexOf(text), to: pos + node.text!.indexOf(text) + text.length };
      });
      return found;
    };
    for (const which of ["a", "b", "all"]) {
      const exported = tabsDocument(tabbed, which);
      for (const text of ["one", "two"]) {
        const range = rangeInTabsDocument(tabbed, which, rangeOf(tabbed, text));
        if (which !== "all" && text !== { a: "one", b: "two" }[which]) expect(range).toBeNull();
        else expect(exported.textBetween(range!.from, range!.to)).toBe(text);
      }
    }
    const plain = doc(paragraph("solo"));
    expect(rangeInTabsDocument(plain, "all", { from: 1, to: 5 })).toEqual({ from: 1 + "Tab 1".length + 2, to: 5 + "Tab 1".length + 2 });
    expect(tabsDocument(plain, "all").textBetween(8, 12)).toBe("solo");
  });
});

it("copyTabContent gives suggestions new ids, the same new id for every part of one suggestion", () => {
  const mark = (id: string) => ({ type: "suggestionInsert", attrs: { id, author: "You", createdAt: 1 } });
  const content: JSONContent[] = [
    { type: "paragraph", content: [{ type: "text", text: "a", marks: [mark("s1")] }, { type: "text", text: "b", marks: [mark("s2")] }] },
    { type: "paragraph", attrs: { suggestionBreak: { kind: "insert", id: "s1", author: "You", createdAt: 1 } }, content: [{ type: "text", text: "c", marks: [mark("s1")] }] },
  ];
  let next = 0;
  const copy = copyTabContent(content, () => `n${++next}`);
  const ids = JSON.stringify(copy).match(/"id":"[^"]+"/g);
  expect(ids).toEqual(['"id":"n1"', '"id":"n2"', '"id":"n1"', '"id":"n1"']);
  expect(content[0]!.content![0]!.marks![0]!.attrs!.id).toBe("s1");
});

it("copyTabContent gives object and footnote suggestions new ids too", () => {
  const meta = (id: string) => ({ id, author: "You", createdAt: 1 });
  const content: JSONContent[] = [
    { type: "image", attrs: { src: "/a.png", suggestionInsert: meta("s1") } },
    {
      type: "paragraph",
      content: [
        {
          type: "footnote",
          attrs: { content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "suggestionDelete", attrs: meta("s2") }] }] }] },
        },
      ],
    },
  ];
  let next = 0;
  const copy = copyTabContent(content, () => `n${++next}`);
  expect(JSON.stringify(copy).match(/"id":"[^"]+"/g)).toEqual(['"id":"n1"', '"id":"n2"']);
  expect(content[0]!.attrs!.suggestionInsert.id).toBe("s1");
});

describe("version history with tabs", () => {
  it("finds no edits between a version from before tabs and the same content in its tab", () => {
    const old = doc(paragraph("hello"));
    const wrapped = wrapInTab(new Transform(old)).doc;
    expect(versionEdits(old, wrapped)).toEqual([]);
  });

  it("finds edits per tab, a new tab's text as added, with positions in the document", () => {
    const before = doc(tab({ id: "a" }, "one"));
    const after = doc(tab({ id: "a" }, "one more"), tab({ id: "b" }, "new tab"));
    const edits = versionEdits(before, after).map((edit) => after.textBetween(edit.from, edit.to));
    expect(edits).toEqual([" more", "new tab"]);
  });

  it("restores a renamed tab with an attribute step, keeping its content in place", () => {
    const current = doc(tab({ id: "a", name: "Renamed" }, "keep"));
    const version = doc(tab({ id: "a", name: "Original" }, "keep"));
    const transform = replaceDifference(current, version);
    expect(transform.doc.eq(version)).toBe(true);
    expect(transform.steps.every((step) => step.constructor.name === "AttrStep")).toBe(true);
  });

  it("restores a version from before tabs into the document's first tab", () => {
    const current = doc(tab({ id: FIRST_TAB_ID, name: "Tab 1" }, "new text"));
    const version = doc(paragraph("old text"));
    const restored = replaceDifference(current, version).doc;
    expect(findTab(restored, FIRST_TAB_ID)?.node.textContent).toBe("old text");
  });
});
