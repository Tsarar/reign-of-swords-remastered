/* ============================================================
   Reign of Swords — the unit roster (static game data).
   The 23 real unit types with their sprite-strip layout + hand-written display
   fallbacks, then the REAL combat model merged in from data/combat-data.js (weapon /
   armour / range / abilities carved from the iOS unit table 5010). Pure data —
   no game state; the Game engine imports UNIT_TYPES from here.
   ============================================================ */

import {
  WEAPON_DMG,
  WEAPON_RANGE,
  WEAPON_NAME,
  WEAPON_DESC,
  MINION_WEAPON,
  ARMOUR_NAME,
  UNIT_COMBAT,
  UNIT_AL,
} from "./combat-data.js";

// ---- Unit roster (real game units, turn-based stats) -------------------
// Each uses a DISTINCT extracted sprite from the original (23 unit strips). Combat stats
// (weapon/armour/rating/range/damage) are the REAL values carved from the iOS unit table 5010 + the damage code
// in classes.dex (La/q). They're merged in below from data/combat-data.js — the hand-written atk/def here are only a
// fallback and are OVERWRITTEN with the real display numbers.
export const UNIT_TYPES = {
  militiamen: {
    name: "Militiamen",
    sprite: "militiamen",
    frames: 4,
    frameW: 88,
    frameH: 88,
    hitFrame: 2,
    atk: 40,
    def: 0.05,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "spear",
  },
  footmen: {
    name: "Footmen",
    sprite: "footmen",
    frames: 5,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 48,
    def: 0.18,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "spear",
  },
  swordsmen: {
    name: "Swordsmen",
    sprite: "swordsmen",
    frames: 5,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 55,
    def: 0.22,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "melee",
  },
  greatswordsmen: {
    name: "Greatswordsmen",
    sprite: "greatswordsmen",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 66,
    def: 0.15,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "axe",
    ability: "Last Strike — the best melee damage, but swings last; Formation",
  },
  pikemen: {
    name: "Pikemen",
    sprite: "pikemen",
    frames: 6,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 45,
    def: 0.12,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "spear",
    ability:
      "Pike Wall — end a turn without attacking to brace: strike first when attacked; always first against cavalry. Formation",
  },
  halberdiers: {
    name: "Halberdiers",
    sprite: "halberdiers",
    frames: 8,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 60,
    def: 0.1,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "axe",
  },
  // Ranged foot carry TWO attacks in one strip: a bow/gun shot AND a dagger melee. The engine picks by distance —
  // a shot at range plays [rangedFrom..rangedTo] (loose at rangedHit); an enemy point-blank plays the dagger melee
  // [meleeFrom..meleeTo] (strike at hitFrame), the short-sword damage, no projectile.
  archers: {
    name: "Archers",
    sprite: "archers",
    frames: 11,
    frameW: 88,
    frameH: 88,
    rangedFrom: 0,
    rangedTo: 6,
    rangedHit: 5,
    meleeFrom: 7,
    meleeTo: 10,
    hitFrame: 9,
    atk: 46,
    def: 0.05,
    move: 4,
    range: 2,
    minRange: 1,
    kind: "ranged",
    projectile: "arrow",
    ability: "Fire Arrows — ×2 vs flammable war engines; Move or Shoot (not both)",
  },
  crossbowmen: {
    name: "Crossbowmen",
    sprite: "crossbowmen",
    frames: 16,
    frameW: 88,
    frameH: 88,
    rangedFrom: 0,
    rangedTo: 10,
    rangedHit: 2,
    meleeFrom: 11,
    meleeTo: 15,
    hitFrame: 13,
    atk: 52,
    def: 0.1,
    move: 4,
    range: 2,
    minRange: 1,
    kind: "ranged",
    projectile: "arrow",
    ability: "Move or Shoot — may move OR fire in a turn, not both; Formation",
  },
  musketeers: {
    name: "Musketeers",
    sprite: "musketeers",
    frames: 7,
    frameW: 88,
    frameH: 88,
    rangedFrom: 0,
    rangedTo: 3,
    rangedHit: 0,
    meleeFrom: 4,
    meleeTo: 6,
    hitFrame: 5,
    atk: 56,
    def: 0.08,
    move: 4,
    range: 3,
    minRange: 1,
    kind: "ranged",
    projectile: "bullet",
    ability: "Move or Shoot — may move OR fire in a turn, not both; Formation",
  },
  knights: {
    name: "Knights",
    sprite: "knights",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 54,
    def: 0.24,
    move: 8,
    range: 1,
    minRange: 1,
    kind: "cavalry",
  },
  cavalry: {
    name: "Cavalry",
    sprite: "cavalry",
    frames: 6,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 48,
    def: 0.15,
    move: 8,
    range: 1,
    minRange: 1,
    kind: "cavalry",
  },
  raiders: {
    name: "Raiders",
    sprite: "raiders",
    frames: 6,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 46,
    def: 0.1,
    move: 8,
    range: 1,
    minRange: 1,
    kind: "cavalry",
    ability:
      "Charge — +30 on a foe at least 3 tiles away down a straight lane, no counter-attack; rides on through the foot troops it cuts down",
  },
  griffon: {
    name: "Griffon Riders",
    sprite: "griffon",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 52,
    def: 0.15,
    move: 8,
    range: 1,
    minRange: 1,
    kind: "cavalry",
    ability: "Fear — foes must pass a courage check to attack it, or they balk; Charge",
  },
  cannon: {
    name: "Cannon",
    sprite: "cannon",
    frames: 8,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 70,
    def: 0.05,
    move: 3,
    range: 3,
    minRange: 2,
    kind: "siege",
    projectile: "ball",
    ability:
      "Cannonball — a single shell at long range (3–10), no splash — the heaviest single hit; it may DEVIATE one tile (10% into cover, 35% in the open, more vs cavalry and fliers). Move or Shoot",
  },
  catapult: {
    name: "Catapult",
    sprite: "catapult",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 64,
    def: 0.05,
    move: 3,
    range: 4,
    minRange: 2,
    kind: "siege",
    projectile: "stone",
    ability: "Barrage — rocks hit a wide + area; the lobbed stone may DEVIATE one tile (35% of shots). Move or Shoot",
  },
  shamans: {
    name: "Shamans",
    sprite: "shamans",
    frames: 5,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 46,
    def: 0.05,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "spear",
    ability: "Spirit Shroud — allies within 4 tiles gain +15 attack; enemies lose 15",
  },
  druids: {
    name: "Druids",
    sprite: "druids",
    frames: 5,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 50,
    def: 0.08,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "axe",
    ability:
      "Greater Shapeshift — become a Stag, Great Eagle or Guardian Bear, gaining its movement and combat; it keeps the form until it shapeshifts again",
  },
  wizards: {
    name: "Wizards",
    sprite: "wizards",
    frames: 8,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 54,
    def: 0.05,
    move: 4,
    range: 3,
    minRange: 1,
    kind: "ranged",
    projectile: "ball",
    magic: true,
    splash: true,
    ability: "Fireball — area magic (weapon 25) that gets through most armour",
  },
  priests: {
    name: "Priests",
    sprite: "priests",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 42,
    def: 0.08,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "melee",
    heal: true,
    ability: "Prayer: Heal, Prayer: Shield, Prayer: Retribution",
  },
  greateagle: {
    name: "Great Eagles",
    sprite: "greateagle",
    frames: 5,
    frameW: 88,
    frameH: 88,
    hitFrame: 2,
    atk: 50,
    def: 0.12,
    move: 10,
    range: 1,
    minRange: 1,
    kind: "cavalry",
  },
  bear: {
    name: "Guardian Bear",
    sprite: "bear",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 3,
    atk: 58,
    def: 0.1,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "axe",
    ability: "Fear — foes must pass a courage check to attack it, or they balk",
  },
  stag: {
    name: "Stag",
    sprite: "stag",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 52,
    def: 0.1,
    move: 8,
    range: 1,
    minRange: 1,
    kind: "cavalry",
  },
  // Hero uses his full attack strip (android 004_768x96): sword raise → windup → green energy slash (f5) → recover.
  king: {
    name: "Hero",
    sprite: "king",
    frames: 8,
    frameW: 96,
    frameH: 96,
    hitFrame: 5,
    atk: 55,
    def: 0.25,
    move: 8,
    range: 1,
    minRange: 1,
    kind: "hero",
    ability: "Battle Standard — allies within 4 tiles gain +15 attack; First Strike",
  },
  // Recovered original units (real stats from 5010). Rangers use a COMPOSITE strip: the dedicated bow-draw sheet
  // (android 033, 0-10) then the FULL sword melee sheet (032, 0-6). Fights at BOTH ranges (minRange 1): a shot plays
  // the BOW sub-anim [0..10] and looses at rangedHit; an enemy point-blank plays the sword MELEE [11..17], strike f14.
  rangers: {
    name: "Rangers",
    sprite: "rangers",
    frames: 18,
    frameW: 88,
    frameH: 88,
    rangedFrom: 0,
    rangedTo: 10,
    rangedHit: 6,
    meleeFrom: 11,
    meleeTo: 17,
    hitFrame: 14,
    atk: 46,
    def: 0.1,
    move: 4,
    range: 2,
    minRange: 1,
    kind: "ranged",
    projectile: "arrow",
    ability: "Shoot-and-Move — fire AND reposition the same turn; Stealth — hides in woods & hills",
  },
  // Android's mounted-archer attack strip (041), 4 frames: f0 nock, f1 full draw, f2 loose (arrow looses at hitFrame 2),
  // f3 sabre up. Play the FULL 4-frame strip so the shot doesn't look cut.
  horsebowmen: {
    name: "Horse Bowmen",
    sprite: "horsebowmen",
    frames: 4,
    frameW: 88,
    frameH: 88,
    rangedFrom: 0,
    rangedTo: 3,
    rangedHit: 2,
    hitFrame: 2,
    atk: 46,
    def: 0.1,
    move: 8,
    range: 2,
    minRange: 2,
    kind: "ranged",
    projectile: "arrow",
    ability: "Shoot-and-Move — fires as it rides: every other tile, an arrow at the nearest foe in range not yet shot",
  },
  trebuchet: {
    name: "Trebuchet",
    sprite: "trebuchet",
    frames: 7,
    frameW: 88,
    frameH: 88,
    hitFrame: 4,
    atk: 64,
    def: 0.05,
    move: 3,
    range: 6,
    minRange: 4,
    kind: "siege",
    projectile: "stone",
    ability:
      "A single heavy boulder lobbed over great range (4–10); it lands on ONE tile — no splash — but the high arc may DEVIATE one tile (15% into cover, 45% in the open, more vs cavalry and fliers). Move or Shoot",
  }, // Boulder = the grey tumbling rock (5017 #27, the Catapult's #25 again: startAreaAttack @0x72e70 / changeState @0x6b98a)
  // ===== EPISODE II units (ios-episode-2 5010). Combat stats merge in from data/combat-data.js. `sprite` here is a
  // PLACEHOLDER cloned from the nearest Ep1 unit so they render/decode now — the real Ep2 sprites (from
  // extracted-assets/ios-episode-2/units) are the next step. New-ability mechanics (Build/Repair/Conjure/
  // Detonate/Absorb/Quicksand/Life Steal/Arc/Leashing/Siege Armor) are not yet wired. =====
  craftsmen: {
    name: "Craftsmen",
    sprite: "craftsmen",
    frames: 20,
    frameW: 72,
    frameH: 72,
    rangedFrom: 0,
    rangedTo: 8,
    rangedHit: 7,
    meleeFrom: 9,
    meleeTo: 19,
    hitFrame: 14,
    atk: 16,
    def: 0.05,
    move: 4,
    range: 4,
    minRange: 1,
    kind: "ranged",
    projectile: "hammer",
    ability:
      "Build & Repair — build a healing village once per battle; repair adjacent war engines. Hammer Throw (2–4) at range, a hammer swing up close. Move or Shoot.",
  },
  ballistae: {
    name: "Ballistae",
    sprite: "ballistae",
    frames: 12,
    frameW: 72,
    frameH: 72,
    hitFrame: 6,
    atk: 24,
    def: 0.05,
    move: 3,
    range: 8,
    minRange: 1,
    kind: "siege",
    projectile: "bolt",
    ability:
      "Piercing Bolt — a bolt that punches through 3 tiles in a row (3–8); point-blank Shock hits all 4 adjacent tiles; Siege Armor; Move or Shoot.",
  },
  conjurer: {
    name: "Conjurer",
    sprite: "conjurer",
    frames: 13,
    frameW: 72,
    frameH: 72,
    hitFrame: 6,
    atk: 36,
    def: 0.05,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "melee",
    ability:
      "Conjure — summons up to two Sappers/Bodyguards, each leashed within range 8. Fights hand-to-hand with a Conjured Blade (weapon 31).",
  },
  sapper: {
    name: "Sapper",
    sprite: "sapper",
    frames: 9,
    frameW: 72,
    frameH: 72,
    hitFrame: 4,
    atk: 63,
    def: 0.1,
    move: 6,
    range: 1,
    minRange: 1,
    kind: "spear",
    ability: "Detonate — self-destructs for ×1.25 weapon damage to all adjacent units and structures.",
  },
  bodyguard: {
    name: "Bodyguard",
    sprite: "bodyguard",
    frames: 11,
    frameW: 72,
    frameH: 72,
    hitFrame: 5,
    atk: 63,
    def: 0.2,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "melee",
    ability: "Absorb — can be sacrificed to shield its Conjurer from the next damaging attack.",
  },
  dunesirens: {
    name: "Dune Sirens",
    sprite: "dunesirens",
    frames: 11,
    frameW: 72,
    frameH: 72,
    hitFrame: 5,
    atk: 42,
    def: 0.15,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "melee",
    ability: "Quicksand — turns nearby ground to quicksand: entrants stop and take 5 damage. Sirens are immune.",
  },
  bloodgorgers: {
    name: "Blood Gorgers",
    sprite: "bloodgorgers",
    frames: 12,
    frameW: 72,
    frameH: 72,
    hitFrame: 6,
    atk: 41,
    def: 0.05,
    move: 4,
    range: 1,
    minRange: 1,
    kind: "melee",
    ability: "Life Steal — while wounded, each Bite heals it by 1.5× the damage dealt; always strikes last.",
  },
};

