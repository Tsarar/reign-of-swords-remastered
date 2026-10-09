// Deployment (engine/deploy.js): the muster taps — place from the budget, take back (refund), move the Hero, pick up /
// move / swap an issued unit, refusals — the elite cap, starting the battle, the deployment drill, and the
// enemy commander's scripted or fallback flight.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, step, settle, toPlayerTurn } from "./battle.js";

beforeAll(() => loadEpisode(1));

const zoneTiles = (g) => [...g.deployZone].map((k) => k.split(",").map(Number)).filter(([x, y]) => !g.unitAt(x, y));
// a deploy map, fresh, in its muster
function muster(id = 5408) {
  const g = makeGame(id);
  step(g, 5);
  if (g.battleEvent) g.eventClosed();
  expect(g.phase).toBe("deploy");
  return g;
}
const cheapest = (g) =>
  g._rosterOrder.filter((t) => !g.isElite(t)).sort((a, b) => g.deployCost(a) - g.deployCost(b))[0];

describe("the muster", () => {
  it("a tap with a unit chosen places it on a free zone tile; a tap outside the zone does nothing", () => {
    const g = muster();
    const t = cheapest(g);
    g.setPlacing(t);
    expect(g.placing).toBe(t);
    const [x, y] = zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y));
    g.click({ tx: x, ty: y });
    expect(g.unitAt(x, y)).toMatchObject({ type: t, team: "blue" });
    expect(g.deploySpent()).toBe(g.deployCost(t));
    // outside the zone
    let out = null;
    for (let yy = 0; yy < g.rows && !out; yy++)
      for (let xx = 0; xx < g.cols && !out; xx++)
        if (!g.deployZone.has(xx + "," + yy) && !g.unitAt(xx, yy)) out = [xx, yy];
    const n = g.units.length;
    g.click({ tx: out[0], ty: out[1] });
    expect(g.units.length).toBe(n);
    // choosing the same type again un-chooses it, and a tap then places nothing
    g.setPlacing(t);
    expect(g.placing).toBeNull();
    const [x2, y2] = zoneTiles(g)[0];
    g.click({ tx: x2, ty: y2 });
    expect(g.units.length).toBe(n);
  });

  it("a tap on a unit you placed takes it back and refunds it", () => {
    const g = muster();
    const t = cheapest(g);
    g.setPlacing(t);
    const [x, y] = zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y));
    g.click({ tx: x, ty: y });
    g.click({ tx: x, ty: y });
    expect(g.unitAt(x, y)).toBeFalsy();
    expect(g.deploySpent()).toBe(0);
  });

  it("a unit can't be mustered where it couldn't move: the tap is refused with a reason", () => {
    const g = muster();
    const engine = cheapest(g);
    const bad = zoneTiles(g)[0];
    vi.spyOn(g, "_canDeployAt").mockReturnValue(false);
    g.setPlacing(engine);
    g.click({ tx: bad[0], ty: bad[1] });
    expect(g.unitAt(...bad)).toBeFalsy();
    expect(g.notice.text).toMatch(/can't be deployed here/);
  });

  it("only the roster's units are affordable, within the budget and the elite slots (1 per 1000 points)", () => {
    const g = muster();
    expect(g.canAfford("ghost")).toBe(false);
    expect(g.maxElite()).toBe(Math.floor(g.deployBudget() / 1000));
    const elite = g._rosterOrder.find((t) => g.isElite(t));
    let placed = 0;
    for (const [x, y] of zoneTiles(g)) {
      if (!g.canAfford(elite)) break;
      if (!g._canDeployAt(elite, x, y)) continue;
      g.placeUnit(elite, x, y);
      placed++;
    }
    expect(placed).toBeLessThanOrEqual(g.maxElite());
    expect(g.eliteCount()).toBe(placed);
    g.godArmy = true;
    expect(g.deployBudget()).toBe(90000);
  });

  it("a type with an owned count can't be placed more times than you own it", () => {
    const g = makeGame(5408, { army: { footmen: 1 }, god: false });
    step(g, 5);
    if (g.battleEvent) g.eventClosed();
    expect(g.rosterCount("footmen")).toBe(1);
    const [a, b] = zoneTiles(g);
    g.placeUnit("footmen", ...a);
    expect(g.canAfford("footmen")).toBe(false);
    g.placeUnit("footmen", ...b);
    expect(g.placedCount("footmen")).toBe(1);
  });

  it("the Hero: a tap picks him up, a tap on a zone tile sets him down; ground he can't stand on is refused", () => {
    const g = muster();
    let h = g.units.find((u) => u.hero && u.team === "blue");
    if (!h) h = g._makeUnit("king", "blue", ...zoneTiles(g)[0], true); // (this map's muster has none: one joins)
    g.click({ tx: h.tx, ty: h.ty });
    expect(g.pickHero).toBe(true);
    const [x, y] = zoneTiles(g).find(([x, y]) => g._canDeployAt(h, x, y));
    g.click({ tx: x, ty: y });
    expect([h.tx, h.ty]).toEqual([x, y]);
    expect(g.pickHero).toBe(false);
    g.click({ tx: h.tx, ty: h.ty });
    vi.spyOn(g, "_canDeployAt").mockReturnValue(false);
    const [x2, y2] = zoneTiles(g)[0];
    g.click({ tx: x2, ty: y2 });
    expect([h.tx, h.ty]).toEqual([x, y]);
    expect(g.notice.text).toMatch(/can't be deployed here/);
  });

  it("issued units: a tap picks one up, a tap on a free zone tile moves it, a tap on another swaps them", () => {
    const g = muster();
    const t = cheapest(g);
    const [[x1, y1], [x2, y2], [x3, y3]] = zoneTiles(g).filter(([x, y]) => g._canDeployAt(t, x, y));
    g.placeUnit(t, x1, y1);
    g.placeUnit(t, x2, y2);
    const a = g.unitAt(x1, y1),
      b = g.unitAt(x2, y2);
    a.preset = b.preset = true; // as the record's issued force
    g.click({ tx: x1, ty: y1 });
    expect(g.pickUp).toBe(a);
    g.click({ tx: x1, ty: y1 }); // again: put back down
    expect(g.pickUp).toBeNull();
    g.click({ tx: x1, ty: y1 });
    g.click({ tx: x2, ty: y2 }); // swap
    expect([a.tx, a.ty, b.tx, b.ty]).toEqual([x2, y2, x1, y1]);
    g.click({ tx: a.tx, ty: a.ty });
    g.click({ tx: x3, ty: y3 }); // move to a free tile
    expect([a.tx, a.ty]).toEqual([x3, y3]);
    // refusals: neither may land where it can't stand
    const spy = vi.spyOn(g, "_canDeployAt").mockReturnValueOnce(false);
    g.click({ tx: a.tx, ty: a.ty });
    g.click({ tx: b.tx, ty: b.ty });
    expect([a.tx, a.ty]).toEqual([x3, y3]);
    spy.mockReturnValueOnce(true).mockReturnValueOnce(false);
    g.pickUp = a;
    g.click({ tx: b.tx, ty: b.ty });
    expect([a.tx, a.ty]).toEqual([x3, y3]);
    spy.mockReturnValueOnce(false);
    g.pickUp = a;
    const [x4, y4] = zoneTiles(g)[0];
    g.click({ tx: x4, ty: y4 });
    expect([a.tx, a.ty]).toEqual([x3, y3]);
  });

  it("a tap on an enemy during the muster does nothing", () => {
    const g = muster();
    const foe = g.units.find((u) => u.team === "red");
    g.setPlacing(cheapest(g));
    const n = g.units.length;
    g.click({ tx: foe.tx, ty: foe.ty });
    expect(g.units.length).toBe(n);
    expect(g.pickUp).toBeNull();
  });

  it("allied armies' units aren't yours to move", () => {
    const g = muster(5401);
    const ally = g.units.find((u) => u.team === "blue" && u.ally);
    g.click({ tx: ally.tx, ty: ally.ty });
    expect(g.pickUp).toBeNull();
    expect(g.units.includes(ally)).toBe(true);
  });

  it("the battle can't start with nobody mustered; then it does", () => {
    const g = muster();
    expect(g.canStartBattle()).toBe(false);
    g.startBattle();
    expect(g.phase).toBe("deploy");
    expect(g.notice.text).toMatch(/^ARMY SIZE TOO SMALL/);
    const t = cheapest(g);
    g.placeUnit(t, ...zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y)));
    expect(g.canStartBattle()).toBe(true);
    g.startBattle();
    expect(g.phase).not.toBe("deploy");
    toPlayerTurn(g); // the record's battle-start script plays, then the round-1 lines and the opening
    expect(g.phase).toBe("player");
  });
});

