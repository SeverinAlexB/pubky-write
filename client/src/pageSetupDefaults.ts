// File > Page setup > "Set as default": the page settings new documents start with, kept in the
// browser and sent with each request to create a document.
import type { PageSetup } from "@pubky-write/shared";

const DEFAULT_PAGE_SETUP_SETTING = "docs.defaultPageSetup";

export function storedPageSetupDefaults(): Record<string, unknown> | undefined {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DEFAULT_PAGE_SETUP_SETTING) ?? "null");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function storePageSetupDefaults(setup: PageSetup): void {
  localStorage.setItem(DEFAULT_PAGE_SETUP_SETTING, JSON.stringify(setup));
}
