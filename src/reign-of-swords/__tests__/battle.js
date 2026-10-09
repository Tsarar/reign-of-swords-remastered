// Battle harness for the engine tests: load an episode's real data, start any map, and drive the game frame by frame
// without rendering. Everything here goes through the engine's own methods (the same calls the UI makes).
import { Game, loadLevels, missionList } from "../engine/engine.js";

export const EP_BASE = { 1: "/games/reign-of-swords/", 2: "/games/reign-of-swords-2/" };

let loadedEp = null;
export async function loadEpisode(ep) {
  if (loadedEp === ep) return;
  await loadLevels(EP_BASE[ep]);
  loadedEp = ep;
}

// A Game on a detached canvas, its render loop stopped; `mapId` picks the battle.
export function makeGame(mapId, { army = null, god = true } = {}) {
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  const g = new Game(canvas, {}, () => {}, null, army, god);
  g._loop = () => {};
  const i = missionList().findIndex((m) => m.mapId === mapId);
  if (i < 0) throw new Error("map " + mapId + " is not in the loaded episode");
  g.selectMission(i);
  return g;
}

// One simulation frame (50 ms); dialogue beats are read (closed) at once unless `keepDialogue`.
export function step(g, n = 1, { keepDialogue = false } = {}) {
  for (let i = 0; i < n; i++) {
    if (!keepDialogue && g.battleEvent) g.eventClosed();
    if (g.pendingSkip) g.confirmSkip();
    g.update(0.05);
  }
}

const busy = (g) => g.anim || g.marchQueue || g._teleportLock || (g._delayed && g._delayed.length);

// Run until nothing is animating / waiting (an action finished).
export function settle(g, max = 2000) {
  for (let i = 0; i < max; i++) {
    step(g);
    if (!busy(g)) return g;
  }
  return g;
}

// Run the other sides' turns until it is really the player's move — no dialogue up or queued, no opening still waiting
// on one (an enemy-first map opens only once its opening lines are read), nothing animating — or the battle ends.
const playerReady = (g) =>
  g.phase === "player" &&
  !g.battleEvent &&
  !g._pendingEnemyOpen &&
  !g._pendingScriptedMoves &&
  !(g._sc && g._sc.queue && g._sc.queue.length) &&
  !(g.bannerHold > 0) && // the whose-turn banner freezes the field until it's gone
  !busy(g);
export function toPlayerTurn(g, max = 40000) {
  let calm = 0;
  for (let i = 0; i < max && calm < 3; i++) {
    if (g.phase === "victory" || g.phase === "defeat") break;
    step(g);
    calm = playerReady(g) ? calm + 1 : 0;
  }
  return g;
}

// Start the battle: deploy `units` ([type, x, y]) if the map has a deployment phase, else open the fixed forces.
export function startBattle(g, units = []) {
  step(g, 20);
  if (g.phase === "deploy") {
    if (units === "auto") units = autoArmy(g);
    for (const [t, x, y] of units) g.placeUnit(t, x, y);
    if (!g.units.some((u) => u.team === "blue" && !u.ally)) {
      const [x, y] = [...g.deployZone][0].split(",").map(Number);
      g.placeUnit(units[0] ? units[0][0] : "militiamen", x, y);
    }
    g.startBattle();
  } else if (g.openBattle) g.openBattle();
  return toPlayerTurn(g);
}

// A full army over the deployment zone: the roster's regular types in turn, tile by tile, while points last.
export function autoArmy(g) {
  const zone = [...(g.deployZone || [])]
    .map((k) => k.split(",").map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const types = (g._rosterOrder || []).filter((t) => g.rosterMap && g.rosterMap[t] && !g.rosterMap[t].elite);
  return zone
    .filter(([x, y]) => !g.unitAt(x, y)) // a tap on an occupied muster tile picks that unit up — never stacks
    .map(([x, y], i) => [types[i % types.length], x, y])
    .filter(([t]) => t);
}

// End the player's turn and run until it is the player's turn again.
export function nextRound(g) {
  g._playerTurnAt = -1e9; // skip the 900 ms anti-double-tap guard
  g.endTurn();
  return toPlayerTurn(g);
}

// Teleport a unit onto a tile (test setup), moving any unit already there out of the way.
export function put(g, u, x, y) {
  const o = g.unitAt(x, y);
  if (o && o !== u) {
    const free = findFree(g, o);
    o.tx = free[0];
    o.ty = free[1];
    o.px = free[0] * g.tile;
    o.py = free[1] * g.tile;
  }
  u.tx = x;
  u.ty = y;
  u.px = x * g.tile;
  u.py = y * g.tile;
  return u;
}
function findFree(g, u) {
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++) if (!g.unitAt(x, y) && g.moveCost(u, x, y) < 99) return [x, y];
  return [0, 0];
}

// A fresh unit of `type` for `team` on a tile (test setup).
export function spawn(g, type, team, x, y, extra = {}) {
  const o = g.unitAt(x, y);
  if (o) put(g, o, ...findFree(g, o));
  const u = g._makeUnit(type, team, x, y, type === "king");
  return Object.assign(u, extra);
}

// Remove every unit but the listed ones (a clean board for a rule test).
export function only(g, ...keep) {
  g.units = g.units.filter((u) => keep.includes(u));
}

// Player action helpers — the same calls a tap makes.
export function moveTo(g, u, x, y) {
  g.select(u);
  g.click({ tx: x, ty: y });
  return settle(g);
}
export function attack(g, u, target) {
  if (g.selected !== u) g.select(u);
  g.click({ tx: target.tx, ty: target.ty });
  return settle(g);
}

// A straight row of `len` open tiles (move cost 1 for `u`, nobody on them) — for charge / movement tests.
export function openLane(g, u, len) {
  for (let y = 1; y < g.rows - 1; y++)
    for (let x = 0; x + len < g.cols; x++) {
      let ok = true;
      for (let k = 0; k <= len && ok; k++) {
        const X = x + k,
          o = g.unitAt(X, y);
        if ((o && o !== u) || (k > 0 && g.moveCost(u, X, y, X - 1, y) !== 1)) ok = false;
      }
      if (ok) return { x, y };
    }
  return null;
}
