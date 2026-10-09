/* ============================================================
   Reign of Swords — the enemy / allied AI "brain".
   The per-unit tactical AI, ported from the iOS Ep2 binary: the driver
   GameScreen::aiUpdate (per-unit priority of Unit::aiConsiderAction states),
   the movers (getBestMoveLocation / Ranged / Horsebowmen / Charge / Priest,
   checkOpportunityMove) and the attack scoring (determineBestAttack /
   calcDamageRatio). Part of the AiController (ai/controller.js): `this` is the
   controller, and the battle is `this.game` — its state and its own helpers
   (computeReach / moveUnit / doAttack …). Only pure data (DEPLOY_COST /
   UNIT_TYPES) and geometry helpers are imported; the active mission is
   `this.game.mission`.
   ============================================================ */

import { key, manhattan, cheb, FAR } from "../util/util.js";
import { UNIT_TYPES, DEPLOY_COST } from "../data/game-data.js";

import { WEAPON_RANGE, WEAPON_TAGS, BLAST_SHARE } from "../data/combat-data.js";

import { tileType } from "../rules/terrain.js";

// The score bands the AI's tile / target choice compares (_aiPickAttack): any attack beats any plain move, a
// charge beats any ordinary attack, a ranged mover's firing position beats an ordinary advance. Within a band the
// attack's damage ratio (or the position's distance and support) orders the options.
const SCORE = {
  NONE: -1e4, // nothing chosen yet
  RANGED_MOVE: 1e4, // + 1000 per tile from the nearest foe + the support tie-break
  ATTACK: 1e6, // + 100 × damage ratio (a blast: + 10 × its coverage)
  CHARGE: 1e6 + 5e5, // + 100 × the summed ratio of every unit the ride strikes
};

// Area-attack blast shapes for the AI's scoring (_aiAreaScore): [dx, dy, damage share] around the aim tile. The
// shares are the real startAreaAttack table (BLAST_SHARE): Fireball 100 + 60 cross (also the catapult's Barrage
// Rock), Lightning 55 over a 3×3, Ice 100 over a 2×2.
const AREA_CROSS = [
  [0, 0, 1],
  [1, 0, BLAST_SHARE[25][1] / 100],
  [-1, 0, BLAST_SHARE[25][1] / 100],
  [0, 1, BLAST_SHARE[25][1] / 100],
  [0, -1, BLAST_SHARE[25][1] / 100],
];
const AREA_SQ3 = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
].map(([x, y]) => [x, y, BLAST_SHARE[26][0] / 100]);
const AREA_ICE = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
].map(([x, y]) => [x, y, BLAST_SHARE[27][0] / 100]);
// The 7 aim tiles tried around each foe: its own, the 4 orthogonal neighbours and the (+1,+1) / (−1,−1) diagonals
// (the original's static tables C.807/C.808).
const AIM_OFFSETS = [
  [0, 0],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, -1],
];

// DELIBERATE DEVIATION (user decision) — TOWN GARRISONS. In the original, allies a script spawns away from a group
// marker (Mission::getLocationGroup = -1, so GameScreen::createUnitAt gives them no GroupLogic) march on the nearest
// foe at once: Warning Caladrin's round-4/7 reinforcements and the (5,1) militia left the town to join the fight
// long before the escort got near. Here the map's allies run the original AI unchanged, except that their moves are
// confined to the fort (`area`) — one tile past its wall only to strike a foe standing there — until one of the
// player's units comes out of a portal whose exit pad is listed in `releaseExits` (the two last gates, north of the
// ridge). From then on they are free.
const ALLY_GARRISON = {
  5428: {
    area: { x0: 4, y0: 0, x1: 15, y1: 2 },
    releaseExits: [
      [16, 8],
      [2, 9],
    ],
  },
};
const inArea = (a, s) => s.tx >= a.x0 && s.tx <= a.x1 && s.ty >= a.y0 && s.ty <= a.y1;
const sallyArea = (a) => ({ x0: a.x0 - 1, y0: a.y0 - 1, x1: a.x1 + 1, y1: a.y1 + 1 }); // the fort + one tile out

export class AiMethods {
  aiStep() {
    const SELF = this.game._aiSelf || "red",
      foeTeam = this.game._aiFoe || "blue",
      SIDE = this.game._aiPhase || "enemy";
    // A unit on the acting side (the ally phase's SELF is the blue ALLIES only, not the player's own units).
    const isMine = (o) => o.team === SELF && (SELF !== "blue" || !!o.ally === !!this.game._aiAlly);
    const GTAB = SIDE === "ally" ? this.game.mission.allyGroups : this.game.mission.enemyGroups;
    const u = this._aiNextUnit();
    if (!u) return;
    this.game._spotReveal(u); // Spot (ability 6): hidden foes within 4 are revealed on its turn
    const enemies = this.game.units.filter((e) => !e.dead && e.team === foeTeam && !this.game._isHidden(e)); // targets: Stealth units are unseen
    const foes = this.game.units.filter((e) => !e.dead && e.team === foeTeam); // getClosestEnemy also counts hidden ones (as 50 away)
    if (!foes.length) return this._aiNoFoesLeft(u);
    if (this._aiAnnounceFaction(u, SIDE, GTAB)) return;
    this.game.aiQueue.shift(); // consume this unit now that its faction is announced
    this.game._orderField = null;
    this._aiUpdateGroup(u, isMine, foes, SELF);
    const reach = this.game.computeReach(u);
    if (!enemies.length) return this._aiAllFoesHidden(u, reach, foes);
    const stops = this._aiLeashedStops(u, reach);

    // SHOOT-AND-MOVE (ability 8 — Horse Bowmen / Rangers). Horse Bowmen fire WHILE RIDING (engine/input _hbRideStep) and
    // the ride counts as their attack; GameScreen::aiUpdate phase 3 skips their stand-still shot (they ride first).
    // HORSE BOWMEN (unit type 14 only — Rangers use the generic ranged mover): Unit::getBestMoveHorsebowmen, see
    // _horseBowRun. Falls through to the strafe below only when neither a shot nor a kiting ride is available.
    if (u.T.mountedArcher && this._horseBowRun(u, enemies)) return;
    // Other Shoot-and-Move units (Rangers): phase 3's createSortedTargetList looks for a shot from where the unit
    // STANDS; after shooting, a Shoot-and-Move unit still moves (isAbilityAvailable(8) → phase 4, the ranged mover).
    // With nothing to shoot it moves first (the generic loop below) and shoots from where it lands.
    if (!u.T.mountedArcher && u.T.shootMove && this._rangerRun(u, enemies)) return;

    // WIZARD (Magic, ability 22) — Unit::aiConsiderAction state 10 → aiConsiderAreaAttack (iOS Ep2 @0x79988): the
    // spell is judged FROM THE TILE THE WIZARD STANDS ON (its position, never a tile it could walk to). If a cast
    // scores > 0 it casts now; otherwise it moves like any other unit (the generic getBestMoveLocation: group order /
    // closest foe — the original has no cast-driven move for Magic users, which is why it never dives through a
    // crowd to reach a far target) and judges again from where it lands. See _aiBestArea.
    // The same state-10 check covers the cannon's Grapeshot and the catapult's Barrage (both only before moving —
    // they are Move-or-Shoot, so only the wizard re-judges after a move).
    let wizMove = false;
    const noAttack = !!u.T.prayer; // phase 3 skips createSortedTargetList for unit type 22 — a Priest never makes a normal attack
    if (u.T.warEngine && u.team === "blue" && this._aiTrySiegePoint(u)) return;
    if (u.T.canLightning && this._aiTryWizStandoff(u, reach, enemies)) return;
    if (u.T.canLightning || u.T.grapeshot || u.T.weapon === 34 || (u.T.abilities || []).includes(25)) {
      const area = this._aiBestArea(u);
      if (area) {
        this._aiCast(u, area);
        return;
      }
      wizMove = !!u.T.canLightning;
    }
    // The real per-unit AI (`La/q.y()`) is a role-based state machine. `at` is the real AI value
    // `((cost−50)·50/450)+50` (50 cheapest → 100 Hero). Each role branch below is ported from a case.
    // The special roles, in the original phase-3 order (each method carries its decompiled rule).
    if (u.T.heal && this._aiTryHeal(u, reach, enemies, stops, SELF)) return;
    if ((u.T.shapeshift || u._druidType) && u._shiftTurn !== this.game.turn) this._aiPickDruidForm(u, enemies);
    if (u.T.quicksand && this._aiTryQuicksand(u, reach)) return;
    if (u.T.conjure && this._aiTryConjure(u, reach)) return;
    if ((u.T.repair || u.T.build) && this._aiTryCraftsmen(u, reach)) return;
    if (u.type === "bodyguard" && u._conjuredBy != null && this._aiTryAbsorb(u, reach)) return;
    if (u.T.detonate && this._aiTryDetonate(u, reach, enemies)) return;
    this._aiFightOrAdvance(u, { reach, stops, enemies, foes, wizMove, noAttack, foeTeam });
  }

  // The next unit of the acting side — peeked, not consumed yet (null: the side is done, its phase ended).
  // TURN ORDER — Mission::getNextUnit (iOS Ep2 @0x5fab0) first asks Mission::getRemainingAttackers (Ep2 @0x5e508, Ep1
  // @0x50a68 the same bar its Ep2-only first pass), then hands out the rest — re-picked every time a unit finishes.
  // Within the faction now acting, the first unit (queue order) of the first pass that has one goes to the front.
  _aiNextUnit() {
    let u = null;
    while (this.game.aiQueue.length && !u) {
      const next = this.game.aiQueue[0];
      if (next.dead) this.game.aiQueue.shift();
      else u = next;
    } // peek, don't consume yet
    if (!u) {
      this.game._endAiPhase();
      return null;
    }
    {
      const groupIdx = u.group || 0;
      const pick = this._aiRemainingAttacker(this.game.aiQueue.filter((c) => !c.dead && (c.group || 0) === groupIdx));
      const idx = pick ? this.game.aiQueue.indexOf(pick) : -1;
      if (idx > 0) {
        this.game.aiQueue.splice(idx, 1);
        this.game.aiQueue.unshift(pick);
        u = pick;
      }
    }
    return u;
  }
  // Mission::getRemainingAttackers — the passes, each taking the first not-yet-acted unit that qualifies:
  //   1. (Ep2) a Sapper with a target · any Bodyguard · a Conjurer whose Conjure is ready (isAbilityAvailable 34)
  //   2. war engines — Catapult, Trebuchet, Cannon, Ballistae — with a target
  //   3. Archers, Crossbowmen, Musketeers with a target
  //   4. Wizards, Horse Bowmen, Rangers whose closest enemy is within 8 (getClosestEnemy)
  //   5. everyone else with a target — except Priests and Griffon Riders
  //   6. Griffon Riders with a target — they go last.
  // "A target" is Unit::createSortedTargetList: a foe it can move up to and strike this turn (canAttack weighs the path
  // against its movement), that its group lets it take (isValidFormationTarget).
  _aiRemainingAttacker(pool) {
    const has = (c) => this._aiHasTarget(c);
    const of =
      (...types) =>
      (c) =>
        types.includes(c.type);
    const passes = [
      (c) =>
        (c.type === "sapper" && has(c)) || c.type === "bodyguard" || (c.type === "conjurer" && this._aiConjureReady(c)),
      (c) => of("catapult", "trebuchet", "cannon", "ballistae")(c) && has(c),
      (c) => of("archers", "crossbowmen", "musketeers")(c) && has(c),
      (c) => of("wizards", "horsebowmen", "rangers")(c) && this._aiClosestFoeDist(c) <= 8,
      (c) => c.type !== "priests" && c.type !== "griffon" && has(c),
      (c) => c.type === "griffon" && has(c),
    ];
    for (const pass of passes) {
      const found = pool.find(pass);
      if (found) return found;
    }
    return null;
  }
  _aiHasTarget(c) {
    const reach = this.game.computeReach(c);
    for (const k of reach.stops) {
      const [x, y] = k.split(",").map(Number);
      const moved = x !== c.tx || y !== c.ty;
      for (const e of this.game.targetsFrom(c, x, y, moved))
        if (this._glValidTarget(c, { tx: x, ty: y }, e)) return true;
    }
    return false;
  }
  _aiClosestFoeDist(c) {
    let best = FAR;
    for (const e of this.game.units)
      if (!e.dead && e.team !== c.team && !this.game._isHidden(e)) best = Math.min(best, manhattan(e, c));
    return best;
  }
  // Unit::isAbilityAvailable(34) (@0x74f46): at most 1 conjured child alive and a free orthogonal tile to put one on.
  _aiConjureReady(c) {
    if (this.game.units.filter((o) => !o.dead && o._conjuredBy === c.id).length >= 2) return false;
    return [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].some(([dx, dy]) => {
      const x = c.tx + dx,
        y = c.ty + dy;
      return this.game.inBounds(x, y) && !this.game.unitAt(x, y) && this.game.terrainAt(x, y).passable;
    });
  }

