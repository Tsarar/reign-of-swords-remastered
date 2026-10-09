/* ============================================================
   Reign of Swords — turn & phase orchestration.
   The battle's clock: win/lose evaluation (_terminal), end-of-turn checks
   (_checkPhaseEnd / endTurn), the pre-battle March order and Formation march
   (canOrder / beginMarch / groupMarch / _marchStep / _marchAttack), the AOE aim
   toggle (canAim / toggleAim / cancelAim), reinforcement waves & scripted event
   beats (_fireWaves / _fireEvents / _announceTurn), and the whole player ->
   ally -> enemy phase cycle (_startFriendlyTurnEnd, the per-group AI segment
   driver, startAllyPhase / startEnemyPhase / end*Phase). Mixed onto
   Game.prototype in engine/engine.js — every method runs with `this` = the live Game;
   the active mission is read as `this.mission`.
   ============================================================ */

import { key, manhattan } from "../util/util.js";
import {
  UNIT_TYPES,
  DEPLOY_COST,
  GROUP_BANDS,
  ALLY_BANDS,
  ALLY_CRESTS,
  BANNER_TINCTURE,
  TINCTURE_RGB,
  ENEMY_CRESTS,
  BANNER_CREST,
  CREST_FIELD,
  BANNER_FRAME,
  factionHeraldry,
} from "../data/game-data.js";
import { spellStats } from "../data/combat-data.js";

// How long the whose-turn banner is up (its banners.css animation: in 0.4s, out at 1.25s + 0.45s). The battle waits
// it out — no AI move, march step or tap lands behind it. Counted in game time, so fast-forward shortens it 4×.
export const TURN_BANNER_HOLD = 1.7;

