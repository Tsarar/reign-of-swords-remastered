// The two pages' search metadata (seo.js) and the dependency-free asset .zip builder (util/zip-assets.js).
import { describe, it, expect, vi, afterEach } from "vitest";
import { ROS_SEO } from "../seo.js";
import { zipAndDownload } from "../util/zip-assets.js";
import { SITE_URL } from "../../site.js";

describe("SEO metadata", () => {
  it("describes both episodes with a canonical path and a blurb in all three site languages", () => {
    expect(Object.keys(ROS_SEO)).toEqual(["reign-of-swords", "reign-of-swords-2"]);
    for (const [slug, s] of Object.entries(ROS_SEO)) {
      expect(s.path).toBe("/games/" + slug);
      expect(Object.keys(s.blurb)).toEqual(["en", "ru", "uk"]);
      expect(s.title).toMatch(/Reign of Swords/);
    }
  });

  it("emits schema.org JSON-LD about the original Punch Entertainment game", () => {
    const ld = ROS_SEO["reign-of-swords-2"].jsonLd();
    expect(ld["@type"]).toBe("WebPage");
    expect(ld.url).toBe(SITE_URL + "/games/reign-of-swords-2");
    expect(ld.about).toMatchObject({
      "@type": "VideoGame",
      datePublished: "2009",
      author: { name: "Punch Entertainment" },
      publisher: { name: "Punch Entertainment" },
      playMode: "SinglePlayer",
    });
    expect(ROS_SEO["reign-of-swords"].jsonLd().about.datePublished).toBe("2008");
  });
});

// Read a STORE-method zip back: [{name, data}] from its local file headers, plus the CRCs it recorded.
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = [];
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const crc = dv.getUint32(o + 14, true),
      size = dv.getUint32(o + 18, true),
      nlen = dv.getUint16(o + 26, true);
    const name = new TextDecoder().decode(u8.slice(o + 30, o + 30 + nlen));
    const data = u8.slice(o + 30 + nlen, o + 30 + nlen + size);
    out.push({ name, data, crc });
    o += 30 + nlen + size;
  }
  return { files: out, centralSig: dv.getUint32(o, true), endSig: dv.getUint32(u8.length - 22, true) };
}

describe("zipAndDownload", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("packs every fetched file into a valid zip, reports progress and the misses, and downloads it", async () => {
    vi.useFakeTimers();
    const bodies = { "/b/a.txt": "hello", "/b/dir/b.bin": "\x00\x01\x02" };
    globalThis.fetch = vi.fn(async (url) => {
      if (url === "/b/boom") throw new Error("network");
      if (!(url in bodies)) return { ok: false, status: 404 };
      const bytes = Uint8Array.from(bodies[url], (c) => c.charCodeAt(0));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
    });
    let blob = null;
    URL.createObjectURL = vi.fn((b) => {
      blob = b;
      return "blob:zip";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      expect(this.download).toBe("pack.zip");
      expect(this.getAttribute("href")).toBe("blob:zip");
    });
    const progress = [];
    const res = await zipAndDownload("/b/", ["a.txt", "missing.png", "dir/b.bin", "boom"], "pack.zip", (d, t, p) =>
      progress.push([d, t, p]),
    );
    expect(res).toEqual({ ok: 2, failed: ["missing.png", "boom"] });
    expect(progress.map((p) => p[0])).toEqual([1, 2, 3, 4]);
    expect(progress.every((p) => p[1] === 4)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull(); // the temporary link is removed

    expect(blob.type).toBe("application/zip");
    const z = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(z.files.map((f) => f.name)).toEqual(["pack/a.txt", "pack/dir/b.bin"]);
    expect(new TextDecoder().decode(z.files[0].data)).toBe("hello");
    expect(z.files[0].crc).toBe(0x3610a686); // the well-known CRC-32 of "hello"
    expect([...z.files[1].data]).toEqual([0, 1, 2]);
    expect(z.centralSig).toBe(0x02014b50);
    expect(z.endSig).toBe(0x06054b50);

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:zip");
  });

  it("works without a progress callback and with nothing to pack", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const res = await zipAndDownload("/", ["x"], "empty.zip");
    expect(res).toEqual({ ok: 0, failed: ["x"] });
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.size).toBe(22); // just the end-of-central-directory record
  });
});
