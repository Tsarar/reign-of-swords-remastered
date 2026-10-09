// OPT-IN long random-play sweep (~15-20 min): every map of both episodes, 6 rounds, 4 seeds each, frames drawn.
// Off by default; run with:  ROS_LONG=1 npx vitest run src/reign-of-swords/__tests__/sweep-long.test.js
// Prints the maps / seeds whose play broke an invariant (fuzz.js), or threw.
import { describe, it, expect, vi } from "vitest";
import { loadEpisode } from "./battle.js";
import { fuzz } from "./fuzz.js";
import { missionList } from "../engine/engine.js";

describe.skipIf(!process.env.ROS_LONG)("long random-play sweep", () => {
  for (const ep of [1, 2])
    it(
      "Episode " + ep,
      async () => {
        await loadEpisode(ep);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bad = [];
        const maps = missionList().filter((x) => !x.hidden);
        for (const [i, m] of maps.entries())
          for (const seed of [7, 31, 59, 83]) {
            try {
              const r = fuzz(m.mapId, 6, seed * 1000 + i, { draw: 11 });
              if (r.issues.length) bad.push(m.mapId + " s" + seed + ": " + r.issues.slice(0, 2).join(" | "));
            } catch (e) {
              bad.push(m.mapId + " s" + seed + " THROW " + e.message);
            }
          }
        expect(bad).toEqual([]);
      },
      2400000,
    );
});