  // NO ENEMY LEFT — getBestMoveLocation (iOS Ep2 @0x7db80): the unit heads for the closest capture-zone tile
  // (Unit::getClosestGoal @0x66074 — nearest by straight distance over every zone's tiles); no zone → it stays.
  _aiNoFoesLeft(u) {
    const goal = this._oClosestGoal(u);
    if (!goal) {
      this.game._endAiPhase();
      return;
    }
    this.game.aiQueue.shift();
    const reach = this.game.computeReach(u),
      stopSet = new Set(reach.stops),
      moveOrder = this._oMoveOrder(u, stopSet);
    const best = u.T.teleport
      ? this._oWizardMove(u, goal, reach, moveOrder)
      : this._oGenericMove(u, goal, reach, stopSet, moveOrder, null, 0);
    if (best.tx === u.tx && best.ty === u.ty) {
      u.acted = true;
      this.game.aiDelay = 0;
      this.game._emit();
      return;
    }
    this.game.reach = reach;
    this._aiPanThen((u.tx + best.tx) / 2, (u.ty + best.ty) / 2, () =>
      this.game.moveUnit(u, this.game.pathTo(reach, best.tx, best.ty), () => {
        u.acted = true;
        this.game.aiDelay = 0.25;
        this.game._emit();
      }),
    );
    return;
  }

  // Announce each FACTION as it takes the field — its crest + name + turns left — then pause before it moves.
  // Returns true when it announced (the unit acts on the next step).
  _aiAnnounceFaction(u, side, groups) {
    if (groups && Object.keys(groups).length > 1 && this.game._lastAiGroup !== (u.group || 0)) {
      this.game._lastAiGroup = u.group || 0;
      this.game._announceTurn(side, u.group || 0);
      this.game.aiDelay = 0.9;
      this.game._emit();
      return true;
    }
    return false;
  }

  // GroupLogic::updateGroup — the ORIGINAL group layer (ai/grouplogic.js): centre, pace, destination by enemy
  // concentration, path, NEXT and formation slots for a marching (mode 2) group; a passive group is ordered
  // to its own centre. Runs once per group per round.
  _aiUpdateGroup(u, isMine, foes, self) {
    const groupCount = this._glGroupOf(u);
    if (groupCount != null)
      this._glUpdate(
        groupCount,
        this.game.units.filter((o) => !o.dead && isMine(o) && this._glGroupOf(o) === groupCount),
        foes,
        self,
      );
  }

  // EVERY FOE HIDDEN — nothing to strike, but getClosestEnemy still returns one (as 50 away), so the unit moves as
  // usual: a hold group's move, else its group order, else the closest foe's tile (or its portal) — the movers.
  _aiAllFoesHidden(u, reach, foes) {
    const closest = this._oClosestEnemy(u, foes),
      order = this._glOrder(u),
      stopSet = new Set(reach.stops),
      moveOrder = this._oMoveOrder(u, stopSet);
    const foeDist = u._portalIdx >= 0 ? u._portalDist : manhattan(u, closest.e);
    const isWiz = u.T.teleport;
    const mover = (dest) =>
      isWiz
        ? this._oWizardMove(u, dest, reach, moveOrder)
        : this._oGenericMove(u, dest, reach, stopSet, moveOrder, closest.e, foeDist);
    let dest;
    if (order && order.hold) {
      dest = this._aiOpportunity(
        u,
        this._oFindClosestMove(u, order, moveOrder),
        reach,
        !!(u.T.harasser || u.T.canLightning || u.T.magic),
      );
      const tdef = (x, y) => Math.round(100 - (this.game.terrainAt(x, y).defBonus || 0) * 100);
      if (tdef(u.tx, u.ty) < tdef(dest.tx, dest.ty) && manhattan(u, order) <= 5) dest = { tx: u.tx, ty: u.ty };
    } else if (order) dest = { tx: order.tx, ty: order.ty };
    else {
      const portal = u._portalIdx >= 0 && this.game.portals ? this.game.portals[u._portalIdx] : null;
      dest = portal ? { tx: portal.sx, ty: portal.sy } : { tx: closest.e.tx, ty: closest.e.ty };
    }
    const best = mover(dest);
    if (best.tx === u.tx && best.ty === u.ty) {
      u.acted = true;
      this.game.aiDelay = 0;
      this.game._emit();
      return;
    }
    this.game.reach = reach;
    this._aiPanThen((u.tx + best.tx) / 2, (u.ty + best.ty) / 2, () =>
      this.game.moveUnit(u, this.game.pathTo(reach, best.tx, best.ty), () => {
        u.acted = true;
        this.game.aiDelay = 0.25;
        this.game._emit();
      }),
    );
    return;
  }

