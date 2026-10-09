// Movement, undo and the things a move can set off: quicksand (Unit::applyQuicksandDamage, Map::updateQuickSandTurn),
// warp portals (Unit::getPortalOutput), Hold. A move that sets something off can't be undone.
import { describe, it, expect, beforeAll } from "vitest";

import {
  loadEpisode,
  makeGame,
  startBattle,
  spawn,
  put,
  moveTo,
  attack,
  openLane,
  nextRound,
  settle,
} from "./battle.js";

beforeAll(() => loadEpisode(2));

// Warning Caladrin: the player's army + Caladrin's allied garrison + portals (3,21)→(16,8), (3,15)→(2,9), (8,19)↔(15,16).
function caladrin() {
  const g = makeGame(5428);
  startBattle(g);
  return g;
}
const mine = (g, type) => g.units.find((u) => !u.dead && u.team === "blue" && !u.ally && (!type || u.type === type));

describe("undo", () => {
  it("a plain move can be undone", () => {
    const g = caladrin();
    const u = mine(g, "swordsmen");
    const from = [u.tx, u.ty];
    g.select(u);
    const to = [...g.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => !g.unitAt(x, y));
    moveTo(g, u, ...to);
    expect(g.canUndo()).toBe(true);
    g.undoMove();
    expect([u.tx, u.ty]).toEqual(from);
  });

  it("a portal jump commits the move", () => {
    const g = caladrin();
    const u = mine(g, "swordsmen");
    put(g, u, 3, 20);
    moveTo(g, u, 3, 21);
    expect(Math.abs(u.tx - 16) + Math.abs(u.ty - 8)).toBe(1); // out beside the exit pad (16,8)
    expect(g.canUndo()).toBe(false);
  });

  it("stepping into quicksand commits the move", () => {
    const g = caladrin();
    const u = mine(g, "swordsmen");
    g.select(u);
    const k = [...g.reach.stops].find((s) => s !== u.tx + "," + u.ty && !g.unitAt(...s.split(",").map(Number)));
    g.quicksand.set(k, 3);
    moveTo(g, u, ...k.split(",").map(Number));
    expect(g.canUndo()).toBe(false);
  });

  it("an attack commits the move", () => {
    const g = makeGame(5410);
    startBattle(g, [
      ["cavalry", 2, 11],
      ["militiamen", 3, 11],
    ]);
    const r = mine(g, "cavalry");
    const lane = openLane(g, r, 4);
    const foe = g.units.find((e) => e.team === "red");
    put(g, r, lane.x, lane.y);
    put(g, foe, lane.x + 2, lane.y);
    moveTo(g, r, lane.x + 1, lane.y);
    attack(g, r, foe);
    expect(g.canUndo()).toBe(false);
  });
});

describe("quicksand", () => {
  it("walking in stops the unit there and costs 12 of 256 HP; the cast itself deals no damage", () => {
    const g = caladrin();
    const u = mine(g, "swordsmen");
    u.hp = 100;
    g.select(u);
    const stops = [...g.reach.stops].map((s) => s.split(",").map(Number)).filter(([x, y]) => !g.unitAt(x, y));
    const [x, y] = stops[stops.length - 1];
    g.quicksand.set(x + "," + y, 4);
    moveTo(g, u, x, y);
    expect(u.hp).toBe(95); // 12 of 256 = 5 whole HP
  });

  it("a quicksand tile lasts 4 rounds (one tick per round)", () => {
    const g = caladrin();
    g.units = g.units.filter((x) => x.type !== "dunesirens"); // no enemy Siren laying fresh quicksand meanwhile
    const u = mine(g, "swordsmen");
    g.quicksand.set(u.tx + "," + u.ty, 4);
    const seen = [];
    for (let r = 0; r < 4; r++) {
      seen.push(g._quicksandAt(u.tx, u.ty));
      nextRound(g);
    }
    expect(seen).toEqual([4, 3, 2, 1]);
    expect(g._quicksandAt(u.tx, u.ty)).toBe(0);
  });

  it("the round tick only counts down — a unit standing in quicksand takes no damage from it", () => {
    const g = caladrin();
    const u = mine(g, "swordsmen");
    u.hp = 100;
    g.quicksand.set(u.tx + "," + u.ty, 2);
    g._quicksandTurn();
    expect(g._quicksandAt(u.tx, u.ty)).toBe(1);
    g._quicksandTurn();
    expect(g._quicksandAt(u.tx, u.ty)).toBe(0);
    expect(u.hp).toBe(100);
  });

  it("fliers and Dune Sirens are immune", () => {
    const g = caladrin();
    expect(g._quicksandImmune(spawn(g, "griffon", "blue", 1, 1))).toBe(true);
    expect(g._quicksandImmune(spawn(g, "dunesirens", "blue", 1, 2))).toBe(true);
    expect(g._quicksandImmune(mine(g, "swordsmen"))).toBe(false);
  });
});

describe("warp portals", () => {
  it("ending a move on a portal pad warps the unit out beside the exit pad", () => {
    const g = caladrin();
    const u = mine(g, "swordsmen");
    put(g, u, 2, 15);
    moveTo(g, u, 3, 15);
    expect(Math.abs(u.tx - 2) + Math.abs(u.ty - 9)).toBe(1);
  });
});

describe("Hold", () => {
  it("ends only the selected unit's turn, where it stands", () => {
    const g = caladrin();
    const a = mine(g, "swordsmen"),
      b = g.units.find((u) => u !== a && u.team === "blue" && !u.ally);
    const at = [a.tx, a.ty];
    g.select(a);
    expect(g.canHold()).toBe(true);
    g.holdUnit();
    settle(g);
    expect(a.acted).toBe(true);
    expect(b.acted).toBe(false);
    expect([a.tx, a.ty]).toEqual(at);
  });
});
