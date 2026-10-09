/* ============================================================
   Reign of Swords — the per-frame simulation loop.
   The engine's heartbeat: the requestAnimationFrame driver (_loop), the
   background keep-alive tick used while the tab is hidden (_tickBg), the
   fast-forward / input-lock toggles, and update(dt) — which advances attack &
   move animations (glides, charge dashes, hit frames + counters), heal / cast
   resolves, projectiles, particles, bolts and FX, camera easing, the AI delay
   clock (calling aiStep), scheduled callbacks and floaters. Mixed onto
   Game.prototype in engine/engine.js — every method runs with `this` = the live Game
   and drives the sibling systems (combat/ai/render) via `this`. Only geometry
   (util/util) and FX/weapon tables (data/game-data) are imported.
   ============================================================ */

import { manhattan } from "../util/util.js";
import { FX_TYPES } from "../data/game-data.js";

// Fast-forward levels: 0 off, 1 fast (×4), 2 super fast (×12). A frame's sped-up time is played in steps no larger
// than one fast-forward frame's (0.05 s × 4), so super fast runs the same simulation, just more of it per frame.
const FAST_SCALE = [1, 4, 12];
const MAX_STEP = 0.2;

export class LoopMethods {
  // --- loop ---
  _loop(now) {
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.05) dt = 0.05;
    // Fast-forward: when the toggle is on, the WHOLE battle runs at high speed — your own units' moves, strikes,
    // Shoot-and-Move runs, scripted moves, reinforcements and portal warps too, not just the enemy / allied turns and
    // Formation marches (gating it on those phases left every player-phase sequence at normal speed, while the
    // audio side of Fast was on everywhere).
    let left = dt * this._fastScale();
    while (left > 1e-4) {
      const step = Math.min(MAX_STEP, left);
      this.update(step);
      left -= step;
    }
    this._uiGuard();
    this.renderer.render();
    this._raf = requestAnimationFrame(this._loop);
  }
  // Background tick (tab hidden): advance the sim WITHOUT rendering. Timers in a hidden tab are throttled (often
  // to ~1s), so cover the whole elapsed gap in ≤50ms sub-steps — animations still resolve and a fast-forwarded
  // enemy turn keeps playing out while minimized.
  _tickBg() {
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt <= 0) return;
    if (dt > 3) dt = 3; // cap a long stall so we don't spin forever
    dt *= this._fastScale();
    let left = dt;
    while (left > 1e-4) {
      const step = Math.min(0.05, left);
      this.update(step);
      left -= step;
    }
    this._uiGuard();
  }
  // 0 off, 1 fast, 2 super fast (true = 1).
  setFastForward(level) {
    this.fastFwd = level === true ? 1 : Math.max(0, Math.min(2, level | 0));
    if (this.audio && this.audio.setFast) this.audio.setFast(this.fastFwd > 0);
  }
  // 🤖 AUTOPILOT (not in the original): the AI plays your turns with a strategy (ai/autopilot.js); null = you play.
  setAutopilot(strategy) {
    this.autopilot = strategy || null;
    this._apQueue = null;
    this._apPlans = null;
    this.aiDelay = 0.3;
    if (this.autopilot) {
      this.deselect();
      this.orderMode = null;
    }
    this._emit();
  }
  _fastScale() {
    return this.phase === "deploy" ? 1 : FAST_SCALE[this.fastFwd | 0] || 1;
  } // deployment is placement only — nothing to speed
  // Freeze battlefield input while a React modal (battle menu, objectives, field manual, victory/defeat card…) is
  // up. The canvas binds pointerdown on itself and pointerup on window, so a full-screen overlay does NOT reliably
  // stop a tap from reaching the field — this is the authoritative gate. Also drops any in-progress drag.
  setInputLocked(on) {
    this.inputLocked = !!on;
    if (on) this._drag = null;
  }

  update(dt) {
    this.clock = (this.clock || 0) + dt;
    this.updateObjectives();
    this._updateCamera(dt);
    this._updateTimers(dt);
    this._runDelayed(dt);
    if (this.online) this.onlinePump(); // online: replay the opponent's next command once the field is idle
    if (this.bannerHold > 0) this.bannerHold = Math.max(0, this.bannerHold - dt);
    this.units = this.units.filter((u) => !(u.dead && u.dieT > 0.9));
    this._endTurnWatch(); // each unit's Unit::endTurn once it is done (Spirit Shroud, charge)

    this.scenario.onDeath(); // scripted UNIT-LOST triggers
    this.scenario.flush(); // queued scripted dialogue
    this._snapIdleUnits();

    if (this.anim) this._updateAnim(dt);
    else if ((this.phase === "enemy" || this.phase === "ally") && this.aiQueue) this._updateAiClock(dt);
    else if (this.phase === "player" && this.autopilot && !this.marchQueue) this._updateAiClock(dt, true);
    else if (
      this.phase === "player" &&
      this.marchQueue &&
      // the last unit's portal jump (or another deferred step of its move) must land before the next one sets off —
      // its after-move strike would otherwise take over the next unit's glide and strand that sprite mid-step
      !this._teleportLock &&
      !(this._delayed && this._delayed.length) &&
      !(this.bannerHold > 0)
    ) {
      this.marchDelay -= dt;
      if (this.marchDelay <= 0) this._marchStep();
    }
  }

  // camera easing toward focus target, and edge-scroll while the pointer rests near a border
  _updateCamera(dt) {
    if (this.camTarget) {
      this.cam.x += (this.camTarget.x - this.cam.x) * Math.min(1, dt * 7);
      this.cam.y += (this.camTarget.y - this.cam.y) * Math.min(1, dt * 7);
      if (Math.abs(this.camTarget.x - this.cam.x) < 0.5 && Math.abs(this.camTarget.y - this.cam.y) < 0.5)
        this.camTarget = null;
      this.clampCam();
    }
    // edge-scroll while the pointer rests near a border and the map overflows
    if (!this._drag && (this.edge.x || this.edge.y)) {
      const speed = 460 * dt;
      if (this.world.w > this.view.w && this.edge.x) this.cam.x += this.edge.x * speed;
      if (this.world.h > this.view.h && this.edge.y) this.cam.y += this.edge.y * speed;
      this.camTarget = null;
      this.clampCam();
    }
  }

  // Per-frame timers: unit flash / death fade / shove, floaters, particles, lightning bolts, projectiles, FX.
  _updateTimers(dt) {
    for (const u of this.units) {
      if (u.flash) u.flash = Math.max(0, u.flash - dt);
      if (u.dead) u.dieT = (u.dieT || 0) + dt;
      if (u.shove) {
        u.shove.t -= dt;
        if (u.shove.t <= 0) u.shove = null;
      }
    }
    for (const floater of this.floaters) {
      floater.t += dt;
      floater.y += (floater.vy || 0) * dt;
    }
    this.floaters = this.floaters.filter((f) => f.t < f.life);
    if (this.particles && this.particles.length) {
      for (const particle of this.particles) {
        particle.t += dt;
        if (particle.t < 0) continue; // still waiting out its delay
        if (particle.ring || particle.smoke) {
          if (particle.smoke) particle.y += (particle.vy || 0) * dt;
          continue;
        }
        particle.vy += (particle.grav || 0) * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
      }
      this.particles = this.particles.filter((p) => p.t < p.life);
    }
    if (this.bolts && this.bolts.length) {
      for (const b of this.bolts) b.t += dt;
      this.bolts = this.bolts.filter((b) => b.t < b.life);
    }
    for (const shot of this.projectiles) {
      shot.t += dt;
      if (shot.impactSnd && !shot._impacted && shot.t >= shot.dur) {
        shot._impacted = true;
        this.audio.play(shot.impactSnd, shot.impactVol || 0.5);
      } // cannonball boom on landing
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);
    if (this.fx) {
      for (const e of this.fx) e.t += dt;
      this.fx = this.fx.filter((e) => e.t - e.delay < FX_TYPES[e.name].dur);
    }
  }

  // Deferred actions (e.g. Lightning Storm's bolts, which fall one-by-one — La/q bi==26 strikes ah 0→5
  // one tile per animation step, never the whole area at once). Each entry fires its fn when its timer elapses.
  _runDelayed(dt) {
    if (this._delayed && this._delayed.length) {
      for (const job of this._delayed) job.t -= dt;
      const ready = this._delayed.filter((d) => d.t <= 0);
      this._delayed = this._delayed.filter((d) => d.t > 0);
      for (const job of ready) {
        try {
          job.fn();
        } catch (_) {}
      }
    }
  }

  // SAFETY: heal any position desync. A unit's SPRITE draws at px/py while clicks/targeting use tx/ty — if those
  // ever drift apart (an interrupted glide, etc.) the unit appears on an empty-looking tile and is unclickable
  // (the "knight on a different tile" bug). While nothing is animating, snap every unit's pixels to its own tile.
  _snapIdleUnits() {
    if (!this.anim && !this.marchQueue) {
      const tilePx = this.tile;
      for (const u of this.units) {
        if (u.dead || u._teleporting) continue;
        const px = u.tx * tilePx,
          py = u.ty * tilePx;
        if (u.px !== px || u.py !== py) {
          u.px = px;
          u.py = py;
        }
      }
    }
  }

  // Advance the running action animation (one at a time: this.anim).
  _updateAnim(dt) {
    const a = this.anim;
    if (a.type === "pan") this._animPan(a, dt);
    else if (a.type === "move") this._animMove(a, dt);
    else if (a.type === "balk") this._animBalk(a, dt);
    else if (a.type === "attack") this._animAttack(a, dt);
  }

  _animPan(a, dt) {
    // Camera hand-off before an AI unit acts: hold until the eased pan arrives (camTarget clears), capped so a
    // player dragging the map or an odd target can never stall the turn.
    a.t += dt; // `min` = a minimum hold (e.g. let a druid's shapeshift bloom play before it moves)
    if (a.t >= (a.min || 0) && (!this.camTarget || a.t >= (a.max || 0.9))) {
      const done = a.done;
      this.anim = null;
      done && done();
      this._emit();
    }
  }

  _animMove(a, dt) {
    a.t += dt * (a.speed || 6);
    while (a.t >= 1 && a.seg < a.path.length - 1) {
      a.t -= 1;
      a.seg++;
      // Unit::onTick (iOS Ep2 @0x7839c): a step onto a tile next to a HIDDEN foe ends the move there (no ride shot
      // that step); the foe is dealt with when the move finishes (_bumpAmbush).
      const here = a.path[a.seg];
      if (a.seg < a.path.length - 1 && this._hiddenFoeBeside(a.u, here)) {
        a.path = a.path.slice(0, a.seg + 1);
        a.t = 0;
        break;
      }
      if (a.u.T.mountedArcher) this._hbRideStep(a.u, here, a);
    }
    const cur = a.path[a.seg],
      next = a.path[Math.min(a.seg + 1, a.path.length - 1)];
    const progress = a.seg < a.path.length - 1 ? a.t : 0;
    a.u.px = (cur.tx + (next.tx - cur.tx) * progress) * this.tile;
    a.u.py = (cur.ty + (next.ty - cur.ty) * progress) * this.tile;
    a.u.face = Math.sign(next.tx - cur.tx) || a.u.face || 1;
    if (a.seg >= a.path.length - 1) {
      if (a.snd) a.snd.stop(0.2); // the unit has arrived — fade its (1-3s) movement clip instead of letting it ring on
      const end = a.path[a.path.length - 1];
      a.u.tx = end.tx;
      a.u.ty = end.ty;
      a.u.px = end.tx * this.tile;
      a.u.py = end.ty * this.tile;
      const done = a.done,
        mover = a.u;
      if (mover.T.mountedArcher) mover.attackedTurn = true; // Unit::doFinishMoving @0x773a0: a Horse Bowmen ride counts as its attack (Unit+0x113)
      if ((mover.ambush || mover.T.ambush) && this._canHide(mover)) this._setHidden(mover, true); // doFinishMoving: an Ambush unit hides on cover
      const finish = () => {
        this.scenario.onTileReached(mover); // TILE-REACHED triggers + escort delivery
        this._leashHint(mover); // Leashing warning (help 592)
        done && done();
        this._emit();
      };
      this.anim = null;
      this._quicksandEnter(mover); // stepped into quicksand: stopped there, 5 damage
      if (this._bumpAmbush(mover, finish)) return;
      // EPISODE II warp portals: a move that ENDS on a usable portal pad warps the unit out beside the exit pad
      // (engine/grid _portalWarp, per Unit::onTick / getPortalOutput); the after-move step runs once it has landed.
      if (!this._portalWarp(mover, finish)) finish();
    }
  }

  _animBalk(a, dt) {
    // FEAR BALK (Unit::attack → state 9): the unit holds its tile while the skull overlay plays, then its turn ends.
    a.t += dt;
    if (a.t >= FX_TYPES.skull.dur) {
      const done = a.done;
      this.anim = null;
      done && done();
      this._emit();
    }
  }

  _animAttack(a, dt) {
    a.u.animT += dt;
    // Ranged foot carry TWO attacks in one strip: pick by distance to the target. A shot at range plays the
    // bow/gun sub-range [rangedFrom..rangedTo] and looses at rangedHit; a point-blank enemy (8-dir adjacent)
    // plays the dagger melee [meleeFrom..meleeTo] and strikes at hitFrame (no projectile — the short-sword hit).
    // Units with no split just play the whole strip [0..frames-1] and hit at hitFrame, as before.
    const T = a.u.T;
    const adjacent = a.target && a.target.tx != null ? manhattan(a.u, a.target) === 1 : true; // orthogonal adjacency (4-dir): melee vs bow frames
    const melee = T.meleeFrom != null && adjacent && !a.heal && !a.cast && !a.structure;
    const bow = !melee && T.rangedFrom != null && !!T.projectile && !a.heal && !a.cast && !a.structure;
    let lo, hi, hitF;
    if (bow) {
      lo = T.rangedFrom;
      hi = T.rangedTo != null ? T.rangedTo : T.frames - 1;
      hitF = T.rangedHit != null ? T.rangedHit : hi;
    } else if (melee) {
      lo = T.meleeFrom;
      hi = T.meleeTo != null ? T.meleeTo : T.frames - 1;
      hitF = T.hitFrame != null ? T.hitFrame : hi;
    } else {
      lo = 0;
      hi = T.frames - 1;
      hitF = T.hitFrame;
    }
    const frameDur = (0.9 * 0.5) / Math.max(1, hi - lo + 1);
    a.u.anim = Math.min(hi, lo + Math.floor(a.u.animT / frameDur));
    if (!a.hitDone && a.u.anim >= hitF) {
      a.hitDone = true;
      this._attackLands(a, adjacent, melee);
    }
    // A fired shot applies its damage the moment it ARRIVES (animT reaches the loose-frame + flight time),
    // regardless of how many follow-through frames the strip has — so a crossbow (looses at f2 but animates to
    // f10) doesn't stack the whole tail before the hit.
    if (a.onImpact && a.u.animT >= a.impactAt) {
      const onImpact = a.onImpact;
      a.onImpact = null;
      onImpact();
    }
    if (a.u.anim >= hi) {
      if (a.onImpact) {
        a.u.anim = hi;
      } // strip finished but the shot is still in the air — hold the pose & the turn
      else {
        a.u.attacking = false;
        a.u.anim = 0;
        const strikeDone = a.done;
        this.anim = null;
        // Retribution: the guarded unit's state 14 (sword of light, then the smite) comes before its counter; a charge
        // that hit guarded units is smitten by its target when it ends (Unit::doFinishMoving @0x774b2).
        const smiter = a.retribution || (a.charged && a.u._retribCount > 0 ? a.target : null);
        if (smiter && !a.retribution) a.u._smiteAfterCharge = true; // its state 14 may end in a counter (_countersAfter)
        const done = smiter ? () => this._retributionState14(a.u, smiter, strikeDone) : strikeDone;
        const over = a.u._overrunTo;
        a.u._overrunTo = null; // #10: the charge rides on along its lane
        const overEnd = over && over.path[over.path.length - 1];
        if (over && !a.u.dead && !this.unitAt(overEnd.tx, overEnd.ty)) {
          // noUndo: the charge already committed the turn (doAttack cleared _undoFrom); the overrun glide must
          // NOT re-record undo, or the player could take the whole charge+kill back and move again (bug).
          this.moveUnit(
            a.u,
            [{ tx: a.u.tx, ty: a.u.ty }, ...over.path],
            () => {
              done && done();
              this._emit();
            },
            true,
          );
        } else {
          done && done();
          this._emit();
        }
      }
    }
  }

  // The hit frame of an attack: heal, structure shot, cast, Lightning, or the strike itself (with war-engine
  // deviation, the charge ride-on, and a fired weapon's damage deferred to its impact).
  _attackLands(a, adjacent, melee) {
    const attacker = a.u;
    if (a.heal) this._landHeal(a);
    else if (a.structure) this._landStructureShot(a);
    else if (a.cast) {
      // a pure cast gesture (Retribution) — effect already applied, just the animation
    } else if (attacker.spell === "lightning" && attacker.T.canLightning && !adjacent) {
      // Lightning Storm (range 2+): bolts only — nothing flies, no explosion, no swing
      this.resolveDamage(attacker, a.target, {});
    } else this._landStrike(a, adjacent, melee);
  }

  // Priest Prayer — a healing gesture (the priest plays its cast frames, then mends the ally: the heal state, +51/256).
  _landHeal(a) {
    const target = a.target,
      tile = this.tile;
    const gained = this._healTick(target);
    target.flash = 0.14;
    // the Heal state's overlay (5017 #3) plays on the healed unit — renderOverlay @0x7641a draws it at Map+0x1c, which
    // Unit::heal (@0x6bfac) points at the target; nothing plays on the Priest
    this.spawnFx("spark", target.px + tile / 2, target.py + tile * 0.42, {});
    this.floaters.push({
      x: target.px + tile / 2,
      y: target.py,
      t: 0,
      life: 0.9,
      vy: -22,
      text: "+" + gained,
      heal: true,
    });
    this.audio.play("heal", 0.55);
  }

  // A shot at a building / wall: it flies, and Map::applyDamage runs when it LANDS (at once for a melee blow).
  _landStructureShot(a) {
    const attacker = a.u,
      tile = this.tile;
    const { tx: cellX, ty: cellY } = a.structure;
    const land = () => {
      this._structureBlow(attacker, cellX, cellY, 1); // a Catapult / Cannon shot razing it raises the dust ring
      this.spawnFx("dust", cellX * tile + tile / 2, cellY * tile + tile / 2, {});
    };
    const dur = this.fireProjectile(attacker, { px: cellX * tile, py: cellY * tile, tx: cellX, ty: cellY });
    if (dur) {
      a.onImpact = land;
      a.impactAt = a.u.animT + dur;
    } else {
      this.audio.play(this._meleeSfx(this._weaponAt(attacker, manhattan(attacker, a.structure))), 0.5);
      land();
    }
  }

  // The strike itself: where it lands (a war engine may deviate), whether it charges, and the damage — at once for
  // a melee blow or point-blank grapeshot, on IMPACT for a fired weapon.
  _landStrike(a, adjacent, melee) {
    const attacker = a.u;
    const target = attacker.T.mayDeviate && !a.counter ? this._deviatedTarget(a) : a.target;
    const wandJab = attacker.T.canLightning && adjacent; // a wizard point-blank uses the melee Wand, not a thrown spell
    // A counter by a unit with no weapon that reaches its foe — only after a Retribution smite, whose state-14 end does
    // not ask (a guarded Horse Bowman struck in melee): changeState(13) finds no weapon slot (0xff, @0x6b842) and takes
    // the bare melee case — the swing, the slash, a blow of 0.
    const bare = !!a.counter && !this.canCounter(attacker);
    const chargeDir = attacker.chargeDir;
    // A charge lands ONLY on the foe DIRECTLY AHEAD in the lane (atk + chargeDir) — diagonal-capable, but not
    // any Chebyshev-1 neighbour, or a charged unit would land the +30 on a foe it never galloped at.
    const charging = !a.counter && !a.defensive && this._wouldCharge(attacker, target);
    // The actual damage + follow-ups. For a THROWN/FIRED weapon this runs on IMPACT (deferred by a.hold),
    // so units don't take damage before the boulder lands and the turn doesn't advance early (issues #8/#9).
    const applyHit = () => {
      this.resolveDamage(attacker, target, {
        charge: charging,
        brace: !!a.brace,
        siege: attacker.T.kind === "siege",
        ...(bare ? { weapon: 0 } : null),
      });
      // Retribution: once its blow has played out the striker is smitten (before the target's counter); a charge
      // only counts the guarded units it hits and is smitten when it ends.
      if (charging) {
        a.charged = true;
        this._retributionCount(attacker, target);
      } else if (!a.counter && !a.defensive && this._retributionStrikes(attacker, target)) a.retribution = target;
      if (charging) {
        // (No effect on the rider: the original's Unit::charge only changes state and plays the charge sound.)
        // RIDE ON (_chargeRun): through every foot soldier the charge cuts down, hitting each further foe in the
        // lane, until one survives, a non-foot foe falls, or the movement runs out. Glided after the swing.
        const run = this._chargeRun(attacker, target, chargeDir);
        if (run.length) attacker._overrunTo = { path: run };
      }
      attacker.chargeDir = null;
    };
    const grapeshotPB = attacker.T.grapeshot && adjacent; // point-blank grapeshot is a muzzle SPRAY, not a lobbed shell — no arcing ball, no z_024 burst
    if (attacker.T.projectile && !melee && !wandJab && !grapeshotPB && !bare) {
      const dur = this.fireProjectile(attacker, target); // the shot flies; damage lands when it ARRIVES (loose-frame + flight),
      a.onImpact = applyHit;
      a.impactAt = a.u.animT + (dur || 0); // NOT after the whole anim tail (a crossbow's hit would lag)
    } else if (grapeshotPB) {
      this.audio.play("grapeshot", 0.55); // the point-blank Grapeshot blast (sound 9, the cannon's direct-fire state) — resolveDamage draws the z_028 spray + rakes the forward cone
      applyHit();
    } else {
      // the melee clip of the weapon struck with (changeState's weapon switch); the mark on the target is _applyHit's
      this.audio.play(this._meleeSfx(bare ? 0 : this._weaponAt(attacker, manhattan(attacker, target))), 0.5);
      applyHit();
    }
  }

  // WAR-ENGINE DEVIATION — REAL, decompiled (a.q.p(e()) at q_java 2365/1614): an arcing siege payload may
  // drift one tile onto a RANDOM 8-neighbour and land on whoever stands there — friend or foe — or on empty
  // ground. The chance comes from a.q.e(): long shots ~35% (catapult) / ~45% (cannon), ~10–15% up close, and
  // far higher against a fast (cavalry ~50–65%) or FLYING (100%) target. See _deviationPct. Returns the unit (or a
  // phantom ground tile) the shot really lands on; both rolls are logged for the 🐞 snapshot.
  _deviatedTarget(a) {
    const attacker = a.u,
      target = a.target,
      tile = this.tile;
    const pct = this._deviationPct(attacker, target);
    const roll = this.rng() * 100;
    const rollText = () =>
      `Deviation — ${attacker.type} (${attacker.tx},${attacker.ty}) → ${target.type || "ground"} (${target.tx},${target.ty}): ` +
      `rolled ${roll.toFixed(1)}, deviates below ${pct}`;
    if (pct > 0 && roll >= pct)
      this._roll(rollText() + " → ON TARGET", { what: "deviation", roll: +roll.toFixed(1), need: pct, hit: true });
    if (roll >= pct) return target;
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ],
      dirRoll = (this.rng() * 8) | 0,
      [dx, dy] = dirs[dirRoll];
    const nx = target.tx + dx,
      ny = target.ty + dy;
    this._roll(
      rollText() +
        ` → DEVIATED; direction rolled ${dirRoll} (0-7: E W S N SE NE SW NW) = ` +
        `${["E", "W", "S", "N", "SE", "NE", "SW", "NW"][dirRoll]} → lands on (${nx},${ny})` +
        (this.inBounds(nx, ny) ? "" : " off the map: hits nothing there"),
      { what: "deviation", roll: +roll.toFixed(1), need: pct, hit: false, dir: dirRoll, to: [nx, ny] },
    );
    // Unit::randomizeAttackLocation (iOS Ep2 @0x67532) has no bounds check: a shot pushed off the board lands off it.
    this.floaters.push({
      x: target.px + tile / 2,
      y: target.py - 6,
      t: 0,
      life: 1.0,
      vy: -14,
      text: "Deviated!",
      crit: true,
      heal: true,
    });
    return (
      this.unitAt(nx, ny) || {
        tx: nx,
        ty: ny,
        px: nx * tile,
        py: ny * tile,
        T: a.target.T,
        hp: 100,
        dead: false,
        _phantom: true,
      }
    );
  }

  // `autopilot`: the same clock drives your own units under the 🤖 Autopilot (ai/autopilot.js autopilotStep).
  _updateAiClock(dt, autopilot = false) {
    // SETTLE GATE: an AI unit's action isn't over when its swing ends — Lightning Storm bolts fall on deferred
    // timers, a Fireball's blast + flames and every impact are FX, shots are still in flight, and the camera may
    // still be panning. Hold the next unit (and the end of the phase) until all of that has resolved, and only then
    // run the post-action dwell, so each cast and its damage play out in full before the AI moves on or the turn
    // switches. Capped (4s) so a stray effect can never soft-lock the turn.
    const busy =
      (this._delayed && this._delayed.length) ||
      this.projectiles.length ||
      (this.fx && this.fx.length) ||
      (this.bolts && this.bolts.length) ||
      !!this.camTarget;
    this._aiBusyT = busy ? (this._aiBusyT || 0) + dt : 0;
    const settled = !busy || this._aiBusyT > 4;
    if (settled) this.aiDelay -= dt;
    if (
      settled &&
      this.aiDelay <= 0 &&
      !(this.bannerHold > 0) && // the whose-turn banner is still up — nothing moves behind it
      !this.battleEvent &&
      !(autopilot && (this._teleportLock || this.pendingSkip))
    ) {
      this._aiBusyT = 0;
      if (autopilot) this.ai.autopilotStep();
      else this.ai.aiStep();
    } // the original pauses the AI while a scripted line is on screen
  }
}
