// The legacy two-sided turn flow (maps without a groupOrder table — Episode I's tutorials): player → allied AI
// armies → enemy → next round, the enemy-first opening that does not burn a turn, per-side upkeep at each phase start
// (healing, re-arming, buffs expiring), and the tutorial drills' special endings.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, step, nextRound, put, spawn, only } from "./battle.js";
import { freeTile } from "./flow-helpers.js";

beforeAll(() => loadEpisode(1));

// The combat tutorial (5801): fixed forces, round-1 dialogue, no groupOrder.
function combat() {
  const g = makeGame(5801);
  startBattle(g);
  return g;
}
const blues = (g) => g.units.filter((u) => !u.dead && u.team === "blue");
const reds = (g) => g.units.filter((u) => !u.dead && u.team === "red");

describe("opening", () => {
  it("a fixed-force battle holds its opening until openBattle, then shows round-1 dialogue and the player's banner", () => {
    const g = makeGame(5801);
    expect(g._needsOpen).toBe(true);
    expect(g._hasGroupOrder()).toBe(false);
    expect(g.turnBanner).toBe(null);
    g.openBattle();
    expect(g._needsOpen).toBe(false);
    expect(g.battleEvent.lines.length).toBe(g.mission.events.filter((e) => e.round === 1).length);
    expect(g.turnBanner.side).toBe("player");
    const id = g._turnBannerId;
    g.openBattle(); // only once
    expect(g._turnBannerId).toBe(id);
  });

  it("an enemy-first map waits for its opening line, then the enemy moves without burning a turn", () => {
    const g = makeGame(5801);
    g.mission = { ...g.mission, enemyFirst: true };
    g.openBattle();
    expect(g._pendingEnemyOpen).toBe(true);
    expect(g.phase).toBe("player");
    g.eventClosed();
    expect(g._openingEnemy).toBe(true);
    expect(g.phase).toBe("enemy");
    g.endEnemyPhase();
    expect(g.turn).toBe(1); // the opening move is free
    expect(g._openingEnemy).toBe(false);
    expect(g.phase).toBe("player");
  });

  it("an enemy-first map without opening dialogue hands the field to the enemy at once", () => {
    const g = makeGame(5801);
    g.mission = { ...g.mission, enemyFirst: true, events: null };
    g.openBattle();
    expect(g.phase).toBe("enemy");
    expect(g._openingEnemy).toBe(true);
  });
});

