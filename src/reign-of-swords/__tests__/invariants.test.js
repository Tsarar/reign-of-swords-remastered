// Invariants under random play: the player's side makes random moves / taps / attacks / undos / holds / marches, with
// random input pressed while actions animate; the enemy runs its real AI. Every frame: no two living units on one
// tile, no sprite away from its tile unless that unit is the one animating, no unit stuck mid-teleport, no exception.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode } from "./battle.js";
import { fuzz } from "./fuzz.js";

beforeAll(() => loadEpisode(2));

describe("invariants under random play", () => {
  for (const [mapId, seed] of [
    [5428, 1],
    [5426, 2],
    [5412, 3],
    [5408, 4],
    [5611, 5],
    [5627, 6],
  ])
    it(`map ${mapId}`, () => {
      const r = fuzz(mapId, 4, seed);
      expect(r.issues).toEqual([]);
      // the battle really was played: four rounds, or it was decided before
      expect(r.turn > 4 || r.phase === "victory" || r.phase === "defeat").toBe(true);
    });
});

describe("regressions found by random play", () => {
  it("A Timely Rescue: a Formation march waits for a unit's portal jump before the next unit sets off", async () => {
    const { missionList } = await import("../engine/engine.js");
    const i = missionList()
      .filter((x) => !x.hidden)
      .findIndex((m) => m.mapId === 5427);
    // this seed marches a Ranger onto a portal; its after-move strike used to take over the next unit's glide
    const r = fuzz(5427, 6, 31000 + i, { draw: 11 });
    expect(r.issues).toEqual([]);
  });
});
