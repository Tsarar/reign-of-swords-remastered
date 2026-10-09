// Rules matched to the original binary in the deep audit of 2026-10-06: the Lightning Storm's stride pattern
// (Unit::_executeAction / Unit::onTick), one Spirit Shroud curse per end of turn (Unit::endTurn), a shot deviating off
// the board (Unit::randomizeAttackLocation), and a Priest's prayers after it moves (Unit::isAbilityAvailable).
import { describe, it, expect, beforeAll, vi } from "vitest";

import { loadEpisode, makeGame, startBattle, spawn, only } from "./battle.js";
import { recCtx, texts } from "./render-helpers.js";
import { shownHp, healStep } from "../util/util.js";

beforeAll(() => loadEpisode(2));

function field() {
  const g = makeGame(5410);
  startBattle(g);
  return g;
}

describe("Lightning Storm", () => {
  // the cells a storm aimed at (cx, cy) strikes when the start roll lands on `r` (0..8)
  function storm(r) {
    const g = field();
    const w = spawn(g, "wizards", "blue", 2, 6);
    const target = spawn(g, "footmen", "red", 6, 6);
    only(g, w, target);
    w.spell = "lightning";
    vi.spyOn(g, "rng").mockReturnValue(r / 9 + 0.01);
    const roll = vi.spyOn(g, "_roll");
    g._resolveLightning(w, target, {});
    const data = roll.mock.calls.find((c) => c[1] && c[1].what === "lightning")[1];
    return data.cells.map(([x, y]) => [x - 6, y - 6]);
  }

  it("five bolts walk the 3×3 two cells at a time from a rolled start — a fixed pattern, not five random cells", () => {
    // index order C, NW, N, NE, W, E, SW, S, SE; start code 0 → indices 0, 2, 4, 6, 8
    expect(storm(0)).toEqual([
      [0, 0],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [1, 1],
    ]);
    // start code 9 (roll 1) is index 0 again — the same storm; code 1 (roll 2) → indices 1, 3, 5, 7, 0
    expect(storm(1)).toEqual(storm(0));
    expect(storm(2)).toEqual([
      [-1, -1],
      [1, -1],
      [1, 0],
      [0, 1],
      [0, 0],
    ]);
    for (let r = 0; r < 9; r++) expect(new Set(storm(r).map(String)).size).toBe(5); // always five distinct cells
  });
});

describe("Spirit Shroud", () => {
  it("a unit ending its turn near two enemy Shamans wakes only the first (one curse per end of turn)", () => {
    const g = field();
    const u = spawn(g, "footmen", "blue", 5, 5);
    const s1 = spawn(g, "shamans", "red", 7, 5),
      s2 = spawn(g, "shamans", "red", 5, 7);
    only(g, u, s1, s2);
    g._shroudEndTurn(u);
    expect([!!s1._shroudOn, !!s2._shroudOn]).toEqual([true, false]);
  });
});

describe("deviation off the board", () => {
  it("a shot pushed off the map lands there — it hits nobody instead of falling back on the target", () => {
    const g = field();
    const cat = spawn(g, "catapult", "red", 6, 5);
    const target = spawn(g, "footmen", "blue", 0, 5);
    only(g, cat, target);
    vi.spyOn(g, "_deviationPct").mockReturnValue(100);
    vi.spyOn(g, "rng").mockReturnValue(1 / 8 + 0.01); // direction 1 = west
    const landed = g._deviatedTarget({ u: cat, target });
    expect([landed.tx, landed.ty]).toEqual([-1, 5]);
    expect(landed._phantom).toBe(true);
  });
});

describe("a Priest after it moves", () => {
  it("keeps its prayers (Shield / Retribution are always on offer) even with nobody to heal", () => {
    const g = field();
    const p = spawn(g, "priests", "blue", 5, 5);
    only(g, p);
    g.enterAct(p);
    expect(g.mode).toBe("act");
    expect(g.selected).toBe(p);
  });
});

describe("HP in whole points (DELIBERATE DEVIATION from the original's 256 scale)", () => {
  it("a heal from 50 lands on 70 and reads +20; a living unit never reads 0", () => {
    const g = field();
    const u = spawn(g, "footmen", "blue", 4, 4, { hp: healStep(50).hp });
    expect(u.hp).toBe(70);
    const ctx = recCtx();
    g.renderer._drawHP(ctx, u);
    expect(texts(ctx)).toContain("70");
    expect(healStep(50)).toEqual({ hp: 70, shown: 20 });
    expect(healStep(95).shown).toBe(5); // capped at full
    expect(shownHp(0.4)).toBe(1); // a living unit never reads 0
  });
});
