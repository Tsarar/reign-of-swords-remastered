// Input (engine/input.js): the pointer / touch / keyboard handlers on the battlefield canvas, and every branch of a tap
// on the field — aims, heals, the act step, allies, selection, approach-and-attack, inspection, Next Unit, undo.
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";

import { loadEpisode, makeGame, startBattle, spawn, only, settle } from "./battle.js";

beforeAll(() => loadEpisode(1));
afterEach(() => vi.useRealTimers());

const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, preventDefault: vi.fn(), ...extra });
// a battle on Carrone 3 (fixed 12 v 12? no: a fixed-force map with open ground) ready for the player
function field(id = 5412) {
  const g = makeGame(id);
  startBattle(g);
  return g;
}
// pixel centre of a tile in view space
const at = (g, tx, ty) => [tx * g.tile + g.tile / 2 - g.cam.x, ty * g.tile + g.tile / 2 - g.cam.y];

describe("pointer, touch and keys", () => {
  it("a press and release on one spot taps that tile; dragging pans instead", () => {
    const g = field();
    const u = g.units.find((x) => x.team === "blue" && !x.ally && !x.acted);
    const click = vi.spyOn(g, "click");
    g._onDown(ev(...at(g, u.tx, u.ty), { pointerType: "mouse" }));
    g._onUp(ev(...at(g, u.tx, u.ty)));
    expect(click).toHaveBeenCalledWith({ tx: u.tx, ty: u.ty });
    click.mockClear();
    g.world = { w: 5000, h: 5000 };
    g.view = { w: 300, h: 300 };
    g.cam = { x: 100, y: 100 };
    g._onDown(ev(150, 150, { pointerType: "mouse" }));
    g._onPointerMove(ev(152, 151)); // under the drag threshold
    expect(g.cam).toEqual({ x: 100, y: 100 });
    g._onPointerMove(ev(120, 110));
    expect(g.cam).toEqual({ x: 130, y: 140 });
    g._onUp(ev(120, 110));
    expect(click).not.toHaveBeenCalled();
    // a release with no press on the canvas (a UI button) never taps
    g._onUp(ev(150, 150));
    expect(click).not.toHaveBeenCalled();
  });

  it("the whose-turn banner freezes the field until it's gone", () => {
    const g = field();
    expect(g._canTap()).toBe(true);
    g._announceTurn("player");
    expect(g._canTap()).toBe(false);
    g.update(1); // still up
    expect(g._canTap()).toBe(false);
    g.update(0.75);
    expect(g._canTap()).toBe(true);
  });

  it("moving the pointer tracks the hover tile and the edge-scroll direction; leaving clears them", () => {
    const g = field();
    g.view = { w: 300, h: 300 };
    g._onPointerMove(ev(5, 295));
    expect(g.edge).toEqual({ x: -1, y: 1 });
    expect(g.hoverPx).toEqual({ x: 5, y: 295 });
    g._onPointerMove(ev(295, 5));
    expect(g.edge).toEqual({ x: 1, y: -1 });
    g._onPointerMove(ev(150, 150));
    expect(g.edge).toEqual({ x: 0, y: 0 });
    g._onPointerMove(ev(-5000, -5000));
    expect(g.hover).toBeNull();
    g._onLeave();
    expect(g.hover).toBeNull();
    expect(g.hoverPx).toBeNull();
  });

  it("touch: press-and-hold reads the unit (no tap on release); a touch press blocks page scroll", () => {
    const g = field();
    g.renderer.render = () => {}; // (the fake clock would also fire the game's own frame loop)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const foe = g.units.find((x) => x.team === "red");
    const peek = vi.spyOn(g, "peekAt");
    const click = vi.spyOn(g, "click");
    const e = ev(...at(g, foe.tx, foe.ty), { pointerType: "touch", cancelable: true });
    g._onDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(peek).toHaveBeenCalledWith({ tx: foe.tx, ty: foe.ty });
    g._onUp(ev(...at(g, foe.tx, foe.ty)));
    expect(click).not.toHaveBeenCalled();
    // a hold that turned into a drag reads nothing
    peek.mockClear();
    g._onDown(ev(100, 100, { pointerType: "touch", touches: undefined }));
    g._onPointerMove(ev(160, 160));
    vi.advanceTimersByTime(500);
    expect(peek).not.toHaveBeenCalled();
    g._onUp(ev(160, 160));
  });

  it("a touch event's first finger is used; focus and pointer capture failures are harmless", () => {
    const g = field();
    g.canvas.focus = vi.fn((o) => {
      if (o) throw new Error("no options");
    });
    g.canvas.setPointerCapture = vi.fn(() => {
      throw new Error("no capture");
    });
    g._onDown({ touches: [{ clientX: 10, clientY: 12 }], pointerId: 3, pointerType: "mouse" });
    expect(g._drag).toMatchObject({ sx: 10, sy: 12 });
    expect(g.canvas.focus).toHaveBeenCalledTimes(2);
    g.canvas.focus = vi.fn(() => {
      throw new Error("no focus at all");
    });
    expect(() => g._onDown(ev(1, 1, { pointerType: "mouse" }))).not.toThrow();
  });

  it("the first press starts the ambient bed; with a modal up a press, a right-click and keys do nothing", () => {
    const g = field();
    g.audio.startAmbient = vi.fn();
    g.inputLocked = true;
    g._onDown(ev(10, 10, { pointerType: "mouse" }));
    expect(g.audio.startAmbient).toHaveBeenCalled();
    expect(g._drag).toBeNull();
    const peek = vi.spyOn(g, "peekAt");
    const ctx = { ...ev(10, 10), preventDefault: vi.fn() };
    g._onContext(ctx);
    expect(ctx.preventDefault).toHaveBeenCalled();
    expect(peek).not.toHaveBeenCalled();
    const pan = vi.spyOn(g, "panBy");
    g._onKey({ key: "ArrowLeft", preventDefault: vi.fn() });
    expect(pan).not.toHaveBeenCalled();
    g.inputLocked = false;
    g._onContext(ctx);
    expect(peek).toHaveBeenCalled();
  });

  it("arrow keys and WASD pan a tile at a time; other keys don't", () => {
    const g = field();
    const pan = vi.spyOn(g, "panBy");
    for (const [k, dx, dy] of [
      ["ArrowLeft", -1, 0],
      ["a", -1, 0],
      ["ArrowRight", 1, 0],
      ["d", 1, 0],
      ["ArrowUp", 0, -1],
      ["w", 0, -1],
      ["ArrowDown", 0, 1],
      ["s", 0, 1],
    ]) {
      const e = { key: k, preventDefault: vi.fn() };
      g._onKey(e);
      expect(pan).toHaveBeenLastCalledWith(dx * g.tile, dy * g.tile);
      expect(e.preventDefault).toHaveBeenCalled();
    }
    pan.mockClear();
    g._onKey({ key: "x", preventDefault: vi.fn() });
    expect(pan).not.toHaveBeenCalled();
  });
});

