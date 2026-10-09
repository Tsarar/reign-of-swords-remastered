// Flyers over enemy lines (Episode II's Map::getMoveCost @0x3ba3a; Episode I's checkLocation stops them) and the AI's
// unit order (Mission::getRemainingAttackers, Ep2 @0x5e508 / Ep1 @0x50a68).
import { describe, it, expect, beforeAll } from "vitest";

import { loadEpisode, makeGame, startBattle, spawn, only } from "./battle.js";

beforeAll(() => loadEpisode(1));

function field() {
  const g = makeGame(5412);
  startBattle(g);
  return g;
}
// a wall of foes across the board at column 6, rows 0..rows-1
function wall(g, x) {
  const foes = [];
  for (let y = 0; y < g.rows; y++) if (!g.unitAt(x, y)) foes.push(spawn(g, "footmen", "red", x, y));
  return foes;
}

// Episode II's rules on this board: the flyer exception reads the mission's episode
const asEp2 = (g) => {
  g.mission = { ...g.mission, ep: 2 };
  return g;
};

describe("flyers pass over enemy units (Episode II)", () => {
  it("a Griffon flies over an enemy line (but can't stop on it); a foot unit can't get through", () => {
    const g = asEp2(field());
    const gr = spawn(g, "griffon", "blue", 4, 5);
    const sw = spawn(g, "swordsmen", "blue", 4, 7);
    const foes = wall(g, 6);
    only(g, gr, sw, ...foes);
    const flyer = g.computeReach(gr);
    expect(flyer.stops.has("8,5")).toBe(true); // beyond the line
    expect(flyer.stops.has("6,5")).toBe(false); // never on a foe
    const walker = g.computeReach(sw);
    expect([...walker.stops].some((k) => Number(k.split(",")[0]) > 6)).toBe(false);
  });

  it("Great Eagles and Dune Sirens pass over too", () => {
    const g = asEp2(field());
    const eagle = spawn(g, "greateagle", "blue", 4, 5);
    const siren = spawn(g, "dunesirens", "blue", 4, 8);
    const foes = wall(g, 6);
    only(g, eagle, siren, ...foes);
    expect([...g.computeReach(eagle).stops].some((k) => Number(k.split(",")[0]) > 6)).toBe(true);
    expect(g._passesOverFoes(siren)).toBe(true);
  });
});

describe("Episode I flyers go round enemy units (Unit::checkLocation @0x58920)", () => {
  it("a Griffon or Great Eagle cannot cross an enemy line in Episode I", () => {
    const g = field();
    expect(g.mission.ep).toBe(1);
    const gr = spawn(g, "griffon", "blue", 4, 5);
    const eagle = spawn(g, "greateagle", "blue", 4, 8);
    const foes = wall(g, 6);
    only(g, gr, eagle, ...foes);
    expect(g._passesOverFoes(gr)).toBe(false);
    for (const u of [gr, eagle])
      expect([...g.computeReach(u).stops].some((k) => Number(k.split(",")[0]) > 6)).toBe(false);
  });
});

describe("the AI's unit order (getRemainingAttackers)", () => {
  it("war engines, then shooters, then the rest — Griffons last, Priests never as attackers", () => {
    const g = field();
    const target = spawn(g, "footmen", "blue", 8, 5);
    const mk = (type, x, y) => spawn(g, type, "red", x, y);
    const gr = mk("griffon", 9, 4);
    const sw = mk("swordsmen", 9, 5);
    const ar = mk("archers", 11, 5);
    const cat = mk("catapult", 13, 5);
    const pr = mk("priests", 8, 4);
    only(g, target, gr, sw, ar, cat, pr);
    const pick = (pool) => g.ai._aiRemainingAttacker(pool);
    expect(pick([gr, sw, ar, cat, pr])).toBe(cat);
    expect(pick([gr, sw, ar, pr])).toBe(ar);
    expect(pick([gr, sw, pr])).toBe(sw);
    expect(pick([gr, pr])).toBe(gr);
    expect(pick([pr])).toBe(null);
  });
});
