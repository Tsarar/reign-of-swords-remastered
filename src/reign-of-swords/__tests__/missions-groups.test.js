// Mission building (data/missions.js) from the episode files, including a level with no decoded deploy tiles and
// missing optional files; and GroupLogic's script hooks / formation width (ai/grouplogic.js).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { buildMissionFromLevel, buildMissions } from "../data/missions.js";
import { loadEpisode, makeGame, startBattle, spawn } from "./battle.js";
import { patchFetch } from "./shell-helpers.js";

const EP1 = "/games/reign-of-swords/";
let levels;
beforeAll(async () => {
  levels = (await (await fetch(EP1 + "levels.json")).json()).levels;
  await loadEpisode(1);
});

// a level that has a deployment phase (a budget, not a fixed tutorial force)
const deployLevel = () => levels.find((l) => buildMissionFromLevel(l).deploy && l.group === "story");

describe("buildMissionFromLevel: the fallback deploy band", () => {
  it("with no deploy tiles and no enemy placed, the band is the bottom rows of passable ground", () => {
    const L = { ...deployLevel(), deployZone: [], enemy: [], hero: null, script: null };
    const m = buildMissionFromLevel(L);
    const ys = m.deploy.zone.map(([, y]) => y);
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBe(L.rows - 1);
    // sorted from the bottom up: no tile of the band lies above a passable bottom-row tile that was left out
    expect(Math.min(...ys)).toBeGreaterThan(L.rows / 2);
  });

  it("with an enemy placed, the band is the passable ground farthest from it", () => {
    const L0 = deployLevel();
    const L = { ...L0, deployZone: [], hero: null, script: null, enemy: [["footmen", 0, 0]] };
    const m = buildMissionFromLevel(L);
    const far = m.deploy.zone.map(([x, y]) => x + y);
    expect(Math.min(...far)).toBeGreaterThan((L.cols + L.rows) / 2);
  });
});

