/* ============================================================
   Reign of Swords — the original's GROUP AI (iOS `GroupLogic`), part of the AiController (ai/controller.js).

   Decoded from the Episode II binary (GameScreen::createUnitAt @0x29188, Mission::loadMarkers @0x60050,
   Mission::getLocationGroup @0x5f660, GroupLogic::determineTarget @0x38bec, GroupLogic::updateGroup @0x38c5e,
   getGroupPositionOffset @0x38534, getMoveOrder @0x38794, Mission::performAction op 11 @0x60f7c,
   Map::updatePointConcentration @0x3ae66, Map::getBestPointConcentration @0x3eeb8):

   • GROUPS COME FROM THE SCENARIO'S MARKER TABLE. Every marker (the "clips" section: byte group, byte team,
     x, y) names a location; a unit spawned ON a marker joins that team's group number `group`
     (createUnitAt: groupId = getLocationGroup(pos); the team's GroupLogic[groupId] is created on demand).
     A unit spawned off any marker has NO group and runs the bare per-unit state machine. So on Marsur 2 the
     ten militia tiles are group 0, each musketeer pair is its own group (1, 2) and each cannon its own (3, 4);
     on Bordavia 1 the 3×2 gate block is group 0, the archer pairs and the lone archer groups 1–3.
   • A group has a MODE. 0 (default) = ADVANCE: its target is the best "point concentration" of the OPPOSING
     layer — the kernel-smoothed sum of that side's units (hp×rating; the player's side counts its allies too, all
     team byte 0) plus +100 per capture tile that side does not hold, ×6 ÷ (distance + 5) in integers — it paths
     there and MARCHES IN FORMATION: NEXT = the path point its pace reaches this round, every member gets a SLOT
     from the sixteen offset tables (facing = NEXT − centre, width by size), and its move order is NEXT + offset.
     An allied group (team byte 0) reads the ENEMY layer the same way; only a group of a third team (byte > 1,
     none in either episode's records) would keep determineTarget's closest enemy. 2 (script AIMODE(unit, 1)) =
     HOLD: its target is its own initial
     centre, so it stands where it was placed. Marsur 2 flags the musketeers and cannons (they garrison the
     walls) while the unflagged militia block comes at you; Bordavia 1 flags every group, so the pike block holds
     the gate. Both user-confirmed.
   • RELEASE: Unit::applyDamage sets the group's hit flags; a HOLD group that was hit one round and not the next
     drops to mode 0 and joins the attack. An advancing group keeps its formation orders for good (the original's
     "drop the path near the enemy" rule only touches the scripted static path, which no Ep2 map uses); a member
     with a gate within its move leaves the formation and fights on its own.
   The per-unit decisions (charge, attack, opportunity move) stay in ai/ai.js.
   ============================================================ */
import { manhattan, FAR, toHp256 } from "../util/util.js";
import { tileType } from "../rules/terrain.js";

