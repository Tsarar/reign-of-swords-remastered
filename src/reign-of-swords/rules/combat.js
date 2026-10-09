/* ============================================================
   Reign of Swords — the combat resolution core.
   The damage MODEL (which weapon swings at a distance, its base vs the target's
   armour, the rating aura / formation cover / shield / retribution multipliers)
   and the ATTACK RESOLUTION path: melee pre-strike (Pike Wall / First / Last
   Strike), counter-attacks, war-engine deviation, the area spells (Lightning
   Storm / Ice Field / Fireball cross), hit application, healing, the Druid
   shapeshift + Wizard spell + Priest Retribution actions, and the projectile /
   particle / bolt effects. Ported from the decompiled damage code (La/q). Mixed
   onto Game.prototype in engine/engine.js — every method runs with `this` = the live
   Game and reaches sibling helpers via `this`. Only pure data/geometry are
   imported (util/util geometry, combat-data weapon tables, data/game-data rosters/FX).
   ============================================================ */

import { manhattan, cheb, clamp, key, strictMost, toHp256, wholeHp, shownDamage, healStep } from "../util/util.js";
import { WEAPON_DMG, WEAPON_RANGE, WEAPON_TAGS, BLAST_SHARE, spellStats } from "../data/combat-data.js";
import { UNIT_TYPES, FX_TYPES, meleeHitFx } from "../data/game-data.js";
import { isQuicksandTile, isBuildableType, structTrans, structPre, structArmor, moveRow, moveType } from "./terrain.js";

// Which weapon a unit swings at a target `dist` tiles away. A unit can carry two
// weapons (an[0]/an[1]); the game picks whichever's real range band contains the
// distance — e.g. archers use the bow at 2-6 and their Short Sword point-blank, a
// cannon fires Cannonball at 3-10 and Grapeshot at 1.
// The blast share of the i-th cell of weapon w's area (BLAST_SHARE), as a 0..1.25 factor; the last entry repeats.
function blastShare(weapon, cell = 0) {
  const shares = BLAST_SHARE[weapon];
  if (!shares) return 1;
  return shares[Math.min(cell, shares.length - 1)] / 100;
}
// Scale a hit by a blast share the way applyWeaponDamage does (@0x6b1a6): dmg256 × (pct·256/100) >> 8 — on the 256
// scale, so a small share can round a blow down to nothing.
const shared = (dmg, s) => (s === 1 || dmg <= 0 ? dmg : Math.max(1, Math.round((dmg * Math.floor(s * 256)) / 256)));
// Unit::isFireWeapon (iOS Ep2 @0x80214): a weapon tagged Fire Arrows (9) or 13, or the Fireball (25) — the weapon
// actually used, so an Archer's Short Sword or a Wizard's Blade is no fire weapon.
const isFireWeapon = (w) => w === 25 || (WEAPON_TAGS[w] || []).some((t) => t === 9 || t === 13);

// The weapons Unit::startAreaAttack lays out (rock, boulder, pitch, cannonball, grapeshot, the three spells, the piercing
// bolt, shock) — their hits are area cells, not a state-2 strike.
const AREA_WEAPONS = new Set([20, 21, 22, 23, 24, 25, 26, 27, 28, 34]);
// every weapon that is not swung in melee: the bows and the Musket, the area weapons, the Hammer Throw
const RANGED_WEAPONS = new Set([16, 17, 18, 19, 29, ...AREA_WEAPONS]);
// The Lightning Storm's switch tables (see _resolveLightning): index → code, and code → the cell offset it strikes.
const LIGHTNING_CODE = [0, 9, 1, 5, 8, 4, 10, 2, 6];
const LIGHTNING_CELL = {
  0: [0, 0],
  9: [-1, -1],
  1: [0, -1],
  5: [1, -1],
  8: [-1, 0],
  4: [1, 0],
  10: [-1, 1],
  2: [0, 1],
  6: [1, 1],
};

function weaponAt(u, dist) {
  if (u.T.canLightning) {
    if (dist === 1 && u.T.weapon2) return u.T.weapon2; // point-blank → the Wand (no spell reaches range 1), whatever spell is selected
    if (u.spell === "lightning") return 26;
    if (u.spell === "ice") return 27; // Lightning / Ice Field (weapon 27: onTick @0x78f44 slows on it) — area magic
  }
  const primary = u.T.weapon || 3,
    secondary = u.T.weapon2;
  if (secondary && dist != null) {
    const primaryRange = WEAPON_RANGE[primary] || [1, 1],
      secondaryRange = WEAPON_RANGE[secondary] || [1, 1];
    const inPrimary = dist >= primaryRange[0] && dist <= primaryRange[1];
    if (!inPrimary) {
      if (dist >= secondaryRange[0] && dist <= secondaryRange[1]) return secondary;
      if (dist < primaryRange[0]) return secondary;
    }
  }
  return primary;
}
// The REAL type-advantage: base damage of the attacker's weapon vs the defender's
// armour, straight out of the extracted weapon×armour table (bS[weapon-1][armour]).
function weaponBase(defender, weapon) {
  const row = WEAPON_DMG[weapon];
  if (!row) return 20;
  const base = row[defender.T.armour == null ? 0 : defender.T.armour];
  // Unit::calculateAttackDamage (iOS Ep2 @0x6af20) reads the cell as it is: a 0 is NO damage — the Ballistae's Piercing
  // Bolt and Shock against Feathered Hide (Griffons, Great Eagles) — never the no-armour value.
  return base == null ? row[0] || 10 : base;
}
// MELEE HIT SOUND — the game's own per-weapon split (decompiled La/q `switch h(aW)`, NOT the visual set above):
// Spear(3), Pike(12), Scythe(14) cycle one 3-clip set (snd_020/021/022 = melee_pole*); every other melee weapon
// cycles a 2-clip set (snd_023/024 = melee_blade*).
const POLE_HIT_WEAPONS = new Set([3, 12, 14]);
const MELEE_POLE = ["melee_pole1", "melee_pole2", "melee_pole3"];
const MELEE_BLADE = ["melee_blade1", "melee_blade2"];

export class CombatMethods {
  // A foot soldier (melee / spear / axe / ranged kind) — the units a charge rides on through.
  _isFoot(x) {
    return !!(x && ["melee", "spear", "axe", "ranged"].includes(x.T.kind));
  }
  // ===== EPISODE II — QUICKSAND (Dune Sirens, iOS unit type 34) ============================
  // Decoded byte-for-byte from the Ep2 binary. A tile holds a countdown byte; a non-immune unit standing on
  // quicksand loses 12 raw HP per turn (applyDamageRaw(u,#0xc) — ignores armour); the tile counts down and
  // clears after 4 turns (setQuickSandTile val = Mission.0xd0[=2] << 1). Immune: fliers (al==0: Griffon type 9,
  // Great Eagle type 26) and the Sirens themselves. Quicksand only forms on getTileType ∈ {2,3,18,22,26,27}
  // (terrain-types.json — the real per-tile type legend). Enemy-only; the Siren lays a 3-tile line (see ai/ai).
  _quicksandImmune(u) {
    return u.T.al === 0 || u.type === "dunesirens";
  }
  _quicksandAt(tx, ty) {
    return this.quicksand ? this.quicksand.get(tx + "," + ty) || 0 : 0;
  }
  // EPISODE II: no charge out of quicksand — createChargeTargetList (iOS Ep2 @0x70bd2) first reads the quicksand
  // countdown (Map+0x50) at the rider's own tile and lists no target while it runs. (Episode I has no quicksand.)
  _chargeBogged(u, tx, ty) {
    return this._quicksandAt(tx, ty) > 0;
  }
  _canLayQuicksand(tx, ty) {
    return this.inBounds(tx, ty) && this._quicksandAt(tx, ty) <= 0 && isQuicksandTile(this.tileAt(tx, ty));
  }
  _layQuicksand(tx, ty) {
    if (!this.quicksand) this.quicksand = new Map();
    if (this._canLayQuicksand(tx, ty)) {
      this.quicksand.set(tx + "," + ty, 4);
      return true;
    } // 4-turn countdown
    return false;
  }
  // Map::updateQuickSandTurn (iOS Ep2 @0x3ae34): once per round every quicksand countdown ticks down (a tile laid at
  // 4 = Mission+0xd0 << 1 lasts 4 rounds). It deals NO damage — quicksand hurts only a unit that walks into it
  // (_quicksandEnter); a unit already standing in it (caught by the cast) is not hurt and walks out freely.
  _quicksandTurn() {
    if (!this.quicksand || !this.quicksand.size) return;
    for (const [k, turnsLeft] of [...this.quicksand]) {
      if (turnsLeft <= 1) this.quicksand.delete(k);
      else this.quicksand.set(k, turnsLeft - 1);
    }
  }
  // Unit::applyQuicksandDamage (iOS Ep2 @0x662cc), run by Unit::onTick each time a moving unit arrives on a tile: on
  // quicksand a non-immune unit (not Dune Sirens 34, Griffon Riders 9, Great Eagles 26) stops there (computeReach makes
  // the tile a dead end) and takes 12 raw damage of 256 (4.7 HP), armour ignored. The tile a move STARTS on is
  // never checked, so a unit standing in quicksand can walk out.
  _quicksandEnter(u) {
    if (!u || u.dead || this._quicksandImmune(u) || this._quicksandAt(u.tx, u.ty) <= 0) return;
    this._commitMove(u); // caught in quicksand: no undo
    const before = u.hp,
      loss = wholeHp(12); // 12 of 256: 5 HP
    u.hp = clamp(u.hp - loss, 0, 100);
    u.flash = 0.2;
    // applyQuicksandDamage sets Unit+0x3b9 and Unit+0x2f8 = 5017 #30; the moving unit's state draws that slash over
    // it with the read-out (renderOverlay @0x75ac6)
    this.spawnFx("slash", u.px + this.tile / 2, u.py + this.tile * 0.42, {});
    this.floaters.push({
      x: u.px + this.tile / 2,
      y: u.py,
      t: 0,
      life: 0.8,
      vy: -22,
      text: Math.min(loss, before),
    });
    if (u.hp <= 0) {
      u.dead = true;
      u.dieT = 0;
    }
  }

  // ===== EPISODE II — BUILD / REPAIR (Craftsmen, iOS unit type 29) =========================
  // Build: turn an empty open-ground tile (iOS getTileType ∈ {2,3,18,26}, no quicksand, no unit — Map::isBuildable)
  // into a village (heals + light cover). Repair: restore HP to an adjacent damaged War Engine (al==4, iOS
  // Unit::canRepair). Both are enemy-only in Ep2 (all new units are enemy), so they run in the AI (ai/ai).
  _buildableTile(tx, ty) {
    return (
      this.inBounds(tx, ty) &&
      !this.unitAt(tx, ty) &&
      this._quicksandAt(tx, ty) <= 0 &&
      !(this.builtVillages && this.builtVillages.has(tx + "," + ty)) &&
      isBuildableType(this.tileAt(tx, ty))
    );
  }
  _buildVillage(tx, ty) {
    if (!this.builtVillages) this.builtVillages = new Map();
    if (!this._buildableTile(tx, ty)) return false;
    // Map::applyBuildVillage REWRITES the cell (tileset + sub-index) with the village tile, so the new hamlet is an
    // ordinary village tile from then on: it heals, gives cover, and burns / is repaired like any house. The cell's
    // structure HP is left as it was (applyBuildVillage never touches map+0xac). builtVillages just records the build.
    const villageTile = this._villageTileFor(this.tileAt(tx, ty));
    this.builtVillages.set(tx + "," + ty, villageTile);
    this.tiles[ty * this.cols + tx] = villageTile;
    this.razed.delete(tx + "," + ty);
    // DELIBERATE DEVIATION (user decision): the original leaves the cell's structure HP as it was, so a village raised on
    // ground fought over earlier (every hit on a unit standing there wears the cell down) was born with ~0 HP and fell
    // two stages to two blows. Here a new village starts whole.
    this.structHp.delete(tx + "," + ty);
    return true;
  }
  // Map::applyBuildVillage (iOS Ep2 @0x3f744) REPLACES the cell with a village tile picked from the ground's own
  // tileset (the cell's tileset t = map+0x98, sub-index v = map+0xa0): t3 -> 249 if v > 51 else 185; t4 -> 249 if
  // v-7 in 0..27 else 185; t6 -> 249 if v <= 3 else 3; any other tileset -> 3. 3 = wooden house on grass, 185 = desert
  // house on sand, 249 = desert house on paving. (Not Ep1's tile 2: in the Ep2 set that is a BURNT house on GRASS.)
  _villageTileFor(tileVal) {
    const START = [0, 63, 124, 125, 179, 235, 247, 260]; // Ep2 tileset ranges (record 5010 TerrainInfo, global sub-tile ids)
    let kind = 0;
    while (kind < 7 && tileVal >= START[kind + 1]) kind++;
    const offset = tileVal - START[kind];
    if (kind === 3) return offset > 51 ? 249 : 185;
    if (kind === 4) return offset - 7 >= 0 && offset - 7 <= 27 ? 249 : 185;
    if (kind === 6) return offset <= 3 ? 249 : 3;
    return 3;
  }
  // A damaged friendly War Engine (al==4) adjacent to `u` that a Craftsman could repair.
  _repairTargetFor(u) {
    for (const other of this.units) {
      if (other.dead || other === u || other.team !== u.team) continue;
      if (other.T.al === 4 && other.hp < 100 && manhattan(other, u) === 1) return other;
    }
    return null;
  }
  // EPISODE II — Detonate (Sapper, help string 764): "Sappers can be sacrificed using Detonate, which explodes
  // the Sapper and causes damage to all adjacent enemies and structures." The Sapper is consumed.
  _detonate(sapper) {
    const centerX = sapper.px + this.tile / 2,
      centerY = sapper.py + this.tile * 0.42;
    this.spawnFx("explosion", centerX, centerY, {});
    this._burst(centerX, centerY, { big: true, colors: ["#d89a3e", "#a5641e", "#5f3c14", "#e6c070"] });
    for (const e of this.units) {
      // ALL adjacent units take the blast (help 586: friend AND foe)
      if (e.dead || e === sapper) continue;
      if (manhattan(e, sapper) === 1)
        this._applyHit(e, sapper, shared(this.computeDamage(sapper, e), 1.25), true, false); // weapon damage ×1.25
    }
    // …and adjacent structures. The onTick Detonate branch prices the structure blow with weapon-table entry 0x4c/4 = 19,
    // i.e. weapon 20 (Rock, 25 vs wood & stone) — the Sapper's own Spear does nothing to buildings.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      this._areaStructureHit(sapper, sapper.tx + dx, sapper.ty + dy, blastShare("detonate"), 20); // 125% (startAreaAttack(0))
    sapper.hp = 0;
    sapper.dead = true;
    sapper.dieT = 0; // the Sapper is sacrificed
  }
  // DETONATE — the Sapper's separate area action (iOS Ep2): onTick runs it as startAreaAttack(0) for a Detonate unit
  // (@0x78162) and the Sapper is removed afterwards (@0x79206). Its ordinary attack stays a Spear blow; the AI decides
  // when to blow up in aiConsiderAction state 30 (see _sapperPlan).
  _sapperStrike(sapper, done) {
    sapper.attackedTurn = true;
    this.targets = null;
    this.audio.play("detonate", 0.6);
    this.anim = {
      type: "attack",
      u: sapper,
      target: { tx: sapper.tx, ty: sapper.ty, px: sapper.px, py: sapper.py },
      t: 0,
      hitDone: false,
      cast: true,
      done: () => {
        this._detonate(sapper);
        done();
      },
    };
    sapper.attacking = true;
    sapper.anim = 0;
    sapper.animT = 0;
    this._emit();
  }

