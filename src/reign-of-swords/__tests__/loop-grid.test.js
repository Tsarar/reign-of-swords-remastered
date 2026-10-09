// The frame loop (engine/loop.js: the RAF tick, the background tick, fast-forward, edge-scroll, stray-sprite snap, a
// structure shot, the hidden-foe stop) and grid rules (engine/grid.js: shooting structures, the pre-movement-table
// costs, the portal exit search, Spot).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put, settle, step } from "./battle.js";
import { UNIT_TYPES } from "../data/game-data.js";
import { LoopMethods } from "../engine/loop.js";
import { buildMissions } from "../data/missions.js";
import { patchFetch } from "./shell-helpers.js";

beforeAll(() => loadEpisode(1));

// the first structure tile on the map that `u` could shoot from somewhere
function structureTile(g) {
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (g.isStructure(x, y)) return [x, y];
  return null;
}
// a free open tile at manhattan distance `d` from (x,y) that `u` can stand on
function standAt(g, u, x, y, d) {
  for (let dy = -d; dy <= d; dy++) {
    const dx = d - Math.abs(dy);
    for (const sx of [dx, -dx]) {
      const X = x + sx,
        Y = y + dy;
      if (g.inBounds(X, Y) && !g.unitAt(X, Y) && !g.isStructure(X, Y) && g.moveCost(u, X, Y) < 99) return [X, Y];
    }
  }
  return null;
}
// a map (Episode I) with a structure on it
function structureMap() {
  for (const id of [5412, 5409, 5406, 5413, 5414, 5417]) {
    const g = makeGame(id);
    startBattle(g, "auto");
    if (structureTile(g)) return g;
  }
  throw new Error("no structure map");
}

