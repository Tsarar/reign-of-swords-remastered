// Turn flow on Episode II data (engine/turnflow.js): every win / lose rule of _terminal, the timeout judgement
// (GameScreen::endTurn → checkOutcome(2)), Major Victory standing, the auto end of the player's turn, the real
// per-group turn cycle (groups in ascending global index, the player's slot between them), waves, round dialogue,
// turn banners and the Formation march order.
import { describe, it, expect, beforeAll, vi } from "vitest";

import { loadEpisode, makeGame, startBattle, step, nextRound, put, spawn } from "./battle.js";
import { reds, vanguard } from "./flow-helpers.js";
import { DEPLOY_COST } from "../data/game-data.js";

beforeAll(() => loadEpisode(2));

const kill = (u) => {
  u.dead = true;
  u.dieT = 0;
};

describe("_terminal — lose conditions", () => {
  it("The High Pass: the third war engine lost plays the retreat and leaves the battle (its script, not checkOutcome)", () => {
    const g = makeGame(5416);
    startBattle(g, "auto");
    const sc = g.mission.script;
    const t = sc.triggers.find((x) => x.tag === 8 && x.a[1] === 3);
    expect(sc.actions[t.a[2]].end).toBe("defeat");
    g._sc.counters[t.a[0]] = 3;
    g.scenario.exec(t.a[2]);
    for (let i = 0; i < 20 && (g.battleEvent || g._sc.queue.length); i++) {
      g.scenario.flush(true);
      if (g.battleEvent) g.eventClosed();
    }
    expect(g.phase).toBe("defeat");
    expect(g.defeatReason).toBe("script");
  });

  it("a wiped army loses, except when the last units escaped the field on a won escape", () => {
    const { g } = vanguard();
    g.units.filter((u) => u.team === "blue").forEach(kill);
    expect(g._terminal()).toBe("defeat");
    expect(g.defeatReason).toBe("wiped");
    g._sc.escaped = 3;
    g.phase = "victory";
    expect(g._terminal()).toBe("victory");
  });
});

describe("_terminal — win conditions", () => {
  it("wiping out the enemy wins and judges Major Victory (40% of the budget left standing)", () => {
    const { g, far, u } = vanguard("knights");
    kill(far);
    expect(g._terminal()).toBe("victory");
    // knights (cost) + militia at full HP vs a 2000 budget
    const str = DEPLOY_COST.knights + DEPLOY_COST.militiamen;
    expect(g.majorVictory).toBe(str >= 800);
    u.hp = 1;
    g.units.find((x) => x.type === "militiamen" && x.team === "blue").hp = 1;
    expect(g._terminal()).toBe("victory");
    expect(g.majorVictory).toBe(false);
  });

  it("waves still to come don't hold the battle: a cleared field wins at once (The Peasant Levy has no win switch)", () => {
    const g = makeGame(5406);
    startBattle(g, "auto");
    reds(g).forEach(kill);
    expect(g._firedWaves.size).toBe(0);
    expect(g._terminal()).toBe("victory");
  });

  it("the script's win switch (op10) off keeps a cleared field open until it is turned back on", () => {
    const { g, far } = vanguard();
    kill(far);
    g._sc.flags[0] = 0;
    expect(g._terminal()).toBe(null);
    g._sc.flags[0] = 1;
    expect(g._terminal()).toBe("victory");
  });

  it("script-hidden enemies (HIDE) are still on the field: the battle goes on until they fall", () => {
    const { g, far } = vanguard();
    g._turnEnded = true; // checkOutcome is asked after a turn has ended
    g._setHidden(far, true); // the last enemy, script-hidden on its tile
    expect(g._terminal()).toBe(null);
    kill(far);
    expect(g._terminal()).toBe("victory");
  });

  it("holding every capture objective does NOT end the battle — the original has no such win (Twinbridge)", () => {
    const g = makeGame(5216);
    startBattle(g, "auto");
    expect(g.objectives.length).toBe(9);
    expect(g._terminal()).toBe(null);
    for (const o of g.objectives) o.owner = "blue"; // taken earlier, nobody standing on it now
    for (const o of g.objectives) if (g.unitAt(o.tx, o.ty)) g.unitAt(o.tx, o.ty).team = "blue";
    expect(g._terminal()).toBe(null);
  });

  it("the movement drill: the record's squad, its 3×3 green — seven on it → Sir Anston's address, then it is done", () => {
    const g = makeGame(5806);
    startBattle(g);
    expect(g.mission.noEnemy).toBe(true);
    const blue = g.units.filter((u) => u.team === "blue");
    expect(blue.map((u) => [u.type, u.tx, u.ty]).sort()).toEqual(
      [
        ["footmen", 9, 3],
        ["pikemen", 8, 5],
        ["pikemen", 11, 4],
        ["footmen", 10, 5],
        ["crossbowmen", 7, 5],
        ["pikemen", 8, 6],
        ["footmen", 10, 3],
      ].sort(),
    ); // the record's DEPLOY-START spawns
    expect([...g.tutZone].sort()).toEqual(["10,6", "10,7", "10,8", "11,6", "11,7", "11,8", "9,6", "9,7", "9,8"]);
    expect(g._terminal()).toBe(null);
    const green = [...g.tutZone].map((k) => k.split(",").map(Number));
    blue.slice(0, 6).forEach((u, i) => put(g, u, ...green[i]));
    expect(g._terminal()).toBe(null);
    expect(g.battleEvent).toBeFalsy(); // six is not enough (the goal trigger wants 7)
    put(g, blue[6], ...green[6]);
    expect(g._terminal()).toBe(null);
    expect(g.battleEvent.lines[0].text).toMatch(/^Very good/);
    expect(g.phase).toBe("player"); // not before it is read
    g.eventClosed();
    expect(g.phase).toBe("victory");
  });
});

