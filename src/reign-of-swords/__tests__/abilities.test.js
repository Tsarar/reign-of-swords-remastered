// Episode II abilities and special rules: Build (once per battle; a new village starts whole — deliberate deviation),
// Quicksand cast (lays tiles, no damage), Horse Bowmen firing while riding, the Fear courage roll.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put, settle, openLane, moveTo } from "./battle.js";

beforeAll(() => loadEpisode(2));

const ADJ = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

describe("Build (Craftsmen)", () => {
  it("raises a village on an adjacent tile once per battle; the new village starts at full health", () => {
    const g = makeGame(5428);
    startBattle(g);
    const c = g.units.find((u) => u.team === "blue" && !u.ally && u.type === "craftsmen");
    // stand the Craftsman next to open ground it can build on
    let spot = null;
    for (let y = 1; y < g.rows - 1 && !spot; y++)
      for (let x = 1; x < g.cols - 1 && !spot; x++) {
        if ((g.unitAt(x, y) && g.unitAt(x, y) !== c) || g.moveCost(c, x, y) >= 99) continue;
        const n = ADJ.map(([dx, dy]) => [x + dx, y + dy]).find(
          ([bx, by]) => !g.unitAt(bx, by) && g._buildableTile(bx, by),
        );
        if (n) {
          put(g, c, x, y);
          spot = n;
        }
      }
    expect(spot).toBeTruthy();
    g.structHp.set(spot.join(","), -40); // ground worn down by earlier fighting
    g.select(c);
    expect(g._abilityArm("build")).toBe(true);
    g.click({ tx: spot[0], ty: spot[1] });
    settle(g);
    expect(c._built).toBe(true);
    expect(g.terrainAt(...spot).heal).toBeGreaterThan(0); // it is a village now
    expect(g.structHp.has(spot.join(","))).toBe(false); // whole (256)
    c.acted = false;
    g.select(c);
    const build = g._abilitySkills(c).find((s) => s.id === "build");
    expect(build.disabled).toBe(true);
    expect(build.count).toBe("0/1");
    expect(g._abilityArm("build")).toBe(false);
  });
});

describe("Quicksand (Dune Sirens)", () => {
  it("the cast turns the sand on one side to quicksand for 4 rounds and hurts nobody standing there", () => {
    const g = makeGame(5428);
    startBattle(g);
    const siren = spawn(g, "dunesirens", "blue", 0, 0);
    // find a spot whose neighbouring line holds layable sand, with a foe on it
    let found = null;
    for (let y = 1; y < g.rows - 1 && !found; y++)
      for (let x = 1; x < g.cols - 1 && !found; x++) {
        if (g.unitAt(x, y) && g.unitAt(x, y) !== siren) continue;
        if (g.moveCost(siren, x, y) >= 99) continue;
        const cells = [
          [x + 1, y - 1],
          [x + 1, y],
          [x + 1, y + 1],
        ];
        if (cells.every(([cx, cy]) => g._canLayQuicksand(cx, cy) && !g.unitAt(cx, cy))) found = { x, y, cells };
      }
    expect(found).toBeTruthy();
    put(g, siren, found.x, found.y);
    const foe = spawn(g, "footmen", "red", ...found.cells[1], { hp: 100 });
    siren.acted = false;
    g.select(siren);
    expect(g._abilityArm("quicksand")).toBe(true);
    g.click({ tx: found.x + 1, ty: found.y });
    settle(g);
    for (const [cx, cy] of found.cells) expect(g._quicksandAt(cx, cy)).toBe(4);
    expect(foe.hp).toBe(100);
  });
});

describe("Horse Bowmen", () => {
  it("fire while riding, and the ride counts as their attack", () => {
    const g = makeGame(5410);
    startBattle(g, [["cavalry", 2, 11]]);
    const hb = spawn(g, "horsebowmen", "blue", 0, 0);
    const lane = openLane(g, hb, 6);
    put(g, hb, lane.x, lane.y);
    // a foe 3 tiles beside the middle of the ride (bow range 2–5)
    const fy = lane.y + 3 < g.rows ? lane.y + 3 : lane.y - 3;
    const foe = spawn(g, "militiamen", "red", lane.x + 3, fy, { hp: 100 });
    for (const u of g.units) if (u !== hb && u !== foe && u.team === "red") u.dead = true;
    moveTo(g, hb, lane.x + 6, lane.y);
    expect(foe.hp).toBeLessThan(100);
    expect(hb.attackedTurn).toBe(true);
  });
});

describe("Fear (courage check)", () => {
  it("courage 100 never balks; courage 60 passes about 60% of the time (roll 0–255 vs 153)", () => {
    const g = makeGame(5428);
    startBattle(g);
    const a = spawn(g, "swordsmen", "blue", 0, 0);
    const d = spawn(g, "footmen", "red", 0, 1);
    d.T = { ...d.T, fear: true };
    only(g, a, d);
    const C = g._courage.bind(g);
    g._courage = () => 100;
    for (let i = 0; i < 50; i++) expect(g._fearCheck(a, d, () => {})).toBe(false);
    g._courage = () => 60;
    let balks = 0;
    for (let i = 0; i < 2000; i++) {
      g.anim = null;
      if (g._fearCheck(a, d, () => {})) balks++;
    }
    g._courage = C;
    expect(balks / 2000).toBeCloseTo(1 - 154 / 256, 1);
  });

  it("a balk plays the screaming skull (battle strip 5017 #2) over the unit that lost its nerve", () => {
    const g = makeGame(5428);
    startBattle(g);
    const a = spawn(g, "swordsmen", "blue", 3, 3);
    const d = spawn(g, "footmen", "red", 3, 4);
    d.T = { ...d.T, fear: true };
    g._courage = () => -1; // always fails
    const fx = vi.spyOn(g, "spawnFx");
    expect(g._fearCheck(a, d, () => {})).toBe(true);
    const call = fx.mock.calls.find(([n]) => n === "skull");
    expect(call).toBeTruthy();
    expect(call[1]).toBe(a.px + g.tile / 2); // over the attacker, not the Fear unit
    expect(g.anim.type).toBe("balk");
  });
});
