// Combat rules: damage numbers, war-engine deviation, first strike — pinned to the values decoded from the original
// (unit table 5010, Unit::getDeviationChance, Unit::isFirstStrike) and checked in play.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put } from "./battle.js";
import { shownDamage } from "../util/util.js";

beforeAll(() => loadEpisode(2));

// A tile of the current map whose cover (defBonus) is `def` and that a foot soldier can stand on.
function tileWithCover(g, def, probe) {
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++)
      if (Math.abs((g.terrainAt(x, y).defBonus || 0) - def) < 1e-6 && !g.unitAt(x, y) && g.moveCost(probe, x, y) < 99)
        return [x, y];
  return null;
}

describe("damage", () => {
  it("Horse Bowmen hit a militiaman for 22 in the open and 18 in a forest (20% cover) — in whole HP", () => {
    const g = makeGame(5428);
    startBattle(g);
    const hb = spawn(g, "horsebowmen", "blue", 0, 0);
    const m = spawn(g, "militiamen", "red", 0, 1);
    only(g, hb, m);
    const open = tileWithCover(g, 0, m),
      forest = tileWithCover(g, 0.2, m);
    put(g, m, ...open);
    expect(shownDamage(m.hp, g.computeDamage(hb, m))).toBe(22);
    put(g, m, ...forest);
    expect(shownDamage(m.hp, g.computeDamage(hb, m))).toBe(18);
  });

  it("the preview forecast matches the damage dealt", () => {
    const g = makeGame(5428);
    startBattle(g);
    const hb = spawn(g, "horsebowmen", "blue", 0, 0);
    const m = spawn(g, "militiamen", "red", 0, 1);
    only(g, hb, m);
    put(g, m, ...tileWithCover(g, 0, m));
    expect(g.hitForecast(hb, m, m.tx, m.ty, {})).toBe(g.computeDamage(hb, m));
  });

  it("a charge adds to the blow (Knights vs militiaman: a kill charging, 76 plain)", () => {
    const g = makeGame(5412);
    startBattle(g);
    const k = g.units.find((u) => u.id === 25),
      m = g.units.find((u) => u.id === 9);
    put(g, m, 9, 3);
    m.hp = 100;
    k.hp = 88;
    expect(g.computeDamage(k, m, { charge: true })).toBeGreaterThanOrEqual(m.hp);
    expect(shownDamage(m.hp, g.computeDamage(k, m, {}))).toBe(76);
  });
});

describe("war-engine deviation (Unit::getDeviationChance)", () => {
  const cases = [
    // [attacker, target type, cover of the target tile, expected %]
    ["trebuchet", "pikemen", 0, 45],
    ["trebuchet", "pikemen", 0.2, 15],
    ["trebuchet", "cavalry", 0, 65],
    ["trebuchet", "griffon", 0, 100],
    ["trebuchet", "cannon", 0, 25],
    ["cannon", "pikemen", 0, 35],
    ["cannon", "pikemen", 0.2, 10],
    ["cannon", "cavalry", 0, 50],
    ["cannon", "cannon", 0, 20],
  ];
  for (const [atkType, tgtType, cover, pct] of cases)
    it(`${atkType} → ${tgtType} on ${cover * 100}% cover: ${pct}%`, () => {
      const g = makeGame(5428);
      startBattle(g);
      const a = spawn(g, atkType, "blue", 0, 0);
      const t = spawn(g, tgtType, "red", 0, 1);
      only(g, a, t);
      const tile = tileWithCover(g, cover, spawn(g, "militiamen", "red", 0, 2));
      only(g, a, t);
      put(g, t, ...tile);
      // stand 6 tiles away in a straight line on the map so the long-range weapon is the one used
      const ax = tile[0] + 6 < g.cols ? tile[0] + 6 : tile[0] - 6;
      put(g, a, ax, tile[1]);
      expect(g._deviationPct(a, t)).toBe(pct);
    });

  it("the Ballistae never deviates", () => {
    const g = makeGame(5428);
    startBattle(g);
    const a = spawn(g, "ballistae", "blue", 0, 0);
    const t = spawn(g, "pikemen", "red", 6, 0);
    expect(g._deviationPct(a, t)).toBe(0);
  });
});

describe("braced Pike Wall", () => {
  it("in Episode II a braced wall strikes a charging mount first but WITHOUT the Episode I +30", () => {
    const g = makeGame(5428);
    startBattle(g);
    expect(g.mission.ep).toBe(2);
    const p = spawn(g, "pikemen", "red", 0, 0, { walled: true });
    const cav = spawn(g, "cavalry", "blue", 1, 0);
    const fs = g._firstStrikeOf(cav, p);
    expect(fs.label).toBe("Pike Wall!");
    expect(fs.brace).toBe(false);
  });
});

describe("first strike", () => {
  it("Pikemen strike a mounted attacker first, but not the Hero", () => {
    const g = makeGame(5428);
    startBattle(g);
    const p = spawn(g, "pikemen", "red", 0, 0);
    const cav = spawn(g, "cavalry", "blue", 1, 0);
    const hero = spawn(g, "king", "blue", 0, 1);
    expect(g._firstStrikeOf(cav, p)).not.toBeNull();
    expect(g._firstStrikeOf(hero, p)).toBeNull();
  });
});

describe("grapeshot (Unit::setGrapeShot)", () => {
  it("rakes a 3-wide row right next to the cannon, then the tile beyond — in all 4 directions", () => {
    const g = makeGame(5428);
    startBattle(g);
    const c = spawn(g, "cannon", "blue", 5, 5);
    const rel = (tx, ty) =>
      g
        ._grapeshotCone(c, tx, ty)
        .map((p) => [p.tx - c.tx, p.ty - c.ty])
        .sort();
    const sorted = (a) => a.slice().sort();
    expect(rel(5, 4)).toEqual(
      sorted([
        [1, -1],
        [0, -1],
        [-1, -1],
        [0, -2],
      ]),
    ); // up
    expect(rel(5, 6)).toEqual(
      sorted([
        [1, 1],
        [0, 1],
        [-1, 1],
        [0, 2],
      ]),
    ); // down
    expect(rel(6, 5)).toEqual(
      sorted([
        [1, 1],
        [1, 0],
        [1, -1],
        [2, 0],
      ]),
    ); // right
    expect(rel(4, 5)).toEqual(
      sorted([
        [-1, 1],
        [-1, 0],
        [-1, -1],
        [-2, 0],
      ]),
    ); // left
  });

  it("every unit in the T takes the full blow, friend or foe", () => {
    const g = makeGame(5428);
    startBattle(g);
    const c = spawn(g, "cannon", "blue", 5, 5);
    const a = spawn(g, "militiamen", "red", 5, 4),
      flank = spawn(g, "militiamen", "blue", 4, 4),
      beyond = spawn(g, "militiamen", "red", 5, 3),
      out = spawn(g, "militiamen", "red", 4, 3);
    only(g, c, a, flank, beyond, out);
    const hp = [flank, beyond, out].map((u) => u.hp);
    g.resolveDamage(c, a, {});
    expect(flank.hp).toBeLessThan(hp[0]);
    expect(beyond.hp).toBeLessThan(hp[1]);
    expect(out.hp).toBe(hp[2]);
  });
});