describe("_timeoutOutcome — the turn limit", () => {
  it("the story campaign is simply lost — no map is won by lasting the distance (The Peasant Levy, Sangsoleil 2)", () => {
    const g = makeGame(5406);
    expect(g._timeoutOutcome()).toBe("defeat");
    expect(g.defeatReason).toBe("turns");
    const h = makeGame(5413);
    expect(h._timeoutOutcome()).toBe("defeat");
  });
  it("a skirmish is judged on strength (HP x deploy cost), x1.25 for the side holding the objective", () => {
    const g = makeGame(5216);
    startBattle(g, "auto");
    for (const u of g.units) u.dead = true;
    const b = spawn(g, "militiamen", "blue", 1, 1),
      r = spawn(g, "militiamen", "red", 3, 1);
    expect(g._timeoutOutcome()).toBe("victory"); // equal strength: the player wins ties
    b.hp = 90;
    expect(g._timeoutOutcome()).toBe("defeat");
    expect(g.defeatReason).toBe("turns");
    // the blue militia now stands on the capture objective: 90 x 1.25 beats 100
    const o = g.objectives[0];
    put(g, b, o.tx, o.ty);
    g.updateObjectives(); // the capture check (updateCapturePoints) hands the area over
    expect(g._captureHolder()).toBe("blue");
    expect(g._timeoutOutcome()).toBe("victory");
    r.hp = 100;
  });
});

describe("medalStatus", () => {
  it("a preset army with no budget always qualifies; holding the objective multiplies by 1.25", () => {
    const g = makeGame(5412);
    startBattle(g);
    const st = g.medalStatus();
    expect(st.budget).toBe(0);
    expect(st.pct).toBe(null);
    expect(st.ok).toBe(true);
    const k = makeGame(5216);
    startBattle(k, "auto");
    for (const u of k.units) u.dead = true;
    const b = spawn(k, "knights", "blue", 1, 1);
    const plain = k.medalStatus().strength;
    put(k, b, k.objectives[0].tx, k.objectives[0].ty);
    k.updateObjectives();
    const held = k.medalStatus();
    expect(held.hold).toBe(true);
    expect(held.strength).toBe(Math.round(plain * 1.25));
    expect(held.pct).toBe(Math.round(((plain * 1.25) / k.mission.deploy.budget) * 100));
  });
});