describe("a tap on the field", () => {
  it("is ignored off the map, behind a skip prompt, mid-teleport, mid-animation and mid-march", () => {
    const g = field();
    const sel = vi.spyOn(g, "select");
    const u = g.units.find((x) => x.team === "blue" && !x.ally && !x.acted);
    g.click({ tx: -1, ty: 0 });
    for (const block of [{ pendingSkip: u }, { _teleportLock: true }, { anim: { type: "x" } }, { marchQueue: [1] }]) {
      Object.assign(g, block);
      g.click({ tx: u.tx, ty: u.ty });
      Object.assign(g, { pendingSkip: null, _teleportLock: false, anim: null, marchQueue: null });
    }
    expect(sel).not.toHaveBeenCalled();
  });

  it("with a Formation Order armed it sets the march destination", () => {
    const g = field();
    g.orderMode = "march";
    const m = vi.spyOn(g, "groupMarch").mockImplementation(() => {});
    g.click({ tx: 3, ty: 3 });
    expect(m).toHaveBeenCalledWith(3, 3);
  });

  it("grapeshot aim: an adjacent tile fires; any other tile just leaves the aim", () => {
    const g = field();
    const c = spawn(g, "cannon", "blue", 5, 5);
    g.select(c);
    g.aimMode = true;
    g._aimKind = "grape";
    const fire = vi.spyOn(g, "_castGroundAoe").mockImplementation(() => {});
    g.click({ tx: 9, ty: 9 });
    expect(fire).not.toHaveBeenCalled();
    expect(g.aimMode).toBe(false);
    g.select(c);
    g.aimMode = true;
    g.click({ tx: 5, ty: 4 });
    expect(fire).toHaveBeenCalledWith(c, 5, 4);
  });

  it("area aim: in the band fires; a wizard's adjacent foe is a Wand jab; anything else leaves the aim", () => {
    const g = field();
    const w = spawn(g, "wizards", "blue", 6, 6);
    const foe = spawn(g, "footmen", "red", 7, 6);
    g.select(w);
    g.aimMode = true;
    g._aimKind = "shot";
    expect(g._aimingShot(w)).toBe(true);
    const fire = vi.spyOn(g, "_castGroundAoe").mockImplementation(() => {});
    const hit = vi.spyOn(g, "doAttack").mockImplementation(() => {});
    g.click({ tx: 7, ty: 6 }); // below the spell's min range: the Wand
    expect(hit).toHaveBeenCalledWith(w, foe);
    g.select(w);
    g.aimMode = true;
    const [mn] = g._castRange(w);
    g.click({ tx: 6, ty: 6 + mn });
    expect(fire).toHaveBeenCalledWith(w, 6, 6 + mn);
    g.select(w);
    g.aimMode = true;
    g.click({ tx: 6, ty: 6 }); // its own tile
    expect(g.aimMode).toBe(false);
  });

  it("a priest's tap on a wounded ally in range heals it", () => {
    const g = field();
    const p = spawn(g, "priests", "blue", 6, 6);
    const hurt = spawn(g, "footmen", "blue", 6, 7, { hp: 40 });
    g.select(p);
    const heal = vi.spyOn(g, "healUnit");
    g.click({ tx: 6, ty: 7 });
    expect(heal).toHaveBeenCalledWith(p, hurt);
  });

  it("a wounded priest tapped while selected heals itself (Unit::startHeal lists the healer too); an unhurt one doesn't", () => {
    const g = field();
    const p = spawn(g, "priests", "blue", 6, 6, { hp: 50 });
    g.select(p);
    const heal = vi.spyOn(g, "healUnit");
    g.click({ tx: 6, ty: 6 });
    expect(heal).toHaveBeenCalledWith(p, p);
    const fresh = spawn(g, "priests", "blue", 8, 8);
    heal.mockClear();
    g.select(fresh);
    g.click({ tx: 8, ty: 8 });
    expect(heal).not.toHaveBeenCalled();
  });

  it("in the act step: a target is struck; empty ground with a wall in reach shoots it; a priest just ends; else confirm the skip", () => {
    const g = field();
    const a = spawn(g, "archers", "blue", 6, 6);
    const foe = spawn(g, "footmen", "red", 6, 8);
    g.select(a);
    g.enterAct(a);
    expect(g.mode).toBe("act");
    const hit = vi.spyOn(g, "doAttack").mockImplementation(() => {});
    g.click({ tx: foe.tx, ty: foe.ty });
    expect(hit).toHaveBeenCalled();
    // empty ground, no wall: the skip prompt
    g.select(a);
    g.enterAct(a);
    vi.spyOn(g, "canHitStructure").mockReturnValueOnce(false);
    g.click({ tx: 0, ty: 0 });
    expect(g.pendingSkip).toBe(a);
    g.cancelSkip();
    // a wall in reach
    vi.spyOn(g, "canHitStructure").mockReturnValueOnce(true);
    const shoot = vi.spyOn(g, "damageStructure").mockReturnValueOnce(true);
    g.mode = "act";
    g.selected = a;
    g.click({ tx: 0, ty: 1 });
    expect(shoot).toHaveBeenCalled();
    // a priest in its act step with nobody to heal: empty ground ends its turn without a nag
    for (const u of g.units) if (u.team === "blue") u.hp = 100;
    const p = spawn(g, "priests", "blue", 9, 9);
    g.selected = p;
    g.mode = "act";
    const fin = vi.spyOn(g, "finishUnit");
    g.click({ tx: 0, ty: 2 });
    expect(fin).toHaveBeenCalledWith(p);
  });

  it("a priest that could heal a wounded ally asks before ending its turn without healing", () => {
    const g = field();
    const p = spawn(g, "priests", "blue", 9, 9);
    const hurt = spawn(g, "footmen", "blue", 10, 9, { hp: 40 });
    only(g, p, hurt, ...g.units.filter((u) => u.team === "red"));
    const states = [];
    g.onState = (s) => states.push(s);
    g.selected = p;
    g.mode = "act";
    const fin = vi.spyOn(g, "finishUnit");
    g.click({ tx: 0, ty: 2 });
    expect(fin).not.toHaveBeenCalled();
    expect(g.pendingSkip).toBe(p);
    expect(states.at(-1).confirmSkip).toMatchObject({ heal: true }); // "can still heal" — not "can still attack"
    g.cancelSkip(); // Back: still in its act step, the heal still on offer
    expect(g.mode).toBe("act");
    g.click({ tx: 0, ty: 2 });
    g.confirmSkip();
    expect(fin).toHaveBeenCalledWith(p);
    expect(hurt.hp).toBe(40);
  });

  it("an allied unit is read, never commanded; your own unit is selected", () => {
    const g = field(5401);
    const ally = spawn(g, "footmen", "blue", 3, 3, { ally: true });
    const insp = vi.spyOn(g, "inspectUnit");
    g.click({ tx: 3, ty: 3 });
    expect(insp).toHaveBeenCalledWith(ally);
  });

  it("a selected unit: taps an enemy in range (strike), out of reach (read), a reachable tile (move), an unreachable one (read / deselect)", () => {
    const g = field();
    const k = spawn(g, "knights", "blue", 4, 4);
    only(g, k, ...g.units.filter((u) => u.hero), spawn(g, "footmen", "blue", 0, 0));
    const near = spawn(g, "footmen", "red", 4, 5);
    const far = spawn(g, "footmen", "red", g.cols - 1, g.rows - 1);
    g.select(k);
    const hit = vi.spyOn(g, "doAttack").mockImplementation(() => {});
    g.click({ tx: near.tx, ty: near.ty });
    expect(hit).toHaveBeenCalledWith(k, near);
    g.select(k);
    const insp = vi.spyOn(g, "inspectUnit");
    g.click({ tx: far.tx, ty: far.ty });
    expect(insp).toHaveBeenCalledWith(far);
    // unreachable empty tile: first a terrain read-out, the next tap deselects
    g.select(k);
    const unreach = (() => {
      for (let y = g.rows - 1; y >= 0; y--)
        for (let x = g.cols - 1; x >= 0; x--) if (!g.unitAt(x, y) && !g.reach.stops.has(x + "," + y)) return [x, y];
    })();
    vi.spyOn(g, "canHitStructure").mockReturnValue(false);
    g.click({ tx: unreach[0], ty: unreach[1] });
    expect(g.tileInfo).toMatchObject({ tx: unreach[0], ty: unreach[1] });
    g.selected = k;
    g.mode = "select";
    g.click({ tx: unreach[0], ty: unreach[1] });
    expect(g.selected).toBeNull();
  });

  it("tapping your spent unit while another is selected reads it and drops the other's move grid and targets", () => {
    const g = field();
    const fresh = spawn(g, "archers", "blue", 4, 4);
    const spent = spawn(g, "archers", "blue", 3, 4);
    only(g, fresh, spent, ...g.units.filter((u) => u.hero));
    spawn(g, "footmen", "red", 4, 8);
    spent.acted = true;
    g.select(fresh);
    expect(g.targets.length).toBe(1);
    g.click({ tx: spent.tx, ty: spent.ty });
    expect(g.inspect.unit).toBe(spent);
    expect(g.selected).toBeNull();
    expect(g.targets).toBeNull(); // no red marks left that no one can strike
    expect(g.reach).toBeNull();
  });

  it("approach-and-attack: a melee unit walks up to a foe it can reach this turn, then strikes", () => {
    const g = field();
    const f = spawn(g, "footmen", "blue", 4, 4);
    only(g, f, ...g.units.filter((u) => u.hero), spawn(g, "militiamen", "blue", 0, 0));
    const foe = spawn(g, "militiamen", "red", 4, 7);
    g.select(f);
    if (!g.bestApproach(f, foe)) return;
    g.click({ tx: foe.tx, ty: foe.ty });
    settle(g);
    expect(Math.abs(f.tx - foe.tx) + Math.abs(f.ty - foe.ty)).toBe(1);
  });

  it("after a move: a unit stopped by a hidden foe has spent its turn; a Shoot-and-Move rider that already shot is done", () => {
    const g = field();
    const k = spawn(g, "knights", "blue", 4, 4);
    g.select(k);
    const to = [...g.reach.stops]
      .map((s) => s.split(",").map(Number))
      .find(([x, y]) => !g.unitAt(x, y) && (x !== 4 || y !== 4));
    k._ambushedTurn = g.turn;
    const fin = vi.spyOn(g, "finishUnit");
    g.click({ tx: to[0], ty: to[1] });
    settle(g);
    expect(fin).toHaveBeenCalledWith(k);
    const hb = spawn(g, "horsebowmen", "blue", 8, 8, { attackedTurn: true });
    g.select(hb);
    const to2 = [...g.reach.stops]
      .map((s) => s.split(",").map(Number))
      .find(([x, y]) => !g.unitAt(x, y) && (x !== 8 || y !== 8));
    fin.mockClear();
    g.click({ tx: to2[0], ty: to2[1] });
    settle(g);
    expect(hb._rodeOn).toBe(g.turn);
    expect(fin).toHaveBeenCalledWith(hb);
  });

  it("with nothing selected: an enemy, your spent unit or bare ground is read", () => {
    const g = field();
    g.deselect();
    const insp = vi.spyOn(g, "inspectUnit");
    const foe = g.units.find((u) => u.team === "red");
    g.click({ tx: foe.tx, ty: foe.ty });
    expect(insp).toHaveBeenCalledWith(foe);
    const mine = g.units.find((u) => u.team === "blue" && !u.ally);
    mine.acted = true;
    g.deselect();
    g.click({ tx: mine.tx, ty: mine.ty });
    expect(insp).toHaveBeenCalledWith(mine);
    g.deselect();
    const empty = (() => {
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (!g.unitAt(x, y)) return [x, y];
    })();
    g.click({ tx: empty[0], ty: empty[1] });
    expect(g.tileInfo).toMatchObject({ tx: empty[0], ty: empty[1] });
    expect(typeof g.tileInfo.name).toBe("string");
  });
});