describe("the frame loop", () => {
  it("_loop advances the battle by the frame time (capped at 50 ms, ×4 on fast-forward), renders and re-arms", () => {
    const g = makeGame(5412);
    startBattle(g);
    const update = vi.spyOn(g, "update"),
      render = vi.spyOn(g.renderer, "render").mockImplementation(() => {});
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 7);
    g._last = 1000;
    LoopMethods.prototype._loop.call(g, 1016);
    expect(update.mock.calls[0][0]).toBeCloseTo(0.016, 5);
    LoopMethods.prototype._loop.call(g, 2016); // a 1 s stall counts as 50 ms
    expect(update.mock.calls[1][0]).toBeCloseTo(0.05, 5);
    g.setFastForward(true);
    expect(g._fastScale()).toBe(4);
    LoopMethods.prototype._loop.call(g, 2026);
    expect(update.mock.calls[2][0]).toBeCloseTo(0.04, 5);
    expect(render).toHaveBeenCalledTimes(3);
    expect(g._raf).toBe(7);
    // super fast: ×12, the frame played in steps no larger than one fast frame's (0.2 s)
    g.setFastForward(2);
    expect(g._fastScale()).toBe(12);
    update.mockClear();
    LoopMethods.prototype._loop.call(g, 3026); // a stall: 50 ms × 12 = 0.6 s
    expect(update.mock.calls.map((c) => +c[0].toFixed(3))).toEqual([0.2, 0.2, 0.2]);
    expect(render).toHaveBeenCalledTimes(4); // still one picture per frame
    g.setFastForward(0);
    expect(g._fastScale()).toBe(1);
    raf.mockRestore();
  });

  it("deployment never runs fast; an audio bus without setFast is fine", () => {
    const id = [5401, 5402, 5403, 5404, 5405, 5406, 5407, 5408, 5409].find((m) => makeGame(m).phase === "deploy");
    const g = makeGame(id);
    g.audio = {};
    g.setFastForward(true);
    expect(g.phase).toBe("deploy");
    expect(g._fastScale()).toBe(1);
  });

  it("_tickBg covers the whole hidden-tab gap in ≤50 ms steps, capped at 3 s, and does nothing for no time", () => {
    const g = makeGame(5412);
    startBattle(g);
    const update = vi.spyOn(g, "update");
    const now = vi.spyOn(performance, "now");
    g._last = 0;
    now.mockReturnValue(0);
    g._tickBg();
    expect(update).not.toHaveBeenCalled();
    now.mockReturnValue(120);
    g._tickBg();
    expect(update.mock.calls.map((c) => +c[0].toFixed(3))).toEqual([0.05, 0.05, 0.02]);
    update.mockClear();
    now.mockReturnValue(120 + 60000);
    g._tickBg();
    expect(update.mock.calls.reduce((s, c) => s + c[0], 0)).toBeCloseTo(3, 5);
  });

  it("locking input drops a drag in progress", () => {
    const g = makeGame(5412);
    g._drag = { x: 1 };
    g.setInputLocked(true);
    expect(g._drag).toBeNull();
    g._drag = { x: 1 };
    g.setInputLocked(false);
    expect(g._drag).toEqual({ x: 1 });
  });

  it("edge-scroll pans a map larger than the view, and not one that fits", () => {
    const g = makeGame(5412);
    startBattle(g);
    g.view = { w: 100, h: 100 };
    g.world = { w: 2000, h: 2000 };
    g.cam = { x: 500, y: 500 };
    g.edge = { x: 1, y: -1 };
    g._drag = null;
    g.update(0.05);
    expect(g.cam.x).toBeGreaterThan(500);
    expect(g.cam.y).toBeLessThan(500);
    g.world = { w: 50, h: 50 };
    g.clampCam();
    const fit = { ...g.cam };
    g.edge = { x: 1, y: 1 };
    g.update(0.05);
    expect(g.cam).toEqual(fit);
  });

  it("on desktop the board frame hugs a map narrower than the column (no dark bands); a phone lets CSS size it", () => {
    const g = makeGame(5412);
    const stage = g.canvas.parentElement;
    const column = document.createElement("div");
    column.style.padding = "0 12px";
    Object.defineProperty(column, "clientWidth", { value: 955 });
    stage.style.border = "4px solid";
    document.body.appendChild(column);
    column.appendChild(stage);
    const width = window.innerWidth;
    try {
      window.innerWidth = 1280;
      g.resize();
      expect(g.tile).toBe(56); // 923px of room: the 56px cap, so a 16-column-or-narrower map comes up short
      expect(g.view.w).toBe(Math.min(923, g.cols * 56));
      expect(stage.style.width).toBe(g.view.w + 8 + "px"); // the frame wraps the board, borders included
      expect(stage.style.marginLeft).toBe("auto");
      window.innerWidth = 375; // a phone: the stage is laid out by CSS, the inline size goes
      g.resize();
      expect(stage.style.width).toBe("");
      expect(stage.style.marginLeft).toBe("");
    } finally {
      window.innerWidth = width;
      column.remove();
    }
  });

  it("lightning bolts expire; a sprite left off its tile snaps back when nothing animates", () => {
    const g = makeGame(5412);
    startBattle(g);
    g.bolts = [{ t: 0, life: 0.1 }];
    g.update(0.05);
    expect(g.bolts.length).toBe(1);
    g.update(0.1);
    expect(g.bolts.length).toBe(0);
    const u = g.units.find((x) => x.team === "blue");
    u.px += 13;
    settle(g);
    step(g, 2);
    expect(u.px).toBe(u.tx * g.tile);
  });

  it("a move stops on the tile next to a hidden foe it walks into", () => {
    const g = makeGame(5412);
    startBattle(g);
    const u = g.units.find((x) => x.team === "blue" && !x.ally && x.T.move >= 3 && !x.T.fly);
    const foe = g.units.find((x) => x.team === "red");
    only(g, u, foe, spawn(g, "footmen", "blue", 0, 0));
    const lane = [];
    for (let k = 1; k <= 3; k++) lane.push([u.tx + k, u.ty]);
    if (lane.some(([x, y]) => !g.inBounds(x, y) || g.moveCost(u, x, y) >= 99 || g.unitAt(x, y))) return; // map-specific
    put(g, foe, u.tx + 2, u.ty + 1);
    foe._hidden = true;
    foe.attackedTurn = false; // (a unit that struck this turn can't be hidden)
    const stop = vi.spyOn(g, "_hiddenFoeBeside");
    const a = {
      type: "move",
      u,
      path: [{ tx: u.tx, ty: u.ty }, ...lane.map(([tx, ty]) => ({ tx, ty }))],
      seg: 0,
      t: 0,
      speed: 6,
    };
    g.anim = a;
    g._animMove(a, 0.4);
    expect(stop).toHaveBeenCalled();
    expect(a.path.length).toBe(3); // cut at (x+2): the tile beside the hidden foe
  });
});