describe("the end of the player's turn", () => {
  it("_checkPhaseEnd ends the battle when _terminal reports an outcome", () => {
    const { g, far } = vanguard();
    kill(far);
    g._checkPhaseEnd();
    expect(g.phase).toBe("victory");
  });

  it("when every unit has acted the turn ends at once — after a committed action", () => {
    const { g, u, idle } = vanguard();
    u.acted = true;
    idle.acted = true;
    g._undoFrom = null;
    g._checkPhaseEnd();
    expect(g.phase).toBe("enemy");
  });

  it("after an undoable move it waits 1.2 s (Undo stays usable), and an Undo in that window cancels it", () => {
    const { g, u, idle } = vanguard();
    idle.acted = true;
    g.select(u);
    const to = [...g.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => !g.unitAt(x, y));
    const glide = () => {
      for (let i = 0; i < 200 && g.anim; i++) step(g);
    };
    g.click({ tx: to[0], ty: to[1] });
    glide();
    // no enemy in reach → the unit's turn ended, but the move is still undoable and the turn waits
    expect(u.acted).toBe(true);
    expect(g.canUndo()).toBe(true);
    expect(g.phase).toBe("player");
    g.undoMove();
    expect(u.acted).toBe(false);
    for (let i = 0; i < 40; i++) step(g);
    expect(g.phase).toBe("player"); // the pending auto-end found an un-acted unit and stood down
    // move again and let the grace run out
    g.click({ tx: to[0], ty: to[1] });
    glide();
    for (let i = 0; i < 20; i++) step(g);
    expect(g.phase).toBe("player"); // still inside the 1.2 s window
    for (let i = 0; i < 10; i++) step(g);
    expect(g.phase).not.toBe("player");
    expect(g._undoFrom).toBe(null);
  });

  it("the grace timer does nothing if a dialogue, a skip prompt or an animation is up when it fires", () => {
    const { g, u, idle } = vanguard();
    idle.acted = true;
    u.acted = true;
    g._undoFrom = { u, tx: u.tx, ty: u.ty };
    g._checkPhaseEnd();
    g.battleEvent = { lines: [], id: 99 };
    for (let i = 0; i < 30; i++) g._runDelayed(0.05);
    expect(g.phase).toBe("player");
    g.battleEvent = null;
    // the timer has been spent; a fresh check re-arms it and an un-acted unit cancels the end
    g._checkPhaseEnd();
    u.acted = false;
    for (let i = 0; i < 30; i++) g._runDelayed(0.05);
    expect(g.phase).toBe("player");
  });

  it("endTurn is ignored outside the player phase, mid-animation and right after a turn opened", () => {
    const { g } = vanguard();
    g._playerTurnAt = performance.now();
    g.endTurn();
    expect(g.phase).toBe("player");
    g._playerTurnAt = -1e9;
    g.anim = { type: "pan", t: 0 };
    g.endTurn();
    expect(g.phase).toBe("player");
    g.anim = null;
    g.endTurn();
    expect(g.phase).toBe("enemy");
    g.endTurn(); // not the player's phase any more
    expect(g.phase).toBe("enemy");
  });
});

