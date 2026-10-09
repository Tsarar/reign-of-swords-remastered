// The battle's dice (engine.js / util makeRng): only game rules draw from them — never the look-only effects — and
// real play gets a fresh seed for every battle and retry, while the tests and the headless Battle Lab stay fixed.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle } from "./battle.js";

beforeAll(() => loadEpisode(1));

describe("the dice", () => {
  it("bursts, smoke, a bolt's zigzag, a shot's spin and a new unit's idle bob draw nothing from them", () => {
    const g = makeGame(5204);
    startBattle(g, "auto");
    const before = g.rng.state();
    g._burst(100, 100, { big: true, count: 30 });
    g._spawnBolt(120, 140);
    g._makeUnit("militiamen", "blue", 0, 0, false);
    const archer = g.units.find((u) => !u.dead && u.T.projectile);
    const foe = g.units.find((u) => !u.dead && u.team !== (archer && archer.team));
    if (archer && foe) g.fireProjectile(archer, foe);
    expect(g.rng.state()).toBe(before);
  });

  it("real play rolls a fresh seed each battle and retry; the tests keep the fixed one", () => {
    const g = makeGame(5204);
    expect(g.seed).toBe(0x51a7);
    g.reset();
    expect(g.seed).toBe(0x51a7);
    g.freshSeeds = true; // what mountReign sets
    const seeds = new Set();
    for (let i = 0; i < 5; i++) {
      g.reset();
      seeds.add(g.seed);
      expect(g.rng.state()).toBe(g.seed >>> 0);
    }
    expect(seeds.size).toBe(5);
    expect(g.debugDump().seed).toBe(g.seed);
  });

  it("the 🐞 snapshot carries the battle's seed and every roll of it, as the console prints them", () => {
    const g = makeGame(5204);
    startBattle(g, "auto");
    g._roll("Deviation — trebuchet (3,4) → archers (10,3): rolled 2.2, deviates below 15 → DEVIATED", { what: "test" });
    g._roll("Courage — rolled 40.0, needs below 65 → HOLDS", { what: "test" });
    const dump = g.debugDump();
    expect(dump.seed).toBe(g.seed);
    expect(dump.rolls).toEqual([
      "T1 Deviation — trebuchet (3,4) → archers (10,3): rolled 2.2, deviates below 15 → DEVIATED",
      "T1 Courage — rolled 40.0, needs below 65 → HOLDS",
    ]);
    g.reset(); // a new battle: a clean record
    expect(g.debugDump().rolls).toEqual([]);
  });
});
