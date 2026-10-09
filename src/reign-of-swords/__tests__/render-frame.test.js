// Renderer — the frame as a whole (Game.render) and the field layers under the units: terrain (tileset blits, Ep2
// tall cells, quicksand), the tutorial "green square", the deploy overlay, objective regions + flags, damaged-structure
// bars and the minimap. Drawn into a recording context so each test checks what actually reached the canvas.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, step, spawn, only, put } from "./battle.js";
import { rig, ops, texts, filledWith, drewImage, clear, fakeAssets, img } from "./render-helpers.js";
import { key } from "../util/util.js";
import { UNIT_TYPES } from "../data/game-data.js";

beforeAll(() => loadEpisode(2));

function battle(map = 5428) {
  const g = makeGame(map);
  startBattle(g);
  return g;
}
const visibleCells = (g) => {
  const R = g.renderer.visibleRange();
  return (R.x1 - R.x0 + 1) * (R.y1 - R.y0 + 1);
};

describe("render() — one frame", () => {
  it("clears to the off-map colour, scrolls by the camera, and restores the transform before the minimap", () => {
    const g = battle();
    const ctx = rig(g);
    g.renderer.render();
    const L = ctx.log;
    expect(L[0]).toMatchObject({ op: "setTransform", args: [g.dpr, 0, 0, g.dpr, 0, 0] });
    expect(L[1]).toMatchObject({ op: "fillRect", args: [0, 0, g.view.w, g.view.h], fill: "#141821" });
    const tr = ops(ctx, "translate")[0];
    expect(tr.args).toEqual([-Math.round(g.cam.x), -Math.round(g.cam.y)]);
    // the minimap's viewport frame is the last stroke of the frame
    const last = ops(ctx, "strokeRect").at(-1);
    expect(last.stroke).toBe("#ffd36b");
  });

  it("draws every living unit's HP, back to front (sorted by screen y)", () => {
    const g = battle();
    only(g, ...g.units.slice(0, 6));
    g.units[0].hp = 41;
    g.units[1].hp = 42;
    // put the unit with 41 HP lower on the screen than the one with 42: it must be drawn later
    put(g, g.units[0], 3, 12);
    put(g, g.units[1], 3, 10);
    g.units[2].dead = true;
    g.units[2].hp = 43;
    const ctx = rig(g);
    g.renderer.render();
    const t = texts(ctx);
    expect(t.indexOf("42")).toBeGreaterThanOrEqual(0);
    expect(t.indexOf("41")).toBeGreaterThan(t.indexOf("42"));
    expect(t).not.toContain("43"); // a slain unit simply leaves the field
  });

  it("runs every layer: projectiles, FX, particles, floaters, structure bars and field labels", () => {
    const g = battle();
    const ctx = rig(g);
    g.projectiles.push({ kind: "arrow", x: 0, y: 0, tx: 100, ty: 0, t: 0.5, dur: 1 });
    g.spawnFx("slash", 50, 50);
    g.fx[0].t = 0.1;
    g.particles.push({ t: 0.1, life: 1, x: 5, y: 5, r: 2, color: "#abcdef" });
    g.floaters.push({ x: 10, y: 10, t: 0, life: 1, text: 17 });
    g.renderer.render();
    expect(texts(ctx)).toContain("-17");
    expect(drewImage(ctx, g.assets.arrows.normal)).toHaveLength(1);
    expect(drewImage(ctx, g.assets.fx.slash)).toHaveLength(1);
    expect(ops(ctx, "arc").some((e) => e.fill === "#abcdef")).toBe(true);
  });
});