describe("the real per-group turn cycle (groupOrder)", () => {
  it("player (group 0) → enemy (group 1) → next round; the banner names each army", () => {
    const { g, far } = vanguard();
    expect(g._hasGroupOrder()).toBe(true);
    g._playerTurnAt = -1e9;
    g.endTurn();
    expect(g.phase).toBe("enemy");
    expect(g._aiSegment).toBe("post");
    expect(g.turnBanner.side).toBe("enemy");
    expect(g.aiQueue).toEqual([far]);
    expect(g.aiDelay).toBe(0.9);
    g._endAiPhase();
    expect(g.turn).toBe(2);
    expect(g.phase).toBe("player");
    expect(g.turnBanner.side).toBe("player");
    expect(g.turnBanner.name).toBe("Your Legion");
    expect(g.turnBanner.turnsLeft).toBe(g.mission.turnLimit - 1);
  });

  it("groups before the player open the round (Siege of Corbeau: enemy 0, player 1, enemy 2)", () => {
    const g = makeGame(5408);
    startBattle(g, "auto");
    expect(g.phase).toBe("player");
    const gis = (gi) => g.units.filter((u) => !u.dead && u.team === "red" && u.group === gi);
    expect(gis(0).length).toBeGreaterThan(0);
    expect(gis(2).length).toBeGreaterThan(0);
    g._playerTurnAt = -1e9;
    g.endTurn();
    expect(g._lastAiGroup).toBe(2); // after the player: group 2
    g._endAiPhase();
    expect(g.turn).toBe(2);
    expect(g._aiSegment).toBe("pre");
    expect(g._lastAiGroup).toBe(0); // next round opens with group 0
    g._endAiPhase();
    expect(g.phase).toBe("player");
  });

  it("a wiped-out army is skipped", () => {
    const g = makeGame(5408);
    startBattle(g, "auto");
    g.units.filter((u) => u.team === "red" && u.group === 2).forEach(kill);
    g._playerTurnAt = -1e9;
    g.endTurn();
    // group 2 gone → the round ends and group 0 opens round 2 straight away
    expect(g.turn).toBe(2);
    expect(g._lastAiGroup).toBe(0);
  });

  it("an army's units heal on villages at the start of ITS turn, not the player's", () => {
    const { g, far } = vanguard();
    // find a healing tile
    let v = null;
    for (let y = 0; y < g.rows && !v; y++)
      for (let x = 0; x < g.cols && !v; x++) if (g.terrainAt(x, y).heal && !g.unitAt(x, y)) v = [x, y];
    put(g, far, ...v);
    far.hp = 50;
    g._startPlayerTurn();
    expect(far.hp).toBe(50);
    g._runAiGroup(1, "red", false, [far]);
    expect(Math.floor(far.hp)).toBe(50 + g.terrainAt(...v).heal); // shown HP + the bonus
    expect(g.floaters.some((f) => f.heal && f.text === "+" + g.terrainAt(...v).heal)).toBe(true);
  });

  it("_startPlayerTurn ends the battle instead when the field is decided", () => {
    const { g, far } = vanguard();
    kill(far);
    g.phase = "enemy";
    g._startPlayerTurn();
    expect(g.phase).toBe("victory");
  });

  it("the round end judges the field, and the turn limit ends the battle", () => {
    const { g, far } = vanguard();
    g._aiSegment = "post";
    g._aiSchedule = [];
    kill(far);
    g._advanceAi();
    expect(g.phase).toBe("victory");
    const h = vanguard().g;
    h.turn = h.mission.turnLimit;
    h._aiSegment = "post";
    h._aiSchedule = [];
    h._advanceAi();
    expect(h.phase).toBe("defeat");
    expect(h.defeatReason).toBe("turns");
  });

  it("a full round played by the real AI comes back to the player", () => {
    const { g } = vanguard();
    nextRound(g);
    expect(g.phase).toBe("player");
    expect(g.turn).toBe(2);
  });
});

describe("_beginOpening", () => {
  it("an enemy-first groupOrder map holds its opening while a dialogue is up, then opens on dismissal", () => {
    const g = makeGame(5403); // River Valley: the enemy (group 0) moves before the player (group 1)
    startBattle(g, [["swordsmen", ...[...makeGame(5403).deployZone][0].split(",").map(Number)]]);
    g.phase = "player";
    g.battleEvent = { lines: [{ text: "To arms!" }], id: 50 };
    g._beginOpening();
    expect(g._pendingEnemyOpen).toBe(true);
    expect(g.phase).toBe("player");
    g.eventClosed();
    expect(g._pendingEnemyOpen).toBe(false);
    expect(g.phase).toBe("enemy");
    expect(g._aiSegment).toBe("pre");
    expect(g._lastAiGroup).toBe(0);
  });

  it("a player-first map just announces the player's turn", () => {
    const { g } = vanguard();
    g.battleEvent = null;
    const id = g._turnBannerId;
    g._beginOpening();
    expect(g._turnBannerId).toBe(id + 1);
    expect(g.phase).toBe("player");
  });
});

