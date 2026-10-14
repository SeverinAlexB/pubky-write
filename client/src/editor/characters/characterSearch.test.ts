import { describe, expect, it } from "vitest";
import characterData from "./characterData.json" with { type: "json" };
import { codePointLabel, parseCodePoint, searchCharacters, type CharacterData } from "./characterSearch.ts";

const data = characterData as CharacterData;

describe("special characters", () => {
  it("bundles the listed categories and subcategories", () => {
    expect(data.categories.map((category) => category.name)).toEqual(["Symbol", "Punctuation", "Emoji", "Number", "Latin"]);
    const symbol = data.categories[0]!.subcategories.map((subcategory) => subcategory.name);
    expect(symbol).toEqual(expect.arrayContaining(["Arrows", "Currency", "Math", "Shapes", "Stars", "Technical"]));
    for (const category of data.categories) {
      for (const subcategory of category.subcategories) expect(subcategory.characters.length).toBeGreaterThan(0);
    }
  });

  it("names characters in sentence case", () => {
    const [arrow] = searchCharacters(data, "U+2192");
    expect(arrow).toEqual({ code: 0x2192, char: "→", name: "Rightwards arrow" });
    expect(searchCharacters(data, "U+0041")[0]!.name).toBe("Latin capital letter A");
    expect(searchCharacters(data, "U+0061")[0]!.name).toBe("Latin small letter a");
  });

  it("finds characters by keyword across all categories", () => {
    const arrows = searchCharacters(data, "arrow");
    expect(arrows.length).toBeGreaterThan(50);
    expect(arrows.every((info) => /arrow/i.test(info.name))).toBe(true);
    expect(arrows.map((info) => info.char)).toContain("→");

    // Every word must match the start of a word of the name.
    const results = searchCharacters(data, "right double");
    expect(results.map((info) => info.char)).toContain("⇒");
    expect(results.every((info) => /\bright/i.test(info.name) && /\bdouble/i.test(info.name))).toBe(true);
    expect(searchCharacters(data, "grinning").map((info) => info.char)).toContain("😀");
    expect(searchCharacters(data, "euro").map((info) => info.char)).toContain("€");
  });

  it("lists a character once even when it is in several subcategories", () => {
    const codes = searchCharacters(data, "quotation").map((info) => info.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("finds characters by code point", () => {
    expect(parseCodePoint("U+2192")).toBe(0x2192);
    expect(parseCodePoint("u+1f600")).toBe(0x1f600);
    expect(parseCodePoint("2192")).toBe(0x2192);
    // Hex-looking words are keywords.
    expect(parseCodePoint("face")).toBeNull();
    expect(parseCodePoint("U+D800")).toBeNull();
    expect(parseCodePoint("U+110000")).toBeNull();

    expect(searchCharacters(data, "2192")[0]!.char).toBe("→");
    // A code point outside the bundled categories is still offered, without a name.
    expect(searchCharacters(data, "U+0416")[0]).toEqual({ code: 0x416, char: "Ж", name: "" });
    expect(codePointLabel(0x2192)).toBe("U+2192");
    expect(codePointLabel(0x41)).toBe("U+0041");
  });

  it("returns nothing for an empty query", () => {
    expect(searchCharacters(data, "  ")).toEqual([]);
  });
});