describe("terrain", () => {
  it("lays one grass ground, a grass tile under every visible cell, then each non-grass cell's own (tall) tile", () => {
    const g = battle();
    const ctx = rig(g);
    g.renderer._drawTerrain(ctx);
    const R = g.renderer.visibleRange(),
      t = g.tile;
    expect(ops(ctx, "fillRect")[0]).toMatchObject({
      fill: "#5c8f3e",
      args: [R.x0 * t, R.y0 * t, (R.x1 - R.x0 + 1) * t + 1, (R.y1 - R.y0 + 1) * t + 1],
    });
    const blits = drewImage(ctx, g.assets.tileset);
    const grass = blits.filter((e) => e.args[1] === 63 * 40 && e.args[4] === 40); // the 40×40 grass base
    expect(grass).toHaveLength(visibleCells(g));
    // Episode II: own tiles are 40×55 source cells drawn bottom-anchored, rising out of the cell
    let own = 0;
    for (let y = R.y0; y <= R.y1; y++) for (let x = R.x0; x <= R.x1; x++) if (g.tileAt(x, y) !== 63) own++;
    const tall = blits.filter((e) => e.args[4] === 55);
    expect(tall).toHaveLength(own);
    const tallH = Math.round((t * 55) / 40);
    expect(tall[0].args[8]).toBe(tallH + 2);
    // nearest-neighbour for the tiles, then the caller's smoothing is restored
    expect(ctx.state.imageSmoothingEnabled).toBe(true);
  });

  it("with no tileset loaded only the flat grass ground is painted", () => {
    const g = battle();
    const ctx = rig(g, { without: ["tileset"] });
    g.renderer._drawTerrain(ctx);
    expect(ops(ctx, "drawImage")).toHaveLength(0);
    expect(ops(ctx, "fillRect")).toHaveLength(1);
  });

  it("quicksand turns the real 4-frame whirlpool over each visible cell (frame = clock / 0.4)", () => {
    const g = battle();
    const ctx = rig(g);
    const R = g.renderer.visibleRange();
    g.quicksand.set(key(R.x0, R.y0), 3);
    g.quicksand.set(key(R.x0 + 1, R.y0), 1);
    g.quicksand.set(key(R.x0, R.y1 + 3), 2); // below the screen: skipped
    g.clock = 0.9;
    g.renderer._drawTerrain(ctx);
    const qs = drewImage(ctx, g.assets.fx.quicksand);
    expect(qs).toHaveLength(2);
    expect(qs[0].args.slice(1, 5)).toEqual([2 * 40, 0, 40, 40]);
    expect(qs[0].args.slice(5)).toEqual([R.x0 * g.tile, R.y0 * g.tile, g.tile, g.tile]);
  });

  it("without the quicksand strip a sandy wash stands in, deeper the more rounds are left", () => {
    const g = battle();
    const ctx = rig(g, { fxWithout: ["quicksand"] });
    const R = g.renderer.visibleRange();
    g.quicksand.set(key(R.x0, R.y0), 4);
    g.quicksand.set(key(R.x0 + 1, R.y0), 2);
    g.clock = undefined;
    g.renderer._drawTerrain(ctx);
    const wash = ops(ctx, "fillRect").filter((e) => String(e.fill).startsWith("rgba(122,94,44,"));
    expect(wash.map((e) => e.fill)).toEqual(["rgba(122,94,44,0.4)", "rgba(122,94,44,0.35)"]);
  });

  it("visibleRange clamps the camera window to the map", () => {
    const g = battle();
    g.cam = { x: -500, y: -500 };
    expect(g.renderer.visibleRange()).toMatchObject({ x0: 0, y0: 0 });
    g.cam = { x: 1e6, y: 1e6 };
    expect(g.renderer.visibleRange()).toMatchObject({ x1: g.cols - 1, y1: g.rows - 1 });
  });
});