describe("waves", () => {
  it("an enemy column arrives at the top of its side's phase in its round, once (The Peasant Levy, round 3)", () => {
    const g = makeGame(5406);
    startBattle(g, "auto");
    const w = g.mission.waves[0];
    expect(w.round).toBe(3);
    g._fireWaves("red");
    expect(g._firedWaves.size).toBe(0);
    g.turn = 3;
    g._fireWaves("blue"); // the other side's phase: nothing
    expect(g._firedWaves.size).toBe(0);
    const before = reds(g).length;
    // block the first recorded tile: that unit drops on the nearest free tile instead
    const [, x0, y0] = w.units[0];
    const blocker = spawn(g, "militiamen", "blue", x0, y0);
    g._fireWaves("red");
    expect(reds(g).length).toBe(before + w.units.length);
    expect(g.wave.count).toBe(w.units.length);
    expect(g.wave.side).toBe("red");
    const arrived = g.units.filter((u) => u.wave);
    expect(arrived.every((u) => u.team === "red")).toBe(true);
    expect(arrived.some((u) => u.tx === x0 && u.ty === y0)).toBe(false);
    expect(blocker.tx).toBe(x0);
    g._fireWaves("red");
    expect(reds(g).length).toBe(before + w.units.length); // once only
  });

  it("an allied column (not the player's group) joins as an ally of its own army", () => {
    const g = makeGame(5428);
    startBattle(g);
    const i = g.mission.waves.findIndex((w) => w.side === "blue");
    const w = g.mission.waves[i];
    g.turn = w.round;
    g._fireWaves("blue");
    const arrived = g.units.filter((u) => u.wave);
    expect(arrived.length).toBeGreaterThan(0);
    for (const u of arrived) {
      expect(u.team).toBe("blue");
      const gi = w.units.find(([t]) => t === u.type)[3];
      expect(u.group).toBe(gi);
      expect(!!u.ally).toBe(gi !== g.mission.playerGroup);
    }
  });

  it("no waves after the battle has ended; a unit with no free tile within 4 is dropped", () => {
    const g = makeGame(5406);
    startBattle(g, "auto");
    g.phase = "victory";
    g.turn = 3;
    g._fireWaves("red");
    expect(g._firedWaves.size).toBe(0);
    g.phase = "player";
    // a fully occupied 9x9 around a tile → no spawn cell
    const unitAtOrig = g.unitAt.bind(g);
    g.unitAt = () => ({ team: "blue" });
    expect(g._freeSpawnCell(5, 5)).toBe(null);
    g.unitAt = unitAtOrig;
    expect(g._freeSpawnCell(-1, 5)).not.toBe(null); // off the map: the nearest on-map tile
  });
});

describe("round dialogue (_fireEvents / focusEventLine)", () => {
  it("fires each round's lines once, pans to a line's camera focus, and skips script-staged lines", () => {
    const g = makeGame(5429); // Caladrin Defense: lines on rounds 1, 3, 7
    startBattle(g, "auto");
    const r3 = g.mission.events.filter((e) => e.round === 3 && !e.init);
    expect(r3.length).toBeGreaterThan(0);
    g.battleEvent = null;
    g.turn = 3;
    g._fireEvents();
    expect(g.battleEvent.lines.map((l) => l.text)).toEqual(r3.map((e) => e.text));
    expect(g.shownLines()).toEqual(expect.arrayContaining(r3.map((e) => e.text)));
    const id = g.battleEvent.id;
    g.battleEvent = null;
    g._fireEvents();
    expect(g.battleEvent).toBe(null); // once per round
    g.turn = 2;
    g._fireEvents(); // a round without lines
    expect(g.battleEvent).toBe(null);
    // camera focus
    g.battleEvent = { lines: [{ text: "a", cam: [3, 4] }, { text: "b" }], id: id + 1 };
    g.camTarget = null;
    g.focusEventLine(1);
    expect(g.camTarget).toBe(null);
    g.focusEventLine(0);
    expect(g.camTarget).not.toBe(null);
    g.battleEvent = null;
    g.focusEventLine(0); // no beat up: nothing
    g.phase = "defeat";
    g.turn = 7;
    g._fireEvents();
    expect(g.battleEvent).toBe(null);
  });
});

