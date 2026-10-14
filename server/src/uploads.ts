// Uploaded images, stored as files named by a random id in the uploads directory.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const imageTypes: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** Stores an image and returns its `/uploads/<name>` URL. */
export async function storeUpload(uploadsDir: string, data: Uint8Array, contentType: string): Promise<string> {
  const extension = imageTypes[contentType];
  if (!extension) throw new Error(`Unsupported image type ${contentType}`);
  const name = `${randomUUID()}${extension}`;
  await writeFile(join(uploadsDir, name), data);
  return `/uploads/${name}`;
}

/** Reads an uploaded image by its `/uploads/<name>` URL; other URLs are not read. */
export async function readUpload(uploadsDir: string, src: string): Promise<Buffer | null> {
  if (!src.startsWith("/uploads/")) return null;
  const name = basename(src);
  if (name !== src.slice("/uploads/".length)) return null;
  return readFile(join(uploadsDir, name)).catch(() => null);
}

/** The type of an image from its first bytes, or null for anything but PNG, JPEG, GIF and WebP. */
export function sniffImageType(data: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}
