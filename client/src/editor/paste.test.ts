import { describe, expect, it } from "vitest";
import { cleanStyle } from "./paste.ts";

describe("cleanStyle", () => {
  it("keeps basic text formatting and drops Word's and the defaults", () => {
    expect(cleanStyle("mso-bidi-font-weight:normal;font-weight:bold;color:#C00000", false)).toBe("font-weight: bold; color: #C00000");
    expect(cleanStyle("font-family:Arial,sans-serif;font-size:11.0pt", false)).toBe("");
    expect(cleanStyle("font-size:14.6667px;font-style:italic", false)).toBe("font-style: italic");
    expect(cleanStyle("font-family:'Arial';font-size:11pt", false)).toBe("");
    expect(cleanStyle('font-family:"Georgia",serif;font-size:14pt', false)).toBe('font-family: "Georgia",serif; font-size: 14pt');
    expect(cleanStyle("margin-bottom:8.0pt;line-height:107%;text-indent:-18.0pt;mso-list:l0 level1 lfo1", true)).toBe("");
  });

  it("drops background colours on whole blocks but keeps highlighted text", () => {
    expect(cleanStyle("background-color:yellow;text-align:center", true)).toBe("text-align: center");
    expect(cleanStyle("background-color:yellow", false)).toBe("background-color: yellow");
  });
});
