/* ============================================================
   Reign of Swords — deployment & battle start.
   The pre-battle phase: the deploy-point budget and roster accounting
   (deployBudget / deployCost / isElite / deploySpent / eliteCount /
   placedCount / rosterCount), placing & removing units (setPlacing /
   canAfford / placeUnit / removeUnit), the deploy-zone tap handler
   (_deployClick), and the hand-off into the fight (canStartBattle /
   startBattle, the scripted opening moves, hero escape and the opening Prayer
   dome). Mixed onto Game.prototype in engine/engine.js — every method runs with
   `this` = the live Game (reading the built this.rosterMap and this.mission);
   the shared unit factory this._makeUnit stays in the engine kernel.
   ============================================================ */

import { key } from "../util/util.js";
import { UNIT_TYPES } from "../data/game-data.js";

export class DeployMethods {
  // --- deployment ---
  // Effective deploy point limit. God-army (DEV) lifts it to 90000 so the whole sandbox roster fits;
  // otherwise it's the mission's real gold budget.
  deployBudget() {
    return this.godArmy ? 90000 : this.mission.deploy ? this.mission.deploy.budget : 0;
  }
  deployCost(type) {
    return this.rosterMap && this.rosterMap[type] ? this.rosterMap[type].cost : 0;
  }
  isElite(type) {
    return !!(this.rosterMap && this.rosterMap[type] && this.rosterMap[type].elite);
  }
  maxElite() {
    const set = this._hsEliteSlots(); // hot-seat: the setup may give each player their own Medals
    return set != null ? set : Math.floor(this.deployBudget() / 1000);
  } // UnitSelector ctor: elite slots = budget / 1000 (can be 0)
  deploySpent() {
    return this.units
      .filter((u) => u.team === "blue" && !u.hero && !u.preset)
      .reduce((s, u) => s + this.deployCost(u.type), 0);
  }
  // Only the elites YOU muster count against the cap: allied armies and the record's pre-placed core are not your purchases.
  eliteCount() {
    return this.units.filter((u) => u.team === "blue" && !u.hero && !u.ally && !u.preset && this.isElite(u.type))
      .length;
  }
  // Only units YOU mustered count against a type's limit (your owned counts) — like eliteCount. It counted every
  // blue unit, so an ALLIED army's Hero (type king, preset+ally) used up one of your own Heroes.
  placedCount(type) {
    return this.units.filter((u) => u.team === "blue" && !u.hero && !u.ally && !u.preset && u.type === type).length;
  }
  rosterCount(type) {
    return this.rosterMap && this.rosterMap[type] ? this.rosterMap[type].count : null;
  }
  setPlacing(type) {
    this.placing = this.placing === type ? null : type;
    this.pickHero = false;
    this.pickUp = null;
    this._emit();
  }
  canAfford(type) {
    if (this.rosterMap && !this.rosterMap[type]) return false; // only the units your muster roster lists (your army)
    const placed = this.rosterCount(type);
    return (
      this.deploySpent() + this.deployCost(type) <= this.deployBudget() &&
      (!this.isElite(type) || this.eliteCount() < this.maxElite()) &&
      (placed == null || this.placedCount(type) < placed)
    );
  }
  // UnitSelector::placeCurrent (iOS Ep2 @0x81522): a unit may be set down only where Map::getMoveCost for it is within
  // its movement — so war engines (cost 100 on houses, walls, towers, woods) can't be mustered there, nor cavalry on
  // ground it can't ride. The same test guards moving an issued unit or the Hero within the muster.
  _canDeployAt(unitOrType, tx, ty) {
    const u =
      typeof unitOrType === "string"
        ? {
            type: unitOrType,
            T: UNIT_TYPES[unitOrType] || {},
            team: "blue",
            group: this.mission && this.mission.playerGroup,
          }
        : unitOrType;
    return this.moveCost(u, tx, ty) <= (u.T.move || 4);
  }
  // A refused muster tile says why (the original just ignores the tap).
  _deployRefused(u) {
    const T = typeof u === "string" ? UNIT_TYPES[u] || {} : u.T || {};
    this.notify("{u} can't be deployed here — it couldn't move onto this ground.", { u: T.name || "This unit" });
    this.audio.play("click", 0.3);
    this._emit();
  }
  placeUnit(type, tx, ty) {
    if (!this.canAfford(type)) return;
    if (!this._canDeployAt(type, tx, ty)) {
      this._deployRefused(type);
      return;
    }
    this._hsTagUnit(this._makeUnit(type, "blue", tx, ty, false)); // hot-seat: the active player's group + colours
    this.audio.play("place", 0.45);
    this._emit(); // deploy place (sound 39)
  }
  removeUnit(u) {
    this.units = this.units.filter((x) => x !== u);
    this.audio.play("remove", 0.4);
    this._emit();
  } // taken back (sound 40)
  // REPEAT THE LAST SETUP — GameScreen::saveRaidSetup / loadRaidSetup / captureDeployData (iOS Ep2 @0x1d85c /
  // @0x24084 / @0x1bc6a, Ep1 @0x18d88): when a muster is complete the units you placed are kept per map (type, tile,
  // facing; "setup<map><side>.sav"), and the next muster of that map asks "Previous Setup Found" and sets them down
  // again. The record's issued force and allies are not part of it; the Hero's tile is (ours: he stands where you
  // left him). The UI stores the setup (ui/ReignOfSwords.jsx).
  deploySetup() {
    const mine = this.units.filter((u) => u.team === "blue" && !u.hero && !u.ally && !u.preset && !u.dead);
    const hero = this.units.find((u) => u.team === "blue" && u.hero && !u.ally && !u.dead);
    return {
      units: mine.map((u) => ({ type: u.type, tx: u.tx, ty: u.ty, face: u.face })),
      hero: hero ? { tx: hero.tx, ty: hero.ty } : null,
    };
  }
  // Sets a kept setup down. A unit no longer in your army (or whose tile is taken, or which the budget no longer
  // covers) is left out and the original's "Missing Units" warning shows. Returns how many were left out.
  applySetup(setup) {
    if (this.phase !== "deploy" || !setup) return 0;
    const free = (tx, ty) =>
      this.deployZone.has(key(tx, ty)) && !this.unitAt(tx, ty) && this.terrainAt(tx, ty).passable;
    const hero = this.units.find((u) => u.team === "blue" && u.hero && !u.ally && !u.dead);
    if (
      hero &&
      setup.hero &&
      free(setup.hero.tx, setup.hero.ty) &&
      this._canDeployAt(hero, setup.hero.tx, setup.hero.ty)
    ) {
      hero.tx = setup.hero.tx;
      hero.ty = setup.hero.ty;
      hero.face = hero.tx < this.cols / 2 ? 1 : -1;
      hero.px = hero.tx * this.tile;
      hero.py = hero.ty * this.tile;
    }
    let missing = 0;
    for (const s of setup.units || []) {
      if (
        !UNIT_TYPES[s.type] ||
        !free(s.tx, s.ty) ||
        !this.canAfford(s.type) ||
        !this._canDeployAt(s.type, s.tx, s.ty)
      ) {
        missing++;
        continue;
      }
      const u = this._makeUnit(s.type, "blue", s.tx, s.ty, false);
      this._hsTagUnit(u);
      if (s.face) u.face = s.face;
    }
    this.placing = null;
    this.audio.play("place", 0.45);
    if (missing)
      this.notify(
        "WARNING: not all of the previously placed units exist in your army. Be sure to add new units to the configuration.",
      );
    this._emit();
    return missing;
  }
  canStartBattle() {
    return this.phase !== "deploy" || this.units.some((u) => u.team === "blue" && !u.ally);
  }
  startBattle() {
    if (this.phase !== "deploy") return;
    if (!this.units.some((u) => u.team === "blue" && !u.ally)) {
      // nothing mustered — the original refuses (iOS Ep2 GameScreen::onSendRaidClicked @0x295ee, string 825)
      this.notify("ARMY SIZE TOO SMALL: Your army is too small, and refuses to go to battle against hopeless odds.");
      this._emit();
      return;
    }
    if (this._hsMusterDone()) return; // hot-seat: player 1 is mustered — player 2 musters next
    this.placing = null;
    this.pickHero = false;
    this.pickUp = null;
    this._musterHeld = false; // never answered: the opening runs below, from runInitial
    this.phase = "player";
    for (const u of this.units) if (!u.dead && this._canHideUnit(u) && this._canHide(u)) this._setHidden(u, true); // createUnitAt: hidden from the start in cover
    this.units.forEach((u) => {
      if (u.team === "blue") u.acted = false;
    });
    // Deployment DRILL: the lesson is complete the moment you finish the muster. Show the commander's closing
    // line ("The men are ready then? Good.") on its OWN, then complete to victory when it's dismissed — so the
    // dialogue plays BEFORE the victory modal instead of both popping at once. (finishDrill() does the win.)
    if (this.mission.deployDrill) {
      const round1 = (this.mission.events || []).filter((e) => e.round === 1);
      const ready = round1[round1.length - 1]; // the last round-1 line = "The men are ready then? Good."
      if (ready)
        this.battleEvent = {
          lines: [{ speaker: ready.speaker, side: ready.side, face: ready.face, text: ready.text }],
          id: (this._eventId = (this._eventId || 0) + 1),
        };
      this._pendingDrillWin = true;
      if (!ready) {
        this.phase = "victory";
      } // no dialogue to show → just complete
      this._emit();
      return;
    }
    // A scripted commander flee/move (op3) plays FIRST — his line, then he rides off — and only then does the
    // round-1 dialogue + the battle opening follow (so the two dialogues never overwrite each other).
    if (this.mission.script) {
      // the record's own battle-start staging replaces the reconstructed flee
      if (this._deployOpened) {
        this._openRound1();
        this._emit();
        return;
      } // it already ran as the muster opened (openBattle)
      this.scenario.runInitial(() => this._openRound1());
      this._emit();
      return;
    }
    if (this._doHeroFlee(() => this._openRound1())) {
      this._emit();
      return;
    }
    this._openRound1(); // the battle-start prayer, round-1 dialogue and the opening, once the muster is done
    this._emit();
  }
  // REAL scripted battle-start unit moves (op3 in the scenario command VM: c(unitId,x,y) — decoded from the DEX),
  // with the op1 line that precedes them in the chain. On Marsur 1 the coward commander orders his men to hold,
  // says his line, then FLEES off the field (m.flee → he rides to the edge and is removed). Marsur 2 is a plain
  // reposition (he shouts an order and moves to a command tile, stays). The line shows first, THEN he moves.
  _fireScriptedMoves(cb) {
    if (!this.mission.scriptedMoves || !this.mission.scriptedMoves.length) return false;
    const due = this.mission.scriptedMoves
      .map((m, i) => [m, i])
      .filter(([m, i]) => !this._firedMoves.has(i) && (m.round || 0) <= this.turn && this._scriptedMover(m));
    if (!due.length) return false;
    // show the commander's line first (if any); the walk begins when it's dismissed
    const line = due.map(([m]) => m.line).find(Boolean);
    const runMoves = () => {
      let pending = 0;
      due.forEach(([move, i]) => {
        this._firedMoves.add(i);
        const u = this._scriptedMover(move);
        if (!u) return;
        pending++;
        u.acted = true;
        this.centerOn(u.tx, u.ty, true);
        this.floaters.push({
          x: u.px + this.tile / 2,
          y: u.py - 6,
          t: 0,
          life: 1.6,
          vy: -12,
          text: move.flee ? "The enemy commander flees!" : "The enemy commander moves up!",
          crit: true,
          heal: true,
        });
        // He walks his real path to the move's tile (op3 walks the unit, as engine/script walk); a flee then carries him
        // one step past the edge and he is removed. No path (the tile taken) → straight there, as before.
        let path = null;
        try {
          path = this.pathTo(this.computeReach(u, 99), move.to[0], move.to[1]);
        } catch (e) {
          path = null;
        }
        if (!path || path.length < 2)
          path = [
            { tx: u.tx, ty: u.ty },
            { tx: move.to[0], ty: move.to[1] },
          ];
        if (move.flee) {
          const off = this._fleeOffTile(move.to);
          path = [...path, { tx: off[0], ty: off[1] }];
        }
        this.moveUnit(u, path, () => {
          if (move.flee) {
            this.units = this.units.filter((x) => x !== u);
            this.audio.play("leave", 0.5);
          } // the coward escapes the field (snd 23: Map::removeUnit -> play 23)
          else this.centerOn(move.to[0], move.to[1], true);
          if (--pending === 0 && cb) cb();
        });
      });
      if (pending === 0 && cb) cb();
    };
    if (line) {
      this.battleEvent = { lines: [line], id: (this._eventId = (this._eventId || 0) + 1) };
      this._pendingScriptedMoves = runMoves;
    } else runMoves();
    return true;
  }
  // A flee destination pushed one tile PAST the nearest map edge, so the commander gallops off-screen before he's removed.
  // The unit a scripted move is for: the one the script spawned on its `from` tile, by its script id — by the move's
  // round it may have walked away (Caladrin Defense: Landower, placed at (7,1), flees on round 3 from wherever the
  // fighting took him) — else whoever stands on that tile.
  _scriptedMover(move) {
    const actions = (this.mission.script && this.mission.script.actions) || [];
    const spawned = actions.find((a) => a.op === 0 && a.x === move.from[0] && a.y === move.from[1] && a.sid != null);
    const bySid = spawned && this.scenario ? this.scenario.unit(spawned.sid) : null;
    return bySid || this.units.find((x) => !x.dead && x.tx === move.from[0] && x.ty === move.from[1]) || null;
  }
  _fleeOffTile([tx, ty]) {
    const toLeft = tx,
      toRight = this.cols - 1 - tx,
      toTop = ty,
      toBottom = this.rows - 1 - ty,
      nearest = Math.min(toLeft, toRight, toTop, toBottom);
    if (nearest === toRight) return [this.cols + 1, ty];
    if (nearest === toLeft) return [-2, ty];
    if (nearest === toBottom) return [tx, this.rows + 1];
    return [tx, -2];
  }
  // Enemy-commander flight. Prefers the REAL decoded op3 move (above); falls back to the reconstructed
  // "gallop off the nearest edge" staging only for a map that still declares this.mission.heroFlee with no op3 data.
  _doHeroFlee(cb) {
    if (this._fireScriptedMoves(cb)) return true;
    if (!this.mission.heroFlee) return false;
    const u = this.units.find((x) => !x.dead && x.team === "red" && x.type === this.mission.heroFlee);
    if (!u) return false;
    const toLeft = u.tx,
      toRight = this.cols - 1 - u.tx,
      toTop = u.ty,
      toBottom = this.rows - 1 - u.ty; // flee off the NEAREST edge
    const nearest = Math.min(toLeft, toRight, toTop, toBottom);
    let ex = u.tx,
      ey = u.ty;
    if (nearest === toRight) ex = this.cols + 1;
    else if (nearest === toLeft) ex = -2;
    else if (nearest === toBottom) ey = this.rows + 1;
    else ey = -2;
    u.acted = true;
    u._fleeing = true;
    this.floaters.push({
      x: u.px + this.tile / 2,
      y: u.py - 6,
      t: 0,
      life: 1.6,
      vy: -12,
      text: "The enemy commander flees!",
      crit: true,
      heal: true,
    });
    this.centerOn(u.tx, u.ty, true);
    this.moveUnit(
      u,
      [
        { tx: u.tx, ty: u.ty },
        { tx: ex, ty: ey },
      ],
      () => {
        this.units = this.units.filter((x) => x !== u);
        this.audio.play("leave", 0.5);
        cb && cb();
      },
    );
    return true;
  }
  _deployClick(tx, ty) {
    const occupant = this.unitAt(tx, ty);
    if (occupant) {
      if (occupant.hero) {
        this.pickHero = !this.pickHero;
        this.pickUp = null;
        this.placing = null;
        this.audio.play("click", 0.4);
        this._emit();
        return;
      } // pick up / drop the Hero
      if (occupant.team === "blue" && occupant.ally) return; // allied AI armies are not yours to place, move, or remove
      if (occupant.team === "blue") {
        // Your ISSUED (preset) force can be REPOSITIONED during deploy: click a unit to pick it up, then click an
        // empty muster tile to move it — or click another issued unit to SWAP their places. (Some missions field a
        // fixed force that fills the whole muster zone, so you arrange rather than add — this is what makes those
        // playable instead of a dead deploy screen.) Units YOU placed from the budget are removed (refunded) on click.
        if (this.pickUp && this.pickUp !== occupant && occupant.preset && this.pickUp.preset) {
          const a = this.pickUp,
            fromX = a.tx,
            fromY = a.ty,
            tilePx = this.tile;
          if (!this._canDeployAt(a, occupant.tx, occupant.ty)) {
            this._deployRefused(a);
            return;
          } // each must be able to stand on the other's tile
          if (!this._canDeployAt(occupant, fromX, fromY)) {
            this._deployRefused(occupant);
            return;
          }
          a.tx = occupant.tx;
          a.ty = occupant.ty;
          a.px = a.tx * tilePx;
          a.py = a.ty * tilePx;
          occupant.tx = fromX;
          occupant.ty = fromY;
          occupant.px = fromX * tilePx;
          occupant.py = fromY * tilePx;
          this.pickUp = null;
          this.audio.play("click", 0.4);
          this._emit();
          return;
        }
        if (occupant.preset) {
          this.pickUp = this.pickUp === occupant ? null : occupant;
          this.placing = null;
          this.pickHero = false;
          this.audio.play("click", 0.4);
          this._emit();
          return;
        }
        this.removeUnit(occupant);
        return; // a unit you deployed from the budget → pick back up (refund)
      }
      return;
    }
    if (!this.deployZone.has(key(tx, ty)) || !this.terrainAt(tx, ty).passable) return;
    if (this.pickHero) {
      // reposition the Hero within the deploy zone
      const hero = this.units.find((u) => u.hero && u.team === "blue");
      if (hero && !this._canDeployAt(hero, tx, ty)) {
        this._deployRefused(hero);
        return;
      }
      if (hero) {
        hero.tx = tx;
        hero.ty = ty;
        hero.face = tx < this.cols / 2 ? 1 : -1;
        hero.px = tx * this.tile;
        hero.py = ty * this.tile;
      }
      this.pickHero = false;
      this.audio.play("click", 0.4);
      this._emit();
      return;
    }
    if (this.pickUp) {
      // drop the held issued unit onto an empty muster tile
      const u = this.pickUp;
      if (!this._canDeployAt(u, tx, ty)) {
        this._deployRefused(u);
        return;
      }
      u.tx = tx;
      u.ty = ty;
      u.px = tx * this.tile;
      u.py = ty * this.tile;
      this.pickUp = null;
      this.audio.play("click", 0.4);
      this._emit();
      return;
    }
    if (!this.placing) return;
    this.placeUnit(this.placing, tx, ty);
  }
}
