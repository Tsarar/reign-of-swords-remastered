// The scenario command VM (engine/script.js) on hand-written chains: MOVE (incl. a reach that can't be planned, and a
// unit that is gone), HIDE / SHOW, an unknown op, the Ep2 flag-gated counter triggers, a fallen escort that makes the
// delivery impossible, a counted tile trigger, and an escape's n-th-unit trigger.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, settle } from "./battle.js";

beforeAll(() => loadEpisode(1));

// a running battle whose script is replaced by `script`, with a fresh script state
function withScript(script, id = 5412) {
  const g = makeGame(id);
  startBattle(g);
  g.mission = { ...g.mission, missionType: script.missionType ?? 0, script: { triggers: [], goals: [], ...script } };
  Object.assign(g._sc, {
    doneAct: new Set(),
    firedTrig: new Set(),
    counters: {},
    flags: {},
    queue: [],
    spawned: new Set(),
  });
  return g;
}

describe("scenario.runInitial", () => {
  it("with no script it hands straight over", () => {
    const g = makeGame(5412);
    g.mission = { ...g.mission, script: null };
    const cb = vi.fn();
    g.scenario.runInitial(cb);
    expect(cb).toHaveBeenCalled();
  });
});

describe("MOVE", () => {
  it("walks the unit; a route that can't be planned walks it straight there; the chain continues after", () => {
    const g = withScript({
      actions: [
        { op: 3, a: [3, 3, 77], next: 1 },
        { op: 9, a: [5], next: -1 },
      ],
    });
    const u = spawn(g, "footmen", "red", 5, 5, { sid: 77 });
    vi.spyOn(g, "computeReach").mockImplementation(() => {
      throw new Error("no plan");
    });
    const mv = vi.spyOn(g, "moveUnit");
    g.scenario.exec(0);
    expect(mv.mock.calls[0][1]).toEqual([
      { tx: 5, ty: 5 },
      { tx: 3, ty: 3 },
    ]);
    settle(g);
    expect(g._sc.counters[5]).toBe(1); // the rest of the chain ran
    expect(u.acted).toBe(true);
  });

  it("a MOVE whose unit is gone is skipped", () => {
    const g = withScript({
      actions: [
        { op: 3, a: [3, 3, 99], next: 1 },
        { op: 9, a: [6], next: -1 },
      ],
    });
    g.scenario.exec(0);
    expect(g._sc.counters[6]).toBe(1);
  });
});

describe("HIDE / SHOW and unknown ops", () => {
  it("op 6 HIDES a scripted unit on its tile (setUnitHide(id, true)), op 4 reveals it; missing ones are ignored; unknown ops do nothing", () => {
    const g = withScript({
      actions: [
        { op: 6, a: [41], next: -1 },
        { op: 4, a: [41], next: -1 },
        { op: 4, a: [404], next: -1 },
        { op: 6, a: [404], next: -1 },
        { op: 42, a: [], next: -1 },
      ],
    });
    const u = spawn(g, "archers", "red", 6, 6, { sid: 41 });
    g.scenario.exec(0);
    expect(g.units.includes(u)).toBe(true); // still on the field…
    expect(g._isHidden(u)).toBe(true); // …but hidden, as a Stealth unit hides
    g.scenario.exec(1);
    expect(g._isHidden(u)).toBe(false);
    const n = g.units.length;
    g.scenario.exec(2);
    g.scenario.exec(3);
    g.scenario.exec(4);
    expect(g.units.length).toBe(n);
  });
});

describe("Ep2 flag-gated triggers", () => {
  it("[−1, −1, counter, value, cmd] fires once, at the next turn start after the counter reaches the value", () => {
    const g = withScript({
      actions: [
        { op: 9, a: [2], next: -1 },
        { op: 10, a: [7], next: -1 },
      ],
      triggers: [{ tag: 0, a: [-1, -1, 2, 2, 1] }],
    });
    g.scenario.exec(0);
    g.scenario.checkFlags();
    expect(g._sc.flags[0]).toBeUndefined();
    g.scenario.exec(0); // counter 2 → 2 …
    expect(g._sc.flags[0]).toBeUndefined(); // … but nothing mid-turn (Mission::getSequenceOnTurn runs at a turn start)
    g.scenario.checkFlags(true); // an AI army's turn start
    expect(g._sc.flags[0]).toBe(7);
    g._sc.flags[0] = 0;
    g.scenario.checkFlags(); // one-shot
    expect(g._sc.flags[0]).toBe(0);
  });

  it("a round trigger gated on a counter waits for it", () => {
    const g = withScript({
      actions: [{ op: 10, a: [3], next: -1 }],
      triggers: [{ tag: 0, a: [1, -1, 1, 1, 0] }], // round 1, counter 1 must be 1
    });
    g._sc.roundScript = new Set([0]);
    g.turn = 1;
    g.scenario.checkFlags();
    expect(g._sc.flags[0]).toBeUndefined();
    g._sc.counters[1] = 1;
    g.scenario.checkFlags();
    expect(g._sc.flags[0]).toBe(3);
  });
});

describe("escort and tile triggers", () => {
  it("an escorted unit falling so that too few can still arrive loses the battle", () => {
    const g = withScript({ actions: [], triggers: [] });
    const a = spawn(g, "footmen", "blue", 4, 4, { sid: 11 });
    Object.assign(g._sc, { escortLeft: [11, 12], delivered: 0, escortReq: 2 });
    a.dead = true;
    g.scenario.onDeath();
    expect(g.phase).toBe("defeat");
    expect(g.defeatReason).toBe("escort");
  });

  it("an Ep2 counted tile trigger fires only at its count, then bumps it", () => {
    const g = withScript({
      actions: [{ op: 10, a: [9], next: -1 }],
      triggers: [{ tag: 6, a: [4, 4, 3, 1, -1, 0] }],
    });
    g.mission.ep = 2;
    const u = spawn(g, "footmen", "blue", 4, 4);
    g._sc.counters[3] = 0;
    g.scenario.onTileReached(u);
    expect(g._sc.flags[0]).toBeUndefined();
    g._sc.counters[3] = 1;
    g.scenario.onTileReached(u);
    expect(g._sc.flags[0]).toBe(9);
    expect(g._sc.counters[3]).toBe(2);
  });

  it("an escape's tag-9 trigger runs when its n-th unit gets away", () => {
    const g = withScript({
      missionType: 3,
      goals: [[0, 0]],
      actions: [{ op: 10, a: [5], next: -1 }],
      triggers: [{ tag: 9, a: [1, 0, 0] }],
    });
    const u = spawn(g, "footmen", "blue", 0, 0);
    g.scenario.onTileReached(u);
    expect(g._sc.escaped).toBe(1);
    expect(g._sc.flags[0]).toBe(5);
  });
});
