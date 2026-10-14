// Images: block images with an optional size in CSS pixels, set by dragging the selection handles.
import Image from "@tiptap/extension-image";

/** The smallest size the handles make an image, in CSS pixels. */
export const MIN_IMAGE_SIZE = 8;

/**
 * The inline style for an image's stored size. The aspect ratio keeps a stretched image's
 * proportions when it is narrowed to fit a smaller page.
 */
export function imageSizeStyle(width: unknown, height: unknown): string | null {
  if (!isSize(width)) return null;
  if (!isSize(height)) return `width: ${width}px`;
  return `width: ${width}px; aspect-ratio: ${width} / ${height}`;
}

export function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export const DocsImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => sizeOf(element, "width"),
        renderHTML: ({ width, height }) => {
          const style = imageSizeStyle(width, height);
          return style ? { style, width: String(width) } : {};
        },
      },
      height: {
        default: null,
        parseHTML: (element) => sizeOf(element, "height"),
        renderHTML: ({ width, height }) => (isSize(width) && isSize(height) ? { height: String(height) } : {}),
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

function sizeOf(element: HTMLElement, attribute: "width" | "height"): number | null {
  const value = Number.parseFloat(element.getAttribute(attribute) ?? "");
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
