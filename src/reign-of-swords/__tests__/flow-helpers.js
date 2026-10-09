// Shared set-ups for the flow-* tests (turn flow, input, loop, engine). Built only on the battle harness.
import { makeGame, startBattle, spawn, only, put } from "./battle.js";

export const mine = (g, type) =>
  g.units.find((u) => !u.dead && u.team === "blue" && !u.ally && (!type || u.type === type));
export const reds = (g) => g.units.filter((u) => !u.dead && u.team === "red");

// The first free, walkable tile for `u` scanning rows from `y0` (left→right, or right→left with `rev`).
export function freeTile(g, u, { y0 = 0, rev = false, avoid = [] } = {}) {
  for (let dy = 0; dy < g.rows; dy++) {
    const y = (y0 + dy) % g.rows;
    for (let i = 0; i < g.cols; i++) {
      const x = rev ? g.cols - 1 - i : i;
      if (g.unitAt(x, y) || avoid.some(([ax, ay]) => ax === x && ay === y)) continue;
      if (g.moveCost(u, x, y) < 99 && g.terrainAt(x, y).passable) return [x, y];
    }
  }
  return null;
}

// A clean board on The Vanguard (Ep2 5410: the player's group 0 moves first, the enemy is group 1): one unit of
// `type` for the player, an idle blue unit (so the turn does not end by itself) and a far red unit (no instant
// victory). Returns the game and those units.
export function vanguard(type = "swordsmen", { mapId = 5410 } = {}) {
  const g = makeGame(mapId);
  startBattle(g, [["cavalry", 2, 11]]);
  const anchor = mine(g);
  only(g, anchor);
  const u = spawn(g, type, "blue", 8, 8);
  const idle = spawn(g, "militiamen", "blue", 0, g.rows - 1);
  put(g, idle, ...freeTile(g, idle, { y0: g.rows - 1 })); // on open ground, so it can march
  const far = spawn(g, "militiamen", "red", g.cols - 1, 0);
  const eg = (g.mission.groupOrder || []).find((x) => x.side === "enemy");
  if (eg) far.group = eg.gi; // the map's enemy army (its turn slot in the group cycle)
  only(g, u, idle, far);
  for (const x of g.units) {
    x.acted = false;
    x.hp = 100;
  }
  return { g, u, idle, far };
}

// Clear the board around (x, y) — every unit within `r` moves away (test setup on crowded maps).
export function clearAround(g, x, y, r, keep = []) {
  for (const o of g.units)
    if (!keep.includes(o) && Math.abs(o.tx - x) + Math.abs(o.ty - y) <= r) {
      const t = freeTile(g, o, { y0: (y + r + 2) % g.rows });
      if (t) put(g, o, ...t);
    }
}
