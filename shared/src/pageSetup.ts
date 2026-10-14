// File > Page setup: paper size, orientation and margins. They are attributes of the
// document's top node, so they are saved, versioned and restored like any other edit
// (changed with a DocAttrStep, `tr.setDocAttribute`). Documents saved before these
// attributes existed load with the defaults.
import type { Node } from "@tiptap/pm/model";

export const paperSizes = {
  A4: { label: "A4", width: 210, height: 297 },
  Letter: { label: "Letter", width: 215.9, height: 279.4 },
  Legal: { label: "Legal", width: 215.9, height: 355.6 },
  A5: { label: "A5", width: 148, height: 210 },
  A3: { label: "A3", width: 297, height: 420 },
} as const satisfies Record<string, { label: string; width: number; height: number }>;

export type PaperSize = keyof typeof paperSizes;
export type PageOrientation = "portrait" | "landscape";

/** Page settings as stored in the document. Margins are in points (1 in = 72 pt = 2.54 cm). */
export type PageSetup = {
  paperSize: PaperSize;
  orientation: PageOrientation;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** The background of the pages, `#rrggbb` in lower case. */
  pageColor: string;
};

export const DEFAULT_MARGIN_PT = 72;
export const MAX_MARGIN_PT = 72 * 6;
export const DEFAULT_PAGE_COLOR = "#ffffff";

export const defaultPageSetup: PageSetup = {
  paperSize: "A4",
  orientation: "portrait",
  marginTop: DEFAULT_MARGIN_PT,
  marginBottom: DEFAULT_MARGIN_PT,
  marginLeft: DEFAULT_MARGIN_PT,
  marginRight: DEFAULT_MARGIN_PT,
  pageColor: DEFAULT_PAGE_COLOR,
};

export const pageSetupKeys = Object.keys(defaultPageSetup) as (keyof PageSetup)[];
export const marginKeys = ["marginTop", "marginBottom", "marginLeft", "marginRight"] as const;

export const PX_PER_PT = 96 / 72;
export const PX_PER_MM = 96 / 25.4;
export const PT_PER_CM = 72 / 2.54;

export function isPaperSize(value: unknown): value is PaperSize {
  return typeof value === "string" && Object.hasOwn(paperSizes, value);
}

export function isMargin(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_MARGIN_PT;
}

export function isPageColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

/** The page settings of a document; unknown or missing values fall back to the defaults. */
export function pageSetupOf(doc: Node): PageSetup {
  return normalizePageSetup(doc.attrs);
}

export function normalizePageSetup(attrs: Record<string, unknown>): PageSetup {
  const setup: PageSetup = {
    paperSize: isPaperSize(attrs.paperSize) ? attrs.paperSize : defaultPageSetup.paperSize,
    orientation: attrs.orientation === "landscape" ? "landscape" : "portrait",
    ...defaultMargins(),
    pageColor: isPageColor(attrs.pageColor) ? attrs.pageColor : DEFAULT_PAGE_COLOR,
  };
  for (const key of marginKeys) if (isMargin(attrs[key])) setup[key] = attrs[key];
  return setup;
}

function defaultMargins() {
  return Object.fromEntries(marginKeys.map((key) => [key, DEFAULT_MARGIN_PT])) as Record<(typeof marginKeys)[number], number>;
}

/** Page width and height in millimetres, with the orientation applied. */
export function pageSizeMm(setup: Pick<PageSetup, "paperSize" | "orientation">): { width: number; height: number } {
  const { width, height } = paperSizes[setup.paperSize];
  return setup.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/** The page in CSS pixels (96 dpi), rounded to whole pixels: A4 is 794 × 1123. */
export type PageGeometry = {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
};

export function pageGeometry(setup: PageSetup): PageGeometry {
  const { width, height } = pageSizeMm(setup);
  const px = (points: number) => Math.round(points * PX_PER_PT * 100) / 100;
  return {
    width: Math.round(width * PX_PER_MM),
    height: Math.round(height * PX_PER_MM),
    marginTop: px(setup.marginTop),
    marginBottom: px(setup.marginBottom),
    marginLeft: px(setup.marginLeft),
    marginRight: px(setup.marginRight),
  };
}

/** Regions that use US Letter paper and inches rather than A4 and centimetres. */
const letterRegions = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "PR", "CR", "DO", "SV", "NI", "PA"]);
const inchRegions = new Set(["US", "LR", "MM"]);

function regionOf(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined;
  }
}

/** The paper size of a new document: Letter in the Americas' Letter regions, otherwise A4. */
export function defaultPaperSize(locale: string): PaperSize {
  const region = regionOf(locale);
  return region && letterRegions.has(region) ? "Letter" : "A4";
}

export type LengthUnit = "cm" | "in";

/** Rulers and Page setup use inches in the United States and centimetres elsewhere. */
export function lengthUnit(locale: string): LengthUnit {
  const region = regionOf(locale);
  return region && inchRegions.has(region) ? "in" : "cm";
}

export function pointsPerUnit(unit: LengthUnit): number {
  return unit === "in" ? 72 : PT_PER_CM;
}
