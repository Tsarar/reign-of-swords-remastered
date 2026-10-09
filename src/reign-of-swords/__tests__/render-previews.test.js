// Renderer previews (render/render.js) not reached by the frame tests: the Conjurer's leash tethers and minion count,
// the Horse Bowmen ride-shot plan, the move arrow (plain / gold charge with trample glyphs), the Retribution reach,
// the area-aim and grapeshot-aim tints, the Ep2 ability cells, Shock / grapeshot / single-shot / charge-ride intents,
// the Fear "nerve" read-out, the hover bracket and the action cursor, and the palette-swap pixel loops.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put, openLane } from "./battle.js";
import { rig, ops, texts, recCtx } from "./render-helpers.js";
import { UNIT_KEY_PRIMARY, UNIT_KEY_SECONDARY, UNIT_RAMPS } from "../data/game-data.js";

beforeAll(() => loadEpisode(2));

const battle = (id = 5428) => {
  const g = makeGame(id);
  startBattle(g);
  return g;
};
const hasText = (ctx, re) => texts(ctx).some((t) => re.test(String(t)));

describe("Conjurer previews", () => {
  it("selecting a Conjurer (or one of its minions) ties each minion to it with a labelled leash; red beyond 8", () => {
    const g = battle();
    const c = spawn(g, "conjurer", "blue", 2, 2);
    spawn(g, "sapper", "blue", 3, 3, { _conjuredBy: c.id });
    spawn(g, "bodyguard", "blue", 12, 9, { _conjuredBy: c.id });
    const ctx = recCtx();
    g.selected = c;
    g.renderer._drawLeashTethers(ctx);
    expect(hasText(ctx, /^leash 2\/8$/)).toBe(true);
    expect(ctx.log.some((e) => e.op === "fillText" && e.fill === "#ff9b9b")).toBe(true); // the far one
    const ctx2 = recCtx();
    g.selected = g.units.find((u) => u._conjuredBy === c.id);
    g.renderer._drawLeashTethers(ctx2);
    expect(ops(ctx2, "arc").length).toBeGreaterThan(0);
    // a conjurer with no minions draws nothing
    const lone = spawn(g, "conjurer", "blue", 9, 1);
    const ctx3 = recCtx();
    g.selected = lone;
    g.renderer._drawLeashTethers(ctx3);
    expect(ctx3.log.length).toBe(0);
  });

  it("while Conjure is armed the caster shows its minion count", () => {
    const g = battle();
    const c = spawn(g, "conjurer", "blue", 4, 4);
    spawn(g, "sapper", "blue", 4, 5, { _conjuredBy: c.id });
    g.selected = c;
    g.aimMode = true;
    g._abilityAim = "conjure_sapper";
    const ctx = recCtx();
    g.renderer._drawFieldLabels(ctx);
    expect(texts(ctx)).toContain("minions 1/2");
  });
});

describe("movement previews", () => {
  it("hovering a reachable tile draws the arrow; a Horse Bowmen ride also shows each arrow it will loose", () => {
    const g = battle();
    const hb = spawn(g, "horsebowmen", "blue", 4, 4);
    spawn(g, "militiamen", "red", 6, 5);
    g.select(hb);
    const to = [...g.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => y === 4 && x >= 7);
    if (!to) return;
    g.hover = { tx: to[0], ty: to[1] };
    const ctx = recCtx();
    g.renderer._drawTargetNumbers(ctx);
    expect(ops(ctx, "lineTo").length).toBeGreaterThan(0);
    expect(hasText(ctx, /^🏹-\d+$/)).toBe(true);
  });

  it("a straight charge run turns the arrow gold and marks the foot soldier it would trample (and the next it rides on to)", () => {
    const g = battle(5410);
    const k = spawn(g, "knights", "blue", 0, 0);
    const lane = openLane(g, k, 6);
    put(g, k, lane.x, lane.y);
    const m1 = spawn(g, "militiamen", "red", lane.x + 4, lane.y, { hp: 5 });
    spawn(g, "militiamen", "red", lane.x + 5, lane.y, { hp: 5 });
    const path = [0, 1, 2, 3].map((d) => ({ tx: lane.x + d, ty: lane.y }));
    const ctx = recCtx();
    g.renderer._drawMoveArrow(ctx, path, k);
    expect(ctx.log.some((e) => e.op === "stroke" && e.stroke === "rgba(255,206,84,0.95)")).toBe(true);
    expect(texts(ctx).filter((t) => /^⚡-\d+$/.test(t)).length).toBe(2);
    void m1;
    // a bent path is an ordinary move (white)
    const ctx2 = recCtx();
    g.renderer._drawMoveArrow(ctx2, [path[0], path[1], { tx: path[1].tx, ty: path[1].ty + 1 }], k);
    expect(ctx2.log.some((e) => e.op === "stroke" && e.stroke === "rgba(230,237,243,0.95)")).toBe(true);
    g.renderer._drawMoveArrow(ctx2, [path[0]], k); // nothing to draw
  });

  it("the charge ride-on preview follows the lane through foot soldiers the charge cuts down", () => {
    const g = battle(5410);
    const k = spawn(g, "knights", "blue", 0, 0);
    const lane = openLane(g, k, 5);
    put(g, k, lane.x, lane.y);
    const t = spawn(g, "militiamen", "red", lane.x + 1, lane.y, { hp: 1 });
    spawn(g, "militiamen", "red", lane.x + 3, lane.y, { hp: 1 });
    k.chargeDir = { dx: 1, dy: 0 };
    const ctx = recCtx();
    g.renderer._intentChargeRide(ctx, k, t);
    expect(texts(ctx).some((s) => /^⚡-/.test(s))).toBe(true);
  });
});

