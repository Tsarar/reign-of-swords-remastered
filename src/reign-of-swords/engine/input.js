/* ============================================================
   Reign of Swords — player input & unit-command execution.
   The front door of the game: pointer/keyboard binding (drag-to-pan, edge
   scroll, tap-to-act), the main tap handler (click), unit selection and the
   inspect cards, target recompute, the skip / undo controls, and the animated
   move execution (moveUnit, incl. the charge-lane commit and the desync guard).
   Mixed onto Game.prototype in engine/engine.js — every method runs with `this` = the
   live Game and reaches sibling helpers (computeReach / targetsFrom / doAttack /
   _castGroundAoe / finishUnit …) via `this`. Only geometry helpers are imported.
   ============================================================ */

import { key, manhattan, FAR } from "../util/util.js";
import { tr } from "../i18n/i18n.js";
import { tileName, moveType, moveRow } from "../rules/terrain.js";

export class InputMethods {
  // --- input: tap to act, drag to pan ---
  // Wire the canvas: press / drag / release (tap or pan), hover, right-click or long-press (read a unit) and the
  // arrow keys. The bound handlers are kept on `this` so destroy() can remove them.
  _bind() {
    this._drag = null;
    this._onDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onLeave = () => this._pointerLeave();
    this._onContext = (e) => this._contextMenu(e);
    this._onKey = (e) => this._keyDown(e);
    this.canvas.addEventListener("contextmenu", this._onContext);
    this.canvas.addEventListener("pointerdown", this._onDown);
    this.canvas.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onUp);
    this.canvas.addEventListener("pointerleave", this._onLeave);
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener("keydown", this._onKey);
  }

  // The pointer's position in canvas (view) pixels.
  _pointOf(e) {
    const rect = this.canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  // The map tile under a view-space point (world = point + camera).
  _tileAtPoint(point) {
    return {
      tx: Math.floor((point.x + this.cam.x) / this.tile),
      ty: Math.floor((point.y + this.cam.y) / this.tile),
    };
  }

  // A tap may act: your turn (or the muster), nothing animating, no modal or whose-turn banner up.
  _canTap() {
    return (
      (this.phase === "player" || this.phase === "deploy") && !this.anim && !this.inputLocked && !(this.bannerHold > 0)
    );
  }

  _pointerDown(e) {
    if (this.audio.startAmbient) this.audio.startAmbient(); // first user gesture kicks off the ambient bed (autoplay policy)
    if (this.inputLocked) return; // a modal is open — swallow the tap, don't pan or select
    const point = this._pointOf(e);
    this._drag = { sx: point.x, sy: point.y, camx: this.cam.x, camy: this.cam.y, moved: false };
    // PRESS-AND-HOLD (touch, ~0.45 s without dragging) reads any unit, like a right-click does with a mouse.
    clearTimeout(this._holdT);
    if (e.pointerType !== "mouse") {
      const press = this._drag;
      this._holdT = setTimeout(() => {
        if (this._drag === press && !press.moved) {
          press.held = true;
          this.peekAt(this._tileAtPoint(point));
        }
      }, 450);
    }
    try {
      this.canvas.focus({ preventScroll: true });
    } catch (_) {
      try {
        this.canvas.focus();
      } catch (__) {}
    }
    if (this.canvas.setPointerCapture && e.pointerId != null) {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
    if (e.pointerType === "touch" && e.cancelable) e.preventDefault(); // block touch page-scroll, keep focus for mouse
  }

  // Hover (the action cursor and the edge-scroll hint) and, while pressed, drag-to-pan.
  _pointerMove(e) {
    const point = this._pointOf(e);
    this.hoverPx = point; // view-space cursor position (world = pt + cam) — used to trail the hover action cursor
    const tile = this._tileAtPoint(point);
    this.hover = this.inBounds(tile.tx, tile.ty) ? tile : null;
    // edge-scroll hint (only when the world overflows the viewport)
    const EDGE = 26;
    this.edge.x = point.x < EDGE ? -1 : point.x > this.view.w - EDGE ? 1 : 0;
    this.edge.y = point.y < EDGE ? -1 : point.y > this.view.h - EDGE ? 1 : 0;
    if (this._drag) {
      const dx = point.x - this._drag.sx,
        dy = point.y - this._drag.sy;
      if (!this._drag.moved && Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
      if (this._drag.moved) {
        this.cam.x = this._drag.camx - dx;
        this.cam.y = this._drag.camy - dy;
        this.camTarget = null;
        this.clampCam();
      }
    }
  }

  // Release: a press that STARTED on the canvas and didn't drag is a tap. (Pointer-ups also arrive on the window —
  // clicking a UI button like Undo / Back has no canvas press, so it must NOT tap the field.)
  _pointerUp(e) {
    const point = this._pointOf(e);
    const started = this._drag;
    const wasDrag = started && started.moved;
    this._drag = null;
    clearTimeout(this._holdT);
    if (started && started.held) return; // the press was a long-press read-out, not a tap
    if (started && !wasDrag && this._canTap()) {
      const tile = this._tileAtPoint(point);
      if (this.inBounds(tile.tx, tile.ty)) this.click(tile);
    }
  }

  _pointerLeave() {
    this.edge.x = 0;
    this.edge.y = 0;
    this.hover = null;
    this.hoverPx = null;
  }

  // RIGHT-CLICK = read the unit.
  _contextMenu(e) {
    e.preventDefault();
    if (this.inputLocked) return;
    this.peekAt(this._tileAtPoint(this._pointOf(e)));
  }

  // Arrow keys / WASD pan one tile.
  _keyDown(e) {
    if (this.inputLocked) return; // modal open — no arrow-key panning either
    const step = this.tile;
    const PAN = {
      ArrowLeft: [-step, 0],
      a: [-step, 0],
      ArrowRight: [step, 0],
      d: [step, 0],
      ArrowUp: [0, -step],
      w: [0, -step],
      ArrowDown: [0, step],
      s: [0, step],
    };
    const delta = PAN[e.key];
    if (!delta) return;
    this.panBy(delta[0], delta[1]);
    e.preventDefault();
  }

  // A tap / click on the battlefield tile (tx, ty). What it means depends on the state, checked in this order:
  // frozen field → deployment → an aim mode (Ep2 skill, grapeshot, area weapon) → a Priest's heal → the act step →
  // an ally (read only) → one of your ready units (select) → with a unit selected: strike / approach / move /
  // inspect → with none: read what's there.
  click({ tx, ty }) {
    if (!this.inBounds(tx, ty)) return;
    if (this.pendingSkip || this._teleportLock) return; // a modal is up, or a wizard is mid-teleport — freeze the field
    if (this.autopilot && this.phase === "player") return; // the 🤖 Autopilot is playing your turn
    if (this.phase === "deploy") {
      this._deployClick(tx, ty);
      return;
    }
    // IGNORE taps while ANY action is animating. Acting mid-glide would create a new anim that overwrites the
    // running one (this.anim is a single slot), abandoning the moving unit halfway — leaving its sprite (px/py)
    // off its data tile (tx/ty): the "unit drawn on the wrong / an empty tile, unclickable" desync bug.
    if (this.anim) return;
    if (this.marchQueue) return; // ignore taps while the column is marching
    if (this.orderMode === "march") {
      this.groupMarch(tx, ty); // Formation Order: set the march destination
      return;
    }
    if (this.aimMode && this._abilityAim && this.selected && this._abilityClick(tx, ty)) return; // Ep2 unit skill aimed at a tile
    if (this._aimingGrape(this.selected)) {
      this._clickGrapeAim(tx, ty);
      return;
    }
    if (this._aimingShot(this.selected)) {
      this._clickAreaAim(tx, ty);
      return;
    }
    const u = this.unitAt(tx, ty);
    this.inspect = null; // clear any enemy threat view on a new tap
    if (this._clickHeal(u)) return;
    if (this.mode === "act" && this.selected) {
      this._clickAct(tx, ty, u);
      return;
    }
    if (u && u.team === "blue" && u.ally) {
      this.inspectUnit(u); // allied AI armies — tap to read them, never command
      return;
    }
    if (u && u.team === "blue" && !u.acted) {
      this.select(u);
      return;
    }
    if (this.selected) this._clickWithSelection(tx, ty, u);
    else this._clickIdle(tx, ty, u);
  }

  // GRAPESHOT AIM: the cannon is aiming its point-blank spray — tap any of the 4 orthogonal neighbours (an enemy OR
  // empty ground) to rake the forward cone that way without moving onto it. Any other tile just leaves aim.
  _clickGrapeAim(tx, ty) {
    const sel = this.selected,
      dist = Math.abs(tx - sel.tx) + Math.abs(ty - sel.ty);
    this.aimMode = false;
    if (!sel.acted && dist === 1 && this.inBounds(tx, ty)) {
      this._castGroundAoe(sel, tx, ty);
      return;
    }
    this._emit(); // tapped the caster's tile or a non-adjacent cell → just leave aim
  }

  // #15 AIM MODE: an area weapon or a free-aim siege engine is aiming — tap ANY in-range tile to fire there (free
  // pick, empty ground included). Tapping out of range cancels the aim. The shot / blast is previewed on hover.
  // Any tile in the blast donut casts there — empty ground, an enemy, OR one of your own units (direct friendly
  // fire). This donut is identical in feel for the wizard and the siege engines. Tapping the caster's own tile
  // cancels the aim. To switch to another unit, use ✕ Cancel (cancelAim) to leave aim mode first, then tap it.
  _clickAreaAim(tx, ty) {
    const sel = this.selected,
      [mn, mx] = this._castRange(sel);
    const dist = Math.abs(tx - sel.tx) + Math.abs(ty - sel.ty);
    this.aimMode = false;
    if (!sel.acted && dist >= mn && dist <= mx && this.inBounds(tx, ty)) {
      this._castGroundAoe(sel, tx, ty);
      return;
    }
    // Wizard point-blank: an adjacent enemy BELOW the spell's min range is the Wand jab (a plain melee hit, no
    // splash), not the blast — resolve it directly so it still takes one tap.
    const clicked = this.unitAt(tx, ty);
    if (
      !sel.acted &&
      sel.T.canLightning &&
      dist >= 1 &&
      dist < mn &&
      clicked &&
      clicked.team === "red" &&
      !clicked.dead
    ) {
      this.doAttack(sel, clicked);
      return;
    }
    this._emit(); // tapped own tile / out of range → just leave aim mode
  }

  // Priest Heal — tap a wounded friendly unit within casting range to restore 20 HP. True when the tap healed. The
  // priest itself counts: Unit::startHeal (iOS Ep2 @0x67968) lists every same-team unit within 1 tile with HP below
  // full, the healer included (distance 0) — so tapping a wounded priest while it is selected heals it.
  _clickHeal(u) {
    const sel = this.selected;
    if (!sel || !sel.T.heal || sel.acted || !u || u.team !== "blue" || u.dead || u.hp >= 100) return false;
    if (manhattan(sel, u) > sel.T.range) return false;
    this.healUnit(sel, u);
    return true;
  }

  // The ACT step (the unit has moved, or stood still with a foe in reach): strike a lit target, shoot a building,
  // or end the unit's turn.
  _clickAct(tx, ty, u) {
    const sel = this.selected;
    const target = this.targets && this.targets.find((t) => t.tx === tx && t.ty === ty);
    if (target) {
      this.doAttack(sel, target);
      return;
    }
    if (!u && !sel.acted && this.canHitStructure(sel, tx, ty) && this.damageStructure(sel, tx, ty)) return; // shoot the building instead
    // A healer / Prayer caster is kept in act mode for its Prayer (Heal via tapping an ally, Shield / Retribution via
    // the buttons) — its weak melee isn't the point, so a tap on empty ground ends its turn without the "enemy in
    // range" nag; but while a wounded ally is in reach it asks first, as skipping a heal is as likely a misclick.
    if (sel.T.heal || sel.T.prayer) {
      if (this._canHealNow(sel)) this.promptSkip(sel, "heal");
      else this.finishUnit(sel);
      return;
    }
    this.promptSkip(sel); // act mode = an attack is in range → confirm before skipping it
  }

  // A tap with one of your units selected (select mode): shoot a building, strike or approach a foe, move, or read
  // what's on an unreachable tile.
  _clickWithSelection(tx, ty, u) {
    const sel = this.selected;
    const reachable = !!(this.reach && this.reach.stops.has(key(tx, ty)));
    // Shoot an empty BUILDING / WALL in range with a weapon that damages it (siege, fire, longbow, magic, bolts) —
    // unless the tile is somewhere this unit could walk to, in which case the tap still means "move there".
    if (!sel.acted && !u && !reachable && this.canHitStructure(sel, tx, ty)) {
      if (this.damageStructure(sel, tx, ty)) return;
    }
    if (u && u.team === "red") {
      this._clickFoe(sel, u);
      return;
    }
    if (reachable) {
      this.moveUnit(sel, this.pathTo(this.reach, tx, ty), () => this._afterPlayerMove(sel));
      return;
    }
    // Clicked an UNREACHABLE cell — show what's on it (a unit's stats, or the terrain) instead of moving or
    // deselecting. Tapping empty ground twice (nothing to inspect) drops the selection.
    if (u) {
      this.inspectUnit(u);
      return;
    }
    if (this.mode === "select" && !this.tileInfo) {
      this.inspectTile(tx, ty);
      return;
    }
    this.deselect();
  }

  // Tapped a foe with a unit selected: strike it in place if it's in range, else walk up and strike, else read it.
  _clickFoe(sel, u) {
    // ⚡ CHARGE pressed (Auto-charge off): a highlighted foe is charged — the gallop and the strike as one action; any
    // other tap leaves charge mode.
    if (this.chargeMode) {
      const spot = this._chargeSpots && this._chargeSpots.get(u);
      this.chargeMode = false;
      this._chargeSpots = null;
      if (spot) {
        this.moveUnit(
          sel,
          this.pathTo(this.reach, spot.tx, spot.ty),
          () => {
            if (!u.dead && this.targetsFrom(sel, sel.tx, sel.ty).includes(u)) this.doAttack(sel, u);
            else this.enterAct(sel);
          },
          false,
          true,
        );
        return;
      }
      this.recalcTargets();
    }
    // Tap an in-range foe to strike it in place (a Shoot-and-Move unit only while its one shot is unspent).
    const inRange = !(sel.T.shootMove && sel.attackedTurn) && this.targetsFrom(sel, sel.tx, sel.ty).includes(u);
    if (inRange) {
      this.doAttack(sel, u);
      return;
    }
    // APPROACH-AND-ATTACK: a unit that can move AND strike this turn (melee / cavalry — NOT the
    // move-or-shoot ranged units) auto-advances to the best reachable tile in strike range of the tapped foe,
    // then attacks. Lets you tap a foe directly (as with a ranged unit) instead of manually stepping adjacent.
    if (!sel.acted && !sel.T.moveShoot && !sel.T.shootMove && this.reach) {
      const spot = this.bestApproach(sel, u);
      if (spot && !(spot.tx === sel.tx && spot.ty === sel.ty)) {
        const path = this.pathTo(this.reach, spot.tx, spot.ty);
        // with ⚡ Auto-charge on, a tap on a foe at the end of a clear lane gallops and charges it; off, the approach
        // is an ordinary one (the ⚡ Charge button charges, above)
        this.moveUnit(
          sel,
          path,
          () => {
            if (!u.dead && this.targetsFrom(sel, sel.tx, sel.ty).includes(u)) this.doAttack(sel, u);
            else this.enterAct(sel);
          },
          false,
          spot.charge ? true : undefined,
        );
        return;
      }
    }
    this.inspectUnit(u); // can't reach it this turn → show its stats/range, don't march there
  }

  // After a player-ordered move. Move-or-Shoot units (archers/crossbow/musket/siege) may move OR attack in a turn,
  // not both. A mounted archer (Shoot-and-Move, ability 8) gets one of EACH: after its ride it may still shoot
  // (unless it already has), after its shot it may still ride (_afterAttack). Everything else opens the normal act
  // step after the move.
  _afterPlayerMove(unit) {
    if (unit._ambushedTurn === this.turn) {
      this.finishUnit(unit); // stopped by a hidden foe: its attack is spent
      return;
    }
    if (unit.T.shootMove) {
      unit._rodeOn = this.turn;
      if (unit.attackedTurn) {
        this.finishUnit(unit);
        return;
      }
    }
    this.enterAct(unit); // Move-or-Shoot units too: only their untagged weapon is left (targetsFrom), else the turn ends
  }

  // A tap with nothing selected: read what's there.
  _clickIdle(tx, ty, u) {
    if (u && u.team === "red" && this.phase === "player") {
      this.inspectUnit(u); // tap an enemy to see its move + strike range
    } else if (u && u.team === "blue" && u.acted && this.phase === "player") {
      this.inspectUnit(u); // tap one of your OWN spent units to read its stats
    } else if (!u) {
      this.inspectTile(tx, ty); // tap terrain to read its effect
    }
  }

  inspectTile(tx, ty) {
    this.tileInfo = this._tileInfoAt(tx, ty);
    this._emit();
  }
  // What a tile is and does (the terrain card): its real terrain name, cover, healing, move cost per class of unit,
  // any structure and quicksand on it.
  _tileInfoAt(tx, ty) {
    const props = this.terrainAt(tx, ty),
      CATEGORY_LABEL = {
        grass: "Grass",
        road: "Road",
        village: "Village",
        keep: "Keep",
        forest: "Forest",
        hill: "Hill",
        wall: "Rampart",
        water: "Water",
        rubble: "Ruins",
      };
    // MOVE COSTS per movement class from the original's table (Map::getMoveCost: [fly, skirmish, formation, cavalry,
    // engine], 90+ = can't enter); a structure razed this battle moves by its end tile's row. null = can't enter.
    const tileVal = this.tileAt(tx, ty),
      row = props.moveRow || moveRow(moveType(tileVal)),
      cost = (c) => (c == null || c >= 90 ? null : Math.max(1, c)),
      costs = row
        ? { skirmish: cost(row[1]), formation: cost(row[2]), cavalry: cost(row[3]), engine: cost(row[4]) }
        : null;
    return {
      tx,
      ty,
      name: tileName(tileVal) || CATEGORY_LABEL[props.category] || props.category, // the real terrain type's name
      passable: costs ? costs.skirmish != null : props.passable,
      move: costs ? costs.skirmish : props.passable ? props.movecost : null,
      costs,
      def: Math.round((props.defBonus || 0) * 100),
      heal: props.heal || 0,
      blocksMounted: costs ? costs.cavalry == null : props.blocksMounted,
      blocksEngine: costs ? costs.engine == null : props.blocksEngine,
      structure: this._structureInfo(tx, ty),
      quicksand: this._quicksandAt(tx, ty) > 0 ? { turns: this._quicksandAt(tx, ty) } : null, // rounds left
    };
  }
  // The ground a unit stands on, for its card: the tile's terrain and what it does to THIS unit — the share of a blow
  // it takes there (calculateAttackDamage: 100 − the tile's defence; a Formation unit sheds 10% more per adjacent
  // Formation ally; Boulder / Cannonball ignore half of the cover), the healing at the start of its turn, and whether a
  // Stealth / Ambush unit can hide there (getTileDefense ≤ 90).
  _groundView(u) {
    const tile = this._tileInfoAt(u.tx, u.ty);
    const formation = u.T.formation ? this.formationAllies(u) : 0;
    const cover = Math.max(0.05, 1 - tile.def / 100 - 0.1 * formation);
    return {
      name: tile.name,
      def: tile.def,
      takes: Math.round(cover * 100),
      formation,
      heal: tile.heal,
      quicksand: tile.quicksand,
      structure: tile.structure,
      canHide: this._canHideUnit(u) ? 100 - tile.def <= 90 : null,
    };
  }

  // Read any unit (yours, allied or enemy), in any phase, without changing what you have selected: its card plus its
  // move + strike area. The next ordinary tap clears it.
  peekAt({ tx, ty }) {
    if (!this.inBounds(tx, ty) || this.phase === "victory" || this.phase === "defeat") return;
    const found = this.unitAt(tx, ty),
      u = found && !this.hsMusterHidden(found) ? found : null; // a hot-seat muster can't scout the other army
    if (!u) {
      if (this.inspect && this.inspect.peek) {
        this.inspect = null;
        this._emit();
      }
      return;
    }
    this.inspectUnit(u);
    if (this.inspect) {
      this.inspect.peek = true;
      this._emit();
    }
  }
  inspectUnit(u) {
    this.tileInfo = null;
    // Reading a unit drops the selection — and with it that unit's move grid and red targets, or they stay drawn under
    // the card being read (tap a fresh archer, then a spent one: its card showed the first archer's targets, untappable).
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.mode = "select";
    this.aimMode = false;
    this._abilityAim = null;
    this.inspect = { unit: u, reach: this.computeReach(u), threat: this.threatOf(u) };
    this.audio.play("select", 0.3);
    this._emit();
  }

  // The tile a tap on `enemy` walks `u` to: with ⚡ Auto-charge on, a charge launch first (see _chargeLaunch — a charge
  // lands +30 and rides on, so it beats a plain adjacent step); else the nearest reachable tile in weapon range.
  bestApproach(u, enemy) {
    if (!this.reach) return null;
    const launch = this._autoChargeOn() ? this._chargeLaunch(u, enemy) : null;
    if (launch) return { ...launch, charge: true };
    let best = null,
      bestDist = FAR;
    for (const k of this.reach.stops) {
      const [x, y] = k.split(",").map(Number);
      const dist = Math.abs(enemy.tx - x) + Math.abs(enemy.ty - y);
      if (dist >= u.T.minRange && dist <= u.T.range && dist < bestDist) {
        bestDist = dist;
        best = { tx: x, ty: y };
      }
    }
    return best;
  }
  // A CHARGE LAUNCH for `u` at `enemy`: the reachable tile ending a straight gallop of 2+ tiles with the foe one step
  // beyond (the shortest such run), or null. Its lane may be DIAGONAL (launch is manhattan-2 from the foe), so it is
  // looked for apart from plain weapon range. CRUCIAL: the ACTUAL path must be a clean straight run — _chargeReaches is
  // pure geometry, but if the lane is blocked the path bends around the blocker, chargeDir never sets, and the unit
  // would waste its turn stepping diagonally-adjacent to a foe it then can't melee.
  _chargeLaunch(u, enemy) {
    if (!this.reach) return null;
    let best = null,
      bestRun = FAR;
    for (const k of this.reach.stops) {
      const [x, y] = k.split(",").map(Number);
      if (!this._chargeReaches(u, x, y, enemy) || !this._pathChargesStraight(this.pathTo(this.reach, x, y), enemy))
        continue;
      const run = Math.max(Math.abs(x - u.tx), Math.abs(y - u.ty));
      if (run < bestRun) {
        bestRun = run;
        best = { tx: x, ty: y };
      }
    }
    return best;
  }
  // ⚡ CHARGE BUTTON (⚡ Auto-charge off) — the original's Charge menu entry (GameScreen::onMenuEvent → prepareAction(13),
  // createChargeTargetList): offered to a rider that has not moved this turn while some foe has a charge launch. Pressed,
  // only those foes are targets and a tap charges one (_clickFoe); pressed again, the ordinary targets come back.
  chargeTargets(u) {
    const out = [];
    if (!u || u !== this.selected || u.acted || !u.T.hasCharge || u.slowed || this._movedThisTurn(u)) return out;
    if (this.mode !== "select" || !this.reach) return out;
    for (const e of this.units) {
      if (e.dead || e.team === u.team || this._isHidden(e)) continue;
      const spot = this._chargeLaunch(u, e);
      if (spot) out.push({ e, spot });
    }
    return out;
  }
  toggleCharge() {
    if (this.chargeMode) {
      this.chargeMode = false;
      this._chargeSpots = null;
      this.recalcTargets();
    } else {
      const list = this._autoChargeOn() ? [] : this.chargeTargets(this.selected);
      if (!list.length) return;
      this.chargeMode = true;
      this._chargeSpots = new Map(list.map(({ e, spot }) => [e, spot]));
      this.targets = list.map(({ e }) => e);
    }
    this.audio.play("select", 0.3);
    this._emit();
  }
  // True only if the ACTUAL path is a clean straight gallop of 2+ tiles — 3+ path points with the start, the run
  // _judgeChargeRun needs to set chargeDir (createChargeTargetList: the foe more than 2 from the start) — with the
  // foe one tile beyond its end along the same lane — i.e. this path really lands a charge, not a bent detour.
  _pathChargesStraight(path, enemy) {
    if (!path || path.length < 3) return false;
    const dx = Math.sign(path[1].tx - path[0].tx),
      dy = Math.sign(path[1].ty - path[0].ty);
    if (dx === 0 && dy === 0) return false;
    for (let i = 2; i < path.length; i++)
      if (Math.sign(path[i].tx - path[i - 1].tx) !== dx || Math.sign(path[i].ty - path[i - 1].ty) !== dy) return false;
    const end = path[path.length - 1];
    return enemy.tx === end.tx + dx && enemy.ty === end.ty + dy;
  }

  select(u) {
    this._spotReveal(u);
    this.chargeMode = false; // ⚡ Charge is armed per selection
    this._chargeSpots = null;
    this.inspect = null;
    this.tileInfo = null;
    this.selected = u;
    this.mode = "select";
    this.aimMode = false;
    this._abilityAim = null;
    this._aimKind = null;
    /* default to MOVE on select — an area weapon enters free-pick aim only when you tap ✸ Aim (or, for a wizard, pick a spell) */ this.reach =
      this.computeReach(u);
    this.recalcTargets();
    this.audio.play("select", 0.4);
    if (u.T.kind === "cavalry" && !u.T.fly) this.audio.play("horse", 0.4);
    /* a whinny (snd_027) when you pick up a mounted unit */ this.centerOn(u.tx, u.ty, true);
    this._emit();
  }
  deselect() {
    this.chargeMode = false;
    this._chargeSpots = null;
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.mode = "select";
    this.aimMode = false;
    this._abilityAim = null;
    this._emit();
  }
  // "Next Unit" (help BATTLEFIELD): cycle selection to the next un-acted unit of your army.
  selectNextUnit() {
    if (this.phase !== "player" || this.anim || this.marchQueue) return;
    const list = this.units.filter((u) => !u.dead && u.team === "blue" && !u.ally && !u.acted);
    if (!list.length) return;
    const idx = this.selected ? list.indexOf(this.selected) : -1;
    this.select(list[(idx + 1 + list.length) % list.length]);
  }
  // A Shoot-and-Move unit that already loosed its one shot this turn has no targets left (it may still ride).
  recalcTargets() {
    this.targets = this.selected
      ? this.selected.T.shootMove && this.selected.attackedTurn
        ? []
        : this.targetsFrom(this.selected, this.selected.tx, this.selected.ty)
      : null;
  }

  enterAct(u) {
    this.chargeMode = false;
    this._chargeSpots = null;
    this.reach = null;
    this.targets = this.targetsFrom(u, u.tx, u.ty);
    // A PRIEST that walked up keeps its PRAYERS: Unit::isAbilityAvailable (iOS Ep2 @0x74e94) puts no condition on
    // Shield / Retribution, so the menu offers them whenever the priest has not acted. A Heal-only unit stays in act
    // mode only with a wounded ally in range; with nothing to do (and no enemy in reach) its turn ends like any other.
    const canPray = !u.acted && (!!u.T.prayer || this._canHealNow(u));
    if (this.targets.length || canPray) {
      this.mode = "act";
      this.selected = u;
      this._emit();
    } else this.finishUnit(u);
  }
  // A wounded unit of the healer's side within its casting range, the healer itself included (Unit::startHeal).
  _canHealNow(u) {
    if (!u || u.acted || !u.T.heal) return false;
    const range = u.T.range || 1;
    return this.units.some((a) => !a.dead && a.team === u.team && a.hp < 100 && manhattan(a, u) <= range);
  }
  finishUnit(u) {
    this.chargeMode = false;
    this._chargeSpots = null;
    u.acted = true;
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.mode = "select";
    this._checkPhaseEnd();
    this._emit();
  } // reach too: an attack straight from move mode left its cells drawn
  // SHOOT-AND-MOVE (ability 8). The command menu (GameScreen::initMenuState @0x20774 / @0x2154c) offers Attack after a
  // move and Move after an attack only to a Shoot-and-Move unit. HORSE BOWMEN (type 14) also SHOOT WHILE RIDING —
  // Unit::onTick (iOS Ep2 @0x78450): on the 1st, 3rd, 5th… tile of the ride (flag Unit+0xf4, cleared by
  // prepareAction) it looses an arrow at the NEAREST foe within its bow's range from that tile that it has not shot
  // yet this ride (hidden foes skipped, first in the unit list on a tie), queued with its tile and applied as an
  // ordinary hit (no counter). The ride then counts as its attack (doFinishMoving sets Unit+0x113), so there is no
  // aimed shot after it; an aimed shot BEFORE the ride is still allowed, and the ride after it fires as well.
  _hbPickShot(u, tile, shot) {
    let best = null,
      bestDist = (u.T.range || 1) + 1;
    for (const e of this.units) {
      if (e.dead || e.team === u.team || this._isHidden(e) || shot.has(e.id)) continue;
      const dist = manhattan(e, tile);
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    return best;
  }
  _hbRideStep(u, tile, a) {
    if (a._hbSkip) {
      a._hbSkip = false;
      return;
    }
    a._hbSkip = true;
    a._hbShot = a._hbShot || new Set();
    const e = this._hbPickShot(u, tile, a._hbShot);
    if (!e) return;
    this._commitMove(u); // the ride fired: no undo
    a._hbShot.add(e.id);
    const from = Object.assign(Object.create(Object.getPrototypeOf(u)), u, { tx: tile.tx, ty: tile.ty });
    const damage = this.computeDamage(from, e);
    this._after(0.2, () => {
      // the queued shot is loosed 200 ms later (Unit+0xf0 = 200)
      if (u.dead || e.dead) return;
      const dur = this.fireProjectile(u, e) || 0.25;
      this._after(dur, () => {
        if (!e.dead) this._applyHit(e, from, damage, false);
        this._emit();
      });
    });
  }
  // HIDDEN FOES ON THE WAY — Unit::onTick (iOS Ep2 @0x7839c) and Unit::doFinishMoving (@0x770ca): a move that steps
  // next to a hidden foe stops on that tile; when the move ends, every hidden foe next to the unit is revealed (and so
  // is the mover), and one of them (the last in the unit list) strikes it once — the counter-strike state — and the
  // mover's attack for the turn is spent (Unit+0x113).
  _hiddenFoeBeside(u, tile) {
    return this.units.some((e) => !e.dead && e.team !== u.team && manhattan(e, tile) === 1 && this._isHidden(e));
  }
  _bumpAmbush(mover, cont) {
    if (mover.dead) return false;
    let ambusher = null;
    for (const e of this.units) {
      if (e.dead || e.team === mover.team || manhattan(e, mover) !== 1 || !this._isHidden(e)) continue;
      this._setHidden(e, false);
      ambusher = e;
    }
    if (!ambusher) return false;
    this._commitMove(mover); // an ambush was sprung: no undo
    this._setHidden(mover, false);
    mover.attackedTurn = true;
    mover._ambushedTurn = this.turn;
    ambusher.face = Math.sign(mover.tx - ambusher.tx) || ambusher.face || 1;
    this.floaters.push({
      x: ambusher.px + this.tile / 2,
      y: ambusher.py - 6,
      t: 0,
      life: 1.0,
      vy: -16,
      text: tr("Ambush!"),
      crit: true,
      heal: true,
    });
    this.anim = { type: "attack", u: ambusher, target: mover, t: 0, hitDone: false, counter: true, done: cont };
    ambusher.attacking = true;
    ambusher.anim = 0;
    ambusher.animT = 0;
    ambusher.hitPending = mover;
    this._emit();
    return true;
  }
  // Hover preview of a Horse Bowmen ride along `path`: the shots it will loose, tile by tile (the same rule).
  _strafePlan(u, path) {
    if (!u.T.mountedArcher || path.length < 2) return [];
    const plan = [],
      shot = new Set();
    for (let i = 1; i < path.length; i += 2) {
      const e = this._hbPickShot(u, path[i], shot);
      if (e) {
        shot.add(e.id);
        plan.push({ tx: path[i].tx, ty: path[i].ty, foe: e });
      }
    }
    return plan;
  }
  // A player's attack has resolved. A Shoot-and-Move unit that has not moved yet keeps its MOVE (menu @0x2154c) — it
  // stays selected with its move range and no targets; everyone else ends its turn.
  _afterAttack(u) {
    if (
      !u.dead &&
      u.T.shootMove &&
      u.team === "blue" &&
      !u.ally &&
      this.phase === "player" &&
      u._rodeOn !== this.turn
    ) {
      this.selected = u;
      this.mode = "select";
      this.reach = this.computeReach(u);
      this.targets = [];
      if (this.reach.stops.size > 1) {
        this._emit();
        return;
      }
    }
    this.finishUnit(u);
  }
  // HOLD — end the selected unit's turn where it stands, without attacking (moved or not). Not attacking matters at the
  // end of the turn: a Pikeman braces its Pike Wall, an Ambush unit in cover hides (Unit::endTurn).
  canHold() {
    const sel = this.selected;
    return !!(
      sel &&
      this.phase === "player" &&
      !this.anim &&
      !this.marchQueue &&
      !this.pendingSkip &&
      sel.team === "blue" &&
      !sel.ally &&
      !sel.dead &&
      !sel.acted
    );
  }
  holdUnit() {
    if (!this.canHold()) return;
    this.audio.play("click", 0.4);
    this.finishUnit(this.selected);
  }
  // Skipping a unit that still has an in-range attack (or a heal) is usually a misclick — confirm before wasting it.
  promptSkip(u, kind = "attack") {
    this.pendingSkip = u;
    this.pendingSkipKind = kind;
    this._emit();
  }
  confirmSkip() {
    const u = this.pendingSkip;
    this.pendingSkip = null;
    if (u && !u.dead) this.finishUnit(u);
    else this._emit();
  } // yes, end its turn without attacking
  cancelSkip() {
    this.pendingSkip = null;
    this._emit();
  } // no — stay in act mode so the player can still strike

  // Record the last player move so it can be rolled back — until that unit attacks.
  recordUndo(u, path) {
    if (u.team === "blue" && this.phase === "player" && path.length > 1)
      this._undoFrom = { u, tx: path[0].tx, ty: path[0].ty };
  }
  canUndo() {
    return !!(this._undoFrom && this.phase === "player" && !this.anim);
  }
  // A move that SETS SOMETHING OFF can no longer be undone: an attack, a portal jump, an ambush sprung, quicksand
  // stepped into, a Horse Bowmen ride shot, a scripted tile trigger, an escape / escort delivery.
  _commitMove(u) {
    if (this._undoFrom && this._undoFrom.u === u) this._undoFrom = null;
  }
  undoMove() {
    if (!this.canUndo()) return;
    const { u, tx, ty } = this._undoFrom;
    if (u.dead) {
      this._undoFrom = null;
      this._emit();
      return;
    }
    u.tx = tx;
    u.ty = ty;
    u.px = tx * this.tile;
    u.py = ty * this.tile;
    this._undoShapeshift(u);
    u.acted = false;
    u.chargeDir = null;
    u._rodeOn = null;
    this._undoFrom = null;
    u._movedTurn = u._movedPrev;
    this.audio.play("select", 0.4);
    this.select(u); // re-plan from the original tile
  }

  // Walk unit `u` along `path` (tiles, start included), then call `done`. Records the move for Undo unless `noUndo`,
  // marks it as moved this turn, and judges whether the run-up makes a charge — `charge`: true = the Charge action's
  // gallop (a tap on the foe, the AI's charge), which charges even with ⚡ Auto-charge off; false = never (the AI's
  // other moves, scripted moves); left out = the player's own move, which charges by ⚡ Auto-charge. A Wizard blinks
  // instead of walking.
  moveUnit(u, path, done, noUndo, charge) {
    if (path.length <= 1) {
      u.chargeDir = null;
      done();
      return;
    }
    this._dbg("move", {
      u: u.id,
      ty: u.type,
      tm: u.team,
      from: [u.tx, u.ty],
      to: [path[path.length - 1].tx, path[path.length - 1].ty],
      aim: u.team === "blue" && !u.ally ? undefined : u._dbgAim,
    });
    path = this._trimPathEnd(u, path);
    if (path.length <= 1) {
      u.chargeDir = null;
      done();
      return;
    }
    if (!noUndo) this.recordUndo(u, path);
    u._movedPrev = u._movedTurn;
    u._movedTurn = this.turn; // Unit+0x112 "moved this turn" — locks Move-or-Shoot weapons
    if (u.T.teleport) {
      this._teleportMove(u, path[path.length - 1], done);
      return;
    }
    this._judgeChargeRun(u, path, charge);
    const sound = this._moveSound(u);
    // glide pace (tiles/sec): mounts and siege move at a slower, heavier gait than foot, so a cavalry sweep
    // across the field reads as a deliberate gallop rather than an instant zip.
    const speed = u.T.kind === "cavalry" ? 4.6 : u.T.kind === "siege" ? 4.2 : 6;
    this.anim = { type: "move", u, path, seg: 0, t: 0, done, speed, snd: sound }; // snd: faded when the glide ends (see engine/loop)
    this._emit();
  }

  // SAFETY: a move must never END on a tile another live unit holds. An ally's reach floods THROUGH a friendly
  // unit (same team isn't a wall), so a stale/edge path could otherwise land it on top of one of your units
  // (an allied knight stepping onto the player's druid). Trim the path back to the last free tile.
  _trimPathEnd(u, path) {
    while (path.length > 1) {
      const end = path[path.length - 1],
        occupant = this.unitAt(end.tx, end.ty);
      if (!occupant || occupant === u) break;
      path = path.slice(0, -1);
    }
    return path;
  }

  // TELEPORT (help MOVEMENT: "Wizards have learnt to Teleport… directly to their destination"): no glide —
  // an arcane orb collapses at the origin, an instant relocate, then the orb reforms at the destination.
  _teleportMove(u, end, done) {
    const tile = this.tile;
    u.chargeDir = null;
    this.spawnFx("arcane_out", u.px + tile / 2, u.py + tile * 0.42, {}); // z_001 — orb DEMATERIALIZES at the SOURCE (full→gone)
    // A magical blink shimmer (snd_016) — NOT the "spell" clip, which is the Ice spell and made teleport sound icy.
    this.audio.play("teleport_out", 0.5);
    u._teleporting = true;
    this._teleportLock = true; // vanish while in transit — drawn on NEITHER cell; freeze input
    this._emit();
    // Let the SOURCE dematerialize play out fully (~0.55s), then relocate and play the reform circle at the
    // DESTINATION, then reveal. Two full-half animations → a proper, longer teleport with no flicker/reappear.
    this._after(0.55, () => {
      u.tx = end.tx;
      u.ty = end.ty;
      u.px = end.tx * tile;
      u.py = end.ty * tile;
      this.spawnFx("arcane_in", u.px + tile / 2, u.py + tile * 0.42, {}); // z_001 — orb REMATERIALIZES at the destination (gone→full)
      this.audio.play("teleport_in", 0.5);
      this.centerOn(end.tx, end.ty, true);
      this._emit();
      this._after(0.55, () => {
        // reveal the wizard as the reform finishes
        u._teleporting = false;
        this._teleportLock = false;
        // the move's end, as a glide's (engine/loop finish): TILE-REACHED triggers, escaping on an escape map's goal
        // area, escort delivery, the leash hint — then the after-move step. A blink that lands on a portal pad takes
        // the portal too (the post-move check runs after ANY move), and the finish runs where it comes out.
        const finish = () => {
          this.scenario.onTileReached(u);
          this._leashHint(u);
          done && done();
        };
        if (!this._portalWarp(u, finish)) finish();
        this._emit();
      });
    });
  }

  // CHARGE (Unit::createChargeTargetList, both binaries): the foe must sit > 2 tiles (Manhattan) from the mount's
  // START tile and within its move — so a straight gallop of TWO tiles (path of 3 incl. the start) then the strike
  // ("two spaces to build up speed", help 565). Ice Field disables charging, so a slowed mount can't build one.
  // Sets u.chargeDir (the lane's direction, or null) and u.chargeSpent (the movement the run-up used).
  // ⚡ AUTO-CHARGE (⚙ Settings, on by default) — DELIBERATE DEVIATION (user decision, MECHANICS.md §13): judged on
  // EVERY move, so any straight gallop makes the next strike ahead a charge. Off, it is the original: the charging
  // flag (Unit+0xb4) is set only by Unit::charge @0x6bfe6, for the Charge action (13) alone — here the move made with
  // `charge` (the tap on a foe, the AI's charge); a plain move followed by an attack is an ordinary blow. The AI
  // always plays the original (ai.js _aiMove): Auto-charge only ever applies to a player's own move (`charge` left out).
  _judgeChargeRun(u, path, charge) {
    // any unit with the Charge ability (incl. the mounted Hero), not galloping out of quicksand (_chargeBogged)
    let straight =
      (charge === true || (charge === undefined && this._autoChargeOn())) &&
      path.length >= 3 &&
      u.T.hasCharge &&
      !u.slowed &&
      !this._chargeBogged(u, path[0].tx, path[0].ty);
    if (!straight) {
      u.chargeDir = null;
      return;
    }
    const dirX = Math.sign(path[1].tx - path[0].tx),
      dirY = Math.sign(path[1].ty - path[0].ty);
    for (let i = 2; i < path.length; i++) {
      if (Math.sign(path[i].tx - path[i - 1].tx) !== dirX || Math.sign(path[i].ty - path[i - 1].ty) !== dirY) {
        straight = false;
        break;
      }
    }
    u.chargeDir = straight ? { dx: dirX, dy: dirY } : null;
    // Movement the run-up used (the lane's budget, _wouldCharge / _chargeRun) — a diagonal step costs twice.
    if (u.chargeDir) {
      let spent = 0;
      for (let i = 1; i < path.length; i++)
        spent += this._chargeStep(u, path[i - 1].tx, path[i - 1].ty, path[i].tx, path[i].ty, u.chargeDir);
      u.chargeSpent = spent;
    }
  }

  // Movement SFX by the real locomotion class (al): FLYING al0 (griffon/eagle) → fly (snd_005), cavalry al3 →
  // gallop (snd_008), SIEGE al4 (catapult/cannon) → march/trundle (snd_034), foot → move (snd_013) — as the
  // decompiled `al` switch has it (flying on snd_005, the heavy trundle snd_034 on the war engines). Returns the
  // playing sound.
  _moveSound(u) {
    if (u.type === "bloodgorgers") return this.audio.play("move_gorger", 0.4); // Unit::playMovingSound: type 35 → 45
    if (u.type === "conjurer") return this.audio.play("move_conjurer", 0.4); // type 31 → 46
    if (u.T.fly) return this.audio.play("fly", 0.4);
    if (u.T.kind === "cavalry") return this.audio.play(this._altMove("gallop", "gallop2"), 0.42);
    if (u.T.kind === "siege") return this.audio.play("march", 0.4, 0.9);
    return this.audio.play(this._altMove("move", "move2"), 0.34);
  }
}
