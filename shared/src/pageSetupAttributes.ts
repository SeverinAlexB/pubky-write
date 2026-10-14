// The page setup attributes of the document node (see pageSetup.ts). Kept apart from the page
// geometry helpers so that code that only needs those does not load the editor framework.
import { Extension } from "@tiptap/core";
import { DEFAULT_MARGIN_PT, defaultPageSetup, isMargin, isPaperSize, marginKeys } from "./pageSetup.ts";

/** Adds the page setup attributes to the document node. */
export const PageSetupAttributes = Extension.create({
  name: "pageSetup",

  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          paperSize: {
            default: defaultPageSetup.paperSize,
            rendered: false,
            validate: (value: unknown) => {
              if (!isPaperSize(value)) throw new RangeError(`Unknown paper size ${String(value)}`);
            },
          },
          orientation: {
            default: defaultPageSetup.orientation,
            rendered: false,
            validate: (value: unknown) => {
              if (value !== "portrait" && value !== "landscape") throw new RangeError(`Unknown orientation ${String(value)}`);
            },
          },
          ...Object.fromEntries(
            marginKeys.map((key) => [
              key,
              {
                default: DEFAULT_MARGIN_PT,
                rendered: false,
                validate: (value: unknown) => {
                  if (!isMargin(value)) throw new RangeError(`Invalid margin ${String(value)}`);
                },
              },
            ]),
          ),
        },
      },
    ];
  },
});