describe("the two-sided cycle", () => {
  it("ending the turn with no allies goes straight to the enemy; its phase start re-arms and heals the enemy", () => {
    const g = combat();
    const r = reds(g);
    r[0].acted = true;
    r[0].attackedTurn = true;
    r[0].chargeDir = { dx: 1, dy: 0 };
    g._prayerMark("retribution", r[0]);
    g._prayerMark("shield", r[0]);
    const amb = blues(g)[0];
    amb.ambush = true;
    amb.ambushUsed = true;
    g._playerTurnAt = -1e9;
    g.endTurn();
    expect(g.phase).toBe("enemy");
    expect(g.turnBanner.side).toBe("enemy");
    expect(g.turnBanner.name).toBe("Enemy Army");
    expect(r[0]).toMatchObject({
      acted: false,
      attackedTurn: false,
      chargeDir: null,
    });
    expect(g.prayerMarks).toEqual([]); // the enemy's Retribution / Shield lapse at its turn's start
    expect(amb.ambushUsed).toBe(false); // your ambushers re-arm for the enemy's turn
    expect(g.aiQueue.length).toBe(r.length);
    expect(g.aiDelay).toBe(0.35);
  });

  it("the enemy's phase end opens round 2 for the player: re-armed, buffs gone, Ice wears off the enemy", () => {
    const g = combat();
    const b = blues(g)[0],
      r = reds(g)[0];
    b.acted = true;
    g._prayerMark("retribution", b);
    g._prayerMark("shield", b);
    r.slowed = true;
    g.startEnemyPhase();
    g.endEnemyPhase();
    expect(g.turn).toBe(2);
    expect(g.phase).toBe("player");
    expect(b.acted).toBe(false);
    expect(g.prayerMarks).toEqual([]);
    expect(r.slowed).toBe(false);
    expect(g.reach).toBe(null);
  });

  it("the turn limit ends the battle at the enemy's phase end (a story-type battle is lost)", () => {
    const g = combat();
    g.turn = g.mission.turnLimit;
    g.startEnemyPhase();
    g.endEnemyPhase();
    expect(g.phase).toBe("defeat");
    expect(g.defeatReason).toBe("turns");
  });

  it("the field decided during the enemy's turn ends the battle at its end", () => {
    const g = combat();
    g.startEnemyPhase();
    for (const u of blues(g)) u.dead = true;
    g.endEnemyPhase();
    expect(g.phase).toBe("defeat");
    expect(g.defeatReason).toBe("wiped");
  });

  it("allied units take their own phase between the player and the enemy", () => {
    const g = combat();
    const [a, b] = blues(g);
    a.ally = true;
    a.group = 1;
    b.ally = true;
    b.group = 0;
    a.acted = true;
    g._playerTurnAt = -1e9;
    for (const u of blues(g)) if (!u.ally) u.acted = true;
    g.endTurn();
    expect(g.phase).toBe("ally");
    expect(g.turnBanner.side).toBe("ally");
    expect(g.aiQueue).toEqual([b, a]); // ordered by army
    expect(a.acted).toBe(false);
    g._aiPhase = "ally";
    g._endAiPhase();
    expect(g.phase).toBe("enemy");
  });

  it("several allied armies announce themselves one by one (no single ally banner)", () => {
    const g = combat();
    blues(g)[0].ally = true;
    g.mission = { ...g.mission, allyGroups: { 0: { name: "A" }, 1: { name: "B" } }, enemyGroups: { 0: {}, 1: {} } };
    const id = g._turnBannerId;
    g.startAllyPhase();
    expect(g._turnBannerId).toBe(id);
    g.startEnemyPhase();
    expect(g._turnBannerId).toBe(id); // several enemy armies: announced per faction by the AI
  });

  it("an ally phase with no allies left goes on to the enemy; its end judges the field first", () => {
    const g = combat();
    g.startAllyPhase();
    expect(g.phase).toBe("enemy");
    const h = combat();
    for (const u of reds(h)) u.dead = true;
    h.endAllyPhase();
    expect(h.phase).toBe("victory");
  });

  it("a full round with the real AI returns to the player in round 2", () => {
    const g = combat();
    nextRound(g);
    expect(g.phase === "player" || g.phase === "victory" || g.phase === "defeat").toBe(true);
    if (g.phase === "player") expect(g.turn).toBe(2);
  });

  it("units on a healing tile heal at the start of their own side's turn", () => {
    const g = combat();
    let v = null;
    for (let y = 0; y < g.rows && !v; y++)
      for (let x = 0; x < g.cols && !v; x++) if (g.terrainAt(x, y).heal && !g.unitAt(x, y)) v = [x, y];
    if (!v) return; // (map without a village)
    const b = blues(g)[0];
    put(g, b, ...v);
    b.hp = 40;
    g.healOnKeeps("red");
    expect(b.hp).toBe(40);
    g.healOnKeeps("blue");
    expect(Math.floor(b.hp)).toBe(40 + g.terrainAt(...v).heal); // shown HP + the bonus
    b.hp = 100;
    g.healOnKeeps("blue"); // full HP: no floater
  });
});

describe("tutorial drills", () => {
  it("the movement drill out of turns: Sir Anston's 'Perhaps your days as a squire…', then it is over (never a defeat)", () => {
    const g = makeGame(5800);
    startBattle(g);
    g.turn = g.mission.turnLimit;
    g.startEnemyPhase();
    g.endEnemyPhase();
    expect(g.battleEvent.lines.map((l) => l.text)).toEqual([expect.stringMatching(/^Perhaps your days as a squire/)]);
    expect(g.phase).not.toBe("victory");
    g.eventClosed();
    expect(g.phase).toBe("victory");
  });

  it("the deployment drill greets you during the muster and is won once its closing line is read", () => {
    const g = makeGame(5802);
    expect(g.phase).toBe("deploy");
    expect(g.battleEvent.lines.length).toBe(1);
    g.eventClosed();
    const [x, y] = [...g.deployZone][0].split(",").map(Number);
    g.placeUnit(g._rosterOrder[0], x, y);
    g.startBattle();
    expect(g._pendingDrillWin).toBe(true);
    expect(g.battleEvent).toBeTruthy();
    expect(g.phase).toBe("player");
    g.eventClosed();
    expect(g.phase).toBe("victory");
  });
});

void [step, spawn, only, freeTile, vi];