describe("buildMissions", () => {
  it("missing optional files (waves, dialogue, scripts, heraldry, terrain types, structures, movement) still build", async () => {
    const restore = patchFetch(
      Object.fromEntries(
        [
          "waves.json",
          "battle_events.json",
          "scripts_ai.json",
          "group_heraldry.json",
          "terrain-types.json",
          "structures.json",
          "movement.json",
        ].map((f) => [f, "fail"]),
      ),
    );
    try {
      const built = await buildMissions(EP1);
      expect(built.length).toBeGreaterThan(70);
      expect(built.every((m) => !m.waves || !m.waves.length)).toBe(true);
    } finally {
      restore();
      await buildMissions(EP1); // put the real tables back for the other tests
    }
  });

  it("a missing level file builds nothing (the engine keeps its fallback mission)", async () => {
    const restore = patchFetch({ "levels.json": "fail" });
    try {
      expect(await buildMissions(EP1)).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("GroupLogic", () => {
  it("script AIMODE: mode 1 makes the unit's group HOLD, anything else sends it forward; no group, no effect", () => {
    const g = makeGame(5412);
    startBattle(g);
    const u = g.units.find((x) => x.team === "red" && g.ai._glGroupOf(x) != null);
    const gi = g.ai._glGroupOf(u);
    g.ai._glSetMode(u, 1);
    expect(g.ai._glState(gi)).toMatchObject({ mode: 2, flag7: 0 });
    g.ai._glSetMode(u, 0);
    expect(g.ai._glState(gi).mode).toBe(0);
    const loner = spawn(g, "footmen", "blue", 0, 0);
    vi.spyOn(g.ai, "_glGroupOf").mockReturnValue(null);
    expect(() => g.ai._glSetMode(loner, 1)).not.toThrow();
  });

  it("a Hero alone in the front ranks is counted with the war engines when the row width is set", () => {
    const g = makeGame(5412);
    startBattle(g);
    const king = spawn(g, "king", "red", 2, 2),
      c1 = spawn(g, "catapult", "red", 3, 2),
      c2 = spawn(g, "catapult", "red", 4, 2),
      c3 = spawn(g, "catapult", "red", 5, 2);
    const foe = g.units.find((x) => x.team === "blue");
    g.ai._glUpdate("red:9", [king, c1, c2, c3], [foe], "red");
    const withKing = g.ai._glState("red:9").width;
    const c4 = spawn(g, "catapult", "red", 6, 2);
    g.ai._glUpdate("red:8", [c4, c1, c2, c3], [foe], "red");
    // the lone Hero counts as one more engine: the same row width as four engines
    expect(withKing).toBe(g.ai._glState("red:8").width);
    expect(king._paceMove).toBe(g.ai._glState("red:9").minMove);
  });
});

describe("GroupLogic's concentration map without record areas", () => {
  it("a hand-made objective tile (no record areas) weighs +100 spread over the kernel, until the layer's side holds it", () => {
    const g = makeGame(5412);
    startBattle(g);
    g.units = [];
    g.areas = [];
    g.objectives = [{ tx: 5, ty: 5, owner: null }];
    const W = g.cols;
    const m = g.ai._glConcentration("blue");
    expect(m[5 * W + 5]).toBe(100 * 100);
    expect(m[5 * W + 6]).toBe(100 * 50);
    g.objectives[0].owner = "blue";
    expect(g.ai._glConcentration("blue")[5 * W + 5]).toBe(0);
  });
});

describe("siege points (loadMarkers section D)", () => {
  it("Episode I's records carry them too (Aguilleon 1: the 13 gate tiles)", () => {
    const g = makeGame(5415);
    expect(g.mission.siegePoints.length).toBe(13);
    expect(g.mission.siegePoints[0]).toEqual([5, 15]);
  });

  it("each weighs 20 through the kernel on every side's layer (Map::updatePointConcentration)", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    g.units = [];
    g.areas = [];
    g.mission = { ...g.mission, siegePoints: [[3, 3]] };
    const W = g.cols;
    for (const side of ["blue", "red"]) {
      const m = g.ai._glConcentration(side);
      expect(m[3 * W + 3]).toBe(2000);
      expect(m[3 * W + 4]).toBe(1000);
      expect(m[3 * W + 7]).toBe(120);
    }
  });

  it("only Episode II's engines bombard them (Episode I has no AI state that reads the list)", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    // an allied engine with our infantry beside the enemy-held gate tiles
    const c = spawn(g, "catapult", "blue", 9, 10, { ally: true });
    spawn(g, "footmen", "blue", 9, 12);
    vi.spyOn(g, "terrainAt").mockReturnValue({ defBonus: 0.3 });
    expect(g.mission.ep).toBe(1);
    expect(g.ai._siegePointShot(c)).toBeNull();
    g.mission = { ...g.mission, ep: 2 };
    expect(g.ai._siegePointShot(c)).not.toBeNull();
  });
});

describe("allies and the concentration map (Map::updatePointConcentration / getBestPointConcentration)", () => {
  it("a unit's worth to the AI is Unit+0x198 in integers: (cost − 50)·50 ÷ 450 + 50", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    const footmen = spawn(g, "footmen", "blue", 9, 10); // cost 75 → 25·50 ÷ 450 = 2 (not 2.78)
    expect(g.ai._aiValue(footmen)).toBe(52);
  });

  it("the player's layer holds the allied armies too — every unit of team byte 0", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    g.units = [];
    g.areas = [];
    g.mission = { ...g.mission, siegePoints: [] };
    const trebuchet = spawn(g, "trebuchet", "blue", 5, 5, { ally: true });
    const m = g.ai._glConcentration("blue");
    const score = (256 * g.ai._aiValue(trebuchet)) >> 8;
    expect(m[5 * g.cols + 5]).toBe(100 * score);
    expect(m[5 * g.cols + 6]).toBe(50 * score);
  });

  it("an allied army (team 0) marches on the enemy layer's best concentration, as the enemy does on ours", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    const legion = g.units.filter((u) => u.ally && !u.dead);
    const gi = g.ai._glGroupOf(legion[0]);
    const members = legion.filter((u) => g.ai._glGroupOf(u) === gi);
    const foes = g.units.filter((u) => u.team === "red" && !u.dead);
    const group = g.ai._glUpdate(gi, members, foes, "blue");
    expect(group.target).toEqual(g.ai._glDest(group.center, "red"));
  });

  it("the best point is field·6 ÷ (distance + 5) in C integers — the first of equal values wins", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    vi.spyOn(g.ai, "_glConcentration").mockImplementation(() => {
      const f = new Int32Array(g.cols * g.rows);
      f[0 * g.cols + 3] = 100; // 600 ÷ 8 = 75
      f[0 * g.cols + 4] = 113; // 678 ÷ 9 = 75.3 → 75: a tie, so the earlier tile stays (a float division would take this one)
      return f;
    });
    expect(g.ai._glDest({ tx: 0, ty: 0 }, "blue")).toEqual({ tx: 3, ty: 0 });
  });
});
