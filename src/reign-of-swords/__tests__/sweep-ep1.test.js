// Every battle of Episode I played for two rounds under random input (fuzz.js), a frame drawn every few
// steps: no two units on a tile, no sprite left off its tile, nobody stuck teleporting, no exception — on every map.
import { describe, it, expect } from "vitest";
import { loadEpisode } from "./battle.js";
import { fuzz } from "./fuzz.js";
import { missionList } from "../engine/engine.js";

await loadEpisode(1);
const maps = missionList().filter((m) => !m.hidden);

describe("Episode 1: every battle under random play", () => {
  maps.forEach((m, i) =>
    it(`${m.mapId} ${m.name}`, () => {
      const r = fuzz(m.mapId, 2, 100 + i, { draw: 7 });
      expect(r.issues).toEqual([]);
      expect(r.turn > 2 || r.phase === "victory" || r.phase === "defeat").toBe(true);
    }),
  );
});