  // EPISODE II — Leashing (iOS createLeashingRangeLoc range = 8): a conjured child must stay within 8 tiles of
  // its living conjurer. Filter its reachable stops to that leash; if it has drifted out, keep only the stops
  // that step it back toward the conjurer so it returns to the leash.
  _aiLeashedStops(u, reach) {
    const garrison = this._garrisonOf(u);
    let stops = [...reach.stops].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { tx: x, ty: y };
    });
    if (u._conjuredBy != null) {
      const conjurer = this.game.units.find((o) => !o.dead && o.id === u._conjuredBy);
      if (conjurer) {
        const inLeash = stops.filter((s) => manhattan(s, conjurer) <= 8);
        if (inLeash.length) stops = inLeash;
        else {
          const leashDist = manhattan(u, conjurer);
          stops = stops.filter((s) => manhattan(s, conjurer) < leashDist);
          if (!stops.length) stops = [{ tx: u.tx, ty: u.ty }];
        }
      }
    }
    if (garrison) {
      // confined to the fort (+ one tile out, where _aiCarryOut lets it go only to strike)
      const inFort = stops.filter((s) => inArea(sallyArea(garrison.area), s));
      stops = inFort.length ? inFort : [{ tx: u.tx, ty: u.ty }];
    }
    // your own units under the 🤖 Autopilot: the strategy may keep them to their ground (ai/autopilot.js Hold the fort)
    if (this.game.autopilot && u.team === "blue" && !u.ally) stops = this._apStops(u, stops);
    return stops;
  }

  // TOWN GARRISON (deviation, see ALLY_GARRISON): the map's garrison rule while it still holds `u`, else null.
  _garrisonOf(u) {
    const garrison = ALLY_GARRISON[this.game.mission && this.game.mission.mapId];
    return garrison && u && u.team === "blue" && u.ally && !this.game._garrisonReleased ? garrison : null;
  }
  // Called after a portal warp (engine/grid _portalWarp): one of the player's units out of a release gate frees it.
  _garrisonCheckRelease(u, portal) {
    const garrison = ALLY_GARRISON[this.game.mission && this.game.mission.mapId];
    if (!garrison || this.game._garrisonReleased || u.team !== "blue" || u.ally) return;
    if (!garrison.releaseExits.some(([x, y]) => x === portal.dx && y === portal.dy)) return;
    this.game._garrisonReleased = true;
    this.game.notify("The town's defenders march out to meet you.");
  }

  // ALLIED SIEGE — aiConsiderAction state 15 (iOS Ep2 @0x7c98a), tried before the area attack: see _siegePointShot.
  _aiTrySiegePoint(u) {
    const siegePoint = this._siegePointShot(u);
    if (siegePoint) {
      this._aiCast(u, { tx: siegePoint.tx, ty: siegePoint.ty });
      return true;
    }
    return false;
  }

  // HEAL, HAVING MOVED — aiConsiderAction state 3 with the moved flag set (Ep2 @0x7c75a; Android case 3: range 1 once
  // `S`): the adjacent wounded ally (itself included — startHeal) with the most missing HP × value. Returns false
  // when there is none.
  _aiHealAdjacent(u, self, finish) {
    let target = null,
      targetScore = 0;
    for (const a of this.game.units) {
      if (a.dead || a.team !== self || a.hp >= 100 || manhattan(a, u) > 1) continue;
      const score = (100 - a.hp) * this._aiValue(a);
      if (score > targetScore) {
        targetScore = score;
        target = a;
      }
    }
    if (!target) return false;
    u.face = Math.sign(target.tx - u.tx) || u.face || 1;
    this.game.anim = { type: "attack", u, target, t: 0, hitDone: false, heal: true, done: finish };
    u.attacking = true;
    u.anim = 0;
    u.animT = 0;
    this.game._emit();
    return true;
  }

  // WIZARD STANDOFF — aiConsiderAction state 9 (iOS Ep2 @0x7ce06), tried BEFORE the area attack: see _wizStandoff.
  _aiTryWizStandoff(u, reach, enemies) {
    const standoff = this._wizStandoff(u, reach, enemies);
    if (standoff) {
      this.game.reach = reach;
      this._aiPanThen((u.tx + standoff.tx) / 2, (u.ty + standoff.ty) / 2, () =>
        this.game.moveUnit(u, this.game.pathTo(reach, standoff.tx, standoff.ty), () => {
          const area = u.dead ? null : this._aiBestArea(u);
          if (area) this._aiCast(u, area);
          else {
            u.acted = true;
            this.game.aiDelay = 0.25;
            this.game._emit();
          }
        }),
      );
      return true;
    }
    return false;
  }

  // ROLE — HEALER (case 3): a priest heals the ally maximising (missingHP × value) if one is hurt and
  // it can reach an adjacent tile, instead of attacking.
  // PRIEST — the iOS phase-3 order for a Priest: aiConsiderAction state 6 (@0x7d25e) first — not yet moved, it moves
  // by getBestMovePriest (a foe within 10; a priest its group gives a move order just follows the group); having
  // moved, it invokes a prayer (_priestPray) — then state 3, Heal (Old Priests: Heal only). A Priest never prays
  // before its move step.
  // (Praying where it stands happens once, at battle start — GameScreen::gameStateUpdate state 2, engine/turnflow
  // _battleStartPrayers — not on its turns.)
  _aiTryHeal(u, reach, enemies, stops, self) {
    const priestPlan = u.T.prayer && !this._glOrder(u) ? this._priestMove(u, reach, enemies) : null;
    if (priestPlan) {
      this.game.reach = reach;
      const finish = () => {
        u.acted = true;
        this.game.aiDelay = 0.25;
        this.game._emit();
      };
      const land = () => {
        if (u.dead) return finish();
        if (this._priestPray(u, enemies, finish)) return;
        if (this._aiHealAdjacent(u, self, finish)) return; // no prayer → Heal an adjacent wounded ally, if any
        if (!this._priestPray(u, enemies, finish, true)) finish(); // neither: the driver's own Shield
      };
      this._aiPanThen((u.tx + priestPlan.tx) / 2, (u.ty + priestPlan.ty) / 2, () =>
        this.game.moveUnit(u, this.game.pathTo(reach, priestPlan.tx, priestPlan.ty), land),
      );
      return true;
    }
    let hTgt = null,
      hSpot = null,
      hScore = 0;
    for (const spot of stops)
      for (const a of this.game.units) {
        if (a.dead || a.team !== self || a.hp >= 100) continue;
        if ((a === u ? 0 : manhattan(a, spot)) > 1) continue; // the priest itself heals wherever it stands
        const score = (100 - a.hp) * this._aiValue(a);
        if (score > hScore) {
          hScore = score;
          hTgt = a;
          hSpot = spot;
        }
      }
    // state 3 before the move: when the best patient is the healer itself, the heal waits for the move step (Android
    // case 3 `(best != this) || S`; iOS Ep2 @0x7c75a) — it heals itself where it lands (_aiAfterMove)
    if (hTgt === u) hTgt = null;
    if (hTgt) {
      this.game.reach = reach;
      const doHeal = () => {
        if (u.dead || hTgt.dead) {
          u.acted = true;
          this.game.aiDelay = 0.25;
          this.game._emit();
          return;
        }
        u.face = Math.sign(hTgt.tx - u.tx) || u.face || 1; // play the priest's heal animation, then mark it acted
        this.game.anim = {
          type: "attack",
          u,
          target: hTgt,
          t: 0,
          hitDone: false,
          heal: true,
          done: () => {
            u.acted = true;
            this.game.aiDelay = 0.25;
            this.game._emit();
          },
        };
        u.attacking = true;
        u.anim = 0;
        u.animT = 0;
        this.game._emit();
      };
      const healMoves = hSpot.tx !== u.tx || hSpot.ty !== u.ty;
      this._aiPanThen((u.tx + hTgt.tx) / 2, (u.ty + hTgt.ty) / 2, () => {
        if (healMoves) this.game.moveUnit(u, this.game.pathTo(reach, hSpot.tx, hSpot.ty), doHeal);
        else doHeal();
      });
      return true;
    }
    return false;
  }

  // ROLE — DRUID — aiConsiderAction state 2 (iOS Ep2 @0x7bd94, its Bear test Ep1 @0x664c6; the Android a.q case 2) for a
  // druid in ANY of its forms, at most one shift a turn (the shifted flag Unit+0x27c, cleared by endTurn) — the form
  // it takes stays. `moved` is the unit's moved flag (Unit+0x112; Android `S`):
  //   • not moved yet: it tries on the STAG and builds its charge list from here (createChargeTargetList): if any
  //     charge scores a positive attack ratio → Stag (charge it this turn);
  //   • else, the nearest foe within 5 → Guardian Bear, but ONLY once it has moved (before that: no change);
  //   • else, in a group whose point for it (NEXT + its slot) lies more than 4 from that foe: slower than the group's
  //     pace → Stag (pace ≤ 8) or Great Eagle (a faster pace, or a group of free movers); keeping the pace of a foot
  //     group (4, not all free movers) as a beast → back to the Druid; else no change;
  //   • else → Great Eagle (cross the gap).
  // The driver (GameScreen::aiUpdate) calls it twice a turn: before the move, and — because the move step takes
  // states 14/10/5/3/6/2 back OFF the unit's tried list (mlib_Vector::removeElement, iOS Ep2 0x31c2c / Ep1 0x28f26 /
  // Android a_g) — again after the move, when it hasn't shifted yet. That second call is where an AI druid turns
  // Bear (see _aiCarryOut). Returns true when it shifted.
  _aiPickDruidForm(u, enemies, moved = false) {
    let nearest = null,
      nearestDist = FAR;
    for (const e of enemies) {
      const dist = manhattan(e, u);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = e;
      }
    }
    if (!nearest) return false; // getClosestEnemy found none: the state passes
    const druid = u._druidType || u.type;
    const forms = (UNIT_TYPES[druid] && UNIT_TYPES[druid].shapeshiftForms) || [];
    const has = (f) => forms.includes(f) && !!UNIT_TYPES[f];
    let stagCharge = false;
    if (has("stag") && !moved) {
      // (a moved unit skips the charge test — @0x7be04 / Android `if (this.S)`)
      const stag = Object.assign(Object.create(Object.getPrototypeOf(u)), u, {
        type: "stag",
        T: UNIT_TYPES.stag,
        chargeDir: null,
      });
      const stagReach = this.game.computeReach(stag);
      for (const k of stagReach.stops) {
        const [tx, ty] = k.split(",").map(Number);
        for (const e of enemies)
          if (
            this.game._chargeReaches(stag, tx, ty, e) &&
            this._glValidTarget(stag, { tx, ty }, e) &&
            this._aiDamageRatio(stag, { tx, ty }, e, true) > 0
          ) {
            stagCharge = true;
            break;
          }
        if (stagCharge) break;
      }
    }
    let form = u.type;
    if (stagCharge) form = "stag";
    else if (nearestDist <= 5) {
      if (moved && has("bear")) form = "bear"; // @0x7bf92: the moved flag must be 1
    } else {
      const point = this._glPoint(u);
      if (point && manhattan(point, nearest) > 4) {
        const { minMove: pace, allFree } = point.group;
        if (this.game.moveOf(u) >= pace) {
          if (!allFree && pace === 4 && u.type !== druid) form = druid;
        } else form = !allFree && pace <= 8 ? "stag" : "greateagle";
      } else form = "greateagle";
    }
    if (form !== druid && !has(form)) return false;
    if (form === u.type || !this.game._shapeshift(u, form === druid ? "druids" : form)) return false;
    // before the move, the bloom + sound play once the camera is on the druid (see _aiCarryOut's `begin`)
    if (!moved) u._shiftFx = true;
    return true;
  }

  // ROLE — DUNE SIREN (Ep2 Quicksand, unit type 34) — aiConsiderAction state 31 / considerQuickSand: lay a 3-tile
  // line of quicksand orthogonally adjacent, in the best of the 4 lines. Unit::calcQuickSandCost scores a line by
  // the units standing ON its layable cells (in bounds, quicksand ground, not already quicksand) — Dune Sirens and
  // Griffon Riders skipped: each counts its cost × HP (a siege engine a third of that), + for an enemy, − for
  // its own side. The best line is laid when it scores above 0; otherwise the siren falls through and advances.
  _aiTryQuicksand(u, reach) {
    const dirs = [
      [
        [u.tx - 1, u.ty - 1],
        [u.tx - 1, u.ty],
        [u.tx - 1, u.ty + 1],
      ], // W column
      [
        [u.tx + 1, u.ty - 1],
        [u.tx + 1, u.ty],
        [u.tx + 1, u.ty + 1],
      ], // E column
      [
        [u.tx - 1, u.ty - 1],
        [u.tx, u.ty - 1],
        [u.tx + 1, u.ty - 1],
      ], // N row
      [
        [u.tx - 1, u.ty + 1],
        [u.tx, u.ty + 1],
        [u.tx + 1, u.ty + 1],
      ], // S row
    ];
    let best = null,
      bestScore = 0;
    for (const cells of dirs) {
      const layable = cells.filter(([x, y]) => this.game._canLayQuicksand(x, y));
      if (!layable.length) continue;
      let score = 0;
      for (const [x, y] of layable) {
        const other = this.game.unitAt(x, y);
        if (!other || other.dead || other.type === "dunesirens" || other.type === "griffon") continue;
        let value = (DEPLOY_COST[other.type] || 100) * other.hp;
        if (other.T.al === 4) value /= 3;
        score += other.team === u.team ? -value : value;
      }
      if (score > bestScore) {
        bestScore = score;
        best = layable;
      }
    }
    if (best && bestScore > 0) {
      this.game.reach = reach;
      const cast = () => {
        this.game._sandSkull(u);
        for (const [x, y] of best) {
          this.game._layQuicksand(x, y);
          this.game.spawnFx(
            "sand_puff",
            x * this.game.tile + this.game.tile / 2,
            y * this.game.tile + this.game.tile * 0.5,
            { delay: 0.25 },
          );
        }
        u.acted = true;
        this.game.aiDelay = 0.3;
        this.game._emit();
      };
      this._aiPanThen(u.tx, u.ty, () => {
        this.game.audio.play("cast", 0.55);
        this.game.anim = {
          type: "attack",
          u,
          target: { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
          t: 0,
          hitDone: false,
          cast: true,
          done: cast,
        };
        u.attacking = true;
        u.anim = 0;
        u.animT = 0;
        this.game._emit();
      });
      return true;
    }
    // no foe to trap yet — fall through to the normal advance so the siren closes the distance
    return false;
  }

  // ROLE — CONJURER (Ep2 Conjure, unit type 31): summons its children — Sappers and Bodyguards (iOS createUnitAt
  // with type 0x20/0x21) — tracked as leashed children that die with it (killConjurerChild). isAbilityAvailable(34)
  // (@0x74f46): at most 1 child alive and a deployable tile among its 4 orthogonal neighbours (getDeployLocation —
  // up, down, left, right, the first free one). prepareAction(28) (@0x74878) picks the type: no child → a Bodyguard;
  // one child → the other kind (a Bodyguard alive → a Sapper, a Sapper alive → a Bodyguard).
  _aiTryConjure(u, reach) {
    const children = this.game.units.filter((o) => !o.dead && o._conjuredBy === u.id);
    if (children.length < 2) {
      let spot = null;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const x = u.tx + dx,
          y = u.ty + dy;
        if (this.game.inBounds(x, y) && !this.game.unitAt(x, y) && this.game.terrainAt(x, y).passable) {
          spot = [x, y];
          break;
        }
      }
      if (spot && UNIT_TYPES.sapper && UNIT_TYPES.bodyguard) {
        this.game.reach = reach;
        const summonType = children.length === 1 && children[0].type === "bodyguard" ? "sapper" : "bodyguard";
        const cast = () => {
          const minion = this.game._makeUnit(summonType, u.team, spot[0], spot[1], false);
          minion.group = u.group;
          minion._conjuredBy = u.id;
          if (u.ally) minion.ally = true;
          minion.acted = true; // a freshly conjured unit can't act this turn
          this.game.spawnFx(
            "sigil",
            spot[0] * this.game.tile + this.game.tile / 2,
            spot[1] * this.game.tile + this.game.tile * 0.45,
            {},
          ); // 5017 #11
          u.acted = true;
          this.game.aiDelay = 0.3;
          this.game._emit();
        };
        this._aiPanThen(u.tx, u.ty, () => {
          this.game.audio.play("conjure", 0.55);
          this.game.anim = {
            type: "attack",
            u,
            target: { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
            t: 0,
            hitDone: false,
            cast: true,
            done: cast,
          };
          u.attacking = true;
          u.anim = 0;
          u.animT = 0;
          this.game._emit();
        });
        return true;
      }
    }
    // at cap or no room — fall through to fight/reposition normally
    return false;
  }

  // ROLE — CRAFTSMEN (Ep2 Build/Repair, unit type 29): first mend a damaged friendly War Engine — aiConsiderAction
  // state 27 (iOS Ep2 @0x7c516): the engine (class 4) within move + 1 whose path fits the move, with the most missing
  // HP × value; it walks up next to it and repairs (the heal action) — else raise a Village on adjacent open ground
  // near the front (iOS isBuildable, getTileType ∈ {2,3,18,26}). Repair amount = the heal step (+20).
  _aiTryCraftsmen(u, reach) {
    if (u.T.repair && (this._aiWalkToRepair(u, reach) || this._aiRepairInPlace(u, reach))) return true;
    // nothing to repair — build, or fall through to throw hammers / reposition normally
    return this._aiTryBuild(u, reach);
  }

  // With no engine to mend where it stands: walk next to the damaged friendly War Engine worth the most
  // (missing HP × value) and repair it on arrival.
  _aiWalkToRepair(u, reach) {
    if (this.game._repairTargetFor(u)) return false;
    let best = null,
      bestScore = 0;
    for (const e of this.game.units) {
      if (e.dead || e === u || e.team !== u.team || e.T.al !== 4 || e.hp >= 100) continue;
      const score = (100 - e.hp) * this._aiValue(e);
      if (score <= bestScore) continue;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const k = key(e.tx + dx, e.ty + dy);
        if (!reach.stops.has(k)) continue;
        const occupant = this.game.unitAt(e.tx + dx, e.ty + dy);
        if (occupant && occupant !== u) continue;
        bestScore = score;
        best = { tx: e.tx + dx, ty: e.ty + dy };
        break;
      }
    }
    if (!best) return false;
    this.game.reach = reach;
    this._aiPanThen((u.tx + best.tx) / 2, (u.ty + best.ty) / 2, () =>
      this.game.moveUnit(u, this.game.pathTo(reach, best.tx, best.ty), () => {
        const engine = u.dead ? null : this.game._repairTargetFor(u);
        if (!engine) {
          u.acted = true;
          this.game.aiDelay = 0.25;
          this.game._emit();
          return;
        }
        u.face = Math.sign(engine.tx - u.tx) || u.face || 1;
        // a CAST (like the player's Repair, _castRepair): the generic heal step would add its own +20 on top
        this._aiCastAt(u, engine, () => this._aiMendEngine(u, engine));
      }),
    );
    return true;
  }

  // Repair where it stands: an adjacent damaged War Engine first, else an adjacent damaged building / wall
  // (Unit::canRepair also accepts Map::isStructureRepairable cells).
  _aiRepairInPlace(u, reach) {
    const engine = this.game._repairTargetFor(u);
    if (engine) {
      this.game.reach = reach;
      u.face = Math.sign(engine.tx - u.tx) || u.face || 1;
      this._aiPanThen(u.tx, u.ty, () => this._aiCastAt(u, engine, () => this._aiMendEngine(u, engine))); // a cast: the done step adds the +20
      return true;
    }
    const structure = this.game._repairStructureFor(u);
    if (!structure) return false;
    this.game.reach = reach;
    u.face = Math.sign(structure.tx - u.tx) || u.face || 1;
    this._aiPanThen(u.tx, u.ty, () =>
      this._aiCastAt(u, structure, () => {
        this.game._repairStructure(structure.tx, structure.ty);
        this.game.spawnFx("debris", structure.px + this.game.tile / 2, structure.py + this.game.tile * 0.35, {});
        this.game.floaters.push({
          x: structure.px + this.game.tile / 2,
          y: structure.py,
          t: 0,
          life: 0.9,
          vy: -18,
          text: "Repaired",
          heal: true,
        });
        this._aiCastDone(u);
      }),
    );
    return true;
  }

  // BUILD — aiConsiderAction state 26 / Unit::canBuild: once per battle (flag Unit+0x3a0, help string 581), on
  // the first buildable orthogonal neighbour in the order up, down, left, right. Repair (state 27) is tried first.
  _aiTryBuild(u, reach) {
    if (!u.T.build || u._built) return false;
    let spot = null;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const x = u.tx + dx,
        y = u.ty + dy;
      if (this.game._buildableTile(x, y)) {
        spot = [x, y];
        break;
      }
    }
    if (!spot) return false;
    this.game.reach = reach;
    const [spotX, spotY] = spot,
      tile = this.game.tile;
    u.face = Math.sign(spotX - u.tx) || u.face || 1;
    this._aiPanThen((u.tx + spotX) / 2, (u.ty + spotY) / 2, () =>
      this._aiCastAt(u, { tx: spotX, ty: spotY, px: spotX * tile, py: spotY * tile }, () => {
        this.game._buildVillage(spotX, spotY);
        u._built = true; // Craftsmen Build only once per battle (help string 581)
        this.game.spawnFx("sand_puff", spotX * tile + tile / 2, spotY * tile + tile * 0.5, {});
        this.game.spawnFx("debris", spotX * tile + tile / 2, spotY * tile + tile * 0.35, { delay: 0.15 });
        this._aiCastDone(u);
      }),
    );
    return true;
  }

  // The Craftsmen's work animation: the build sound and the battle strip played as a CAST on `target` (a unit, a
  // structure cell or a bare tile); `done` runs when it lands.
  _aiCastAt(u, target, done) {
    this.game.audio.play("build", 0.5);
    this.game.anim = { type: "attack", u, target, t: 0, hitDone: false, cast: true, done };
    u.attacking = true;
    u.anim = 0;
    u.animT = 0;
    this.game._emit();
  }

  // A repair landing on a War Engine: the heal state (+51 of 256, capped at full), dust and the green gain.
  _aiMendEngine(u, engine) {
    const gained = this.game._healTick(engine);
    this.game.spawnFx("debris", engine.px + this.game.tile / 2, engine.py + this.game.tile * 0.35, {});
    this.game.floaters.push({
      x: engine.px + this.game.tile / 2,
      y: engine.py - 4,
      t: 0,
      life: 0.9,
      vy: -18,
      text: "+" + gained,
      heal: true,
    });
    this._aiCastDone(u);
  }

  // The Craftsman's turn is spent once the work lands.
  _aiCastDone(u) {
    u.acted = true;
    this.game.aiDelay = 0.3;
    this.game._emit();
  }

  // ROLE — BODYGUARD (Ep2 Absorb, help 585) — aiConsiderAction state 29 (iOS Ep2 @0x7c482): once its own HP has
  // fallen to 25 or less, it sacrifices itself to lay the one-hit Absorb buff on its Conjurer (findConjurerUnit).
  _aiTryAbsorb(u, reach) {
    const conjurer = this.game.units.find((o) => !o.dead && o.id === u._conjuredBy);
    if (conjurer && Math.floor(u.hp) <= 25) {
      this.game.reach = reach;
      this._aiPanThen((u.tx + conjurer.tx) / 2, (u.ty + conjurer.ty) / 2, () => {
        this.game.audio.play("cast", 0.55);
        this.game.anim = {
          type: "attack",
          u,
          target: { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
          t: 0,
          hitDone: false,
          cast: true,
          done: () => {
            this.game._absorbSacrifice(u, conjurer);
            this.game.aiDelay = 0.35;
            this.game._emit();
          },
        };
        u.attacking = true;
        u.anim = 0;
        u.animT = 0;
        this.game._emit();
      });
      return true;
    }
    return false;
  }

  // ROLE — SAPPER (Ep2 Detonate, unit type 32) — aiConsiderAction state 30 (iOS Ep2 @0x7c0ba), see _sapperPlan:
  // it detonates only when its Spear cannot kill its best target; otherwise it attacks normally below.
  _aiTryDetonate(u, reach, enemies) {
    const plan = this._sapperPlan(u, reach, enemies);
    if (plan) {
      this.game.reach = reach;
      const boom = () => {
        if (u.dead) return;
        this.game._sapperStrike(u, () => {
          this.game.aiDelay = 0.35;
          this.game._emit();
        });
      };
      if (plan.tx === u.tx && plan.ty === u.ty) this._aiPanThen(u.tx, u.ty, boom);
      else
        this._aiPanThen((u.tx + plan.tx) / 2, (u.ty + plan.ty) / 2, () =>
          this.game.moveUnit(u, this.game.pathTo(reach, plan.tx, plan.ty), boom),
        );
      return true;
    }
    return false;
  }

  // The ordinary turn: strike the best target in reach (from any reachable tile), else move — the original
  // getBestMoveLocation movers — then carry it out.
  // (No retreat: nothing in the iOS AI — GameScreen::aiUpdate, aiConsiderAction or the movers — reads a unit's HP to
  // pull it back; a wounded unit fights on like any other. The Android-era case-14 retreat was removed.)
  // Baseline = HOLD (stay put, don't attack). Real advances/attacks score far above this; only a
  // lethal-suicide attack (penalised below) scores under it — so a cornered unit holds instead of
  // throwing itself onto a first-strike for nothing.
  _aiFightOrAdvance(u, { reach, stops, enemies, foes, wizMove, noAttack, foeTeam }) {
    // GOALS — Unit::getBestMoveLocation (iOS Ep2 @0x7db42): the destination is the closest enemy (or a script-set
    // target); only with NO enemy left does it look for a goal (getClosestGoal). So no side steers for capture points
    // while foes remain (the Android-era case-15 objective seeking was removed).
    // The target is Unit::getClosestEnemy (iOS Ep2 @0x65ef8): the nearest visible foe by STRAIGHT distance —
    // getDistance, which also weighs a walk through a warp portal (and leaves the portal routing of the LAST foe it
    // measured on the unit, Unit+0x378) — a Trebuchet (or a Cannon past 2) counting a Griffon / Great Eagle as 50.
    // The distance the movers work with (getBestMoveLocation's own variable) is the portal route's when one is set,
    // else the straight gap. The STRONGEST foe is chosen only among the ones in reach, in the attack loop below.
    const closest = this._oClosestEnemy(u, foes);
    const nearest = closest ? closest.e : enemies[0];
    const foeNow = u._portalIdx >= 0 ? u._portalDist : manhattan(u, nearest);
    this.game._dbgAim(u, {
      foe: nearest ? [nearest.type, nearest.tx, nearest.ty] : null,
      d: foeNow,
      portal: u._portalIdx,
      ...(this._glOrder(u) ? { order: this._glOrder(u) } : {}),
    });
    const order = this._glOrder(u); // GroupLogic move order (formation slot / hold)
    const ranged = u.T.range > 1,
      splash = !!u.T.splash;
    // Unit::isInBattleRange (iOS Ep2 @0x7af10) — see _battleRange: close enough that positioning for the shot matters.
    const rangedBattle = u.T.harasser && foeNow <= this._battleRange(u);
    const plan = { bestSpot: { tx: u.tx, ty: u.ty }, bestTgt: null, bestScore: SCORE.NONE, bestRanged: false };
    // everything the choice below needs about this unit's turn
    const turn = {
      nearest,
      foeNow,
      order,
      ranged,
      splash,
      rangedBattle,
      reach,
      stops,
      enemies,
      wizMove,
      noAttack,
      foeTeam,
    };
    this._aiPickAttack(u, plan, turn);
    this._aiPickMove(u, plan, turn);
    this._aiCarryOut(u, plan, turn);
  }

  // CHARGE (Unit::aiConsiderAction state 0 → createChargeTargetList): the original charges IMMEDIATELY whenever a
  // straight lane reaches a foe more than two tiles away and the damage ratio is positive. That preference is applied in the attack loop below (a valid charge with a
  // favourable trade wins); a charger with nothing in reach this turn may instead take a staging tile (_chargeStage).
  // Every reachable tile `s` is tried: with foes in reach, each attack from it is scored (_aiAttackScore); with none,
  // it may still be a ranged mover's firing position (_aiRangedMoveScore). The best goes into `plan`.
  _aiPickAttack(u, plan, turn) {
    for (const spot of turn.stops) {
      const atStart = spot.tx === u.tx && spot.ty === u.ty;
      const inRange = this._aiFoesInReach(u, spot, turn, atStart);
      if (inRange.length) {
        for (const e of inRange) {
          let score = this._aiAttackScore(u, spot, e, plan, turn, atStart);
          // 🤖 Autopilot (Hold the fort): a strike from a tile where it would be surrounded scores lower
          if (score != null && this.game.autopilot && u.team === "blue" && !u.ally) score -= this._apSpotRisk(u, spot);
          if (score != null && score > plan.bestScore) {
            plan.bestScore = score;
            plan.bestSpot = spot;
            plan.bestTgt = e;
          }
        }
      } else {
        const score = this._aiRangedMoveScore(u, spot, plan, turn);
        if (plan.bestTgt === null && score > plan.bestScore) {
          plan.bestScore = score;
          plan.bestSpot = spot;
          plan.bestRanged = score !== -Infinity;
        }
      }
    }
  }

  // The foes unit `u` could strike from tile `s`: in its weapon range (manhattan; orthogonal melee) and worth hitting,
  // or at the end of a diagonal charge. Move or Shoot (doesValidAttackExist): from any tile but its own, the unit
  // will have moved, so its tagged weapon is out. A teleporting Wizard only jabs adjacent foes; Horse Bowmen and a
  // unit that may not attack this turn strike nothing here.
  _aiFoesInReach(u, spot, turn, atStart) {
    const { enemies, wizMove, noAttack } = turn;
    if (noAttack || u.T.mountedArcher) return [];
    if (wizMove) return enemies.filter((e) => manhattan(e, spot) === 1);
    const movedHere = !atStart || this.game._movedThisTurn(u);
    return enemies.filter((e) => {
      const dist = manhattan(e, spot);
      return (
        (this.game._inWeaponRange(u, dist, movedHere) && !this.game._weaponUselessVs(u, e, dist)) ||
        this.game._chargeReaches(u, spot.tx, spot.ty, e)
      );
    });
  }

  // ATTACK — Unit::determineBestAttack (iOS Ep2 @0x7a672): every attack is scored with calcDamageRatio
  // (@0x70054, see _aiDamageRatio) — the value-weighted damage it deals minus the value-weighted blow it takes
  // back — and the best one above −3000 is taken (a forbidden trade scores −10000). A charge from this tile
  // is scored as a charge (+30), so a charger naturally prefers its run-up tiles. Returns the score of striking `e`
  // from `s`, or null when that attack isn't allowed.
  _aiAttackScore(u, spot, e, plan, turn, atStart) {
    const { order, ranged, splash, reach, foeTeam } = turn;
    const dToE = manhattan(e, spot);
    const runX = spot.tx - u.tx,
      runY = spot.ty - u.ty,
      runAbsX = Math.abs(runX),
      runAbsY = Math.abs(runY);
    const runUp = Math.max(runAbsX, runAbsY) >= 3 && (runX === 0 || runY === 0 || runAbsX === runAbsY);
    const chargeHere = !!(
      u.T.hasCharge &&
      !u.slowed &&
      (this.game._chargeReaches(u, spot.tx, spot.ty, e) ||
        (this.game._isFoot(e) && Math.max(Math.abs(e.tx - spot.tx), Math.abs(e.ty - spot.ty)) === 1 && runUp))
    );
    if (!this._glValidTarget(u, spot, e)) return null; // Unit::isValidFormationTarget (group leash)
    // determineBestAttack (@0x7a9b2): a grouped unit strikes in melee only from a tile within half its move of
    // its group move order (the formation slot) — the line keeps its shape.
    if (order && dToE === 1 && !atStart && manhattan(spot, order) > Math.floor(this.game.moveOf(u) / 2)) return null;
    const ratio = this._aiDamageRatio(u, spot, e, chargeHere);
    if (ratio <= -3000) return null;
    let score = SCORE.ATTACK + ratio * 100;
    if (ranged)
      score += dToE; // tie-break only: the farther tile
    // determineBestAttack's melee tie (@0x7ab10): an equal ratio keeps the unit's own tile, else goes to the tile
    // with the higher getSupportThreatRatio (both below one ratio step of 100).
    else if (dToE === 1 && !splash)
      score += atStart ? 99 : 0.09 * this._supportTie(u, spot, plan.reachCache || (plan.reachCache = new Map()));
    if (splash && !u.T.canLightning) {
      // SIEGE/blast (case 5 / I()): score the cross-blast's coverage — enemies caught count +, its OWN
      let coverage = 0; // side counts −×3 (decompiled I(): the blast DOES hit allies, so the AI avoids aiming onto them)
      for (const x of this.game.units) {
        if (x.dead || manhattan(x, e) > 1 || (Math.abs(x.tx - e.tx) === 1 && Math.abs(x.ty - e.ty) === 1)) continue;
        coverage += (x.team === foeTeam ? 1 : -3) * this._aiValue(x) * x.hp;
      }
      score = SCORE.ATTACK + coverage * 10;
    }
    // CHARGE — aiConsiderAction state 13 (tried first for a charger) on createChargeTargetList (@0x70ba4): a
    // charge lane is scored by the SUM of the attack ratio of every unit it strikes on the ride (see
    // _aiChargeScore); the best lane scoring > 0 is charged, ahead of any ordinary attack.
    if (u.T.hasCharge && !u.slowed && this.game._chargeReaches(u, spot.tx, spot.ty, e)) {
      const chargeScore = this._aiChargeScore(u, spot, e, reach);
      if (chargeScore > 0) score = SCORE.CHARGE + chargeScore * 100;
    }
    return score;
  }

  // RANGED MOVER — Unit::getBestMoveRanged (iOS Ep2 @0x7b638), used by every Move-or-Shoot / Shoot-and-Move
  // unit (ability 7 or 8, siege included) once the nearest foe is inside its BATTLE RANGE (isInBattleRange,
  // see rangedBattle). Among the reachable tiles, keep those whose NEAREST foe (measured from the tile) is
  // inside the armed weapon's [min, max] range, and take the one FARTHEST from that foe; ties go to the tile
  // with the higher getSupportThreatRatio (see _supportRatio). It comes before a group order; no such tile →
  // the group order or the unit's own advance (the movers after this loop). getBestMoveLocation order (iOS Ep2
  // @0x7d6f2): a HOLD group's move first; then the battle-range movers (Horse Bowmen, the ranged mover, charge
  // staging); only then the group's formation order; else the unit's own target. Returns -Infinity for a tile that
  // isn't a ranged mover's firing position.
  _aiRangedMoveScore(u, spot, plan, turn) {
    const { order, rangedBattle, enemies } = turn;
    if (!(u.T.harasser && rangedBattle && !(order && order.hold))) return -Infinity;
    let foeDist = FAR;
    for (const e of enemies) {
      const dist = manhattan(e, spot);
      if (dist < foeDist) foeDist = dist;
    }
    if (foeDist < (u.T.minRange || 1) || foeDist > u.T.range) return -Infinity;
    return (
      SCORE.RANGED_MOVE + foeDist * 1e3 + this._supportTie(u, spot, plan.reachCache || (plan.reachCache = new Map()))
    );
  }

  // CHARGE STAGING — Unit::getBestMoveCharge (iOS Ep2 @0x68ec0): a charger with nothing to hit this turn whose
  // target lies beyond its battle range (_battleRange — lance 1 + move 8 = 9 for cavalry) but within two moves takes a STAGING tile — 6 or 7 tiles (7 only, for
  // Griffon Riders) from a foe it has a clear straight charge lane to, so it can charge next turn. See _chargeStage.
  _aiPickMove(u, plan, turn) {
    const { nearest, foeNow, order, reach, stops, enemies } = turn;
    const stopSet = new Set(stops.map((s) => key(s.tx, s.ty)));
    const isWiz = u.T.teleport;
    let moveOrder = null;
    const getMoveOrder = () => moveOrder || (moveOrder = this._oMoveOrder(u, stopSet));
    const mover = (dest) =>
      isWiz
        ? this._oWizardMove(u, dest, reach, getMoveOrder())
        : this._oGenericMove(u, dest, reach, stopSet, getMoveOrder(), nearest, foeNow);
    let moved = false;
    // HOLD GROUP (mode 2, @0x7d7a2) — the group re-forms on its hold point, facing the enemy (ai/grouplogic.js):
    // findClosestMove (@0x7d558) takes the listed tile nearest in a straight line to the member's order (strictly
    // nearer than where it stands, never terrain 24), then checkOpportunityMove (ranged units: cover too); the member
    // STAYS if its own tile has the better cover (lower getTileDefense) and the order is within 5. That tile then goes
    // to the unit's mover like any destination.
    if (!plan.bestTgt && order && order.hold) {
      let spot = this._oFindClosestMove(u, order, getMoveOrder());
      spot = this._aiOpportunity(u, spot, reach, !!(u.T.harasser || u.T.canLightning || u.T.magic));
      const tdef = (x, y) => Math.round(100 - (this.game.terrainAt(x, y).defBonus || 0) * 100);
      if (tdef(u.tx, u.ty) < tdef(spot.tx, spot.ty) && manhattan(u, order) <= 5) spot = { tx: u.tx, ty: u.ty };
      plan.bestSpot = mover(spot);
      moved = true;
    }
    if (!plan.bestTgt && !moved && u.T.hasCharge && !u.slowed && (u.type !== "king" || this.game.moveOf(u) === 8)) {
      const moveBudget = this.game.moveOf(u);
      if (foeNow > this._battleRange(u) && foeNow < 2 * moveBudget) {
        const stage = this._chargeStage(u, reach, enemies);
        if (stage) {
          plan.bestSpot = stage;
          plan.bestRanged = true;
        }
      }
    }
    // GROUP ORDER / OWN TARGET — no ranged tile or staging taken: the destination is the group's move order (a
    // member in formation), else the portal entry the routing points at, else the closest foe; the Wizard mover or
    // the generic mover (ai/aimove.js) picks the tile.
    if (!plan.bestTgt && !moved && !plan.bestRanged) {
      const portal = u._portalIdx >= 0 && this.game.portals ? this.game.portals[u._portalIdx] : null;
      const dest = order
        ? { tx: order.tx, ty: order.ty }
        : portal
          ? { tx: portal.sx, ty: portal.sy }
          : { tx: nearest.tx, ty: nearest.ty };
      plan.bestSpot = mover(dest);
      moved = true;
    }
    // OPPORTUNITY — Unit::checkOpportunityMove (iOS Ep2 @0x7b35c) for the ranged mover / charge staging tile (the
    // original movers above run their own).
    if (!plan.bestTgt && !moved)
      plan.bestSpot = this._aiOpportunity(
        u,
        plan.bestSpot,
        reach,
        !plan.bestRanged && !!(u.T.harasser || u.T.canLightning),
      );
    // HORSE BOWMEN that stay put (aiUpdate phase 6, after the move): an aimed shot from where they stand — the best
    // calcDamageRatio target in range. A ride already was their attack (it fires on the way).
    if (u.T.mountedArcher && !plan.bestTgt && plan.bestSpot.tx === u.tx && plan.bestSpot.ty === u.ty) {
      let holdScore = -3000;
      for (const e of this.game.targetsFrom(u, u.tx, u.ty)) {
        const ratio = this._aiDamageRatio(u, u, e, false);
        if (ratio > holdScore) {
          holdScore = ratio;
          plan.bestTgt = e;
        }
      }
    }
  }

  // Carry the plan out: pan to the unit, move (if it moves), then strike / cast / end its turn.
  _aiCarryOut(u, plan, turn) {
    const { reach, wizMove } = turn;
    let { bestSpot, bestTgt } = plan;
    const garrison = this._garrisonOf(u);
    // a garrison steps out of its fort only to strike (one tile, see _aiLeashedStops); with nothing to strike a move
    // stays inside — one that is out goes back in (the nearest fort tile it can reach)
    if (garrison && !bestTgt && !inArea(garrison.area, bestSpot)) {
      bestSpot = { tx: u.tx, ty: u.ty };
      if (!inArea(garrison.area, u)) {
        let bestDist = FAR;
        for (const k of reach.stops) {
          const [tx, ty] = k.split(",").map(Number);
          const occupant = this.game.unitAt(tx, ty);
          if (!inArea(garrison.area, { tx, ty }) || (occupant && occupant !== u)) continue;
          const dist = Math.abs(tx - u.tx) + Math.abs(ty - u.ty);
          if (dist < bestDist) {
            bestDist = dist;
            bestSpot = { tx, ty };
          }
        }
      }
    }
    this.game.reach = reach;
    const moves = bestSpot.tx !== u.tx || bestSpot.ty !== u.ty;
    const attackPath = !!bestTgt; // the driver's attack step (phase 6), else its plain move (phase 4)
    const after = () => {
      const finishAi = () => {
        if (wizMove && !u.dead) {
          const area = this._aiBestArea(u);
          if (area) {
            this._aiCast(u, area);
            return;
          }
        } // moved → judge the spells again from here
        if (!u.dead && bestTgt && !bestTgt.dead) {
          const dist = manhattan(bestTgt, u);
          const chargeHit = u.chargeDir && u.T.hasCharge && cheb(u, bestTgt) === 1; // a charge (incl. diagonal) reaches an adjacent foe
          if (this.game._inWeaponRange(u, dist) || chargeHit) {
            this.doAttackAI(u, bestTgt);
            return;
          }
        }
        // A unit that HOLDS (didn't move, nothing to strike) shows nothing, so it gets no dwell — otherwise a garrison
        // of idle units adds 0.25 s of dead air each to the enemy's turn.
        u.acted = true;
        this.game.aiDelay = moves ? 0.25 : 0;
      };
      if (u._ambushedTurn === this.game.turn) bestTgt = null; // stopped and struck by a hidden foe: its attack is spent (Unit+0x113)
      // (a Priest always takes the move step — onto its own tile when it stays, which still sets the moved flag)
      if ((moves || u.T.prayer) && !u.dead && this._aiAfterMove(u, turn, attackPath, finishAi, (t) => (bestTgt = t)))
        return;
      finishAi();
    };
    const moveThenAct = () => {
      if (moves) this.game.moveUnit(u, this.game.pathTo(reach, bestSpot.tx, bestSpot.ty), after);
      else after();
    };
    const begin = () => {
      if (!u._shiftFx) return moveThenAct();
      // a druid that just shapeshifted: show the nature bloom on-screen, let it finish, THEN move/strike
      u._shiftFx = false;
      this.game.audio.play("shapeshift", 0.5);
      this.game.spawnFx("nature", u.px + this.game.tile / 2, u.py + this.game.tile * 0.42, {});
      this.game.anim = { type: "pan", t: 0, min: 0.55, done: moveThenAct };
    };
    if (moves || bestTgt || u._shiftFx) {
      // HOVER ON THE ACTING UNIT: frame where it stands and the far end of its action (target, else destination),
      // and let the pan LAND before it moves — so you see who acts, its move, its cast/strike and the damage, in
      // order, instead of the unit already sliding off-screen while the camera is still catching up.
      const far = bestTgt || bestSpot;
      this.game.centerOn((u.tx + far.tx) / 2, (u.ty + far.ty) / 2, true);
      this.game.anim = { type: "pan", t: 0, done: begin };
    } else begin();
  }

  // AFTER THE MOVE — GameScreen::aiUpdate runs its state chooser (phase 3) again once a unit has moved, with the moved
  // flag set (Unit+0x112; Android `S`). Before the move it takes these states back off the unit's tried list
  // (mlib_Vector::removeElement): 14/10/5/3/6/2 on either path, and on the attack path (phase 6 — the unit moves to
  // its attack tile first, then strikes) Episode II's 27/26/31 too (iOS Ep2 0x31bae vs the plain move's 0x31c2c;
  // Ep1 0x28ec0 / 0x28f26). In the chooser's order: state 2 (a druid that hasn't shifted — now it may turn Bear),
  // states 6 then 3 (a Priest prays, else heals an adjacent ally), the Wizard's state 10 (finishAi's re-cast), then on
  // the attack path the Craftsmen's Repair (27) and Build (26) and the Dune Sirens' Quicksand (31); only then the
  // strike. Returns true when the unit's turn was taken over here; `retarget` swaps the strike after a shift.
  _aiAfterMove(u, turn, attackPath, finishAi, retarget) {
    const enemies = (turn.enemies || []).filter((e) => !e.dead);
    const finish = () => {
      u.acted = true;
      this.game.aiDelay = 0.25;
      this.game._emit();
    };
    if (
      (u.T.shapeshift || u._druidType) &&
      u._shiftTurn !== this.game.turn &&
      this._aiPickDruidForm(u, enemies, true)
    ) {
      // the shift resets the unit's action but keeps it moved (Android `c()` with `S` restored): the new form strikes
      // from where it stands, chosen anew (createSortedTargetList / determineBestAttack, this tile only)
      const here = { tx: u.tx, ty: u.ty };
      const strike = { bestSpot: here, bestTgt: null, bestScore: SCORE.NONE, bestRanged: false };
      this._aiPickAttack(u, strike, { ...turn, enemies, stops: [here], order: this._glOrder(u), wizMove: false });
      retarget(u._ambushedTurn === this.game.turn ? null : strike.bestTgt);
      this.game.audio.play("shapeshift", 0.5);
      this.game.spawnFx("nature", u.px + this.game.tile / 2, u.py + this.game.tile * 0.42, {});
      this.game.anim = { type: "pan", t: 0, min: 0.55, done: finishAi };
      return true;
    }
    if (!attackPath) {
      if (u.T.prayer && this._priestPray(u, enemies, finish)) return true;
      if (u.T.heal && this._aiHealAdjacent(u, u.team, finish)) return true;
      if (u.T.prayer) return this._priestPray(u, enemies, finish, true); // neither: the driver's own Shield
      return false;
    }
    if (u.T.repair && this._aiRepairInPlace(u, turn.reach)) return true;
    if (u.T.build && this._aiTryBuild(u, turn.reach)) return true;
    if (u.T.quicksand && this._aiTryQuicksand(u, turn.reach)) return true;
    return false;
  }

  // `onDone` (optional): a continuation run after the blow resolves instead of ending the unit's turn — used by
  // the Shoot-and-Move strafing run to chain another reposition+shot.
  doAttackAI(attacker, defender, onDone) {
    // FEAR: an AI unit striking a Griffon / Bear must pass the same courage check the player's units do.
    if (this.game._fearCheck(attacker, defender, () => this._aiActDone(attacker, onDone))) return;
    attacker.attackedTurn = true;
    if (attacker.T.pikeWall) attacker.walled = false;
    // A CHARGE is the whole attack — nobody counters it, as for the player's (doAttack): doFinishMoving ends it with no
    // melee exchange.
    const charge = this.game._wouldCharge(attacker, defender);
    // Pike Wall: a braced blue pikeman strikes first when this AI unit attacks it (wall replaces its counter).
    if (
      this.game._preStrike(
        attacker,
        defender,
        () => {
          if (attacker.dead) this._aiActDone(attacker, onDone);
          else this._doAttackAICore(attacker, defender, true, onDone);
        },
        charge,
      )
    )
      return;
    this._doAttackAICore(attacker, defender, charge, onDone);
  }
  // Pan the camera to (tx,ty) and run `fn` only once the pan has landed (the loop's "pan" anim) — every AI action
  // that shows something (heal, prayer, build, repair, quicksand, conjure, absorb, detonate) starts on-screen.
  _aiPanThen(tx, ty, fn) {
    this.game.centerOn(tx, ty, true);
    this.game.anim = { type: "pan", t: 0, done: fn };
    this.game._emit();
  }
  _aiActDone(attacker, onDone) {
    // The dwell only starts once the settle gate (engine/loop) sees every bolt/FX/shot resolved — then hold a beat so
    // the damage number is read before the camera moves to the next unit.
    if (onDone) {
      this.game.aiDelay = 0.15;
      onDone();
    } else {
      attacker.acted = true;
      this.game.aiDelay = 0.45;
    }
  }
  _doAttackAICore(attacker, defender, noCounter, onDone) {
    attacker.face = Math.sign(defender.tx - attacker.tx) || 1;
    this.game.anim = {
      type: "attack",
      u: attacker,
      target: defender,
      t: 0,
      hitDone: false,
      done: () => {
        if (this.game._countersAfter(attacker, defender, noCounter)) {
          defender.face = Math.sign(attacker.tx - defender.tx) || defender.face || 1; // turn to face the attacker
          this.game.anim = {
            type: "attack",
            u: defender,
            target: attacker,
            t: 0,
            hitDone: false,
            counter: true,
            done: () => this._aiActDone(attacker, onDone),
          };
          defender.attacking = true;
          defender.anim = 0;
          defender.animT = 0;
          defender.hitPending = attacker; // play the RETALIATION swing, so the counter's damage comes with its strike
        } else {
          this._aiActDone(attacker, onDone);
        }
      },
    };
    const castLightning =
      attacker.spell === "lightning" && attacker.T.canLightning && manhattan(attacker, defender) >= 2; // storm cast (not the point-blank Wand): the wizard does nothing himself — no swing, no cast FX
    attacker.attacking = !castLightning;
    attacker.anim = 0;
    attacker.animT = 0;
    attacker.hitPending = defender;
  }

  // Unit+0x198, the unit's worth to the AI (Unit::readTypeInfo @0x64a58; the Android port's `at`): (cost − 50)·50 ÷ 450
  // + 50 with C's integer division.
  _aiValue(e) {
    return Math.trunc((((DEPLOY_COST[e.type] || 100) - 50) * 50) / 450) + 50;
  }

  // Unit::calcDamageRatio (iOS Ep2 @0x70054) — the original's attack score for `u` striking `e` from tile `s`:
  //   • a defender that strikes first (Pike Wall / First Strike / the attacker's Last Strike) lands its blow first and
  //     the attacker hits back only if it survives, weakened; otherwise the attacker hits and a surviving
  //     defender with a weapon reaching 1 — its sidearm too (canCounter) — counters, weakened (never a war engine or a charge);
  //   • +16 to the damage for a kill; +16 when there is no counter (Rangers instead double a point-blank hit after
  //     moving and take no counter);
  //   • a Hero that would die, or anyone that would die dealing nothing, is forbidden (−10000);
  //   • score = (damage × target value − counter × own value) / 256.
  // A TREBUCHET or CANNON (@0x70112) instead scores the EXPECTED blow of a possibly-deviating shot: the aim tile
  // weighted (100 − deviation%) and each of its 8 neighbours deviation% / 8, summing damage × weight × value for every
  // FOE there (its own units are not counted), / 256 — no counter, no kill bonus. (The ×3…÷4 distance-to-point
  // factor in the binary is gated on GameScreen+0x2ac, the "AI plays the human side" mode, so the enemy never uses it.)
  _aiDamageRatio(u, spot, e, charge) {
    const clone = (o, extra) => Object.assign(Object.create(Object.getPrototypeOf(o)), o, extra);
    const attackerAt = clone(u, { tx: spot.tx, ty: spot.ty });
    if (u.type === "trebuchet" || u.type === "cannon") {
      const devPct = this.game._deviationPct(attackerAt, e),
        onTargetW = 100 - devPct,
        offTargetW = Math.trunc(devPct / 8);
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const other = this.game.unitAt(e.tx + dx, e.ty + dy);
          if (!other || other.dead || other.team === u.team) continue;
          sum +=
            this.game.computeDamage(attackerAt, other) * (dx || dy ? offTargetW : onTargetW) * this._aiValue(other);
        }
      return Math.floor(sum / 256);
    }
    const dist = manhattan(e, spot);
    const opts = charge ? { charge: true } : {};
    const firstStriker = dist === 1 || charge ? this.game._firstStrikeOf(attackerAt, e) : null;
    let damage = 0,
      counter = 0;
    if (firstStriker) {
      counter = this.game.computeDamage(e, attackerAt, firstStriker.brace && charge ? { brace: true } : {});
      if (counter < attackerAt.hp)
        damage = this.game.computeDamage(clone(attackerAt, { hp: attackerAt.hp - counter }), e, opts);
    } else {
      damage = this.game.computeDamage(attackerAt, e, opts);
      // a surviving defender with a weapon that reaches 1 — its sidearm included — strikes back (rules/combat.js canCounter)
      if (damage < e.hp && dist === 1 && !charge && this.game.canCounter(e))
        counter = this.game.computeDamage(clone(e, { hp: e.hp - damage }), attackerAt, {});
    }
    let pos = damage >= e.hp ? damage + 16 : damage;
    if (u.type === "king") {
      if (counter >= u.hp) return -10000;
    } else if (counter >= u.hp && pos === 0) return -10000;
    if (pos > 0) {
      if (u.type === "rangers") {
        if (dist <= 1 && (spot.tx !== u.tx || spot.ty !== u.ty)) {
          pos *= 2;
          counter = 0;
        }
      } else if (counter === 0) pos += 16;
    }
    return Math.floor((pos * this._aiValue(e) - counter * this._aiValue(u)) / 256);
  }

  // SAPPER — aiConsiderAction state 30 (iOS Ep2 @0x7c0ba). Take its best target in reach (createSortedTargetList).
  // If the Spear alone would kill it, no blast (null — attack normally). Having moved already, it blows up where it
  // stands. Otherwise each walkable tile next to the target is scored: −1, then over that tile's 4 neighbours −1000 for
  // each own unit and + the Spear's damage to the target (×100/256) for each enemy target; the best tile scoring
  // > 0 is where it walks to detonate. Null when there is none.
  _sapperPlan(u, reach, enemies) {
    let target = null,
      targetScore = -3000;
    for (const k of reach.stops) {
      const [tx, ty] = k.split(",").map(Number);
      const occupant = this.game.unitAt(tx, ty);
      if (occupant && occupant !== u) continue;
      for (const e of enemies) {
        if (e.dead || Math.abs(e.tx - tx) + Math.abs(e.ty - ty) !== 1) continue;
        const score = this._aiDamageRatio(u, { tx, ty }, e, false);
        if (score > targetScore) {
          targetScore = score;
          target = e;
        }
      }
    }
    if (!target) return null;
    const spear = this.game.computeDamage(
      Object.assign(Object.create(Object.getPrototypeOf(u)), u, { tx: target.tx + 1, ty: target.ty }),
      target,
    );
    if (spear >= target.hp) return null;
    const hit = Math.floor((spear * 100) / 256);
    let best = null,
      bestScore = 0;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const x = target.tx + dx,
        y = target.ty + dy;
      if (!this.game.inBounds(x, y)) continue;
      const here = x === u.tx && y === u.ty;
      if (!here && !reach.stops.has(key(x, y))) continue;
      const occupant = this.game.unitAt(x, y);
      if (occupant && occupant !== u) continue;
      let score = -1;
      for (const [ex, ey] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const other = this.game.unitAt(x + ex, y + ey);
        if (!other || other.dead || other === u) continue;
        if (other.team === u.team) score -= 1000;
        else if (!this.game._isHidden(other)) score += hit;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { tx: x, ty: y };
      }
    }
    return best;
  }

  // CHARGE LANE SCORE — createChargeTargetList (iOS Ep2 @0x70ba4): walk the lane from the launch tile `s` through the
  // target `e` and on, as the charge would ride: each unit struck adds its calcDamageRatio (the first blow with the
  // charge bonus); the ride goes on only past a FOOT unit (class 1 / 2) the blow kills, while the move lasts.
  _aiChargeScore(u, spot, e, reach) {
    const clone = (o, extra) => Object.assign(Object.create(Object.getPrototypeOf(o)), o, extra);
    const chargeDir = { dx: Math.sign(e.tx - spot.tx), dy: Math.sign(e.ty - spot.ty) };
    const attackerAt = clone(u, { tx: spot.tx, ty: spot.ty, chargeDir });
    let total = this._aiDamageRatio(u, spot, e, true);
    if (total <= -3000) return total;
    const moveBudget = this.game.moveOf(u),
      foot = (o) => o.T.al === 1 || o.T.al === 2;
    let spent =
      (reach.dist.get(key(spot.tx, spot.ty)) || 0) +
      this.game._chargeStep(attackerAt, spot.tx, spot.ty, e.tx, e.ty, chargeDir);
    let cur = e,
      left = e.hp - this.game.computeDamage(attackerAt, e, { charge: true });
    while (left <= 0 && foot(cur)) {
      let x = cur.tx,
        y = cur.ty,
        next = null;
      for (;;) {
        const nx = x + chargeDir.dx,
          ny = y + chargeDir.dy;
        if (!this.game.inBounds(nx, ny)) break;
        spent += this.game._chargeStep(attackerAt, x, y, nx, ny, chargeDir);
        if (spent > moveBudget) break;
        const other = this.game.unitAt(nx, ny);
        if (other && !other.dead && other.team !== u.team) {
          next = other;
          break;
        }
        x = nx;
        y = ny;
      }
      if (!next) break;
      const from = { tx: next.tx - chargeDir.dx, ty: next.ty - chargeDir.dy };
      total += this._aiDamageRatio(u, from, next, false);
      left = next.hp - this.game.computeDamage(clone(u, { tx: from.tx, ty: from.ty }), next, {});
      cur = next;
    }
    return total;
  }

  // ALLIED SIEGE BOMBARDMENT — aiConsiderAction state 15 (iOS Ep2 @0x7c98a), team 0 (the player's side) only: go over
  // the mission's siege points (Mission+0x7c, loadMarkers section D — walls, gates, towers). A point qualifies when it
  // gives cover (tile defence ≤ 99), holds no unit of the engine's own side, lies inside the armed weapon's range (the
  // Cannon and Ballistae arm their second weapon, Cannonball / Piercing Bolt) and has a friendly foot or cavalry unit
  // within 6 of it. The first such point with an enemy on it is fired on at once; otherwise the last empty one found.
  _siegePointShot(u) {
    // Episode II only: Episode I's record has the same list but no AI state reads it (only the concentration map)
    if (this.game.mission && this.game.mission.ep !== 2) return null;
    const points = this.game.mission && this.game.mission.siegePoints;
    if (!points || !points.length) return null;
    const weapon = u.type === "cannon" || u.type === "ballistae" ? u.T.weapon2 || u.T.weapon : u.T.weapon;
    const [mn, mx] = WEAPON_RANGE[weapon] || [1, 1];
    let fallback = null;
    for (const [x, y] of points) {
      if (!this.game.inBounds(x, y)) continue;
      const tileDamagePct = Math.round(100 - (this.game.terrainAt(x, y).defBonus || 0) * 100);
      if (tileDamagePct > 99) continue;
      const occupant = this.game.unitAt(x, y);
      if (occupant && !occupant.dead && occupant.team === u.team) continue;
      const dist = Math.abs(x - u.tx) + Math.abs(y - u.ty);
      if (dist < mn || dist > mx) continue;
      const infantry = this.game.units.some(
        (o) =>
          !o.dead &&
          o.team === u.team &&
          (o.T.al === 1 || o.T.al === 2 || o.T.al === 3) &&
          Math.abs(o.tx - x) + Math.abs(o.ty - y) <= 6,
      );
      if (!infantry) continue;
      if (occupant && !occupant.dead) return { tx: x, ty: y };
      fallback = { tx: x, ty: y };
    }
    return fallback;
  }

  // Unit::isInBattleRange (iOS Ep2 @0x7af10) — how near a foe must be before a unit positions for battle (ranged
  // mover / charge staging): the best of its weapons' max range, each + the unit's move unless that weapon is
  // Move-or-Shoot (tag 7) (the AI judges before moving), + its move once more when the record's byte 11 is 0 (only
  // Rangers, Sappers, Bodyguards and Blood Gorgers). E.g. Crossbowmen 6, Cavalry 1+8 = 9, Horse Bowmen 5+8 = 13.
  _battleRange(u) {
    const moveBudget = this.game.moveOf(u);
    let range = 0;
    for (const weapon of [u.T.weapon, u.T.weapon2]) {
      if (!weapon) continue;
      const mx = (WEAPON_RANGE[weapon] || [1, 1])[1],
        moveOrShoot = (WEAPON_TAGS[weapon] || []).includes(7);
      range = Math.max(range, mx + (moveOrShoot ? 0 : moveBudget));
    }
    if (["rangers", "sapper", "bodyguard", "bloodgorgers"].includes(u.type)) range += moveBudget;
    return range;
  }

  // Unit::getSupportThreatRatio (iOS Ep2 @0x7a63c) for `u` standing on `s`. Both halves are getThreat(tile, u's OWN
  // team, flag) (@0x7a4e6) — the summed best blow every other unit of its side that canAttack the tile could deal
  // (calculateAttackDamage vs u); with the flag it also adds 2 × the tile's heal bonus and its cover (100 − tile
  // defence). Zero counts as 16. The ratio is literally first << (8 / second): "allied firepower + cover".
  // `reachCache` keeps each ally's move reach across the candidate tiles of one decision.
  _supportRatio(u, spot, reachCache = new Map()) {
    let base = 0;
    for (const other of this.game.units) {
      if (other.dead || other === u || other.team !== u.team) continue;
      if (!this._canAttackTile(other, spot.tx, spot.ty, reachCache)) continue;
      base += this.game.computeDamage(other, u);
    }
    const terrain = this.game.terrainAt(spot.tx, spot.ty);
    let first = base + ((terrain.heal || 0) > 0 ? 2 * terrain.heal : 0) + Math.round((terrain.defBonus || 0) * 100);
    if (!first) first = 16;
    const second = base || 16;
    return first << Math.trunc(8 / second);
  }
  // getBestMoveRanged's tie-break folded into a score: a bounded, strictly increasing map of the ratio, so a nearer
  // foe distance (× 1e3) always outranks it.
  _supportTie(u, spot, reachCache) {
    const ratio = this._supportRatio(u, spot, reachCache);
    return (999 * ratio) / (ratio + 1);
  }
  // Unit::canAttack(tile) (iOS Ep2 @0x79c00): could `o` strike a unit standing on (tx, ty) this turn? Per weapon slot
  // (none, 24 and 34 skipped): a weapon tagged 7 or 8 (the shooting weapons) only from where `o` stands, the tile
  // inside its [min, max] band; any other weapon next to it — at distance 1, or, while `o` has not moved this turn and
  // the tile is within move + 1, from a free orthogonal neighbour of it that `o` can walk to within its move (a HOLD
  // group's member only to one within move / 2 of its hold slot).
  _canAttackTile(unit, tx, ty, reachCache) {
    const dist = Math.abs(unit.tx - tx) + Math.abs(unit.ty - ty),
      moveBudget = this.game.moveOf(unit);
    for (const weapon of [unit.T.weapon || 3, unit.T.weapon2]) {
      if (!weapon || weapon === 24 || weapon === 34) continue;
      const tags = WEAPON_TAGS[weapon] || [];
      if (tags.includes(7) || tags.includes(8)) {
        const [mn, mx] = WEAPON_RANGE[weapon] || [1, 1];
        if (dist >= mn && dist <= mx) return true;
        continue;
      }
      if (dist === 1) return true;
      if (dist > moveBudget + 1 || this.game._movedThisTurn(unit)) continue;
      let reach = reachCache && reachCache.get(unit);
      if (!reach) {
        reach = this.game.computeReach(unit);
        if (reachCache) reachCache.set(unit, reach);
      }
      const order = this._glOrder ? this._glOrder(unit) : null,
        hold = order && order.hold ? order : null;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const x = tx + dx,
          y = ty + dy;
        if (!this.game.inBounds(x, y)) continue;
        const occupant = this.game.unitAt(x, y);
        if (occupant && occupant !== unit) continue;
        if (!reach.stops.has(key(x, y))) continue;
        if (hold && Math.abs(hold.tx - x) + Math.abs(hold.ty - y) > Math.trunc(moveBudget / 2)) continue;
        return true;
      }
    }
    return false;
  }

  // Unit::isValidFormationTarget (iOS Ep2 @0x66108): a unit in a GroupLogic group only takes targets within 8 tiles of
  // its group's point — the group centre while it holds (mode 2), else the point it is marching on — except a foe
  // right next to it after it has moved.
  // DELIBERATE DEVIATION — only with ⚙ Realistic siege on (off by default = the original; user decision 2026-10-07): a
  // RANGED unit of any AI army, allied or enemy, is not leashed. In the original the 8-tile leash and the ranged mover
  // (which ignores it) fight: on Conquest of El Acclazar the allied trebuchets, a foe 9–10 away and in weapon range, may
  // not shoot it, so they step sideways or back instead of firing; and a garrison's musketeers and cannons hold their
  // fire on whatever is not near the point their group marches on. (The player's own units belong to no group.)
  _glValidTarget(u, spot, e) {
    if (this.game.realisticSiege && u.T.range > 1) return true;
    const groupIdx = this._glGroupOf(u);
    if (groupIdx == null) return true;
    const group = this.game._gl && this.game._gl[groupIdx];
    if (!group) return true;
    if ((spot.tx !== u.tx || spot.ty !== u.ty) && manhattan(e, spot) === 1) return true;
    const point = group.mode === 2 ? group.center : group.next || group.center;
    return !point || manhattan(point, e) <= 8;
  }

  // Unit::checkOpportunityMove (iOS Ep2 @0x7b35c). Keeps a gatehouse (Ep2 terrain type 16) or healing destination;
  // else looks at its 4 neighbours (−x, −y, +y, +x) the unit can reach: the first that heals wins; with `ranged` it
  // also takes the neighbour of lowest tile defence (the damage it lets through — 100 − cover), Formation units
  // counting −10 for each same-side unit next to that tile.
  _aiOpportunity(u, spot, reach, ranged) {
    const terrain = this.game.terrainAt(spot.tx, spot.ty);
    if (tileType(this.game.tileAt(spot.tx, spot.ty)) === 16 || (terrain.heal || 0) > 0) return spot;
    const defenceAt = (x, y) => {
      let value = Math.round(100 - (this.game.terrainAt(x, y).defBonus || 0) * 100);
      if (ranged && u.T.formation)
        for (const other of this.game.units)
          if (
            !other.dead &&
            other !== u &&
            other.team === u.team &&
            Math.abs(other.tx - x) + Math.abs(other.ty - y) === 1
          )
            value -= 10;
      return value;
    };
    let best = spot,
      bestD = defenceAt(spot.tx, spot.ty);
    for (const [dx, dy] of [
      [-1, 0],
      [0, -1],
      [0, 1],
      [1, 0],
    ]) {
      const x = spot.tx + dx,
        y = spot.ty + dy;
      if (!reach.stops.has(key(x, y))) continue;
      const occupant = this.game.unitAt(x, y);
      if (occupant && occupant !== u) continue;
      if ((this.game.terrainAt(x, y).heal || 0) > 0) return { tx: x, ty: y };
      if (ranged) {
        const value = defenceAt(x, y);
        if (value < bestD) {
          bestD = value;
          best = { tx: x, ty: y };
        }
      }
    }
    return best;
  }

  // Unit::getBestMoveCharge (iOS Ep2 @0x68ec0): the reachable free tile exactly 6 or 7 tiles (7 only for Griffon
  // Riders) from a foe with a clear straight charge lane (isValidChargePath @0x68d38 — orthogonal or diagonal, every
  // tile in between passable and empty; a Griffon or Great Eagle flies, so its lane is not walked at all — the
  // Android port's a.q alike), scored value × HP of that foe (Pikemen count 25 instead of their value). Never a foe
  // that itself charges, shoots-and-moves, or is a Wizard.
  // DELIBERATE DEVIATION (user decision 2026-10-07, MECHANICS.md §13): isValidChargePath takes a diagonal only when
  // dx == dy (foe down-right or up-left) — the other diagonal (dx == −dy) is refused, plainly a slip for |dx| == |dy|
  // (createChargeTargetList, the real charge, takes both). Here both diagonals count.
  _chargeStage(u, reach, enemies) {
    const flies = u.type === "griffon" || u.type === "greateagle";
    const lane = (sx, sy, e) => {
      const dx = e.tx - sx,
        dy = e.ty - sy,
        absX = Math.abs(dx),
        absY = Math.abs(dy);
      if (!(dx === 0 || dy === 0 || absX === absY)) return false;
      if (flies) return true;
      const steps = Math.max(absX, absY),
        fx = Math.sign(dx),
        fy = Math.sign(dy);
      let px = sx,
        py = sy;
      for (let i = 1; i < steps; i++) {
        const nx = sx + fx * i,
          ny = sy + fy * i;
        if (this.game.moveCost(u, nx, ny, px, py) >= 99) return false;
        const other = this.game.unitAt(nx, ny);
        if (other && other !== u) return false;
        px = nx;
        py = ny;
      }
      return true;
    };
    let best = null,
      bestScore = 0;
    for (const e of enemies) {
      if (e.dead || e.T.hasCharge || e.T.shootMove || e.T.teleport || !this._glValidTarget(u, u, e)) continue;
      const value = e.type === "pikemen" ? 25 : this._aiValue(e);
      for (const k of reach.stops) {
        const [tx, ty] = k.split(",").map(Number);
        const occupant = this.game.unitAt(tx, ty);
        if (occupant && occupant !== u) continue;
        const dist = Math.abs(e.tx - tx) + Math.abs(e.ty - ty);
        if (!(dist === 7 || (dist === 6 && u.type !== "griffon"))) continue;
        if (!lane(tx, ty, e)) continue;
        const score = value * e.hp;
        if (score > bestScore) {
          bestScore = score;
          best = { tx, ty };
        }
      }
    }
    return best;
  }

  // PRAYER — aiConsiderAction state 6, the moved branch (iOS Ep2 @0x7d35c): with a foe within 10, count the allies
  // within 2 not already Shielded or under Retribution (needs 2+), the enemy SHOOTERS within 10 (isRangedUnit — Move-or-
  // Shoot / Shoot-and-Move / Magic) and the enemy melee units within 10 that could reach it (within their move + 2).
  // No prayer unless shooters > 1 or melee > 1. Shooters ≥ melee (and any shooters) → SHIELD (action 6); else
  // RETRIBUTION (action 14). `force`: GameScreen::aiUpdate's own Shield — a Priest that has moved and has tried both
  // the prayer (state 6) and the heal (state 3) gets action 6 executed where it stands anyway (iOS Ep2 0x317fc, Ep1
  // 0x28c6a; Android a_g phase 3), so an AI Priest's turn always ends in a prayer or a heal.
  _priestPray(u, enemies, done, force = false) {
    if (!u.T.prayer) return false;
    let shield = true;
    if (!force) {
      const cover = this.game.units.filter(
        (a) =>
          !a.dead &&
          a !== u &&
          a.team === u.team &&
          manhattan(a, u) <= 2 &&
          !this.game._shielded(a) &&
          !this.game._retributioned(a),
      );
      if (cover.length <= 1) return false;
      let rangedThreats = 0,
        meleeThreats = 0;
      for (const e of enemies) {
        if (e.dead) continue;
        const dist = manhattan(e, u);
        if (dist > 10) continue;
        if (e.T.harasser || e.T.canLightning) rangedThreats++;
        else if (dist <= this.game.moveOf(e) + 2) meleeThreats++;
      }
      if (rangedThreats <= 1 && meleeThreats <= 1) return false;
      shield = rangedThreats > 0 && rangedThreats + 1 > meleeThreats;
    }
    u._prayed = true;
    this.game._prayerMark(shield ? "shield" : "retribution", u);
    this._aiPanThen(u.tx, u.ty, () => {
      this.game.floaters.push({
        x: u.px + this.game.tile / 2,
        y: u.py - 6,
        t: 0,
        life: 1.0,
        vy: -16,
        text: shield ? "Shield" : "Retribution!",
        crit: !shield,
        heal: true,
      });
      if (shield)
        this.game.spawnFx("ice", u.px + this.game.tile / 2, u.py + this.game.tile * 0.3, {}); // z_006 frost/energy dome
      else {
        this.game._retributionAngel(u); // 5017 #9, as the player's prayer
        this.game.audio.play("heal", 0.55); // Unit::retribution → sound 10
      }
      this.game.anim = {
        type: "attack",
        u,
        target: { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
        t: 0,
        hitDone: false,
        cast: true,
        done: () => {
          u.acted = true;
          this.game.aiDelay = 0.35;
          this.game._emit();
        },
      };
      u.attacking = true;
      u.anim = 0;
      u.animT = 0;
      this.game._emit();
    });
    return true;
  }

  // WIZARD STANDOFF — aiConsiderAction state 9 (iOS Ep2 @0x7ce06): a Magic unit that has not moved, with its nearest
  // foe within 9, moves to the reachable tile 5 or 6 from that foe on which no OTHER foe is nearer than it, the
  // farthest such tile (then the opportunity step, flag 0) — and casts from there. Null when there is none.
  _wizStandoff(u, reach, enemies) {
    let nearestFoe = null,
      nearestDist = FAR;
    for (const e of enemies) {
      if (e.dead) continue;
      const dist = manhattan(e, u);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestFoe = e;
      }
    }
    if (!nearestFoe || nearestDist > 9) return null;
    let best = null,
      bestDist = nearestDist;
    for (const k of reach.stops) {
      const [tx, ty] = k.split(",").map(Number);
      const occupant = this.game.unitAt(tx, ty);
      if (occupant && occupant !== u) continue;
      const foeDist = Math.abs(nearestFoe.tx - tx) + Math.abs(nearestFoe.ty - ty);
      if (foeDist < 5 || foeDist > 6) continue;
      if (
        this.game.units.some(
          (o) =>
            !o.dead && o.team !== u.team && o !== nearestFoe && Math.abs(o.tx - tx) + Math.abs(o.ty - ty) < foeDist,
        )
      )
        continue;
      if (foeDist > bestDist || bestDist > 6) {
        bestDist = foeDist;
        best = { tx, ty };
      }
    }
    if (!best) return null;
    const spot = this._aiOpportunity(u, best, reach, false);
    return spot.tx === u.tx && spot.ty === u.ty ? null : spot;
  }

  // RANGERS (Shoot-and-Move, not Horse Bowmen): the best shot from where it stands (determineBestAttack →
  // calcDamageRatio), then — Shoot-and-Move keeps its move — the ranged mover (getBestMoveRanged: the reachable tile
  // whose nearest foe is inside its range, farthest from it; ties → getSupportThreatRatio). False when it has no shot.
  _rangerRun(u, enemies) {
    const minR = u.T.minRange || 1,
      range = u.T.range;
    let target = null,
      targetScore = -3000;
    for (const e of enemies) {
      if (e.dead) continue;
      const dist = manhattan(e, u);
      if (dist < minR || dist > range) continue;
      const score = this._aiDamageRatio(u, { tx: u.tx, ty: u.ty }, e, false);
      if (score > targetScore) {
        targetScore = score;
        target = e;
      }
    }
    if (!target) return false;
    const finish = () => {
      u.acted = true;
      this.game.aiDelay = 0.3;
      this.game._emit();
    };
    const ride = () => {
      if (u.dead) return finish();
      const reach = this.game.computeReach(u),
        reachCache = new Map();
      let best = null,
        bestScore = -FAR;
      for (const k of reach.stops) {
        const [tx, ty] = k.split(",").map(Number);
        const occupant = this.game.unitAt(tx, ty);
        if (occupant && occupant !== u) continue;
        let foeDist = FAR;
        for (const e of enemies) if (!e.dead) foeDist = Math.min(foeDist, Math.abs(e.tx - tx) + Math.abs(e.ty - ty));
        if (foeDist < minR || foeDist > range) continue;
        const score = foeDist * 1e3 + this._supportTie(u, { tx, ty }, reachCache);
        if (score > bestScore) {
          bestScore = score;
          best = { tx, ty };
        }
      }
      if (!best || (best.tx === u.tx && best.ty === u.ty)) return finish();
      this.game.reach = reach;
      this._aiPanThen((u.tx + best.tx) / 2, (u.ty + best.ty) / 2, () =>
        this.game.moveUnit(u, this.game.pathTo(reach, best.tx, best.ty), finish),
      );
    };
    this._aiPanThen((u.tx + target.tx) / 2, (u.ty + target.ty) / 2, () => this.doAttackAI(u, target, ride));
    return true;
  }

  // Unit::getBestMovePriest (iOS Ep2 @0x7b8b8). Null when the nearest foe is farther than 10 or no tile beats standing.
  _priestMove(u, reach, enemies) {
    // Unit::isValidFormationMove (@0x7b224, flag 1): a grouped priest keeps within 4 of its group move order.
    const order = this._glOrder(u);
    let near = null,
      nearestDist = FAR;
    for (const e of enemies) {
      const dist = manhattan(e, u);
      if (dist < nearestDist) {
        nearestDist = dist;
        near = e;
      }
    }
    if (!near || nearestDist > 10) return null;
    let best = null,
      bestN = 0,
      bestD = nearestDist;
    for (const k of reach.stops) {
      const [tx, ty] = k.split(",").map(Number);
      const occupant = this.game.unitAt(tx, ty);
      if (occupant && occupant !== u) continue;
      if (order && Math.abs(order.tx - tx) + Math.abs(order.ty - ty) > (u.type === "griffon" ? 7 : 4)) continue;
      let covered = 0;
      for (const a of this.game.units)
        if (
          !a.dead &&
          a !== u &&
          a.team === u.team &&
          Math.abs(a.tx - tx) + Math.abs(a.ty - ty) <= 2 &&
          !this.game._shielded(a) &&
          !this.game._retributioned(a)
        )
          covered++;
      const foeDist = Math.abs(near.tx - tx) + Math.abs(near.ty - ty);
      if (covered > bestN || (covered === bestN && foeDist > bestD)) {
        bestN = covered;
        bestD = foeDist;
        best = { tx, ty };
      }
    }
    if (!best) return null;
    const spot = this._aiOpportunity(u, best, reach, false);
    return spot.tx === u.tx && spot.ty === u.ty ? null : spot;
  }

  // The original AREA-ATTACK AI (iOS Ep2 Unit::aiConsiderAction state 10 @0x7cbb0 → chooseBestAreaAttack @0x73eb4 /
  // aiConsiderAreaAttack @0x79988 → totalAreaAttackDamage @0x73bd0), judged from the tile the unit stands on. In the
  // original's order (a later option must score strictly higher to replace an earlier one):
  //   Grapeshot (cannon, weapon 24, not moved): each of the 4 firing directions, score × 1.5
  //   Fireball (25, range 2-7; any Magic unit)
  //   Barrage Rock (catapult, ability 25, weapon 20, range 3-8; not moved, nearest foe 3..8 away)
  //   Lightning (26, 3-7) and Ice (27, 3-7) — Magic units
  // A ranged option tries, for every foe in range, 7 aim tiles — the foe's own, its 4 orthogonal neighbours and the
  // diagonals (+1,+1) / (−1,−1) (static tables C.807/C.808) — each also in range. It fires only if the best is > 0.
  // Scoring: _aiAreaScore. Returns { tx, ty, spell? } or null.
  _aiBestArea(u) {
    const pick = {
      best: null,
      score: 0,
      offer(score, choice) {
        if (score > this.score) {
          this.score = score;
          this.best = choice;
        }
      },
    };
    const saved = u.spell;
    if (u.T.grapeshot) this._aiAreaGrapeshot(u, pick);
    if (u.T.weapon === 34) this._aiAreaShock(u, pick);
    if (u.T.canLightning) this._aiAreaAimed(u, pick, "fireball", 25, AREA_CROSS, "fireball");
    if ((u.T.abilities || []).includes(25) && !u.T.canLightning) {
      let near = FAR;
      for (const e of this.game.units)
        if (!e.dead && e.team !== u.team && !this.game._isHidden(e)) near = Math.min(near, manhattan(e, u));
      if (near > 2 && near <= 8) this._aiAreaAimed(u, pick, "rock", 20, AREA_CROSS, null);
    }
    if (u.T.canLightning) {
      this._aiAreaAimed(u, pick, "lightning", 26, AREA_SQ3, "lightning");
      this._aiAreaAimed(u, pick, "ice", 27, AREA_ICE, "ice");
    }
    u.spell = saved;
    return pick.best;
  }

  // totalAreaAttackDamage: the worth of a blast over `cells` (absolute [x, y, damage multiplier]); `kind` is
  // "fireball" | "lightning" | "ice" | another weapon. Σ over units in the blast, dmg = the hit it would take (as
  // resolveDamage deals it):
  //   foe  : + dmg·value·HP            own side: − 3·dmg·value·HP
  //   Ice  : ± 80·value·HP more for a unit with move > 4 that is not already slowed (+ uses its HP after the hit)
  //   Fire : ± 80·value·HP more when the hit would kill
  // and the whole option is −50 if it catches no foe, or (Lightning only) 2 foes or fewer.
  _aiAreaScore(u, kind, cells) {
    let total = 0,
      foes = 0;
    for (const [x, y, mult] of cells) {
      const e = this.game.unitAt(x, y);
      if (!e || e.dead || e === u || (e.team !== u.team && this.game._isHidden(e))) continue;
      const damage = Math.max(1, Math.round(this.game.computeDamage(u, e) * mult));
      const value = this._aiValue(e),
        hpBefore = e.hp,
        hpAfter = Math.max(0, hpBefore - damage);
      const fast = kind === "ice" && this.game.moveOf(e) > 4 && !e.slowed,
        kill = kind === "fireball" && hpAfter <= 0;
      if (e.team === u.team) {
        total -= 3 * damage * value * hpBefore;
        if (fast) total -= 80 * value * hpBefore;
        if (kill) total -= 80 * value * hpBefore;
      } else {
        foes++;
        total += damage * value * hpBefore;
        if (fast) total += 80 * value * hpAfter;
        if (kill) total += 80 * value * hpBefore;
      }
    }
    return !foes || (kind === "lightning" && foes <= 2) ? -50 : total;
  }

  // GRAPESHOT: each of the 4 firing directions — the forward scatter cone, every cell at full damage (resolveDamage's
  // grapeshot branch) — scored × 1.5.
  _aiAreaGrapeshot(u, pick) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const tx = u.tx + dx,
        ty = u.ty + dy;
      if (!this.game.inBounds(tx, ty)) continue;
      const seen = new Set(),
        cells = [];
      for (const cell of this.game._grapeshotCone(u, tx, ty)) {
        const cellKey = cell.tx + "," + cell.ty;
        if (!seen.has(cellKey) && this.game.inBounds(cell.tx, cell.ty)) {
          seen.add(cellKey);
          cells.push([cell.tx, cell.ty, 1]);
        }
      }
      pick.offer((this._aiAreaScore(u, "grapeshot", cells) * 3) / 2, { tx, ty });
    }
  }

  // SHOCK (the Ballistae's point-blank weapon 34, before it moves): the 4 tiles around it, full damage, × 1.5 —
  // only with a foe adjacent.
  _aiAreaShock(u, pick) {
    const cells = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => [u.tx + dx, u.ty + dy, 1])
      .filter(([x, y]) => this.game.inBounds(x, y));
    const adjacent = cells.find(([x, y]) => {
      const other = this.game.unitAt(x, y);
      return other && !other.dead && other.team !== u.team;
    });
    if (adjacent) pick.offer((this._aiAreaScore(u, "shock", cells) * 3) / 2, { tx: adjacent[0], ty: adjacent[1] });
  }

  // An AIMED area weapon `w` (its range from WEAPON_RANGE) with blast `shape`: every visible foe in range, each of
  // its 7 aim tiles (AIM_OFFSETS) that is itself in range. A Wizard arms `spell` first — computeDamage reads the
  // armed spell's weapon (the caller restores u.spell).
  _aiAreaAimed(u, pick, kind, weapon, shape, spell) {
    const [mn, mx] = WEAPON_RANGE[weapon];
    if (spell) u.spell = spell;
    for (const e of this.game.units) {
      if (e.dead || e.team === u.team || this.game._isHidden(e)) continue;
      const foeDist = manhattan(e, u);
      if (foeDist < mn || foeDist > mx) continue;
      for (const [offX, offY] of AIM_OFFSETS) {
        const aimX = e.tx + offX,
          aimY = e.ty + offY;
        if (!this.game.inBounds(aimX, aimY)) continue;
        const dist = Math.abs(aimX - u.tx) + Math.abs(aimY - u.ty);
        if (dist < mn || dist > mx) continue;
        pick.offer(
          this._aiAreaScore(
            u,
            kind,
            shape.map(([x, y, m]) => [aimX + x, aimY + y, m]),
          ),
          { spell, tx: aimX, ty: aimY },
        );
      }
    }
  }
  // Fire the chosen area attack at a tile — a unit standing there is the centre, empty ground a phantom (as
  // _castGroundAoe). A wizard arms the chosen spell; a cannon's adjacent aim tile makes resolveDamage fire Grapeshot.
  _aiCast(u, aim) {
    this.game._dbg("cast", {
      u: u.id,
      ty: u.type,
      at: [u.tx, u.ty],
      spell: aim.spell || u.spell,
      tgt: [aim.tx, aim.ty],
    });
    if (aim.spell) u.spell = aim.spell;
    const real = this.game.unitAt(aim.tx, aim.ty),
      tile = this.game.tile;
    const defaultAim =
      real && !real.dead
        ? real
        : {
            tx: aim.tx,
            ty: aim.ty,
            px: aim.tx * tile,
            py: aim.ty * tile,
            T: {},
            hp: 100,
            dead: false,
            _phantom: true,
            team: "_ground",
          };
    this._aiPanThen((u.tx + aim.tx) / 2, (u.ty + aim.ty) / 2, () => this.doAttackAI(u, defaultAim));
  }

  // HORSE BOWMEN — Unit::getBestMoveHorsebowmen (iOS Ep2 @0x691cc, called from getBestMoveLocation for unit type 14).
  // It measures the nearest foe from where it stands: if that foe is 4 tiles or closer it rides to the reachable tile
  // FARTHEST from its start whose nearest foe is more than 5 away (breaks contact); otherwise to the farthest tile
  // whose nearest foe is 5 or closer (into bow range). One move and one arrow a turn. GameScreen::aiUpdate phase 3
  // sends Horse Bowmen (unit type 14) straight to the MOVE (skipping the stand-still target check), so it RIDES
  // FIRST and then shoots from where it lands; only when no ride tile exists does it shoot from where it stands.
  // Returns false when there is neither a shot nor a ride (the caller falls back to the generic movers).
  _horseBowRun(u, enemies) {
    const live = () => enemies.filter((e) => !e.dead);
    const nearestD = (tx, ty) => {
      let least = FAR;
      for (const e of live()) {
        const dist = Math.abs(e.tx - tx) + Math.abs(e.ty - ty);
        if (dist < least) least = dist;
      }
      return least;
    };
    const pickRide = () => {
      const reach = this.game.computeReach(u, this.game.moveOf(u)),
        startDist = nearestD(u.tx, u.ty);
      let best = null,
        far = 0;
      for (const k of reach.stops) {
        const [tx, ty] = k.split(",").map(Number);
        const occupant = this.game.unitAt(tx, ty);
        if (occupant && occupant !== u) continue;
        const foeDist = nearestD(tx, ty);
        if (startDist <= 4 ? foeDist <= 5 : foeDist > 5) continue;
        const moveDist = Math.abs(tx - u.tx) + Math.abs(ty - u.ty);
        if (moveDist > far) {
          far = moveDist;
          best = { tx, ty, reach };
        }
      }
      return best;
    };
    const finish = () => {
      u.acted = true;
      this.game.aiDelay = 0.3;
      this.game._emit();
    };
    const ride = (then) => {
      const chosenRide = u.dead ? null : pickRide();
      if (!chosenRide) return then();
      this.game.reach = chosenRide.reach;
      this._aiPanThen((u.tx + chosenRide.tx) / 2, (u.ty + chosenRide.ty) / 2, () =>
        this.game.moveUnit(u, this.game.pathTo(chosenRide.reach, chosenRide.tx, chosenRide.ty), then),
      );
    };
    if (pickRide()) {
      ride(finish);
      return true;
    } // the ride fires on the way and counts as the attack
    return false;
  }
}