describe("repeat the last setup (GameScreen::saveRaidSetup / loadRaidSetup)", () => {
  it("the units you placed are kept and set down again at the next muster of the map", () => {
    const g = muster();
    const t = cheapest(g);
    const tiles = zoneTiles(g)
      .filter(([x, y]) => g._canDeployAt(t, x, y))
      .slice(0, 2);
    for (const [x, y] of tiles) g.placeUnit(t, x, y);
    const kept = g.deploySetup();
    expect(kept.units.map((u) => [u.type, u.tx, u.ty])).toEqual(tiles.map(([x, y]) => [t, x, y]));
    expect(kept.units.every((u) => !g.units.find((x) => x.tx === u.tx && x.ty === u.ty).preset)).toBe(true);
    const again = muster();
    expect(again.applySetup(kept)).toBe(0);
    for (const [x, y] of tiles) expect(again.unitAt(x, y) && again.unitAt(x, y).type).toBe(t);
    expect(again.notice).toBeFalsy();
  });

  it("a unit no longer in your army is left out, with the original's Missing Units warning", () => {
    const g = muster();
    const t = cheapest(g);
    const [x, y] = zoneTiles(g).find(([a, b]) => g._canDeployAt(t, a, b));
    const n = g.units.length;
    const left = g.applySetup({
      units: [
        { type: t, tx: x, ty: y },
        { type: "nosuchunit", tx: x, ty: y },
      ],
      hero: null,
    });
    expect(left).toBe(1);
    expect(g.units.length).toBe(n + 1);
    expect(g.notice.text).toMatch(/^WARNING: not all of the previously placed units exist in your army/);
  });
});

