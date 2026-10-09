// util/util: the pure leaf helpers — grid distances (4-dir manhattan for weapon reach, king-move cheb for the 3×3
// Lightning Storm), the palette-swap colour maths, the seeded battle RNG and the asset cache-buster.
import { describe, it, expect } from "vitest";
import { clamp, key, manhattan, cheb, rgbHue, hslToRgb, makeRng, ASSET_V } from "../util/util.js";

describe("grid helpers", () => {
  it("clamp keeps a value inside [a, b]", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(13, 0, 10)).toBe(10);
    expect(clamp(7, 0, 10)).toBe(7);
  });
  it("key is the 'x,y' tile-set key", () => {
    expect(key(3, 14)).toBe("3,14");
  });
  it("manhattan counts orthogonal steps; cheb counts king moves", () => {
    const a = { tx: 1, ty: 1 },
      b = { tx: 3, ty: 4 };
    expect(manhattan(a, b)).toBe(5);
    expect(cheb(a, b)).toBe(3);
    expect(cheb({ tx: 2, ty: 2 }, { tx: 3, ty: 3 })).toBe(1); // a diagonal neighbour is inside the 3×3
    expect(manhattan({ tx: 2, ty: 2 }, { tx: 3, ty: 3 })).toBe(2); // …but not a melee (4-dir) neighbour
  });
});

describe("colour maths (palette swap)", () => {
  it("rgbHue: grey has hue 0; primaries sit at 0 / 120 / 240; magenta wraps below 0 to 300", () => {
    expect(rgbHue(128, 128, 128)).toBe(0);
    expect(rgbHue(255, 0, 0)).toBe(0);
    expect(rgbHue(0, 255, 0)).toBe(120);
    expect(rgbHue(0, 0, 255)).toBe(240);
    expect(rgbHue(255, 0, 255)).toBe(300);
    expect(rgbHue(255, 255, 0)).toBe(60);
  });
  it("hslToRgb: zero saturation is grey; dark and light lightness both map back to their primaries", () => {
    expect(hslToRgb(0.3, 0, 0.5)).toEqual([128, 128, 128]);
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(1 / 3, 1, 0.25)).toEqual([0, 128, 0]);
    expect(hslToRgb(2 / 3, 1, 0.75)).toEqual([128, 128, 255]);
    // round trip through rgbHue
    for (const h of [0.1, 0.45, 0.6, 0.9]) {
      const [r, g, b] = hslToRgb(h, 0.8, 0.5);
      expect(Math.abs(rgbHue(r, g, b) - h * 360)).toBeLessThan(1.5);
    }
  });
});

describe("makeRng", () => {
  it("is a deterministic LCG in [0, 1): the same seed repeats the same rolls", () => {
    const a = makeRng(0x51a7),
      b = makeRng(0x51a7),
      c = makeRng(7);
    const ra = [a(), a(), a()],
      rb = [b(), b(), b()];
    expect(ra).toEqual(rb);
    expect(c()).not.toBe(ra[0]);
    for (const v of ra) expect(v >= 0 && v < 1).toBe(true);
    // the exact LCG step: s = s*1664525 + 1013904223 (mod 2^32)
    expect(makeRng(0)()).toBe(1013904223 / 4294967296);
  });
  it("ASSET_V is the cache-buster string", () => {
    expect(typeof ASSET_V).toBe("string");
    expect(ASSET_V.length).toBeGreaterThan(0);
  });
});
