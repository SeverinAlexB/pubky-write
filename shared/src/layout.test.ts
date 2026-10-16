// Spec 19: column settings, the column break node and the images' layout attributes. Documents and
// steps saved before them keep working; invalid values are rejected like any invalid step.
import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { columnsOf, columnSpacingCm, columnWidths, defaultColumnSettings } from "./columns.ts";
import { imageFilterStyle, imageFrameStyle, imageLayoutOf, imageMarginLabel, isImageCrop, normalizeRotation, wrapSide } from "./images.ts";
import { replaceDifference } from "./versionDiff.ts";
import { documentSchema } from "./schema.ts";

const oldDocument = {
  type: "doc",
  attrs: { paperSize: "A4" },
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Before" }] },
    { type: "image", attrs: { src: "/uploads/a.png", alt: "Chart", width: 200, height: 100 } },
    { type: "paragraph", content: [{ type: "text", text: "After" }] },
  ],
};

describe("documents from before columns and image layout", () => {
  it("load with one column and images in line with text", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    doc.check();
    expect(columnsOf(doc)).toEqual(defaultColumnSettings);
    const image = doc.child(1);
    expect(image.attrs).toMatchObject({ wrap: "inline", positioning: "moveWithText", rotation: 0, crop: null, recolor: null });
    expect(imageLayoutOf(image.attrs)).toMatchObject({ wrap: "inline", wrapMargin: 9, offsetX: 0, offsetY: 0 });
  });

  it("apply steps stored before them", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    const step = Step.fromJSON(documentSchema, { stepType: "attr", pos: 8, attr: "alt", value: "Sales" });
    const result = step.apply(doc);
    expect(result.failed).toBeNull();
    expect(result.doc!.child(1).attrs.alt).toBe("Sales");
  });
});

describe("column settings", () => {
  it("are document attributes changed with steps, validated like the page setup", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    const transform = new Transform(doc).setDocAttribute("columns", 2).setDocAttribute("columnLine", true);
    expect(columnsOf(transform.doc)).toEqual({ columns: 2, columnSpacing: 36, columnLine: true });
    const json = transform.steps.map((step) => step.toJSON());
    const replayed = json.reduce((current, stepJSON) => Step.fromJSON(documentSchema, stepJSON).apply(current).doc!, doc);
    expect(replayed.attrs.columns).toBe(2);

    for (const [attr, value] of [
      ["columns", 4],
      ["columns", 1.5],
      ["columnSpacing", -1],
      ["columnLine", "yes"],
    ] as const) {
      expect(() => new Transform(doc).setDocAttribute(attr, value).doc.check(), `${attr} ${value}`).toThrow();
    }
  });

  it("are restored from an older version", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    const twoColumns = new Transform(doc).setDocAttribute("columns", 2).doc;
    expect(replaceDifference(twoColumns, doc).doc.attrs.columns).toBe(1);
  });

  it("show the spacing in centimetres", () => {
    expect(columnSpacingCm(36)).toBe(1.27);
  });

  it("divide the content width into equal columns, never narrower than 1 cm", () => {
    expect(columnWidths({ columns: 1, columnSpacing: 36, columnLine: false }, 602).width).toBe(602);
    expect(columnWidths({ columns: 2, columnSpacing: 36, columnLine: false }, 602)).toEqual({ width: 277, gap: 48 });
    // 216pt (288px) of spacing would leave three columns 9px wide: the spacing shrinks.
    expect(columnWidths({ columns: 3, columnSpacing: 216, columnLine: false }, 602).width).toBe(38);
  });

  it("allow column breaks in the body, not in headers", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph" }, { type: "columnBreak" }, { type: "paragraph" }] });
    doc.check();
    expect(() => new Transform(doc).setDocAttribute("header", [{ type: "columnBreak" }]).doc.check()).toThrow();
  });
});