describe("the deployment drill (tutorial 5802)", () => {
  it("finishing the muster shows the commander's line, and the lesson completes when it is read", () => {
    const g = makeGame(5802);
    step(g, 5);
    if (g.battleEvent) g.eventClosed();
    const t = cheapest(g);
    g.placeUnit(t, ...zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y)));
    g.startBattle();
    const r1 = g.mission.events.filter((e) => e.round === 1);
    expect(g.battleEvent.lines[0].text).toBe(r1[r1.length - 1].text); // the last round-1 line
    expect(g._pendingDrillWin).toBe(true);
    g.eventClosed(); // the line read
    expect(g.phase).toBe("victory");
  });

  it("with no closing line to show, the drill completes at once", () => {
    const g = makeGame(5802);
    step(g, 5);
    if (g.battleEvent) g.eventClosed();
    g.mission = { ...g.mission, events: [] };
    const t = cheapest(g);
    g.placeUnit(t, ...zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y)));
    g.startBattle();
    expect(g.phase).toBe("victory");
  });
});

describe("the enemy commander's flight", () => {
  const scriptless = (id, extra) => {
    const g = muster(id);
    g.mission = { ...g.mission, script: null, ...extra };
    const t = cheapest(g);
    g.placeUnit(t, ...zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y)));
    return g;
  };

  it("a scripted move (op3) shows its line first, then he rides off the nearest edge and is gone", () => {
    const g = scriptless(5408);
    const boss = g.units.find((u) => u.team === "red");
    g.mission.scriptedMoves = [
      { from: [boss.tx, boss.ty], to: [boss.tx, boss.ty], flee: true, line: { speaker: "Boss", text: "Hold!" } },
    ];
    g.startBattle();
    expect(g.battleEvent.lines[0].text).toBe("Hold!");
    g.eventClosed();
    if (g._pendingScriptedMoves) g._pendingScriptedMoves();
    settle(g);
    expect(g.units.includes(boss)).toBe(false);
  });

  it("a scripted reposition without a line just moves him; a move whose unit is gone fires nothing", () => {
    const g = scriptless(5408);
    const boss = g.units.find((u) => u.team === "red");
    const to = [boss.tx, boss.ty];
    g.mission.scriptedMoves = [{ from: [boss.tx, boss.ty], to }];
    expect(g._fireScriptedMoves(() => {})).toBe(true);
    settle(g);
    expect(g.units.includes(boss)).toBe(true);
    g._firedMoves = new Set();
    g.mission.scriptedMoves = [{ from: [-5, -5], to }];
    expect(g._fireScriptedMoves(() => {})).toBe(false);
  });

  it("the fallback flight: the named commander gallops off the nearest edge and is removed", () => {
    const g = scriptless(5408, { scriptedMoves: null });
    const boss = g.units.find((u) => u.team === "red");
    g.mission.heroFlee = boss.type;
    const cb = vi.fn();
    expect(g._doHeroFlee(cb)).toBe(true);
    expect(boss._fleeing).toBe(true);
    settle(g);
    expect(g.units.includes(boss)).toBe(false);
    expect(cb).toHaveBeenCalled();
    // nobody of that type left → no flight
    g.units = g.units.filter((u) => !(u.team === "red" && u.type === boss.type));
    expect(g._doHeroFlee(cb)).toBe(false);
    g.mission.heroFlee = null;
    expect(g._doHeroFlee(cb)).toBe(false);
  });

  it("with no script and nobody to flee, the round-1 lines and the opening follow the muster at once", () => {
    const g = scriptless(5408, { scriptedMoves: null, heroFlee: null });
    const open = vi.spyOn(g, "_beginOpening");
    g.startBattle();
    expect(open).toHaveBeenCalled();
  });

  it("the flight starts the battle after him when no script runs", () => {
    const g = scriptless(5408, { scriptedMoves: null });
    g.mission.heroFlee = g.units.find((u) => u.team === "red").type;
    g.startBattle();
    toPlayerTurn(g);
    expect(["player", "victory", "defeat"]).toContain(g.phase);
  });

  it("each edge: off the right, the left, the bottom or the top — whichever is nearest", () => {
    const g = muster();
    const W = g.cols,
      H = g.rows;
    expect(g._fleeOffTile([W - 1, Math.floor(H / 2)])).toEqual([W + 1, Math.floor(H / 2)]);
    expect(g._fleeOffTile([0, Math.floor(H / 2)])).toEqual([-2, Math.floor(H / 2)]);
    expect(g._fleeOffTile([Math.floor(W / 2), H - 1])).toEqual([Math.floor(W / 2), H + 1]);
    expect(g._fleeOffTile([Math.floor(W / 2), 0])).toEqual([Math.floor(W / 2), -2]);
    // the fallback flight's own edge choice, all four ways
    for (const [x, y] of [
      [W - 1, Math.floor(H / 2)],
      [0, Math.floor(H / 2)],
      [Math.floor(W / 2), H - 1],
      [Math.floor(W / 2), 0],
    ]) {
      const h = muster();
      h.mission = { ...h.mission, script: null, scriptedMoves: null };
      const boss = h.units.find((u) => u.team === "red");
      boss.tx = x;
      boss.ty = y;
      h.mission.heroFlee = boss.type;
      const mv = vi.spyOn(h, "moveUnit");
      h._doHeroFlee(() => {});
      const dest = mv.mock.calls[0][1][1];
      expect(dest.tx < 0 || dest.ty < 0 || dest.tx >= W || dest.ty >= H).toBe(true);
    }
  });
});

