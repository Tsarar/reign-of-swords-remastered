// Enemy / allied AI: the original's GroupLogic target rule, and GOLDEN REPLAYS — the AI plays real maps for a few
// rounds (the player only ends turns) and the resulting board is compared with a stored snapshot. A refactor that
// changes any AI decision changes a snapshot; if the change is intended, update with `npx vitest -u`.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, nextRound, spawn, put } from "./battle.js";

beforeAll(() => loadEpisode(2));

describe("GroupLogic (Unit::isValidFormationTarget @0x66108)", () => {
  it("a unit of a HOLDING group only targets foes within 8 tiles of the group centre (Siege of Corbeau's cannon)", () => {
    const g = makeGame(5408);
    startBattle(g);
    nextRound(g); // the garrison's group has formed and holds
    const cannon = g.units.find((u) => u.team === "red" && u.type === "cannon");
    const gi = g.ai._glGroupOf(cannon),
      grp = g._gl[gi];
    expect(grp.mode).toBe(2); // hold
    const c = grp.center;
    const foe = spawn(g, "cavalry", "blue", 0, 0);
    const at = (d) => {
      // a free tile `d` (manhattan) south of the centre
      for (let dy = d; dy >= 0; dy--)
        for (const sx of [1, -1]) {
          const x = c.tx + sx * (d - dy),
            y = c.ty + dy;
          if (x >= 0 && y < g.rows && x < g.cols && !g.unitAt(x, y)) return [x, y];
        }
      return null;
    };
    const here = { tx: cannon.tx, ty: cannon.ty };
    put(g, foe, ...at(8));
    expect(g.ai._glValidTarget(cannon, here, foe)).toBe(true);
    put(g, foe, ...at(9));
    expect(g.ai._glValidTarget(cannon, here, foe)).toBe(false);
    // ⚙ Realistic siege (a DELIBERATE DEVIATION, off by default): the cannon may fire on it
    g.realisticSiege = true;
    expect(g.ai._glValidTarget(cannon, here, foe)).toBe(true);
  });
});

// The board after `rounds` rounds of AI play — positions, HP and the dead, by unit id.
function board(g) {
  return g.units
    .map((u) =>
      [u.id, u.type, u.team, u.ally ? "ally" : "", u.tx, u.ty, Math.round(u.hp), u.dead ? "dead" : ""].join(" "),
    )
    .sort();
}
const REPLAYS = [
  // [mapId, rounds, deploy]
  [5426, 4], // The Wizard's Palace — portals, wizards, the walled-off foe deviation
  [5427, 4], // A Timely Rescue — escort / protect villagers
  [5428, 4], // Warning Caladrin — allied garrison, Dune Sirens' quicksand
  [5408, 4], // Siege of Corbeau — holding garrison groups, cannon
  [5412, 3], // The Ambush — rangers, preset armies
  [
    5410,
    4,
    [
      ["cavalry", 2, 11],
      ["pikemen", 3, 11],
      ["crossbowmen", 5, 11],
    ],
  ], // The Vanguard — a deployed army
  [5425, 4], // Valley of the Mystics
  [5611, 3], // Bordavia Raid 3 — capture areas
  [
    5627,
    4,
    [
      ["knights", 20, 6],
      ["cavalry", 20, 4],
    ],
  ], // Precarious Pass — raiders
];
describe("golden AI replays", () => {
  for (const [mapId, rounds, deploy] of REPLAYS)
    it(`map ${mapId}, ${rounds} rounds`, () => {
      const g = makeGame(mapId);
      startBattle(g, deploy || []);
      for (let r = 0; r < rounds && g.phase === "player"; r++) nextRound(g);
      expect({ turn: g.turn, phase: g.phase, board: board(g) }).toMatchSnapshot();
    });
});
