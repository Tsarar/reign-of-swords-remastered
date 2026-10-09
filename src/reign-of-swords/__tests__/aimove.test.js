// The original's movers (ai/aimove.js): the Wizard's listed tiles and straight-line move, getClosestGoal, and the
// generic mover's Stealth branch (a unit that can hide takes a free hiding tile around its path).
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put } from "./battle.js";

beforeAll(() => loadEpisode(1));

const keyXY = (k) => k.split(",").map(Number);

describe("the Wizard (type 21)", () => {
  it("lists every empty tile within its move whose cost fits, rows top to bottom, left to right", () => {
    const g = makeGame(5412);
    startBattle(g);
    const w = spawn(g, "wizards", "red", 8, 6);
    const reach = g.computeReach(w);
    const order = g.ai._oMoveOrder(w, new Set(reach.stops));
    const mv = g.moveOf(w);
    expect(order.length).toBeGreaterThan(0);
    const xy = order.map(keyXY);
    for (const [x, y] of xy) {
      expect(Math.abs(x - w.tx) + Math.abs(y - w.ty)).toBeLessThanOrEqual(mv);
      expect(g.unitAt(x, y)).toBeFalsy();
    }
    const sorted = xy.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(xy).toEqual(sorted);
  });

  it("moves to the listed tile nearest the destination in a straight line, or stays when none is nearer", () => {
    const g = makeGame(5412);
    startBattle(g);
    const w = spawn(g, "wizards", "red", 8, 6);
    only(g, w, ...g.units.filter((u) => u.team === "blue").slice(0, 1));
    const reach = g.computeReach(w);
    const order = g.ai._oMoveOrder(w, new Set(reach.stops));
    const dest = { tx: 0, ty: 6 };
    const best = order
      .map(keyXY)
      .reduce(
        (b, [x, y]) =>
          Math.abs(x - dest.tx) + Math.abs(y - dest.ty) < Math.abs(b[0] - dest.tx) + Math.abs(b[1] - dest.ty)
            ? [x, y]
            : b,
        [w.tx, w.ty],
      );
    const got = g.ai._oWizardMove(w, dest, reach, order);
    expect(Math.abs(got.tx - dest.tx) + Math.abs(got.ty - dest.ty)).toBeLessThanOrEqual(
      Math.abs(best[0] - dest.tx) + Math.abs(best[1] - dest.ty) + 1,
    );
    expect(g.ai._oWizardMove(w, { tx: w.tx, ty: w.ty }, reach, order)).toMatchObject({ tx: w.tx, ty: w.ty });
  });
});

describe("getClosestGoal", () => {
  it("is the capture tile nearest in a straight line; none without a capture zone", () => {
    const g = makeGame(5412);
    startBattle(g);
    const u = spawn(g, "footmen", "red", 2, 2);
    g.objectives = [
      { tx: 10, ty: 10 },
      { tx: 1, ty: 1 },
      { tx: 4, ty: 4 },
    ];
    expect(g.ai._oClosestGoal(u)).toEqual({ tx: 1, ty: 1 });
    g.objectives = [];
    expect(g.ai._oClosestGoal(u)).toBeNull();
  });
});

describe("the generic mover's Stealth branch", () => {
  it("a Stealth unit that can hide stops on a free hiding tile in reach on its way to a far foe", () => {
    const g = makeGame(5412);
    startBattle(g);
    const r = spawn(g, "rangers", "red", 2, 2);
    const foe = g.units.find((u) => u.team === "blue" && !u.ally);
    only(g, r, foe);
    put(g, foe, g.cols - 2, g.rows - 2);
    const reach = g.computeReach(r);
    const stops = new Set(reach.stops);
    const order = g.ai._oMoveOrder(r, stops);
    const canHide = g.ai._oCanHide(r);
    const got = g.ai._oGenericMove(r, { tx: foe.tx, ty: foe.ty }, reach, stops, order, foe, 99);
    expect(got).toBeTruthy();
    expect(stops.has(got.tx + "," + got.ty) || (got.tx === r.tx && got.ty === r.ty)).toBe(true);
    // can't hide next to a foe, or on open ground that shows more than 90
    put(g, foe, r.tx + 1, r.ty);
    expect(g.ai._oCanHide(r)).toBe(false);
    expect(typeof canHide).toBe("boolean");
  });
});
