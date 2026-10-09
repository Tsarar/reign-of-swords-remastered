// Hit marks, shots and ability effects matched to the original's state machine (audit of 2026-10-06):
// Unit::changeState's weapon switch (iOS Ep2 @0x6b84c), Unit::renderOverlay / renderDamage, Unit::startAreaAttack.
import { describe, it, expect, beforeAll, vi } from "vitest";

import { loadEpisode, makeGame, startBattle, spawn, only, attack } from "./battle.js";
import { UNIT_TYPES } from "../data/game-data.js";

beforeAll(() => loadEpisode(2));

function field() {
  const g = makeGame(5410);
  startBattle(g);
  return g;
}
const MARKS = new Set(["slash", "impact", "holysword"]);
const fxNames = (spy, keep = MARKS) => spy.mock.calls.map((c) => c[0]).filter((n) => keep.has(n));

// the mark one direct blow of `type` leaves on a footman beside it
function markOf(type, extra = {}) {
  const g = field();
  const a = spawn(g, type, "blue", 4, 4, extra);
  const d = spawn(g, "footmen", "red", 5, 4);
  only(g, a, d);
  const spy = vi.spyOn(g, "spawnFx");
  g.resolveDamage(a, d, {});
  return fxNames(spy);
}

describe("the mark of a melee blow", () => {
  it("a sword slashes, a spear / pike / druid lance draws blood, a bite or a mallet leaves nothing", () => {
    expect(markOf("swordsmen")).toEqual(["slash"]);
    expect(markOf("militiamen")).toEqual(["impact"]); // Spear 3
    expect(markOf("pikemen")).toEqual(["impact"]); // Pike 12
    expect(markOf("druids")).toEqual(["impact"]); // Druid Lance 14
    expect(markOf("knights")).toEqual(["slash"]); // Lance 15
    expect(markOf("bloodgorgers")).toEqual([]); // Bite 32
    expect(markOf("craftsmen")).toEqual([]); // Mallet 30
  });

  it("a Priest's staff slashes like any blade — the sword of light is only Retribution's smite", () => {
    expect(markOf("priests")).toEqual(["slash"]);
  });

  it("a played-out attack marks each blow once (the strike and the counter)", () => {
    const g = field();
    const a = spawn(g, "swordsmen", "blue", 4, 4, { acted: false });
    const d = spawn(g, "militiamen", "red", 5, 4);
    only(g, a, d);
    const spy = vi.spyOn(g, "spawnFx");
    attack(g, a, d);
    expect(fxNames(spy)).toEqual(d.dead ? ["slash"] : ["slash", "impact"]);
  });

  it("the blade and bite clips: 47 for the Bite, 49 for the Mallet", () => {
    const g = field();
    expect(g._meleeSfx(32)).toBe("melee_bite");
    expect(g._meleeSfx(30)).toBe("melee_mallet");
    expect(["melee_pole1", "melee_pole2", "melee_pole3"]).toContain(g._meleeSfx(12));
    expect(["melee_blade1", "melee_blade2"]).toContain(g._meleeSfx(5));
  });
});

