// CHARGE (Unit::createChargeTargetList @0x70ec0): a straight gallop of 2+ tiles, the foe next in the lane; the whole
// lane — run-up and the foe's tile, a diagonal step counted twice — must fit the rider's movement. A charge that cuts
// down a foot soldier rides on (across empty tiles) to the next foe in the lane while movement lasts.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put, moveTo, attack, openLane, nextRound } from "./battle.js";

beforeAll(() => loadEpisode(2));

// A cavalryman at the start of an open lane, with `foes` placed at the given lane offsets.
function laneSetup(len, foeOffsets, { map = 5410, rider = "cavalry" } = {}) {
  const g = makeGame(map);
  startBattle(g, [[rider, 2, 11]]);
  const r = g.units.find((u) => u.team === "blue" && u.type === rider);
  only(g, r);
  const lane = openLane(g, r, len);
  if (!lane) throw new Error("no open lane");
  put(g, r, lane.x, lane.y);
  r.acted = false;
  r.attackedTurn = false;
  r.hp = 100;
  const foes = foeOffsets.map((dx) => spawn(g, "militiamen", "red", lane.x + dx, lane.y, { hp: 100 }));
  // a distant enemy keeps the battle going (no instant victory when the lane's foes fall)
  const farY = lane.y > g.rows / 2 ? 0 : g.rows - 1;
  for (let x = 0; x < g.cols; x++)
    if (!g.unitAt(x, farY) && g.moveCost(r, x, farY) < 99) {
      spawn(g, "militiamen", "red", x, farY);
      break;
    }
  // …and an idle unit of ours keeps the turn open (it would end by itself once every unit has acted)
  for (let x = g.cols - 1; x >= 0; x--)
    if (!g.unitAt(x, farY) && g.moveCost(r, x, farY) < 99) {
      spawn(g, "militiamen", "blue", x, farY);
      break;
    }
  return { g, r, lane, foes };
}

describe("the movement rule (The Ambush, column x = 9)", () => {
  // entering (9,7)…(9,3) costs 1, 1, 3, 3, 2 for a mount on that map
  function ambush() {
    const g = makeGame(5412);
    startBattle(g);
    const knight = g.units.find((u) => u.id === 24),
      hero = g.units.find((u) => u.id === 26),
      m = g.units.find((u) => u.id === 9);
    only(g, knight, hero, m);
    put(g, m, 9, 3);
    put(g, knight, 9, 6);
    put(g, hero, 9, 7);
    return { g, knight, hero, m };
  }
  it("Knights from (9,6): 3 + 3 to gallop, +2 for the foe's tile = 8 of 8 → a charge", () => {
    const { g, knight, m } = ambush();
    expect(g._chargeReaches(knight, 9, 4, m)).toBe(true);
  });
  it("Hero from (9,7): 1 + 3 + 3 + 2 = 9 of 8 → no charge", () => {
    const { g, hero, m } = ambush();
    expect(g._chargeReaches(hero, 9, 4, m)).toBe(false);
  });
  it("after a run-up that used up the movement the banner says 'short', and the strike is no charge", () => {
    const { g, hero, m } = ambush();
    only(g, hero, m);
    moveTo(g, hero, 9, 4);
    expect(hero.chargeDir).toEqual({ dx: 0, dy: -1 });
    expect(g._chargeState(hero)).toBe("short");
    expect(g._wouldCharge(hero, m)).toBe(false);
  });
});

describe("no charge out of quicksand (Episode II createChargeTargetList @0x70bd2)", () => {
  it("a rider standing in quicksand lists no charge and its gallop out builds none; dry ground charges", () => {
    const { g, r, lane, foes } = laneSetup(4, [3]);
    expect(g._chargeReaches(r, lane.x + 2, lane.y, foes[0])).toBe(true);
    g.quicksand.set(lane.x + "," + lane.y, 3); // the countdown runs on the rider's own tile
    expect(g._chargeReaches(r, lane.x + 2, lane.y, foes[0])).toBe(false);
    const path = [0, 1, 2].map((dx) => ({ tx: lane.x + dx, ty: lane.y }));
    g._judgeChargeRun(r, path);
    expect(r.chargeDir).toBeNull();
    g.quicksand.delete(lane.x + "," + lane.y);
    g._judgeChargeRun(r, path);
    expect(r.chargeDir).toEqual({ dx: 1, dy: 0 });
  });
});

describe("gallop length", () => {
  it("a 1-tile move is no charge", () => {
    const { g, r, lane, foes } = laneSetup(5, [2]);
    moveTo(g, r, lane.x + 1, lane.y);
    expect(g._wouldCharge(r, foes[0])).toBe(false);
  });
  it("a 2-tile straight gallop then the foe ahead is a charge (the minimum)", () => {
    const { g, r, lane, foes } = laneSetup(5, [3]);
    moveTo(g, r, lane.x + 2, lane.y);
    expect(g._chargeState(r)).toBe("ready");
    expect(g._wouldCharge(r, foes[0])).toBe(true);
  });
});

describe("ride-on (_chargeRun)", () => {
  it("cuts down a foot soldier, crosses an empty tile, strikes the next and stops in front of it", () => {
    const { g, r, lane, foes } = laneSetup(6, [3, 5]);
    const [m1, m3] = foes;
    m1.hp = 5;
    moveTo(g, r, lane.x + 2, lane.y);
    attack(g, r, m1);
    expect(m1.dead).toBe(true);
    expect(m3.hp).toBeLessThan(100);
    expect([r.tx, r.ty]).toEqual([lane.x + 4, lane.y]);
  });
  it("tapping the foe from afar gallops, charges and rides on in one action", () => {
    const { g, r, lane, foes } = laneSetup(7, [4, 6]);
    const [m1, m3] = foes;
    m1.hp = 5;
    attack(g, r, m1);
    expect(m1.dead).toBe(true);
    expect(m3.hp).toBeLessThan(100);
    expect([r.tx, r.ty]).toEqual([lane.x + 5, lane.y]);
  });
  it("a foe beyond the rider's movement is not reached; the rider stops on the soldier it cut down", () => {
    const { g, r, lane, foes } = laneSetup(10, [7, 9]);
    const [m1, m3] = foes;
    m1.hp = 5;
    moveTo(g, r, lane.x + 6, lane.y);
    attack(g, r, m1);
    expect(m1.dead).toBe(true);
    expect(m3.hp).toBe(100);
    expect([r.tx, r.ty]).toEqual([lane.x + 7, lane.y]);
  });
  it("the ride-on blow is an ordinary one (the +30 is spent on the first hit)", () => {
    const { g, r, lane, foes } = laneSetup(6, [3, 4]);
    const [m1, m2] = foes;
    m1.hp = 5;
    moveTo(g, r, lane.x + 2, lane.y);
    put(g, r, lane.x + 2, lane.y);
    const plain = g.computeDamage(
      Object.assign(Object.create(Object.getPrototypeOf(r)), r, { tx: m1.tx, ty: m1.ty }),
      m2,
      {},
    );
    attack(g, r, m1);
    expect(100 - m2.hp).toBe(plain);
  });
});

describe("a charge is one action", () => {
  it("the charge direction does not carry into the next turn", () => {
    const { g, r, lane } = laneSetup(5, []);
    moveTo(g, r, lane.x + 2, lane.y);
    expect(r.chargeDir).not.toBeNull();
    nextRound(g);
    expect(g.phase).toBe("player");
    expect(r.chargeDir).toBeNull();
    const m = spawn(g, "militiamen", "red", r.tx + 1, r.ty);
    expect(g._wouldCharge(r, m)).toBe(false);
  });
});