// ---- Merge the REAL combat model (from data/combat-data.js) into UNIT_TYPES --------
// weapon/weapon2/armour/rating come byte-for-byte from unit table 5010; range is the weapon's real min/max;
// atk/def become the display numbers derived from the real weapon×armour table. Damage itself is computed from
// WEAPON_DMG (see computeDamage in the engine).
const _wr = (w) => WEAPON_RANGE[w] || [1, 1];
for (const k in UNIT_TYPES) {
  const c = UNIT_COMBAT[k];
  if (!c) continue;
  const T = UNIT_TYPES[k];
  T.weapon = c.weapon;
  T.weapon2 = c.weapon2;
  T.armour = c.armour;
  T.rf = c.rf;
  T.rating = c.rating;
  if (c.move != null) T.move = c.move; // movement points = real unit-table field B[0]
  // real range = the union of both weapon bands (ranged units melee with their side-arm inside min range;
  // a cannon fires Cannonball far & Grapeshot up close), so reach/targeting spans both.
  const r1 = _wr(c.weapon),
    r2 = c.weapon2 ? _wr(c.weapon2) : r1;
  T.minRange = Math.min(r1[0], r2[0]);
  T.range = Math.max(r1[1], r2[1]);
  T.atk = c.dispAtk;
  T.def = c.dispDef / 100; // display only
  T.weaponName = MINION_WEAPON[k] ? MINION_WEAPON[k].name : WEAPON_NAME[c.weapon];
  T.weaponDesc = MINION_WEAPON[k] ? MINION_WEAPON[k].desc : WEAPON_DESC[c.weapon];
  // The weapon SLOTS as the original's View Unit screen lists them: UnitSelector::createUnitInfoMenu (@0x82c38) loops
  // over both record slots, skipping an empty one — name string 593 + weapon, description 627 + weapon (the Sapper
  // and the Bodyguard read their own Knives / Armblades). A Wizard's record holds only its Wizard Blade: the spells
  // are its Magic, not a weapon slot (the override below is for the engine, not for this list).
  T.weaponSlots = [c.weapon, c.weapon2]
    .filter((w) => w)
    .map((w) => {
      const [min, max] = _wr(w);
      const minion = MINION_WEAPON[k];
      return { name: minion ? minion.name : WEAPON_NAME[w], desc: minion ? minion.desc : WEAPON_DESC[w], min, max };
    });
  T.armourName = ARMOUR_NAME[c.armour];
  T.abilities = c.abilities || [];
  T.al = UNIT_AL[k] != null ? UNIT_AL[k] : 1; // real movement category (5010 byte 1): 0 fly·1 skirmish·2 formation·3 cavalry·4 siege
  T.formation = !!c.formation;
  T.flammable = !!c.flammable;
  T.fireWeapon = !!c.fireWeapon;
  T.standard = !!c.standard;
  T.shroud = !!c.shroud;
  T.pikeWall = !!c.pikeWall;
  T.lastStrike = !!c.lastStrike;
  T.hasCharge = !!c.charge;
  // EPISODE II abilities, keyed by unit type in the iOS engine (see the ability RE notes). warEngine = the al==4
  // siege movement class (isSiegedAmor checks it); the rest are genuine per-unit flags on the Ep2 units only.
  T.warEngine = T.al === 4 || !!c.warEngine; // catapult/trebuchet/cannon/ballistae
  T.siegeArmor = !!c.siegeArmor; // Ballistae (30): has Siege Armor + grants it to adjacent war engines
  T.absorb = !!c.absorb; // Bodyguard (35): can be sacrificed to lay a one-hit Absorb buff on its Conjurer
  T.lifeSteal = !!c.lifeSteal; // Blood Gorgers (35): heal by Bite damage (Life Steal)
  T.quicksand = !!c.quicksand; // Dune Sirens (34): lay quicksand tiles (Quicksand)
  T.detonate = !!c.detonate; // Sapper (32): can self-destruct (Detonate), damaging adjacent
  T.pierce = !!c.pierce; // Ballistae (30): Piercing Bolt hits 3 squares in a row
  T.conjure = !!c.conjure; // Conjurer (31): summons Sapper/Bodyguard children (Conjure)
  T.build = !!c.build; // Craftsmen (29): build a village on open ground (Build)
  T.repair = !!c.repair; // Craftsmen (29): repair an adjacent damaged war engine (Repair)
  // more real abilities (index from data/combat-data.js): 1 First Strike, 4 Fearless, 7 Move-or-Shoot,
  // 3 Blast Area / 24 Barrage / 25 Low Arc (siege area), 14 Fear. Prayer is 19 (Old Priest) / 23 (Priest);
  // ability 18/22 is FIREBALL (the Wizard), NOT Prayer — do not include 22 here or wizards wrongly gain Retribution.
  const A = T.abilities;
  T.firstStrike = A.includes(1);
  T.moveShoot = A.includes(7);
  // HARASSER = has Move-or-Shoot(7) or Shoot-and-Move(8) — the decompiled `x()` stand-off band is gated on
  // `g(7)||g(8)`, so only these kite. In practice EVERY ranged weapon carries 7 or 8, so all real ranged units are
  // harassers (Horse Bowmen via Short Bow → Shoot-and-Move). Kept distinct so a non-harasser ranged unit advances.
  T.harasser = A.includes(7) || A.includes(8);
  T.shootMove = A.includes(8); // Shoot-and-Move (Short Bow): Attack after a move / Move after an attack; Horse Bowmen also fire while riding (engine/input _hbRideStep)
  // Siege/spell shot SHAPE — keyed by the WEAPON, per the decompiled offset table `La/q.k(weapon)` (the ability
  // NAMES are misleading): Rock/Catapult(20), Pitch(22) and Fireball(25) fire a + CROSS (centre + 4 orthogonal);
  // Lightning(26)=3×3 and Ice/Bolt(27)=2×2 (both resolved by spell name); Boulder/Trebuchet(21) and Cannonball(23)
  // are SINGLE-tile. Grapeshot(24) is the ONE exception — Unit::setGrapeShot makes it a 4-cell T (a 3-wide row + 1 beyond; the
  // cannon's point-blank shot). So the catapult sprays a cross, the trebuchet lobs one boulder, and the cannon
  // fires a single Cannonball at range but rakes a grapeshot cone up close.
  const _w = T.weapon;
  T.crossBlast = _w === 20 || _w === 22 || _w === 25; // catapult / pitch / fireball — + cross
  T.grapeshot = _w === 24 || T.weapon2 === 24; // cannon: point-blank Grapeshot(24) 4-cell T (Unit::setGrapeShot)
  T.blastArea = false; // no siege 3×3 (that mapping was wrong)
  T.lowArc = A.includes(26); // Low Arc (cannon, ability 26) — informational (Field Manual)
  T.arc = A.includes(29); // Arc (trebuchet / ballistae, ability 29) — informational (Field Manual)
  T.areaAttack = T.crossBlast; // only the cross weapons spray an area
  // DEVIATION — Unit::_executeAction (iOS Ep2 @0x7f082 / @0x7f8a0): a Barrage weapon (tag 25, the catapult's Rock)
  // drifts on a flat 35% (randomizeAttackLocation(35)); an Arc (29) or Low Arc (26) weapon, and anything the Cannon
  // fires, rolls getDeviationChance — except the Ballistae (unit type 30), which is excluded outright. So the catapult,
  // the trebuchet (Boulder, Arc) and the cannon (Cannonball, Low Arc) may drift; the ballistae never does.
  T.mayDeviate = k !== "ballistae" && (A.includes(25) || A.includes(26) || A.includes(29) || k === "cannon");
  T.prayer = A.includes(19) || A.includes(23);
  T.shapeshift = A.includes(20) || A.includes(21); // Greater Shapeshift (Druids)
  T.spot = A.includes(6); // Spot (reveals hidden units)
  T.fear = A.includes(14); // Fear (Griffon/Bear): a unit attacking it must pass a COURAGE check or balk (Unit::attack)
  T.fearless = A.includes(4); // Fearless: immune to Fear's courage check (attacks without balking) — no unit in either episode's data carries it
  T.stealth = A.includes(16); // Stealth (hide in defensive terrain)
  if (T.crossBlast) T.splash = true; // catapult/pitch/fireball spray a + cross (cannon/trebuchet stay single)
}
// COURAGE rating — the unit record's byte 7 (Unit::readTypeInfo stores it at Unit+0x188, the field getCourage switches
// on; byte 8 at +0x18c is the ATTACK rating getSkill uses, `rating` in combat-data). Identical in both episodes' 5010.
// getCourage maps tier 0..5 → 35 / 50 / 65 / 85 / 100 / 125.
const COURAGE_TIER = {
  militiamen: 1,
  footmen: 2,
  halberdiers: 2,
  swordsmen: 2,
  cavalry: 3,
  pikemen: 3,
  greatswordsmen: 3,
  knights: 4,
  king: 5,
  griffon: 3,
  archers: 1,
  rangers: 3,
  crossbowmen: 1,
  musketeers: 1,
  horsebowmen: 3,
  raiders: 2,
  shamans: 3,
  druids: 4,
  wizards: 4,
  priests: 4,
  catapult: 1,
  trebuchet: 1,
  cannon: 1,
  greateagle: 4,
  bear: 4,
  stag: 4,
  craftsmen: 1,
  ballistae: 1,
  conjurer: 3,
  sapper: 5,
  bodyguard: 5,
  dunesirens: 3,
  bloodgorgers: 2,
};
for (const k in COURAGE_TIER) if (UNIT_TYPES[k]) UNIT_TYPES[k].courage = COURAGE_TIER[k];
UNIT_TYPES.druids.shapeshiftForms = ["stag", "greateagle", "bear"]; // string 542: Stag / Great Eagle / Guardian Bear
// …and each form shapeshifts on (the menu GameScreen offers types 20/26/27/28; Android a.g): the Druid first, then the
// other two beasts — "druids" stands for the unit's own Druid form.
UNIT_TYPES.stag.shapeshiftForms = ["druids", "greateagle", "bear"];
UNIT_TYPES.greateagle.shapeshiftForms = ["druids", "stag", "bear"];
UNIT_TYPES.bear.shapeshiftForms = ["druids", "stag", "greateagle"];
UNIT_TYPES.wizards.canLightning = true; // alternate spell: Lightning Storm (weapon 26)
UNIT_TYPES.wizards.splash = true; // Fireball is a + CROSS area hit — enables the splash resolve + the blast preview
// Movement traits (help "MOVEMENT"): flyers ignore terrain (Griffon Riders / Great Eagles); wizards Teleport
// (ignore all terrain but water). NOTE: Raiders are NOT skirmishers — the real unit table's movement category
// byte (al) puts them at al=3 = Cavalry, same as Knights/Cavalry (confirmed byte-for-byte in the iOS
// reignofswords.dat AND the Android classes.dex). So they get the cavalry forest penalty, not a skirmish bonus.
// The game's own "Skirmish" movement type (help: "loose groups, less terrain penalty") maps to the al=1 loose
// foot, not to Raiders; it is left unassigned here until we choose to model al-based movement classes.
UNIT_TYPES.griffon.fly = true;
UNIT_TYPES.greateagle.fly = true;
UNIT_TYPES.wizards.teleport = true;
// Roles the original keys on the unit type, named so the rules say what a unit IS for:
//  summoned — a Conjurer's Sapper / Bodyguard (types 32/33): leashed to it, never take a portal, cost no deploy points;
//  mountedArcher — Horse Bowmen: the ride that shoots as it goes (engine/input _hbRideStep) and its AI.
for (const k of ["sapper", "bodyguard"]) if (UNIT_TYPES[k]) UNIT_TYPES[k].summoned = true;
UNIT_TYPES.horsebowmen.mountedArcher = true;
// Wizards attack with their **Magic** ability's spell (Fireball, area, r2-7). This is the ONE weapon override: the
// record stores only a Wand (r1) in the weapon slots — the spell is a separate ability — so without this a Wizard
// couldn't cast at range. (Cannon needs no override: it carries Grapeshot r1 + Cannonball r3-10 and picks by distance.)
UNIT_TYPES.wizards.weapon = 25;
UNIT_TYPES.wizards.weapon2 = 7; // Fireball at range; the record's Wand (r1) is the point-blank jab
{
  const r = _wr(25);
  UNIT_TYPES.wizards.minRange = 1;
  UNIT_TYPES.wizards.range = r[1]; // 1..7 — Wand at 1, spell at 2-7 (like the Cannon's Grapeshot/Cannonball)
  UNIT_TYPES.wizards.weaponName = WEAPON_NAME[25];
  UNIT_TYPES.wizards.weaponDesc = WEAPON_DESC[25];
  UNIT_TYPES.wizards.fireWeapon = true; // Fireball is fire (×2 vs Flammable)
  UNIT_TYPES.wizards.atk = Math.round((WEAPON_DMG[25][3] * UNIT_TYPES.wizards.rf) / 100);
}

