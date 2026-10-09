// Shared helpers for the rules-*.test.js files: a cleared board on a real map, open ground to stage a rule on, and a
// driver that runs the AI for exactly one unit through the engine's own aiStep (no other unit acts, no phase change).
import { makeGame, startBattle, step } from "./battle.js";
import { UNIT_TYPES } from "../data/game-data.js";

// A started battle on `mapId` with every unit taken off the field (a blank board for a rule test).
export function blank(mapId, deploy = []) {
  const g = makeGame(mapId);
  startBattle(g, deploy);
  g.units = [];
  g.anim = null;
  g.aiQueue = null;
  g.battleEvent = null;
  g.quicksand = new Map();
  g.selected = null;
  g.phase = "player";
  return g;
}

// A movement probe of a unit type (not on the field).
export const probe = (type, team = "red") => ({ type, team, T: UNIT_TYPES[type], tx: 0, ty: 0, group: 0, hp: 100 });

// Open ground: a w×h rectangle where every tile is plain (no cover, no heal, not a structure) and costs 1 to enter
// for a foot soldier, a rider and a war engine alike. Returns its top-left {x, y} or null.
export function openArea(g, w, h) {
  const P = ["footmen", "cavalry", "catapult"].map((t) => probe(t));
  const plain = (x, y) => {
    if (!g.inBounds(x, y)) return false;
    const t = g.terrainAt(x, y);
    if ((t.defBonus || 0) !== 0 || (t.heal || 0) > 0 || g.isStructure(x, y)) return false;
    if (g.portals && g.portals.some((p) => (p.sx === x && p.sy === y) || (p.dx === x && p.dy === y))) return false;
    return P.every((p) => g.moveCost(p, x, y) === 1);
  };
  for (let y = 0; y + h <= g.rows; y++)
    for (let x = 0; x + w <= g.cols; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++)
        for (let dx = 0; dx < w && ok; dx++) {
          if (!plain(x + dx, y + dy)) ok = false;
          // every step inside the rectangle must also be allowed (step links)
          else if (dx > 0 && g.moveCost(P[0], x + dx, y + dy, x + dx - 1, y + dy) !== 1) ok = false;
          else if (dy > 0 && g.moveCost(P[0], x + dx, y + dy, x + dx, y + dy - 1) !== 1) ok = false;
        }
      if (ok) return { x, y };
    }
  return null;
}

// A tile matching `pred(x, y)`, scanning rows top to bottom; null if none.
export function findTile(g, pred) {
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (pred(x, y)) return [x, y];
  return null;
}

// Two bystanders far from (cx, cy): an idle blue Hero (the turn never ends by itself, no "hero lost" defeat) and a red
// militiaman (no instant victory). Returns [hero, foe].
export function keepers(g, cx, cy) {
  const P = probe("footmen");
  const free = [];
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++)
      if (!g.unitAt(x, y) && g.moveCost(P, x, y) < 99) free.push([x, y, Math.abs(x - cx) + Math.abs(y - cy)]);
  free.sort((a, b) => b[2] - a[2]);
  const [h, f] = [free[0], free.find((t) => Math.abs(t[0] - free[0][0]) + Math.abs(t[1] - free[0][1]) > 6) || free[1]];
  const hero = g._makeUnit("king", "blue", h[0], h[1], true);
  const foe = g._makeUnit("militiamen", "red", f[0], f[1], false);
  return [hero, foe];
}

const busy = (g) => g.anim || g.marchQueue || g._teleportLock || (g._delayed && g._delayed.length);

// Run the AI for unit `u` alone (its side = u.team; a blue unit acts as an ALLY): one aiStep, then the frames until
// its action has played out. The queue is dropped right after the step so no other unit moves and the phase stays.
export function runAi(g, u, { max = 3000 } = {}) {
  const self = u.team;
  g._aiSelf = self;
  g._aiFoe = self === "red" ? "blue" : "red";
  g._aiAlly = self === "blue";
  g._aiPhase = self === "blue" ? "ally" : "enemy";
  g.phase = g._aiPhase;
  g._lastAiGroup = u.group || 0;
  g.aiQueue = [u];
  g.aiDelay = 0;
  g.anim = null;
  g.ai.aiStep();
  g.aiQueue = null;
  for (let i = 0; i < max && busy(g); i++) step(g);
  return g;
}

// Run frames until nothing animates.
export function drain(g, max = 3000) {
  for (let i = 0; i < max && busy(g); i++) step(g);
  return g;
}
