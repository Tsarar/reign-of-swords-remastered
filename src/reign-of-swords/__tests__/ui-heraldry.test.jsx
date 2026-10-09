// ui/HeraldryShield.jsx: the coat-of-arms shield — field → frame → symbol layers, the 3-shade palette-swap filters, the
// rank-frame choice (tier / forced frame / small-size clamp), the frames' own palette swap (key greens → symbol colour,
// key blues → field colour), pre-coloured crests, and the faction-crest lookup.
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import {
  HeraldryShield,
  TINCTURES,
  FRAMES,
  BANNER_HERALDRY,
  BANNER_TO_FRAME,
  factionCrest,
  paletteTint,
  pad3,
  HERALD_ASSET,
  FRAME_ASSET,
  PRECOLOURED_FROM,
  SYMBOLS,
} from "../ui/HeraldryShield.jsx";

const B = "/games/reign-of-swords/";
afterEach(() => cleanup());

const shield = (props) => render(<HeraldryShield {...props} />).container.querySelector("svg");
const images = (svg) => [...svg.querySelectorAll("image")];
const href = (el) => el.getAttribute("href");

describe("assets", () => {
  it("pads indices and builds the heraldry / frame URLs", () => {
    expect(pad3(7)).toBe("007");
    expect(HERALD_ASSET(35)).toBe(B + "heraldry/035.png");
    expect(FRAME_ASSET(4)).toBe(B + "heraldry/frames/4.png");
    expect(SYMBOLS).not.toContain(13); // field patterns are not charges
    expect(Object.keys(BANNER_TO_FRAME).length).toBe(9);
    expect(new Set(Object.values(BANNER_TO_FRAME)).size).toBe(9);
  });
});

