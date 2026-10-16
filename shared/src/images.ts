// Images: block images with an optional size in CSS pixels, set by dragging the selection handles,
// and the layout settings of spec 19: how text wraps around them, where they are, rotation, a
// non-destructive crop and colour adjustments. See docs/design/images.md.
import Image from "@tiptap/extension-image";

/** The smallest size the handles make an image, in CSS pixels. */
export const MIN_IMAGE_SIZE = 8;

/** How text flows around an image (the pill's Wrap text options). */
export const imageWraps = ["inline", "wrap", "break", "behind", "front"] as const;
export type ImageWrap = (typeof imageWraps)[number];

/** "Move with text": offsets are from the anchor paragraph; "Fix position on page": from the page's corner. */
export const imagePositionings = ["moveWithText", "fixed"] as const;
export type ImagePositioning = (typeof imagePositionings)[number];

export const imageRecolors = ["greyscale", "sepia"] as const;
export type ImageRecolor = (typeof imageRecolors)[number];

/** The visible part of the image: how much is trimmed off each edge, as a fraction of the whole image. */
export type ImageCrop = { top: number; right: number; bottom: number; left: number };

/** The margin between a wrapped image and the text, in points: 0, 1.6, 3.2, 6.4 and 12.7 mm. */
export const imageMarginPresets = [0, 4.5, 9, 18, 36] as const;
export const DEFAULT_IMAGE_MARGIN_PT = 9;
export const MAX_IMAGE_MARGIN_PT = 72 * 2;
/** Offsets are kept within this many CSS pixels of the anchor. */
const MAX_OFFSET = 20000;
/** At least this much of the image stays visible when cropping. */
export const MIN_CROP_VISIBLE = 0.05;

/** The layout attributes of an image as stored (with their defaults when missing). */
export type ImageLayout = {
  wrap: ImageWrap;
  wrapMargin: number;
  positioning: ImagePositioning;
  offsetX: number;
  offsetY: number;
  rotation: number;
  crop: ImageCrop | null;
  recolor: ImageRecolor | null;
  transparency: number;
  brightness: number;
  contrast: number;
};

export function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isImageCrop(value: unknown): value is ImageCrop {
  if (!value || typeof value !== "object") return false;
  const crop = value as Record<string, unknown>;
  const sides = ["top", "right", "bottom", "left"] as const;
  if (Object.keys(crop).some((key) => !(sides as readonly string[]).includes(key))) return false;
  if (!sides.every((side) => isNumberIn(crop[side], 0, 1))) return false;
  const { top, right, bottom, left } = crop as ImageCrop;
  return left + right <= 1 - MIN_CROP_VISIBLE + 1e-9 && top + bottom <= 1 - MIN_CROP_VISIBLE + 1e-9;
}

/** The layout of an image node's attributes; unknown values fall back to the defaults. */
export function imageLayoutOf(attrs: Record<string, unknown>): ImageLayout {
  const wrap = (imageWraps as readonly unknown[]).includes(attrs.wrap) ? (attrs.wrap as ImageWrap) : "inline";
  return {
    wrap,
    wrapMargin: isNumberIn(attrs.wrapMargin, 0, MAX_IMAGE_MARGIN_PT) ? attrs.wrapMargin : DEFAULT_IMAGE_MARGIN_PT,
    positioning: attrs.positioning === "fixed" ? "fixed" : "moveWithText",
    offsetX: isNumberIn(attrs.offsetX, -MAX_OFFSET, MAX_OFFSET) ? attrs.offsetX : 0,
    offsetY: isNumberIn(attrs.offsetY, -MAX_OFFSET, MAX_OFFSET) ? attrs.offsetY : 0,
    rotation: isNumberIn(attrs.rotation, 0, 360) ? attrs.rotation % 360 : 0,
    crop: isImageCrop(attrs.crop) && Object.values(attrs.crop).some((side) => side > 0) ? attrs.crop : null,
    recolor: (imageRecolors as readonly unknown[]).includes(attrs.recolor) ? (attrs.recolor as ImageRecolor) : null,
    transparency: isNumberIn(attrs.transparency, 0, 100) ? attrs.transparency : 0,
    brightness: isNumberIn(attrs.brightness, -100, 100) ? attrs.brightness : 0,
    contrast: isNumberIn(attrs.contrast, -100, 100) ? attrs.contrast : 0,
  };
}

/** An angle in whole degrees from 0 to 359. */
export function normalizeRotation(degrees: number): number {
  const rounded = Math.round(degrees) % 360;
  // + 0 turns -0 into 0.
  return rounded < 0 ? rounded + 360 : rounded + 0;
}

/** "3.2mm margin": the pill's label for a margin in points. */
export function imageMarginLabel(points: number): string {
  const mm = Math.round(((points * 25.4) / 72) * 10) / 10;
  return `${mm}mm margin`;
}

/**
 * The inline style for an image's stored size. The aspect ratio keeps a stretched image's
 * proportions when it is narrowed to fit a smaller page.
 */
