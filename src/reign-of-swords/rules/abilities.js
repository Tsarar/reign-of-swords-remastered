/* ============================================================
   Reign of Swords — player-side Episode II abilities (Game mixin)

   The Ep2 unit abilities (Build / Repair / Quicksand / Conjure / Detonate) were first implemented on the AI side only
   (ai/ai.js), because every Ep2 unit was assumed to be an enemy. The player fields them too (the prologue, rewards,
   upgrades), so this mixin exposes the same mechanics as aimed skills in the shared in-battle skill row:
     Build     — Craftsmen, once per battle: tap adjacent open ground -> village (heal 20 / cover)   (Map::isBuildable)
     Repair    — Craftsmen: tap an adjacent damaged war engine -> +20 HP                             (Unit::canRepair)
     Quicksand — Dune Sirens: tap a neighbour -> the 3-tile row/column on that side becomes quicksand for 4 turns,
                 5 damage to anyone caught, dead-end for movement                                   (considerQuickSand)
     Conjure   — Conjurer: tap an adjacent free tile -> a Sapper or a Bodyguard (max 2 living children, leashed)
     Detonate  — Sapper: no aim; the sapper explodes (x1.25 weapon damage to every adjacent unit and wall)
     Absorb    — Bodyguard: no aim; sacrificed to lay a one-hit Absorb buff on its Conjurer (help 585; the binary
                 returns 0 damage for a Conjurer carrying the flag @0x384)
     Leashing  — conjured units farther than 8 (Manhattan) from their living Conjurer die when their side's turn
                 ends (help 592); a warning shows the moment one walks out of range.
   Casting is a full action (the unit is spent), exactly like the AI branches.
   ============================================================ */
import { manhattan } from "../util/util.js";
import { UNIT_TYPES } from "../data/game-data.js";