// ---- Real per-unit deploy points (unit table 5010) ---------------------
// king/Hero = 500 (confirmed from the 5010 unit table). Used by the deploy roster (engine) and the AI value
// heuristic (ai/ai `aiValue` = ((cost-50)*50/450)+50 → 50 cheapest .. 100 Hero).
export const DEPLOY_COST = {
  militiamen: 50,
  footmen: 75,
  swordsmen: 125,
  greatswordsmen: 150,
  pikemen: 150,
  halberdiers: 125,
  archers: 100,
  crossbowmen: 125,
  musketeers: 175,
  rangers: 200,
  horsebowmen: 250,
  knights: 300,
  cavalry: 200,
  raiders: 100,
  catapult: 300,
  trebuchet: 300,
  cannon: 400,
  shamans: 200,
  druids: 300,
  wizards: 500,
  priests: 300,
  griffon: 400,
  king: 500,
  // EPISODE II unit deploy points — byte-exact from record 5010 (cost = seg[15:17], BE u16). Sapper & Bodyguard
  // are 0 (they are summoned by the Conjurer, never deployed). Safe for Ep1 (it never fields these).
  craftsmen: 300,
  ballistae: 400,
  conjurer: 500,
  sapper: 0,
  bodyguard: 0,
  dunesirens: 250,
  bloodgorgers: 100,
};