// The sixteen formation tables (GroupLogic::getGroupPositionOffset C.142–C.157, 21 signed bytes each).
const T = {
  142: [0, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2],
  143: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4],
  144: [0, 0, -1, 1, -2, 2, -1, -2, 0, -3, 1, -1, -2, 0, -3, 1, -2, -3, -1, -4, 0],
  145: [0, 1, 0, 2, -1, 3, 1, 0, 2, -1, 3, 2, 1, 3, 0, 4, 2, 1, 3, 0, 4],
  146: [0, -1, -1, -1, -1, -1, -2, -2, -2, -2, -2, -3, -3, -3, -3, -3, -4, -4, -4, -4, -4],
  147: [0, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2],
  148: [0, -1, 0, -2, 1, -2, -1, 0, -2, 1, -3, -2, -1, -3, 0, -4, -2, -3, -1, -4, 0],
  149: [0, 0, -1, 1, -2, 2, -1, -2, 0, -3, 1, -1, -2, 0, -3, 1, -2, -1, -3, 0, -4],
  150: [0, 0, 1, -1, 2, -2, 0, 1, -1, 2, -2, 0, 1, -1, 2, -2, 0, 1, -1, 2, -2],
  151: [0, -1, -1, -1, -1, -1, -2, -2, -2, -2, -2, -3, -3, -3, -3, -3, -4, -4, -4, -4, -4],
  152: [0, 0, 1, -1, 2, -2, 1, 2, 0, 3, -1, 2, 3, 1, 4, 0, 2, 3, 1, 4, 0],
  153: [0, -1, 0, -2, 1, -3, -1, 0, -2, 1, -3, -1, 0, -2, 1, -3, -2, -1, -3, 0, -4],
  154: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4],
  155: [0, 0, 1, -1, 2, -2, 0, 1, -1, 2, -2, 0, 1, -1, 2, -2, 0, 1, -1, 2, -2],
  156: [0, 1, 0, 2, -1, 3, 1, 0, 2, -1, 3, 2, 1, 3, 0, 4, 2, 1, 3, 0, 4],
  157: [0, 0, 1, -1, 2, -2, 1, 2, 0, 3, -1, 1, 2, 0, 3, -1, 2, 3, 1, 4, 0],
};
const tdiv = (a, b) => Math.trunc(a / b); // C integer division (truncates toward zero)
const KERNEL_W = [100, 50, 25, 12, 6]; // changeUnitPointScore's weights by distance (C.250)

// The slot offset for `slot` (counted from 1; rows of five) of a formation `w` rows deep (G+0x84) facing along
// (dx, dy) = the facing point − the centre. Slot > 20 → (0,0).
export function formationOffset(slot, depth, dx, dy) {
  if (slot > 20) return { dx: 0, dy: 0 };
  const absX = Math.abs(dx),
    absY = Math.abs(dy);
  let tableX, tableY, shiftX, shiftY;
  if (Math.abs(absX - absY) <= 2 && absX > 2 && absY > 2) {
    // diagonal facing
    if (dx <= 0 && dy <= 0) {
      tableX = T[156];
      tableY = T[157];
      shiftX = -(tdiv(depth - 1, 3) + 1);
      shiftY = tdiv(-depth, 3);
    } else if (dx <= 0) {
      tableX = T[152];
      tableY = T[153];
      shiftX = tdiv(-depth, 3);
      shiftY = tdiv(depth - 1, 3) + 1;
    } else if (dy <= 0) {
      tableX = T[144];
      tableY = T[145];
      shiftX = tdiv(depth, 3);
      shiftY = -(tdiv(depth - 1, 3) + 1);
    } else {
      tableX = T[148];
      tableY = T[149];
      shiftX = tdiv(depth - 1, 3) + 1;
      shiftY = tdiv(depth, 3);
    }
  } else if (absX >= absY) {
    // horizontal facing
    if (dx > 0) {
      tableX = T[146];
      tableY = T[147];
      shiftX = tdiv(depth - 1, 2) + 1;
      shiftY = 0;
    } else {
      tableX = T[154];
      tableY = T[155];
      shiftX = -(tdiv(depth - 1, 2) + 1);
      shiftY = 0;
    }
  } else {
    // vertical facing
    if (dy > 0) {
      tableX = T[143];
      tableY = T[151];
      shiftX = 0;
      shiftY = tdiv(depth - 1, 2) + 1;
    } else {
      tableX = T[142];
      tableY = T[150];
      shiftX = 0;
      shiftY = -(tdiv(depth - 1, 2) + 1);
    }
  }
  return { dx: tableX[slot] + shiftX, dy: tableY[slot] + shiftY };
}