describe("turn banners (_announceTurn)", () => {
  it("the player's banner is Your Legion with the imperial crest and plays the turn sting", () => {
    const { g } = vanguard();
    g.audio = { play: vi.fn() };
    g._announceTurn("player");
    expect(g.turnBanner).toMatchObject({
      side: "player",
      name: "Your Legion",
      crest: "imperial",
      color: "142,199,255",
    });
    expect(g.audio.play).toHaveBeenCalledWith("turn", 0.5);
  });
  it("a groupOrder army flies its own heraldry: the group's name, crest and field colour", () => {
    const g = makeGame(5402); // Defense of the Emperor: two enemy, two allied armies
    for (const gd of g.mission.groupOrder.filter((x) => x.side !== "player")) {
      g._announceTurn(gd.side, gd.gi);
      expect(g.turnBanner.name).toBe(gd.name || (gd.side === "ally" ? "Allied Army" : "Enemy Army"));
      expect(g.turnBanner.crest).toBeTruthy();
      expect(g.turnBanner.color).toBeTruthy();
      if (gd.bgColor && gd.device != null) expect(g.turnBanner.crestH.symbol).toBe(gd.device);
    }
    // a group with no banner / colours falls back to the per-group band palette and the cycled crests
    g.mission = {
      ...g.mission,
      groupByGi: { 7: { gi: 7, side: "enemy" }, 8: { gi: 8, side: "ally" } },
      hpByGi: {},
    };
    g._announceTurn("enemy", 7);
    expect(g.turnBanner.name).toBe("Enemy Army");
    expect(g.turnBanner.color).toBeTruthy();
    g._announceTurn("ally", 8);
    expect(g.turnBanner.name).toBe("Allied Army");
    expect(g.turnBanner.crestH).toBe(null);
  });
  it("the legacy two-sided tables: ally / enemy groups by index, and a plain Enemy Army", () => {
    const g = makeGame(5410);
    g.mission = {
      ...g.mission,
      groupByGi: null,
      allyGroups: { 0: { name: "Caladrin Guard", banner: 2 }, 1: { name: "Bare" } },
      enemyGroups: { 1: { name: "Rebels", banner: 3 }, 2: { name: "Raiders" } },
    };
    g._announceTurn("ally", 0);
    expect(g.turnBanner).toMatchObject({ name: "Caladrin Guard", banner: 2 });
    g._announceTurn("ally", 1);
    expect(g.turnBanner.name).toBe("Bare");
    g.mission.allyGroups = null;
    g._announceTurn("ally");
    expect(g.turnBanner.name).toBe("Allied Army");
    g._announceTurn("enemy", 1);
    expect(g.turnBanner).toMatchObject({ name: "Rebels", banner: 3 });
    g._announceTurn("enemy", 2);
    expect(g.turnBanner.name).toBe("Raiders");
    g._announceTurn("enemy");
    expect(g.turnBanner).toMatchObject({ name: "Enemy Army", color: "225,90,80" });
    g.turn = 99;
    g._announceTurn("enemy");
    expect(g.turnBanner.turnsLeft).toBe(0);
  });
});