// ---- Battlefield tall tiles + faction colours / crests -----------------
// Tiles whose art RISES above the ground, drawn ~1.3× tall (anchored at the cell base): trees (0,1,4), the spiked
// wooden barricades (7-30) and the stone-castle pieces (35-56). Anchoring at the base keeps every unit's feet on
// the same ground line.
export const TALL_TILES = new Set([
  0, 1, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 35, 36, 37, 38,
  39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
]);
// THE ORIGINAL COLOUR MECHANISM (user-confirmed from Carrone 3): TWO separate colours per unit — (1) the UNIT tint
// = its group's HERALDRY banner colour ("your colours to represent you"); (2) the HP number = the ally/enemy "unit
// strength colour" (help 659: allies Green/Blue/Cyan, enemies Red/Orange/Yellow), a distinct shade per group.
// Enemy strength colours — Red / Orange / Yellow — cycled by group so independent enemy armies read apart.
export const GROUP_BANDS = ["212,64,54", "230,142,40", "218,192,66", "196,88,44", "234,112,30", "176,158,48"];
export const ALLY_HP = ["96,204,96", "72,140,236", "58,190,206", "126,206,150", "150,214,122"]; // green(player), blue, cyan, mint…
export const ENEMY_HP = ["226,72,60", "236,142,46", "226,202,72", "196,106,54", "212,122,40"]; // red, orange, yellow, brown…
// Allied AI armies — Green / Blue / Cyan (help "ALLIES"). Distinct from your own blue-tint and the enemy reds.
export const ALLY_BANDS = ["70,172,96", "64,124,212", "58,184,192", "120,176,82", "72,152,164"];
export const ALLY_CRESTS = ["imperial", "aguilleon", "sangsoleil", "bordavia", "rukiev"]; // allied faction devices (crest art)
// HERALDRY banner colour (the UNIT tint) keyed by the real banner index (scenario group attrs[4]). User-confirmed
// from Carrone 3: 1 Rebel blue, 2 Carrone red, 7 Pellus yellow, 8 Emperor purple. Banner 0 = generic → strength colour.
export const BANNER_TINCTURE = {
  1: "70,110,214",
  2: "206,66,56",
  3: "96,168,110",
  4: "150,60,60",
  6: "202,160,70",
  7: "228,196,66",
  8: "150,90,200",
};
// Heraldic tinctures (mirror HeraldryShield) → an "r,g,b" army-tint the player's units wear. Enemies wear strength colour.
// THE ORIGINAL UNIT PALETTE SWAP (Context::createUnitImages, both episodes). Unit art carries two 3-shade key ramps:
// _palettePrimary (the greens) and _paletteSecondary (the blues). Each group's units are re-palettised: every primary
// key → the 3 shades of its FIRST heraldry colour (scenario attrs[0] = symbolColor), every secondary key → its SECOND
// (attrs[1] = bgColor). The ten ramps are _paletteColors @0x91d54, indexed like the heraldry tinctures.
export const UNIT_KEY_PRIMARY = [0x00d40b, 0x00a606, 0x007800];
export const UNIT_KEY_SECONDARY = [0x0015ff, 0x000bc6, 0x00008c];
export const UNIT_RAMPS = {
  vert: [0x33b544, 0x2f873a, 0x2a592f],
  azure: [0x2e54a6, 0x264588, 0x1d3569],
  or: [0xffff54, 0xbebe3f, 0x7d7d29],
  gules: [0xff0a11, 0xb91418, 0x731f1f],
  purpure: [0x9b48cf, 0x7c3aa5, 0x5c2b7a],
  sable: [0x4a4848, 0x3a3939, 0x292929],
  tenne: [0xff7d26, 0xd3641b, 0xa64b0f],
  rose: [0xd485b8, 0xcf6bac, 0xc9519f],
  argent: [0xfcfcfc, 0xbbc4e9, 0x7a8bd6],
  cyan: [0xa3faff, 0x5fc1c7, 0x1a878f],
};
export const TINCTURE_RGB = {
  gules: "164,29,29",
  azure: "60,110,190",
  or: "214,169,56",
  argent: "200,196,182",
  vert: "106,168,72",
  sable: "70,64,54",
  purpure: "120,74,140",
  tenne: "156,90,36",
  rose: "207,107,172",
  cyan: "95,193,199",
};
export const ENEMY_CRESTS = [
  "merovin",
  "marsur",
  "bordavia",
  "rukiev",
  "hunewold",
  "sangsoleil",
  "aguilleon",
  "imperial",
]; // a device per enemy faction (turn banner)
// The crest DEVICE keyed by the REAL heraldry banner index — so a faction always wears the SAME device (the Emperor
// = the imperial eagle, banner 8). Deterministic per banner; unmapped banners fall back to the per-side cycle.
export const BANNER_CREST = {
  1: "merovin",
  2: "eagle_gold",
  3: "bordavia",
  4: "rukiev",
  6: "hunewold",
  7: "axe_gold",
  8: "eagle_white",
};
// The crest FIELD (shield background) colour per banner — Rebel & Pellus BLUE, Emperor purple, Carrone red (distinct
// from the unit strength tint: Pellus units are yellow but his shield is blue). Falls back to BANNER_TINCTURE.
export const CREST_FIELD = { 1: "70,110,214", 2: "206,66,56", 7: "70,110,214", 8: "150,90,200" };
// The ornate shield FRAME per heraldry banner index (mirror of HeraldryShield BANNER_HERALDRY frames). Banner 0 = plain.
export const BANNER_FRAME = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 7, 5: 4, 6: 5, 7: 8, 8: 6 }; // = HeraldryShield BANNER_TO_FRAME (iOS frame index → FRAMES entry)
// Faction heraldry keyed by GROUP NAME (substring), for factions carrying the generic banner 0 that DO have a known
// crest in the original. Aguilleon Gate = Or (gold) field + a sable (black) eagle. field = shield bg + unit tint.
export const FACTION_HERALDRY = {
  aguilleon: { field: TINCTURE_RGB.or, crest: "eagle_black" },
  // The Rebel Army's scenario attrs decode its device to a wheat sheaf (72); its REAL banner is a GOLD fleur-de-lis
  // on azure (user-confirmed, image 21). Its banner index is the generic 0, so the BANNER_HERALDRY[1] override can't
  // reach it — pin the turn-banner shield's charge/colour by NAME instead (device 66 = fleur, symbolColor or = gold).
  // (The Rebel Army needs no override any more: its device 63 → symbol 072 IS the gold fleur-de-lis once the symbol
  // files follow the iOS numbering — the "wheat sheaf" was the Android set's two-slot misalignment.)
};
export function factionHeraldry(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  for (const k in FACTION_HERALDRY) if (n.includes(k)) return FACTION_HERALDRY[k];
  return null;
}