describe("aim and ability tints", () => {
  it("Retribution's reach is tinted while its button is hovered", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "blue", 6, 6);
    spawn(g, "footmen", "blue", 6, 7);
    g.selected = p;
    g._retribPreview = true;
    const ctx = rig(g);
    g.renderer._drawOverlays(ctx);
    expect(ctx.log.some((e) => e.op === "fillRect" && e.fill === "rgba(120,90,220,0.12)")).toBe(true);
    expect(ctx.log.some((e) => e.op === "strokeRect" && e.stroke === "rgba(200,170,255,0.95)")).toBe(true);
  });

  it("area aim tints the cast band and previews the blast at the hovered tile; grapeshot aim marks the 4 sides", () => {
    const g = battle(5410);
    const c = spawn(g, "catapult", "blue", 6, 6);
    g.select(c);
    g.aimMode = true;
    g._aimKind = "shot";
    const [mn] = g._castRange(c);
    g.hover = { tx: 6, ty: 6 + mn };
    const ctx = rig(g);
    g.renderer._drawOverlays(ctx);
    expect(ctx.log.some((e) => e.op === "fillRect" && e.fill === "rgba(255,170,80,0.09)")).toBe(true);
    const cn = spawn(g, "cannon", "blue", 0, 0);
    g.select(cn);
    g.aimMode = true;
    g._aimKind = "grape";
    g.hover = { tx: 0, ty: 1 };
    const ctx2 = rig(g);
    g.renderer._drawOverlays(ctx2);
    expect(ctx2.log.filter((e) => e.op === "fillRect" && e.fill === "rgba(255,170,80,0.12)").length).toBe(2); // 2 sides on the map
  });

  it("an armed Ep2 ability tints the tiles it can be cast on", () => {
    const g = battle();
    const s = spawn(g, "craftsmen", "blue", 6, 6);
    g.selected = s;
    g.aimMode = true;
    g._abilityAim = "build";
    vi.spyOn(g, "_abilityCells").mockReturnValue([{ x: 6, y: 7 }]);
    const ctx = rig(g);
    g.renderer._drawOverlays(ctx);
    expect(ctx.log.some((e) => e.op === "fillRect" && e.fill === "rgba(120,220,140,0.30)")).toBe(true);
  });

  it("with nothing selected, hovering one of your ready units brackets it", () => {
    const g = battle();
    g.deselect();
    const u = g.units.find((x) => x.team === "blue" && !x.ally && !x.acted);
    g.hover = { tx: u.tx, ty: u.ty };
    const br = vi.spyOn(g.renderer, "_bracket");
    g.renderer._drawOverlays(rig(g));
    expect(br).toHaveBeenCalledWith(expect.anything(), u.tx, u.ty, "rgba(230,237,243,0.5)");
  });

  it("the cursor: a sword over a foe it can walk up to strike, a boot over a free reachable tile", () => {
    const g = battle(5410);
    const f = spawn(g, "footmen", "blue", 4, 4);
    only(g, f, ...g.units.filter((u) => u.hero), spawn(g, "militiamen", "blue", 0, 0));
    const foe = spawn(g, "militiamen", "red", 4, 7);
    g.select(f);
    vi.spyOn(g, "bestApproach").mockReturnValue({ tx: 4, ty: 6 });
    g.hover = { tx: foe.tx, ty: foe.ty };
    g.renderer._drawOverlays(rig(g));
    expect(g.renderer._cursorKind).toBe("attack");
    const free = [...g.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => !g.unitAt(x, y));
    g.hover = { tx: free[0], ty: free[1] };
    g.renderer._drawOverlays(rig(g));
    expect(g.renderer._cursorKind).toBe("move");
  });
});

