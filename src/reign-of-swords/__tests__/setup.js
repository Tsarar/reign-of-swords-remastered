// Test environment for the Reign of Swords engine: jsdom supplies window / document / localStorage; this file adds
// what a battle needs from a real browser — a canvas 2D context, animation frames, and `fetch` for the game data
// (served from public/ by the site, read from disk here). Math.random is made deterministic per test so dice rolls
// (courage checks, reward draws) repeat exactly.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach } from "vitest";

const PUBLIC = join(process.cwd(), "public");

// A canvas context whose every method is a no-op and every property readable — the engine never renders in tests.
const noopCtx = new Proxy(
  {},
  {
    get: (t, k) => (k in t ? t[k] : () => ({ data: [], width: 0 })),
    set: (t, k, v) => ((t[k] = v), true),
  },
);
HTMLCanvasElement.prototype.getContext = () => noopCtx;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

globalThis.fetch = async (url) => {
  const path = join(PUBLIC, decodeURIComponent(String(url).split("?")[0]));
  try {
    const text = await readFile(path, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  } catch {
    return {
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("404 " + url);
      },
      text: async () => "",
    };
  }
};

// mulberry32 — a fixed seed per test, so every run of a test rolls the same dice
export function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
beforeEach(() => {
  seedRandom(12345);
  localStorage.clear();
});