// ---- Visual-effect sprite strips + slash weapons -----------------------
// Each FX is a sprite strip: frames × (frameW×frameH), played over `dur` seconds at `scale`. `src` lets several FX
// share one PNG (arcane_out/arcane_in reuse arcane.png); `f0` plays a sub-range; `smooth` cross-fades frames.
export const FX_TYPES = {
  slash: { frames: 8, frameW: 64, frameH: 64, dur: 0.3, scale: 1.5 },
  cast: { frames: 6, frameW: 28, frameH: 28, dur: 0.4, scale: 1.4 }, // iOS ui/005 — blue magic sparkle at a caster
  impact: { frames: 9, frameW: 64, frameH: 64, dur: 0.34, scale: 1.25 },
  explosion: { frames: 9, frameW: 96, frameH: 96, dur: 0.48, scale: 1.7 },
  blast: { frames: 9, frameW: 96, frameH: 96, dur: 0.5, scale: 0.8 }, // android z_024 — fiery burst on a struck unit (fireball / cannon hit), sized to ~one cell
  plume: { frames: 9, frameW: 62, frameH: 62, dur: 0.5, scale: 1.7 }, // android z_023 — rock/dust plume
  rockblast: { frames: 9, frameW: 100, frameH: 100, dur: 0.52, scale: 0.8 }, // android z_025 — CATAPULT/trebuchet stone impact (rock burst, no fire/blood), sized to ~one cell
  flash: { frames: 9, frameW: 192, frameH: 192, dur: 0.26, scale: 1.15 },
  // 5017 #3 (android z_003, the hi-res copy) — the overlay of the Heal state 18 (changeState @0x6bdc4), drawn on the
  // HEALED unit (renderOverlay @0x7641a draws it at Map+0x1c, which Unit::heal points at the target), and of Life
  // Steal's state 29 over the Blood Gorger. One tile across, like the iOS 40×40 strip.
  spark: { frames: 7, frameW: 64, frameH: 64, dur: 0.6, scale: 1.0 },
  dust: { frames: 9, frameW: 62, frameH: 62, dur: 0.42, scale: 1.5 },
  // Ice Field spell (iOS ep-1 terrain/002 & 003): a big frost DOME over the struck area + ice CRYSTALS on each caught unit.
  ice: { frames: 20, frameW: 200, frameH: 200, dur: 0.72, scale: 0.85 },
  icefield: { frames: 25, frameW: 120, frameH: 120, dur: 0.9, scale: 1.1 }, // android z_007 — the Wizard ICE FIELD: a big frost-crystal burst sized to a ~2×2 area
  icespike: { frames: 25, frameW: 120, frameH: 120, dur: 0.55, scale: 0.62 },
  // ---- Ability effect strips — the higher-res ANDROID versions (measured frame pitch) ----
  nature: { frames: 9, frameW: 64, frameH: 96, dur: 0.55, scale: 1.0 }, // Druid shapeshift bloom (android z_000)
  skull: { frames: 10, frameW: 64, frameH: 96, dur: 0.6, scale: 0.7 }, // FEAR: the screaming skull over a unit that loses its nerve (battle strip 5017 #2, state 9 — its only use; android z_002 is the hi-res copy)
  // 5017 #8 (45×80, 12 frames; this is the Android hi-res copy) — the sword of light. Unit::renderOverlay (@0x757dc)
  // plays it over the unit a Retribution SMITES (state 14), 200–750 ms in, from the tile above it: two tiles tall.
  holysword: { frames: 12, frameW: 72, frameH: 128, dur: 0.55, scale: 1.0 },
  // 5017 #9 (200×200, 14 frames) — the angel of the Retribution prayer (changeState(23) @0x6be5e; renderOverlay
  // @0x7632e draws it from tile (x−2, y−3): five tiles across, centred over the Priest). The state lasts 750 ms.
  angel: { frames: 14, frameW: 200, frameH: 200, dur: 0.75, scale: 1.6 },
  fire: { frames: 7, frameW: 96, frameH: 96, dur: 0.6, scale: 0.7 }, // Fireball leaves flames (android z_026)
  bolt: { frames: 7, frameW: 64, frameH: 256, dur: 0.42, scale: 0.5 }, // Lightning Storm bolt (android z_030)
  // Wizard Teleport shimmer (android z_001): full→GONE(mid)→full. Split so the orb DEMATERIALIZES at the source
  // (frames 0→5) and REMATERIALIZES at the destination (frames 3→8) — a full half each way, neither vanish-reappears.
  arcane_out: { frames: 6, f0: 0, src: "arcane", frameW: 88, frameH: 88, dur: 0.55, scale: 1.3, smooth: true },
  arcane_in: { frames: 6, f0: 3, src: "arcane", frameW: 88, frameH: 88, dur: 0.55, scale: 1.3, smooth: true },
  // Cannon GRAPESHOT muzzle blast (android effects z_028) — a directional fire+smoke burst; drawn rotated to the
  // fire direction (the strip points right). 9 frames of 192×192.
  grapeshot: { frames: 9, frameW: 192, frameH: 192, dur: 0.5, scale: 0.85 },
  // Episode II — BALLISTAE Piercing Bolt impact (ios-episode-2 units/018_320x46: an 8-frame cyan energy burst
  // where the bolt punches home). Distinct from the catapult's rock-burst — this is a sharp arcane crack.
  ballistahit: { frames: 8, frameW: 40, frameH: 46, src: "ballista_hit", dur: 0.3, scale: 1.15 },
  // ---- Episode II strips straight from the iOS battle animation list (resource 5017, `tools/ros/anim.py 2`) ----
  // Index → use was read from Unit::changeState's cast dispatcher (@0x6bd80): the Craftsmen case picks #13, the
  // Conjure case #11 (sound 55), the sacrifice/unsummon case #10 (sound 54), the Quicksand case #14 (the spell-cast
  // sound 22, shared with the #6 dome), Retribution #9 (angel). #4/#5 are the Spirit Shroud's spectral spear-warrior
  // (left/right facing), #15 the white Absorb flash. (#40, the gold glow, marks the cells of an aimed Boulder or
  // Cannonball in state 7 — the recreation draws its own aim markers instead.)
  sand_skull: { frames: 21, frameW: 98, frameH: 116, dur: 1.3, scale: 0.95 }, // #14 Dune Sirens' Quicksand cast — a sand column rears up into a skull
  sand_puff: { frames: 14, frameW: 60, frameH: 67, dur: 0.7, scale: 1.0 }, // #12 dust ring — ground churned (quicksand cells, Build site)
  sigil: { frames: 11, frameW: 38, frameH: 53, dur: 0.8, scale: 1.25 }, // #11 Conjure — a pentagram flares where the minion appears
  debris: { frames: 16, frameW: 59, frameH: 80, dur: 0.9, scale: 1.0 }, // #13 Craftsmen Build / Repair — flying splinters and rubble
  unsummon: { frames: 9, frameW: 40, frameH: 60, dur: 0.6, scale: 1.2 }, // #10 a conjured minion is spent / unsummoned (purple flame)
  spirit: { frames: 16, frameW: 140, frameH: 140, dur: 1.2, scale: 0.8 }, // #4 Spirit Shroud — the ancestral spear-warrior rises over the Shaman
  absorb_flash: { frames: 9, frameW: 80, frameH: 76, dur: 0.5, scale: 1.1 }, // #15 Absorb — the white flash on the Conjurer
  // QUICKSAND TILE (iOS Ep2 resource 5064, an AnimStrip of 4 × 40×40 built in MenuScreen::loadStep and kept at
  // Context+0x13e0): Map::redrawTileInBuffer draws it over every tile whose quicksand countdown is > 0, frame =
  // tick/100 — a slowly turning sand whirlpool. Not a spawned effect: the renderer's quicksand pass draws it.
  quicksand: { frames: 4, frameW: 40, frameH: 40, dur: 1.6, scale: 1.0 },
};
// The mark a melee blow leaves on the struck unit — Unit::changeState's weapon switch (iOS Ep2 @0x6b84c, Ep1 @0x59fe6)
// stores it at the target's Unit+0x304 and renderDamage (@0x6f8fa) draws it with the damage read-out: the thrusting
// Spear (3), Pike (12) and Druid Lance (14) leave the blood burst (#32/#33 by facing), the Mallet (30) and the Bite
// (32) leave nothing, every other melee weapon leaves the slash (#30). A shot or a blast leaves none (Unit+0x304 is
// cleared as a shot lands, @0x6b538) — see _applyHit for what the recreation shows there.
const THRUST_WEAPONS = new Set([3, 12, 14]),
  UNMARKED_WEAPONS = new Set([30, 32]);