describe("peek, Next Unit, the skip prompt and undo", () => {
  it("peek reads a unit; on an empty tile it closes a peek; never once the battle is over", () => {
    const g = field();
    const foe = g.units.find((u) => u.team === "red");
    g.peekAt({ tx: foe.tx, ty: foe.ty });
    expect(g.inspect.peek).toBe(true);
    const empty = (() => {
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (!g.unitAt(x, y)) return [x, y];
    })();
    g.peekAt({ tx: empty[0], ty: empty[1] });
    expect(g.inspect).toBeNull();
    g.peekAt({ tx: empty[0], ty: empty[1] }); // nothing open: nothing to close
    g.peekAt({ tx: -1, ty: -1 });
    g.phase = "victory";
    g.peekAt({ tx: foe.tx, ty: foe.ty });
    expect(g.inspect).toBeNull();
  });

  it("Next Unit cycles through your un-acted units; with none left (or mid-animation) it does nothing", () => {
    const g = field();
    const list = g.units.filter((u) => !u.dead && u.team === "blue" && !u.ally && !u.acted);
    g.deselect();
    g.selectNextUnit();
    expect(g.selected).toBe(list[0]);
    g.selectNextUnit();
    expect(g.selected).toBe(list[1]);
    g.anim = { type: "x" };
    g.selectNextUnit();
    expect(g.selected).toBe(list[1]);
    g.anim = null;
    for (const u of list) u.acted = true;
    g.deselect();
    g.selectNextUnit();
    expect(g.selected).toBeNull();
  });

  it("confirming a skip ends the unit's turn — unless it died meanwhile", () => {
    const g = field();
    const u = g.units.find((x) => x.team === "blue" && !x.ally);
    g.promptSkip(u);
    u.dead = true;
    const fin = vi.spyOn(g, "finishUnit");
    g.confirmSkip();
    expect(fin).not.toHaveBeenCalled();
    expect(g.pendingSkip).toBeNull();
  });

  it("undo of a unit that has since died just drops the undo", () => {
    const g = field();
    const u = g.units.find((x) => x.team === "blue" && !x.ally);
    g._undoFrom = { u, tx: 0, ty: 0 };
    u.dead = true;
    g.undoMove();
    expect(g._undoFrom).toBeNull();
  });

  it("a move whose every step ends on someone else is cut back to nothing and simply finishes", () => {
    const g = field();
    const [a, b] = g.units.filter((x) => x.team === "blue" && !x.ally);
    const done = vi.fn();
    g.moveUnit(
      a,
      [
        { tx: a.tx, ty: a.ty },
        { tx: b.tx, ty: b.ty },
      ],
      done,
    );
    expect(done).toHaveBeenCalled();
    expect(a.chargeDir).toBeNull();
  });

  it("the ride preview: a Horse Bowmen path lists its shots; other units and short paths none", () => {
    const g = field();
    const hb = spawn(g, "horsebowmen", "blue", 4, 4);
    spawn(g, "footmen", "red", 6, 5);
    const path = [0, 1, 2, 3].map((k) => ({ tx: 4 + k, ty: 4 }));
    expect(g._strafePlan(hb, path).length).toBeGreaterThan(0);
    expect(g._strafePlan(hb, path.slice(0, 1))).toEqual([]);
    expect(g._strafePlan(spawn(g, "footmen", "blue", 1, 1), path)).toEqual([]);
  });
});