export class TurnFlowMethods {
  // A unit's group record ({name, banner, side}) — the real global groupOrder table when the map carries it,
  // else the legacy per-side allyGroups/enemyGroups table (skirmish/tutorial maps).
  _groupMeta(u) {
    const groupIdx = u.group || 0;
    if (this.mission.groupByGi && this.mission.groupByGi[groupIdx]) return this.mission.groupByGi[groupIdx];
    const table = u.ally ? this.mission.allyGroups : this.mission.enemyGroups;
    return (table && table[String(groupIdx)]) || null;
  }
  // The one faction colour for a group — a heraldry banner tincture keyed by the real banner index (attrs[4]),
  // else the documented ally/enemy strength palette (Green/Blue/Cyan · Red/Orange/Yellow) cycled by group.
  _factionColor(u) {
    // The team INDICATOR band follows the game's rule — ally = Green/Blue/Cyan, enemy = Red/Orange/Yellow —
    // distinct per group so independent armies read apart. (Heraldry art is the crest, drawn separately.)
    const groupIdx = u.group || 0,
      pal = u.ally ? ALLY_BANDS : GROUP_BANDS;
    return pal[groupIdx % pal.length];
  }
  // A drill's closing conversation: shown now, and the drill ends once it is read (engine eventClosed).
  _drillSpeech(lines) {
    this._pendingDrillWin = true;
    this._noteShownLines(lines);
    this.battleEvent = { lines: lines.map((l) => ({ ...l })), id: (this._eventId = (this._eventId || 0) + 1) };
    this._emit();
  }
  // --- turn flow ---
  _terminal() {
    this.updateObjectives();
    this.scenario.onDeath(); // fire UNIT-LOST script triggers (ambush waves) BEFORE judging the field
    const blue = this.units.filter((u) => !u.dead && u.team === "blue");
    const red = this.units.filter((u) => !u.dead && u.team === "red");
    // GameScreen::checkOutcome has no Hero, ally, war-engine or casualty rule: those losses are the maps' own scripts
    // (a tag-7 death bumps a counter; tag 8 at the limit plays a retreat conversation that leaves the battle —
    // Sangsoleil 1's 6 dead, The High Pass's 3 engines, Hunewold Raid 1's 7 carts → scenario.finish).
    // Nobody of yours left on the field is outcome 0: it plays the map's DEFEAT sequence (tag 5) — which on the escape
    // maps is the "we've escaped" line and leads to the Spoils, so emptying the field there (the last of your units
    // escaped, or fell after the rest got away) is a win. A retreat line the same death just queued ends it first.
    if (blue.length === 0) {
      if (this._sc && this._sc.end) return null;
      return this.mission.wipedWins || (this._sc && this._sc.escaped && this.phase === "victory")
        ? "victory"
        : this._lose("wiped");
    }
    // MOVEMENT DRILL — the record's goal trigger (data/missions drillGoalOf; checkLocationTriggers' goal triggers):
    // once `count` of your units STAND in the objective area, its command plays — Sir Anston's address — and the drill
    // is over once it is read (eventClosed → _pendingDrillWin).
    const goal = this.mission.drillGoal;
    if (goal && this.tutZone) {
      if (!this._pendingDrillWin && blue.filter((u) => this.tutZone.has(key(u.tx, u.ty))).length >= goal.count) {
        if (!goal.lines.length) return "victory";
        this._drillSpeech(goal.lines);
      }
      return null;
    }
    // (a drill with no goal trigger: done the moment every unit stands on a green tile)
    if (this.tutZone && this.tutZone.size && blue.length && blue.every((u) => this.tutZone.has(key(u.tx, u.ty))))
      return "victory";
    if (this.mission.noEnemy) return null; // other no-enemy tutorials: complete at the turn limit
    // GameScreen::checkOutcome: wiping out every enemy ON THE FIELD wins — unless the script has turned the win switch
    // off (op10 SETFLAG 0 → Mission+0x1ac; on by default). Units still to arrive don't count, so a map with later
    // waves and no switch is won before they come; the maps that must wait for their last wave (or an escort) keep the
    // switch off until it spawns. Script-hidden enemies (HIDE) count like any other: they stay on their tile.
    const winSwitch = !(this._sc && this._sc.flags && this._sc.flags[0] === 0);
    // …and the original only asks once a unit has left the field (updateUnits → checkOutcome(0)) or a turn has ended
    // (endTurn → checkOutcome(1)) — never at the start, before the round-1 wave of a map that opens with no enemy
    // on the field (Rukiev 2's horselords) has arrived.
    if (red.length) this._redSeen = true;
    const asked = this._redSeen || this._turnEnded;
    if (red.length === 0 && winSwitch && asked) {
      this.majorVictory = this._isMajorVictory(blue);
      return "victory";
    }
    // (No "hold every objective tile" win: checkOutcome has none — capture areas only score the holder bonus.)
    return null;
  }
  // MAJOR VICTORY — GameScreen::checkOutcome (iOS Ep2 @0x26edc, Ep1 @0x20de0): a win by wiping out the enemy is
  // outcome 3 instead of 2 when what is left of your side — sum over its living units of HP/256 x deploy cost
  // (Unit+0x190 x +0x194), x1.25 while it holds the capture objective (Mission+0x260, set by updateCapturePoints) —
  // reaches budget x 5 x 2048 / 100 on the 256 scale, i.e. 40% of your deploy budget (Mission+0x238[side]; a preset
  // army with no budget always qualifies). createRewardsMenu then grants one Medal in every mode but the story
  // campaign (mode 0), so Medals come only from raids. Other wins (escape, escort, objectives) are plain victories.
  // The turn limit ran out (a no-enemy drill is simply complete). GameScreen::endTurn (Ep2 @0x2a4f2) asks checkOutcome(2): the story campaign (mode 0) and siege raids (mode 3) are simply lost, but a
  // SKIRMISH (mode 2) is judged on strength — each side's sum of HP x deploy cost over its living units, x1.25 for the
  // side holding the capture objective — and you win if yours is at least theirs (a plain victory, never Major).
  _timeoutOutcome() {
    if (this.mission.noEnemy) {
      // the movement drill out of turns: the record's VICTORY sequence line ("Perhaps your days as a squire…"), then over
      const lines = this.mission.timeoutLines;
      if (lines && lines.length && !this._pendingDrillWin) {
        this._drillSpeech(lines);
        return this.phase;
      }
      return "victory";
    }
    if (this.mission.group !== "skirmish") return this._lose("turns");
    const holder = this._captureHolder(),
      str = (team) => {
        let strength = 0;
        for (const u of this.units)
          if (!u.dead && u.team === team) strength += (u.hp / 100) * (DEPLOY_COST[u.type] || 0);
        return holder === team ? strength * 1.25 : strength;
      };
    return str("blue") >= str("red") ? "victory" : this._lose("turns");
  }
  // Why the battle was lost — the defeat card explains it: wiped (your whole army fell), script (the map's own
  // conversation called the retreat), escort (too few escorted units left to deliver), turns (out of time). Returns "defeat" so callers can `return this._lose(..)`.
  _lose(reason) {
    this.defeatReason = reason;
    return "defeat";
  }
  // The map's loss counter, for the HUD: a script whose tag-8 trigger [counter, n, cmd] plays a conversation that
  // leaves the battle counts deaths (tag 7 → op9) toward that n — Sangsoleil 1 turns back at 6 dead, The High Pass at
  // 3 engines, Hunewold Raid 1 at 7 carts. lost = the counter, maxLost = n - 1 (one more and the battle is lost).
  // Escape maps (header type 3) also show how many have reached the goal.
  escapeStatus() {
    const script = this.mission && this.mission.script,
      S = this._sc;
    if (!script || !S || this.phase === "deploy") return null;
    if (this._lossTrig === undefined) {
      const ends = (i) => {
        for (let guard = 0; i >= 0 && i < script.actions.length && guard < 64; guard++) {
          if (script.actions[i].end) return script.actions[i].end === "defeat";
          i = script.actions[i].next;
        }
        return false;
      };
      this._lossTrig = script.triggers.find((t) => t.tag === 8 && ends(t.a[t.a.length - 1])) || null;
    }
    const trig = this._lossTrig;
    if (!trig) return null;
    return {
      escaped: S.escaped || 0,
      lost: S.counters[trig.a[0]] || 0,
      maxLost: trig.a[1] - 1,
      goal: this.mission.missionType === 3,
    };
  }
  _isMajorVictory(blue) {
    return this.medalStatus(blue).ok;
  }
  // The live Major-Victory standing (the HUD medal tracker): strength = that sum, need = 40% of the budget.
  medalStatus(blue = this.units.filter((u) => !u.dead && u.team === "blue")) {
    let strength = 0;
    for (const u of blue) strength += (u.hp / 100) * (DEPLOY_COST[u.type] || 0);
    const hold = this._captureHolder() === "blue";
    if (hold) strength *= 1.25;
    const budget = this.mission.deploy ? this.mission.deploy.budget : 0,
      need = budget * 0.4;
    return {
      pct: budget ? Math.round((strength / budget) * 100) : null,
      strength: Math.round(strength),
      need: Math.round(need),
      budget,
      hold,
      ok: strength >= need,
    };
  }
  _checkPhaseEnd() {
    const end = this._terminal();
    if (end) {
      this.phase = end;
      return;
    }
    const blue = this.units.filter((u) => !u.dead && u.team === "blue");
    // Only YOUR OWN units gate the end of your turn — allied AI units act in their own phase.
    const mine = blue.filter((u) => !u.ally);
    // Every unit of yours has acted -> the turn ends by itself. When the last thing done was a plain MOVE that can
    // still be undone (moved onto open ground, nothing left to do), it ends after a short grace so Undo stays usable
    // for a moment instead of the turn waiting on End Turn; an Undo in that window (the unit is un-acted again, or
    // a newer check re-armed the timer) cancels it. A committed action (an attack) clears _undoFrom -> ends at once.
    if (this.phase !== "player" || this.marchQueue || !mine.length || !mine.every((u) => u.acted)) return;
    if (!this._undoFrom) {
      this._startFriendlyTurnEnd();
      return;
    }
    const id = (this._autoEndId = (this._autoEndId || 0) + 1);
    this._after(1.2, () => {
      if (
        this._autoEndId !== id ||
        this.phase !== "player" ||
        this.anim ||
        this.marchQueue ||
        this.pendingSkip ||
        this.battleEvent
      )
        return;
      const still = this.units.filter((u) => !u.dead && u.team === "blue" && !u.ally);
      if (!still.length || !still.every((u) => u.acted)) return;
      this._undoFrom = null;
      this._startFriendlyTurnEnd();
      this._emit();
    });
  }