describe("framed shield", () => {
  it("layers field, frame, symbol at the frame's opening; tinted field and charge", () => {
    const svg = shield({
      heraldry: { bgColor: "gules", bgType: 2, symbol: 35, symbolColor: "or" },
      size: 200,
      tier: 1,
    });
    const F = FRAMES[1];
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${F.cw} ${F.ch}`);
    expect(Number(svg.getAttribute("height"))).toBeCloseTo(200 * (F.ch / F.cw));
    expect(svg.getAttribute("aria-label")).toBe("Your heraldry");
    const [field, frame, sym] = images(svg);
    expect(href(field)).toBe(B + "heraldry/002.png");
    expect(field.getAttribute("x")).toBe(String(F.ox));
    expect(field.getAttribute("y")).toBe(String(F.oy));
    expect(href(frame)).toBe(B + "heraldry/frames/1.png");
    expect(frame.getAttribute("filter")).toBeNull(); // frame 1 has no palette keys
    expect(href(sym)).toBe(B + "heraldry/035.png");
    expect(field.getAttribute("filter")).toMatch(/^url\(#bt/);
    expect(sym.getAttribute("filter")).toMatch(/^url\(#st/);
    expect(svg.querySelectorAll("filter").length).toBe(2);
  });

  it("small shields clamp to the plain frame; a forced frame wins and is clamped to the list", () => {
    const h = { bgColor: "azure", bgType: 0, symbol: 9, symbolColor: "or" };
    expect(href(images(shield({ heraldry: h, size: 40, tier: 5 }))[1])).toBe(B + "heraldry/frames/0.png");
    expect(href(images(shield({ heraldry: h, size: 40, frame: 6 }))[1])).toBe(B + "heraldry/frames/6_base.png");
    expect(href(images(shield({ heraldry: h, size: 200, frame: 99 }))[1])).toBe(
      B + `heraldry/frames/${FRAMES.length - 1}_base.png`,
    );
    expect(href(images(shield({ heraldry: h, size: 200, frame: -3 }))[1])).toBe(B + "heraldry/frames/0.png");
    expect(href(images(shield({ heraldry: h, size: 200, tier: "x" }))[1])).toBe(B + "heraldry/frames/0.png");
    expect(href(images(shield({ heraldry: h }))[1])).toBe(B + "heraldry/frames/0.png"); // defaults: tier 0, size 200
  });

  it("the Emperor's frame 6: its key-green gems take the SYMBOL colour (argent), the frame itself stays gold", () => {
    const emperor = BANNER_HERALDRY[8];
    const svg = shield({ heraldry: emperor, frame: BANNER_TO_FRAME[8] });
    const [field, frame, gems, sym] = images(svg);
    expect(href(field)).toBe(B + "heraldry/000.png");
    expect(href(frame)).toBe(B + "heraldry/frames/6_base.png");
    expect(frame.getAttribute("filter")).toBeNull();
    expect(href(gems)).toBe(B + "heraldry/frames/6_sym.png");
    expect(gems.getAttribute("filter")).toBe(sym.getAttribute("filter")); // the charge's swap: argent's ramp
    const argent = render(paletteTintSvg(TINCTURES.find((t) => t.id === "argent").ramp, "g")).container;
    const id = gems.getAttribute("filter").slice(5, -1);
    expect(svg.querySelector(`filter[id='${id}'] feFuncR`).getAttribute("tableValues")).toBe(
      argent.querySelector("feFuncR").getAttribute("tableValues"),
    );
  });

  it("a drape frame's key blues take the FIELD colour (Carrone's drape is gules); frame 2's banner the symbol's", () => {
    const svg = shield({ heraldry: BANNER_HERALDRY[2], frame: 2 });
    const [field, frame, drape, banner, sym] = images(svg);
    expect(href(frame)).toBe(B + "heraldry/frames/2_base.png");
    expect(href(drape)).toBe(B + "heraldry/frames/2_bg.png");
    expect(drape.getAttribute("filter")).toBe(field.getAttribute("filter"));
    expect(href(banner)).toBe(B + "heraldry/frames/2_sym.png");
    expect(banner.getAttribute("filter")).toBe(sym.getAttribute("filter"));
    const baron = images(shield({ heraldry: BANNER_HERALDRY[2], frame: 3 }));
    expect(baron.map(href).slice(1, 3)).toEqual([B + "heraldry/frames/3_base.png", B + "heraldry/frames/3_bg.png"]);
  });

  it("every keyed frame ships its layers (tools/ros/frame_layers.py); the plain ones draw their own file", () => {
    const dir = process.cwd() + "/public/games/reign-of-swords/heraldry/frames/";
    for (const F of FRAMES) {
      expect(existsSync(dir + F.i + ".png")).toBe(true);
      expect(existsSync(dir + F.i + "_base.png")).toBe(!!(F.sym || F.bg));
      expect(existsSync(dir + F.i + "_sym.png")).toBe(!!F.sym);
      expect(existsSync(dir + F.i + "_bg.png")).toBe(!!F.bg);
    }
    expect(FRAMES.filter((F) => F.sym || F.bg).map((F) => F.i)).toEqual([2, 3, 6, 7, 8]);
  });

  it("symbol 0 means no charge; pre-coloured crests (68+) are drawn as-is", () => {
    const none = shield({ heraldry: { bgColor: "gules", bgType: 0, symbol: 0, symbolColor: "or" } });
    expect(images(none).length).toBe(2);
    const pre = shield({ heraldry: { bgColor: "gules", bgType: 0, symbol: PRECOLOURED_FROM, symbolColor: "or" } });
    expect(images(pre)[2].getAttribute("filter")).toBeNull();
  });

  it("unknown tinctures fall back to azure field / or charge; missing bgType is field 0", () => {
    const svg = shield({ heraldry: { bgColor: "nope", symbol: "x", symbolColor: "nope" } });
    expect(href(images(svg)[0])).toBe(B + "heraldry/000.png");
    expect(images(svg).length).toBe(2); // non-numeric symbol → none
    const azure = render(paletteTintSvg(TINCTURES[1].ramp, "b")).container;
    const fieldFuncs = [...svg.querySelectorAll("filter[id^='bt'] feFuncR")].map((f) => f.getAttribute("tableValues"));
    expect(fieldFuncs[0]).toBe(azure.querySelector("feFuncR").getAttribute("tableValues"));
  });
});

describe("unframed swatch", () => {
  it("draws only the field and charge at the native 69×105 aspect", () => {
    const svg = shield({
      heraldry: { bgColor: "vert", bgType: 4, symbol: 70, symbolColor: "argent" },
      framed: false,
      size: 69,
    });
    expect(svg.getAttribute("viewBox")).toBe("0 0 69 105");
    expect(Number(svg.getAttribute("height"))).toBe(105);
    const [field, sym] = images(svg);
    expect(href(field)).toBe(B + "heraldry/004.png");
    expect(field.getAttribute("x")).toBe("0");
    expect(sym.getAttribute("filter")).toBeNull(); // pre-coloured
    const tinted = shield({
      heraldry: { bgColor: "vert", bgType: 4, symbol: 20, symbolColor: "argent" },
      framed: false,
    });
    expect(images(tinted)[1].getAttribute("filter")).toMatch(/^url\(#st/);
    const plain = shield({ heraldry: { bgColor: "vert", bgType: 4, symbol: 0, symbolColor: "argent" }, framed: false });
    expect(images(plain).length).toBe(1);
  });
});

// paletteTint returns a <filter>; wrap it in an svg to inspect.
function paletteTintSvg(ramp, chan) {
  return <svg>{paletteTint("t", ramp, chan)}</svg>;
}

describe("paletteTint (the 3-shade palette swap)", () => {
  it("grabs the blue channel for a field and the green channel for a charge", () => {
    const f = render(paletteTintSvg(TINCTURES[0].ramp, "b")).container;
    expect(f.querySelector("feColorMatrix").getAttribute("values")).toBe("0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 1 0");
    const g = render(paletteTintSvg(TINCTURES[0].ramp, "g")).container;
    expect(g.querySelector("feColorMatrix").getAttribute("values")).toBe("0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0");
  });

  it("maps 0 → black, rising through the dark / mid / light shades to the light shade at full intensity", () => {
    const { container } = render(paletteTintSvg(TINCTURES[0].ramp, "b"));
    const r = container.querySelector("feFuncR").getAttribute("tableValues").split(" ").map(Number);
    expect(r.length).toBe(12);
    expect(r[0]).toBe(0);
    expect(r[11]).toBeCloseTo(255 / 255, 3); // gules light shade R = 255
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1] - 1e-9);
    const { container: g } = render(paletteTintSvg(TINCTURES[0].ramp, "g"));
    const gr = g.querySelector("feFuncR").getAttribute("tableValues").split(" ").map(Number);
    expect(gr[11]).toBeCloseTo(1, 3); // above the green light shade (0.831) → the light shade
  });
});

describe("faction crests", () => {
  it("finds Aguilleon by name (case-insensitive), nothing for others", () => {
    expect(factionCrest("The AGUILLEON Gate")).toMatchObject({ bgColor: "or", symbolColor: "sable" });
    expect(factionCrest("Carrone Army")).toBeNull();
    expect(factionCrest("")).toBeNull();
    expect(factionCrest(null)).toBeNull();
  });

  it("every banner crest uses real tinctures and a valid frame", () => {
    for (const h of Object.values(BANNER_HERALDRY)) {
      expect(TINCTURES.some((t) => t.id === h.bgColor)).toBe(true);
      expect(TINCTURES.some((t) => t.id === h.symbolColor)).toBe(true);
      expect(FRAMES[h.frame]).toBeTruthy();
    }
  });
});
