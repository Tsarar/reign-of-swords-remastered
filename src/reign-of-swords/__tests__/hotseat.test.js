// Hot-seat (engine/hotseat.js): two players on one device on a skirmish map — the two musters in each side's own
// marker blocks with each side's budget, the handovers, the team swap that keeps the active army "blue", the round
// counter and the winner.
import { describe, it, expect, beforeAll } from "vitest";

import { loadEpisode, makeGame, put } from "./battle.js";

beforeAll(() => loadEpisode(1));

const PICKET_FIELD = 5210; // West (group 0, moves first) vs East (group 1), 3500 gold each
const CASTLE_SIEGE = 5206; // a conquer (type 2) map

function hotseat(mapId = PICKET_FIELD) {
  const g = makeGame(mapId, { god: false });
  g.setHotseat(true);
  g.reset();
  return g;
}
const zoneTile = (g) => [...g.deployZone][0].split(",").map(Number);
const openTurn = (g) => (g._playerTurnAt = -1e9); // End Turn ignores a press right after a turn opens

describe("hot-seat", () => {
  it("builds a two-player muster from the skirmish map: each side's own blocks and gold, no AI army", () => {
    const g = hotseat();
    expect(g.hs.players.map((p) => [p.name, p.side, p.gi, p.budget])).toEqual([
      ["Player 1", "West", 0, 3500],
      ["Player 2", "East", 1, 3500],
    ]);
    expect(g.phase).toBe("deploy");
    expect(g.units).toEqual([]);
    const west = g.mission.markers.filter((m) => m[3] === 0).length;
    expect(g.deployZone.size).toBe(west);
  });

  it("musters both players in turn, swaps the field and opens the first mover's turn", () => {
    const g = hotseat();
    const [x1, y1] = zoneTile(g);
    g.placeUnit("militiamen", x1, y1);
    const p1unit = g.unitAt(x1, y1);
    expect([p1unit.team, p1unit.paint, p1unit.group]).toEqual(["blue", "blue", 0]);

    g.startBattle(); // player 1 is done: hand over for player 2's muster
    expect(g.phase).toBe("deploy");
    expect(g._hotseatView().handover).toMatchObject({ name: "Player 2", kind: "deploy" });

    g.hotseatContinue();
    expect(g.hs.active).toBe(1);
    expect(p1unit.team).toBe("red"); // player 2's army is the "blue" one now…
    expect(g.deployZone.has(x1 + "," + y1)).toBe(false); // …and musters in its own blocks
    const [x2, y2] = zoneTile(g);
    g.placeUnit("footmen", x2, y2);
    const p2unit = g.unitAt(x2, y2);
    expect([p2unit.team, p2unit.paint, p2unit.group]).toEqual(["blue", "red", 1]);

    g.startBattle(); // both mustered: West (group 0) moves first, so the device goes back to player 1
    expect(g._hotseatView().handover).toMatchObject({ name: "Player 1", kind: "turn" });
    g.hotseatContinue();
    expect(g.phase).toBe("player");
    expect([p1unit.team, p2unit.team]).toEqual(["blue", "red"]);
    expect([g.turnBanner.name, g.turnBanner.armySide]).toEqual(["Player 1", "West"]);
    expect(g.paintOfTeam("blue")).toBe("blue");

    // West ends its turn → East plays the same round; East ends → round 2
    openTurn(g);
    g.endTurn();
    expect(g.turn).toBe(1);
    g.hotseatContinue();
    expect(g.hs.active).toBe(1);
    expect(p2unit.team).toBe("blue");
    expect(g.paintOfTeam("blue")).toBe("red");
    expect([g.turnBanner.name, g.turnBanner.armySide]).toEqual(["Player 2", "East"]);
    openTurn(g);
    g.endTurn();
    expect(g.turn).toBe(2);
    expect(g._hotseatView().handover).toMatchObject({ name: "Player 1", kind: "turn" });
  });

  it("a conquer map: only player 1 (team 0) takes an area — on either turn — and player 2 never retakes it", () => {
    const g = hotseat(CASTLE_SIEGE);
    g.placeUnit("militiamen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue();
    g.placeUnit("footmen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue(); // the first mover's turn — here player 2 (group 0)
    if (g.hs.active === 0) {
      openTurn(g);
      g.endTurn();
      g.hotseatContinue();
    }
    expect(g.hs.active).toBe(1); // player 2's turn: player 1's men are "red" now
    const area = g.captureAreas[0],
      [cell] = area.tiles;
    const p1 = g.units.find((u) => u.paint === "blue"),
      p2 = g.units.find((u) => u.paint === "red");
    expect(p1.team).toBe("red");
    expect(area.owner).toBe("blue"); // player 2 holds every area at the start
    put(g, p1, cell.tx, cell.ty);
    g.updateCapturePoints();
    expect(area.owner).toBe("red"); // taken by player 1 during player 2's turn
    expect(g.notice.text).toBe("The enemy has conquered a vital area!");
    put(g, p1, 0, 0);
    put(g, p2, cell.tx, cell.ty);
    g.updateCapturePoints();
    expect(area.owner).toBe("red"); // player 2 can't take it back
    g._hsSwap();
    expect(area.owner).toBe("blue");
  });

  it("the side that wipes out the other wins — on either player's turn", () => {
    const g = hotseat();
    g.placeUnit("militiamen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue();
    g.placeUnit("footmen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue(); // player 1's turn
    const east = g.units.find((u) => u.paint === "red");
    east.dead = true;
    g._checkPhaseEnd();
    expect(g.phase).toBe("victory");
    expect(g._hotseatView().winner).toMatchObject({ name: "Player 1", side: "West" });

    const h = hotseat();
    h.placeUnit("militiamen", ...zoneTile(h));
    h.startBattle();
    h.hotseatContinue();
    h.placeUnit("footmen", ...zoneTile(h));
    h.startBattle();
    h.hotseatContinue();
    openTurn(h);
    h.endTurn();
    h.hotseatContinue(); // player 2's turn: West falls
    h.units.find((u) => u.paint === "blue").dead = true;
    h._checkPhaseEnd();
    expect(h._hotseatView().winner).toMatchObject({ name: "Player 2", side: "East" });
  });

  it("the setup's names, one budget for both sides and the chosen first mover", () => {
    const g = makeGame(PICKET_FIELD, { god: false });
    g.setHotseat(true);
    g.setHotseatOptions({ names: ["Ann", " "], budget: 1500, first: 1, coin: true });
    g.reset();
    expect(g.hs.players.map((p) => [p.name, p.budget, p.mapBudget])).toEqual([
      ["Ann", 1500, 3500],
      ["Player 2", 1500, 3500],
    ]);
    expect(g.deployBudget()).toBe(1500);
    expect(g.maxElite()).toBe(1);
    g.placeUnit("militiamen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue();
    expect(g.deployBudget()).toBe(1500);
    g.placeUnit("footmen", ...zoneTile(g));
    g.startBattle();
    // the opening card names the coin toss's winner, who then moves first
    expect(g._hotseatView().handover).toMatchObject({ name: "Player 2", kind: "turn", opening: true, coin: true });
    g.hotseatContinue();
    expect(g.hs.active).toBe(1);
    openTurn(g);
    g.endTurn();
    expect(g.turn).toBe(1); // East opened, so the round ends after West
    g.hotseatContinue();
    openTurn(g);
    g.endTurn();
    expect(g.turn).toBe(2);
  });

  it("each player's own points and Medals (elite slots) — empty Medals = 1 per 1000 points", () => {
    const g = makeGame(PICKET_FIELD, { god: false });
    g.setHotseat(true);
    g.setHotseatOptions({ budgets: [4000, 2500], elites: [null, 5] });
    g.reset();
    expect([g.deployBudget(), g.maxElite()]).toEqual([4000, 4]);
    g.placeUnit("militiamen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue();
    expect([g.deployBudget(), g.maxElite()]).toEqual([2500, 5]);
  });

  it("the muster is blind: the other army is hidden until the battle starts", () => {
    const g = hotseat();
    g.placeUnit("militiamen", ...zoneTile(g));
    g.startBattle();
    g.hotseatContinue();
    const west = g.units[0];
    expect(g.hsMusterHidden(west)).toBe(true);
    g.peekAt({ tx: west.tx, ty: west.ty });
    expect(g.inspect).toBeFalsy();
    g.placeUnit("footmen", ...zoneTile(g));
    g.startBattle();
    expect(g.hsMusterHidden(west)).toBe(false);
  });

  it("a non-skirmish map stays an ordinary battle", () => {
    const g = makeGame(5401, { god: false });
    g.setHotseat(true);
    g.reset();
    expect(g.hs).toBe(null);
  });
});