describe("the muster's opening waits for the Previous Setup question", () => {
  // the first Episode II deploy map with an opening script
  const openingMap = () => {
    for (const id of [5404, 5405, 5406, 5407, 5408, 5409, 5410, 5411]) {
      const g = makeGame(id);
      step(g, 5);
      if (g.phase === "deploy" && g._deployOpen) return id;
    }
    throw new Error("no deploy map with an opening script found");
  };

  it("held while the screen asks; released, the opening plays over the muster", async () => {
    await loadEpisode(2);
    const id = openingMap();
    const g = makeGame(id);
    step(g, 5);
    const asked = [];
    g.musterHold = (mapId) => (asked.push(mapId), true);
    const run = vi.spyOn(g.scenario, "runInitial");
    g.openBattle();
    expect(asked).toEqual([id]);
    expect(run).not.toHaveBeenCalled();
    expect(g.battleEvent).toBeNull();
    expect(g._deployOpened).toBe(false);
    expect(g._musterHeld).toBe(true);
    g.releaseMuster();
    expect(run).toHaveBeenCalledTimes(1);
    expect(g._deployOpened).toBe(true);
    expect(g._musterHeld).toBe(false);
    g.releaseMuster(); // once only
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("not asked: the opening plays at once; never answered: Fight still plays it", async () => {
    await loadEpisode(2);
    const id = openingMap();
    const free = makeGame(id);
    step(free, 5);
    free.musterHold = () => false;
    const run = vi.spyOn(free.scenario, "runInitial");
    free.openBattle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(free._deployOpened).toBe(true);

    const g = makeGame(id);
    step(g, 5);
    g.musterHold = () => true;
    g.openBattle();
    const t = cheapest(g);
    g.placeUnit(t, ...zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y)));
    const run2 = vi.spyOn(g.scenario, "runInitial");
    g.startBattle();
    expect(run2).toHaveBeenCalledTimes(1);
    expect(g._musterHeld).toBe(false);
    expect(g.phase).not.toBe("deploy");
  });
});

describe("a deploy mission whose opening ran over the muster", () => {
  it("starting the battle skips the opening script it already played", async () => {
    await loadEpisode(2);
    const ids = [5404, 5405, 5406, 5407, 5408, 5409, 5410, 5411];
    for (const id of ids) {
      const g = makeGame(id);
      step(g, 5);
      if (g.phase !== "deploy" || !g.mission.script) continue;
      g.openBattle();
      if (!g._deployOpened) continue;
      toPlayerTurn(g);
      while (g.battleEvent) g.eventClosed();
      const t = cheapest(g);
      g.placeUnit(t, ...zoneTiles(g).find(([x, y]) => g._canDeployAt(t, x, y)));
      const run = vi.spyOn(g.scenario, "runInitial");
      g.startBattle();
      expect(run).not.toHaveBeenCalled();
      expect(g.phase).not.toBe("deploy");
      return;
    }
    throw new Error("no deploy map with an opening script found");
  });
});
