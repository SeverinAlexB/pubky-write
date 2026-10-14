import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRemoteUrl, createRemoteFetcher, extractTitle, isPublicAddress, LinkTitles, RemoteFetchError, type RemoteFetcher } from "./remote.ts";

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local and other special addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("93.184.215.14")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
    expect(isPublicAddress("not an address")).toBe(false);
  });
});

describe("checkRemoteUrl", () => {
  it("allows public http(s) addresses on the standard ports only", () => {
    expect(checkRemoteUrl("https://example.com/page").hostname).toBe("example.com");
    for (const url of [
      "ftp://example.com",
      "file:///etc/passwd",
      "http://user:secret@example.com",
      "http://example.com:8080",
      "http://127.0.0.1",
      "http://[::1]/",
      "http://localhost/",
      "http://api.localhost/",
      "http://169.254.169.254/latest/meta-data",
      "nonsense",
    ]) {
      expect(() => checkRemoteUrl(url), url).toThrow(RemoteFetchError);
    }
  });
});

describe("extractTitle", () => {
  it("reads the title, decoding entities and white space", () => {
    expect(extractTitle("<html><head><title>\n  Caf&eacute; &amp; Bar &#8212; Menu  </title>")).toBe("Caf&eacute; & Bar — Menu");
    expect(extractTitle("<TITLE lang=en>Hello</TITLE>")).toBe("Hello");
    expect(extractTitle("<title></title>")).toBeNull();
    expect(extractTitle("<p>no title</p>")).toBeNull();
  });
});

describe("LinkTitles", () => {
  it("caches titles, also when a page has none", async () => {
    let calls = 0;
    const fetcher: RemoteFetcher = async (url) => {
      calls++;
      return { url, status: 200, contentType: "text/html; charset=utf-8", body: Buffer.from(url.endsWith("/a") ? "<title>A page</title>" : "<p>") };
    };
    const titles = new LinkTitles(fetcher);
    expect(await titles.title("https://example.com/a", 0)).toBe("A page");
    expect(await titles.title("https://example.com/a", 1000)).toBe("A page");
    expect(await titles.title("https://example.com/b", 0)).toBeNull();
    expect(await titles.title("https://example.com/b", 1000)).toBeNull();
    expect(calls).toBe(2);
    // Failures are tried again after a while.
    expect(await titles.title("https://example.com/b", 10 * 60 * 1000)).toBeNull();
    expect(calls).toBe(3);
  });

  it("answers null for pages that fail, and refuses addresses that may not be fetched", async () => {
    const failing = new LinkTitles(async () => {
      throw new Error("connection reset");
    });
    expect(await failing.title("https://example.com")).toBeNull();
    const real = new LinkTitles(createRemoteFetcher());
    await expect(real.title("http://127.0.0.1/admin")).rejects.toMatchObject({ status: 400 });
  });
});

describe("createRemoteFetcher", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/page") return response.end("<title>Local page</title>");
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/page" });
        return response.end();
      }
      if (request.url === "/large") return response.end("x".repeat(5000));
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("refuses this machine and names that resolve to it", async () => {
    const fetch = createRemoteFetcher();
    await expect(fetch(`${base}/page`, { maxBytes: 1000 })).rejects.toMatchObject({ status: 400 });
    // A name that passes the address check but resolves to the loopback address.
    await expect(fetch("http://localhost./page", { maxBytes: 1000 })).rejects.toMatchObject({ status: 400 });
  });

  it("follows redirects and limits the size (when private addresses are allowed for tests)", async () => {
    const fetch = createRemoteFetcher({ allowPrivate: true });
    const page = await fetch(`${base}/redirect`, { maxBytes: 1000 });
    expect(page.url).toBe(`${base}/page`);
    expect(page.body.toString()).toBe("<title>Local page</title>");
    await expect(fetch(`${base}/large`, { maxBytes: 1000 })).rejects.toMatchObject({ status: 413 });
    const truncated = await fetch(`${base}/large`, { maxBytes: 1000, truncate: true });
    expect(truncated.body.length).toBe(1000);
  });
});