describe("attack intents", () => {
  it("grapeshot: every caught unit in the T gets its number; Shock: the 4 tiles around the ballista", () => {
    const g = battle();
    const c = spawn(g, "cannon", "blue", 5, 5);
    const foe = spawn(g, "militiamen", "red", 5, 4);
    spawn(g, "militiamen", "blue", 4, 4); // an ally in the row
    const ctx = recCtx();
    g.renderer._drawAttackIntent(ctx, c, foe);
    expect(texts(ctx).length).toBeGreaterThanOrEqual(2);
    const b = spawn(g, "ballistae", "blue", 9, 5);
    const f2 = spawn(g, "militiamen", "red", 9, 4);
    const ctx2 = recCtx();
    g.renderer._drawAttackIntent(ctx2, b, f2);
    expect(texts(ctx2).length).toBeGreaterThan(0);
    // at the map corner the off-map sides are skipped
    const b2 = spawn(g, "ballistae", "blue", 0, 0);
    expect(() => g.renderer._intentShock(recCtx(), b2, { tx: 1, ty: 0 })).not.toThrow();
    expect(() =>
      g.renderer._intentGrapeshot(recCtx(), spawn(g, "cannon", "blue", 0, 1), { tx: 0, ty: 0 }),
    ).not.toThrow();
  });

  it("a single-shot engine marks the aim point with a crosshair, the drift odds, and the Piercing Bolt's two tiles beyond", () => {
    const g = battle();
    const t = spawn(g, "trebuchet", "blue", 2, 2);
    const ctx = recCtx();
    g.renderer._intentSingleShot(ctx, t, { tx: 2, ty: 8 });
    expect(hasText(ctx, /may deviate \d+%/)).toBe(true);
    const b = spawn(g, "ballistae", "blue", 2, 10);
    const hit = spawn(g, "militiamen", "red", 7, 10);
    const ctx2 = recCtx();
    g.renderer._intentSingleShot(ctx2, b, { tx: 6, ty: 10 });
    expect(texts(ctx2).length).toBeGreaterThan(0); // the unit behind the aim point carries its number
    void hit;
  });

  it("a Fear target shows the attacker's odds of keeping its nerve (sure at courage 100+)", () => {
    const g = battle(5410);
    const a = spawn(g, "militiamen", "blue", 4, 4);
    const gr = spawn(g, "griffon", "red", 4, 5);
    g.select(a);
    g.enterAct(a);
    expect(g.targets).toContain(gr);
    const ctx = recCtx();
    g.renderer._drawTargetNumbers(ctx);
    expect(hasText(ctx, /^nerve \d+%$|^nerve sure$/)).toBe(true);
    const ctx2 = recCtx({ omit: ["roundRect"] }); // a browser without roundRect falls back to a plain box
    g.renderer._drawTargetNumbers(ctx2);
    expect(ops(ctx2, "fillRect").length).toBeGreaterThan(0);
  });
});

describe("the palette swap pixel loops", () => {
  function imageWith(pixels) {
    const data = new Uint8ClampedArray(
      pixels.flatMap(([rgb, a]) => [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, a]),
    );
    return data;
  }
  function stubCanvas(data, fail = false) {
    const ctx = {
      drawImage() {},
      getImageData: () => {
        if (fail) throw new Error("tainted");
        return { data };
      },
      putImageData: vi.fn(),
    };
    return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  }

  it("swaps the three key greens and blues for the group's ramps; transparent and other pixels stay", () => {
    const g = battle();
    const data = imageWith([
      [UNIT_KEY_PRIMARY[0], 255],
      [UNIT_KEY_SECONDARY[2], 255],
      [0x123456, 255],
      [UNIT_KEY_PRIMARY[1], 0],
    ]);
    const spy = stubCanvas(data);
    g.renderer._paletteSwapped({ width: 4, height: 1 }, "t-swap-1", "gules", "azure");
    const px = (i) => (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    expect(px(0)).toBe(UNIT_RAMPS.gules[0]);
    expect(px(1)).toBe(UNIT_RAMPS.azure[2]);
    expect(px(2)).toBe(0x123456);
    expect(px(3)).toBe(UNIT_KEY_PRIMARY[1]);
    spy.mockRestore();
  });

  it("a canvas that can't be read back keeps the original art (both recolourers)", () => {
    const g = battle();
    const im = { width: 2, height: 1 };
    const spy = stubCanvas(null, true);
    expect(g.renderer._paletteSwapped(im, "t-swap-2", "gules", "azure")).toBe(im);
    expect(g.renderer._recolored(im, "t-rec-2", 30)).toBe(im);
    spy.mockRestore();
  });

  it("the hue recolour turns only the saturated blue team band; grey, green and transparent pixels stay", () => {
    const g = battle();
    const data = imageWith([
      [0x2040e0, 255], // saturated blue — the team band
      [0x808080, 255], // grey (no saturation)
      [0x20c040, 255], // green trim
      [0x7f7f90, 255], // low saturation
      [0x2040e0, 5], // nearly transparent
    ]);
    const before = Array.from(data);
    const spy = stubCanvas(data);
    g.renderer._recolored({ width: 5, height: 1 }, "t-rec-1", 0);
    expect(Array.from(data.slice(0, 4))).not.toEqual(before.slice(0, 4));
    expect(Array.from(data.slice(4))).toEqual(before.slice(4));
    spy.mockRestore();
  });
});

describe("the last previews", () => {
  it("a single-target engine that isn't free-aimed marks the target and warns it may drift", () => {
    const g = battle();
    const t = spawn(g, "trebuchet", "blue", 2, 2);
    vi.spyOn(g, "_freeAim").mockReturnValue(false);
    const ctx = recCtx();
    g.renderer._drawAttackIntent(ctx, t, spawn(g, "militiamen", "red", 2, 8));
    expect(hasText(ctx, /may deviate$/)).toBe(true);
  });
});