describe("Formation Orders (march)", () => {
  it("canOrder needs an un-acted non-Hero unit of yours in the player phase", () => {
    const { g, u, idle } = vanguard();
    expect(g.canOrder()).toBe(true);
    u.acted = idle.acted = true;
    expect(g.canOrder()).toBe(false);
    u.acted = false;
    u.hero = true;
    idle.hero = true;
    expect(g.canOrder()).toBe(false);
  });
  it("beginMarch toggles the order mode; cancelOrder drops it", () => {
    const { g, u } = vanguard();
    g.select(u);
    g.beginMarch();
    expect(g.orderMode).toBe("march");
    expect(g.selected).toBe(null);
    g.beginMarch();
    expect(g.orderMode).toBe(null);
    g.beginMarch();
    g.cancelOrder();
    expect(g.orderMode).toBe(null);
    g.phase = "enemy";
    g.beginMarch();
    expect(g.orderMode).toBe(null);
  });
  it("a tap marches the whole un-acted line toward the point, nearest first, then each strikes the best foe in reach", () => {
    const { g, u, idle, far } = vanguard("swordsmen");
    // a foe right next to the swordsman's march target
    put(g, u, 4, 8);
    const foe = spawn(g, "militiamen", "red", 9, 8, { hp: 100 });
    g.beginMarch();
    g.click({ tx: 8, ty: 8 });
    expect(g.marchQueue[0]).toBe(u); // nearest first
    expect(g.marchTarget).toEqual({ tx: 8, ty: 8 });
    expect(g.canOrder()).toBe(false);
    const idleFrom = Math.abs(idle.tx - 8) + Math.abs(idle.ty - 8);
    for (let i = 0; i < 2000 && (g.marchQueue || g.anim); i++) step(g);
    expect(u.acted).toBe(true); // it marched and struck
    expect(foe.hp).toBeLessThan(100);
    expect(Math.abs(idle.tx - 8) + Math.abs(idle.ty - 8)).toBeLessThan(idleFrom); // the far unit closed in
    // NOTE (reported): a marcher with no foe in reach after its move is never marked acted (_marchAttack only
    // calls next()), so it may still be ordered again this turn and the turn does not end by itself.
    expect(idle.acted).toBe(false);
    expect(far.dead).toBe(false);
  });
  it("an empty squad does nothing; a unit that cannot advance strikes from where it stands", () => {
    const { g, u, idle } = vanguard("swordsmen");
    u.acted = idle.acted = true;
    g.groupMarch(3, 3);
    expect(g.marchQueue).toBeFalsy();
    u.acted = idle.acted = false;
    idle.dead = true;
    const foe = spawn(g, "militiamen", "red", u.tx + 1, u.ty, { hp: 100 });
    g.groupMarch(u.tx, u.ty); // already as close as it gets
    for (let i = 0; i < 400 && (g.marchQueue || g.anim); i++) step(g);
    expect(foe.hp).toBeLessThan(100);
    expect(u.acted).toBe(true);
  });
  it("a march strike on a foe that died meanwhile just ends the unit's action", () => {
    const { g, u } = vanguard("swordsmen");
    const foe = spawn(g, "militiamen", "red", u.tx + 1, u.ty, { hp: 100 });
    g._preStrike = (a, d, cont) => {
      kill(foe);
      cont();
      return true;
    };
    g._marchAttack(u, false);
    expect(u.acted).toBe(true);
    expect(g.marchDelay).toBe(0.14);
    expect(u.attackedTurn).toBe(true);
  });
  it("a braced pikeman lowers his Pike Wall when the march makes him strike", () => {
    const { g, u } = vanguard("pikemen");
    u.walled = true;
    spawn(g, "militiamen", "red", u.tx + 1, u.ty, { hp: 100 });
    g._marchAttack(u, false);
    expect(u.walled).toBe(false);
    expect(g.anim.type).toBe("attack");
    g.anim.done();
    expect(u.acted).toBe(true);
  });
});