describe("tutorial assembly zone (5806 — the 'green square' kept in battle)", () => {
  it("each guide tile pulses green; one a soldier stands on is filled and ticked", () => {
    const g = makeGame(5806);
    startBattle(g);
    expect(g.phase).toBe("player");
    const zone = [...g.tutZone].map((k) => k.split(",").map(Number));
    const u = g.units.find((x) => x.team === "blue");
    only(g, u);
    put(g, u, ...zone[0]);
    const ctx = rig(g);
    g.renderer.render();
    expect(filledWith(ctx, "rgba(76,186,74,0.62)")).toHaveLength(1);
    const pulse = ops(ctx, "fillRect").filter((e) => /^rgba\(96,206,84,/.test(e.fill));
    expect(pulse).toHaveLength(zone.length - 1);
    expect(ops(ctx, "stroke").filter((e) => e.stroke === "rgba(235,255,210,0.95)")).toHaveLength(1); // the tick
  });

  it("an empty zone draws nothing", () => {
    const g = makeGame(5806);
    startBattle(g);
    g.tutZone = new Set();
    const ctx = rig(g);
    g.renderer._drawTutorialZone(ctx);
    expect(ctx.log).toHaveLength(0);
  });
});

describe("deploy overlay", () => {
  function deploy(map = 5225, opts) {
    const g = makeGame(map, opts);
    step(g, 20);
    expect(g.phase).toBe("deploy");
    return g;
  }
  it("tints every muster tile gold and frames it", () => {
    const g = deploy();
    const ctx = rig(g);
    g.renderer.render();
    expect(filledWith(ctx, "rgba(232,196,64,0.20)")).toHaveLength(g.deployZone.size);
  });

  it("a deployment tutorial's muster tiles are green instead (the dialogue's 'green square')", () => {
    const g = deploy(5802);
    const ctx = rig(g);
    g.renderer._drawDeploy(ctx);
    expect(filledWith(ctx, "rgba(96,196,84,0.22)")).toHaveLength(g.deployZone.size);
    expect(filledWith(ctx, "rgba(232,196,64,0.20)")).toHaveLength(0);
  });

  it("glows the Hero picked up for repositioning, and an issued unit picked up", () => {
    const g = deploy();
    const hero = g.units.find((u) => u.hero && u.team === "blue");
    expect(hero).toBeTruthy();
    g._deployClick(hero.tx, hero.ty); // tap the Hero: pick him up
    expect(g.pickHero).toBe(true);
    const ctx = rig(g);
    g.renderer._drawDeploy(ctx);
    const t = g.tile;
    const glow = ops(ctx, "strokeRect").find((e) => /^rgba\(255,211,107,/.test(e.stroke));
    expect(glow.args).toEqual([hero.tx * t + 2, hero.ty * t + 2, t - 4, t - 4]);
    clear(ctx);
    g.pickHero = false;
    const [fx, fy] = freeZoneTile(g);
    g.placeUnit(g._rosterOrder[0], fx, fy);
    const other = g.units.find((u) => u.team === "blue" && !u.hero);
    g.pickUp = other;
    g.renderer._drawDeploy(ctx);
    const held = ops(ctx, "strokeRect").find((e) => /^rgba\(120,200,255,/.test(e.stroke));
    expect(held.args).toEqual([other.tx * t + 2, other.ty * t + 2, t - 4, t - 4]);
    // a dead pick-up is not glowed; a hero-pick with no Hero on the field glows nothing
    clear(ctx);
    other.dead = true;
    g.pickHero = true;
    g.units = g.units.filter((u) => !u.hero);
    g.renderer._drawDeploy(ctx);
    expect(ops(ctx, "strokeRect").filter((e) => /^rgba\((255,211,107|120,200,255),/.test(e.stroke))).toHaveLength(0);
  });

  function freeZoneTile(g) {
    for (const k of g.deployZone) {
      const [x, y] = k.split(",").map(Number);
      if (!g.unitAt(x, y) && g.terrainAt(x, y).passable) return [x, y];
    }
    throw new Error("no free muster tile");
  }

  it("ghosts the unit being placed on the hovered free muster tile (its stand art), framed gold when affordable", () => {
    const g = deploy();
    const type = g._rosterOrder.find((t) => g.canAfford(t));
    g.setPlacing(type);
    const [x, y] = freeZoneTile(g);
    g.hover = { tx: x, ty: y };
    const ctx = rig(g);
    g.renderer._drawDeploy(ctx);
    const ghost = drewImage(ctx, g.assets.stands[type]);
    expect(ghost).toHaveLength(1);
    expect(ghost[0].alpha).toBe(0.55);
    expect(ops(ctx, "strokeRect").at(-1).stroke).toBe("#f0d25a");
  });

  it("without stand art it ghosts the battle sheet; a unit you can't afford is faint and framed red", () => {
    const g = deploy(5225, { god: false });
    // spend the muster budget on the priciest roster type until it can't be afforded any more
    const type = g._rosterOrder.slice().sort((a, b) => g.deployCost(b) - g.deployCost(a))[0];
    for (let i = 0; i < 200 && g.canAfford(type); i++) g.placeUnit(type, ...freeZoneTile(g));
    expect(g.canAfford(type)).toBe(false);
    g.placing = type;
    const [x, y] = freeZoneTile(g);
    g.hover = { tx: x, ty: y };
    const ctx = rig(g, { stands: false });
    g.renderer._drawDeploy(ctx);
    const ghost = drewImage(ctx, g.assets.sheets[type].blue);
    expect(ghost).toHaveLength(1);
    expect(ghost[0].alpha).toBe(0.3);
    expect(ghost[0].args[3]).toBe(UNIT_TYPES[type].frameW); // source width = the battle frame width
    expect(ops(ctx, "strokeRect").at(-1).stroke).toBe("#e0503f");
  });

  it("no ghost over an occupied tile or outside the muster zone", () => {
    const g = deploy();
    g.placing = g._rosterOrder[0];
    const occ = g.units.find((u) => u.team === "blue" && g.deployZone.has(key(u.tx, u.ty)));
    g.hover = { tx: occ.tx, ty: occ.ty };
    const ctx = rig(g);
    g.renderer._drawDeploy(ctx);
    expect(ops(ctx, "drawImage")).toHaveLength(0);
    g.hover = { tx: 0, ty: 0 };
    g.renderer._drawDeploy(ctx);
    expect(ops(ctx, "drawImage")).toHaveLength(0);
  });
});

describe("objectives", () => {
  it("fills each objective tile purple and outlines only a region's outer edge", () => {
    const g = battle();
    const ctx = rig(g);
    // a 2×1 strip and a lone tile: 6 outer sides + 4 = 10 edges
    g.objectives = [
      { tx: 2, ty: 2, area: null },
      { tx: 3, ty: 2, area: null },
      { tx: 7, ty: 7, area: null },
    ];
    g.renderer._drawObjectives(ctx);
    expect(filledWith(ctx, "rgba(178,120,240,0.14)")).toHaveLength(3);
    const save = ctx.log.findIndex((e) => e.op === "save");
    const stroke = ctx.log.findIndex((e) => e.op === "stroke");
    const edges = ctx.log.slice(save, stroke).filter((e) => e.op === "lineTo");
    expect(edges).toHaveLength(10);
    // two regions → two flags (the real flag art)
    expect(drewImage(ctx, g.assets.flags)).toHaveLength(2);
  });

  it("groups by the record's capture areas first, then by touching tiles; the flag stands nearest the middle", () => {
    const g = battle();
    g.objectives = [
      { tx: 1, ty: 1, area: 0 },
      { tx: 5, ty: 1, area: 0 }, // same area, not touching
      { tx: 3, ty: 4, area: null },
      { tx: 4, ty: 4, area: null },
      { tx: 5, ty: 4, area: null },
      { tx: 9, ty: 9, area: null },
    ];
    const regions = g.renderer._objectiveRegions();
    expect(regions).toHaveLength(3);
    expect(regions[0].tiles).toHaveLength(2);
    expect(regions[1].tiles.map((t) => t.tx)).toEqual([3, 4, 5]);
    expect(regions[1].flag).toMatchObject({ tx: 4, ty: 4 });
    expect(g.renderer._objectiveRegions()).toBe(regions); // cached
    g.objectives.push({ tx: 12, ty: 12, area: null });
    expect(g.renderer._objectiveRegions()).not.toBe(regions); // rebuilt when the list changes
    expect(g.renderer._objectiveRegions()).toHaveLength(4);
  });

  it("a region's flag shows who holds most of it: green frame for you, red for the enemy, white for nobody", () => {
    const g = battle();
    only(g);
    g.objectives = [
      { tx: 2, ty: 2, area: null },
      { tx: 3, ty: 2, area: null },
      { tx: 4, ty: 2, area: null },
    ];
    const frameOf = () => {
      const ctx = rig(g);
      g.renderer._drawObjectives(ctx);
      return drewImage(ctx, g.assets.flags)[0].args[1] / 64;
    };
    expect(frameOf()).toBe(0);
    spawn(g, "footmen", "blue", 2, 2);
    expect(frameOf()).toBe(1);
    spawn(g, "footmen", "red", 3, 2);
    spawn(g, "footmen", "red", 4, 2);
    expect(frameOf()).toBe(2);
    g.units[2].dead = true; // a slain holder no longer counts → 1 v 1 → nobody
    expect(frameOf()).toBe(0);
  });

  it("a lone objective tile flies the colour of whoever last took it", () => {
    const g = battle();
    only(g);
    g.objectives = [{ tx: 5, ty: 5, area: null, owner: "red" }];
    const ctx = rig(g);
    g.renderer._drawObjectives(ctx);
    expect(drewImage(ctx, g.assets.flags)[0].args[1]).toBe(128);
  });

  it("without the flag art it draws a pennant on a pole in the holder's colour", () => {
    const g = battle();
    const ctx = rig(g, { without: ["flags"] });
    g.renderer._drawObjectiveFlag(ctx, 0, 0, "blue");
    g.renderer._drawObjectiveFlag(ctx, 0, 0, "red");
    g.renderer._drawObjectiveFlag(ctx, 0, 0, null);
    expect(ops(ctx, "fill").map((e) => e.fill)).toEqual(["rgb(120,190,255)", "rgb(255,110,100)", "rgb(240,240,240)"]);
    g.assets = { flags: img(0, 0) }; // an image that failed to load (no width) → the pennant too
    clear(ctx);
    g.renderer._drawObjectiveFlag(ctx, 0, 0, null);
    expect(ops(ctx, "drawImage")).toHaveLength(0);
    expect(ops(ctx, "fill")).toHaveLength(1);
  });

  it("the real capture map (5425) draws its objective area", () => {
    const g = battle(5425);
    expect(g.objectives.length).toBeGreaterThan(0);
    const ctx = rig(g);
    g.renderer._drawObjectives(ctx);
    expect(filledWith(ctx, "rgba(178,120,240,0.14)")).toHaveLength(g.objectives.length);
    expect(drewImage(ctx, g.assets.flags)).toHaveLength(g.renderer._objectiveRegions().length);
  });
});

describe("structure health bars", () => {
  // a structure cell on the siege map, and a tile 4 away (in catapult range) a catapult can stand on
  function siege() {
    const g = battle(5600);
    for (let y = 0; y < g.rows; y++)
      for (let x = 0; x < g.cols; x++) if (g.isStructure(x, y)) return { g, sx: x, sy: y };
    throw new Error("no structure");
  }
  it("draws a bar over each damaged structure, coloured by what is left of its stage", () => {
    const { g, sx, sy } = siege();
    g.structHp.set(key(sx, sy), 200);
    const ctx = rig(g);
    g.renderer._drawStructureBars(ctx);
    const t = g.tile,
      w = t * 0.62;
    const bar = ops(ctx, "fillRect")[1];
    expect(bar.fill).toBe("#e0b050");
    expect(bar.args[2]).toBeCloseTo(w * (200 / 256));
    expect(bar.args[0]).toBeCloseTo(sx * t + (t - w) / 2);
    for (const [hp, col] of [
      [100, "#e07a30"],
      [20, "#d8452e"],
    ]) {
      clear(ctx);
      g.structHp.set(key(sx, sy), hp);
      g.renderer._drawStructureBars(ctx);
      expect(ops(ctx, "fillRect")[1].fill).toBe(col);
    }
  });

  it("a cell that is not a structure (or has no hp map) draws nothing", () => {
    const { g } = siege();
    let open = null;
    for (let y = 0; y < g.rows && !open; y++)
      for (let x = 0; x < g.cols && !open; x++) if (!g.isStructure(x, y)) open = [x, y];
    g.structHp.set(key(...open), 50);
    const ctx = rig(g);
    g.renderer._drawStructureBars(ctx);
    expect(ctx.log).toHaveLength(0);
    g.structHp = null;
    g.renderer._drawStructureBars(ctx);
    expect(ctx.log).toHaveLength(0);
  });

  it("hovering an intact structure the selected unit can shoot shows its full bar", () => {
    const { g, sx, sy } = siege();
    const cat = spawn(g, "catapult", "blue", 0, 0);
    let spot = null;
    for (let y = 0; y < g.rows && !spot; y++)
      for (let x = 0; x < g.cols && !spot; x++) {
        if (g.unitAt(x, y) || g.isStructure(x, y)) continue;
        put(g, cat, x, y);
        if (g.canHitStructure(cat, sx, sy)) spot = [x, y];
      }
    expect(spot).not.toBeNull();
    g.selected = cat;
    g.hover = { tx: sx, ty: sy };
    const ctx = rig(g);
    g.renderer._drawStructureBars(ctx);
    const bar = ops(ctx, "fillRect")[1];
    expect(bar.fill).toBe("#e0b050");
    expect(bar.args[2]).toBeCloseTo(g.tile * 0.62);
    // …not once the unit has acted
    clear(ctx);
    cat.acted = true;
    g.renderer._drawStructureBars(ctx);
    expect(ctx.log).toHaveLength(0);
  });
});

describe("minimap", () => {
  it("on a map bigger than the view: one cell per tile, a dot per living unit, and the camera's frame", () => {
    const g = battle();
    expect(g.world.h).toBeGreaterThan(g.view.h);
    g.units[0].dead = true;
    const ctx = rig(g);
    g.renderer._drawMinimap(ctx);
    const blue = g.units.filter((u) => !u.dead && u.team === "blue").length,
      red = g.units.filter((u) => !u.dead && u.team === "red").length;
    expect(filledWith(ctx, "#5aa0ff")).toHaveLength(blue);
    expect(filledWith(ctx, "#ff5a4a")).toHaveLength(red);
    expect(ops(ctx, "fillRect")).toHaveLength(1 + g.cols * g.rows + blue + red);
    const mw = Math.min(150, g.cols * 5),
      mh = g.rows * (mw / g.cols);
    const frame = ops(ctx, "strokeRect")[0];
    expect(frame.args[2]).toBeCloseTo((g.view.w / g.world.w) * mw);
    expect(frame.args[3]).toBeCloseTo((g.view.h / g.world.h) * mh);
    // impassable cells are dark; passable ones take their category colour
    const colours = new Set(ops(ctx, "fillRect").map((e) => e.fill));
    expect(colours.has("#5c9044") || colours.has("#b79b62") || colours.has("#2e5c2e")).toBe(true);
  });

  it("fades out while a unit or the cursor is under it, and back in once the corner is clear", () => {
    const g = battle();
    const box = () => {
      const mw = Math.min(150, g.cols * 5);
      return { x: g.view.w - mw - 8, y: 8, w: mw, h: g.rows * (mw / g.cols) };
    };
    const u = g.units.find((x) => !x.dead && x.team === "blue");
    const away = () => {
      u.px = g.cam.x;
      u.py = g.cam.y + g.view.h - g.tile;
    };
    for (const other of g.units) if (other !== u) other.dead = true;
    away();
    g.hoverPx = null;
    const ctx = rig(g);
    g.renderer._drawMinimap(ctx);
    expect(g.renderer._mmAlpha).toBeCloseTo(0.9);
    // a unit drawn inside the minimap's box: it eases toward 0.15
    const b = box();
    u.px = g.cam.x + b.x + b.w / 2;
    u.py = g.cam.y + b.y + b.h / 2;
    for (let i = 0; i < 30; i++) g.renderer._drawMinimap(ctx);
    expect(g.renderer._mmAlpha).toBeLessThan(0.2);
    // corner clear again: back to 0.9
    away();
    for (let i = 0; i < 30; i++) g.renderer._drawMinimap(ctx);
    expect(g.renderer._mmAlpha).toBeGreaterThan(0.85);
    // the cursor over it fades it too; a hidden foe there does not
    g.hoverPx = { x: b.x + 2, y: b.y + 2 };
    expect(g.renderer._underMinimap(b.x, b.y, b.w, b.h)).toBe(true);
    g.hoverPx = null;
    u.team = "red";
    u._hidden = true;
    u.px = g.cam.x + b.x + 2;
    u.py = g.cam.y + b.y + 2;
    expect(g.renderer._underMinimap(b.x, b.y, b.w, b.h)).toBe(false);
  });

  it("is skipped when the whole map fits the view", () => {
    const g = battle(5804);
    g.view = { w: g.world.w, h: g.world.h };
    const ctx = rig(g);
    g.renderer._drawMinimap(ctx);
    expect(ctx.log).toHaveLength(0);
  });
});

describe("asset fallbacks keep the frame drawing", () => {
  it("a frame with an empty asset bag for effects still renders units", () => {
    const g = battle();
    const assets = fakeAssets({ without: ["statusIcons", "walks"] });
    const ctx = rig(g, { assets });
    g.renderer.render();
    expect(texts(ctx).length).toBeGreaterThan(0);
  });
});
