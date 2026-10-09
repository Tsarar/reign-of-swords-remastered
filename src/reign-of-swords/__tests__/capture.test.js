// Capture areas — GameScreen::updateCapturePoints (Ep1 @0x18a2a, Ep2 @0x1d4d2): a "hold" (type 1) or "conquer"
// (type 2) mission scores the record's areas, each with an owner and a flag on its first tile.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, put } from "./battle.js";
import { strictMost } from "../util/util.js";
import { tileType } from "../rules/terrain.js";

beforeAll(() => loadEpisode(1));

// clear an area's tiles of units, so a test decides who stands on it
function emptyArea(g, a) {
  for (const t of a.tiles) {
    const u = g.unitAt(t.tx, t.ty);
    if (u) u.dead = true;
  }
  g.units = g.units.filter((u) => !u.dead);
}

describe("strictMost", () => {
  it("names the side with strictly the most, else nobody", () => {
    expect(strictMost({ blue: 2, red: 1 })).toBe("blue");
    expect(strictMost({ blue: 1, red: 3 })).toBe("red");
    expect(strictMost({ blue: 2, red: 2 })).toBeNull();
    expect(strictMost({})).toBeNull();
    expect(strictMost({ blue: 0 })).toBeNull();
  });
});

describe("conquer mission (type 2): Aguilleon 1", () => {
  it("both gate areas open as the enemy's — red flags on each area's first tile", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    expect(g.captureMode).toBe(2);
    expect(g.captureAreas.length).toBe(2);
    expect(g.captureAreas.map((a) => a.owner)).toEqual(["red", "red"]);
    expect(g.renderer._objectiveRegions().map((r) => [r.flag.tx, r.flag.ty])).toEqual([
      [9, 15],
      [11, 18],
    ]);
    expect(g._captureHolder()).toBe("red");
  });

  it("your majority takes an area for good; the enemy cannot retake it", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    const a = g.captureAreas[0];
    emptyArea(g, a);
    const b = spawn(g, "knights", "blue", 0, 0);
    put(g, b, a.tiles[1].tx, a.tiles[1].ty);
    g.updateObjectives();
    expect(a.owner).toBe("blue");
    expect(g._captureHolder()).toBeNull(); // one area each
    b.dead = true;
    g.units = g.units.filter((u) => !u.dead);
    const r1 = spawn(g, "footmen", "red", 0, 0),
      r2 = spawn(g, "footmen", "red", 0, 1);
    put(g, r1, a.tiles[2].tx, a.tiles[2].ty);
    put(g, r2, a.tiles[3].tx, a.tiles[3].ty);
    g.updateObjectives();
    expect(a.owner).toBe("blue");
  });

  it("the HUD counts the areas you hold", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    g.captureAreas[0].owner = "blue";
    g.captureAreas[1].owner = "blue";
    expect(g._captureHolder()).toBe("blue");
    expect(g.hasMorale("blue")).toBe(true);
  });
});

describe("hold mission (type 1): Twinbridge", () => {
  it("an area is nobody's (white) until taken, follows the majority, and is kept while nobody has one", () => {
    const g = makeGame(5216);
    startBattle(g, "auto");
    expect(g.captureMode).toBe(1);
    const a = g.captureAreas[0];
    emptyArea(g, a);
    a.owner = null;
    g.updateObjectives();
    expect(a.owner).toBeNull();
    const r = spawn(g, "footmen", "red", 0, 0);
    put(g, r, a.tiles[0].tx, a.tiles[0].ty);
    g.updateObjectives();
    expect(a.owner).toBe("red");
    const b = spawn(g, "footmen", "blue", 0, 1);
    put(g, b, a.tiles[1].tx, a.tiles[1].ty);
    g.updateObjectives(); // 1 v 1: no majority — red keeps it
    expect(a.owner).toBe("red");
    r.dead = true;
    g.updateObjectives();
    expect(a.owner).toBe("blue");
  });
});

describe("missions without capture scoring", () => {
  it("a destroy mission (type 0) has no capture areas", () => {
    const g = makeGame(5400);
    expect(g.captureMode).toBe(0);
    expect(g.captureAreas).toEqual([]);
  });
});

describe("Aguilleon 1: the garrisons and the conquest line", () => {
  it("taking a gate area shows the game's line 'Our forces have conquered a vital area!' once", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    const a = g.captureAreas[0];
    emptyArea(g, a);
    const b = spawn(g, "knights", "blue", 0, 0);
    put(g, b, a.tiles[1].tx, a.tiles[1].ty);
    g.notice = null;
    g.updateObjectives();
    expect(g.notice.text).toBe("Our forces have conquered a vital area!");
    g.notice = null;
    g.updateObjectives(); // already ours: no repeat
    expect(g.notice).toBeNull();
  });

  it("an area the player hasn't taken adds +100 on each of its tiles to the player's layer (Map::updatePointConcentration)", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    const [keep1, keep2] = g.captureAreas;
    const W = g.cols;
    const held = g.ai._glConcentration("blue");
    keep2.owner = "blue";
    const taken = g.ai._glConcentration("blue");
    for (const t of keep2.tiles) expect(held[t.ty * W + t.tx] - taken[t.ty * W + t.tx]).toBe(100);
    const t1 = keep1.tiles[0];
    expect(held[t1.ty * W + t1.tx]).toBe(taken[t1.ty * W + t1.tx]); // keep 1 untouched
  });

  it("a unit (HP × its value) weighs on the layer with the original kernel: ×100 on its tile, ×50 / 25 / 12 / 6 outward", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    g.units = [];
    g.areas = [];
    const u = spawn(g, "footmen", "blue", 9, 10);
    const m = g.ai._glConcentration("blue");
    const v = (u.hp * g.ai._aiValue(u)) / 100; // HP × value (Unit+0x198)
    const W = g.cols;
    expect([0, 1, 2, 3, 4, 5].map((d) => +m[10 * W + 9 + d].toFixed(3))).toEqual(
      [100, 50, 25, 12, 6, 0].map((k) => +(v * k).toFixed(3)),
    );
  });

  it("keep 2's gate (10,18): members with it in reach leave the formation and fight alone (Unit::isNearGate, Ep1 too)", () => {
    const g = makeGame(5415);
    startBattle(g, [["footmen", ...[...g.deployZone][0].split(",").map(Number)]]);
    expect(tileType(g.tileAt(10, 18))).toBe(16); // Ep1 reads the gate type from movement.json's table
    const k2 = g.captureAreas[1];
    const garrison = g.units.filter((u) => u.team === "red" && k2.tiles.some((t) => t.tx === u.tx && t.ty === u.ty));
    const onGate = garrison.find((u) => u.tx === 10 && u.ty === 18);
    expect(onGate).toBeTruthy();
    const gi = g.ai._glGroupOf(onGate);
    const members = g.units.filter((u) => !u.dead && u.team === "red" && g.ai._glGroupOf(u) === gi);
    const group = g.ai._glState(gi);
    g.ai._glPace(
      group,
      members,
      g.units.filter((u) => u.team === "blue"),
    );
    expect(group.out.has(onGate.id)).toBe(true);
  });

  it("the record's areas are kept on any map; an unscored area has no owner and always weighs in", () => {
    const g = makeGame(5419); // Hunewold 2: a hold-type record
    expect(g.areas.length).toBeGreaterThan(0);
    const h = makeGame(5400);
    expect(h.areas).toEqual([]);
  });
});
