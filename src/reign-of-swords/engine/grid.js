/* ============================================================
   Reign of Swords — the grid / movement query layer.
   Everything spatial: tile & terrain lookup, wall breaching, per-unit
   movement cost, the 4-directional reach flood-fill (+ Charge lanes), the
   terrain-aware travel-distance field, path reconstruction, attack-target
   enumeration, and the Fear / Stealth visibility rules. Ported from the
   decompiled reach fill (La/q.P) and metric (a.j.c). Mixed onto Game.prototype
   in engine/engine.js — every method runs with `this` = the live Game, so it reads
   game state and calls sibling helpers (finishUnit / fireProjectile / spawnFx /
   _meleeSfx / _chargeReaches …) via `this`. Only pure geometry (util/util) and
   terrain data (rules/terrain) are imported.
   ============================================================ */

import { key, manhattan } from "../util/util.js";
import {
  tileProp,
  structTrans,
  structArmor,
  rubbleProp,
  hasMovement,
  moveType,
  moveRow,
  moveLinks,
} from "../rules/terrain.js";

import { WEAPON_RANGE, WEAPON_DMG, WEAPON_TAGS } from "../data/combat-data.js";

// Terrain move-cost by unit movement CATEGORY, ported from the real game's mTerrainTable (record 5010
// af[terrainType][al+1], decompiled from La/j). Columns are the `al` category: [0 Fly, 1 Skirmish/loose,
// 2 Formation, 3 Cavalry, 4 War Engine]; 99 = impassable for that class. Our engine clusters the 124 tile
// indices into 8 categories (terrain.json), so each category takes the af row that matches its terrain type.
// The real ordering it preserves: Skirmish(al1) is cheaper than Formation(al2) on rough ground; cavalry is
// heavily slowed in forest; war engines can't enter forest / buildings / hills; only fliers cross deep water.
const TERRAIN_MOVE = {
  grass: [1, 1, 1, 1, 1],
  road: [1, 1, 1, 1, 1],
  village: [1, 1, 1, 1, 99], // buildings — foot & horse enter, war engines can't
  keep: [1, 1, 1, 1, 99], // keep interior — no war engines
  hill: [1, 2, 3, 3, 99], // rough climb: skirmish < formation; cavalry slowed; engines can't climb
  forest: [1, 4, 4, 8, 99], // woods: foot slowed, cavalry heavily slowed, engines can't enter
  wall: [1, 99, 99, 99, 99], // castle wall — a BARRIER: blocks foot, cavalry & engines alike (the real data's
  // impassable tile band 33-62). Only fliers cross. Ground troops must breach it with
  // siege (a breach opens the tile to open ground) or flank around it.
  water: [1, 3, 3, 4, 99], // fords/shallows (passable water only); deep water is impassable to all but fliers
};

// EPISODE II warp-portal exit search order - gWarpPositionX/Y (iOS Ep2 @0x95c38 / @0x95ba8, 144 bytes = 72 offsets):
// the four axis cells at distance r, then every off-axis cell at Manhattan r+1 clockwise from the top-right, r = 1..8.
const WARP_OFFSETS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [2, 0],
  [0, 2],
  [-2, 0],
  [1, -2],
  [2, -1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
  [0, -3],
  [3, 0],
  [0, 3],
  [-3, 0],
  [1, -3],
  [2, -2],
  [3, -1],
  [3, 1],
  [2, 2],
  [1, 3],
  [-1, 3],
  [-2, 2],
  [-3, 1],
  [-3, -1],
  [-2, -2],
  [-1, -3],
  [0, -4],
  [4, 0],
  [0, 4],
  [-4, 0],
  [1, -4],
  [2, -3],
  [3, -2],
  [4, -1],
  [4, 1],
  [3, 2],
  [2, 3],
  [1, 4],
  [-1, 4],
  [-2, 3],
  [-3, 2],
  [-4, 1],
  [-4, -1],
  [-3, -2],
  [-2, -3],
  [-1, -4],
  [0, -5],
  [5, 0],
  [0, 5],
  [-5, 0],
  [1, -5],
  [2, -4],
  [3, -3],
  [4, -2],
  [5, -1],
  [5, 1],
  [4, 2],
  [3, 3],
  [2, 4],
  [1, 5],
  [-1, 5],
  [-2, 4],
  [-3, 3],
  [-4, 2],
  [-5, 1],
  [-5, -1],
  [-4, -2],
  [-3, -3],
  [-2, -4],
  [-1, -5],
  [0, -6],
  [6, 0],
  [0, 6],
  [-6, 0],
  [1, -6],
  [2, -5],
  [3, -4],
  [4, -3],
  [5, -2],
  [6, -1],
  [6, 1],
  [5, 2],
  [4, 3],
  [3, 4],
  [2, 5],
  [1, 6],
  [-1, 6],
  [-2, 5],
  [-3, 4],
  [-4, 3],
  [-5, 2],
  [-6, 1],
  [-6, -1],
  [-5, -2],
  [-4, -3],
  [-3, -4],
  [-2, -5],
  [-1, -6],
  [0, -7],
  [7, 0],
  [0, 7],
  [-7, 0],
  [1, -7],
  [2, -6],
  [3, -5],
  [4, -4],
  [5, -3],
  [6, -2],
  [7, -1],
  [7, 1],
  [6, 2],
  [5, 3],
  [4, 4],
  [3, 5],
  [2, 6],
  [1, 7],
  [-1, 7],
  [-2, 6],
  [-3, 5],
  [-4, 4],
  [-5, 3],
  [-6, 2],
  [-7, 1],
  [-7, -1],
  [-6, -2],
  [-5, -3],
  [-4, -4],
  [-3, -5],
  [-2, -6],
  [-1, -7],
  [0, -8],
  [8, 0],
  [0, 8],
  [-8, 0],
];