export function imageSizeStyle(width: unknown, height: unknown): string | null {
  if (!isSize(width)) return null;
  if (!isSize(height)) return `width: ${width}px`;
  return `width: ${width}px; aspect-ratio: ${width} / ${height}`;
}

/** The CSS filter and opacity of the re-colour and adjustment settings. */
export function imageFilterStyle(layout: Pick<ImageLayout, "recolor" | "transparency" | "brightness" | "contrast">): string {
  const filters: string[] = [];
  if (layout.recolor === "greyscale") filters.push("grayscale(1)");
  if (layout.recolor === "sepia") filters.push("sepia(1)");
  if (layout.brightness !== 0) filters.push(`brightness(${round(1 + layout.brightness / 100)})`);
  if (layout.contrast !== 0) filters.push(`contrast(${round(1 + layout.contrast / 100)})`);
  const styles: string[] = [];
  if (filters.length > 0) styles.push(`filter: ${filters.join(" ")}`);
  if (layout.transparency > 0) styles.push(`opacity: ${round(1 - layout.transparency / 100)}`);
  return styles.join("; ");
}

/**
 * The style of the image itself inside a cropping box: the whole image, scaled so that the visible
 * part fills the box, and moved so that part is in the box.
 */
export function croppedImageStyle(crop: ImageCrop): string {
  const width = 1 - crop.left - crop.right;
  const height = 1 - crop.top - crop.bottom;
  return [
    "position: absolute",
    `left: ${percentOf(-crop.left / width)}`,
    `top: ${percentOf(-crop.top / height)}`,
    `width: ${percentOf(1 / width)}`,
    `height: ${percentOf(1 / height)}`,
    "max-width: none",
  ].join("; ");
}

/**
 * Where text goes beside a wrapped image: on both sides ("both"), or the side the image floats to
 * ("left": the text is on its right, "right": on its left).
 */
export type WrapSide = "left" | "right" | "both";

/** The free text width needed on each side of a wrapped image for text on both sides: 1 cm, in CSS pixels. */
export const MIN_WRAP_SIDE = 96 / 2.54;

/**
 * The style of the image's frame for its wrap mode, without what depends on the page layout (a
 * fixed position on the page is set by the pagination). `side` is where a wrapped image floats: the
 * text goes on the other, wider side. With text on both sides it takes no room in the text at all
 * (like an image in front of text): the editor keeps the lines beside it off the image
 * (client/src/editor/imageWrap.ts).
 */
export function imageFrameStyle(layout: ImageLayout, width: number | null, side: WrapSide = "left"): string {
  const margin = `${round(layout.wrapMargin * (96 / 72))}px`;
  const styles: string[] = [];
  const fixed = layout.positioning === "fixed";
  const x = Math.max(0, layout.offsetX);
  const y = layout.offsetY;
  // Fixed on the page: the pagination sets how far the anchor paragraph's top is from the page's
  // (see client/src/editor/imagePlacement.ts).
  const top = (extra: string) =>
    fixed ? `calc(var(--image-page-shift, 0px) + ${round(y)}px)` : y > 0 ? `calc(${extra} + ${round(y)}px)` : extra;
  switch (layout.wrap) {
    case "inline":
      break;
    case "break":
      styles.push(`margin: ${margin} 0 ${margin} ${round(x)}px`, `margin-top: ${top(margin)}`);
      break;
    case "wrap":
      if (side === "both") styles.push("position: absolute", `margin: 0 0 0 ${round(x)}px`);
      else if (side === "left") styles.push("float: left", `margin: 0 ${margin} ${margin} ${round(x)}px`);
      else {
        styles.push("float: right");
        const right = width === null ? "0px" : `calc(100% - ${round(x + width)}px)`;
        styles.push(`margin: 0 max(0px, ${right}) ${margin} ${margin}`);
      }
      styles.push(`margin-top: ${fixed ? top("0px") : `${round(Math.max(0, y))}px`}`);
      break;
    case "behind":
    case "front":
      styles.push("position: absolute");
      if (fixed) styles.push(`left: ${round(layout.offsetX)}px`, `top: calc(var(--image-page-top, 0px) + ${round(y)}px)`, "margin: 0");
      else styles.push(`margin: ${round(y)}px 0 0 ${round(layout.offsetX)}px`);
      break;
  }
  if (layout.rotation !== 0) styles.push(`transform: rotate(${layout.rotation}deg)`);
  return styles.join("; ");
}

/**
 * Where the text of a wrapped image goes, given the width of its column: on both sides when each has
 * at least 1 cm of free text width (beyond the image's margin), otherwise on the wider side.
 */
export function wrapSide(layout: ImageLayout, width: number, columnWidth: number): WrapSide {
  const margin = layout.wrapMargin * (96 / 72);
  const left = Math.max(0, layout.offsetX);
  const right = columnWidth - left - width;
  if (left - margin >= MIN_WRAP_SIDE && right - margin >= MIN_WRAP_SIDE) return "both";
  return right >= left ? "left" : "right";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentOf(fraction: number): string {
  return `${Math.round(fraction * 1e6) / 1e4}%`;
}

const numberAttribute = (name: string, fallback: number, min: number, max: number, parse = Number.parseFloat) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => {
    const value = parse(element.getAttribute(`data-${name}`) ?? "");
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  },
  renderHTML: (attrs: Record<string, unknown>) => (attrs[camel(name)] === fallback ? {} : { [`data-${name}`]: String(attrs[camel(name)]) }),
  validate: (value: unknown) => {
    if (!isNumberIn(value, min, max)) throw new RangeError(`Invalid image ${name} ${String(value)}`);
  },
});

