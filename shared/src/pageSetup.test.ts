import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import {
  defaultPageSetup,
  defaultPaperSize,
  lengthUnit,
  normalizePageSetup,
  pageGeometry,
  pageSetupOf,
} from "./pageSetup.ts";
import { documentSchema } from "./schema.ts";

const oldDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }] };

describe("page setup", () => {
  it("loads documents saved without page settings with the defaults", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    expect(pageSetupOf(doc)).toEqual(defaultPageSetup);
    expect(doc.toJSON().attrs).toMatchObject({ paperSize: "A4", orientation: "portrait", marginTop: 72 });
  });

  it("changes page settings with a step that survives JSON", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    const transform = new Transform(doc).setDocAttribute("paperSize", "Letter").setDocAttribute("orientation", "landscape");
    const steps = transform.steps.map((step) => Step.fromJSON(documentSchema, JSON.parse(JSON.stringify(step.toJSON()))));
    const result = steps.reduce((current, step) => step.apply(current).doc!, doc);
    expect(pageSetupOf(result)).toMatchObject({ paperSize: "Letter", orientation: "landscape" });
    expect(result.eq(doc)).toBe(false);
    expect(Node.fromJSON(documentSchema, result.toJSON()).attrs.orientation).toBe("landscape");
  });

  it("stores the page colour, white by default", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    expect(doc.attrs.pageColor).toBe("#ffffff");
    const coloured = Step.fromJSON(documentSchema, { stepType: "docAttr", attr: "pageColor", value: "#fce5cd" }).apply(doc).doc!;
    expect(pageSetupOf(coloured).pageColor).toBe("#fce5cd");
    expect(normalizePageSetup({ pageColor: "blue" }).pageColor).toBe("#ffffff");
  });

  it("rejects steps with invalid page settings", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    for (const [attr, value] of [
      ["paperSize", "Napkin"],
      ["orientation", "sideways"],
      ["marginTop", -1],
      ["marginLeft", "72"],
      ["pageColor", "red"],
      ["pageColor", "#FFFFFF"],
    ] as const) {
      const step = Step.fromJSON(documentSchema, { stepType: "docAttr", attr, value });
      expect(() => step.apply(doc)).toThrow();
    }
  });

  it("measures pages in CSS pixels", () => {
    expect(pageGeometry(defaultPageSetup)).toEqual({
      width: 794,
      height: 1123,
      marginTop: 96,
      marginBottom: 96,
      marginLeft: 96,
      marginRight: 96,
    });
    expect(pageGeometry({ ...defaultPageSetup, paperSize: "Letter", orientation: "landscape" })).toMatchObject({
      width: 1056,
      height: 816,
    });
  });

  it("ignores invalid stored values", () => {
    expect(normalizePageSetup({ paperSize: "B9", orientation: 3, marginTop: -4, marginLeft: 36 })).toEqual({
      ...defaultPageSetup,
      marginLeft: 36,
    });
  });

  it("chooses Letter and inches for the United States and A4 and centimetres elsewhere", () => {
    expect(defaultPaperSize("en-US")).toBe("Letter");
    expect(defaultPaperSize("en")).toBe("Letter");
    expect(defaultPaperSize("en-GB")).toBe("A4");
    expect(defaultPaperSize("de-CH")).toBe("A4");
    expect(defaultPaperSize("not a locale")).toBe("A4");
    expect(lengthUnit("en-US")).toBe("in");
    expect(lengthUnit("en-GB")).toBe("cm");
    expect(lengthUnit("fr-CA")).toBe("cm");
  });
});