// FORMATION RANK — the per-type table updateGroup builds on its stack (iOS Ep2 @0x38d14): slots are filled rank by
// rank, 0 → 7. Rank 8 (Trebuchet, Cannon, Ballistae) and −1 (Griffon, Rangers, Horse Bowmen, Great Eagle, Bear, Stag)
// never take a slot: getMoveOrder sends them to the group's NEXT point itself. (The Old* types are left unset.)
const RANK = {
  king: 0,
  militiamen: 1,
  pikemen: 2,
  greatswordsmen: 2,
  footmen: 3,
  halberdiers: 3,
  swordsmen: 3,
  bloodgorgers: 3,
  shamans: 4,
  priests: 4,
  craftsmen: 4,
  archers: 5,
  crossbowmen: 5,
  musketeers: 5,
  sapper: 5,
  bodyguard: 5,
  dunesirens: 5,
  cavalry: 6,
  knights: 6,
  raiders: 6,
  druids: 6,
  conjurer: 6,
  wizards: 7,
  catapult: 7,
  trebuchet: 8,
  cannon: 8,
  ballistae: 8,
};
const slotRank = (u) => (RANK[u.type] != null ? RANK[u.type] : -1);
// Row width for one rank category (the C.119 map: ranks 0–6 → category 0, ranks 7–8 → category 1): five exactly →
// 3 in a group of up to 7 units, else 5; otherwise the divisor 2..5 (with two full rows) leaving the smallest
// remainder, the larger on a tie; fewer than four → the count itself.
function catWidth(count, total) {
  if (count === 5) return total <= 7 ? 3 : 5;
  let width = count,
    best = 5;
  for (let rows = 2; rows < 6; rows++)
    if (2 * rows <= count && count % rows <= best) {
      width = rows;
      best = count % rows;
    }
  return width;
}
// Unit::isNearGate (Ep2 @0x7ada2, Ep1 @0x652ea): a gate tile (terrain type 16) within the unit's move of it.
function nearGate(game, u) {
  const moveBudget = u._paceMove || u.T.move || 0;
  for (let dy = -moveBudget; dy <= moveBudget; dy++)
    for (let dx = -moveBudget; dx <= moveBudget; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > moveBudget) continue;
      const x = u.tx + dx,
        y = u.ty + dy;
      if (game.inBounds(x, y) && tileType(game.tileAt(x, y)) === 16) return true;
    }
  return false;
}

