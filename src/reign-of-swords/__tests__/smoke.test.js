import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle } from "./battle.js";

describe("harness", () => {
  beforeAll(() => loadEpisode(2));
  it("starts an Episode II battle and reaches the player's turn", () => {
    const g = makeGame(5410);
    startBattle(g, [["cavalry", 2, 11]]);
    expect(g.mission.mapId).toBe(5410);
    expect(g.phase).toBe("player");
    expect(g.units.some((u) => u.team === "blue")).toBe(true);
    expect(g.units.some((u) => u.team === "red")).toBe(true);
  });
});