export const meleeHitFx = (weapon) =>
  THRUST_WEAPONS.has(weapon) ? "impact" : UNMARKED_WEAPONS.has(weapon) ? null : "slash";

// The Episode I raids (also in Episode II, same maps) carry only generic names in the original ("Hunewold Raid 1");
// these titles were invented for the recreation from each raid's own battle (user-requested). mapId → title.
export const RAID_TITLES = {
  5600: "The Squire's Siege", // Carrone Raid
  5603: "Lord of the Eastern March", // Merovin Raid 1
  5604: "The Halberd Wall", // Merovin Raid 2
  5605: "The Eastern Host", // Merovin Raid 3
  5606: "The Marsur Convoy", // Marsur Raid 1
  5607: "Powder and Pike", // Marsur Raid 2
  5608: "The Marsur Keep", // Marsur Raid 3
  5609: "The Border Village", // Bordavia Raid 1
  5610: "The Walled Town", // Bordavia Raid 2
  5611: "Fort on the Frontier", // Bordavia Raid 3
  5612: "The Outlaw Camp", // Sangsoleil Raid 1
  5613: "The Barons' War", // Sangsoleil Raid 2
  5614: "Banners over Sangsoleil", // Sangsoleil Raid 3
  5615: "Griffon Patrol", // Aguilleon Raid 1
  5616: "The Winged Army", // Aguilleon Raid 2
  5617: "Storm the Aerie", // Aguilleon Raid 3
  5618: "Run the Gauntlet", // Hunewold Raid 1
  5619: "The Forest Tribe", // Hunewold Raid 2
  5620: "The Fort Besieged", // Hunewold Raid 3
  5621: "The Horselord Yurts", // Rukiev Raid 1
  5622: "Thunder of Hooves", // Rukiev Raid 2
  5623: "The Steppe Settlement", // Rukiev Raid 3
};
// The name a level is shown under: its invented raid title, else the record's own name.
export const levelTitle = (level) => RAID_TITLES[level.mapId] || level.name;
