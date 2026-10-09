// The threat squares a tapped unit shows — Unit::prepareThreat / Unit::canAttack(tile) (iOS Ep2 @0x7a20c / @0x79c00).
import { describe, it, expect, beforeAll } from "vitest";

import { loadEpisode, spawn } from "./battle.js";
import { blank, openArea } from "./rules-kit.js";

beforeAll(() => loadEpisode(2));

// The Vanguard (5410) has an 8×5 block of open ground; the unit stands on its left edge, middle row.
function arena(type) {
  const g = blank(5410);
  g.objectives = [];
  const a = openArea(g, 8, 5);
  const u = spawn(g, type, "red", a.x, a.y + 2);
  const has = (dx, dy) => g.threatOf(u).has(`${u.tx + dx},${u.ty + dy}`);
  return { g, u, has };
}

describe("threat squares (prepareThreat)", () => {
  it("a Move-or-Shoot bow reaches its band from where the unit STANDS; its sword walks then strikes", () => {
    const { has } = arena("archers");
    expect(has(6, 0)).toBe(true); // Longbow 2–6, no move first
    expect(has(7, 0)).toBe(false);
    expect(has(0, 0)).toBe(true); // a sword blow from a neighbouring tile
  });

  it("a catapult covers its 3–8 ring around itself, nothing nearer, nothing beyond", () => {
    const { has } = arena("catapult");
    expect(has(3, 0)).toBe(true);
    expect(has(2, 0)).toBe(false);
    expect(has(1, 0)).toBe(false);
    expect(has(0, 0)).toBe(false);
  });

  it("Wizards: every tile within 13; the Cannon: within 10, its dead range 2 included", () => {
    const diamond = (g, u, r) => {
      const out = new Set();
      for (let y = 0; y < g.rows; y++)
        for (let x = 0; x < g.cols; x++) if (Math.abs(x - u.tx) + Math.abs(y - u.ty) <= r) out.add(`${x},${y}`);
      return out;
    };
    const w = arena("wizards");
    expect(w.g.threatOf(w.u)).toEqual(diamond(w.g, w.u, 13));
    const c = arena("cannon");
    expect(c.g.threatOf(c.u)).toEqual(diamond(c.g, c.u, 10));
    expect(c.has(2, 0)).toBe(true);
  });

  it("a melee unit: anything beside a tile it can walk to — only its neighbours once it has moved", () => {
    const { g, u, has } = arena("footmen");
    const m = u.T.move;
    expect(has(m + 1, 0)).toBe(true);
    expect(has(m + 2, 0)).toBe(false);
    u._movedTurn = g.turn;
    expect(has(1, 0)).toBe(true);
    expect(has(2, 0)).toBe(false);
  });

  it("the Hero ignores its group's pace; slowed, it is held to 4 + 1 tiles", () => {
    const { u, has } = arena("king");
    u._paceMove = 2;
    expect(has(6, 0)).toBe(true);
    u.slowed = true;
    expect(has(5, 0)).toBe(true);
    expect(has(6, 0)).toBe(false);
  });

  it("tapping a unit shows exactly these squares", () => {
    const { g, u } = arena("archers");
    g.inspectUnit(u);
    expect(g.inspect.threat).toEqual(g.threatOf(u));
  });
});