describe("shots", () => {
  it("a Fire Arrows archer looses the flaming arrow only at a flammable target", () => {
    const g = field();
    const a = spawn(g, "archers", "blue", 2, 4);
    const foot = spawn(g, "footmen", "red", 6, 4);
    const cat = spawn(g, "catapult", "red", 6, 6);
    only(g, a, foot, cat);
    g.fireProjectile(a, foot);
    expect(g.projectiles.at(-1).fire).toBe(false);
    g.fireProjectile(a, cat);
    expect(g.projectiles.at(-1).fire).toBe(true);
    g.fireProjectile(a, { px: 6 * g.tile, py: 2 * g.tile, tx: 6, ty: 2 }); // a building or the ground
    expect(g.projectiles.at(-1).fire).toBe(true);
  });

  it("the Trebuchet's boulder is the grey stone; the Catapult's rocks land in the earth burst", () => {
    expect(UNIT_TYPES.trebuchet.projectile).toBe("stone");
    const g = field();
    const cat = spawn(g, "catapult", "blue", 2, 4);
    const treb = spawn(g, "trebuchet", "blue", 2, 8);
    const t1 = spawn(g, "footmen", "red", 7, 4);
    const t2 = spawn(g, "footmen", "red", 8, 8);
    only(g, cat, treb, t1, t2);
    const keep = new Set(["dust", "rockblast", "blast", "fire"]);
    let spy = vi.spyOn(g, "spawnFx");
    g.fireProjectile(cat, t1);
    expect(fxNames(spy, keep).every((n) => n === "dust")).toBe(true);
    spy.mockClear();
    g.fireProjectile(treb, t2);
    expect(fxNames(spy, keep)).toEqual(["rockblast"]);
    expect(g._impactSound(treb, "stone", true, false)).toBe("boulder_hit"); // sound 32
    expect(g._impactSound(cat, "stone", true, false)).toBe("rock_hit"); // sound 25
  });

  it("the Cannonball bursts in fire; a musket ball lands without a clip", () => {
    const g = field();
    const can = spawn(g, "cannon", "blue", 2, 4);
    const mus = spawn(g, "musketeers", "blue", 2, 8);
    const t = spawn(g, "footmen", "red", 7, 4);
    only(g, can, mus, t);
    const spy = vi.spyOn(g, "spawnFx");
    g.fireProjectile(can, t);
    expect(fxNames(spy, new Set(["blast", "fire"]))).toEqual(["fire"]);
    expect(g._impactSound(mus, "bullet", false, false)).toBeNull();
  });
});

describe("abilities", () => {
  it("a heal sparkles on the healed unit only", () => {
    const g = field();
    const p = spawn(g, "priests", "blue", 4, 4);
    const ally = spawn(g, "footmen", "blue", 5, 4, { hp: 40 });
    only(g, p, ally);
    const spy = vi.spyOn(g, "spawnFx");
    g._landHeal({ u: p, target: ally });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["spark"]);
    expect(spy.mock.calls[0][1]).toBe(ally.px + g.tile / 2);
  });

  it("a wounded Blood Gorger sparkles as its bite drains", () => {
    const g = field();
    const bg = spawn(g, "bloodgorgers", "blue", 4, 4, { hp: 50 });
    const d = spawn(g, "footmen", "red", 5, 4);
    only(g, bg, d);
    const spy = vi.spyOn(g, "spawnFx");
    g.resolveDamage(bg, d, {});
    expect(bg.hp).toBeGreaterThan(50);
    expect(spy.mock.calls.map((c) => c[0])).toContain("spark");
  });

  it("a unit stepping into quicksand shows the slash over itself", () => {
    const g = field();
    const u = spawn(g, "footmen", "blue", 4, 4);
    only(g, u);
    g.quicksand = new Map([["4,4", 3]]);
    vi.spyOn(g, "_quicksandImmune").mockReturnValue(false);
    const spy = vi.spyOn(g, "spawnFx");
    g._quicksandEnter(u);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["slash"]);
  });

  it("an area blow that brings a structure down raises the dust ring there, once", () => {
    const g = field();
    const w = spawn(g, "wizards", "blue", 2, 4);
    only(g, w);
    vi.spyOn(g, "structureHit").mockImplementation((u, tx, ty) => {
      g.razed.add(tx + "," + ty);
      return true;
    });
    const spy = vi.spyOn(g, "spawnFx");
    g._areaStructureHit(w, 6, 4, 1, 26, 0.7);
    expect(spy.mock.calls).toEqual([["sand_puff", 6 * g.tile + g.tile / 2, 4 * g.tile + g.tile * 0.5, { delay: 0.7 }]]);
    spy.mockClear();
    g._areaStructureHit(w, 6, 4, 1, 26); // already rubble
    expect(spy).not.toHaveBeenCalled();
  });
});