export const AbilityMethods = {
  // Skill-row entries for the selected player unit's Ep2 abilities (null if none apply right now).
  _abilitySkills(unit) {
    if (!unit || unit.team !== "blue" || unit.ally || unit.acted) return null;
    const out = [];
    // Build is once per battle (help 581, Unit+0x3a0): the button stays in the row after use, disabled and marked
    // "used", so it's clear why the Craftsman can't build again.
    if (unit.T.build)
      out.push({
        id: "build",
        name: "Build",
        icon: "skill_build",
        min: 1,
        max: 1,
        count: unit._built ? "0/1" : "1/1",
        countTitle: "builds left this battle",
        countNote: "used",
        disabled: !!unit._built,
        desc: unit._built
          ? "Already used — a Craftsman can raise only one village per battle."
          : "Raise a village on an adjacent open-ground tile (once per battle). Units standing in it heal 20 HP a turn and get cover.",
      });
    if (unit.T.repair && (this._repairTargetFor(unit) || this._repairStructureFor(unit)))
      out.push({
        id: "repair",
        name: "Repair",
        icon: "skill_repair",
        min: 1,
        max: 1,
        desc: "Mend an adjacent damaged war engine (+20 HP), or rebuild an adjacent damaged building or wall by one stage.",
      });
    if (unit.T.quicksand)
      out.push({
        id: "quicksand",
        name: "Quicksand",
        icon: "skill_quicksand",
        min: 1,
        max: 1,
        desc: "Tap a neighbouring tile: the three sand tiles on that side turn to quicksand for 4 rounds. A unit that steps in is stopped there and takes 5 damage. Fliers and Sirens are immune.",
      });
    if (unit.T.conjure) {
      const kids = this.units.filter((o) => !o.dead && o._conjuredBy === unit.id).length;
      // At the cap (help 584: "Only two conjured minions can be summoned at any one time") the buttons STAY in the row,
      // disabled and marked, instead of silently vanishing — so it's clear why the Conjurer can't summon.
      const full = kids >= 2,
        count = kids + "/2";
      const fullDesc =
        "Limit reached — this Conjurer already has two minions standing. One must fall or be sacrificed before it can conjure again.";
      out.push({
        id: "conjure_sapper",
        name: "Conjure Sapper",
        icon: "skill_conjure",
        min: 1,
        max: 1,
        count,
        disabled: full,
        desc: full
          ? fullDesc
          : "Summon a Sapper on an adjacent free tile (max 2 minions standing, leashed within 8 tiles; they vanish if the Conjurer falls).",
      });
      out.push({
        id: "conjure_bodyguard",
        name: "Conjure Bodyguard",
        icon: "skill_absorb",
        min: 1,
        max: 1,
        count,
        disabled: full,
        desc: full
          ? fullDesc
          : "Summon a Bodyguard on an adjacent free tile — it can be sacrificed (Absorb) to shield the Conjurer from one hit.",
      });
    }
    if (unit.type === "bodyguard" && unit._conjuredBy != null) {
      const conjurer = this.units.find((o) => !o.dead && o.id === unit._conjuredBy);
      if (conjurer && !conjurer._absorb)
        out.push({
          id: "absorb",
          name: "Absorb",
          icon: "skill_absorb",
          min: 0,
          max: 0,
          desc: "Sacrifice the Bodyguard: its Conjurer ignores 100% of the damage from the next attack (one hit, then the buff is spent).",
        });
    }
    if (unit.T.detonate)
      out.push({
        id: "detonate",
        name: "Detonate",
        icon: "skill_detonate",
        min: 0,
        max: 0,
        desc: "Sacrifice the Sapper: it explodes for weapon damage ×1.25 on every adjacent unit (friend or foe) and wall.",
      });
    return out.length ? out : null;
  },
  // Picking a skill in the row: arm (or disarm) its aim; Detonate has no target and fires at once.
  _abilityArm(id) {
    const sel = this.selected;
    if (!sel || sel.acted || this.phase !== "player" || this.anim) return false;
    const skills = this._abilitySkills(sel);
    if (!skills || !skills.some((x) => x.id === id && !x.disabled)) return false; // a maxed-out Conjure can't be armed
    if (id === "detonate") {
      this._castDetonate(sel);
      return true;
    }
    if (id === "absorb") {
      this._castAbsorb(sel);
      return true;
    }
    if (this.aimMode && this._abilityAim === id) {
      this._abilityAim = null;
      this.aimMode = false;
    } else {
      this._abilityAim = id;
      this.aimMode = true;
      // Quicksand: prepareAction aims at the map cursor — still on the Siren — so its default line shows at once
      if (id === "quicksand") this._qsAimAt = { id: sel.id, tx: sel.tx, ty: sel.ty };
    }
    this.audio.play("click", 0.4);
    this._emit();
    return true;
  },
  // A battlefield tap while an ability is armed. Returns true when the tap was consumed.
  _abilityClick(tx, ty) {
    const sel = this.selected,
      id = this._abilityAim;
    if (!sel || !id) return false;
    this.aimMode = false;
    this._abilityAim = null;
    if (sel.acted || !this.inBounds(tx, ty)) {
      this._emit();
      return true;
    }
    const dist = Math.abs(tx - sel.tx) + Math.abs(ty - sel.ty);
    if (id === "build" && dist === 1 && !sel._built && this._buildableTile(tx, ty)) {
      this._castBuild(sel, tx, ty);
      return true;
    }
    if (id === "repair") {
      const engine = this.unitAt(tx, ty);
      if (engine && engine.team === sel.team && engine.T.al === 4 && engine.hp < 100 && dist === 1) {
        this._castRepair(sel, engine);
        return true;
      }
      if (dist === 1 && this._structureRepairable(tx, ty)) {
        this._castRepairStructure(sel, tx, ty);
        return true;
      }
    }
    if (id === "quicksand" && dist <= 1) {
      // a tile beside the Siren, or the Siren itself (its default side) — Unit::setAttackTarget takes nothing farther
      if (this._castQuicksand(sel, tx, ty)) return true;
    }
    if (
      (id === "conjure_sapper" || id === "conjure_bodyguard") &&
      Math.max(Math.abs(tx - sel.tx), Math.abs(ty - sel.ty)) === 1 &&
      !this.unitAt(tx, ty) &&
      this.terrainAt(tx, ty).passable
    ) {
      this._castConjure(sel, id === "conjure_sapper" ? "sapper" : "bodyguard", tx, ty);
      return true;
    }
    this.notify("That is not a valid target for this skill.");
    this._emit();
    return true;
  },
  // Shared cast staging: the caster plays its attack/cast animation, then `done` applies the effect and ends its action.
  _castAnim(u, target, done, sound) {
    this.centerOn(u.tx, u.ty, true);
    this.audio.play(sound || "cast", 0.55);
    if (target && target.tx != null) u.face = Math.sign(target.tx - u.tx) || u.face || 1;
    this.anim = {
      type: "attack",
      u,
      target: target || { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
      t: 0,
      hitDone: false,
      cast: true,
      done: () => {
        done();
        u.acted = true;
        this.finishUnit ? this.finishUnit(u) : this._emit();
      },
    };
    u.attacking = true;
    u.anim = 0;
    u.animT = 0;
    this._emit();
  },
  _castBuild(u, tx, ty) {
    this._castAnim(
      u,
      { tx, ty, px: tx * this.tile, py: ty * this.tile },
      () => {
        this._buildVillage(tx, ty);
        u._built = true; // once per battle (help string 581)
        this.spawnFx("sand_puff", tx * this.tile + this.tile / 2, ty * this.tile + this.tile * 0.5, {}); // 5017 #12 churned ground
        this.spawnFx("debris", tx * this.tile + this.tile / 2, ty * this.tile + this.tile * 0.35, { delay: 0.15 }); // 5017 #13 splinters & rubble (the Craftsmen case)
        this.floaters.push({
          x: tx * this.tile + this.tile / 2,
          y: ty * this.tile,
          t: 0,
          life: 1.2,
          vy: -14,
          text: "Village built",
          crit: true,
          heal: true,
        });
      },
      "build",
    );
  },
  _castRepair(u, engine) {
    this._castAnim(
      u,
      engine,
      () => {
        const gained = this._healTick(engine); // the heal state: +51 of 256
        this.spawnFx("debris", engine.px + this.tile / 2, engine.py + this.tile * 0.35, {}); // 5017 #13 — the Craftsmen's mend (the craftsmen case of the heal state)
        this.floaters.push({
          x: engine.px + this.tile / 2,
          y: engine.py - 4,
          t: 0,
          life: 0.9,
          vy: -18,
          text: "+" + gained,
          heal: true,
        });
      },
      "build",
    );
  },
  // Map::applyRepair on a damaged structure: the building / wall steps back one stage (+20 structure HP).
  _castRepairStructure(u, tx, ty) {
    this._castAnim(
      u,
      { tx, ty, px: tx * this.tile, py: ty * this.tile },
      () => {
        this._repairStructure(tx, ty);
        this.spawnFx("debris", tx * this.tile + this.tile / 2, ty * this.tile + this.tile * 0.35, {}); // 5017 #13 — the Craftsmen's mend
        this.floaters.push({
          x: tx * this.tile + this.tile / 2,
          y: ty * this.tile,
          t: 0,
          life: 0.9,
          vy: -18,
          text: "Repaired",
          heal: true,
        });
      },
      "build",
    );
  },
  // The 3-cell line a Siren's Quicksand covers for target (tx, ty) — Unit::setAttackTarget (iOS Ep2 @0x71f84, unit
  // type 34): the target must be a tile beside it (manhattan 1) or the Siren itself; its own tile means its default
  // side, by its facing (Unit+0x14f, our `face` 1): facing right → the row below (above on the bottom edge), facing
  // left → the row above (below on the top edge). East / west → that column, north / south → that row. Null else.
  _quicksandLine(u, tx, ty) {
    let dx = tx - u.tx,
      dy = ty - u.ty;
    if (Math.abs(dx) + Math.abs(dy) > 1) return null;
    if (dx === 0 && dy === 0) {
      if (u.face === 1) dy = u.ty < this.rows - 1 ? 1 : -1;
      else dy = u.ty > 0 ? -1 : 1;
    }
    return dx !== 0
      ? [
          [u.tx + dx, u.ty - 1],
          [u.tx + dx, u.ty],
          [u.tx + dx, u.ty + 1],
        ]
      : [
          [u.tx - 1, u.ty + dy],
          [u.tx, u.ty + dy],
          [u.tx + 1, u.ty + dy],
        ];
  },
  // The Siren lays its 3-cell line (_quicksandLine) on the tapped side.
  _castQuicksand(u, tx, ty) {
    const cells = this._quicksandLine(u, tx, ty) || [];
    const layable = cells.filter(([x, y]) => this._canLayQuicksand(x, y));
    if (!layable.length) {
      this.notify("No sand there to turn — quicksand only forms on open desert ground.");
      this._emit();
      return false;
    }
    this._castAnim(u, { tx, ty, px: tx * this.tile, py: ty * this.tile }, () => {
      this._sandSkull(u);
      for (const [x, y] of layable) {
        this._layQuicksand(x, y);
        this.spawnFx("sand_puff", x * this.tile + this.tile / 2, y * this.tile + this.tile * 0.5, { delay: 0.25 }); // 5017 #12
      }
    });
    return true;
  },
  _castConjure(u, type, tx, ty) {
    if (!UNIT_TYPES[type]) return;
    this._castAnim(
      u,
      { tx, ty, px: tx * this.tile, py: ty * this.tile },
      () => {
        const minion = this._makeUnit(type, u.team, tx, ty, false);
        minion.group = u.group;
        minion._conjuredBy = u.id;
        minion.acted = true; // a fresh minion acts next turn
        this.spawnFx("sigil", tx * this.tile + this.tile / 2, ty * this.tile + this.tile * 0.45, {}); // 5017 #11 — the Conjure pentagram
      },
      "conjure",
    );
  },
  _castDetonate(u) {
    this._castAnim(
      u,
      null,
      () => {
        this._detonate(u);
      },
      "detonate",
    );
  },
  _castAbsorb(u) {
    const conjurer = this.units.find((o) => !o.dead && o.id === u._conjuredBy);
    if (!conjurer) return;
    this._castAnim(u, conjurer, () => {
      this._absorbSacrifice(u, conjurer);
    });
  },
  // The sacrifice itself (shared with the AI): the Bodyguard is unsummoned, the Conjurer gains the one-hit buff.
  _absorbSacrifice(guard, conjurer) {
    conjurer._absorb = true;
    this.audio.play("unsummon", 0.5);
    guard.hp = 0;
    guard.dead = true;
    guard.dieT = 0;
    this.spawnFx("unsummon", guard.px + this.tile / 2, guard.py + this.tile * 0.42, {}); // 5017 #10 — the minion is spent
    this.spawnFx("absorb_flash", conjurer.px + this.tile / 2, conjurer.py + this.tile * 0.4, { delay: 0.2 }); // 5017 #15
    this.floaters.push({
      x: conjurer.px + this.tile / 2,
      y: conjurer.py - 6,
      t: 0,
      life: 1.1,
      vy: -16,
      text: "Absorb",
      crit: true,
      heal: true,
    });
  },
  // The tiles an armed ability can be cast on right now — drawn by the renderer as the aim preview. For Quicksand
  // the preview follows the hovered side (the 3-cell line the cast would lay); with no hover, the 8 neighbours.
  _abilityCells(unit, id, hover) {
    const out = [],
      ORTHO = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ],
      AROUND = [...ORTHO, [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const push = (x, y) => {
      if (this.inBounds(x, y)) out.push({ x, y });
    };
    if (id === "build") {
      for (const [dx, dy] of ORTHO) {
        const x = unit.tx + dx,
          y = unit.ty + dy;
        if (this.inBounds(x, y) && this._buildableTile(x, y)) push(x, y);
      }
    } else if (id === "repair") {
      for (const [dx, dy] of ORTHO) {
        const x = unit.tx + dx,
          y = unit.ty + dy,
          e = this.unitAt(x, y);
        if ((e && !e.dead && e.team === unit.team && e.T.al === 4 && e.hp < 100) || this._structureRepairable(x, y))
          push(x, y);
      }
    } else if (id === "conjure_sapper" || id === "conjure_bodyguard") {
      for (const [dx, dy] of AROUND) {
        const x = unit.tx + dx,
          y = unit.ty + dy;
        if (this.inBounds(x, y) && !this.unitAt(x, y) && this.terrainAt(x, y).passable) push(x, y);
      }
    } else if (id === "quicksand") {
      // ONE line, as Unit::renderOverlay draws the Siren's target cells (Unit+0x54): the pointer over a tile beside
      // it (or over the Siren) re-aims — GameScreen::onTouchesMoving → setAttackTarget — and anywhere else the
      // last line stays; when armed it starts on the Siren's own tile, its default side.
      let aim = this._qsAimAt && this._qsAimAt.id === unit.id ? this._qsAimAt : null;
      if (hover && Math.abs(hover.tx - unit.tx) + Math.abs(hover.ty - unit.ty) <= 1)
        aim = this._qsAimAt = { id: unit.id, tx: hover.tx, ty: hover.ty };
      const line = this._quicksandLine(unit, aim ? aim.tx : unit.tx, aim ? aim.ty : unit.ty) || [];
      for (const [x, y] of line) if (this._canLayQuicksand(x, y)) push(x, y);
    }
    return out;
  },
  // Leashing (help 592): conjured units left farther than 8 from their living Conjurer die as their side's turn ends.
  _leashCheck(team) {
    for (const u of this.units) {
      if (u.dead || u.team !== team || u._conjuredBy == null) continue;
      const conjurer = this.units.find((o) => !o.dead && o.id === u._conjuredBy);
      if (!conjurer || manhattan(u, conjurer) <= 8) continue;
      u.hp = 0;
      u.dead = true;
      u.dieT = 0;
      this.spawnFx("unsummon", u.px + this.tile / 2, u.py + this.tile * 0.42, {}); // 5017 #10 purple flame
      this.audio.play("unsummon", 0.5); // + sound 54
      this.floaters.push({
        x: u.px + this.tile / 2,
        y: u.py - 4,
        t: 0,
        life: 1.2,
        vy: -16,
        text: "Leash broken",
        crit: true,
      });
    }
  },
  // The Siren's cast overlay (5017 #14): a column of sand rears up into a skull over the caster herself — the
  // original draws the strip as the casting unit's overlay (renderOverlay), not on the target tiles.
  _sandSkull(u) {
    this.spawnFx("sand_skull", u.px + this.tile / 2, u.py + this.tile * 0.15, { flip: u.face < 0 });
    this.audio.play("quicksand", 0.55); // Unit::_executeAction plays 57 after the cast state (@0x7f750)
  },
  // SPIRIT SHROUD — Unit::endTurn's curse pass (iOS Ep2 @0x7524c, Ep1 the same): when a unit ends its turn, it walks the
  // unit list for an ENEMY within 4 — if it is a Shaman (ability 28) itself it curses, otherwise the first enemy
  // Shaman in range curses — and stops there (@0x752a6 / @0x752b4: one curse per end of turn, list order).
  // Unit::curse (@0x6bf0a) acts ONCE: it raises Unit+0x45 (the active Shroud getSkill / getCourage read for the
  // friendly +15) and plays state 19 — the ancestral spear-warrior overlay (5017 #4/#5) — and sound 17. A Shaman that
  // ends its turn with no enemy within 4 lowers the flag, so the next contact plays it again. Nothing at turn start.
  _shroudEndTurn(u) {
    if (!u || u.dead) return;
    let near = false;
    for (const other of this.units) {
      if (other.dead || other.team === u.team || manhattan(other, u) > 4) continue;
      if (u.T.shroud) {
        this._shroudCurse(u);
        near = true;
        break;
      }
      if (other.T.shroud) {
        this._shroudCurse(other);
        break;
      }
    }
    if (u.T.shroud && !near) u._shroudOn = false;
  },
  _shroudCurse(shaman) {
    if (shaman._shroudOn) return;
    shaman._shroudOn = true;
    this.spawnFx("spirit", shaman.px + this.tile / 2, shaman.py - this.tile * 0.15, { flip: shaman.face < 0 });
    this.audio.play("shroud", 0.45); // Unit::curse → sound 17
  },
  _leashHint(u) {
    if (!u || u.dead || u.team !== "blue" || u._conjuredBy == null) return;
    const conjurer = this.units.find((o) => !o.dead && o.id === u._conjuredBy);
    if (conjurer && manhattan(u, conjurer) > 8) {
      this.notify(
        "Conjured units will die if they are not moved back inside leashing range (8) of their Conjurer before ending your turn.",
      );
      this._emit();
    }
  },
};