describe("image layout", () => {
  it("validates the attributes of image steps", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    const set = (attr: string, value: unknown) => () => new Transform(doc).setNodeAttribute(8, attr, value).doc.check();
    expect(set("wrap", "wrap")).not.toThrow();
    expect(set("rotation", 45)).not.toThrow();
    expect(set("crop", { top: 0.1, right: 0, bottom: 0.2, left: 0 })).not.toThrow();
    expect(set("wrap", "around")).toThrow();
    expect(set("rotation", 400)).toThrow();
    expect(set("crop", { top: 0.6, right: 0, bottom: 0.6, left: 0 })).toThrow();
    expect(set("transparency", 101)).toThrow();
    expect(set("recolor", "blue")).toThrow();
  });

  it("checks crops: inside the image with some of it visible", () => {
    expect(isImageCrop({ top: 0, right: 0.5, bottom: 0, left: 0.4 })).toBe(true);
    expect(isImageCrop({ top: 0, right: 0.5, bottom: 0, left: 0.5 })).toBe(false);
    expect(isImageCrop({ top: 0, right: 0, bottom: 0 })).toBe(false);
  });

  it("normalises rotations and labels margins", () => {
    expect(normalizeRotation(-15)).toBe(345);
    expect(normalizeRotation(360)).toBe(0);
    expect(imageMarginLabel(9)).toBe("3.2mm margin");
    expect(imageMarginLabel(36)).toBe("12.7mm margin");
  });

  it("floats wrapped images to the side with less room, so the text gets the wider side", () => {
    const layout = imageLayoutOf({ wrap: "wrap", offsetX: 30 });
    expect(wrapSide(layout, 200, 600)).toBe("left");
    expect(wrapSide({ ...layout, offsetX: 380 }, 200, 600)).toBe("right");
    expect(imageFrameStyle(layout, 200, "left")).toContain("float: left");
    expect(imageFrameStyle({ ...layout, offsetX: 380 }, 200, "right")).toContain("calc(100% - 580px)");
  });

  it("puts text on both sides of a wrapped image with 1 cm of free text width on each side beyond its margin", () => {
    // The default margin is 3.2 mm (12px); 1 cm is 37.8px.
    const layout = imageLayoutOf({ wrap: "wrap", offsetX: 50 });
    expect(wrapSide(layout, 200, 600)).toBe("both");
    expect(wrapSide({ ...layout, offsetX: 49 }, 200, 600)).toBe("left");
    expect(wrapSide({ ...layout, offsetX: 300 }, 200, 600)).toBe("both");
    expect(wrapSide({ ...layout, offsetX: 351 }, 200, 600)).toBe("right");
    expect(wrapSide({ ...layout, wrapMargin: 0 }, 200, 600)).toBe("both");
    // Out of the text's flow, where the image is.
    expect(imageFrameStyle(layout, 200, "both")).toBe("position: absolute; margin: 0 0 0 50px; margin-top: 0px");
  });

  it("styles each wrap mode", () => {
    const layout = (attrs: Record<string, unknown>) => imageLayoutOf(attrs);
    expect(imageFrameStyle(layout({}), 100)).toBe("");
    expect(imageFrameStyle(layout({ wrap: "break", offsetX: 20 }), 100)).toContain("margin: 12px 0 12px 20px");
    expect(imageFrameStyle(layout({ wrap: "behind", offsetX: -10, offsetY: 30 }), 100)).toContain("position: absolute; margin: 30px 0 0 -10px");
    expect(imageFrameStyle(layout({ wrap: "front", positioning: "fixed", offsetX: 40, offsetY: 50 }), 100)).toContain(
      "top: calc(var(--image-page-top, 0px) + 50px)",
    );
    expect(imageFrameStyle(layout({ rotation: 90 }), 100)).toBe("transform: rotate(90deg)");
    expect(imageFilterStyle(layout({ recolor: "greyscale", transparency: 25, brightness: 10 }))).toBe(
      "filter: grayscale(1) brightness(1.1); opacity: 0.75",
    );
  });

  it("keeps the layout when copied as HTML", () => {
    const image = documentSchema.nodes.image!.create({ src: "/a.png", wrap: "wrap", offsetX: 12, rotation: 30, crop: { top: 0, right: 0.1, bottom: 0, left: 0.2 } });
    const spec = documentSchema.nodes.image!.spec.toDOM!(image) as readonly unknown[];
    expect(spec[0]).toBe("div");
    expect(spec[1]).toMatchObject({ "data-wrap": "wrap", "data-offset-x": "12", "data-rotation": "30", "data-crop": "0 0.1 0 0.2" });
  });
});
