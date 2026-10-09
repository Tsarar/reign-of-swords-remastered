// Random play under invariant checks (invariants.test.js, sweep.test.js): the player's side makes random moves / taps /
// attacks / undos / holds / marches, with random input pressed while actions animate; the enemy runs its real AI. Every
// frame: no two living units on one tile, no sprite away from its tile unless that unit is the one animating, no unit
// stuck mid-teleport, no exception. `draw` renders a frame every that many steps (0 = never), with fake art.
import { makeGame, startBattle, step } from "./battle.js";
import { fakeAssets } from "./render-helpers.js";

export function fuzz(mapId, rounds, seed, { draw = 0, onIssue = null, onStep = null } = {}) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = makeGame(mapId);
  if (draw) g.assets = fakeAssets();
  let frame = 0;
  const issues = [];
  const offFor = new Map(),
    tpFor = new Map();
  const check = (ctx) => {
    if (onStep) onStep(g, ctx);
    const T = g.tile,
      occ = {};
    if (draw && ++frame % draw === 0) g.renderer.render();
    for (const u of g.units) {
      if (u.dead) continue;
      const k = u.tx + "," + u.ty;
      if (occ[k]) issues.push(`two units on ${k}: ${occ[k]} & ${u.type}${u.id} (${ctx})`);
      occ[k] = u.type + u.id;
      const own = g.anim && (g.anim.u === u || g.anim.target === u);
      const off = Math.abs(u.px - u.tx * T) > 0.5 || Math.abs(u.py - u.ty * T) > 0.5;
      offFor.set(u.id, !own && !u._teleporting && off ? (offFor.get(u.id) || 0) + 1 : 0);
      if (offFor.get(u.id) === 40) {
        issues.push(`${u.type}${u.id} drawn off its tile ${k} for 2s (${ctx})`);
        if (onIssue) onIssue(g, u, ctx);
      }
      tpFor.set(u.id, u._teleporting ? (tpFor.get(u.id) || 0) + 1 : 0);
      if (tpFor.get(u.id) === 120) issues.push(`${u.type}${u.id} stuck teleporting (${ctx})`);
    }
  };
  const chaos = () => {
    const r = rnd();
    if (r < 0.04) g.click({ tx: (rnd() * g.cols) | 0, ty: (rnd() * g.rows) | 0 });
    else if (r < 0.05) {
      g._playerTurnAt = -1e9;
      g.endTurn();
    } else if (r < 0.06) g.holdUnit();
    else if (r < 0.07) g.undoMove();
    else if (r < 0.08) g.selectNextUnit();
  };
  const run = (ctx, max = 3000, chaotic = true) => {
    for (let i = 0; i < max; i++) {
      step(g);
      check(ctx);
      if (chaotic && (g.anim || g._teleportLock || g.marchQueue)) chaos();
      if (!g.anim && !g.marchQueue && !g._teleportLock && !(g._delayed && g._delayed.length)) break;
    }
  };
  startBattle(g, "auto");
  for (let guard = 0; guard < 200 && g.turn <= rounds && g.phase !== "victory" && g.phase !== "defeat"; guard++) {
    for (let i = 0; i < 20000 && g.phase !== "player" && g.phase !== "victory" && g.phase !== "defeat"; i++) {
      step(g);
      check("ai turn");
    }
    if (g.phase !== "player") continue;
    if (rnd() < 0.3 && g.canOrder()) {
      g.beginMarch();
      const foes = g.units.filter((e) => !e.dead && e.team === "red");
      const t = foes.length ? foes[(rnd() * foes.length) | 0] : { tx: 0, ty: 0 };
      g.click({ tx: t.tx, ty: t.ty });
      run("march", 4000);
      if (g.orderMode) g.cancelOrder();
    }
    for (const u of g.units.filter((x) => !x.dead && x.team === "blue" && !x.ally)) {
      if (g.phase !== "player" || u.dead || u.acted) continue;
      g.select(u);
      if (g.selected !== u || !g.reach) continue;
      const foes = g.units.filter((e) => !e.dead && e.team === "red");
      if (rnd() < 0.5 && foes.length) {
        const e = foes[(rnd() * foes.length) | 0];
        g.click({ tx: e.tx, ty: e.ty });
        run("tap " + u.type + u.id);
      } else {
        const stops = [...g.reach.stops].map((k) => k.split(",").map(Number)).filter(([x, y]) => !g.unitAt(x, y));
        if (stops.length) {
          const [x, y] = stops[(rnd() * stops.length) | 0];
          g.click({ tx: x, ty: y });
          run("move " + u.type + u.id);
          if (g.selected === u && g.targets && g.targets.length) {
            const e = g.targets[(rnd() * g.targets.length) | 0];
            g.click({ tx: e.tx, ty: e.ty });
            run("attack " + u.type + u.id);
          } else if (rnd() < 0.3 && g.canUndo()) g.undoMove();
        }
      }
      if (g.selected === u && !u.acted) {
        g.holdUnit();
        run("hold", 600, false);
      }
    }
    if (g.phase === "player") {
      g._playerTurnAt = -1e9;
      g.endTurn();
    }
  }
  return { issues, turn: g.turn, phase: g.phase, blue: g.units.filter((u) => u.team === "blue").length };
}