  // A manual End Turn. Ignored for a moment after a new player turn opens: when a turn ends (by itself or by a click) and
  // no other side has anything to do, the next turn starts at once and a second click meant for the OLD turn would
  // end the new one too. It also cancels a pending auto-end so the turn can never be ended twice.
  endTurn() {
    if (this.phase !== "player" || this.anim || this.marchQueue) return;
    if (typeof performance !== "undefined" && performance.now() - (this._playerTurnAt || 0) < 900) return;
    this._autoEndId = (this._autoEndId || 0) + 1;
    this.deselect();
    this._startFriendlyTurnEnd();
  }

  // --- Formation Orders: march the whole un-acted line toward a point ---
  canOrder() {
    return (
      this.phase === "player" &&
      !this.anim &&
      !this.marchQueue &&
      this.units.some((u) => !u.dead && u.team === "blue" && !u.ally && !u.acted && !u.hero)
    );
  }
  beginMarch() {
    if (!this.canOrder()) return;
    this.deselect();
    this.orderMode = this.orderMode === "march" ? null : "march";
    if (this.orderMode) this.audio.play("click", 0.4);
    this._emit();
  }
  cancelOrder() {
    this.orderMode = null;
    this._emit();
  }
  // #15 AIM: toggle free-pick targeting for a selected area weapon (wizard/siege). While on, hovering an in-range
  // tile previews the blast and a tap drops it there — on units OR empty ground, so you choose the exact centre.
  canAim() {
    const sel = this.selected;
    return !!(
      this.phase === "player" &&
      !this.anim &&
      sel &&
      sel.team === "blue" &&
      !sel.ally &&
      !sel.acted &&
      (this._aimShot(sel) || this._isGrapeshotAimer(sel))
    );
  }
  // Which aim is armed: the Cannon has two — its point-blank Grapeshot (the default) and its aimed Cannonball ("shot").
  _aimingGrape(unit) {
    return !!(this.aimMode && unit && this._isGrapeshotAimer(unit) && this._aimKind !== "shot");
  }
  _aimingShot(unit) {
    return !!(this.aimMode && unit && this._aimShot(unit) && !this._aimingGrape(unit));
  }
  toggleAim() {
    if (!this.aimMode && !this.canAim()) return;
    this.aimMode = !this.aimMode;
    if (this.aimMode) this.audio.play("click", 0.4);
    this._emit();
  }
  cancelAim() {
    this.aimMode = false;
    this._abilityAim = null;
    this._aimKind = null;
    this._emit();
  }
  // ONE shared list of a unit's AIMABLE abilities — the wizard's three spells, the cannon's Grapeshot, the catapult's
  // Barrage — each a {id,name,icon,min,max,desc}. Rendered by the same in-battle skill row (AimSkills); picking one
  // enters aim for it via aimSkill(). Returns null when the selected unit has no aim ability.
  aimSkills() {
    const sel = this.selected;
    if (!sel || sel.team !== "blue" || sel.ally || sel.acted) return null;
    if (sel.T.canLightning) {
      // each spell's base damage (by the target's armour) and reach straight from the weapon table — spellStats
      const spell = (id, name, icon, desc) => {
        const s = spellStats(id);
        return { id, name, icon, min: s.min, max: s.max, dmg: `${s.lo}–${s.hi}`, desc, vars: s };
      };
      return [
        spell(
          "fireball",
          "Fireball",
          "skill_fireball",
          "Bursts in a + cross: {lo}–{hi} damage on the centre tile (by the target's armour — magic gets through most armour), {splash}% of it on the four tiles around. Point-blank it jabs with the Wizard Blade.",
        ),
        spell(
          "lightning",
          "Lightning Storm",
          "skill_lightning",
          "Five bolts stab random cells across a 3×3 area, each for {splash}% of {lo}–{hi} (by armour — magic gets through most armour); a unit can be struck more than once. Point-blank it jabs with the Wizard Blade.",
        ),
        spell(
          "ice",
          "Ice Field",
          "status_slowed",
          "Freezes a 2×2 block: {lo}–{hi} damage (by armour) to every unit caught, and SLOWS them for a turn — no charging. Point-blank it jabs with the Wizard Blade.",
        ),
      ];
    }
    const shot = () => {
      const [min, max] = this._castRange(sel);
      const abilities = sel.T.abilities || [];
      if (sel.T.crossBlast)
        return {
          id: "aim",
          name: "Barrage",
          icon: "skill_blast",
          min,
          max,
          desc: "Lobs a payload that bursts in a + cross; the arcing stone may DEVIATE one tile.",
        };
      if (sel.T.pierce)
        return {
          id: "aim",
          name: "Piercing Bolt",
          icon: "skill_pierce",
          min,
          max,
          desc: "Aim any tile in range — an enemy, a structure or empty ground; the bolt damages three squares in a row.",
        };
      if (abilities.includes(26))
        return {
          id: "aim",
          name: "Low Arc",
          icon: "skill_siege",
          min,
          max,
          desc: "Fire a Cannonball at any tile in range — an enemy, a structure or empty ground.",
        };
      return {
        id: "aim",
        name: "Arc",
        icon: "skill_siege",
        min,
        max,
        desc: "Lob a boulder at any tile in range — an enemy, a structure or empty ground.",
      };
    };
    if (this._isGrapeshotAimer(sel))
      return [
        {
          id: "grapeshot",
          name: "Grapeshot",
          icon: "skill_grapeshot",
          min: 1,
          max: 1,
          desc: "Point-blank spray: a 3-wide row right next to the cannon, then 1 tile further. Aim an adjacent tile — enemy or empty ground.",
        },
        ...(this._freeAim(sel) ? [shot()] : []),
      ];
    if (this._aimShot(sel)) return [shot()];
    return this._abilitySkills(sel); // Episode II unit skills (rules/abilities.js)
  }
  // Which aim ability (if any) is currently ARMED — so the shared skill row can highlight it.
  aimActive() {
    const sel = this.selected;
    if (!sel || !this.aimMode) return null;
    if (this._abilityAim) return this._abilityAim;
    if (sel.T.canLightning) return sel.spell || "fireball";
    if (this._isGrapeshotAimer(sel)) return this._aimKind === "shot" ? "aim" : "grapeshot";
    if (this._aimShot(sel)) return "aim";
    return null;
  }
  // Pick an aim ability from the shared skill row: a wizard SWITCHES spell (and arms aim); the cannon/catapult TOGGLE
  // their single aim. Clicking the already-armed ability disarms it (same as ✕ Cancel aim).
  aimSkill(id) {
    const sel = this.selected;
    if (!sel || sel.acted || this.phase !== "player" || this.anim || sel.ally || sel.team !== "blue") return;
    if (this._abilityArm(id)) return; // an Ep2 unit skill (Build / Repair / Quicksand / Conjure / Detonate)
    if (sel.T.canLightning && ["fireball", "lightning", "ice"].includes(id)) {
      if (this.aimMode && (sel.spell || "fireball") === id) {
        this.aimMode = false;
        this.audio.play("click", 0.4);
        this._emit();
        return;
      } // toggle the armed spell off
      this.setSpell(id); // switch spell + arm aim (setSpell already sets aimMode, recalcs targets, emits)
      return;
    }
    if ((this._isGrapeshotAimer(sel) || this._aimShot(sel)) && (id === "grapeshot" || id === "aim")) {
      const armed = this.aimMode && this.aimActive() === id; // clicking the armed aim disarms it; the other one switches
      this._aimKind = id === "aim" ? "shot" : null;
      this.aimMode = !armed;
      if (this.aimMode) this.audio.play("click", 0.4);
      this._emit();
    }
  }
  // Preview the Retribution radius (allies within 2 tiles are guarded) while the button is hovered.
  setRetribPreview(on) {
    this._retribPreview = !!on;
    this._emit();
  }
  groupMarch(tx, ty) {
    this.orderMode = null;
    const squad = this.units.filter((u) => !u.dead && u.team === "blue" && !u.ally && !u.acted && !u.hero);
    if (!squad.length) {
      this._emit();
      return;
    }
    // nearest units advance first so they don't jam the ones behind them
    squad.sort((a, b) => Math.abs(a.tx - tx) + Math.abs(a.ty - ty) - (Math.abs(b.tx - tx) + Math.abs(b.ty - ty)));
    this.marchTarget = { tx, ty };
    this.marchQueue = squad;
    this.marchDelay = 0;
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.mode = "select";
    this._emit(); // each unit's move plays its own SFX via moveUnit — no extra play here
  }
  _marchStep() {
    let u = null;
    while (this.marchQueue && this.marchQueue.length) {
      const next = this.marchQueue.shift();
      if (!next.dead && !next.acted) {
        u = next;
        break;
      }
    }
    if (!u) {
      this.marchQueue = null;
      this.marchTarget = null;
      this.reach = null;
      this._checkPhaseEnd();
      this._emit();
      return;
    }
    const reach = this.computeReach(u),
      dest = this.marchTarget;
    let best = { tx: u.tx, ty: u.ty },
      bestDist = manhattan(u, dest);
    for (const k of reach.stops) {
      const [x, y] = k.split(",").map(Number);
      const dist = Math.abs(x - dest.tx) + Math.abs(y - dest.ty);
      if (dist < bestDist) {
        bestDist = dist;
        best = { tx: x, ty: y };
      }
    }
    if (best.tx === u.tx && best.ty === u.ty) {
      this._marchAttack(u, false);
      return;
    } // can't advance — strike from here
    this.reach = reach;
    this.centerOn(best.tx, best.ty, true);
    this.moveUnit(u, this.pathTo(reach, best.tx, best.ty), () => {
      this._marchAttack(u, true);
    });
  }
  // The attack half of a Formation Order: after moving, a unit engages the best enemy now in its reach.
  // (A Move-or-Shoot unit that moved this order can only use its untagged weapon — targetsFrom.)
  _marchAttack(u, moved) {
    const next = () => {
      this.marchDelay = 0.14;
    };
    const targets = u.dead ? [] : this.targetsFrom(u, u.tx, u.ty, !!moved);
    if (!targets.length) {
      next();
      return;
    }
    let best = targets[0],
      bestDamage = -1;
    for (const target of targets) {
      const damage = this.computeDamage(u, target);
      if (damage > bestDamage) {
        bestDamage = damage;
        best = target;
      }
    }
    u.attackedTurn = true;
    if (u.T.pikeWall) u.walled = false;
    const strike = () => {
      if (u.dead || best.dead) {
        u.acted = true;
        next();
        return;
      }
      u.face = Math.sign(best.tx - u.tx) || u.face || 1;
      this.anim = {
        type: "attack",
        u,
        target: best,
        t: 0,
        hitDone: false,
        done: () => {
          u.acted = true;
          next();
        },
      };
      u.attacking = true;
      u.anim = 0;
      u.animT = 0;
      u.hitPending = best;
    };
    if (this._preStrike(u, best, strike)) return; // a walled enemy pikeman reacts first
    strike();
  }

