/* ============================================================
   Reign of Swords — the original's AI MOVEMENT layer (iOS Ep2), part of the AiController (ai/controller.js).

   Ported from the Episode II binary:
     • AStar (FindPath @0xd388, AddToOpen @0xcf58, CloseNode @0xcef4, GeneratePath @0xd104, FindClosestGoal @0xd1d6)
       driven by Map::calcShortestPath (@0x3b470) with the callbacks Map::AStarIsWalkable (@0x3eb94) and
       Map::AStarGetMoveCost (@0x3ea1e);
     • Unit::createMoveDestinations (@0x6e450) → Unit::checkLocation (@0x6967c): the ORDER of the reachable-tile list;
     • Unit::getClosestEnemy (@0x65ef8) / Unit::getDistance (@0x65da8, portal routing Unit+0x378 / +0x380);
     • getBestMoveLocation's movers: the Wizard mover (@0x7dbb2), the generic mover (@0x7dcfc: stages A–F below),
       findClosestMove (@0x7d558), Unit::canHide (@0x65fd8) and Unit::getClosestGoal (@0x66074).
   ============================================================ */
import { key, manhattan, FAR } from "../util/util.js";
import { tileType } from "../rules/terrain.js";

// AStar::FindClosestGoal candidate offsets (C.32–C.39, 19 each) — the tiles around the goal on the start's side.
const GOAL_OFFSETS = {
  32: [0, 0, -1, 1, 0, -1, 1, 0, -2, 2, -1, 1, -2, 2, 0, -1, 1, -2, 2],
  33: [0, -1, 0, 0, 1, -1, -1, -2, 0, 0, -2, -2, -1, -1, -3, -3, -3, -2, -2],
  34: [0, 1, 0, 0, -1, 1, 1, 2, 0, 0, 2, 2, 1, 1, 3, 3, 3, 2, 2],
  35: [0, 0, -1, 1, -1, -1, 1, 0, -2, 2, -1, 1, -2, 2, 0, -1, 1, -2, 2],
  36: [0, 0, -1, 1, 0, -1, 1, 0, -2, 2, -1, 1, -2, 2, 0, -1, 1, -2, 2],
  37: [0, 1, 0, 0, 0, 1, 1, 2, 0, 0, 2, 2, 1, 1, 3, 3, 3, 2, 2],
  38: [0, -1, 0, 0, 1, -1, -1, -2, 0, 0, -2, -2, -1, -1, -3, -3, -3, -2, -2],
  39: [0, 0, -1, 1, 1, -1, 1, 0, -2, 2, -1, 1, -2, 2, 0, -1, 1, -2, 2],
};
// The five tiles a Stealth / Ambush unit looks at around each path tile (the mover's stack tables @0x7df56).
const HIDE_OFFSETS = [
  [0, 0],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

export const AiMoveMethods = {
  // Map::AStarIsWalkable: in bounds; an enemy of the path unit on the tile blocks (Map+0x11d, always on); a step
  // costing more than 49 blocks; with `allBlock` (Map+0x11c) any unit on the tile blocks.
  _oWalkable(u, fx, fy, x, y, allBlock) {
    if (!this.game.inBounds(x, y)) return false;
    const occupant = this.game.unitAt(x, y);
    if (occupant && !occupant.dead && occupant !== u && occupant.team !== u.team) return false;
    if ((fx == null ? this.game.moveCost(u, x, y) : this.game.moveCost(u, x, y, fx, fy)) > 49) return false;
    if (allBlock && occupant && !occupant.dead && occupant !== u) return false;
    return true;
  },
  // AStar::FindClosestGoal: of 19 tiles around the goal (the table set by which way the goal lies from the start),
  // the walkable one (from the unit's own tile) with the least dist(goal) + dist(start)/2, ties to the one nearer the goal.
  _oFindClosestGoal(u, startX, startY, goalX, goalY, allBlock) {
    const dx = goalX - startX,
      dy = goalY - startY;
    const [offX, offY] =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? [GOAL_OFFSETS[38], GOAL_OFFSETS[39]]
          : [GOAL_OFFSETS[34], GOAL_OFFSETS[35]]
        : dy > 0
          ? [GOAL_OFFSETS[32], GOAL_OFFSETS[33]]
          : [GOAL_OFFSETS[36], GOAL_OFFSETS[37]];
    let bestIdx = -1,
      bestScore = 99,
      bestGoalDist = 99;
    for (let i = 0; i < 19; i++) {
      const x = goalX + offX[i],
        y = goalY + offY[i];
      if (!this._oWalkable(u, u.tx, u.ty, x, y, allBlock)) continue;
      const goalDist = Math.abs(x - goalX) + Math.abs(y - goalY),
        score = goalDist + Math.trunc((Math.abs(x - startX) + Math.abs(y - startY)) / 2);
      if (score < bestScore || (score === bestScore && goalDist < bestGoalDist)) {
        bestIdx = i;
        bestGoalDist = goalDist;
      }
      if (score <= bestScore) bestScore = score;
    }
    return bestIdx < 0 ? { tx: goalX, ty: goalY } : { tx: goalX + offX[bestIdx], ty: goalY + offY[bestIdx] };
  },
  // Map::calcShortestPath → AStar::FindPath. Best-first on f = g + h (h = Manhattan to the goal), a node never
  // re-opened, nodes with f above `limit` dropped, neighbours in the order x+1, x−1, y+1, y−1 when the goal is
  // farther across than down (else y+1, y−1, x+1, x−1). An unwalkable goal is first moved by FindClosestGoal. The
  // path runs to the goal or, if it is never reached, to the last node closed; a path longer than `limit` nodes is
  // dropped. Returns the unit's path list: its start tile, then the path. `store` keeps it as the unit's list.
  _oAstar(u, startX, startY, goalX, goalY, allBlock, limit, store) {
    if (!this._oWalkable(u, null, null, goalX, goalY, allBlock))
      ({ tx: goalX, ty: goalY } = this._oFindClosestGoal(u, startX, startY, goalX, goalY, allBlock));
    const open = [],
      closed = [];
    const inList = (nodeList, x, y) => nodeList.some((node) => node.x === x && node.y === y);
    let done = false;
    const addNode = (x, y, parentIdx) => {
      const parentNode = parentIdx >= 0 ? closed[parentIdx] : null;
      if (parentNode && !this._oWalkable(u, parentNode.x, parentNode.y, x, y, allBlock)) return false;
      if (inList(closed, x, y) || inList(open, x, y)) return false;
      const costSoFar = parentNode ? parentNode.g + this.game.moveCost(u, x, y, parentNode.x, parentNode.y) : 0,
        estimate = Math.abs(x - goalX) + Math.abs(y - goalY);
      if (costSoFar + estimate > limit) return false;
      open.push({ x, y, g: costSoFar, f: costSoFar + estimate, parent: parentIdx });
      if (open.length > 1999) return true;
      if (x === goalX && y === goalY) {
        closed.push(open.pop());
        return true;
      }
      return false;
    };
    addNode(startX, startY, -1);
    while (!done) {
      let bestIdx = -1,
        bestF = 255;
      for (let i = 0; i < open.length; i++)
        if (open[i].f < bestF) {
          bestF = open[i].f;
          bestIdx = i;
        }
      if (bestIdx < 0) break;
      const node = open.splice(bestIdx, 1)[0];
      closed.push(node);
      if (closed.length > 2999) break;
      const nodeIdx = closed.length - 1;
      const order =
        Math.abs(goalX - node.x) > Math.abs(goalY - node.y)
          ? [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]
          : [
              [0, 1],
              [0, -1],
              [1, 0],
              [-1, 0],
            ];
      for (const [stepX, stepY] of order) {
        const x = node.x + stepX,
          y = node.y + stepY;
        if (x < 0 || y < 0) continue;
        if (addNode(x, y, nodeIdx)) {
          done = true;
          break;
        }
      }
    }
    const list = [{ tx: startX, ty: startY }];
    if (closed.length) {
      const nodes = [];
      let node = closed[closed.length - 1];
      while (node && node.parent >= 0) {
        nodes.unshift({ tx: node.x, ty: node.y });
        node = closed[node.parent];
      }
      if (nodes.length && nodes.length <= limit) list.push(...nodes);
    }
    if (store) u._oPathList = list;
    return list;
  },
  // Unit::getDistance (direct): straight Manhattan (to a hidden foe's last-seen tile); for a unit that may use warp
  // portals (not Sappers/Bodyguards),
  // the cheaper of that and dist(unit → portal entry) + dist(portal exit → foe). Records the portal routing
  // (Unit+0x378 = the portal, +0x380 = that distance), or clears it.
  _oDistance(u, e) {
    if (this.game._isHidden(e) && e._lastSeen) e = e._lastSeen; // a hidden foe is measured from where it was last seen (Unit+0x13c)
    let dist = manhattan(u, e);
    u._portalIdx = -1;
    if (this.game.portals && this.game.portals.length && !u.T.summoned) {
      let best = 1000,
        bestPortal = -1;
      this.game.portals.forEach((portal, i) => {
        if (!this.game._portalUsable(portal, u)) return;
        const viaPortal =
          Math.abs(u.tx - portal.sx) +
          Math.abs(u.ty - portal.sy) +
          Math.abs(portal.dx - e.tx) +
          Math.abs(portal.dy - e.ty);
        if (viaPortal < best) {
          best = viaPortal;
          bestPortal = i;
        }
      });
      if (best < dist) {
        u._portalIdx = bestPortal;
        u._portalDist = best;
        dist = best;
      }
    }
    return dist;
  },
  // Unit::getClosestEnemy: every living enemy (Unit+0x250 = removed/dead) in unit-list order, by getDistance; a
  // HIDDEN one (Unit+0x251, set by setIsHidden) counts as 50 away — it is not ignored; a Trebuchet (or a Cannon past 2)
  // counts a Griffon or Great Eagle as 50 too. Nearest wins (first on a tie). The portal routing left on the unit is
  // the LAST enemy's (getDistance runs for every foe) — as in the original. (The third 50-rule reads GameScreen+0x2ac/
  // +0x2ad — the "AI plays the human side" mode — and never applies to the enemy AI.)
  _oClosestEnemy(u, foes) {
    let best = null,
      bestDist = 100;
    for (const e of this.game.units) {
      if (e.dead || !foes.includes(e)) continue;
      let dist = this._oDistance(u, e);
      if (this.game._isHidden(e)) dist = 50;
      if ((u.type === "trebuchet" || (u.type === "cannon" && dist > 2)) && e.T.fly) dist = 50;
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    if (best && !this.game._isHidden(best)) {
      const reachable = this._oReachableFoe(u, best, foes);
      if (reachable) return reachable;
    }
    return best ? { e: best, d: bestDist } : null;
  },
  // DELIBERATE DEVIATION from the original (user-approved): getClosestEnemy measures straight-line, so a melee unit
  // next to an impassable wall picks a foe on the far side and stands pinned to the wall (The Wizard's Palace
  // footmen). When a melee walker can't WALK to that foe, it takes the foe nearest by real travel (portals
  // included) instead, routed through the portal its walk needs. Ranged units (they can shoot over a wall) and
  // wizards (they don't walk paths) keep the original rule; so does everyone whose nearest foe is reachable.
  _oReachableFoe(u, best, foes) {
    if ((u.T.range || 1) > 1 || u.T.teleport) return null;
    const costBeside = (field, e) => {
      let least = field.get(key(e.tx, e.ty));
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cost = field.get(key(e.tx + dx, e.ty + dy));
        if (cost != null && (least == null || cost < least)) least = cost;
      }
      return least;
    };
    const walk = this.game.pathField(u, u.tx, u.ty, false, false);
    if (costBeside(walk, best) != null) return null; // walkable: the original's choice stands
    const full = this.game.pathField(u, u.tx, u.ty);
    let pick = null,
      pickCost = Infinity;
    for (const e of foes) {
      if (e.dead || this.game._isHidden(e)) continue;
      const cost = costBeside(full, e);
      if (cost != null && cost < pickCost) {
        pickCost = cost;
        pick = e;
      }
    }
    if (!pick) return null; // nothing reachable at all: original rule
    u._portalIdx = -1;
    if (costBeside(walk, pick) == null && this.game.portals) {
      // the walk needs a portal: aim for its entry pad
      let bestRoute = Infinity;
      this.game.portals.forEach((portal, i) => {
        if (!this.game._portalUsable(portal, u)) return;
        const toPad = walk.get(key(portal.sx, portal.sy));
        if (toPad == null) return;
        const fromExit = costBeside(this.game.pathField(u, portal.dx, portal.dy, false, false), pick);
        if (fromExit == null) return;
        if (toPad + fromExit < bestRoute) {
          bestRoute = toPad + fromExit;
          u._portalIdx = i;
          u._portalDist =
            manhattan(u, { tx: portal.sx, ty: portal.sy }) + manhattan({ tx: portal.dx, ty: portal.dy }, pick);
        }
      });
    }
    return { e: pick, d: u._portalIdx >= 0 ? u._portalDist : manhattan(u, pick) };
  },
  // Unit::createMoveDestinations — the reachable tiles in the ORIGINAL's list order. A Wizard (type 21) lists every
  // empty tile within its move (rows top to bottom, left to right) whose own cost fits the move. Others:
  // checkLocation's depth-first flood from the unit's tile — neighbours x+1, x−1, y+1, y−1 — listing each tile on its
  // first visit (the unit's own tile first); a tile is walked again only with more move left; enemies block; a tile
  // held by a friend is walked through but not listed. Kept to the tiles our movement also reaches.
  _oMoveOrder(u, stops) {
    const moveBudget = this.game.moveOf(u),
      order = [];
    if (u.T.teleport) {
      for (let dy = -moveBudget; dy <= moveBudget; dy++)
        for (let dx = -moveBudget; dx <= moveBudget; dx++) {
          const x = u.tx + dx,
            y = u.ty + dy;
          if (Math.abs(dx) + Math.abs(dy) > moveBudget || !this.game.inBounds(x, y) || this.game.unitAt(x, y)) continue;
          if (this.game.moveCost(u, x, y) <= moveBudget && stops.has(key(x, y))) order.push(key(x, y));
        }
      return order;
    }
    const best = new Map(),
      friendBest = new Map(),
      listed = new Set();
    const leashed = !!u.T.summoned;
    const visit = (x, y, left) => {
      if (left < 0 || !this.game.inBounds(x, y)) return;
      const occupant = this.game.unitAt(x, y),
        k = key(x, y);
      if (occupant && !occupant.dead && occupant !== u && occupant.team !== u.team) return;
      const friend = !!(occupant && !occupant.dead && occupant !== u);
      if (friend) {
        const friendBestLeft = friendBest.get(k);
        if (friendBestLeft !== undefined && left <= friendBestLeft) return;
        friendBest.set(k, left);
      } else if (!(leashed && tileType(this.game.tileAt(x, y)) === 24)) {
        const bestLeft = best.get(k);
        if (bestLeft !== undefined && left <= bestLeft) return;
        best.set(k, left);
        if (!listed.has(k)) {
          listed.add(k);
          order.push(k);
        }
      }
      if (left < 1) return;
      if (this.game._quicksandAt(x, y) > 0 && !this.game._quicksandImmune(u) && !(x === u.tx && y === u.ty)) return; // quicksand stops a mover (as computeReach)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (!this.game.inBounds(nx, ny)) continue;
        const stepCost = this.game.moveCost(u, nx, ny, x, y);
        if (stepCost >= 99) continue;
        visit(nx, ny, left - stepCost);
      }
    };
    visit(u.tx, u.ty, moveBudget);
    return order.filter((k) => stops.has(k));
  },
  // Unit::findClosestMove: the listed tile nearest in a straight line to `p`, only if strictly nearer than where the
  // unit stands and not terrain type 24.
  _oFindClosestMove(u, target, order) {
    let best = { tx: u.tx, ty: u.ty },
      bestDist = manhattan(u, target);
    for (const k of order) {
      const [x, y] = k.split(",").map(Number),
        dist = Math.abs(x - target.tx) + Math.abs(y - target.ty);
      if (dist < bestDist && tileType(this.game.tileAt(x, y)) !== 24) {
        bestDist = dist;
        best = { tx: x, ty: y };
      }
    }
    return best;
  },
  // Unit::canHide: the unit's OWN tile gives cover (tile defence ≤ 90) and no living enemy (hidden or not) is next to it.
  _oCanHide(u) {
    const tileDamagePct = Math.round(100 - (this.game.terrainAt(u.tx, u.ty).defBonus || 0) * 100);
    if (tileDamagePct > 90) return false;
    return !this.game.units.some((o) => !o.dead && o.team !== u.team && manhattan(o, u) === 1);
  },
  // Unit::getClosestGoal: the capture-zone tile nearest in a straight line.
  _oClosestGoal(u) {
    let goal = null,
      goalDist = FAR;
    for (const obj of this.game.objectives || []) {
      const dist = manhattan(obj, u);
      if (dist < goalDist) {
        goalDist = dist;
        goal = { tx: obj.tx, ty: obj.ty };
      }
    }
    return goal;
  },
  // The Wizard mover (@0x7dbb2): the listed tile nearest in a straight line to the destination, if strictly nearer.
  _oWizardMove(u, dest, reach, order) {
    let best = { tx: u.tx, ty: u.ty },
      bestDist = manhattan(u, dest);
    for (const k of order) {
      const [x, y] = k.split(",").map(Number);
      const dist = Math.abs(x - dest.tx) + Math.abs(y - dest.ty);
      if (dist < bestDist) {
        bestDist = dist;
        best = { tx: x, ty: y };
      }
    }
    return this._aiOpportunity(u, best, reach, false);
  },
  // The generic mover (@0x7dcfc), toward `dest` (the group order, the closest foe / its portal, or a goal):
  //  A. a destination held by another unit is moved by FindClosestGoal (every unit blocking);
  //  B. a destination the unit can reach is taken;
  //  C/D. else a path (limit two moves; enemies block) is walked while the move lasts and the last free tile on it
  //     taken — a Stealth / Ambush unit that can hide looks at the five tiles around each path tile and takes a free
  //     one in reach, and after that a later path tile only when it is more than 1 nearer the closest foe;
  //  E. else a path with every unit blocking is walked; its end is taken if it is nearer the destination than now;
  //  F. else (a far destination — the path search is capped at twice the move — or nothing better): the listed
  //     tiles are scanned for one nearer the destination (_oScanToward).
  // Every stage ends with checkOpportunityMove (not ranged). Stages C–F also pass the travel check (_oTravelJudge).
  _oGenericMove(u, dest, reach, stops, order, foe, foeDist) {
    const moveBudget = this.game.moveOf(u),
      withOpportunity = (s) => this._aiOpportunity(u, s, reach, false);
    const occupant = this.game.unitAt(dest.tx, dest.ty);
    if (occupant && !occupant.dead && occupant !== u)
      dest = this._oFindClosestGoal(u, u.tx, u.ty, dest.tx, dest.ty, true); // A
    if (order.includes(key(dest.tx, dest.ty))) return withOpportunity(dest); // B
    const walk = { stops, foe, moveBudget, leashed: !!(u.T.conjure || u.T.summoned) };
    const travel = this._oTravelJudge(u, dest, order);
    const pathFoesBlock = this._oAstar(u, u.tx, u.ty, dest.tx, dest.ty, false, 2 * moveBudget, true);
    const pickFoesBlock = this._oWalkPath(u, pathFoesBlock, false, walk); // C/D
    if (pickFoesBlock && travel.gains(pickFoesBlock)) return withOpportunity(pickFoesBlock);
    const pathAllBlock = this._oAstar(u, u.tx, u.ty, dest.tx, dest.ty, true, 2 * moveBudget, true);
    const pickAllBlock = this._oWalkPath(u, pathAllBlock, true, walk); // E
    if (
      pickAllBlock &&
      stops.has(key(pickAllBlock.tx, pickAllBlock.ty)) &&
      manhattan(pickAllBlock, dest) < manhattan(u, dest) &&
      travel.gains(pickAllBlock)
    )
      return withOpportunity(pickAllBlock);
    let best = this._oScanToward(u, dest, order, foeDist); // F
    if (!travel.gains(best)) best = travel.fallback() || best;
    return withOpportunity(best);
  },
  // Walk `path` while the move lasts (a leashed unit only over tiles it may stop on) and pick the last free tile —
  // or, with `allBlock` (every unit blocking), the last tile reached. A Stealth / Ambush unit that can hide (enemies
  // block, a foe known) looks at the five tiles around each path tile (HIDE_OFFSETS) for a free one in reach, and
  // after that takes a later path tile only when it is more than 1 nearer the foe.
  _oWalkPath(u, path, allBlock, { stops, foe, moveBudget, leashed }) {
    let cost = 0,
      pick = null,
      hideD = 0,
      hidHere = false;
    const stealth = !allBlock && foe && (u.T.stealth || u.ambush);
    const canHide = stealth && this._oCanHide(u);
    for (let i = 1; i < path.length; i++) {
      const tile = path[i];
      if (leashed && !stops.has(key(tile.tx, tile.ty))) break;
      cost += this.game.moveCost(u, tile.tx, tile.ty, path[i - 1].tx, path[i - 1].ty);
      if (cost > moveBudget) break;
      if (allBlock) {
        pick = tile;
        continue;
      }
      hidHere = false;
      if (stealth)
        for (let j = 0; j < 5; j++) {
          const cover = { tx: tile.tx + HIDE_OFFSETS[j][0], ty: tile.ty + HIDE_OFFSETS[j][1] };
          if (!this.game.inBounds(cover.tx, cover.ty)) continue;
          const coverCost = j === 0 ? cost : cost + this.game.moveCost(u, cover.tx, cover.ty, tile.tx, tile.ty);
          if (
            canHide &&
            coverCost <= moveBudget &&
            !this.game.unitAt(cover.tx, cover.ty) &&
            stops.has(key(cover.tx, cover.ty))
          ) {
            pick = cover;
            hideD = manhattan(cover, foe);
            hidHere = true;
          }
        }
      if (!this.game.unitAt(tile.tx, tile.ty) && !hidHere && stops.has(key(tile.tx, tile.ty))) {
        if (hideD === 0) pick = tile;
        else {
          const dist = manhattan(tile, foe);
          if (Math.abs(dist - hideD) > 1 && dist < hideD) pick = tile;
        }
      }
    }
    return pick;
  },
  // DELIBERATE DEVIATION (user-approved): the original's A* gives up past 2·move — a partial path toward its last
  // closed node, then a straight-line scan — and behind rocks neither makes headway (The Wizard's Palace wave
  // rocking between two tiles beside the portal's rock ring, or a wave shuffling north and south in the corridor
  // between its two entrances). Each stage's tile is kept only if it is nearer the destination by REAL travel AND
  // within 1 of the best reachable tile; otherwise the reachable tile nearest by real travel is taken. Where the
  // original's choice makes good progress (open ground, a path inside the limit) it stands unchanged.
  // Returns { gains(tile), fallback() }; the travel field is built only when first asked.
  _oTravelJudge(u, dest, order) {
    let travelToDest = null,
      hereCost,
      bestCost = Infinity,
      bestTile = null;
    const build = () => {
      travelToDest = this.game.pathField(u, dest.tx, dest.ty, true);
      hereCost = travelToDest.get(key(u.tx, u.ty));
      for (const k of order) {
        const travelCost = travelToDest.get(k);
        if (travelCost != null && travelCost < bestCost) {
          bestCost = travelCost;
          const [x, y] = k.split(",").map(Number);
          bestTile = { tx: x, ty: y };
        }
      }
    };
    return {
      // does stepping to `tile` make real progress toward the destination?
      gains: (tile) => {
        if (!travelToDest) build();
        if (hereCost == null) return true; // dest not walkable at all: the original rule
        const travelCost = travelToDest.get(key(tile.tx, tile.ty));
        return travelCost != null && travelCost < hereCost && travelCost <= bestCost + 1;
      },
      // the reachable tile nearest by real travel, when it beats standing still
      fallback: () => {
        if (!travelToDest) build();
        return bestTile && bestCost < hereCost ? bestTile : null;
      },
    };
  },
  // Stage F: the listed tiles scanned for one nearer the destination; after the first hit the bar becomes the
  // distance to the closest foe (the original compares with that variable), so the last listed tile under it wins.
  _oScanToward(u, dest, order, foeDist) {
    let best = { tx: u.tx, ty: u.ty },
      bar = manhattan(u, dest);
    for (const k of order) {
      const [x, y] = k.split(",").map(Number);
      if (Math.abs(x - dest.tx) + Math.abs(y - dest.ty) < bar) {
        best = { tx: x, ty: y };
        bar = foeDist;
      }
    }
    return best;
  },
};