function camel(name: string): string {
  return name.replace(/-(\w)/g, (_match, letter: string) => letter.toUpperCase());
}

const choiceAttribute = <T extends string>(name: string, values: readonly T[], fallback: T | null) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => {
    const value = element.getAttribute(`data-${name}`);
    return (values as readonly (string | null)[]).includes(value) ? value : fallback;
  },
  renderHTML: (attrs: Record<string, unknown>) => (attrs[camel(name)] === fallback ? {} : { [`data-${name}`]: String(attrs[camel(name)]) }),
  validate: (value: unknown) => {
    if (value === fallback) return;
    if (!(values as readonly unknown[]).includes(value)) throw new RangeError(`Invalid image ${name} ${String(value)}`);
  },
});

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
      // Spec 19. Every attribute has a default, so documents saved before them load as images in line with text.
      wrap: choiceAttribute("wrap", imageWraps, "inline"),
      wrapMargin: numberAttribute("wrap-margin", DEFAULT_IMAGE_MARGIN_PT, 0, MAX_IMAGE_MARGIN_PT),
      positioning: choiceAttribute("positioning", imagePositionings, "moveWithText"),
      offsetX: numberAttribute("offset-x", 0, -MAX_OFFSET, MAX_OFFSET),
      offsetY: numberAttribute("offset-y", 0, -MAX_OFFSET, MAX_OFFSET),
      rotation: numberAttribute("rotation", 0, 0, 359),
      crop: {
        default: null,
        parseHTML: (element) => {
          const parts = (element.getAttribute("data-crop") ?? "").split(/\s+/).map(Number);
          const crop = parts.length === 4 ? { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! } : null;
          return isImageCrop(crop) ? crop : null;
        },
        renderHTML: ({ crop }) => (isImageCrop(crop) ? { "data-crop": `${crop.top} ${crop.right} ${crop.bottom} ${crop.left}` } : {}),
        validate: (value: unknown) => {
          if (value !== null && !isImageCrop(value)) throw new RangeError("Invalid image crop");
        },
      },
      recolor: choiceAttribute("recolor", imageRecolors, null),
      transparency: numberAttribute("transparency", 0, 0, 100),
      brightness: numberAttribute("brightness", 0, -100, 100),
      contrast: numberAttribute("contrast", 0, -100, 100),
    };
  },

  parseHTML() {
    // The frame written by renderHTML (copied images keep their layout), or any other image.
    return [{ tag: "div.image-frame[data-image]", getAttrs: (element) => frameAttributes(element as HTMLElement) }, ...(this.parent?.() ?? [])];
  },

  /**
   * Images with a layout of their own are drawn in a frame like the editor's, so the version
   * preview and copies show them wrapped, cropped and rotated; plain images stay a plain `img`.
   */
  renderHTML({ node, HTMLAttributes }) {
    const layout = imageLayoutOf(node.attrs);
    if (layout.wrap === "inline" && layout.rotation === 0 && !layout.crop && !imageFilterStyle(layout)) return ["img", HTMLAttributes];
    const { width, height } = node.attrs;
    const data = Object.fromEntries(Object.entries(HTMLAttributes).filter(([key]) => key.startsWith("data-")));
    const image = Object.fromEntries(Object.entries(HTMLAttributes).filter(([key]) => !key.startsWith("data-") && key !== "style"));
    const filter = imageFilterStyle(layout);
    const imageStyle = layout.crop ? `${croppedImageStyle(layout.crop)}; ${filter}` : `${imageSizeStyle(width, height) ?? ""}; ${filter}`;
    const inner: [string, Record<string, string>] = ["img", { ...image, style: imageStyle }];
    return [
      "div",
      {
        ...data,
        class: "image-frame",
        "data-image": "",
        "data-wrap": layout.wrap,
        style: imageFrameStyle(layout, isSize(width) ? width : null),
      },
      layout.crop ? ["div", { class: "image-crop", style: imageSizeStyle(width, height) ?? "" }, inner] : inner,
    ];
  },
}).configure({ inline: false, allowBase64: false });

/** The attributes of a frame written by renderHTML: the data attributes and the image's. */
function frameAttributes(frame: HTMLElement): Record<string, unknown> | false {
  const image = frame.querySelector("img");
  if (!image?.getAttribute("src")) return false;
  return {
    src: image.getAttribute("src"),
    alt: image.getAttribute("alt"),
    title: image.getAttribute("title"),
  };
}

function sizeOf(element: HTMLElement, attribute: "width" | "height"): number | null {
  const source = element.matches("div.image-frame") ? element.querySelector("img") : element;
  const value = Number.parseFloat(source?.getAttribute(attribute) ?? "");
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