export const GroupMethods = {
  // createUnitAt: a unit spawned on a scenario marker joins that team's group `marker.group`; off-marker → none.
  // The player's own units never run group logic. Cached on the unit (its spawn tile never changes).
  _glGroupOf(u) {
    if (u._glc !== undefined) return u._glc;
    if (u.team === "blue" && !u.ally) return (u._glc = null);
    const spawnAt = u.spawn || { tx: u.tx, ty: u.ty };
    const marker = ((this.game.mission && this.game.mission.markers) || []).find(
      ([x, y]) => x === spawnAt.tx && y === spawnAt.ty,
    );
    u._glc = marker ? (u.team === "blue" ? "ally" : "red") + ":" + marker[2] : null;
    return u._glc;
  },
  _glState(groupIdx) {
    this.game._gl = this.game._gl || {};
    return (
      this.game._gl[groupIdx] ||
      (this.game._gl[groupIdx] = {
        mode: 0,
        flag7: 0,
        f50: 0,
        f51: 0,
        f52: 0,
        center: null,
        dest: null,
        target: null,
        next: { tx: 0, ty: 0 },
        facing: { tx: 0, ty: 0 },
        minMove: 4,
        width: 2,
        depth: 0,
        slots: new Map(),
        turn: -1,
      })
    );
  },
  // Script opcode 11 AIMODE(unit, mode): mode 1 → the unit's group HOLDS (mode 2, flag7 = 0); anything else → mode 0 (advance).
  _glSetMode(u, mode) {
    const groupIdx = this._glGroupOf(u);
    if (groupIdx == null) return;
    const group = this._glState(groupIdx);
    if (mode === 1) {
      group.mode = 2;
      group.flag7 = 0;
    } else group.mode = 0;
  },
  // Unit::applyDamage (@0x6b318): the TARGET's group gets "hit" (+0x50), the ATTACKER's group "attacked" (+0x51) — the
  // release rule reads them next round: a hold group hit while it did not attack itself breaks out.
  _glHit(target, attacker) {
    const targetGroup = target && this._glGroupOf(target);
    if (targetGroup != null) this._glState(targetGroup).f50 = 1;
    const attackerGroup = attacker && this._glGroupOf(attacker);
    if (attackerGroup != null) this._glState(attackerGroup).f51 = 1;
  },
  // Map::updatePointConcentration(team) (Ep1 @0x30cca, Ep2 @0x3ae66) builds one layer per team from every unit whose
  // team byte (Unit+0x14d) is that team — the player's layer 0 holds the allied armies too (Carrone Legion, The
  // Emperor… are all team 0; the Android port's a.j likewise adds every unit with `ac == team`) — with a 4-wide
  // diamond kernel, plus +100 on every tile of each of the record's areas whose OWNER (Mission+0x44) is not that
  // team — every area, whatever the mission type (an unscored area has no owner, so it always counts); a group of
  // team byte t reads layer 1 − t, i.e. the enemy army reads the player's side and an allied army the enemy's. So
  // an enemy keep the player has not taken pulls its own garrison home (Aguilleon 1's two gate keeps hold until
  // they fall). All in integers, as the original: getBestPointConcentration = argmax value·6 ÷ (distance + 5).
  _glConcentration(layerTeam) {
    const cols = this.game.cols,
      rows = this.game.rows,
      field = new Int32Array(cols * rows);
    // Map::changeUnitPointScore (Ep1 @0x309e8): the unit's score × the 41-cell diamond kernel C.248–C.250 —
    // 100 on its tile, 50 / 25 / 12 / 6 at distance 1 / 2 / 3 / 4. Score = HP (256 scale) × value (Unit+0x198,
    // ((cost − 50)·50/450) + 50 = _aiValue) >> 8; a Priest (type 22) counts full HP whatever its wounds.
    const add = (x, y, weight) => {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist > 4) continue;
          const cellX = x + dx,
            cellY = y + dy;
          if (cellX < 0 || cellY < 0 || cellX >= cols || cellY >= rows) continue;
          field[cellY * cols + cellX] += weight * KERNEL_W[dist];
        }
    };
    for (const e of this.game.units) {
      if (e.dead || e.team !== layerTeam) continue;
      add(e.tx, e.ty, ((e.T.prayer ? 256 : toHp256(e.hp)) * this._aiValue(e)) >> 8);
    }
    if (this.game.areas && this.game.areas.length) {
      for (const a of this.game.areas)
        if (a.owner !== layerTeam)
          for (const cell of a.tiles) if (cell.tx < cols && cell.ty < rows) field[cell.ty * cols + cell.tx] += 100; // the tile itself, no spread
    } else
      for (const obj of this.game.objectives || []) {
        if (this.game.objectiveOwner(obj) !== layerTeam) add(obj.tx, obj.ty, 100); // a hand-made objective (no record areas)
      }
    // …and the record's siege points (loadMarkers section D, Ep1 Mission+0x4c / Ep2 +0x7c): score 20 through the
    // same kernel on EVERY layer (changeUnitPointScore(pos, 20, layer, add)).
    for (const [x, y] of (this.game.mission && this.game.mission.siegePoints) || []) add(x, y, 20);
    return field;
  },
  _glDest(center, layerTeam) {
    const field = this._glConcentration(layerTeam),
      cols = this.game.cols,
      rows = this.game.rows;
    // getPointConcentrationValue: field·6 ÷ (distance + 5), C division; the first strictly better tile wins (from 0 at (0,0))
    let best = { tx: 0, ty: 0 },
      bestV = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const value = Math.trunc((field[y * cols + x] * 6) / (Math.abs(x - center.tx) + Math.abs(y - center.ty) + 5));
        if (value > bestV) {
          bestV = value;
          best = { tx: x, ty: y };
        }
      }
    return best;
  },
  // GroupLogic::determineTarget + updateGroup (iOS Ep2 @0x38c5e) — once per group per attack phase, before its
  // units act. The six steps below run in the original's order; each writes its part of the group record `g`.
  _glUpdate(groupIdx, members, enemies, selfTeam) {
    if (groupIdx == null) return null;
    const group = this._glState(groupIdx);
    if (group.turn === this.game.turn) return group; // already updated this round
    group.turn = this.game.turn;
    if (!members.length) return group;
    this._glRelease(group); // 1
    this._glPace(group, members, enemies); // 2
    this._glWidth(group, members); // 3
    this._glTarget(group, selfTeam); // 4
    this._glNext(group, members, enemies); // 5
    this._glAssignSlots(group, members); // 6
    group.f50 = 0;
    group.f51 = 0;
    return group;
  },
  // 1. the hit → release chain (flags 0x50/0x51/0x52): a hold group hit one round and not the next breaks out.
  //    (The hold countdown at G+0x54 starts at −1 and nothing sets it, so it never fires.)
  _glRelease(group) {
    if (group.mode !== 2) return;
    if (group.f52 && !group.f51) {
      group.mode = 0;
      group.f50 = 0;
    } else if (group.f51) group.f52 = 0;
    else if (group.f50) group.f52 = 1;
  },
  // 2. members: every slot is cleared (−1); a member with no enemy left, or (outside a HOLD group) with a gate
  //    within its move, is taken out of the formation (−2 — it acts on its own). The others set the pace: the
  //    slowest move (a Druid counts 10). Centre = the mean position of all members.
  _glPace(group, members, enemies) {
    const out = new Set();
    let sumX = 0,
      sumY = 0,
      minMove = 100;
    for (const u of members) {
      sumX += u.tx;
      sumY += u.ty;
      if (!enemies.length || (nearGate(this.game, u) && group.mode !== 2)) {
        out.add(u.id);
        continue;
      }
      const moveBudget = u.type === "druids" ? 10 : u._paceMove || u.T.move;
      if (moveBudget < minMove) minMove = moveBudget;
    }
    if (minMove === 100) minMove = members[0]._paceMove || members[0].T.move;
    group.center = { tx: Math.trunc(sumX / members.length), ty: Math.trunc(sumY / members.length) };
    group.minMove = minMove;
    // every member a Wizard, Griffon, Great Eagle or Druid (the Android port's a.i.f; no path is walked for it)
    group.allFree = members.every((u) => ["wizards", "griffon", "greateagle", "druids"].includes(u.type));
    group.out = out;
    // A scenario-placed Hero (Unit+0x110 set by createUnitAt) in a group has its move set to the group's pace (@0x38fd4).
    for (const u of members) if (u.type === "king") u._paceMove = minMove;
  },
  // 3. row width: members counted by rank category (ranks 0–6 / ranks 7–8); a Hero alone in the first category
  //    joins the other one; width = the widest category's row (at least 2).
  _glWidth(group, members) {
    const counts = [0, 0];
    for (const u of members) {
      const rank = slotRank(u);
      if (rank >= 0) counts[rank >= 7 ? 1 : 0]++;
    }
    if (members.some((u) => u.type === "king") && counts[0] === 1 && counts[1] > 0) {
      counts[0] = 0;
      counts[1]++;
    }
    group.width = Math.max(2, catWidth(counts[0], members.length), catWidth(counts[1], members.length));
  },
  // 4. target: HOLD (mode 2) → the group's initial centre; ADVANCE → the best concentration point of the other
  //    side's layer, 1 − team byte (updateGroup @0x3905a; the Android port's a.i: `if (m < 2) h = map.b(t, 1 − m)`):
  //    the enemy reads the player's side, an allied army (team 0) the enemy's.
  _glTarget(group, selfTeam) {
    if (!group.dest) group.dest = group.center;
    group.target = group.mode === 2 ? group.dest : this._glDest(group.center, selfTeam === "red" ? "blue" : "red");
  },
  // 5. NEXT (the point the formation forms on) and the FACING point. A HOLD group within 2 of its point forms
  //    on the point itself, facing the first member's closest enemy. Otherwise the leader (first member) paths
  //    from the centre to the target — skipped when every member is a Wizard, Griffon, Great Eagle or Druid —
  //    NEXT = the path point one pace (the slowest move) along it, FACING = the one 2·pace + 1 along; no path →
  //    NEXT = the target (the facing point stays as it was).
  _glNext(group, members, enemies) {
    const target = group.target,
      minMove = group.minMove;
    if (group.mode === 2 && manhattan(group.center, target) <= 2) {
      group.next = { tx: target.tx, ty: target.ty };
      const closest = this._oClosestEnemy(members[0], enemies); // getClosestEnemy (hidden foes count as 50 away)
      if (closest) group.facing = { tx: closest.e.tx, ty: closest.e.ty };
      return;
    }
    // Map::calcShortestPath (A*, no length cap: 9999) for the leader; an all-flier group skips it and reads the
    // leader's LAST path list (its own last move). The list starts with its start tile.
    const fliers = members.every((u) => ["wizards", "griffon", "greateagle", "druids"].includes(u.type));
    const lead = members[0];
    let path = fliers
      ? lead._oPathList
      : this._oAstar(lead, group.center.tx, group.center.ty, target.tx, target.ty, false, 9999, true);
    if (!fliers && lead.ally && !this._glPathArrives(lead, path, target)) {
      path = this._glNearestReachablePath(lead, group);
      if (!path) {
        // nothing reachable is nearer the target: the group stays, facing it
        group.next = { tx: group.center.tx, ty: group.center.ty };
        group.facing = { tx: target.tx, ty: target.ty };
        return;
      }
    }
    if (path && path.length) {
      group.next = path[Math.min(minMove, path.length - 1)];
      group.facing = path[Math.min(2 * minMove + 1, path.length - 1)];
    } else group.next = { tx: target.tx, ty: target.ty };
  },
  // Does the leader's path end on the target (or on the tile FindClosestGoal moves an unwalkable target to, as A* does)?
  _glPathArrives(lead, path, target) {
    if (!path || !path.length) return false;
    const goal = this._oWalkable(lead, null, null, target.tx, target.ty, false)
      ? target
      : this._oFindClosestGoal(lead, path[0].tx, path[0].ty, target.tx, target.ty, false);
    const end = path[path.length - 1];
    return end.tx === goal.tx && end.ty === goal.ty;
  },
  // DELIBERATE DEVIATION (user-approved): an ALLIED group whose target cannot be reached gets, in the original, A*'s
  // path to its last closed node — which may run anywhere (Conquest of El Acclazar: the left trebuchets' only road
  // leads away, NEXT lands behind them and the 8-tile target leash then forbids every shot, so they roll back and
  // stand idle). Instead the group marches on the tile it can reach that is nearest the target (the cheaper walk on
  // a tie); null when no reachable tile is nearer than its centre (the group stays).
  _glNearestReachablePath(lead, group) {
    const { center, target } = group;
    const costs = new Map([[center.tx + "," + center.ty, 0]]);
    const queue = [{ tx: center.tx, ty: center.ty, cost: 0 }];
    let best = null,
      bestDist = manhattan(center, target),
      bestCost = 0;
    while (queue.length) {
      let idx = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[idx].cost) idx = i;
      const node = queue.splice(idx, 1)[0];
      if (node.cost > costs.get(node.tx + "," + node.ty)) continue;
      const dist = manhattan(node, target);
      if (dist < bestDist || (best && dist === bestDist && node.cost < bestCost)) {
        best = node;
        bestDist = dist;
        bestCost = node.cost;
      }
      for (const [stepX, stepY] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = node.tx + stepX,
          y = node.ty + stepY;
        if (!this._oWalkable(lead, node.tx, node.ty, x, y, false)) continue;
        const cost = node.cost + this.game.moveCost(lead, x, y, node.tx, node.ty),
          k = x + "," + y;
        if (costs.has(k) && costs.get(k) <= cost) continue;
        costs.set(k, cost);
        queue.push({ tx: x, ty: y, cost });
      }
    }
    return best && this._oAstar(lead, center.tx, center.ty, best.tx, best.ty, false, 9999, true);
  },
  // 6. slots — three passes over the ranks 0..7: each slot position in turn (NEXT + getGroupPositionOffset, slots
  //    counted from 1) goes to the nearest free member of the current rank; the rank moves on when none is left.
  //    A row of `width` done → the depth counter grows and (width ≤ 4) the count jumps to the next row of 5.
  _glAssignSlots(group, members) {
    group.slots = new Map();
    const faceX = group.facing.tx - group.center.tx,
      faceY = group.facing.ty - group.center.ty;
    const posOf = (slotNo) => {
      const offset = formationOffset(slotNo, group.depth, faceX, faceY);
      return { tx: group.next.tx + offset.dx, ty: group.next.ty + offset.dy };
    };
    let slot = 1,
      assigned = 0,
      row = 0,
      pos = posOf(1); // slot 1's spot uses the depth left from the previous update — as the original: the
    // getGroupPositionOffset(1) call @0x3924c comes before depth (G+0x84) is zeroed @0x39270
    group.depth = 0;
    for (let pass = 0; pass < 3 && assigned < members.length; pass++) {
      for (let rank = 0; rank <= 7; rank++) {
        for (;;) {
          let bestUnit = null,
            bestDist = FAR;
          for (const u of members) {
            if (group.out.has(u.id) || group.slots.has(u.id) || slotRank(u) !== rank) continue;
            const dist = manhattan(u, pos);
            if (dist < bestDist) {
              bestDist = dist;
              bestUnit = u;
            }
          }
          if (!bestUnit) break;
          group.slots.set(bestUnit.id, slot);
          assigned++;
          slot++;
          row++;
          if (row >= group.width) {
            if (group.width <= 4) slot = Math.trunc((slot - 1) / 5) * 5 + 6;
            group.depth++;
            row = 0;
          }
          pos = posOf(slot);
        }
      }
    }
  },
  // GroupLogic::getMoveOrder (@0x38794): NEXT + the slot's offset (no slot → NEXT itself). A member taken out of
  // the formation (−2) gets no order — it acts on its own. `hold` marks a HOLD group (mode 2), whose members use
  // the hold move (getBestMoveLocation @0x7d7a2, see ai/ai.js).
  // GroupLogic's point for a member (the Android port's a.i.a(unit)): NEXT plus its formation slot's offset — NEXT
  // itself without a slot. Null when the unit has no group or the group has not formed.
  _glPoint(u) {
    const groupIdx = this._glGroupOf(u);
    const group = groupIdx != null && this.game._gl && this.game._gl[groupIdx];
    if (!group || !group.center || !group.next) return null;
    const slot = group.slots.get(u.id);
    if (slot == null) return { tx: group.next.tx, ty: group.next.ty, group };
    const off = formationOffset(
      slot,
      group.depth,
      group.facing.tx - group.center.tx,
      group.facing.ty - group.center.ty,
    );
    return { tx: group.next.tx + off.dx, ty: group.next.ty + off.dy, group };
  },
  _glOrder(u) {
    // your own units under the 🤖 Autopilot take the strategy's order instead (ai/autopilot.js)
    if (this.game.autopilot && u.team === "blue" && !u.ally) return this._apOrder(u);
    const groupIdx = this._glGroupOf(u);
    if (groupIdx == null) return null;
    const group = this.game._gl && this.game._gl[groupIdx];
    if (!group || !group.center || !group.next) return null;
    const hold = group.mode === 2;
    if (group.out && group.out.has(u.id) && !hold) return null;
    const slot = group.slots.get(u.id);
    let tx = group.next.tx,
      ty = group.next.ty;
    if (slot != null) {
      const off = formationOffset(
        slot,
        group.depth,
        group.facing.tx - group.center.tx,
        group.facing.ty - group.center.ty,
      );
      tx += off.dx;
      ty += off.dy;
    }
    tx = Math.max(0, Math.min(this.game.cols - 1, tx));
    ty = Math.max(0, Math.min(this.game.rows - 1, ty));
    return hold ? { tx, ty, hold: true, center: group.center } : { tx, ty };
  },
};