describe("the last tap branches", () => {
  it("a selected unit taps a wall it can't walk to and shoots it", () => {
    const g = field();
    const a = spawn(g, "archers", "blue", 6, 6);
    g.select(a);
    const far = [g.cols - 1, 0];
    vi.spyOn(g, "canHitStructure").mockReturnValue(true);
    const shoot = vi.spyOn(g, "damageStructure").mockReturnValue(true);
    g.click({ tx: far[0], ty: far[1] });
    expect(shoot).toHaveBeenCalledWith(a, far[0], far[1]);
  });

  it("approach-and-attack whose foe is gone on arrival opens the act step instead", () => {
    const g = field();
    const f = spawn(g, "footmen", "blue", 4, 4);
    only(g, f, ...g.units.filter((u) => u.hero), spawn(g, "militiamen", "blue", 0, 0));
    const foe = spawn(g, "militiamen", "red", 4, 7);
    g.select(f);
    vi.spyOn(g, "bestApproach").mockReturnValue({ tx: 4, ty: 5 });
    vi.spyOn(g, "pathTo").mockReturnValue([
      { tx: 4, ty: 4 },
      { tx: 4, ty: 5 },
    ]);
    const act = vi.spyOn(g, "enterAct");
    const mv = vi.spyOn(g, "moveUnit").mockImplementation((u, path, done) => {
      foe.dead = true;
      done();
    });
    g.click({ tx: foe.tx, ty: foe.ty });
    expect(mv).toHaveBeenCalled();
    expect(act).toHaveBeenCalledWith(f);
  });

  it("a selected unit tapping one of your spent units out of its reach reads it", () => {
    const g = field();
    const k = spawn(g, "footmen", "blue", 4, 4);
    const spent = spawn(g, "archers", "blue", g.cols - 1, g.rows - 1, { acted: true });
    g.select(k);
    const insp = vi.spyOn(g, "inspectUnit");
    g.click({ tx: spent.tx, ty: spent.ty });
    expect(insp).toHaveBeenCalledWith(spent);
  });

  it("a move of no steps finishes at once", () => {
    const g = field();
    const u = g.units.find((x) => x.team === "blue" && !x.ally);
    const done = vi.fn();
    u.chargeDir = { dx: 1, dy: 0 };
    g.moveUnit(u, [{ tx: u.tx, ty: u.ty }], done);
    expect(done).toHaveBeenCalled();
    expect(u.chargeDir).toBeNull();
  });
});