export class GridMethods {
  unitAt(tx, ty) {
    return this.units.find((u) => !u.dead && u.tx === tx && u.ty === ty);
  }
  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }
  tileAt(tx, ty) {
    return this.tiles[ty * this.cols + tx];
  }
  terrainAt(tx, ty) {
    // A structure knocked down to its end tile THIS battle stands on the real terrain row of that end tile (a flattened
    // wall / burnt house / felled wood is open ground) — the recreation's per-tile categories only fit the maps as drawn.
    if (this.razed && this.razed.has(key(tx, ty))) {
      const rubble = rubbleProp(this.tileAt(tx, ty));
      if (rubble) return rubble;
    }
    return tileProp(this.tileAt(tx, ty)); // real props (passable/movecost/defBonus/heal…)
  }
  // DESTRUCTIBLE STRUCTURES — any tile with a further damage stage (Map::getTransitionTile != -1): houses, palisades,
  // woods, walls, towers, gatehouses. A unit can shoot one directly when the weapon it would use at that distance does
  // real damage to the tile's material (its WEAPON_DMG wood/stone column, 13/14 — siege, fire, longbows, magic,
  // ballista bolts; plain melee weapons carry 0 there, so they can't).
  isStructure(tx, ty) {
    return this.inBounds(tx, ty) && structTrans(this.tileAt(tx, ty)) != null && structArmor(this.tileAt(tx, ty)) > 0;
  }
  canHitStructure(u, tx, ty) {
    if (!u || !this.isStructure(tx, ty)) return false;
    const dist = Math.abs(u.tx - tx) + Math.abs(u.ty - ty);
    if (dist < 1) return false;
    if (this._isAoe(u)) {
      const [mn, mx] = this._castRange(u);
      if (dist < mn || dist > mx) return false;
    } else if (dist < (u.T.minRange || 1) || dist > u.T.range) return false;
    if (this._movedThisTurn(u) && this._weaponLockedAfterMove(u, this._weaponAt(u, dist))) return false; // Move or Shoot weapon after a move
    return this._structDmgCol(u, dist, this.tileAt(tx, ty)) > 0;
  }
  _structDmgCol(u, dist, tileVal) {
    const row = WEAPON_DMG[this._weaponAt(u, dist)];
    return (row && row[structArmor(tileVal)]) || 0;
  }
  // Shooting a structure PLAYS the unit's firing animation (the shot lands at the hit frame). An area weapon (catapult,
  // wizard) drops its whole blast there, so the neighbouring cells — the houses beside a gate — take the splash too.
  damageStructure(u, tx, ty) {
    if (!this.canHitStructure(u, tx, ty)) return false;
    if (this._isAoe(u)) {
      this._castGroundAoe(u, tx, ty);
      return true;
    }
    u.face = Math.sign(tx - u.tx) || u.face || 1;
    this.anim = {
      type: "attack",
      u,
      target: { tx, ty, px: tx * this.tile, py: ty * this.tile },
      t: 0,
      hitDone: false,
      structure: { tx, ty },
      done: () => this.finishUnit(u),
    };
    u.attacking = true;
    u.anim = 0;
    u.animT = 0;
    this._emit();
    return true;
  }
  // movement cost for a specific unit (cavalry blocked by walls, siege by walls/hills) — 99 = impassable
  // Terrain-tuned movement (help "MOVEMENT"): flyers ignore terrain (and cross water); wizards teleport past
  // everything but water; cavalry are slowed in forest; war engines can't enter forest OR buildings; formation
  // ranks are slowed on rough ground; skirmishers suffer less penalty.
  // (fx, fy) = the tile the step comes FROM, when there is one (the reach / path floods pass it): it enables the
  // original's step-link rule. One-off checks (a landing tile, a portal exit) pass none, as getMoveCost(unit, 0, to).
  moveCost(u, tx, ty, fx, fy) {
    if (!this.inBounds(tx, ty)) return 99;
    if (this.portals && this._portalBlocks(u, tx, ty)) return 99; // Map::getMoveCost's portal gates (fliers included)
    // Movement CATEGORY (real 5010 `al`): 0 fly · 1 skirmish · 2 formation · 3 cavalry · 4 siege. Fall back to a
    // sensible class if a unit somehow lacks it (shifted druid-forms carry their beast's T, which has al set).
    const moveClass =
      u.T.al != null
        ? u.T.al
        : u.T.fly
          ? 0
          : u.T.kind === "siege"
            ? 4
            : u.T.kind === "cavalry" || u.T.kind === "hero"
              ? 3
              : u.T.formation
                ? 2
                : 1;
    if (hasMovement()) return this._originalMoveCost(u, u.T.fly ? 0 : moveClass, tx, ty, fx, fy);
    const props = this.terrainAt(tx, ty);
    if (moveClass === 0 || u.T.fly) return 1; // flyers ignore terrain (water included)
    // (Wizard Teleport is NOT a cost rule — the wizard's tile costs are its own foot class's; the teleport lives in
    // computeReach below: Manhattan reach, destination-only terrain check, per Unit::createMoveDestinations.)
    // A structure razed this battle moves by the REAL terrain row of its end tile (mTerrainTable, 90+ = impassable).
    if (props.moveRow) {
      const cost = props.moveRow[moveClass];
      return cost >= 99 ? 99 : Math.max(1, cost);
    }
    if (!props.passable) return 99; // deep water / cliffs — impassable to ground troops
    if (moveClass === 3 && props.blocksMounted) return 99; // this tile blocks cavalry (rampart, deep ford)
    if (moveClass === 4 && props.blocksEngine) return 99; // this tile blocks war engines
    // The real per-category terrain cost (mTerrainTable af[terrain][al+1]); the tile's own movecost is a fallback.
    const row = TERRAIN_MOVE[props.category];
    const cost = row ? row[moveClass] : props.movecost || 1;
    return cost >= 99 ? 99 : Math.max(1, cost);
  }

  // ===== EPISODE II WARP PORTALS (iOS Ep2: Mission::getSourcePortal / getDestPortal / canUsePortal, Map::getMoveCost,
  // Unit::onTick post-move, Unit::getPortalOutput). Each portal is ONE-WAY src -> dst with a team list (the scenario
  // group indices allowed through; empty = everyone); a two-way gate is two records. ==================================
  _portalUsable(portal, u) {
    return !portal.mask || !portal.mask.length || portal.mask.includes(u.group || 0);
  }
  // getSourcePortal(team, x, y): the portal starting on this tile that `u`'s team may use (u == null -> any team's).
  _srcPortal(tx, ty, u) {
    return (this.portals || []).find((p) => p.sx === tx && p.sy === ty && (!u || this._portalUsable(p, u))) || null;
  }
  _dstPortal(tx, ty, u) {
    return (this.portals || []).find((p) => p.dx === tx && p.dy === ty && (!u || this._portalUsable(p, u))) || null;
  }
  // getMoveCost: an exit-only pad for this team (isOutOnlyWarpPortal -> 90) and a gate this team may not use
  // (a source for someone, not for us -> 100) are both impassable.
  _portalBlocks(u, tx, ty) {
    if (this._dstPortal(tx, ty, u) && !this._srcPortal(tx, ty, u)) return true;
    return !!(this._srcPortal(tx, ty, null) && !this._srcPortal(tx, ty, u));
  }
  // Unit::getPortalOutput: walk gWarpPositionX/Y out from the exit pad; the first cell the unit may stand on
  // (isTileDeployable) wins if it touches the pad or a path leads from it back to the pad (calcShortestPath); a
  // standable but cut-off cell is only kept as the fallback (the last one seen).
  _portalOutput(u, portal) {
    let fallback = null;
    for (const [offX, offY] of WARP_OFFSETS) {
      const x = portal.dx + offX,
        y = portal.dy + offY;
      if (!this.inBounds(x, y)) continue;
      const occupant = this.unitAt(x, y);
      if ((occupant && occupant !== u) || this.moveCost(u, x, y) >= 99) continue;
      if (Math.abs(offX) + Math.abs(offY) === 1 || this._walkable(u, x, y, portal.dx, portal.dy))
        return { tx: x, ty: y };
      fallback = { tx: x, ty: y };
    }
    return fallback;
  }
  // Is there a 4-directional walk for `u` from (x,y) to the target tile (terrain only)?
  _walkable(u, x, y, goalX, goalY) {
    const seen = new Set([key(x, y)]),
      queue = [[x, y]];
    while (queue.length) {
      const [curX, curY] = queue.shift();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = curX + dx,
          ny = curY + dy,
          k = key(nx, ny);
        if (nx === goalX && ny === goalY) return true;
        if (seen.has(k) || !this.inBounds(nx, ny) || this.moveCost(u, nx, ny, curX, curY) >= 99) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return false;
  }
  // The post-move warp (Unit::onTick): a unit whose move ENDS on a portal its team may use dematerializes (state 32,
  // sound 58), reappears on getPortalOutput's cell beside the exit pad (state 33, sound 59), and then its move is over
  // - the normal after-move step (attack if it may) runs from there. Returns false when there is nothing to do.
  _portalWarp(u, then) {
    if (!this.portals || !u || u.dead) return false;
    const portal = this._srcPortal(u.tx, u.ty, u);
    if (!portal) return false;
    const out = this._portalOutput(u, portal);
    if (!out) return false;
    this._commitMove(u); // a portal jump can't be undone
    const tile = this.tile;
    this.spawnFx("arcane_out", u.px + tile / 2, u.py + tile * 0.42, {});
    this.audio.play("teleport_out", 0.5);
    u._teleporting = true;
    this._teleportLock = true;
    this._emit();
    this._after(0.5, () => {
      u.tx = out.tx;
      u.ty = out.ty;
      u.px = out.tx * tile;
      u.py = out.ty * tile;
      this.spawnFx("arcane_in", u.px + tile / 2, u.py + tile * 0.42, {});
      this.audio.play("teleport_in", 0.5);
      this.centerOn(out.tx, out.ty, true); // GameScreen::moveViewport to the exit
      this._emit();
      this._after(0.45, () => {
        u._teleporting = false;
        this._teleportLock = false;
        this.ai._garrisonCheckRelease(u, portal);
        then && then();
        this._emit();
      });
    });
    return true;
  }
  // THE ORIGINAL'S MOVE COST (iOS Ep2 Map::getMoveCost @0x3ba3a, same table in Ep1): the cell's terrain type
  // (getTileType; none -> impassable) indexes record 5010's cost rows by the unit's movement class; a 0 costs 1 and
  // 90+ (the data uses 100) is impassable. Ground units must also obey isMoveAllowed on the step they take. A unit
  // stepping onto a type-16 cell held by its own side pays 1. DELIBERATE DEVIATION (MECHANICS.md §13): getMoveCost also
  // blocks the bottom-left / bottom-right corner cells outside one game-screen mode — the iPhone softkeys sit there; a
  // device-UI artefact, not ported.
  _originalMoveCost(u, moveClass, tx, ty, fx, fy) {
    const tileMove = moveType(this.tileAt(tx, ty)),
      row = moveRow(tileMove);
    if (!row) return 99;
    if (fx != null && moveClass !== 0 && !this._moveAllowed(fx, fy, tx, ty)) return 99;
    if (tileMove === 16) {
      const occupant = this.unitAt(tx, ty);
      if (occupant && !occupant.dead && occupant.team === u.team) return 1;
    }
    const cost = row[moveClass] || 0;
    return cost >= 90 ? 99 : Math.max(1, cost);
  }
  // Map::isMoveAllowed(from, to): stepping between two cells of the same type is always fine; otherwise a type with a
  // step-link list may only be entered from, or left towards, a type on that list — towers (12) join only wall-walk
  // (14), and wall-walk joins only keep ground (18), towers and gatehouses (10): the battlements are walked from inside.
  _moveAllowed(fx, fy, tx, ty) {
    if (!this.inBounds(fx, fy)) return true;
    const fromType = moveType(this.tileAt(fx, fy)),
      toType = moveType(this.tileAt(tx, ty));
    if (fromType === toType) return true;
    const into = moveLinks(toType);
    if (into && into.length && !into.includes(fromType)) return false;
    const out = moveLinks(fromType);
    if (out && out.length && !out.includes(toType)) return false;
    return true;
  }
  moveOf(u) {
    const move = u._paceMove || u.T.move || 4;
    return u.slowed ? Math.trunc((move * 3) / 4) : move;
  } // _paceMove: a grouped AI Hero marches at its group's pace (ai/grouplogic.js)   // Ice Field: move × 3 / 4 (Unit::onTick @0x78f5c)
  // Where unit `u` can move this turn: { dist, from, stops } — the cost to each tile, the step it came from (for
  // pathTo) and the tiles it may end on. A Wizard teleports; everyone else walks (4 directions), and a Charge unit
  // may also launch a diagonal charge.
  computeReach(u, budget) {
    const moveBudget = budget != null ? budget : this.moveOf(u); // optional cap (the Shoot-and-Move strafing run spends its move across several shots)
    if (u.T.teleport) return this._teleportReach(u, moveBudget);
    const { dist, from } = this._walkReach(u, moveBudget);
    // Orthogonal 4-directional reach is the ONLY free movement (this game moves in 4 directions). Snapshot the
    // movable stops from it NOW, before any charge lane is laid down — so a diagonal tile can never become a
    // free "walk here" destination.
    const stops = new Set();
    for (const k of dist.keys()) {
      const [x, y] = k.split(",").map(Number);
      const occupant = this.unitAt(x, y);
      if (!occupant || occupant === u) stops.add(k);
    }
    if (u.T.hasCharge && !u.slowed) this._addChargeLanes(u, moveBudget, dist, from, stops);
    return { dist, from, stops };
  }

  // WIZARD TELEPORT — Unit::createMoveDestinations' wizard branch (iOS Ep2 @0x6e5f6, unit type 21): every tile with
  // Manhattan distance <= move is a destination if it is EMPTY and its OWN move cost for the wizard (a foot unit,
  // movement class 1 — Map::getMoveCost, 90 = impassable) is <= move. Nothing in between matters (the blink is a
  // straight Manhattan hop, getUnitMoveCost's "direct" flag), but the landing tile does: no cliffs, deep water,
  // walls or other ground a foot soldier can't stand on. (The help's "ignoring all terrain but water" describes the
  // path, not the landing tile.)
  _teleportReach(u, moveBudget) {
    const dist = new Map(),
      from = new Map();
    const start = key(u.tx, u.ty),
      stops = new Set([start]);
    dist.set(start, 0);
    for (let dy = -moveBudget; dy <= moveBudget; dy++)
      for (let dx = -moveBudget; dx <= moveBudget; dx++) {
        const hops = Math.abs(dx) + Math.abs(dy);
        if (!hops || hops > moveBudget) continue;
        const x = u.tx + dx,
          y = u.ty + dy;
        if (!this.inBounds(x, y) || this.unitAt(x, y)) continue;
        if (this.moveCost(u, x, y) > moveBudget) continue; // the landing tile's own cost (99 = impassable)
        const k = key(x, y);
        dist.set(k, hops);
        from.set(k, start);
        stops.add(k);
      }
    return { dist, from, stops };
  }

  // The walking flood-fill (cheapest cost first) within move `mv`: through friends, never through foes.
  // Episode II's Map::getMoveCost (@0x3ba3a) lets Griffon Riders, Great Eagles and Dune Sirens fly / glide over an
  // enemy's tile. Episode I has no such exception: its createMoveDestinations walks Unit::checkLocation (Ep1
  // @0x58920), which stops at any visible enemy for every unit, and its getMoveCost (@0x316ea) has no unit test — the
  // Android port's a.j likewise — so there a flyer goes round enemy units like everyone else.
  _passesOverFoes(u) {
    if (!(this.mission && this.mission.ep === 2)) return false;
    return u.type === "griffon" || u.type === "greateagle" || u.type === "dunesirens";
  }
  _walkReach(u, moveBudget) {
    const dist = new Map(),
      from = new Map();
    dist.set(key(u.tx, u.ty), 0);
    const queue = [{ tx: u.tx, ty: u.ty, c: 0 }];
    while (queue.length) {
      queue.sort((a, b) => a.c - b.c);
      const cur = queue.shift();
      if (cur.c > dist.get(key(cur.tx, cur.ty))) continue;
      // EPISODE II — Quicksand (help string 760): a unit that ENTERS quicksand is "forced to stop moving", so a
      // quicksand tile is a dead-end in the move graph — reachable as a destination, but you can't step through
      // it. Immune units (fliers / Dune Sirens) glide over it normally. The start tile never blocks its own exit.
      if (this._quicksandAt(cur.tx, cur.ty) > 0 && !this._quicksandImmune(u) && !(cur.tx === u.tx && cur.ty === u.ty))
        continue;
      // 4-DIRECTIONAL movement (orthogonal only) — the original's reach flood-fill `La/q.P()` expands exactly
      // 4 neighbours (`cg=[-1,1,0,0]`, `ch=[0,0,-1,1]`), and its tile metric `a.j.c` is manhattan, so units
      // never step diagonally.
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cur.tx + dx,
          ny = cur.ty + dy;
        if (!this.inBounds(nx, ny)) continue;
        const stepCost = this.moveCost(u, nx, ny, cur.tx, cur.ty);
        if (stepCost >= 99) continue;
        const occupant = this.unitAt(nx, ny);
        // Map::getMoveCost (iOS Ep2 @0x3ba3a): nobody moves on from a tile an enemy stands on — except, in Episode II,
        // Griffon Riders, Great Eagles and Dune Sirens, which fly / glide over enemy units (never stopping on one)
        if (occupant && occupant.team !== u.team && !this._passesOverFoes(u)) continue;
        const newCost = cur.c + stepCost;
        if (newCost > moveBudget + 1e-6) continue;
        if (!dist.has(key(nx, ny)) || newCost < dist.get(key(nx, ny))) {
          dist.set(key(nx, ny), newCost);
          from.set(key(nx, ny), key(cur.tx, cur.ty));
          queue.push({ tx: nx, ty: ny, c: newCost });
        }
      }
    }
    return { dist, from };
  }

  // CHARGE LANES — a Charge unit may DASH in a straight diagonal line (the decompiled `x()` g15 lane test accepts
  // `dx==0 || dy==0 || |dx|==|dy|`), but this is NOT free movement: a charge is an ATTACK. A diagonal tile is
  // reachable ONLY as the LAUNCH point of a real charge — a straight run-up of ≥2 tiles with an enemy (any type:
  // the +30 is the rider's charging flag) in the very next tile along the same lane. We record the lane in dist/from
  // for the dash path and expose ONLY that launch tile as a stop, so a charger can't glide diagonally onto open
  // ground. createChargeTargetList counts a diagonal step's terrain TWICE and the foe's own tile against the move.
  _addChargeLanes(u, moveBudget, dist, from, stops) {
    const chargeable = (f) => !!f && f.team !== u.team && !f.dead;
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const lane = [];
      let cost = 0,
        x = u.tx,
        y = u.ty;
      for (let step = 1; step <= moveBudget; step++) {
        x += dx;
        y += dy;
        if (!this.inBounds(x, y)) break;
        if (this.moveCost(u, x - dx, y) >= 99 && this.moveCost(u, x, y - dy) >= 99) break; // no corner-cut through two walls
        const stepCost = this.moveCost(u, x, y, x - dx, y - dy);
        if (stepCost >= 99) break;
        cost += stepCost * 2;
        if (cost > moveBudget + 1e-6) break;
        if (this.unitAt(x, y)) break; // can't gallop through a unit (friend or foe)
        lane.push({ x, y, c: cost });
        // A valid charge LAUNCH: ≥2-tile run-up (target > 2 from the start, createChargeTargetList) and a
        // chargeable enemy one more step along this same diagonal.
        if (
          step >= 2 &&
          chargeable(this.unitAt(x + dx, y + dy)) &&
          cost + this._chargeStep(u, x, y, x + dx, y + dy, { dx, dy }) <= moveBudget + 1e-6
        ) {
          let prev = key(u.tx, u.ty);
          for (const laneTile of lane) {
            // commit the straight lane so pathTo() → a diagonal charge run
            const stepKey = key(laneTile.x, laneTile.y);
            if (!dist.has(stepKey) || laneTile.c <= dist.get(stepKey)) {
              dist.set(stepKey, laneTile.c);
              from.set(stepKey, prev);
            }
            prev = stepKey;
          }
          stops.add(key(x, y)); // the launch tile is reachable — to charge FROM, not to loiter on
        }
      }
    }
  }

  // Terrain-aware TRAVEL distance from (sx,sy) to every tile for unit `u`, with NO movement-budget cap
  // (a full 4-directional flood-fill), matching computeReach's orthogonal movement. Units are treated
  // as passable here — this is a distance estimate, not a reservation. The AI uses it so a unit advances by how
  // far a tile actually is to WALK (matching the original's terrain-aware pathfinding `x.a`), not by straight-line
  // manhattan: an enemy behind a band of rough/forest is correctly "farther" than one across open ground, so the
  // warband takes the open lane to the main force instead of slogging toward a nearer-as-the-crow-flies unit.
  //
  // WARP PORTALS (Ep2): Unit::getDistance (iOS Ep2 @0x65da8) adds, for every portal the unit's army may use
  // (Mission::canUsePortal), cost(unit → portal entry) + cost(portal exit → target) and keeps the cheaper route — so the
  // original AI walks THROUGH portals to reach a foe it can't walk to (The Wizard's Palace: the attackers' side joins
  // the palace only by the (14,7) ↔ (3,6) gate). The flood takes the same shortcut: `reverse` = false (a field FROM
  // the unit): standing on a usable entry pad also reaches its exit at no extra cost (the warp); `reverse` = true (a
  // field FROM a target, read as "cost to walk from this tile TO the target"): an exit pad also reaches its entry pad
  // for the cost of stepping onto the entry.
  pathField(u, startX, startY, reverse = false, usePortals = true) {
    const dist = new Map();
    dist.set(key(startX, startY), 0);
    const queue = [{ tx: startX, ty: startY, c: 0 }];
    const portals =
      usePortals && this.portals && this.portals.length ? this.portals.filter((p) => this._portalUsable(p, u)) : null;
    const relax = (nx, ny, newCost) => {
      const cellKey = key(nx, ny);
      if (!dist.has(cellKey) || newCost < dist.get(cellKey)) {
        dist.set(cellKey, newCost);
        queue.push({ tx: nx, ty: ny, c: newCost });
      }
    };
    while (queue.length) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].c < queue[bestIdx].c) bestIdx = i;
      const cur = queue.splice(bestIdx, 1)[0];
      if (cur.c > dist.get(key(cur.tx, cur.ty))) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        // 4-directional, matching P()/a.j.c (see computeReach)
        const nx = cur.tx + dx,
          ny = cur.ty + dy;
        if (!this.inBounds(nx, ny)) continue;
        const stepCost = this.moveCost(u, nx, ny, cur.tx, cur.ty);
        if (stepCost >= 99) continue;
        relax(nx, ny, cur.c + stepCost);
      }
      if (portals)
        for (const portal of portals) {
          if (!reverse && portal.sx === cur.tx && portal.sy === cur.ty && this.inBounds(portal.dx, portal.dy))
            relax(portal.dx, portal.dy, cur.c);
          if (reverse && portal.dx === cur.tx && portal.dy === cur.ty && this.inBounds(portal.sx, portal.sy)) {
            const stepCost = this.moveCost(u, portal.sx, portal.sy);
            if (stepCost < 99) relax(portal.sx, portal.sy, cur.c + stepCost);
          }
        }
    }
    return dist;
  }

  pathTo(reach, tx, ty) {
    const path = [];
    let k = key(tx, ty);
    while (k) {
      const [x, y] = k.split(",").map(Number);
      path.unshift({ tx: x, ty: y });
      k = reach.from.get(k);
    }
    return path;
  }

  // True if a target `d` tiles away falls inside EITHER of the unit's two weapon bands. Most units' bands are
  // contiguous (so this equals minRange..range), but the CANNON's are Grapeshot [1,1] + Cannonball [3,10] with a GAP
  // at range 2 — the merged minRange..range would wrongly include 2, so a foe exactly 2 tiles off could be shelled
  // (which the original can't do). Checking each real band keeps that dead zone empty.
  // MOVE OR SHOOT is a WEAPON rule — Unit::doesValidAttackExist (iOS Ep2 @0x74c1c, Ep1 the same): once the unit has
  // moved this turn (Unit+0x112), a weapon carrying the "Move or Shoot" tag (7) can't be used, unless the unit has
  // Shoot and Move (8). Its other weapon still can: an Archer / Crossbowman / Musketeer that moved may still use its
  // Short Sword on an adjacent foe, Craftsmen their Mallet; siege engines have no untagged weapon, so they can't.
  _weaponLockedAfterMove(u, weapon) {
    return !u.T.shootMove && (WEAPON_TAGS[weapon] || []).includes(7);
  }
  _movedThisTurn(u) {
    return u._movedTurn != null && u._movedTurn === this.turn;
  }
  // The threat squares — GameScreen::highlightThreatAt → Unit::prepareThreat (iOS Ep2 @0x7a20c, Ep1 the same): "where
  // the selected unit can attack during its next turn" (string 797). Wizards: every tile within 13; the Cannon:
  // within 10 (its dead range 2 included). Everyone else asks Unit::canAttack(tile) (@0x79c00) per weapon slot,
  // skipping Grapeshot (24) and Shock (34): a Move-or-Shoot (7) / Shoot-and-Move (8) weapon covers its min..max band
  // from the tile the unit STANDS on — no move first; any other weapon is a blow: an adjacent tile, or — unless it
  // has moved this turn (Unit+0x112) — a tile with an EMPTY orthogonal neighbour it can walk to (Map::calcShortestPath
  // within its full move: prepareThreat clears the group, so no group pace; a slowed Hero is also held to 4 + 1
  // tiles). No charge lanes.
  threatOf(u) {
    const out = new Set();
    const add = (x, y) => {
      if (this.inBounds(x, y)) out.add(key(x, y));
    };
    const band = (lo, hi) => {
      for (let dy = -hi; dy <= hi; dy++)
        for (let dx = -hi; dx <= hi; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d >= lo && d <= hi) add(u.tx + dx, u.ty + dy);
        }
    };
    const radius = { wizards: 13, cannon: 10 }[u.type];
    if (radius) {
      band(0, radius);
      return out;
    }
    let blow = false;
    for (const weapon of [u.T.weapon || 3, u.T.weapon2]) {
      if (!weapon || weapon === 24 || weapon === 34) continue;
      const tags = WEAPON_TAGS[weapon] || [];
      if (tags.includes(7) || tags.includes(8)) {
        const range = WEAPON_RANGE[weapon] || [1, 1];
        band(range[0], range[1]);
      } else blow = true;
    }
    if (!blow) return out;
    band(1, 1);
    if (this._movedThisTurn(u)) return out;
    const move = u.T.move || 4,
      { dist } = this._walkReach(u, u.slowed ? Math.trunc((move * 3) / 4) : move);
    const cap = (u.type === "king" ? (u.slowed ? 4 : 8) : move) + 1;
    for (const k of dist.keys()) {
      const [x, y] = k.split(",").map(Number);
      if (this.unitAt(x, y)) continue; // the unit's own tile too: its neighbours are the band(1, 1) above
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (Math.abs(x + dx - u.tx) + Math.abs(y + dy - u.ty) <= cap) add(x + dx, y + dy);
    }
    return out;
  }
  _inWeaponRange(u, dist, moved) {
    const primary = u.T.weapon || 3,
      secondary = u.T.weapon2;
    const inBand = (weapon) => {
      const range = WEAPON_RANGE[weapon];
      return !!range && dist >= range[0] && dist <= range[1] && !(moved && this._weaponLockedAfterMove(u, weapon));
    };
    return inBand(primary) || (!!secondary && inBand(secondary));
  }
  // `moved` — judge as a unit that has moved this turn (default: it has, and is asked about its own tile).
  targetsFrom(u, tx, ty, moved) {
    const hasMoved = moved != null ? moved : this._movedThisTurn(u) && tx === u.tx && ty === u.ty;
    const out = [];
    for (const other of this.units) {
      if (other.dead || other.team === u.team || this._isHidden(other)) continue; // can't target a hidden (Stealth) unit
      const dist = Math.abs(other.tx - tx) + Math.abs(other.ty - ty); // manhattan — melee range 1 = ORTHOGONAL neighbour only
      // real weapon-band range (gap-aware for the cannon), OR a charge reach: predicted before the move (_chargeReaches
      // — a straight ≥3 lane into the next tile) and, once the unit has actually charged, the foe DIRECTLY AHEAD in the
      // charge lane (u.tx+dx, u.ty+dy) — NOT just any Chebyshev-1 foe, or a charged unit could hit any neighbour.
      const charged =
        u.chargeDir &&
        u.T.hasCharge &&
        u.T.range === 1 &&
        tx === u.tx &&
        ty === u.ty &&
        other.tx === u.tx + u.chargeDir.dx &&
        other.ty === u.ty + u.chargeDir.dy;
      if (this._weaponUselessVs(u, other, dist) && !this._chargeReaches(u, tx, ty, other) && !charged) continue; // Boulder / Cannonball can't hit fliers
      if (this._inWeaponRange(u, dist, hasMoved) || this._chargeReaches(u, tx, ty, other) || charged) out.push(other);
    }
    return out;
  }
  // FEAR is NOT an attack-block (canAttack has no gate) — it's a COURAGE CHECK in Unit::attack: a unit attacking a
  // Griffon/Bear rolls random vs getCourage(); on failure it balks (no attack, turn ends). Implemented in doAttack
  // (rules/combat) via _courage(); targeting a Fear unit is always allowed — the balk happens when the blow is thrown.
  // HIDDEN — a state, as in the original (Unit+0x251, Unit::setIsHidden @0x656b0), for units with Stealth or Ambush:
  //   • HIDES at battle start / when spawned (GameScreen::createUnitAt), at the end of its own turn if it did not attack
  //     (Unit::endTurn @0x752fe), and — an Ambush unit — when a move ends (doFinishMoving @0x7729e), each only if it
  //     can hide (Unit::canHide @0x65fd8: its OWN tile gives cover — tile defence ≤ 90 — and no living enemy stands
  //     next to it); at the end of its turn a unit that attacked or cannot hide is revealed instead;
  //   • REVEALED when it attacks (it is drawn and targetable from its strike on), when it is damaged (applyDamage),
  //     when a foe steps next to it (_bumpAmbush), or when an enemy with Spot (ability 6) takes its turn within 4 of it
  //     (GameScreen::activateControlState @0x26476).
  // Hidden units are untargetable and drawn faintly. The moment it hides its tile is kept (Unit+0x13c) as where it was
  // last seen; the AI measures a hidden foe from there (getDistance). (A Stealth unit hides mid-turn only with a charge
  // at Unit+0x288 that no ported command sets.)
  _isHidden(u) {
    return !!(u && u._hidden && !u.dead && !u.attackedTurn);
  }
  _setHidden(u, hidden) {
    if (hidden && !u._hidden) u._lastSeen = { tx: u.tx, ty: u.ty };
    u._hidden = !!hidden;
  }
  _canHideUnit(u) {
    return !!(u.T.stealth || u.ambush || u.T.ambush);
  }
  _canHide(u) {
    const tileDamagePct = Math.round(100 - (this.terrainAt(u.tx, u.ty).defBonus || 0) * 100);
    if (tileDamagePct > 90) return false;
    return !this.units.some((o) => !o.dead && o.team !== u.team && manhattan(o, u) === 1);
  }
  // Unit::endTurn's rule, for the units whose turn just ended.
  _endTurnHide(units) {
    for (const u of units) {
      if (u.dead || !this._canHideUnit(u)) continue;
      this._setHidden(u, !u.attackedTurn && this._canHide(u));
    }
  }
  // A unit with Spot reveals the hidden enemies within 4 of it when its turn comes.
  _spotReveal(u) {
    if (!u || !u.T.spot) return;
    for (const e of this.units)
      if (!e.dead && e.team !== u.team && e._hidden && manhattan(e, u) <= 4) this._setHidden(e, false);
  }
}
