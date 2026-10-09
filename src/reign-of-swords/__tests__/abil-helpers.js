// Shared setup for the abil-*.test.js files (Episode II player skills, deployment, debug snapshot): a clean board on a
// real map with only the units a test spawns, plus the two "keepers" every rule test needs — an idle player unit (a
// player whose every unit has acted ends the turn by itself) and a far enemy (no enemies left = instant victory).
import { makeGame, startBattle, spawn, only } from "./battle.js";

export const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// A started battle on `mapId` with every unit removed.
export function cleanBattle(mapId = 5428) {
  const g = makeGame(mapId);
  startBattle(g);
  only(g);
  g.selected = null;
  g.reach = null;
  g.targets = null;
  g.notice = null;
  return g;
}

// The first interior tile (x, y) for which `pred(x, y)` holds, scanning row by row.
export function findSpot(g, pred, { margin = 1 } = {}) {
  for (let y = margin; y < g.rows - margin; y++)
    for (let x = margin; x < g.cols - margin; x++) if (pred(x, y)) return [x, y];
  return null;
}

// A free tile a foot soldier can stand on.
export const standable = (g, x, y) => g.inBounds(x, y) && !g.unitAt(x, y) && g.terrainAt(x, y).passable;

// The idle blue keeper and the far red keeper, placed on free ground at least `far` tiles (Manhattan) from (cx, cy).
export function keepers(g, cx, cy, far = 12) {
  const spots = [];
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++)
      if (!g.unitAt(x, y) && g.terrainAt(x, y).passable && Math.abs(x - cx) + Math.abs(y - cy) >= far)
        spots.push([x, y]);
  spots.sort((a, b) => Math.abs(b[0] - cx) + Math.abs(b[1] - cy) - (Math.abs(a[0] - cx) + Math.abs(a[1] - cy)));
  const red = spawn(g, "footmen", "red", ...spots[0]);
  const rest = spots.filter(([x, y]) => Math.abs(x - spots[0][0]) + Math.abs(y - spots[0][1]) >= 4);
  const blue = spawn(g, "swordsmen", "blue", ...rest[0]);
  return { red, blue };
}
