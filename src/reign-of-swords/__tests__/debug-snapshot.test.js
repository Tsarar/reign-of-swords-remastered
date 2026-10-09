// The 🐞 debug snapshot (engine/debug.js): what a dump records, and that debugLoad rebuilds the same position.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, nextRound, spawn, put, moveTo } from "./battle.js";

beforeAll(() => loadEpisode(2));

describe("debugDump", () => {
  it("records the map, turn, every unit and the script / group state", () => {
    const g = makeGame(5428);
    startBattle(g);
    nextRound(g);
    const d = g.debugDump();
    expect(d).toMatchObject({ v: 1, ep: 2, mapId: 5428, name: "Warning Caladrin", turn: 2, phase: "player" });
    expect(d.units.length).toBe(g.units.length);
    const u = g.units[0];
    expect(d.units[0]).toMatchObject({ id: u.id, type: u.type, team: u.team, at: [u.tx, u.ty], hp: Math.round(u.hp) });
    expect(d.tiles.length).toBe(g.cols * g.rows);
    expect(d.script.doneAct.length).toBeGreaterThan(0);
    expect(Object.keys(d.groups).length).toBeGreaterThan(0);
    expect(d.log.length).toBeGreaterThan(0);
    expect(typeof d.ua).toBe("string");
  });

  it("marks a sprite drawn off its tile, a teleporting unit, spells, walls, portals, group and AI aim", () => {
    const g = makeGame(5426);
    startBattle(g);
    const u = g.units.find((x) => x.team === "blue");
    u.px += g.tile * 0.6;
    u._teleporting = true;
    u.spell = "ice";
    u.walled = true;
    u._portalIdx = 2;
    u._glc = "red:1";
    u._dbgAim = { foe: ["x", 1, 1] };
    g.selected = u;
    const s = g.debugDump().units.find((x) => x.id === u.id);
    expect(s.drawn).toEqual([+(u.px / g.tile).toFixed(2), u.ty]);
    expect(s).toMatchObject({ teleporting: true, spell: "ice", walled: true, portal: 2, glc: "red:1" });
    expect(s.aim).toEqual({ foe: ["x", 1, 1] });
    expect(g.debugDump().selected).toBe(u.id);
    // a unit on its tile has no `drawn`
    expect(g.debugDump().units.find((x) => x.id !== u.id).drawn).toBeUndefined();
  });

  it("falls back to the page URL for the episode, and copes with no script / groups", () => {
    const g = makeGame(5410);
    startBattle(g, [["cavalry", 2, 11]]);
    g.mission = { ...g.mission, ep: undefined };
    g._sc = null;
    g._gl = null;
    g._dbgLog = null;
    g.structHp = null;
    g.tiles = null;
    const d = g.debugDump();
    expect(d.ep).toBe(location.pathname.includes("-2") ? 2 : 1);
    expect(d.script).toBeNull();
    expect(d.groups).toEqual({});
    expect(d.log).toEqual([]);
    expect(d.structHp).toEqual([]);
    expect(d.tiles).toBeNull();
  });
});

describe("debugLoad", () => {
  it("rebuilds a dumped position: positions, HP, state, structures, tiles, waves, script, log", () => {
    const g = makeGame(5428);
    startBattle(g);
    const u = g.units.find((x) => x.team === "blue" && !x.ally && x.type === "swordsmen");
    g.select(u);
    const to = [...g.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => !g.unitAt(x, y));
    moveTo(g, u, ...to);
    u.hp = 61;
    u.spell = "fireball";
    g.structHp.set("1,1", 40);
    const snap = JSON.stringify(g.debugDump());

    const h = makeGame(5428);
    startBattle(h);
    const n = h.debugLoad(snap);
    expect(n).toBe(JSON.parse(snap).units.filter((x) => !x.dead).length);
    const v = h.units.find((x) => x.id === u.id);
    expect([v.tx, v.ty]).toEqual(to);
    expect([v.px, v.py]).toEqual([to[0] * h.tile, to[1] * h.tile]);
    expect(v.hp).toBe(61);
    expect(v.spell).toBe("fireball");
    expect(v.acted).toBe(false);
    expect(h.structHp.get("1,1")).toBe(40);
    expect(h.phase).toBe("player");
    expect(h.turn).toBe(g.turn);
    expect(h.anim).toBeNull();
    expect(h.battleEvent).toBeNull();
    expect(h._sc.doneAct instanceof Set).toBe(true);
    expect(h._dbgLog.length).toBe(JSON.parse(snap).log.length);
  });

  it("creates units the snapshot has but the map does not, keeps ids unique, and drops units not in it", () => {
    const g = makeGame(5428);
    startBattle(g);
    const d = g.debugDump();
    d.units.push({ id: 999, type: "knights", team: "blue", ally: false, group: 1, hero: false, at: [1, 1], hp: 50 });
    d.units.push({ id: 998, type: "footmen", team: "red", at: [2, 2], hp: 10, dead: true }); // dead: skipped
    const dropped = d.units.shift();
    g.debugLoad(d);
    const k = g.units.find((x) => x.id === 999);
    expect(k).toMatchObject({ type: "knights", tx: 1, ty: 1, hp: 50 });
    expect(g.units.some((x) => x.id === 998)).toBe(false);
    expect(g.units.some((x) => x.id === dropped.id)).toBe(false);
    expect(g._nid).toBeGreaterThan(999);
  });

  it("ignores tiles of a different size and a missing script / log", () => {
    const g = makeGame(5428);
    startBattle(g);
    const tiles = g.tiles.slice();
    const d = { ...g.debugDump(), tiles: [1, 2, 3], script: null, log: null, firedWaves: null, structHp: null };
    g.debugLoad(d);
    expect(g.tiles).toEqual(tiles);
    expect(g._dbgLog).toEqual([]);
  });

  it("refuses a snapshot of another map, or none", () => {
    const g = makeGame(5428);
    startBattle(g);
    expect(() => g.debugLoad({ mapId: 5410, units: [] })).toThrow("load map 5410 first");
    expect(() => g.debugLoad(null)).toThrow("load map null first");
  });
});

describe("roll log", () => {
  it("_roll writes the console line and a 'roll' log entry", () => {
    const g = makeGame(5428);
    startBattle(g);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    g._roll("Test roll", { what: "x", roll: 1 });
    expect(info).toHaveBeenCalledWith("[ROS roll] T" + g.turn + " Test roll");
    expect(g._dbgLog[g._dbgLog.length - 1]).toMatchObject({ k: "roll", what: "x", roll: 1 });
    info.mockRestore();
  });

  it("the decision log is capped at its last 400 entries", () => {
    const g = makeGame(5428);
    startBattle(g);
    for (let i = 0; i < 450; i++) g._dbg("t", { i });
    expect(g._dbgLog.length).toBe(400);
    expect(g._dbgLog[399].i).toBe(449);
  });

  it("_dbgAim stores the AI's reasons on the unit (and ignores no unit)", () => {
    const g = makeGame(5428);
    startBattle(g);
    const u = spawn(g, "footmen", "red", 1, 1);
    g._dbgAim(u, { d: 3 });
    expect(u._dbgAim).toEqual({ d: 3 });
    expect(() => g._dbgAim(null, {})).not.toThrow();
    void put;
  });
});
