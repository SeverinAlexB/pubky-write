// Fetching from the web on the user's behalf: page titles for the link bubble and images pasted
// from web pages. Requests only go to public http(s) addresses on the standard ports, so a link
// cannot make the server reach itself or the local network (server-side request forgery). The
// address is checked when it is resolved, for every redirect, and again for literal IPs.
import { BlockList, isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

export class RemoteFetchError extends Error {
  constructor(
    message: string,
    /** The HTTP status to answer with: 400 for an address that may not be fetched, 413 when too large, 502 otherwise. */
    readonly status: 400 | 413 | 502 = 502,
  ) {
    super(message);
  }

  /** The address may not be fetched (private, loopback, wrong scheme or port). */
  get refused(): boolean {
    return this.status === 400;
  }
}

export type RemoteResponse = { url: string; status: number; contentType: string; body: Buffer };
export type RemoteFetchOptions = {
  maxBytes: number;
  /** Stop reading at `maxBytes` instead of failing (enough of a page to find its title). */
  truncate?: boolean;
  timeoutMs?: number;
  accept?: string;
};
export type RemoteFetcher = (url: string, options: RemoteFetchOptions) => Promise<RemoteResponse>;

const MAX_REDIRECTS = 3;

const privateRanges = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  privateRanges.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127],
  // IPv4/IPv6 translation, discard, Teredo, documentation, unique local, link-local, multicast.
  // (IPv4-mapped addresses are checked as IPv4 below: the block list matches IPv4 against them.)
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  privateRanges.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !privateRanges.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Resolves a host name and refuses it if any of its addresses is not public. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 0);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(new RemoteFetchError(`${hostname} is not a public address`, 400), "", 0);
    }
    if (options.all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** The URL if it may be fetched: http(s), no credentials, a standard port, not a private IP literal. */
export function checkRemoteUrl(value: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteFetchError("Not a valid address", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RemoteFetchError("Only http and https addresses can be fetched", 400);
  if (url.username || url.password) throw new RemoteFetchError("Addresses with credentials are not fetched", 400);
  if (allowPrivate) return url;
  if (url.port && url.port !== "80" && url.port !== "443") throw new RemoteFetchError("Only the standard ports are fetched", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new RemoteFetchError(`${host} is not a public address`, 400);
  if (host === "localhost" || host.endsWith(".localhost")) throw new RemoteFetchError(`${host} is not a public address`, 400);
  return url;
}

/**
 * Fetches a public web address with a time limit and a size limit, following up to three
 * redirects (each checked again). `allowPrivate` is for tests that serve from this machine.
 */
export function createRemoteFetcher({ allowPrivate = false }: { allowPrivate?: boolean } = {}): RemoteFetcher {
  return async (value, options) => {
    const deadline = Date.now() + (options.timeoutMs ?? 5000);
    let url = checkRemoteUrl(value, allowPrivate);
    for (let redirects = 0; ; redirects++) {
      const response = await requestOnce(url, options, deadline, allowPrivate);
      const location = response.status >= 300 && response.status < 400 ? response.location : undefined;
      if (!location) return response.result;
      if (redirects >= MAX_REDIRECTS) throw new RemoteFetchError("Too many redirects");
      url = checkRemoteUrl(new URL(location, url).href, allowPrivate);
    }
  };
}

function requestOnce(
  url: URL,
  options: RemoteFetchOptions,
  deadline: number,
  allowPrivate: boolean,
): Promise<{ status: number; location?: string; result: RemoteResponse }> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new RemoteFetchError("Timed out"));
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: "GET",
        headers: { "User-Agent": "Docs/1.0 (link preview)", Accept: options.accept ?? "*/*" },
        lookup: allowPrivate ? undefined : publicLookup,
        timeout: remaining,
      },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          clearTimeout(timer);
          resolve({ status, location: response.headers.location, result: undefined as never });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({
            status,
            result: { url: url.href, status, contentType: String(response.headers["content-type"] ?? ""), body: Buffer.concat(chunks) },
          });
        };
        response.on("data", (chunk: Buffer) => {
          if (done) return;
          size += chunk.length;
          if (size > options.maxBytes) {
            if (!options.truncate) {
              done = true;
              request.destroy();
              reject(new RemoteFetchError("The file is too large", 413));
              return;
            }
            chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)));
            finish();
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!done) reject(error);
        });
      },
    );
    const timer = setTimeout(() => request.destroy(new RemoteFetchError("Timed out")), remaining);
    request.on("timeout", () => request.destroy(new RemoteFetchError("Timed out")));
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The text of an HTML page's `<title>`, or null. */
export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const text = match[1]!
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return entities[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 300) : null;
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

const TITLE_BYTES = 256 * 1024;
const CACHE_SIZE = 500;
const FOUND_TTL_MS = 60 * 60 * 1000;
const FAILED_TTL_MS = 5 * 60 * 1000;

/** Page titles by address, cached (also when there is none) so a link is fetched at most once an hour. */
export class LinkTitles {
  private cache = new Map<string, { title: string | null; expires: number }>();

  constructor(private readonly fetcher: RemoteFetcher) {}

  async title(url: string, now = Date.now()): Promise<string | null> {
    const cached = this.cache.get(url);
    if (cached && cached.expires > now) return cached.title;
    let title: string | null = null;
    try {
      const response = await this.fetcher(url, { maxBytes: TITLE_BYTES, truncate: true, timeoutMs: 4000, accept: "text/html" });
      if (response.status >= 200 && response.status < 300 && /html/i.test(response.contentType || "text/html")) {
        title = extractTitle(decode(response.body, response.contentType));
      }
    } catch (error) {
      if (error instanceof RemoteFetchError && error.refused) throw error;
    }
    this.cache.delete(url);
    this.cache.set(url, { title, expires: now + (title ? FOUND_TTL_MS : FAILED_TTL_MS) });
    // The oldest entry goes first.
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return title;
  }
}