describe("shooting structures", () => {
  it("an archer's shot at a wall plays the firing animation and damages the structure when it lands", () => {
    const g = structureMap();
    const [sx, sy] = structureTile(g);
    const a = spawn(g, "archers", "blue", 0, 0);
    const at = standAt(g, a, sx, sy, 3);
    put(g, a, ...at);
    a.acted = false;
    expect(g.canHitStructure(a, sx, sy)).toBe(g._structDmgCol(a, 3, g.tileAt(sx, sy)) > 0);
    if (!g.canHitStructure(a, sx, sy)) return;
    const hp0 = g.structHp.get(sx + "," + sy) ?? 256;
    expect(g.damageStructure(a, sx, sy)).toBe(true);
    expect(g.anim.structure).toEqual({ tx: sx, ty: sy });
    settle(g);
    expect(g.structHp.get(sx + "," + sy)).toBeLessThan(hp0);
  });

  it("a footman's blow at a wall lands at once (no projectile); a catapult drops its whole blast there", () => {
    const g = structureMap();
    const [sx, sy] = structureTile(g);
    const f = spawn(g, "footmen", "blue", 0, 0);
    put(g, f, ...standAt(g, f, sx, sy, 1));
    if (g.canHitStructure(f, sx, sy)) {
      const hp0 = g.structHp.get(sx + "," + sy) ?? 256;
      g.damageStructure(f, sx, sy);
      settle(g);
      expect(g.structHp.get(sx + "," + sy)).toBeLessThan(hp0);
    }
    const c = spawn(g, "catapult", "blue", 0, 1);
    const [mn, mx] = g._castRange(c);
    put(g, c, ...standAt(g, c, sx, sy, mn));
    c.acted = false;
    const aoe = vi.spyOn(g, "_castGroundAoe");
    expect(g.damageStructure(c, sx, sy)).toBe(true);
    expect(aoe).toHaveBeenCalledWith(c, sx, sy);
    // out of the catapult's band: no
    put(g, c, ...standAt(g, c, sx, sy, mx + 1));
    expect(g.canHitStructure(c, sx, sy)).toBe(false);
    expect(g.damageStructure(c, sx, sy)).toBe(false);
  });
});

describe("movement costs without the original movement table", () => {
  it("fliers 1 anywhere, ground troops kept off impassable ground, cavalry and engines off what blocks them", async () => {
    const restore = patchFetch({ "movement.json": "fail" });
    try {
      await buildMissions("/games/reign-of-swords/");
      const g = makeGame(5412);
      const fly = spawn(g, "griffon", "blue", 0, 0),
        foot = spawn(g, "footmen", "blue", 1, 0),
        cav = spawn(g, "cavalry", "blue", 2, 0),
        eng = spawn(g, "catapult", "blue", 3, 0);
      let water = null,
        open = null;
      for (let y = 0; y < g.rows; y++)
        for (let x = 0; x < g.cols; x++) {
          const p = g.terrainAt(x, y);
          if (!p.passable && !water) water = [x, y];
          if (p.passable && !p.moveRow && !open) open = [x, y];
        }
      if (water) {
        expect(g.moveCost(fly, ...water)).toBe(1);
        expect(g.moveCost(foot, ...water)).toBe(99);
      }
      expect(g.moveCost(foot, ...open)).toBeGreaterThanOrEqual(1);
      expect(g.moveCost(foot, ...open)).toBeLessThan(99);
      // a class without `al` falls back by kind
      const odd = { T: { ...UNIT_TYPES.cavalry, al: undefined } };
      expect(g.moveCost(odd, ...open)).toBe(g.moveCost(cav, ...open));
      const oddFly = { T: { fly: true } },
        oddEng = { T: { kind: "siege" } },
        oddForm = { T: { formation: true } },
        oddFoot = { T: {} };
      expect(g.moveCost(oddFly, ...open)).toBe(1);
      expect(g.moveCost(oddEng, ...open)).toBe(g.moveCost(eng, ...open));
      expect(g.moveCost(oddForm, ...open)).toBeLessThan(99);
      expect(g.moveCost(oddFoot, ...open)).toBeLessThan(99);
      // a razed cell's own move row; a tile that blocks the mounted / engines
      vi.spyOn(g, "terrainAt").mockReturnValue({ passable: true, moveRow: [1, 2, 3, 99, 5] });
      expect(g.moveCost(cav, 1, 1)).toBe(99);
      expect(g.moveCost(foot, 1, 1)).toBe([1, 2, 3, 99, 5][foot.T.al]);
      g.terrainAt.mockReturnValue({ passable: true, blocksMounted: true, blocksEngine: true });
      expect(g.moveCost(cav, 1, 1)).toBe(99);
      expect(g.moveCost(eng, 1, 1)).toBe(99);
      g.terrainAt.mockReturnValue({ passable: true, category: "nope", movecost: 2 });
      expect(g.moveCost(foot, 1, 1)).toBe(2);
      g.terrainAt.mockReturnValue({ passable: true, category: "nope", movecost: 120 });
      expect(g.moveCost(foot, 1, 1)).toBe(99);
    } finally {
      restore();
      await buildMissions("/games/reign-of-swords/");
    }
  });
});

