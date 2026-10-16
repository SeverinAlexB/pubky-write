import { describe, expect, it } from "vitest";
import data from "./emojiData.json" with { type: "json" };
import { emojiCategories, searchEmoji, type EmojiData } from "./emojiData.ts";

const categories = emojiCategories(data as EmojiData);

describe("emoji data", () => {
  it("has the picker's nine categories", () => {
    expect(categories.map((category) => category.name)).toEqual([
      "Smileys and emotions",
      "People",
      "Animals and nature",
      "Food and drink",
      "Travel and places",
      "Activities and events",
      "Objects",
      "Symbols",
      "Flags",
    ]);
    expect(categories[0]!.emoji[0]).toMatchObject({ emoji: "😀", name: "Grinning face" });
  });

  it("finds emoji by name and keywords", () => {
    expect(searchEmoji(categories, "thumb").map((emoji) => emoji.name).slice(0, 2)).toEqual(["Thumbs up", "Thumbs down"]);
    expect(searchEmoji(categories, "party").map((emoji) => emoji.emoji)).toContain("🥳");
    expect(searchEmoji(categories, "red heart")[0]!.name).toBe("Red heart");
    expect(searchEmoji(categories, "zzzqqq")).toEqual([]);
  });

  it("puts names starting with the query first, as the colon picker shows them", () => {
    const names = searchEmoji(categories, "smi", 8).map((emoji) => emoji.name);
    expect(names).toHaveLength(8);
    expect(names[0]).toMatch(/^Smiling face/);
    expect(names.slice(0, 4).every((name) => name.startsWith("Smiling"))).toBe(true);
  });

  it("gives skin tones to the emoji that have them", () => {
    const thumbsUp = searchEmoji(categories, "thumbs up")[0]!;
    expect(thumbsUp.tones).toHaveLength(5);
    expect(searchEmoji(categories, "grinning face")[0]!.tones).toBeNull();
  });
});