  // ---- THE DAMAGE MODEL — Unit::calculateAttackDamage (iOS Ep2 @0x6af20, Ep1 @0x59858) ---------------------------
  // HP runs on a 256 scale (100 HP = 256) and the blow is an integer chain, every step truncated:
  //   base  = the weapon×armour cell (data/combat-data.js), ×2 for a fire weapon (isFireWeapon) against a Flammable
  //           target, +30 while charging (Unit+0xb4) [Ep1: +30 more for a braced Pike Wall's first strike];
  //   cover = the tile's defence (getTileDefense: 100 in the open, less in cover) − 10 per adjacent Formation ally of a
  //           Formation defender — except against Boulder / Cannonball, which win back half the cover on a tile ≤ 80;
  //   skill = getSkill: the attack rating + auras (+15 rally / −15 shroud / +15 objective) + the melee flank bonus;
  //   dmg   = ((cover·256/100 · base·256/100) >> 8) · ((skill·256/100 · attacker HP256) >> 8) >> 8,
  // then ÷2 at range (> 1) on a Shielded unit, ×8/10 up close on Siege Armour, never below 0: a blow can do nothing.
  // No random variance. A Conjurer behind its Absorb ward takes 0 (@0x6af38). `_damage256` is that integer;
  // computeDamage gives it in HP (×100/256). `opts.weapon` names the weapon of an area cell (applyWeaponDamage's
  // explicit weapon) instead of the one the attacker's distance picks.
  computeDamage(attacker, defender, opts = {}) {
    return wholeHp(this._damage256(attacker, defender, opts)); // whole HP — see util (DELIBERATE DEVIATION)
  }
  _damage256(attacker, defender, opts = {}) {
    if (defender._absorb) return 0;
    const dist = manhattan(attacker, defender);
    const weapon = opts.weapon != null ? opts.weapon : weaponAt(attacker, dist);
    if (weapon === 0) return 0; // no weapon slot (0xff): calculateAttackDamage @0x6af68 deals nothing
    const siegeShot = weapon === 21 || weapon === 23;
    if (siegeShot && defender.T.al === 0) return 0; // Boulder / Cannonball cannot touch a flier (class 0)
    let base = weaponBase(defender, weapon);
    if (isFireWeapon(weapon) && defender.T.flammable) base *= 2;
    if (opts.charge) base += 30; // the rider's charging flag
    if (opts.brace) base += 30; // Ep1: a braced Pike Wall's first strike
    if (base <= 0) return 0;
    const tileDef = Math.round(100 - (this.terrainAt(defender.tx, defender.ty).defBonus || 0) * 100);
    let cover = tileDef - (defender.T.formation && !siegeShot ? 10 * this.formationAllies(defender) : 0);
    if (siegeShot && tileDef <= 80) cover += Math.trunc((100 - tileDef) / 2);
    let rating = (attacker.T.rf || 75) + this.ratingAura(attacker);
    if (dist === 1) rating += this._flankBonus(attacker, defender); // calcFlankBonuses: +30 opposite, +15 on a side
    const skill = (Math.trunc((rating * 256) / 100) * toHp256(clamp(attacker.hp, 0, 100))) >> 8;
    let dmg = (Math.trunc((cover * 256) / 100) * Math.trunc((base * 256) / 100)) >> 8;
    dmg = (dmg * skill) >> 8;
    if (dist > 1) {
      if (this._shielded(defender)) dmg = Math.trunc(dmg / 2); // Map::isUnitShielded — a Priest's Shield
    } else if (this._siegeArmored(defender)) dmg = Math.trunc((dmg * 8) / 10); // Map::isSiegedAmor (Ep2)
    return Math.max(0, dmg);
  }
  // PRAYER MARKS — the Shield prayer and Unit::retribution push the casting Priest's TILE on a per-group list on the
  // map (Map+0x130 shields, +0x158 retributions); GameScreen::startTurn (iOS Ep2 @0x27a66 / @0x27a7a) empties that
  // group's lists when its turn comes round again. Map::isUnitShielded / isUnitRetributioned only measure the distance
  // (Manhattan ≤ 2) from a unit to a mark of its own team — so a unit that steps in later is covered. A Priest that
  // falls takes its marks with it: GameScreen::onEvent's unit-died event (21; iOS Ep2 @0x30310, Ep1 @0x27876, the
  // Android port's a.g event handler alike) deletes the Shield and Retribution positions on a slain Priest's tile.
  _prayerMark(kind, caster) {
    this.prayerMarks.push({
      kind,
      team: caster.team,
      ally: !!caster.ally,
      group: caster.group,
      tx: caster.tx,
      ty: caster.ty,
      caster: caster.id,
    });
  }
  // The start of an army's turn: its Priests' marks lapse (`starting(mark)` says whether a mark is that army's).
  _clearPrayerMarks(starting) {
    if (this.prayerMarks && this.prayerMarks.length) this.prayerMarks = this.prayerMarks.filter((m) => !starting(m));
  }
  _prayerCovers(kind, u) {
    return (this.prayerMarks || []).some(
      (m) => m.kind === kind && m.team === u.team && manhattan(m, u) <= 2 && !this._markCasterFell(m),
    );
  }
  _markCasterFell(m) {
    const caster = this.units.find((c) => c.id === m.caster);
    return !caster || caster.dead;
  }
  _shielded(u) {
    return this._prayerCovers("shield", u);
  }
  _retributioned(u) {
    return this._prayerCovers("retribution", u);
  }
  _prayed(u, kind) {
    return (this.prayerMarks || []).some((m) => m.kind === kind && m.caster === u.id);
  }
  // Whose turn it is: the units that may strike on their own turn now (a counter, an ambush or a first strike in
  // defence happens on the other side's turn).
  _onOwnTurn(u) {
    if (this.phase === "player") return u.team === "blue" && !u.ally;
    if (this.phase === "ally") return u.team === "blue" && !!u.ally;
    if (this.phase === "enemy") return u.team === "red";
    return false;
  }
  // RETRIBUTION — Unit::onTick (iOS Ep2 @0x7790c, Ep1 @0x62690): when a unit's own MELEE blow (the end of state 2)
  // lands on its own side's turn on a unit guarded by a Retribution of that unit's side, the target goes to state 14
  // before it counters. A shot never: changeState(2) sends a bow, musket or hammer straight on to its projectile state
  // 11 (@0x6b8c4 / @0x6b8ea / @0x6b942), whose landing (@0x6b52c) applies the damage with no Retribution test, and an
  // area weapon goes through state 10 — so the original's help is exact: Retribution strengthens the COUNTER attacks
  // of nearby allies. State 14's blow (@0x77846) is a SMITE that ignores
  // armour: applyDamageRaw(25) — 25 of 256, ~10 HP — or, when the striker carries a count (Unit+0xc8, below),
  // 25·count + 25 (25·count if the target itself fell). State 14 draws the sword of light (_retributionState14), no sound;
  // the damage reads as applyDamageRaw's read-out ⌈(HP before − HP after)·100/256⌉ — "10". Then the target counters by
  // state 14's rule (@0x77a84, _countersAfter). After a first strike in defence the same smite follows the attacker's
  // blow (state-13 end, @0x77b8e), with no counter after it.
  // A CHARGE counts instead: every guarded unit the rider hits along its lane adds 1 to its count (@0x78828), and when
  // the charge ends (Unit::doFinishMoving @0x774b2) its target smites it with that count.
  _retributionStrikes(attacker, target) {
    if (!target || target._phantom || target.team === attacker.team || !this._onOwnTurn(attacker)) return false;
    if (RANGED_WEAPONS.has(weaponAt(attacker, manhattan(attacker, target)))) return false; // shots and area attacks
    return this._retributioned(target);
  }
  // Does `defender` strike back once `attacker`'s blow has landed? Ordinarily (Unit::onTick @0x77972) a surviving unit
  // counters a blow from next to it, with a weapon that reaches 1 (canCounter), never a war engine. After a Retribution
  // smite the counter follows state 14's end instead (@0x77a84): both alive, not a war engine, the striker had the
  // initiative (Unit::isFirstStrike(striker, defender) — a defender that lands first either struck already or, at
  // range, could not reach: no counter), and the blow came from next to it or the defender has First Strike itself.
  // A charge ends with no exchange and a first strike in defence replaces the counter (noCounter) — but the smite at a
  // charge's end (doFinishMoving → state 14) runs that same end, so the guarded target may then counter the rider.
  _countersAfter(attacker, defender, noCounter) {
    const smitten = attacker._smittenBy === defender,
      chargeSmite = smitten && !!attacker._smiteAfterCharge;
    attacker._smittenBy = null;
    attacker._smiteAfterCharge = false;
    if ((noCounter && !chargeSmite) || attacker.dead || defender.dead) return false;
    const adjacent = manhattan(attacker, defender) === 1;
    if (smitten)
      return (
        defender.T.al !== 4 && this._landsFirst(attacker, defender) && (adjacent || this._hasFirstStrike(defender))
      );
    return adjacent && this.canCounter(defender);
  }
  // Ability 1 as Unit::_hasAbility answers it (@0x666e4): First Strike, or a braced Pike Wall (Unit+0x10f).
  _hasFirstStrike(u) {
    return !!u.T.firstStrike || !!u.walled;
  }
  // Unit::isFirstStrike(a, b) (iOS Ep2 @0x66fb4) as a plain order — true when `a` lands before `b`, with no range test:
  // Pikemen land first on cavalry (bar the Hero) and on Griffons; cavalry (bar the Hero) lands after Pikemen; then `b`
  // lands first when it has First Strike and `a` has not, or when `a` has Last Strike and `b` has not; but a First /
  // Last Strike unit always lands first on a Cannon or Ballistae.
  _landsFirst(a, b) {
    if (a.type === "pikemen" && ((b.T.al === 3 && b.type !== "king") || b.type === "griffon")) return true;
    if ((a.T.al === 3 || b.type === "griffon") && a.type !== "king" && b.type === "pikemen") return false;
    let first = !(!this._hasFirstStrike(a) && this._hasFirstStrike(b));
    if (a.T.lastStrike && !b.T.lastStrike) first = false;
    if ((this._hasFirstStrike(a) || a.T.lastStrike) && (b.type === "cannon" || b.type === "ballistae")) first = true;
    return first;
  }
  // The prayer's look: the angel (5017 #9) over the Priest, five tiles across, its centre a tile above the Priest's.
  _retributionAngel(priest) {
    this.spawnFx("angel", priest.px + this.tile / 2, priest.py - this.tile / 2, {});
  }
  // State 14 as the screen plays it: the sword of light (5017 #8) comes down on `victim` from the tile above, 200 ms
  // in, for 550 ms; the smite lands when the state's 750 ms are up, and only then does the guarded unit counter (`then`).
  _retributionState14(victim, avenger, then) {
    if (victim.dead) return then && then();
    this.spawnFx("holysword", victim.px + this.tile * 0.5625, victim.py - this.tile * 0.1, { delay: 0.2 });
    this.anim = {
      type: "pan",
      t: 0,
      min: 0.75,
      done: () => {
        this._retributionSmite(victim, avenger);
        if (then) then();
      },
    };
  }
  _retributionCount(rider, victim) {
    if (victim && !victim._phantom && this._retributioned(victim)) rider._retribCount = (rider._retribCount || 0) + 1;
  }
  _retributionSmite(victim, avenger) {
    const count = victim._retribCount || 0;
    victim._retribCount = 0;
    if (victim.dead) return;
    victim._smittenBy = avenger;
    const raw = count > 0 ? 25 * count + (avenger && !avenger.dead ? 25 : 0) : 25;
    // applyDamageRaw: a Conjurer's Absorb ward takes this blow too (and is spent)
    if (victim._absorb) {
      victim._absorb = false;
      this.floaters.push({
        x: victim.px + this.tile / 2,
        y: victim.py - 4,
        t: 0,
        life: 0.9,
        vy: -18,
        text: "Absorbed",
        heal: true,
      });
      return;
    }
    if (avenger) this.ai._glHit(victim, avenger);
    const before = victim.hp,
      loss = wholeHp(raw); // 25 of 256: 10 HP; a charge's 50 / 75 …: 20 / 29 …
    victim.hp = clamp(victim.hp - loss, 0, 100);
    victim.flash = 0.16;
    this.floaters.push({
      x: victim.px + this.tile / 2,
      y: victim.py - 6,
      t: 0,
      life: 1.1,
      vy: -16,
      text: Math.min(loss, before),
    });
    if (victim.hp <= 0) {
      victim.dead = true;
      victim.dieT = 0;
      if (victim.T.conjure) this._killConjuredChildren(victim);
    }
  }
  // Boulder (21) and Cannonball (23) cannot touch a FLYING unit (class 0): calculateAttackDamage returns 0 outright.
  // And a Trebuchet or Cannon may not even target a Griffon or Great Eagle — Unit::isViableTarget (iOS Ep2 @0x661a4),
  // createAttackList and createSortedTargetList skip them by the attacker's TYPE, so the cannon's Grapeshot too.
  _weaponUselessVs(u, target, dist) {
    if ((u.type === "trebuchet" || u.type === "cannon") && (target.type === "griffon" || target.type === "greateagle"))
      return true;
    const weapon = weaponAt(u, dist);
    return (weapon === 21 || weapon === 23) && target.T.al === 0;
  }
  // Flank / pincer (Unit::calcFlankBonuses @0x6ac50, called by getSkill for a MELEE blow only): the attack's axis is
  // attacker -> target (east-west or north-south); every OTHER friendly unit standing next to the target adds +30 to
  // the attack rating if it is on that same axis (directly opposite — the target caught between) and +15 if it is on
  // a perpendicular side (a flank). This is the help's "flank and surround the enemy units to deliver more damage".
  _flankBonus(attacker, defender) {
    const eastWest = attacker.ty === defender.ty; // the blow comes in along the east-west axis
    let bonus = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const other = this.unitAt(defender.tx + dx, defender.ty + dy);
      if (!other || other.dead || other === attacker || other.team !== attacker.team) continue;
      bonus += (eastWest ? dx !== 0 : dy !== 0) ? 30 : 15;
    }
    return bonus;
  }
  // EPISODE II — Siege Armor (iOS Map::isSiegedAmor): a Ballistae (type 30) always has it; any other War Engine
  // (al==4) gains it while a friendly Ballistae stands within the 5×5 square around it (Chebyshev 2 — the dx,dy −2..2 loops).
  _siegeArmored(u) {
    if (u.T.siegeArmor) return true;
    if (!u.T.warEngine) return false;
    for (const other of this.units) {
      if (!other.dead && other !== u && other.team === u.team && other.T.siegeArmor && cheb(other, u) <= 2) return true;
    }
    return false;
  }
  formationAllies(u) {
    let count = 0;
    for (const other of this.units) {
      if (!other.dead && other !== u && other.team === u.team && other.T.formation && manhattan(other, u) === 1)
        count++;
    }
    return count;
  }
  // Unit::getSkill (iOS Ep2 @0x6adb0) — the attack-rating aura, two flags, each counted ONCE (nothing stacks):
  // RALLIED +15 = a same-side Battle Standard (ability 11, the Hero) within 4 — never its own, and never for the Hero
  // (type 8) — OR a same-side Shaman whose Spirit Shroud is ACTIVE (Unit+0x45, raised by Unit::curse) within 4, the
  // Shaman itself included; SHROUDED −15 = any enemy Spirit Shroud (ability 28) within 4. +15 more for the objective
  // holder (Mission+0x260). Unit::getCourage (@0x66e90) reads the same two flags, but without the Hero exclusion
  // (`courage` = true): it only skips the unit's own Standard, so a Hero beside another Hero is steadied.
  _auraFlags(u, courage = false) {
    let rally = false,
      shroud = false;
    for (const other of this.units) {
      if (other.dead || manhattan(other, u) > 4) continue;
      if (other.team === u.team) {
        if (other !== u && (courage || u.type !== "king") && other.T.standard) rally = true;
        else if (other.T.shroud && other._shroudOn) rally = true;
      } else if (other.T.shroud) shroud = true;
    }
    return { rally, shroud };
  }
  ratingAura(u) {
    const { rally, shroud } = this._auraFlags(u);
    let delta = (rally ? 15 : 0) - (shroud ? 15 : 0);
    if (this._captureHolder() === u.team) delta += 15; // holding the objective (Mission+0x260 == team)
    return delta;
  }
  // GameScreen::updateCapturePoints: the side owning STRICTLY the most capture areas holds the objective (a tie, or
  // no area owned → nobody). getSkill / getCourage give that side +15. A map whose objective tiles are not the
  // record's areas (a hand-made tutorial objective) counts the units standing on its tiles instead.
  _captureHolder() {
    if (this.captureAreas && this.captureAreas.length) {
      const tally = {};
      for (const a of this.captureAreas) if (a.owner) tally[a.owner] = (tally[a.owner] || 0) + 1;
      return strictMost(tally);
    }
    if (!this.objectives || !this.objectives.length) return null;
    const tally = {};
    for (const obj of this.objectives) {
      const u = this.unitAt(obj.tx, obj.ty);
      if (u && !u.dead) tally[u.team] = (tally[u.team] || 0) + 1;
    }
    const teams = Object.keys(tally);
    if (!teams.length) return null;
    teams.sort((a, b) => tally[b] - tally[a]);
    return teams.length === 1 || tally[teams[0]] > tally[teams[1]] ? teams[0] : null;
  }
  // The unit's ACTIVE status effects right now — each with the 067 icon and a description, for the inspect card.
  _statusesOf(u) {
    const out = [];
    const quicksand = this._quicksandAt(u.tx, u.ty);
    if (quicksand > 0)
      out.push(
        this._quicksandImmune(u)
          ? {
              icon: "skill_quicksand",
              name: "Immune to quicksand",
              desc: "It stands in quicksand but is not held or hurt by it (fliers and Dune Sirens).",
            }
          : {
              icon: "skill_quicksand",
              name: "In quicksand",
              desc: "Stepping into quicksand stopped it here (and cost 5 HP); it can walk out on its turn. The quicksand lasts {n} more round(s).",
              vars: { n: quicksand },
            },
      );
    if (u.slowed)
      out.push({
        icon: "status_slowed",
        name: "Slowed",
        desc: "An Ice Field cuts its movement to three quarters until the end of its next turn.",
      });
    const hold = this._captureHolder() === u.team;
    const aura = this._auraFlags(u); // both can apply at once (+15 −15): show each
    if (aura.rally)
      out.push({
        icon: "status_rally",
        name: "Rallied +15",
        desc: "A friendly Battle Standard, or a friendly Shaman's active Spirit Shroud, within 4 tiles grants +15 attack and courage (once — they don't stack).",
      });
    if (aura.shroud)
      out.push({
        icon: "status_shroud",
        name: "Shrouded −15",
        desc: "An enemy Spirit Shroud within 4 tiles saps 15 attack and courage.",
      });
    if (hold)
      out.push({
        icon: "status_rally",
        name: "Holding the objective +15",
        desc: "Its side holds the objective (more units on the capture tiles than the enemy): +15 attack and +15 courage.",
      });
    if (this._shielded(u))
      out.push({
        icon: "status_shield",
        name: "Shielded",
        desc: "A Priest's Shield prayer within 2 tiles halves incoming ranged damage.",
      });
    if (this._prayed(u, "shield"))
      out.push({
        icon: "status_shield",
        name: "Shield (Prayer)",
        desc: "Its Prayer halves ranged damage to allies within 2 tiles until its next turn.",
      });
    if (u._absorb)
      out.push({
        icon: "status_shield",
        name: "Absorb",
        desc: "A Bodyguard's sacrifice — the next damaging hit on this Conjurer is ignored entirely.",
      });
    if (this._retributioned(u))
      out.push({
        icon: "status_bless",
        name: "Retribution",
        desc: "Guarded by a Priest's Retribution: an enemy that strikes it in melee on its own turn is smitten for about 10 HP, armour ignored.",
      });
    if (u.walled)
      out.push({
        icon: "status_wall",
        name: "Braced",
        desc: "Set at the end of a turn in which it did not attack: it strikes first against any attacker but the Hero, until it attacks or lands a blow on a foe that is not mounted.",
      }); // the rule itself is the ability line above; no repeat
    return out;
  }
  // CHARGE (iOS Ep2 Unit::createChargeTargetList + the charge branch of Unit::onTick): a mount that galloped a straight
  // lane (orthogonal or diagonal, chargeDir) strikes the foe DIRECTLY AHEAD in it — ANY enemy type; the +30 comes from
  // the rider's charging flag (calculateAttackDamage, Unit+0xb4), not the target. The whole lane, the foe's tile
  // included, must fit the rider's movement (a diagonal step costs its terrain twice).
  _wouldCharge(attacker, defender) {
    const chargeDir = attacker.chargeDir;
    if (
      !chargeDir ||
      attacker.slowed ||
      !attacker.T.hasCharge ||
      !defender ||
      defender.dead ||
      defender._phantom ||
      defender.team === attacker.team
    )
      return false;
    if (defender.tx !== attacker.tx + chargeDir.dx || defender.ty !== attacker.ty + chargeDir.dy) return false;
    return (
      (attacker.chargeSpent || 0) +
        this._chargeStep(attacker, attacker.tx, attacker.ty, defender.tx, defender.ty, chargeDir) <=
      this.moveOf(attacker)
    );
  }
  // The selected rider's charge banner: "idle" (no straight gallop yet), "ready" (the tile ahead still fits its
  // movement, so a strike there is a charge) or "short" (it galloped, but the run-up used the movement the foe's tile
  // needs — createChargeTargetList counts the lane INCLUDING the target's tile — so a strike is an ordinary blow).
  _chargeState(u) {
    const chargeDir = u.chargeDir;
    if (!chargeDir || u.slowed) return "idle";
    const nx = u.tx + chargeDir.dx,
      ny = u.ty + chargeDir.dy;
    if (!this.inBounds(nx, ny)) return "short";
    return (u.chargeSpent || 0) + this._chargeStep(u, u.tx, u.ty, nx, ny, chargeDir) <= this.moveOf(u)
      ? "ready"
      : "short";
  }
  // One step's cost along a charge lane — Map::getMoveCost, counted twice on a diagonal (createChargeTargetList @0x70ee0).
  _chargeStep(u, fx, fy, tx, ty, chargeDir) {
    const cost = this.moveCost(u, tx, ty, fx, fy);
    return cost >= 99 ? Infinity : cost * (chargeDir.dx && chargeDir.dy ? 2 : 1);
  }
  // Who lands first in melee (Unit::isFirstStrike, attacker.isFirstStrike(defender) from Unit::attack — both
  // episodes): null when the attacker strikes first (the default), else the pre-strike { brace, label, floatOn }.
  // Pikemen land first on a class-3 (mounted) attacker unless it is the Hero (type 8). The binary's clause tests the
  // DEFENDER for type 9 there (`(this.class == 3 || other.type == 9) && this.type != 8 && other.type == 5`), so a
  // Griffon attacker is NOT covered — an unbraced pikeman does not strike a Griffon first. A braced wall is First
  // Strike (_hasAbility(1) while flag 0x10f is set), which lands first on any attacker without First Strike — the
  // Hero is the only one with it. The +30: Ep1 calculateAttackDamage (@0x59902) adds it to a braced (walled flag
  // @0x10f) Pike Wall's blow when the struck unit's STATE (Unit+0x25c) is 3/4 — charging. DELIBERATE DEVIATION
  // (MECHANICS.md §13): here it goes with an attacker of movement class 3 (cavalry) or 4 (a war engine), Ep1 only.
  _firstStrikeOf(attacker, defender) {
    if ((defender.T.minRange || 1) > 1) return null; // can't strike back in melee
    // Unit::isFirstStrike(attacker, defender) (iOS Ep2 @0x66fb4): cavalry (bar the Hero) attacking Pikemen does not
    // strike first. Its Griffon clause tests the DEFENDER for type 9 as well as 5, so it can never fire — an attacking
    // Griffon gets no such answer from an unbraced pikeman (and Pikemen attacking a Griffon swing first anyway).
    const mounted = attacker.T.al === 3;
    // (+30 brace: Episode I only — Ep2's calculateAttackDamage has no ability-27 term.)
    if (defender.T.pikeWall && attacker.type !== "king" && (defender.walled || mounted))
      return {
        brace:
          !!defender.walled && (attacker.T.al === 3 || attacker.T.al === 4) && !(this.mission && this.mission.ep === 2),
        label: defender.walled ? "Pike Wall!" : "First Strike!",
        floatOn: defender,
      }; // unbraced = the pikemen's standing first strike vs cavalry / Griffons
    if (defender.T.firstStrike && !attacker.T.firstStrike)
      return { brace: false, label: "First Strike!", floatOn: defender };
    // The ATTACKER swings LAST (Greatswordsmen) — so its target lands the first blow. Attribute the label to the slow
    // attacker (the defender does NOT have First Strike). A Last Strike attacker still swings first against another
    // Last Strike unit, and against a Cannon or Ballistae.
    if (attacker.T.lastStrike && !defender.T.lastStrike && defender.type !== "cannon" && defender.type !== "ballistae")
      return { brace: false, label: "Last Strike", floatOn: attacker };
    return null;
  }
  // The charge RIDES ON (onTick walks the lane tile by tile): when the struck foe falls and is on FOOT (class 1
  // skirmish / 2 formation), the rider carries on along the lane — past empty and friendly tiles — within its
  // movement, and hits each further enemy it meets: a normal blow (the +30 is spent on the first hit), after that
  // foe's own first strike if it has one; nobody counter-attacks a charge. It stops at a foe that SURVIVES, or at a
  // fallen flier / cavalry / war engine (classes 0/3/4), on the tile in front of it; otherwise it ends on the last
  // foot unit it cut down. Applies the damage now; returns the tiles the rider glides along (empty = stays put).
  _chargeRun(attacker, first, chargeDir) {
    const foot = (e) => e.T.al === 1 || e.T.al === 2;
    if (!first.dead || first._phantom || !foot(first) || attacker.dead) return [];
    const moveBudget = this.moveOf(attacker);
    let spent =
      (attacker.chargeSpent || 0) + this._chargeStep(attacker, attacker.tx, attacker.ty, first.tx, first.ty, chargeDir);
    const lane = [{ tx: first.tx, ty: first.ty }];
    let end = 0,
      x = first.tx,
      y = first.ty;
    for (;;) {
      const nx = x + chargeDir.dx,
        ny = y + chargeDir.dy;
      if (!this.inBounds(nx, ny)) break;
      spent += this._chargeStep(attacker, x, y, nx, ny, chargeDir);
      if (spent > moveBudget) break;
      const e = this.unitAt(nx, ny);
      if (e && e.team !== attacker.team) {
        const firstStriker = this._firstStrikeOf(attacker, e);
        if (firstStriker) {
          this.floaters.push({
            x: firstStriker.floatOn.px + this.tile / 2,
            y: firstStriker.floatOn.py - 6,
            t: 0,
            life: 1.0,
            vy: -16,
            text: firstStriker.label,
            crit: true,
            heal: true,
          });
          this.resolveDamage(e, attacker, { brace: firstStriker.brace });
        }
        if (!attacker.dead) {
          this.resolveDamage(attacker, e, {});
          this._retributionCount(attacker, e);
        }
        if (attacker.dead || !e.dead || !foot(e)) {
          // stopped: on the tile in front of this foe
          end = lane.length - 1;
          while (end > 0 && this.unitAt(lane[end].tx, lane[end].ty)) end--; // never end on a friend it rode past
          break;
        }
        lane.push({ tx: nx, ty: ny });
        end = lane.length - 1; // cut down another foot soldier — ride on
      } else lane.push({ tx: nx, ty: ny }); // empty or friendly: gallop past
      x = nx;
      y = ny;
    }
    return attacker.dead ? [] : lane.slice(0, end + 1);
  }
  // A charge unit that would gallop a STRAIGHT ≥3 lane from its current tile to (sx,sy) — orthogonal OR
  // diagonal — can strike the foe `e` one step further along that lane. For a diagonal lane the strike lands
  // on a diagonally-adjacent foe (manhattan 2), which normal orthogonal melee can't reach: this is the charge's
  // special diagonal reach (confirmed from `x()`'s lane test `dx==0 || dy==0 || |dx|==|dy|`, and iOS Ep2
  // createChargeTargetList accepts dx==dy and dx==-dy). Diagonal or straight, a charge is never counter-attacked,
  // and a Pike Wall / First Strike foe still strikes the rider first (Unit::onTick charge branch — no range test).
  _chargeReaches(u, spotX, spotY, e) {
    if (!u.T.hasCharge || u.slowed || u.T.range !== 1 || this._chargeBogged(u, u.tx, u.ty)) return false;
    const laneX = Math.sign(spotX - u.tx),
      laneY = Math.sign(spotY - u.ty);
    if (laneX === 0 && laneY === 0) return false;
    const absX = Math.abs(spotX - u.tx),
      absY = Math.abs(spotY - u.ty);
    if (!((laneX === 0 || laneY === 0 || absX === absY) && Math.max(absX, absY) >= 2)) return false; // straight ≥2 gallop (foe > 2 from the start)
    if (e.tx !== spotX + laneX || e.ty !== spotY + laneY) return false; // foe is the next tile along the lane
    // createChargeTargetList @0x70ed4: the lane's terrain cost from the start tile, the foe's tile included (a diagonal
    // step counted twice), must fit the movement — the same test the strike makes (_wouldCharge), so the preview and
    // the AI never count on a charge that would land as an ordinary blow.
    const chargeDir = { dx: laneX, dy: laneY },
      moveBudget = this.moveOf(u);
    let spent = 0,
      x = u.tx,
      y = u.ty;
    while (x !== e.tx || y !== e.ty) {
      spent += this._chargeStep(u, x, y, x + laneX, y + laneY, chargeDir);
      if (spent > moveBudget) return false;
      x += laneX;
      y += laneY;
    }
    return true;
  }
  // The melee hit clip for a weapon, as changeState's weapon switch (iOS Ep2 @0x6b84c) plays it: the Bite (32) → 47,
  // the Mallet (30) → 49, Spear / Pike / Druid Lance → 27/28/29 in turn, any other blade 30/31 in turn — 48 for a
  // Bodyguard (@0x6bb82). One counter (Context+5160) drives both turns.
  _meleeSfx(weapon) {
    if (weapon === 32) return "melee_bite";
    if (weapon === 30) return "melee_mallet";
    if (weapon === 5 && this.anim && this.anim.u && this.anim.u.type === "bodyguard") return "melee_guard"; // the Bodyguard's Armblades → sound 48 (changeState @0x6bb88)
    const clips = POLE_HIT_WEAPONS.has(weapon) ? MELEE_POLE : MELEE_BLADE;
    this._hitSfxN = (this._hitSfxN || 0) + 1;
    return clips[this._hitSfxN % clips.length];
  }
  // Movement alternates between two clips like the original (cavalry cycles snd_008/009, foot snd_012/013).
  _altMove(a, b) {
    this._moveSfxN = (this._moveSfxN || 0) + 1;
    return this._moveSfxN % 2 ? a : b;
  }
  estimateDamage(attacker, defender) {
    return this.hitForecast(attacker, defender, defender.tx, defender.ty, {
      charge: this._wouldCharge(attacker, defender),
    });
  }
  // What resolveDamage will deal to unit `e` when `atk` fires at the tile (ax, ay) — the same blast share per cell
  // (BLAST_SHARE, Unit::startAreaAttack), so every forecast number matches the hit: the aimed cell of a Piercing Bolt
  // 85% and the two behind it 65% / 40%, Shock 85%, a Rock / Pitch / Fireball cross 50 / 40 / 60%, Lightning 55%.
  hitForecast(attacker, e, aimX, aimY, opts = {}) {
    const dist = manhattan(attacker, { tx: aimX, ty: aimY }),
      weapon = weaponAt(attacker, dist);
    const onAim = e.tx === aimX && e.ty === aimY;
    if (attacker.T.canLightning && dist >= 2 && attacker.spell === "lightning")
      return shared(this.computeDamage(attacker, e, { ...opts, weapon: 26 }), blastShare(26));
    if (attacker.T.canLightning && dist >= 2 && attacker.spell === "ice")
      return shared(this.computeDamage(attacker, e, { weapon: 27 }), blastShare(27));
    if (weapon === 34 && dist === 1)
      return shared(this.computeDamage(attacker, e, { ...opts, weapon: 34 }), blastShare(34));
    if (attacker.T.grapeshot && dist === 1) return this.computeDamage(attacker, e, { ...opts, weapon: 24 });
    if (attacker.T.pierce) {
      const pierceStep = this._ballistaStep(attacker, aimX, aimY);
      if (pierceStep) {
        let k = onAim ? 0 : -1;
        for (let step = 1; step <= 2 && k < 0; step++)
          if (e.tx === aimX + pierceStep.fx * step && e.ty === aimY + pierceStep.fy * step) k = step;
        if (k >= 0) return shared(this.computeDamage(attacker, e, { ...opts, weapon: 28 }), blastShare(28, k));
      }
    }
    if (!onAim && attacker.T.splash && !(attacker.T.canLightning && dist <= 1))
      return shared(this.computeDamage(attacker, e, { weapon }), blastShare(weapon, 1));
    return this.computeDamage(attacker, e, opts);
  }

  _isAoe(u) {
    return !!(u && u.T && (u.T.crossBlast || u.T.canLightning));
  } // real area weapons: catapult/pitch/fireball cross, wizard storm/ice — NOT the single-shot cannon/trebuchet
  // The cannon can AIM its point-blank Grapeshot at any of the 4 orthogonal neighbours — an enemy OR empty ground — so
  // you can rake the space in front of you without stepping onto it. Not an AoE aimer (no cast donut); a 4-direction pick.
  _isGrapeshotAimer(u) {
    return !!(u && u.T && u.T.grapeshot && !u.T.canLightning);
  }
  // FREE AIM (Unit::createAttackDestinations, iOS Ep1 @0x5868c / Ep2 @0x693e8): when the unit's attack carries Barrage
  // (25), Low Arc (26), Arc (29) or Burst (13), the game lists EVERY in-range tile as a target, empty ground included —
  // the Catapult, Cannon, Trebuchet and Ballistae. (The Cannon's point-blank Grapeshot keeps its own 4-way aim.)
  _freeAim(u) {
    return !!(
      u &&
      u.T &&
      !u.T.canLightning &&
      (u.T.abilities || []).some((a) => a === 25 || a === 26 || a === 29 || a === 13)
    );
  }
  _aimShot(u) {
    return this._isAoe(u) || this._freeAim(u);
  }
  // The aimed shot's range = its longest-reaching ranged weapon (the Cannon's Cannonball 3-10, not the Grapeshot at 1).
  _shotRange(u) {
    let best = null;
    for (const weapon of [u.T.weapon, u.T.weapon2]) {
      const range = WEAPON_RANGE[weapon];
      if (range && range[1] > 1 && (!best || range[1] > best[1])) best = range;
    }
    return best ? [best[0], best[1]] : [u.T.minRange || 1, u.T.range];
  }
  // The AIM (blast) range for an area weapon — a clean donut so the wizard and the siege engines behave the SAME:
  // a wizard aims its selected SPELL (Fireball/Ice 2-7, Lightning 3-7), NOT the point-blank Wand at range 1 (that's
  // a plain melee jab handled by normal targeting); a siege engine uses its weapon range (catapult 3-8).
  _castRange(u) {
    if (u.T.canLightning) {
      const spell = this._spellDisplay(u);
      return [spell.min, spell.max];
    }
    if (this._freeAim(u)) return this._shotRange(u);
    return [u.T.minRange || 1, u.T.range];
  }
  _castGroundAoe(attacker, tx, ty) {
    const tile = this.tile;
    // If an ENEMY stands on the aimed tile it is the real centre (direct hit + splash around it). If the tile is
    // empty — or holds an ally — the centre is a phantom "ground" target so nothing there is hit directly and the
    // splash still spares your own side; the blast catches whatever enemies fall in its shape. This reuses the exact
    // path the deviation code already routes through resolveDamage.
    const real = this.unitAt(tx, ty);
    const defender =
      real && !real.dead // a unit on the aimed tile is the centre — YOURS included (friendly fire); empty ground = a phantom centre
        ? real
        : { tx, ty, px: tx * tile, py: ty * tile, T: {}, hp: 100, dead: false, _phantom: true, team: "_ground" };
    this.doAttack(attacker, defender);
  }
  // FEAR courage check (real Unit::attack + getCourage): a unit throwing a blow at a Griffon/Bear must beat a
  // courage roll or it balks — no attack, turn ends. Fearless units and other Fear units are immune. Courage is a
  // base by rating (militia low → hero high) lifted by a nearby Battle Standard / Spirit Shroud aura.
  // Unit::getCourage (iOS Ep2 @0x66e90): base by the COURAGE tier (record byte 7, Unit+0x188 — not the attack
  // rating) 0..5 = 35/50/65/85/100/125 (switch default 65); +15 for a friendly Battle Standard or Spirit Shroud within 4
  // (once), −15 for an enemy Spirit Shroud within 4, +15 while the unit's team holds the objective (Mission+0x260).
  // Nothing else: there is no separate +15 for "the acting team" — that is the same Mission+0x260 test.
  // Distances are Manhattan (getDistance → |dx|+|dy|).
  _courage(u) {
    const base = { 0: 35, 1: 50, 2: 65, 3: 85, 4: 100, 5: 125 }[u.T.courage != null ? u.T.courage : u.T.rating];
    let chance = base == null ? 65 : base;
    const { rally, shroud } = this._auraFlags(u, true); // getSkill's two flags, Hero included (@0x66ef2 / @0x66f1c)
    if (rally) chance += 15;
    if (shroud) chance -= 15;
    if (this._captureHolder() === u.team) chance += 15; // the objective holder's morale (Mission+0x260)
    return chance;
  }
  // FEAR courage check, shared by the player's attack and the AI's (an enemy striking YOUR Griffon Riders must test
  // its nerve too). Returns true when the attacker balks — the balk
  // animation is started and `onBalk` runs when it ends (the turn is spent, no blow). A PASSED check shows a small
  // "Courage!" cue so the roll is visible (a recreation cue; the original shows nothing on a pass).
  // Chance (0..1) that `u` keeps its nerve striking a Fear unit — the exact odds of the roll in _fearCheck.
  _courageChance(u) {
    const c256 = Math.floor((this._courage(u) * 256) / 100);
    if (c256 >= 255) return 1;
    if (c256 < 0) return 0;
    return Math.min(1, Math.ceil(((c256 + 1) * 1000) / 256) / 1000);
  }
  // Whether this blow would have to pass a courage check at all (the defender causes Fear; the attacker is neither
  // Fearless nor a Fear unit itself).
  _needsCourage(attacker, defender) {
    return !!(defender && defender.T && defender.T.fear && !attacker.T.fearless && !attacker.T.fear);
  }
  _fearCheck(attacker, defender, onBalk) {
    if (!defender || !defender.T.fear || attacker.T.fearless || attacker.T.fear) return false;
    const courage = this._courage(attacker);
    // Unit::attack's roll: r = (getRandom % 1000)·256/1000 (0..255) passes when r <= courage·256/100 — so 100+ never balks.
    let passed = this._courageChance(attacker) >= 1;
    if (!passed) {
      const roll = Math.floor((Math.floor(this.rng() * 1000) * 256) / 1000),
        need = Math.floor((courage * 256) / 100);
      passed = roll <= need;
      this._roll(
        `Courage — ${attacker.type} (${attacker.tx},${attacker.ty}) striking ${defender.type} (Fear): ` +
          `rolled ${roll}/255, passes at ${need} or less (courage ${courage}) → ${passed ? "PASSED" : "BALKED"}`,
        { what: "courage", roll, need, pass: passed },
      );
    }
    if (passed) {
      if (courage < 100)
        this.floaters.push({
          x: attacker.px + this.tile / 2,
          y: attacker.py - 4,
          t: 0,
          life: 0.9,
          vy: -16,
          text: "Courage!",
          heal: true,
        });
      return false;
    }
    // The genuine balk (Unit::attack → the FEAR unit's changeState(12, attacker), which puts the ATTACKER into
    // state 9: its overlay plays battle strip 5017 #2 — the screaming skull — Ep1 @0x5a2fa; + sound 44): the unit
    // stands where it is under the skull, and its turn is spent with no blow struck. Nothing else is shown.
    attacker.face = Math.sign(defender.tx - attacker.tx) || attacker.face || 1;
    this.audio.play("fear", 0.5); // the game's own fear cue (Unit::attack balk → sound 44)
    this.spawnFx("skull", attacker.px + this.tile / 2, attacker.py + this.tile * 0.2, {});
    this.anim = {
      type: "balk",
      u: attacker,
      target: defender,
      t: 0,
      done: onBalk,
    };
    return true;
  }
  doAttack(attacker, defender) {
    this._commitMove(attacker); // attacking commits the move
    // FEAR: balk on a failed courage check when striking a Fear-causer (and not Fearless / not itself a Fear unit).
    if (this._fearCheck(attacker, defender, () => this.finishUnit(attacker))) {
      this.targets = null;
      return;
    }
    this.targets = null; // drop the damage-preview overlay the instant the blow is ordered — it must NOT linger over the swing/retaliation
    attacker.attackedTurn = true;
    if (attacker.T.pikeWall) attacker.walled = false; // giving an attack order lowers your own wall
    // Pike Wall: a braced defending pikeman strikes first; the wall replaces its later counter.
    // A CHARGE is the whole attack: onTick runs the defender's return blow only as a survival test and restores the
    // rider's HP, and doFinishMoving ends the charge without a melee exchange — so nobody counter-attacks a charge.
    const charge = this._wouldCharge(attacker, defender);
    if (
      this._preStrike(
        attacker,
        defender,
        () => {
          if (attacker.dead) this.finishUnit(attacker);
          else this._doAttackCore(attacker, defender, true);
        },
        charge,
      )
    )
      return;
    this._doAttackCore(attacker, defender, charge);
  }
  // Who strikes back at an adjacent attacker — Unit::attack (iOS Ep2 @0x7666c) asks Unit::isInRange (@0x664e8), which
  // tries weapon slot 0 and then the SIDEARM, and Unit::calcDamageRatio (@0x70054) estimates the counter the same way
  // (a slot that covers the distance with a minimum range of 1). So the archer line answers with its Short Sword,
  // Rangers with their Sword, Wizards with the Wizard Blade and Craftsmen with the Mallet — not only units whose MAIN
  // weapon is melee. War engines never do (Cannon / Ballistae by type, every class-4 engine in the AI's estimate);
  // Horse Bowmen have no sidearm.
  canCounter(defender) {
    if (!defender || defender.dead || defender.T.al === 4 || defender.T.kind === "siege") return false;
    const reachesOne = (weapon) => {
      const range = weapon && WEAPON_RANGE[weapon];
      return !!range && range[0] <= 1 && range[1] >= 1;
    };
    return reachesOne(defender.T.weapon) || reachesOne(defender.T.weapon2);
  }
  _doAttackCore(attacker, defender, noCounter) {
    attacker.face = Math.sign(defender.tx - attacker.tx) || attacker.face || 1;
    this.anim = {
      type: "attack",
      u: attacker,
      target: defender,
      t: 0,
      hitDone: false,
      done: () => {
        if (this._countersAfter(attacker, defender, noCounter)) {
          defender.face = Math.sign(attacker.tx - defender.tx) || defender.face || 1; // turn to face the attacker
          this.anim = {
            type: "attack",
            u: defender,
            target: attacker,
            t: 0,
            hitDone: false,
            counter: true,
            done: () => this._afterAttack(attacker),
          };
          defender.attacking = true;
          defender.anim = 0;
          defender.animT = 0;
          defender.hitPending = attacker; // play the RETALIATION swing, so the counter's damage comes with its strike
        } else {
          this._afterAttack(attacker);
        }
      },
    };
    const castLightning =
      attacker.spell === "lightning" && attacker.T.canLightning && manhattan(attacker, defender) >= 2; // storm cast (not the point-blank Wand): the wizard does nothing himself — no swing, no cast FX
    attacker.attacking = !castLightning;
    attacker.anim = 0;
    attacker.animT = 0;
    attacker.hitPending = defender;
    this._emit();
  }
  // A braced Pike Wall — a pikeman that held its ground (didn't act this turn) — strikes first when
  // attacked in melee by any unit except the Hero (strings 548/680). Against a charging mount the pike
  // gets +30 (the charge's speed turned against it). Returns true if it fired (cont resolves the attack).
  // Unified melee pre-strike: the defender strikes FIRST (before taking the blow) when it has a braced
  // Pike Wall (+30 vs a charge; survives cavalry), or First Strike (the Hero — string 522), or when the
  // ATTACKER has Last Strike (Greatswordsmen swing slowest — string 595, so the defender lands first).
  // A pre-strike replaces the defender's later counter.
  _preStrike(attacker, defender, cont, charge) {
    // A diagonal charge strikes a foe at manhattan 2 — the first strike still applies (isFirstStrike has no range test).
    if (defender.dead || defender._preStriking || (manhattan(attacker, defender) > 1 && !charge)) return false;
    const firstStriker = this._firstStrikeOf(attacker, defender);
    if (!firstStriker) return false;
    const { brace, label, floatOn } = firstStriker;
    defender._preStriking = true;
    defender.face = Math.sign(attacker.tx - defender.tx) || defender.face || 1;
    this.floaters.push({
      x: floatOn.px + this.tile / 2,
      y: floatOn.py - 6,
      t: 0,
      life: 1.0,
      vy: -16,
      text: label,
      crit: true,
      heal: true,
    });
    this.anim = {
      type: "attack",
      u: defender,
      target: attacker,
      t: 0,
      hitDone: false,
      brace,
      defensive: true, // a first strike in defence: never a charge, whatever lane the defender rode this turn
      done: () => {
        defender._preStriking = false;
        cont();
      },
    };
    defender.attacking = true;
    defender.anim = 0;
    defender.animT = 0;
    defender.hitPending = attacker;
    this._emit();
    return true;
  }

  // War-engine DEVIATION chance (%) for a shot at `tgt` — Unit::_executeAction + Unit::getDeviationChance (iOS Ep2
  // @0x665fa, identical in Ep1). A Barrage weapon (tag 25) drifts on a flat 35%. An Arc (29) / Low Arc (26) weapon, or
  // any Cannon shot, reads the target tile's defence (the damage it lets through, 100 − cover) and whoever stands there:
  //                          Arc (trebuchet)   Low Arc (cannon)
  //   target in cover (≤80)       15                 10
  //   empty ground                45                 35
  //   flier                      100                100
  //   cavalry / Wizard            65                 50
  //   war engine                  25                 20
  //   anyone else                 45                 35
  // The Grapeshot cone (point-blank) never drifts; the Ballistae never deviates (mayDeviate is false for it).
  _deviationPct(attacker, target) {
    if (!attacker.T.mayDeviate) return 0;
    const weapon = weaponAt(attacker, manhattan(attacker, target)),
      tags = WEAPON_TAGS[weapon] || [];
    if (weapon === 24) return 0;
    if (tags.includes(25)) return 35;
    const low = attacker.type === "cannon" || tags.includes(26);
    if (!low && !tags.includes(29)) return 0;
    const tileDamagePct = Math.round(100 - (this.terrainAt(target.tx, target.ty).defBonus || 0) * 100);
    if (tileDamagePct <= 80) return low ? 10 : 15;
    const e = this.unitAt(target.tx, target.ty);
    if (!e || e.dead) return low ? 35 : 45;
    if (e.T.al === 0) return 100;
    if (e.T.al === 3 || e.type === "wizards") return low ? 50 : 65;
    if (e.T.al === 4) return low ? 20 : 25;
    return low ? 35 : 45;
  }
  _weaponAt(u, dist) {
    return weaponAt(u, dist);
  } // the weapon `u` uses at `dist` (for the AI / previews)
  resolveDamage(attacker, defender, opts = {}) {
    if (defender.dead) return;
    // Lightning Storm (weapon 26 / bi==26 / w()): the storm strikes ONE cell per animation step — the `ah` 0→5
    // loop = 5 bolts, and each cell is picked at RANDOM from the 3×3 (RNG %9, re-rolling repeats), so 5 distinct
    // random cells in no fixed order. Each bolt just stabs straight DOWN — nothing else: no projectile, no
    // explosion, no flash, and the wizard makes no move of his own (only fired when the storm is truly cast, i.e.
    // not the point-blank Wand jab below).
    if (attacker.spell === "lightning" && attacker.T.canLightning && manhattan(attacker, defender) >= 2)
      return this._resolveLightning(attacker, defender, opts);
    // ICE FIELD: freezes a 2×2 BLOCK, dealing light armour-ignoring damage and SLOWING every unit caught. The
    // struck tile anchors the block (it extends +x/+y). ONE big z_007 frost-crystal burst is drawn over the whole
    // 2×2 — no per-unit ice spikes. (NB: the decompiled GENERIC blast is a + cross; the Ice Field is a 2×2 square.)
    if (attacker.spell === "ice" && attacker.T.canLightning && manhattan(attacker, defender) >= 2)
      return this._resolveIceField(attacker, defender);
    // SHOCK (the Ballistae's point-blank weapon 34, tag 3 Blast Area): Unit::startAreaAttack (iOS Ep2 @0x726f6) lays
    // the blast on the FOUR tiles orthogonally adjacent to the ballista — (1,0) (−1,0) (0,1) (0,−1) — and everyone
    // there, friend or foe, takes the hit.
    if (weaponAt(attacker, manhattan(attacker, defender)) === 34 && manhattan(attacker, defender) === 1)
      return this._resolveShock(attacker, opts);
    // GRAPESHOT (cannon point-blank, weapon 24 / Unit::setGrapeShot, iOS Ep1 @0x577b4): a 3-wide row right next to
    // the cannon then 1 tile further, in the direction fired, all at FULL damage. Only at range 1 (the grapeshot
    // band); at range it fires a single Cannonball (the normal path below).
    if (attacker.T.grapeshot && manhattan(attacker, defender) === 1)
      return this._resolveGrapeshot(attacker, defender, opts);
    const wMain = opts.weapon != null ? opts.weapon : weaponAt(attacker, manhattan(attacker, defender));
    const pierceShot = attacker.T.pierce && !!this._ballistaStep(attacker, defender.tx, defender.ty); // Piercing Bolt: the aimed cell is the bolt's first (85%)
    const damage = shared(this.computeDamage(attacker, defender, opts), pierceShot ? blastShare(28, 0) : 1);
    this._applyHit(defender, attacker, damage, damage >= 55, !!opts.siege, wMain);
    // The struck cell's STRUCTURE takes the blow too (Unit::onTick → Map::applyDamage on the attack location) — a
    // unit sheltering in a house or on a rampart, or a shot aimed at the empty building itself.
    this._structureBlow(attacker, defender.tx, defender.ty, pierceShot ? blastShare(28, 0) : 1, wMain);
    // EPISODE II — Ballistae Piercing Bolt (help string 758): the bolt "damages three squares in a row" —
    // after the main hit it pierces the next two tiles behind the target, in the direction _ballistaStep picks.
    this._resolvePierce(attacker, defender, opts, wMain);
    // A wizard jabbing point-blank uses its Wand (weapon 7) — a plain melee hit, no spell splash.
    if (attacker.T.splash && !(attacker.T.canLightning && manhattan(attacker, defender) <= 1))
      this._resolveSplash(attacker, defender, opts, wMain);
  }

  // Lightning Storm: five bolts on cells of the 3×3. Unit::_executeAction (iOS Ep2 @0x7f906) rolls the storm's START,
  // s = CODE[getRandom(9)] (Unit+0x270); Unit::onTick (@0x789fc) drops bolt k (k = 0..4, Unit+0x158 — five bolts,
  // @0x78d8a) on cell CODE[(2k + s) mod 9]. CODE is the index → code switch both share (0,9,1,5,8,4,10,2,6) and each
  // code is a cell (@0x78aec), so the index order is C, NW, N, NE, W, E, SW, S, SE: every storm is one of a few fixed
  // stride patterns (s mod 9 = 0 or 1 twice as often), never five cells drawn at random. A bolt off the map is lost.
  _resolveLightning(attacker, defender, opts) {
    const centerX = defender.tx,
      centerY = defender.ty,
      tile = this.tile;
    const start = LIGHTNING_CODE[Math.floor(this.rng() * 9)];
    const cells = [0, 1, 2, 3, 4].map((k) => LIGHTNING_CELL[LIGHTNING_CODE[(2 * k + start) % 9]]);
    this._roll(
      `Lightning Storm — ${attacker.type} (${attacker.tx},${attacker.ty}) at (${centerX},${centerY}): bolts on ` +
        cells.map(([dx, dy]) => `(${centerX + dx},${centerY + dy})`).join(" "),
      { what: "lightning", at: [centerX, centerY], cells: cells.map(([dx, dy]) => [centerX + dx, centerY + dy]) },
    );
    const STEP = 0.13; // gap between successive bolts
    this.audio.play("thunder", 0.6, 1.0); // ONE thunderclap for the whole storm (not one per bolt)
    cells.forEach(([dx, dy], i) => {
      const tx = centerX + dx,
        ty = centerY + dy;
      const strike = () => {
        if (!this.inBounds(tx, ty)) return;
        this.spawnFx("bolt", tx * tile + tile / 2, ty * tile + tile * 0.42 - tile * 0.5, {}); // 016 — just the lightning, nothing else
        const e = this.unitAt(tx, ty); // damage WHOEVER stands on the struck cell — the storm has no friend/foe (decompiled: no team check)
        if (e && !e.dead)
          this._applyHit(
            e,
            attacker,
            shared(this.computeDamage(attacker, e, { ...opts, weapon: 26 }), blastShare(26)),
            false,
          );
        // a house the bolt brings down raises its dust ring once the fifth bolt is over (renderOverlay @0x75d24)
        this._areaStructureHit(attacker, tx, ty, blastShare(26), 26, STEP * (4 - i) + FX_TYPES.bolt.dur);
      };
      if (i === 0) strike();
      else this._after(STEP * i, strike); // first bolt now, the rest cascade
    });
    return;
  }

  // Ice Field: the 2×2 block (see resolveDamage).
  _resolveIceField(attacker, defender) {
    const tile = this.tile,
      centerX = defender.tx,
      centerY = defender.ty;
    // one burst centred on the CENTRE of the 2×2 (the shared corner of the four cells)
    this.spawnFx("icefield", (centerX + 1) * tile, (centerY + 1) * tile - tile * 0.08, { scale: 1.0 });
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      // the 2×2 block — freezes WHOEVER is caught (no team check)
      const e = this.unitAt(centerX + dx, centerY + dy);
      if (e && !e.dead) {
        this._applyHit(e, attacker, shared(this.computeDamage(attacker, e, { weapon: 27 }), blastShare(27)), false); // weapon 27, 100% per cell
        if (!e.slowed) e.slowed = true; // Unit::onTick (@0x78f44): only an unslowed unit is slowed (a second Ice doesn't extend it)
      }
      this._areaStructureHit(attacker, centerX + dx, centerY + dy, blastShare(27), 27);
    }
    return;
  }

  // Ballistae Shock: the 4 tiles around the engine (see resolveDamage).
  _resolveShock(attacker, opts) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = attacker.tx + dx,
        y = attacker.ty + dy;
      if (!this.inBounds(x, y)) continue;
      const e = this.unitAt(x, y);
      if (e && !e.dead)
        this._applyHit(
          e,
          attacker,
          shared(this.computeDamage(attacker, e, { ...opts, weapon: 34 }), blastShare(34)),
          false,
          true,
        );
      this._areaStructureHit(attacker, x, y, blastShare(34), 34);
    }
    return;
  }

  // Cannon Grapeshot: the forward scatter cone (see resolveDamage).
  _resolveGrapeshot(attacker, defender, opts) {
    const tile = this.tile,
      seen = new Set();
    const fx = Math.sign(defender.tx - attacker.tx),
      fy = Math.sign(defender.ty - attacker.ty);
    // ONE directional muzzle blast (z_028), pointed the way it fires.
    this.spawnFx("grapeshot", (attacker.tx + 0.5 + fx * 1.3) * tile, (attacker.ty + 0.5 + fy * 1.3) * tile, {
      angle: Math.atan2(fy, fx),
      scale: 0.9,
    });
    for (const cell of this._grapeshotCone(attacker, defender.tx, defender.ty)) {
      const cellKey = cell.tx + "," + cell.ty;
      if (seen.has(cellKey) || !this.inBounds(cell.tx, cell.ty)) continue;
      seen.add(cellKey);
      const e = this.unitAt(cell.tx, cell.ty); // no team check — grapeshot rakes whoever's in the cone
      if (e && !e.dead)
        this._applyHit(e, attacker, this.computeDamage(attacker, e, { ...opts, weapon: 24 }), false, true);
      this._areaStructureHit(attacker, cell.tx, cell.ty, 1, weaponAt(attacker, 1));
    }
    return;
  }

  // Ballistae Piercing Bolt: the two tiles behind the target (see resolveDamage).
  _resolvePierce(attacker, defender, opts, wMain) {
    const bstep = attacker.T.pierce ? this._ballistaStep(attacker, defender.tx, defender.ty) : null;
    if (bstep) {
      const { fx, fy } = bstep;
      for (let step = 1; step <= 2; step++) {
        const px = defender.tx + fx * step,
          py = defender.ty + fy * step;
        const e = this.unitAt(px, py);
        if (e && !e.dead)
          this._applyHit(
            e,
            attacker,
            shared(this.computeDamage(attacker, e, { ...opts, weapon: 28 }), blastShare(28, step)),
            false,
            !!opts.siege,
          ); // 65% / 40%
        this._areaStructureHit(attacker, px, py, blastShare(28, step), wMain);
      }
    }
  }

  // The + cross blast of the Catapult's Rock / Pitch and the Wizard's Fireball: units, then structures.
  _resolveSplash(attacker, defender, opts, wMain) {
    // Blast SHAPE (decompiled La/q.k): catapult Rock(20), Pitch(22) and the Wizard's Fireball(25) spray a + CROSS.
    // The blast apply loop (La/q, line 2605) has NO team check — it damages WHOEVER stands in a cell, YOUR OWN
    // units included (friendly fire is real; the AI only *scores* ally-hits negatively to avoid aiming at them).
    const square = !!attacker.T.blastArea; // (unused for siege now — all cross; kept for any 3×3 spell)
    for (const e of this.units) {
      if (e.dead || e === defender) continue;
      const dx = Math.abs(e.tx - defender.tx),
        dy = Math.abs(e.ty - defender.ty);
      const inArea = square ? Math.max(dx, dy) <= 1 : dx + dy <= 1;
      if (inArea)
        this._applyHit(
          e,
          attacker,
          shared(this.computeDamage(attacker, e, { weapon: wMain }), blastShare(wMain, 1)),
          false,
          !!opts.siege,
        );
    }
    // …and every structure in the blast (the onTick blast loop applies Map::applyDamage per destination cell, scaled
    // by the cell's blast share — the same share the units there take: Rock 50%, Pitch 40%, Fireball 60%).
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (square ? false : Math.abs(dx) + Math.abs(dy) > 1) continue;
        this._areaStructureHit(attacker, defender.tx + dx, defender.ty + dy, blastShare(wMain, 1), wMain);
      }
  }
  // Unit::createBallistaeAreaPattern (iOS Ep2 @0x71914): the bolt's 3 tiles are the target + 1 and 2 steps beyond it,
  // the step chosen by the shot's ANGLE, not the signs of dx/dy: r = |trunc(20·dx / dy)| (20 = 45°); r ≤ lo → straight
  // along y, r ≥ hi → straight along x, between → diagonal. lo/hi by range: 5 → 10/31, 7 → 14/30, 8 → 10/34, else
  // 10/30; dy = 0 → along x. A point-blank shot (range 1, the Shock) or one at its own tile has no pattern → null.
  _ballistaStep(u, tx, ty) {
    const dx = tx - u.tx,
      dy = ty - u.ty,
      dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= 1) return null;
    const signX = dx < 0 ? -1 : 1,
      signY = dy < 0 ? -1 : 1;
    if (dy === 0) return { fx: signX, fy: 0 };
    const lo = dist === 7 ? 14 : 10,
      hi = dist === 5 ? 31 : dist === 8 ? 34 : 30;
    const slope = Math.abs(Math.trunc((20 * dx) / dy));
    if (slope <= lo) return { fx: 0, fy: signY };
    if (slope >= hi) return { fx: signX, fy: 0 };
    return { fx: signX, fy: signY };
  }
  // The tiles a grapeshot shot rakes, fired at (tx,ty) from unit u (must be an orthogonal neighbour). Unit::setGrapeShot
  // (iOS Ep1 @0x577b4, Ep2 @0x67db4) pushes 4 cells per direction, each at 100%: the 3-wide row RIGHT NEXT to the
  // cannon (the aimed tile and its two diagonals), then the one tile beyond the aimed tile — e.g. firing up:
  // (1,-1) (0,-1) (-1,-1) (0,-2). The HUD's Grapeshot glyph draws the same T. (The Android-derived reading had it
  // mirrored: 1 tile near, the row further.) Returns absolute {tx,ty} cells (shared by resolveDamage + the preview).
  _grapeshotCone(u, tx, ty) {
    const dx = Math.sign(tx - u.tx),
      dy = Math.sign(ty - u.ty);
    if (!dx && !dy) return [];
    const px = dx === 0 ? 1 : 0,
      py = dx === 0 ? 0 : 1; // lateral axis (perpendicular to the fire line)
    const out = [
      [dx + px, dy + py], // the 3-wide row next to the cannon
      [dx, dy],
      [dx - px, dy - py],
      [2 * dx, 2 * dy], // 1 tile further
    ];
    return out.map(([ddx, ddy]) => ({ tx: u.tx + ddx, ty: u.ty + ddy }));
  }

  // --- Druid Shapeshift (string 542): transform into a Stag, Great Eagle, or Guardian Bear, gaining
  // that beast's movement & attack. A free action (the transformation itself), then act as the beast.
  // The form STAYS (Unit::onTick's shift, iOS Ep2 @0x797d2 / Ep1 @0x63d94; the Android port alike): nothing turns a
  // shifted druid back — it acts, and waits out the enemy's turn, as the beast. It shapeshifts again only by choice:
  // the action is offered to a Druid and to each of its forms (GameScreen menu; Android a.g), a beast choosing the
  // Druid or one of the other two beasts. HP carries across the change, as in the original.
  // The Wizard's displayed weapon/ability/range follow the SELECTED spell (not always Fireball). Point-blank it
  // jabs with its Wand (range 1) whatever spell is chosen, so each blurb mentions that.
  _spellDisplay(u) {
    const wand = " Point-blank, it jabs with its Wizard Blade instead.";
    // reach: the spell weapon's own range (5010 table) — Ice Field is 3–7, not 2–7
    const range = (spell) => {
      const s = spellStats(spell);
      return { min: s.min, max: s.max };
    };
    switch (u.spell) {
      case "lightning":
        return {
          name: "Lightning Storm",
          ...range("lightning"),
          ability:
            "Lightning Storm — five bolts stab down on random cells across a 3×3 area; magic gets through most armour." +
            wand,
        };
      case "ice":
        return {
          name: "Ice Field",
          ...range("ice"),
          ability: "Ice Field — freezes a 2×2 block, dealing light damage and SLOWING every unit caught." + wand,
        };
      default:
        return {
          name: "Fireball",
          ...range("fireball"),
          ability: "Fireball — bursts in a + shape; magic gets through most armour." + wand,
        };
    }
  }
  shapeshiftSelected(form) {
    const u = this.selected;
    if (this.anim || this.marchQueue) return; // don't change form while an action animates
    if (!u || u.dead || u.acted || !u.T.shapeshiftForms || !u.T.shapeshiftForms.includes(form)) return;
    // ONE shift a turn: the menu offers Shapeshift only while the shifted flag (Unit+0x27c; the Android port's `bb`) is
    // clear — set by the shift, cleared by endTurn and by Undo. So a druid can't move as an Eagle and strike as a Bear.
    if (u._shiftTurn === this.turn) return;
    if (!this._shapeshift(u, form)) return;
    // Undo takes the shift back (Unit::undoPreviousAction @0x749a2) — even before the unit has moved
    if (u.team === "blue" && !u.ally && this.phase === "player" && !(this._undoFrom && this._undoFrom.u === u))
      this._undoFrom = { u, tx: u.tx, ty: u.ty };
    u.flash = 0.2;
    this.audio.play("shapeshift", 0.55); // the real transform sound — snd_010+snd_004 layered (La/q case 2)
    this.spawnFx("nature", u.px + this.tile / 2, u.py + this.tile * 0.42, {}); // 002 — green nature bloom of the transformation
    this._burst(u.px + this.tile / 2, u.py + this.tile * 0.42, {
      count: 14,
      speed: 130,
      ring: true,
      smoke: false,
      colors: ["#8fe6a0", "#cfe8b0", "#7be0c0", "#ffffff"],
    });
    this.select(u); // refresh reach/targets as the new form (still may act)
  }
  // The shift (copyTypeInfo of the new form, HP kept): `form` "druids" means back to the unit's own Druid form. It
  // remembers the form it left (Unit+0x278) and that it shifted this turn (+0x27c, cleared by Unit::endTurn) for Undo.
  _shapeshift(u, form) {
    const druid = u._druidType || (u.T.shapeshift ? u.type : "druids");
    const target = form === "druids" ? druid : form;
    if (!UNIT_TYPES[target] || target === u.type || !this._canShapeshiftHere(u)) return false;
    u._druidType = druid;
    u._shiftFrom = u.type;
    u._shiftTurn = this.turn;
    u.type = target;
    u.T = UNIT_TYPES[target];
    u.shifted = target !== druid;
    return true;
  }
  // WHERE a druid may shift: only where a Formation unit could stand — Map::getMoveCost(2, getTileType(pos)) <= 4.
  // Episode I's menu greys Shapeshift out otherwise (GameScreen::initMenuState @0x1b670; the Android port the same) and
  // the AI keeps its form (Unit::aiConsiderAction, Ep1 @0x66592 / Ep2 @0x7c062). Only water (type 19) and impassable
  // cliffs (21) fail, so an Eagle over them can't drop a ground beast there. DELIBERATE DEVIATION (user decision,
  // MECHANICS.md §13): Episode II's rebuilt player menu shows no such test, but the rule holds there too.
  _canShapeshiftHere(u) {
    const props = this.terrainAt(u.tx, u.ty);
    const row = (props && props.moveRow) || moveRow(moveType(this.tileAt(u.tx, u.ty)));
    return !row || row[2] <= 4;
  }
  // Unit::undoPreviousAction (iOS Ep2 @0x74908): a unit that shifted this turn takes back the form it left.
  _undoShapeshift(u) {
    if (u._shiftTurn !== this.turn || !u._shiftFrom || !UNIT_TYPES[u._shiftFrom]) return;
    u.type = u._shiftFrom;
    u.T = UNIT_TYPES[u._shiftFrom];
    u.shifted = u.type !== u._druidType;
    u._shiftFrom = null;
    u._shiftTurn = null;
    this.spawnFx("nature", u.px + this.tile / 2, u.py + this.tile * 0.42, {});
  }
  // Wizard: swap between Fireball (single + splash) and Lightning Storm (five area bolts).
  setSpell(spell) {
    const u = this.selected;
    if (!u || !u.T.canLightning || !["fireball", "lightning", "ice"].includes(spell)) return;
    u.spell = spell;
    this.aimMode = this.canAim(); // choosing a spell = "I want to cast" → drop straight into free-pick aim
    this.audio.play("select", 0.4);
    this.recalcTargets();
    this._emit();
  }
  toggleSpell() {
    const u = this.selected;
    if (!u) return;
    const order = ["fireball", "lightning", "ice"];
    this.setSpell(order[(order.indexOf(u.spell || "fireball") + 1) % 3]);
  }
  // Priest RETRIBUTION (the 3rd Prayer option, help "Invoke Retribution to increase the counter attack strength
  // of nearby allies"): a full action that marks the priest's tile — until your next turn an enemy that strikes a unit
  // of yours within 2 of it is smitten before that unit counters (see _retributionStrikes).
  // Priest SHIELD (the 2nd Prayer option, help 590 "This unit may Shield nearby allies against ranged damage"): the
  // priest invokes it as a full action; allies (and itself) within Manhattan 2 take HALF ranged damage until the
  // priest's next turn (Map::isUnitShielded reads the per-team list of shielding priests).
  invokeShield() {
    const u = this.selected;
    if (!u || u.dead || u.acted || !u.T.prayer || this.phase !== "player" || this.anim || this.marchQueue) return;
    this._prayerMark("shield", u);
    this.floaters.push({
      x: u.px + this.tile / 2,
      y: u.py - 6,
      t: 0,
      life: 1.1,
      vy: -16,
      text: "Shield!",
      crit: true,
      heal: true,
    });
    this.spawnFx("ice", u.px + this.tile / 2, u.py + this.tile * 0.3, { scale: 1.3 });
    this.audio.play("cast", 0.55); // the cast sound (22) the dome shares with the Siren's skull
    this.anim = {
      type: "attack",
      u,
      target: { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
      t: 0,
      hitDone: false,
      cast: true,
      done: () => this.finishUnit(u),
    };
    u.attacking = true;
    u.anim = 0;
    u.animT = 0;
    this._emit();
  }
  invokeRetribution() {
    const u = this.selected;
    if (!u || u.dead || u.acted || !u.T.prayer || this.phase !== "player" || this.anim || this.marchQueue) return; // never fire an ability while another action animates (would overwrite this.anim)
    this._prayerMark("retribution", u);
    this.floaters.push({
      x: u.px + this.tile / 2,
      y: u.py - 6,
      t: 0,
      life: 1.1,
      vy: -16,
      text: "Retribution!",
      crit: true,
      heal: true,
    });
    this._retributionAngel(u);
    this.audio.play("heal", 0.55); // Retribution shares the Heal chime (sound 10, Unit::retribution)
    this.anim = {
      type: "attack",
      u,
      target: { tx: u.tx, ty: u.ty, px: u.px, py: u.py },
      t: 0,
      hitDone: false,
      cast: true,
      done: () => this.finishUnit(u),
    };
    u.attacking = true;
    u.anim = 0;
    u.animT = 0;
    this._emit();
  }
  // `weapon` = the weapon of a direct blow or shot (resolveDamage's main target); area cells and side hits pass none.
  _applyHit(defender, attacker, damage, crit, noBlood, weapon) {
    // Unit::onTick (Ep2 @0x77c9a, Ep1 @0x629f8), as a unit's blow lands: it lowers its OWN Pike Wall unless the one it
    // struck is mounted — class 3, a Griffon (type 9) or a Great Eagle (26). So a braced pikeman keeps its wall while it
    // strikes cavalry (its first strike or its counter), and drops it the moment it hits a unit on foot.
    if (
      attacker &&
      attacker.T.pikeWall &&
      attacker.walled &&
      !(defender.T.al === 3 || defender.type === "griffon" || defender.type === "greateagle")
    )
      attacker.walled = false;
    if (defender.dead || defender._phantom) return; // a shot aimed at empty ground hits no unit (its structure is handled apart)
    this._dbg("hit", {
      a: attacker ? attacker.id : null,
      aty: attacker ? attacker.type : null,
      from: attacker ? [attacker.tx, attacker.ty] : null,
      d: defender.id,
      dty: defender.type,
      at: [defender.tx, defender.ty],
      dmg: toHp256(damage),
      hp: toHp256(defender.hp),
    });
    // EPISODE II — Absorb (help 585: "Gives a buff to Conjurer that ignores 100% of the damage from the next attack.
    // After absorbing one attack the buff will be depleted."). The buff is INVOKED by sacrificing a Bodyguard (its
    // Absorb skill / the AI's bodyguard branch); calculateAttackDamage returns 0 for a Conjurer carrying it (@0x6af38).
    if (defender._absorb) {
      defender._absorb = false;
      this.spawnFx("absorb_flash", defender.px + this.tile / 2, defender.py + this.tile * 0.4, {}); // 5017 #15
      this.floaters.push({
        x: defender.px + this.tile / 2,
        y: defender.py - 4,
        t: 0,
        life: 0.9,
        vy: -18,
        text: "Absorbed",
        heal: true,
      });
      return;
    }
    const hpBefore = defender.hp;
    this.ai._glHit(defender, attacker); // GroupLogic flags (Unit::applyDamage): target's group hit (0x50), attacker's group attacked (0x51)
    if (defender._hidden) this._setHidden(defender, false); // Unit::applyDamage: a hit reveals a hidden unit
    defender.hp = clamp(defender.hp - damage, 0, 100);
    const shown = shownDamage(hpBefore, damage);
    defender.flash = 0.16;
    const pushX = Math.sign(defender.tx - attacker.tx),
      pushY = Math.sign(defender.ty - attacker.ty);
    defender.shove = { dx: pushX || 0, dy: pushY || (pushX ? 0 : -1), t: 0.2 };
    this.floaters.push({
      x: defender.px + this.tile / 2,
      y: defender.py,
      t: 0,
      life: 0.8,
      vy: -24,
      text: shown,
      crit,
    });
    const cx = defender.px + this.tile / 2,
      cy = defender.py + this.tile * 0.42;
    // The mark of the blow (see meleeHitFx): a melee weapon's slash or blood burst, or none. A war engine's stone or
    // shell already bursts on its cells (noBlood).
    // DELIBERATE DEVIATION — a unit struck by a shot (arrow, bolt, ball, hammer) or caught in a blast also shows the
    // blood burst here; the original marks only melee blows (and puts its slash on the unit a blast was aimed at).
    const melee = weapon != null && !RANGED_WEAPONS.has(weapon);
    const mark = noBlood ? null : melee ? meleeHitFx(weapon) : "impact";
    if (mark) this.spawnFx(mark, cx, cy, { flip: mark === "impact" && attacker.face < 0 });
    // EPISODE II — Life Steal (Blood Gorgers, iOS unit type 35): Unit::applyDamage (@0x6b406) records the bite
    // damage on the attacker; Unit::onTick (@0x780ac) then heals it by 3/2 of that damage, capped at full health.
    // Melee bite only, and only while wounded (help 588 "When wounded").
    if (
      attacker &&
      !attacker.dead &&
      attacker.T.lifeSteal &&
      attacker.hp < 100 &&
      manhattan(attacker, defender) === 1
    ) {
      const before = attacker.hp;
      const heal = Math.round((Math.min(damage, hpBefore) * 3) / 2);
      if (heal > 0) {
        attacker.hp = clamp(attacker.hp + heal, 0, 100);
        // the drain is Unit state 29 (onTick @0x77a42), whose overlay is the heal sparkle (5017 #3) over the Gorger
        this.spawnFx("spark", attacker.px + this.tile / 2, attacker.py + this.tile * 0.42, {});
        this.floaters.push({
          x: attacker.px + this.tile / 2,
          y: attacker.py - 4,
          t: 0,
          life: 0.9,
          vy: -22,
          text: "+" + (attacker.hp - before),
          crit: true,
          heal: true,
        });
      }
    }
    if (defender.hp <= 0) {
      defender.dead = true;
      defender.dieT = 0; // no death sound / fall animation — the unit just leaves the field
      if (defender.T.conjure) this._killConjuredChildren(defender); // Ep2 Leashing: a slain Conjurer's summons wink out
    }
  }
  // EPISODE II — Leashing (iOS killConjurerChild @0x7fdcc): when a Conjurer falls, every unit it conjured
  // (its leashed children) is unsummoned at once.
  // Unit::onTick's heal state (iOS Ep2 @0x79476 — the Priest's Heal and the Craftsmen mending a war engine): the original
  // adds 51 of 256 (19.9 HP); in whole HP (DELIBERATE DEVIATION, MECHANICS.md §13) it is +20, capped at 100 — so always
  // 20 unless the unit is above 80. Returns the gain shown.
  _healTick(u) {
    const step = healStep(u.hp);
    u.hp = step.hp;
    return step.shown;
  }
  _killConjuredChildren(conjurer) {
    let any = false;
    for (const u of this.units) {
      if (u.dead || u._conjuredBy !== conjurer.id) continue;
      u.hp = 0;
      u.dead = true;
      u.dieT = 0;
      any = true;
      this.spawnFx("unsummon", u.px + this.tile / 2, u.py + this.tile * 0.42, {}); // 5017 #10 purple flame
    }
    if (any) this.audio.play("unsummon", 0.5); // + sound 54, once for the lot
  }

  // Priest "Heal" — restore up to 20 HP to a wounded ally, then end the priest's turn.
  // It PLAYS the priest's cast animation (like an attack) and applies the +20 at its hit frame. The anim's `heal`
  // flag routes it to the mend branch in the update loop.
  healUnit(healer, target) {
    healer.face = Math.sign(target.tx - healer.tx) || healer.face || 1;
    this.anim = {
      type: "attack",
      u: healer,
      target,
      t: 0,
      hitDone: false,
      heal: true,
      done: () => this.finishUnit(healer),
    };
    healer.attacking = true;
    healer.anim = 0;
    healer.animT = 0;
    this._emit();
  }

  // Units of yours that fell this battle — the deployed-roster & preset units (not the Hero, not mid-battle
  // reinforcement waves). Reported to the shell for the end-of-battle summary; campaign and raid casualties are not
  // permanent (help 751 limits permanent losses to online battles), so the roster is not charged for them.
  casualtyReport() {
    const lost = {};
    for (const u of this.units)
      if (u.dead && u.team === "blue" && !u.hero && !u.wave) lost[u.type] = (lost[u.type] || 0) + 1;
    return lost;
  }

  spawnFx(name, x, y, opts = {}) {
    if (!FX_TYPES[name]) return;
    (this.fx || (this.fx = [])).push({
      name,
      x,
      y,
      t: 0,
      delay: opts.delay || 0,
      scale: opts.scale,
      flip: opts.flip,
      angle: opts.angle || 0,
    });
  }
  // Schedule fn to run after `delay` seconds, driven by update(dt). Used for cascading effects (Lightning Storm bolts).
  // ===== DESTRUCTIBLE STRUCTURES — byte-faithful to Map::applyDamage (iOS Ep2 @0x7ffa0) ======================
  // Every cell starts at 256 structure HP (Map::loadMap). A blow of weapon w on a cell of material m (Map::
  // getTileArmorType: 13 wood / 14 stone) removes  d = ((HP256 · getSkill256) >> 8) · (w[m]·256/100 · share) >> 8,
  // HP256 = the attacker's strength on the 256 scale, getSkill = its attack rating (+ auras) ·256/100, share = the
  // blast share of that cell (onTick's per-destination table; 100% at the centre). The cell then drops ONE damage stage
  // (getTransitionTile) when it was untouched (HP still 256) and the blow did any damage, or when HP falls below 0.
  // HP is not reset by a stage change, so a pristine house is "Damaged" by the first real hit and "Destroyed" once
  // the accumulated damage passes 256. Returns true when the cell changed stage.
  structureHit(u, tx, ty, share = 1, weapon) {
    if (!u || !this.inBounds(tx, ty)) return false;
    const tileVal = this.tileAt(tx, ty),
      nextTile = structTrans(tileVal),
      armor = structArmor(tileVal);
    const weaponId = weapon != null ? weapon : weaponAt(u, manhattan(u, { tx, ty }));
    const col = (WEAPON_DMG[weaponId] && WEAPON_DMG[weaponId][armor]) || 0;
    let a = Math.floor((col * 256) / 100);
    if (share !== 1) a = (a * Math.floor(share * 256)) >> 8; // the cell's blast share (pct*256/100), above 100% too (Detonate 125)
    const skill = Math.floor((((u.T.rf || 75) + this.ratingAura(u)) * 256) / 100);
    const hp256 = Math.round((clamp(u.hp, 0, 100) * 256) / 100);
    const damage = (((hp256 * skill) >> 8) * a) >> 8;
    const k = key(tx, ty),
      old = this.structHp.has(k) ? this.structHp.get(k) : 256,
      hp = old - damage;
    if (damage <= 0 && old === 256) return false; // a blow that can't scratch it leaves an untouched cell untouched
    this.structHp.set(k, hp);
    // applyDamage lowers the HP of EVERY struck cell — open ground too (material 0 = the weapon's no-armour column) —
    // it just has no stage to fall to. It matters when a Craftsman later builds on that ground: the village inherits it.
    if (nextTile == null) return false;
    const centerX = tx * this.tile + this.tile / 2,
      centerY = ty * this.tile + this.tile * 0.45;
    if (!((old === 256 && damage > 0) || hp < 0)) {
      // chipped, no stage change
      if (damage > 0) this.spawnFx("dust", centerX, centerY, {});
      return false;
    }
    this.tiles[ty * this.cols + tx] = nextTile; // the cell's tile becomes its next damage stage (Map::tag redraws it)
    const destroyed = structTrans(nextTile) == null;
    if (destroyed) this.razed.add(k);
    const stone = armor === 14;
    const colors = stone ? ["#8a8278", "#6b655c", "#4a453e", "#b9b0a2"] : ["#7a5a36", "#5b3f22", "#a07a4a", "#3e2a16"];
    // NOT the "debris" sheet — that is 5017 #13, the Craftsmen's build/repair hammer-and-splinters clip. Damage is a
    // dust cloud plus a burst of wood / stone chunks (bigger when the structure comes down).
    this.spawnFx("dust", centerX, centerY, {});
    if (destroyed) this.spawnFx("dust", centerX + this.tile * 0.18, centerY - this.tile * 0.12, { delay: 0.08 });
    this._burst(centerX, centerY, { big: destroyed, colors });
    this.audio.play("rock_hit", destroyed ? 0.6 : 0.4, destroyed ? 0.8 : 1.0);
    if (destroyed)
      this.floaters.push({
        x: centerX,
        y: ty * this.tile,
        t: 0,
        life: 1.0,
        vy: -18,
        text: "Destroyed!",
        crit: true,
        heal: true,
      });
    // Movement / targets across that cell may have changed (a wall that fell opens a path).
    if (this.selected && !this.anim) {
      this.reach = this.computeReach(this.selected);
      this.recalcTargets();
    }
    this._emit();
    return true;
  }
  // Map::applyDamage raises Map+0x190 when its blow leaves a structure at its LAST stage (iOS Ep2 @0x80034); an area
  // attack's resolution then lists that cell (Unit::onTick @0x78d4a for a Lightning bolt, @0x79056 for a blast cell)
  // and the attack's state 5 plays the dust ring (5017 #12) there once the bolts or the impact are over (renderOverlay
  // @0x75d24 / @0x76082). A single-target shot or blow never does.
  // A blow on a cell's structure by the weapon `u` uses there: an area weapon's raises that dust ring where it razes it.
  _structureBlow(u, tx, ty, share = 1, weapon) {
    const w = weapon != null ? weapon : weaponAt(u, manhattan(u, { tx, ty }));
    return AREA_WEAPONS.has(w) ? this._areaStructureHit(u, tx, ty, share, w) : this.structureHit(u, tx, ty, share, w);
  }
  _areaStructureHit(u, tx, ty, share, weapon, ringDelay = 0.45) {
    const k = key(tx, ty),
      was = this.razed.has(k);
    const changed = this.structureHit(u, tx, ty, share, weapon);
    if (changed && !was && this.razed.has(k))
      this.spawnFx("sand_puff", tx * this.tile + this.tile / 2, ty * this.tile + this.tile * 0.5, { delay: ringDelay });
    return changed;
  }
  // Remaining structure health of a damaged cell for the HUD bar: 0..1 of the current stage, or null when the cell is
  // untouched or already at its last stage.
  structureHealth(tx, ty) {
    const k = key(tx, ty);
    if (!this.structHp || !this.structHp.has(k) || structTrans(this.tileAt(tx, ty)) == null) return null;
    return clamp(this.structHp.get(k) / 256, 0, 1);
  }
  // A damaged structure adjacent to `u` a Craftsman can mend (Unit::canRepair → Map::isStructureRepairable: some
  // earlier stage transitions INTO this tile, i.e. getPreTransitionTile != -1).
  _repairStructureFor(u) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = u.tx + dx,
        y = u.ty + dy;
      if (this._structureRepairable(x, y)) return { tx: x, ty: y, px: x * this.tile, py: y * this.tile };
    }
    return null;
  }
  _structureRepairable(tx, ty) {
    return this.inBounds(tx, ty) && structPre(this.tileAt(tx, ty)) != null && !this.unitAt(tx, ty);
  }
  // Map::applyRepair (@0x80088, called from onTick with 20): +20 structure HP, and the cell steps back ONE stage.
  _repairStructure(tx, ty) {
    const tileVal = this.tileAt(tx, ty),
      prevTile = structPre(tileVal);
    if (prevTile == null) return false;
    const k = key(tx, ty);
    this.structHp.set(k, (this.structHp.has(k) ? this.structHp.get(k) : 256) + 20);
    this.tiles[ty * this.cols + tx] = prevTile;
    this.razed.delete(k);
    if (this.selected && !this.anim) {
      this.reach = this.computeReach(this.selected);
      this.recalcTargets();
    }
    return true;
  }
  // The tile-info card's structure line: material, damage stage, and how much of the current stage is left.
  _structureInfo(tx, ty) {
    const tileVal = this.tileAt(tx, ty),
      next = structTrans(tileVal),
      prevTile = structPre(tileVal);
    const armor =
      structArmor(tileVal) || (prevTile != null ? structArmor(prevTile) || structArmor(structPre(prevTile)) : 0); // a ruin is made of what stood there
    if (!armor || (next == null && prevTile == null)) return null;
    let stages = 0;
    for (
      let stageTile = tileVal, guard = 0;
      structTrans(stageTile) != null && guard < 8;
      stageTile = structTrans(stageTile), guard++
    )
      stages++;
    const health = this.structureHealth(tx, ty);
    return {
      material: armor === 14 ? "Stone" : "Wood",
      stage: next == null ? "Destroyed" : prevTile == null ? "Intact" : "Damaged",
      stagesLeft: stages,
      hp: health == null ? (next == null ? 0 : 100) : Math.round(health * 100),
    };
  }
  _after(delay, fn) {
    (this._delayed || (this._delayed = [])).push({ t: delay, fn });
  }
  // Lightning Storm bolt: a jagged white streak that stabs down onto a struck unit (distinct from Fireball).
  _spawnBolt(x, y) {
    const bolts = this.bolts || (this.bolts = []);
    const segs = [];
    let px = x,
      py = y - 12 * (this.tile / 44) * 9; // starts high above the target
    const count = 9;
    for (let i = 0; i <= count; i++) {
      segs.push([px, py]);
      px = x + (Math.random() - 0.5) * this.tile * 0.5 * (1 - i / count);
      py += (y - segs[0][1]) / count;
    }
    segs.push([x, y]);
    bolts.push({ segs, t: 0, life: 0.32 });
  }
  _drawBolt(g, bolt) {
    const k = bolt.t / bolt.life;
    g.save();
    g.globalAlpha = k < 0.5 ? 1 : (1 - k) / 0.5;
    for (const [col, lineW] of [
      ["rgba(180,210,255,0.6)", 6],
      ["#ffffff", 2.4],
    ]) {
      g.strokeStyle = col;
      g.lineWidth = lineW;
      g.lineJoin = "round";
      g.beginPath();
      bolt.segs.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.restore();
  }
  // Procedural debris burst layered on top of a sprite blast: chunks fly out under gravity + an expanding
  // shockwave ring, so a siege/cannon hit reads as a heavy impact, not just a decal. delay lets it land with the arc.
  // (Every look-only random here — burst particles, smoke, a bolt's zigzag, a projectile's spin — comes from Math.random,
  // never the game's dice: drawing them from this.rng made the dice depend on the effects shown.)
  _burst(x, y, opts = {}) {
    const particles = this.particles || (this.particles = []);
    const count = opts.count || 12,
      speed = opts.speed || 150,
      delay = opts.delay || 0;
    const cols = opts.colors || ["#6f665c", "#8a7f70", "#3f3934", "#d9a441"];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.2832,
        velocity = speed * (0.4 + Math.random() * 0.9);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * velocity,
        vy: Math.sin(a) * velocity - speed * 0.35,
        t: -delay,
        life: 0.45 + Math.random() * 0.45,
        r: 1.4 + Math.random() * (opts.big ? 3 : 2),
        color: cols[(Math.random() * cols.length) | 0],
        grav: 620,
      });
    }
    if (opts.ring !== false)
      particles.push({
        x,
        y,
        t: -delay,
        life: opts.big ? 0.42 : 0.32,
        ring: true,
        rMax: (opts.big ? 34 : 22) * (this.tile / 44),
      });
    if (opts.smoke !== false)
      for (let i = 0; i < (opts.big ? 4 : 2); i++)
        particles.push({
          x: x + (Math.random() - 0.5) * 10,
          y: y - Math.random() * 6,
          t: -delay,
          life: 0.6 + Math.random() * 0.4,
          smoke: true,
          r: 6 + Math.random() * 8,
          vy: -18 - Math.random() * 12,
        });
  }

  // Launch a ranged unit's shot at `tgt` (a unit or a phantom tile): the projectile in flight, the launch sound and
  // the landing effects (timed to the flight). Returns the flight time in seconds — the hit resolves when it lands —
  // or 0 for a unit with no projectile.
  fireProjectile(u, target) {
    if (!u.T.projectile) return 0;
    const tile = this.tile;
    const fromX = u.px + tile / 2,
      fromY = u.py + tile * 0.3;
    const dx = target.px + tile / 2,
      dy = target.py + tile * 0.3;
    const kind = u.T.projectile;
    // The catapult LOBS a heavy stone — a high, slow arc and a tumbling boulder; the cannon fires a flat, fast ball.
    // A BALLISTA bolt flies flat and FAST like a giant crossbow quarrel — short flight, almost no arc.
    // A thrown HAMMER tumbles on a modest arc — heavier and slower than an arrow, lighter than a boulder.
    // The TREBUCHET's Boulder is a stone too (5017 #27, the same grey rock): the same high slow arc and launch clip (33).
    const lobbed = kind === "stone";
    const dur = lobbed ? 0.55 : kind === "bolt" ? 0.22 : kind === "hammer" ? 0.34 : 0.25;
    // ARC HEIGHT (Unit::renderProjectile, iOS Ep2 @0x6fb34): lift = |dx|·u(1−u)/2 over the flight (u = 0..1), so the peak is
    // an EIGHTH of the shot's horizontal distance — a long sideways shot lobs high, a shot straight up or down the map
    // flies flat — and the Musket ball (weapon 18) never arcs. `arc` = that peak; _drawProjectile draws the parabola.
    const arc = kind === "bullet" ? 0 : Math.abs(dx - fromX) / 8;
    // arrows fly the real 009/010 sprite, oriented to the shot. A Fire Arrows archer looses the flaming arrow (#23) only
    // at a Flammable unit (changeState @0x6b8f8: ability 9 on the archer and 10 on the target), or at a building or
    // the ground (state 15, @0x6bd46); at anyone else it is the plain arrow (#22).
    const fire = kind === "arrow" && !!u.T.fireWeapon && (!target.T || !!target.T.flammable); // the SPRITE only — the launch clip is always the bow (35):
    // clip 23 (once mapped "arrow_fire") is played by Unit::_executeAction right after Map::removeUnit — a unit leaving
    // the field — so giving it to every Fire-Arrows archer shot made archers sound wrong.
    const angle = Math.atan2(dy - fromY, dx - fromX);
    // The CANNON (a ball that isn't a wizard's spell) fires with its boom; see _launchSound.
    const isCannon = kind === "ball" && !u.T.magic;
    this.projectiles.push({
      kind,
      x: fromX,
      y: fromY,
      tx: dx,
      ty: dy,
      t: 0,
      dur,
      arc,
      spin: Math.random() * 6.28,
      fire,
      ang: angle,
      cannon: isCannon,
      magic: !!u.T.magic,
      spell: u.T.magic ? u.spell || "fireball" : null,
      impactSnd: this._impactSound(u, kind, lobbed, isCannon),
      impactVol: lobbed ? 0.5 : 0.55,
    });
    // DELIBERATE DEVIATION — a blue sparkle as the Wizard channels (and, for an Ice Field, the bolt that carries it —
    // see _drawProjectile); the original's Fireball flies from no sparkle and its Ice Field and Lightning fly nothing
    if (u.T.magic) this.spawnFx("cast", fromX, fromY, { scale: 1.2 }); // ui/005
    const fireSnd = this._launchSound(u, kind, lobbed, isCannon);
    // Cannon boom (snd_001) cracks at the FRONT, so just cap its long tail. The musket gun clip (snd_014) has ~0.5s
    // of dead air BEFORE its crack (which peaks ~0.86s), so play it from an OFFSET so the shot bangs immediately —
    // otherwise a plain cap plays only the silence. Both are trimmed to a short punch; other clips play in full.
    const gun = fireSnd === "gun";
    this.audio.play(fireSnd, isCannon ? 0.6 : 0.5, 1, isCannon ? 0.6 : gun ? 0.9 : 0, gun ? 0.5 : 0);
    // DELIBERATE DEVIATION — the musket's muzzle flash; the original keeps that blast (#42–#45) for the Grapeshot
    if (kind === "bullet")
      this.spawnFx("flash", fromX + (u.face < 0 ? -tile * 0.3 : tile * 0.3), fromY, { scale: 0.7 });
    this._landingFx(u, target, kind, lobbed, dur);
    return dur;
  }

  // The clip a shot plays as it LANDS (null = none). The CANNON's boom is its MUZZLE report, so it plays at fire time.
  // As the area projectile lands (changeState leaving state 10, @0x6b5a6; Unit::onTick @0x781a8): a cannonball or a
  // fireball → 13 (the burst), the Catapult's Rocks → 25, the Trebuchet (unit type 24) → 32, the Ballistae → 52. A
  // direct shot (arrow, musket ball, hammer) lands without a clip.
  _impactSound(u, kind, lobbed, isCannon) {
    if (isCannon || (u.T.magic && (u.spell === "fireball" || !u.spell))) return "explosion";
    if (lobbed) return u.type === "trebuchet" ? "boulder_hit" : "rock_hit";
    if (kind === "bolt") return "bolt_hit";
    return null;
  }

  // The clip a shot plays as it LEAVES — each the game's own launch clip (changeState shoot states). Magic units
  // (wizards) fire a "ball" projectile but it's a SPELL, not a cannon: each of the three spells gets its own real
  // clip — Lightning → thunder (snd_019), Fireball → spellfire (snd_002), Ice → spell (snd_011). The cannon FIRES with
  // its boom (snd_001); the musket with snd_014 (gun). The CATAPULT/trebuchet stone uses the lob whoosh (snd_026 —
  // the record the game fires for a rock).
  _launchSound(u, kind, lobbed, isCannon) {
    if (u.T.magic) {
      if (u.spell === "lightning") return "thunder";
      if (u.spell === "ice") return "spell";
      return "spellfire"; // default/undefined = Fireball → spellfire (snd_002); only Ice uses "spell" (snd_011)
    }
    if (isCannon) return "cannon";
    if (lobbed) return "catapult";
    if (kind === "bullet") return "gun";
    if (kind === "bolt") return "ballista";
    if (kind === "hammer") return "hammer";
    return "arrow";
  }

  // The effects where a shot lands, each delayed by the flight time `dur`. Arrows and bullets get no extra spark —
  // the hit itself draws the impact FX (in _applyHit) as the shot lands.
  _landingFx(u, target, kind, lobbed, dur) {
    const tile = this.tile;
    const hitX = target.px + tile / 2,
      hitY = target.py + tile * 0.42;
    const ORTHO = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    if (lobbed) {
      // A stone shatters (+ rubble): the Trebuchet's Boulder in the rock burst (5017 #36, android z_025), the
      // Catapult's Rocks in the earth burst (#34) — startAreaAttack's impact strips (@0x72e7a / @0x72ff4).
      const rocks = this._weaponAt(u, manhattan(u, target)) === 20;
      this.spawnFx(rocks ? "dust" : "rockblast", hitX, hitY + tile * 0.06, { delay: dur, scale: 1.0 });
      this._burst(hitX, hitY, {
        delay: dur,
        big: true,
        count: 18,
        speed: 190,
        colors: ["#6f665c", "#8a7f70", "#3f3934", "#b9b0a2"],
      });
    } else if (kind === "ball") {
      // Cannon shell & the wizard's FIREBALL burst in fire; ice/lightning do NOT (their own area FX resolve
      // separately in resolveDamage — a blue ice bolt shouldn't explode in flame).
      if (!u.T.magic || u.spell === "fireball" || !u.spell) {
        // the Fireball bursts in the explosion (5017 #35, android z_024), the Cannonball in the fire burst (#37) —
        // startAreaAttack's impact strips (@0x72bd6 / @0x72f24)
        this.spawnFx(u.T.magic ? "blast" : "fire", hitX, hitY, { delay: dur, scale: 1.0 });
        // DELIBERATE DEVIATION — the flames a Wizard's Fireball leaves behind (not in the original)
        if (u.T.magic) this.spawnFx("fire", hitX, hitY + tile * 0.04, { delay: dur + 0.12 });
        this._burst(hitX, hitY, {
          delay: dur,
          big: false,
          count: 11,
          speed: 140,
          colors: ["#2b2b2b", "#555555", "#d29922", "#8a8a8a"],
        });
        // FIREBALL is a CROSS spell but NOT areaAttack (spares allies), so the area loop below is skipped
        // for it — spawn the z_024 burst on each of the 4 orthogonal cells here so every unit in the cross gets
        // its own fiery burst (one z_024 per cell, not a single explosion).
        if (u.T.magic) {
          for (const [offX, offY] of ORTHO) {
            const nx = target.tx + offX,
              ny = target.ty + offY;
            if (this.inBounds(nx, ny))
              this.spawnFx("blast", nx * tile + tile / 2, ny * tile + tile * 0.42, { delay: dur + 0.03, scale: 1.0 });
          }
        }
      }
    } else if (kind === "bolt") {
      // BALLISTA Piercing Bolt: a sharp cyan crack where it strikes, and again on each tile it punches through
      // (help 758 — three squares in a row). No area burst; the pierce is a straight line, not a blast.
      this.spawnFx("ballistahit", hitX, hitY, { delay: dur, scale: 1.15 });
      const pierceStep = u.T.pierce ? this._ballistaStep(u, target.tx, target.ty) : null;
      if (pierceStep) {
        for (let step = 1; step <= 2; step++) {
          const nx = target.tx + pierceStep.fx * step,
            ny = target.ty + pierceStep.fy * step;
          if (this.inBounds(nx, ny))
            this.spawnFx("ballistahit", nx * tile + tile / 2, ny * tile + tile * 0.42, {
              delay: dur + step * 0.05,
              scale: 1.0,
            });
        }
      }
    }
    // AREA shot: T.areaAttack === T.crossBlast (catapult Rock/Pitch = weapon 20/22), so the burst is a + CROSS —
    // only the 4 ORTHOGONAL neighbours, NOT the 8-cell 3×3 square. The Rocks burst in the earth burst (#34) on each.
    // (The cannon & trebuchet are single-target — areaAttack false — so only their centre burst plays.)
    if (u.T.areaAttack && (kind === "stone" || kind === "ball")) {
      for (const [offX, offY] of ORTHO) {
        const nx = target.tx + offX,
          ny = target.ty + offY;
        if (!this.inBounds(nx, ny)) continue;
        this.spawnFx(kind === "stone" ? "dust" : "blast", nx * tile + tile / 2, ny * tile + tile / 2, {
          delay: dur + 0.05,
          scale: 1.0,
        });
      }
    }
  }
}