describe("portal exits and Spot", () => {
  it("the exit search skips cells off the map and occupied ones; a diagonal cell needs a walk back to the pad", () => {
    const g = makeGame(5412);
    startBattle(g);
    const u = spawn(g, "footmen", "blue", 5, 5);
    only(g, u);
    g.units.push(spawn(g, "footmen", "red", 1, 0), spawn(g, "footmen", "red", 0, 1));
    const out = g._portalOutput(u, { dx: 0, dy: 0 });
    // (0,-1) and (-1,0) are off the map, (1,0) and (0,1) taken → the diagonal (1,1), reachable on foot
    if (g.moveCost(u, 1, 1) < 99) expect(out).toEqual({ tx: 1, ty: 1 });
    expect(g._walkable(u, 1, 1, 0, 0)).toBe(g.moveCost(u, 1, 0) < 99 || g.moveCost(u, 0, 1) < 99);
  });

  it("a Spot unit reveals the hidden enemies within 4 tiles of it when its turn comes", () => {
    // (no Episode I unit carries Spot — ability 6 — so a scout is given it here)
    const g = makeGame(5412);
    startBattle(g);
    const s = spawn(g, "archers", "blue", 3, 3);
    s.T = { ...s.T, spot: true };
    const near = spawn(g, "archers", "red", 5, 4),
      far = spawn(g, "archers", "red", 12, 9);
    near._hidden = far._hidden = true;
    g._spotReveal(s);
    expect(near._hidden).toBeFalsy();
    expect(far._hidden).toBe(true);
    expect(() => g._spotReveal(null)).not.toThrow();
  });
});

describe("the last loop / grid branches", () => {
  it("a portal exit with every touching cell taken falls back to a cut-off diagonal cell", () => {
    const g = makeGame(5412);
    startBattle(g);
    const u = spawn(g, "footmen", "blue", 9, 9);
    vi.spyOn(g, "unitAt").mockImplementation((x, y) => (Math.abs(x - 5) + Math.abs(y - 5) === 1 ? { id: "x" } : null));
    vi.spyOn(g, "moveCost").mockReturnValue(1);
    vi.spyOn(g, "_walkable").mockReturnValue(false);
    const out = g._portalOutput(u, { dx: 5, dy: 5 });
    expect(Math.abs(out.tx - 5) + Math.abs(out.ty - 5)).toBeGreaterThan(1); // the last standable cell seen
  });

  it("no walk back to the pad when the ground around is impassable", () => {
    const g = makeGame(5412);
    const u = spawn(g, "footmen", "blue", 9, 9);
    vi.spyOn(g, "moveCost").mockReturnValue(99);
    expect(g._walkable(u, 3, 3, 1, 1)).toBe(false);
  });

  it("a melee blow at a wall (no projectile) lands at once with its melee sound", () => {
    const g = structureMap();
    const [sx, sy] = structureTile(g);
    const f = spawn(g, "footmen", "blue", 0, 0);
    put(g, f, ...standAt(g, f, sx, sy, 1));
    vi.spyOn(g, "canHitStructure").mockReturnValue(true);
    const hit = vi.spyOn(g, "structureHit");
    const play = vi.spyOn(g.audio, "play");
    g.damageStructure(f, sx, sy);
    settle(g);
    expect(hit).toHaveBeenCalledWith(f, sx, sy, 1, f.T.weapon); // the blow of the weapon it swings there
    expect(play).toHaveBeenCalled();
  });

  it("a cannon's point-blank shot plays the Grapeshot blast and rakes at once", () => {
    const g = makeGame(5412);
    startBattle(g);
    const c = spawn(g, "cannon", "blue", 5, 5);
    const foe = spawn(g, "footmen", "red", 5, 4);
    const play = vi.spyOn(g.audio, "play");
    const hp = foe.hp;
    g.doAttack(c, foe);
    settle(g);
    expect(play).toHaveBeenCalledWith("grapeshot", 0.55);
    expect(foe.hp < hp || foe.dead).toBe(true);
  });
});