  // --- reinforcement waves (real triggered spawn chains, waves.json) ---
  // A wave fires once, at the start of its side's phase in its round (this.turn === round).
  // Units drop onto their recorded tiles (relocated to the nearest free tile if occupied).
  _fireWaves(side) {
    if (!this.mission.waves || this.phase === "victory" || this.phase === "defeat") return;
    let count = 0;
    this.mission.waves.forEach((wave, i) => {
      if (wave.side !== side || wave.round !== this.turn || this._firedWaves.has(i)) return;
      this._firedWaves.add(i);
      for (const [type, x, y, groupIdx] of wave.units) {
        const cell = this._freeSpawnCell(x, y);
        if (cell && UNIT_TYPES[type]) {
          // the column's TEAM comes from its army group (w.side is only the phase the trigger fires on)
          const group = groupIdx != null && this.mission.groupByGi ? this.mission.groupByGi[groupIdx] : null;
          const team = group ? (group.side === "enemy" ? "red" : "blue") : side;
          const waveUnit = this._makeUnit(type, team, cell[0], cell[1], type === "king");
          if (this._canHideUnit(waveUnit) && this._canHide(waveUnit)) this._setHidden(waveUnit, true); // createUnitAt: a spawned Stealth/Ambush unit in cover starts hidden
          // Reinforcements join their REAL army (record group index) so they share its heraldry tint / HP colour
          // — not a stray default group. A blue-side wave that isn't the player's own group is an allied column.
          if (groupIdx != null) {
            waveUnit.group = groupIdx;
            if (team === "blue" && groupIdx !== this.mission.playerGroup) waveUnit.ally = true;
          }
          waveUnit.wave = true;
          count++;
          this.scenario.tagUnit(waveUnit, x, y, groupIdx);
        }
      }
    });
    if (count > 0) {
      this.wave = {
        side: this.units.filter((u) => u.wave && !u.dead).slice(-1)[0]?.team || side,
        count,
        id: (this._waveId = (this._waveId || 0) + 1),
      };
    }
  }
  // Mid-battle dialogue: fire every event whose round matches the current one, ONCE, at the top of the round.
  // Several lines can land on the same round (a short exchange) — they're shown as a stacked banner.
  _fireEvents() {
    if (!this.mission.events || this.phase === "victory" || this.phase === "defeat") return;
    if (this._firedEventRounds.has(this.turn)) return;
    const lines = this.mission.events.filter((e) => e.round === this.turn && !(e.init && this.mission.script)); // staged lines are played by the script runner
    if (!lines.length) return;
    this._firedEventRounds.add(this.turn);
    this._noteShownLines(lines);
    this.battleEvent = {
      lines: lines.map((e) => ({ speaker: e.speaker, side: e.side, face: e.face, text: e.text, cam: e.cam || null })),
      id: (this._eventId = (this._eventId || 0) + 1),
    };
    this.focusEventLine(0); // op2 CAMERA: pan to the first line's focus, if any
  }
  // op2 CAMERA: pan the field to a dialogue line's recorded focus tile (the game centres on who's speaking / the
  // action being narrated before each screen). Called when the beat opens and as the React overlay steps lines.
  focusEventLine(idx) {
    const b = this.battleEvent;
    if (!b || !b.lines) return;
    const line = b.lines[idx];
    if (line && line.cam) {
      this.centerOn(line.cam[0], line.cam[1], true);
      this._emit();
    }
  }
  _freeSpawnCell(x, y) {
    const free = (cx, cy) => cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && !this.unitAt(cx, cy);
    if (free(x, y)) return [x, y]; // exact recorded tile (as the record placed it)
    for (let ring = 1; ring <= 4; ring++)
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== ring) continue;
          const cellX = x + dx,
            cellY = y + dy;
          if (free(cellX, cellY) && this.terrainAt(cellX, cellY).passable) return [cellX, cellY];
        }
    return null;
  }

  // One-shot turn-announcement banner (crest + which ARMY + turns left). On multi-faction maps each enemy army
  // gets its own banner as it takes the field (like the original's "The Emperor · Turns Left N" card). id changes
  // per announcement so the React layer plays it transiently.
  _announceTurn(side, group) {
    const turnsLeft = Math.max(0, (this.mission.turnLimit || 0) - this.turn + 1);
    let name = null,
      crest = null,
      color = null,
      banner = null,
      shownGroup = null,
      armySide = null; // hot-seat: the army's side name (West / East…), shown after the player's name
    const groupDef = group != null && this.mission.groupByGi ? this.mission.groupByGi[group] : null;
    if (side === "player" && this.hs) {
      const p = this.hs.players[this.hs.active]; // hot-seat: the player whose turn it is
      name = p.name;
      armySide = p.side;
      color = p.paint === "blue" ? "142,199,255" : "225,90,80";
      crest = p.paint === "blue" ? "imperial" : ENEMY_CRESTS[0];
    } else if (side === "player") {
      name = "Your Legion";
      color = "142,199,255";
      crest = "imperial"; // the Carrone Empire's crest (your custom heraldry shows on the camp panel)
    } else if (groupDef) {
      // groupOrder map: the REAL per-group army, its own heraldry banner, coloured by ally(green/blue/cyan) vs
      // enemy(red/orange/yellow) — the game's own "ally is Green/Blue/Cyan, enemy Red/Orange/Yellow" rule.
      const isAlly = groupDef.side === "ally";
      shownGroup = groupDef;
      banner = groupDef.banner != null ? groupDef.banner : null;
      name = groupDef.name || (isAlly ? "Allied Army" : "Enemy Army");
      const allyArms = factionHeraldry(groupDef.name);
      crest =
        BANNER_CREST[groupDef.banner] ||
        (allyArms && allyArms.crest) ||
        (isAlly ? ALLY_CRESTS : ENEMY_CRESTS)[groupDef.gi % (isAlly ? ALLY_CRESTS.length : ENEMY_CRESTS.length)];
      // banner tint = the crest's heraldic FIELD colour (Pellus/Rebel blue, Emperor purple, Carrone red), so the
      // turn-banner shield shows the real field; named-faction override (e.g. Aguilleon gold) fills banner-0 gaps.
      color =
        (groupDef.bgColor && TINCTURE_RGB[groupDef.bgColor]) ||
        (groupDef.banner != null && CREST_FIELD[groupDef.banner]) ||
        (allyArms && allyArms.field) ||
        (groupDef.banner != null && BANNER_TINCTURE[groupDef.banner]) ||
        (this.mission.hpByGi && this.mission.hpByGi[groupDef.gi]) ||
        (isAlly ? ALLY_BANDS[groupDef.gi % ALLY_BANDS.length] : GROUP_BANDS[groupDef.gi % GROUP_BANDS.length]);
    } else if (side === "ally") {
      const sideGroup = this.mission.allyGroups && this.mission.allyGroups[String(group || 0)];
      shownGroup = sideGroup;
      if (sideGroup && sideGroup.banner != null) banner = sideGroup.banner;
      name = sideGroup ? sideGroup.name : "Allied Army";
      crest = BANNER_CREST[sideGroup && sideGroup.banner] || ALLY_CRESTS[(group || 0) % ALLY_CRESTS.length];
      color =
        (sideGroup && sideGroup.bgColor && TINCTURE_RGB[sideGroup.bgColor]) ||
        (sideGroup && CREST_FIELD[sideGroup.banner]) ||
        (sideGroup && BANNER_TINCTURE[sideGroup.banner]) ||
        ALLY_BANDS[(group || 0) % ALLY_BANDS.length];
    } else if (group != null && this.mission.enemyGroups && this.mission.enemyGroups[String(group)]) {
      const sideGroup = this.mission.enemyGroups[String(group)];
      shownGroup = sideGroup;
      if (sideGroup && sideGroup.banner != null) banner = sideGroup.banner;
      const enemyArms = factionHeraldry(sideGroup.name);
      name = sideGroup.name;
      crest =
        BANNER_CREST[sideGroup.banner] || (enemyArms && enemyArms.crest) || ENEMY_CRESTS[group % ENEMY_CRESTS.length];
      color =
        (sideGroup.bgColor && TINCTURE_RGB[sideGroup.bgColor]) ||
        CREST_FIELD[sideGroup.banner] ||
        (enemyArms && enemyArms.field) ||
        BANNER_TINCTURE[sideGroup.banner] ||
        GROUP_BANDS[group % GROUP_BANDS.length];
    } else {
      name = "Enemy Army";
      color = "225,90,80";
    }
    // REAL faction coat of arms decoded from the group attrs (field attrs[1], symbol colour attrs[0], device
    // attrs[2]+9 = the heraldry charge asset — e.g. Carrone gold eagle on gules, Aguilleon sable fleur on or,
    // Horselords on sable). Rendered via HeraldryShield; the frame follows the banner rank. #attr2
    // A name-keyed arms override (factionHeraldry.device) wins over the scenario-decoded device — it fixes factions
    // whose decoded charge/colour is wrong (e.g. the Rebel Army decodes to a wheat sheaf but flies a gold fleur-de-lis).
    // Genuine model (Context::renderHeraldry + the team record's 5 bytes [symbolColour, fieldColour, device, field,
    // banner]): the arms come straight from the scenario; the banner byte picks the ornate frame. No name overrides.
    const crestH =
      shownGroup && shownGroup.bgColor && shownGroup.device != null
        ? {
            bgColor: shownGroup.bgColor,
            symbolColor: shownGroup.symbolColor || "argent",
            symbol: shownGroup.device,
            bgType: shownGroup.bgType || 0,
            frame: BANNER_FRAME[shownGroup.banner] != null ? BANNER_FRAME[shownGroup.banner] : 0,
          }
        : null;
    this.turnBanner = {
      id: (this._turnBannerId = (this._turnBannerId || 0) + 1),
      side,
      turn: this.turn,
      turnLimit: this.mission.turnLimit || 0,
      turnsLeft,
      name,
      crest,
      color,
      banner,
      crestH,
      armySide,
    };
    this.bannerHold = TURN_BANNER_HOLD;
    this.audio.play("turn", 0.5); // GameScreen::startTurn → sound 38, every side's turn
  }

  // The player finished their turn → the allied AI armies take theirs, then the enemy. Called from
  // _checkPhaseEnd (all your own units acted) and endTurn.
  // Unit::endTurn (iOS Ep2 @0x751e2), run by GameScreen::endTurn for the units of the group whose turn just ENDED:
  // the Ice slow counter (Unit+0x294, set to 1 by the Ice hit) counts down and, at 0, the full move comes back. So an
  // Ice Field lasts through the victim's whole next turn and wears off at that turn's end.
  _endTurnSlow(units) {
    for (const u of units) if (u.slowed) u.slowed = false;
  }
  // PIKE WALL — Unit::endTurn (iOS Ep2 @0x752ee): the brace flag (Unit+0x10f) is cleared and set again for a unit
  // with Pike Wall (ability 27) that did NOT attack this turn (Unit+0x113) — moving doesn't matter. While braced it
  // has First Strike (Unit::_hasAbility(1) reads the flag), so it strikes first against every attacker but the Hero
  // (who has First Strike too). It drops when it attacks on its own turn or strikes a non-cavalry foe (Unit::attack /
  // Unit::onTick @0x77c66, @0x77c9a), and at its next turn's end it is judged again.
  // Each unit runs Unit::endTurn once a turn: when it is done (acted) — watched from the loop — or, for the ones
  // left idle, when its side's turn ends. A charge never outlives its unit's turn (it is one action).
  _unitEndTurn(u) {
    if (u._endTurnDone) return;
    u._endTurnDone = true;
    u.chargeDir = null;
    this._shroudEndTurn(u);
  }
  _endTurnWatch() {
    for (const u of this.units) {
      if (u.dead) continue;
      if (!u.acted) u._endTurnDone = false;
      else if (!u._endTurnDone) this._unitEndTurn(u);
    }
  }
  _endTurnBrace(units) {
    for (const u of units) if (u.T.pikeWall) u.walled = !u.attackedTurn;
    for (const u of units) this._unitEndTurn(u); // the idle ones' Unit::endTurn (shroud, charge)
  }
  _startFriendlyTurnEnd() {
    if (this.hs) return this._hsEndTurn(); // hot-seat: the other player takes the device
    this._turnEnded = true; // GameScreen::endTurn asks checkOutcome(1)
    this._leashCheck("blue"); // Leashing (help 592): stray conjured units die as the turn ends
    this._endTurnHide(this.units.filter((u) => u.team === "blue" && !u.ally)); // Unit::endTurn: hide (no attack, cover) or be revealed
    this._endTurnSlow(this.units.filter((u) => u.team === "blue" && !u.ally));
    this._endTurnBrace(this.units.filter((u) => u.team === "blue" && !u.ally));
    if (this._hasGroupOrder()) {
      this._beginAiSegment("post");
      return;
    } // real per-group turn cycle
    if (this.units.some((u) => !u.dead && u.team === "blue" && u.ally)) this.startAllyPhase();
    else this.startEnemyPhase();
  }

  // ---- REAL per-group turn cycle (maps carrying groupOrder) ----------------------------------------
  // Confirmed from the decompile (La/g cycles aQ over bg.J GROUPS) + observed order on Carrone 3:
  // groups act in ASCENDING global group index, cycling. A round = [groups before the player] -> PLAYER ->
  // [groups after the player]. Each non-player group runs its OWN AI (ally if the player's team, else enemy),
  // as its own mini-turn with its own heraldry banner. Falls back to the 2-sided flow when no groupOrder.
  _hasGroupOrder() {
    return !!(this.mission && this.mission.groupOrder && this.mission.playerGroup != null);
  }
  _beginAiSegment(seg) {
    this._groupCursor = true;
    this._aiSegment = seg;
    const playerGroup = this.mission.playerGroup;
    this._aiSchedule = (this.mission.groupOrder || [])
      .filter((g) => g.side !== "player" && (seg === "pre" ? g.gi < playerGroup : g.gi > playerGroup))
      .sort((a, b) => a.gi - b.gi)
      .map((g) => ({ gi: g.gi, side: g.side }));
    this._advanceAi();
  }
  _advanceAi() {
    while (this._aiSchedule && this._aiSchedule.length) {
      const next = this._aiSchedule.shift();
      const team = next.side === "ally" ? "blue" : "red",
        isAlly = next.side === "ally";
      this._fireWaves(team); // a column may arrive for an army with nothing yet on the field
      const units = this.units.filter(
        (u) => !u.dead && (u.group || 0) === next.gi && u.team === team && (team !== "blue" || !!u.ally === isAlly),
      );
      if (!units.length) continue; // a wiped-out (or not yet arrived) army is skipped
      this._runAiGroup(next.gi, team, isAlly, units);
      return;
    }
    // segment exhausted
    if (this._aiSegment === "pre") {
      this._groupCursor = false;
      this._startPlayerTurn();
      return;
    }
    // post-player groups done -> the round is over; advance the counter and start the next round's pre-groups
    const end = this._terminal();
    if (end) {
      this.phase = end;
      this._emit();
      return;
    }
    this._quicksandTurn(); // Ep2: quicksand bites its occupants, then decays
    this.turn++;
    if (this.turn > this.mission.turnLimit) {
      this.phase = this._timeoutOutcome();
      this._emit();
      return;
    }
    this._beginAiSegment("pre");
  }
  _runAiGroup(groupIdx, team, isAlly, units) {
    this._aiSelf = team;
    this._aiFoe = team === "red" ? "blue" : "red";
    this._aiAlly = isAlly;
    this._aiPhase = isAlly ? "ally" : "enemy";
    this.phase = this._aiPhase; // an AI phase locks player input
    this._lastAiGroup = groupIdx; // already announced below -> aiStep won't re-announce
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this._undoFrom = null;
    this.orderMode = null;
    this.marchQueue = null;
    this.marchTarget = null;
    this._fireWaves(team);
    this.scenario.checkFlags(true); // a counter that came due during the last turn (the "CPU Turn Start" banner)
    this.healOnKeeps(team, (u) => units.includes(u)); // this army only — not the player's units / the other armies
    units.forEach((u) => {
      u.acted = false;
      u.attackedTurn = false;
      u.chargeDir = null; // a charge (gallop + strike, one action) never carries into a new turn
    });
    this._clearPrayerMarks((m) => m.team === team && units.some((u) => u.group === m.group && !!u.ally === m.ally));
    this._announceTurn(this._aiPhase, groupIdx);
    this.aiQueue = units.slice().sort((a, b) => a.id - b.id);
    this.aiDelay = 0.9; // hold on the banner before it moves
    this._emit();
  }
  _startPlayerTurn() {
    const end = this._terminal();
    if (end) {
      this.phase = end;
      this._emit();
      return;
    }
    this.phase = "player";
    this._playerTurnAt = typeof performance !== "undefined" ? performance.now() : 0;
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.inspect = null;
    this.mode = "select";
    this._announceTurn("player");
    this._fireWaves("blue");
    this._fireEvents();
    this._fireScriptedMoves(); // op3 scripted moves due this round (Caladrin Defense: Landower flees on round 3)
    this.healOnKeeps("blue", (u) => !u.ally); // your own units (allied armies heal at the start of their own turn)
    this.scenario.checkFlags();
    this.scenario.flush();
    this.units.forEach((u) => {
      if (u.team === "blue" && !u.ally) {
        u.acted = false;
        u.attackedTurn = false;
        u.chargeDir = null; // a charge (gallop + strike, one action) never carries into a new turn
      }
      if (u.team === "blue" && u.ambush) u.ambushUsed = false;
    });
    this._clearPrayerMarks((m) => m.team === "blue" && !m.ally); // your Retribution / Shield lapse at your turn's start
    this._emit();
  }
  // Open a groupOrder battle: run the groups scheduled before the player, then hand control over.
  _openBattle() {
    this._groupCursor = true;
    this._beginAiSegment("pre");
  }
  // THE BATTLE-START PRAYER — GameScreen::gameStateUpdate state 2 (iOS Ep2 @0x1fc3a → 0x1fc84, Ep1 @0x1a80e; Android
  // a_g `aW == 2`): after the battle-start staging (activateGameState's tag-2 sequence) and before the first turn,
  // every Priest that is not in group 0 (Unit+0x14c, the unit's group — the player's own Priests too when their group
  // isn't 0) prays where it stands: the AI's prayer choice (aiConsiderAction state 6, the moved branch — Shield or
  // Retribution), else Shield anyway (action 6 executed). The marks expire at its side's turn start as usual.
  _battleStartPrayers(cb) {
    const priests = this.units.filter((u) => !u.dead && u.T.prayer && (u.group || 0) !== 0);
    let k = 0;
    const next = () => {
      if (this.anim) return this._after(0.05, next); // one cast at a time: wait for the last one to finish
      while (k < priests.length && priests[k].dead) k++;
      if (k >= priests.length) return cb();
      const u = priests[k++];
      const foes = this.units.filter((e) => !e.dead && e.team !== u.team && !this._isHidden(e));
      if (!this.ai._priestPray(u, foes, null)) this.ai._priestPray(u, foes, null, true);
      this._after(0.05, next);
    };
    next();
  }
  // Round 1 once the battle-start staging is done: the battle-start prayer, the round-1 dialogue, then the turn cycle.
  _openRound1() {
    this._battleStartPrayers(() => {
      this._fireEvents(); // round-1 dialogue
      this._beginOpening(); // groups before the player open the battle
      this._emit();
    });
  }
  // Unified battle opening (fixed-force openBattle + deploy-end). Groups before the player open the battle;
  // if that opening is AI and there's an opening line, hold until the player dismisses it (eventClosed).
  _beginOpening() {
    if (this.hs) return this._hsOpen(); // hot-seat: the first mover's turn (engine/hotseat.js)
    if (this._hasGroupOrder()) {
      if (this.mission.playerGroup > 0 && this.battleEvent) {
        this._pendingEnemyOpen = true;
        return;
      }
      this._openBattle();
      return;
    }
    if (this.mission.enemyFirst && this.battleEvent) {
      this._pendingEnemyOpen = true;
      return;
    }
    if (this.mission.enemyFirst) {
      this._openingEnemy = true;
      this.startEnemyPhase();
      return;
    }
    this._announceTurn("player");
  }
  // Allied AI phase: team-0 non-player groups act on your side but under their OWN AI (same influence-map
  // brain as the enemy, just with self/foe flipped), each faction as a contiguous block with its own banner.
  startAllyPhase() {
    const allies = this.units.filter((u) => !u.dead && u.team === "blue" && u.ally);
    if (!allies.length) {
      this.startEnemyPhase();
      return;
    }
    this._aiPhase = "ally";
    this._aiSelf = "blue";
    this._aiFoe = "red";
    this._aiAlly = true;
    this._lastAiGroup = -1;
    if (!(this.mission.allyGroups && Object.keys(this.mission.allyGroups).length > 1)) this._announceTurn("ally", 0);
    this.phase = "ally";
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this._undoFrom = null;
    this.orderMode = null;
    this.marchQueue = null;
    this.marchTarget = null;
    allies.forEach((u) => {
      u.acted = false;
      u.attackedTurn = false;
      u.chargeDir = null; // a charge (gallop + strike, one action) never carries into a new turn
    });
    this.aiQueue = allies.sort((a, b) => (a.group || 0) - (b.group || 0));
    this.aiDelay = 0.35;
    this._emit();
  }
  endAllyPhase() {
    this._turnEnded = true; // GameScreen::endTurn asks checkOutcome(1)
    this.aiQueue = null;
    const end = this._terminal();
    if (end) {
      this.phase = end;
      this._emit();
      return;
    }
    this.startEnemyPhase();
  }
  _endAiPhase() {
    this._turnEnded = true; // an army's turn ended: GameScreen::endTurn asks checkOutcome(1)
    const self = this._aiSelf || "red",
      isAlly = !!this._aiAlly;
    const acted = this.units.filter(
      (u) =>
        u.team === self &&
        (self !== "blue" || !!u.ally === isAlly) &&
        (!this._groupCursor || (u.group || 0) === this._lastAiGroup),
    );
    this._endTurnHide(acted);
    this._endTurnSlow(acted);
    this._endTurnBrace(acted);
    if (this._groupCursor) {
      this.aiQueue = null;
      this._advanceAi();
      return;
    } // real per-group cycle
    if (this._aiPhase === "ally") this.endAllyPhase();
    else this.endEnemyPhase();
  }

  startEnemyPhase() {
    this._aiPhase = "enemy";
    this._aiSelf = "red";
    this._aiFoe = "blue";
    this._aiAlly = false;
    this._lastAiGroup = -1; // multi-army maps announce each faction in aiStep
    if (!(this.mission.enemyGroups && Object.keys(this.mission.enemyGroups).length > 1)) this._announceTurn("enemy");
    this._fireWaves("red"); // enemy columns arrive at the top of their turn
    this.phase = "enemy";
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this._undoFrom = null;
    this.orderMode = null;
    this.marchQueue = null;
    this.marchTarget = null;
    this.healOnKeeps("red");
    this.units.forEach((u) => {
      if (u.team === "red") {
        u.acted = false;
        u.attackedTurn = false;
        u.chargeDir = null; // a charge (gallop + strike, one action) never carries into a new turn
      }
    });
    this.units.forEach((u) => {
      if (u.team === "blue" && u.ambush) u.ambushUsed = false; // rearm ambushers
    });
    this._clearPrayerMarks((m) => m.team === "red"); // enemy Retribution / Shield lapse at its turn's start
    // Each enemy FACTION acts as an independent army: order the queue by group so a group takes the field as
    // a contiguous block (its own mini-turn), with its own GroupLogic group (see aiStep). Single-army maps (all
    // group 0) are unaffected.
    this.aiQueue = this.units
      .filter((u) => !u.dead && u.team === "red")
      .sort((a, b) => (a.group || 0) - (b.group || 0));
    this.aiDelay = 0.35;
    this._emit();
  }

  endEnemyPhase() {
    this._turnEnded = true; // GameScreen::endTurn asks checkOutcome(1)
    this._leashCheck("red");
    this.aiQueue = null;
    const end = this._terminal();
    if (end) {
      this.phase = end;
      this._emit();
      return;
    }
    if (this._openingEnemy) {
      this._openingEnemy = false; // enemy took the opening move (enemyFirst); don't burn a turn
    } else {
      this._quicksandTurn(); // Ep2: quicksand bites its occupants, then decays
      this.turn++;
      if (this.turn > this.mission.turnLimit) {
        this.phase = this._timeoutOutcome();
        this._emit();
        return;
      }
    }
    this.phase = "player";
    this._playerTurnAt = typeof performance !== "undefined" ? performance.now() : 0;
    // Clear anything the AI left selected — the enemy-move code parks each acting unit's move-range in this.reach,
    // and without this the LAST enemy's blue reach tiles would linger over the map when your turn opens.
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.inspect = null;
    this.mode = "select";
    this._announceTurn("player");
    this._fireWaves("blue"); // your reinforcements march in at the top of your turn
    this._fireEvents(); // and any mid-battle dialogue for the new round
    this._fireScriptedMoves(); // and any op3 scripted repositioning due this round
    this.scenario.checkFlags();
    this.scenario.flush(); // scripted (counter-gated) beats + queued dialogue
    this.healOnKeeps("blue");
    this.units.forEach((u) => {
      if (u.team === "blue") {
        u.acted = false;
        u.attackedTurn = false;
        u.chargeDir = null; // a charge (gallop + strike, one action) never carries into a new turn
      }
      if (u.team === "red") u.slowed = false; // Ice Field wears off at turn's end
    });
    this._clearPrayerMarks((m) => m.team === "blue"); // your Retribution / Shield lapse at your turn's start
    this._emit();
  }
}