describe("AOE aim (canAim / toggleAim / aimSkills / aimActive / aimSkill)", () => {
  it("a wizard lists its three spells; picking one arms aim and switches spell; picking it again disarms", () => {
    const { g, u } = vanguard("wizards");
    g.select(u);
    expect(g.canAim()).toBe(true);
    expect(g.aimSkills().map((s) => s.id)).toEqual(["fireball", "lightning", "ice"]);
    expect(g.aimActive()).toBe(null);
    g.aimSkill("lightning");
    expect(u.spell).toBe("lightning");
    expect(g.aimMode).toBe(true);
    expect(g.aimActive()).toBe("lightning");
    g.aimSkill("lightning");
    expect(g.aimMode).toBe(false);
    u.spell = undefined;
    g.aimMode = true;
    expect(g.aimActive()).toBe("fireball");
  });
  it("toggleAim / cancelAim", () => {
    const { g, u } = vanguard("catapult");
    g.toggleAim(); // nothing selected
    expect(!!g.aimMode).toBe(false);
    g.select(u);
    g.toggleAim();
    expect(g.aimMode).toBe(true);
    expect(g.aimActive()).toBe("aim");
    g.toggleAim();
    expect(g.aimMode).toBe(false);
    g.toggleAim();
    g._abilityAim = "build";
    g.cancelAim();
    expect(g.aimMode).toBe(false);
    expect(g._abilityAim).toBe(null);
  });
  it("the siege engines' aimed shots: Barrage (catapult), Piercing Bolt (ballistae), Arc (trebuchet)", () => {
    for (const [type, name] of [
      ["catapult", "Barrage"],
      ["ballistae", "Piercing Bolt"],
      ["trebuchet", "Arc"],
    ]) {
      const { g, u } = vanguard(type);
      g.select(u);
      const sk = g.aimSkills();
      expect(sk.length).toBe(1);
      expect(sk[0]).toMatchObject({ id: "aim", name });
      const [mn, mx] = g._castRange(u);
      expect([sk[0].min, sk[0].max]).toEqual([mn, mx]);
    }
  });
  it("the cannon has its point-blank Grapeshot (default) and its Low Arc cannonball; aimSkill switches between them", () => {
    const { g, u } = vanguard("cannon");
    g.select(u);
    const sk = g.aimSkills();
    expect(sk.map((s) => s.name)).toEqual(["Grapeshot", "Low Arc"]);
    g.aimSkill("grapeshot");
    expect(g.aimActive()).toBe("grapeshot");
    expect(g._aimingGrape(u)).toBe(true);
    g.aimSkill("aim");
    expect(g.aimActive()).toBe("aim");
    expect(g._aimingShot(u)).toBe(true);
    g.aimSkill("aim"); // the armed one again → disarm
    expect(g.aimMode).toBe(false);
  });
  it("no aim row for a unit that acted, an ally, or nothing selected; aimSkill is ignored then", () => {
    const { g, u } = vanguard("catapult");
    expect(g.aimSkills()).toBe(null);
    g.select(u);
    u.acted = true;
    expect(g.aimSkills()).toBe(null);
    g.aimSkill("aim");
    expect(!!g.aimMode).toBe(false);
    u.acted = false;
    const s = spawn(g, "swordsmen", "blue", 2, 2);
    g.select(s);
    expect(g.aimSkills()).toEqual(g._abilitySkills(s));
    g.aimMode = true;
    expect(g.aimActive()).toBe(null);
    g.aimSkill("zzz"); // not an aim this unit has
  });
  it("setRetribPreview flags the Retribution radius preview", () => {
    const { g } = vanguard();
    g.setRetribPreview(1);
    expect(g._retribPreview).toBe(true);
    g.setRetribPreview(0);
    expect(g._retribPreview).toBe(false);
  });
});

describe("end-of-turn unit upkeep", () => {
  it("Ice slow wears off at the end of the victim's turn; Pike Wall braces only without an attack", () => {
    const { g, u, idle } = vanguard("pikemen");
    u.slowed = true;
    u.attackedTurn = false;
    idle.slowed = true;
    g._endTurnSlow([u]);
    expect(u.slowed).toBe(false);
    expect(idle.slowed).toBe(true);
    g._endTurnBrace([u]);
    expect(u.walled).toBe(true);
    u.attackedTurn = true;
    g._endTurnBrace([u]);
    expect(u.walled).toBe(false);
  });
});

describe("Formation march through the frame loop", () => {
  it("the column marches one unit after another, then the board is free again", () => {
    const { g, u, idle } = vanguard("swordsmen");
    const d0 = [u, idle].map((x) => Math.abs(x.tx - 10) + Math.abs(x.ty - 10));
    g.groupMarch(10, 10);
    expect(g.marchQueue.length).toBe(2);
    expect(g._emit && g.canEndTurn).toBeUndefined();
    for (let i = 0; i < 2000 && (g.marchQueue || g.anim); i++) step(g);
    expect(g.marchQueue).toBe(null);
    expect(g.marchTarget).toBe(null);
    const d1 = [u, idle].map((x) => Math.abs(x.tx - 10) + Math.abs(x.ty - 10));
    expect(d1[0]).toBeLessThan(d0[0]);
    expect(d1[1]).toBeLessThan(d0[1]);
    expect(g.phase).toBe("player");
  });
});
