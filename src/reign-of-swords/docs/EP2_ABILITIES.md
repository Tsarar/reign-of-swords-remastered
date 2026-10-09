# Reign of Swords — Episode II abilities (decompiled from the iOS binary)

Source of truth for the Ep2-only unit abilities. Ep1 recovered ability _effects_ from the Android
dex (`La/q`, `La/g`); **there is no Ep2 dex** (the `Clash of Kingdoms_1.8.apk` is Android Ep1 — 350
records ≈ Ep1's 349; Ep2 has 437). Ep2's engine logic lives only in the iOS ARM binary:

- `Payload/ros.app/ros` inside `IPA - Reign of Swords - Episode II 1.0.11-Hexhammer.ipa`
- Mach-O, **armv6 Thumb, cryptid 0 (decrypted), 8849 symbols — NOT stripped** (C++ engine, author `quangnv`,
  build `iros_H2H`). Disassembled with capstone; full annotated dump + `rosdis.py` in the session scratchpad.

**Key structural fact:** the new abilities are keyed by **unit type** (`Unit` field `0x14e`), _not_ the generic
`hasAbility(int)` enum. Type map (field 0x14e): `29 Craftsmen · 30 Ballistae · 31 Conjurer · 32 Sapper ·
33 Bodyguard · 34 Dune Sirens · 35 Blood Gorgers`. Our engine mirrors this by keying on the unit type/flags,
so the mechanics stay inert for Ep1 (no Ep1 unit carries the flags).

Common unit-struct offsets seen: `0x14e` type byte · `0x170` (`al`, movement class; 4 = war engine) ·
`0x190` HP · `0x1c8` position `Vector2` (x @+4, y @+8) · `0x384` conjurer one-shot ward flag.

## IMPLEMENTED (verified in-engine)

| Ability         | Unit (type)        | Real behaviour (evidence)                                                                                                                                                                                                                                 | Engine                                                                                                           |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Life Steal**  | Blood Gorgers (35) | On a melee Bite hit the attacker heals by the damage dealt (capped at target HP / attacker max). The binary records the bite damage on the _attacker_ as the heal read-out (`Unit::applyDamage` @0x6b3fe: `cmp #0x23` → store dmg to attacker 0x35c).     | `rules/combat.js _applyHit` — heal attacker by `min(dmg, hpBefore)` on manhattan-1 hit; `bloodgorgers.lifeSteal` |
| **Siege Armor** | Ballistae (30)     | Incoming **melee** damage ×0.8 (`Unit::calculateAttackDamage` @0x6b14c: `dmg*8/10`, gated by `Map::isSiegedAmor` @0x3ac3c). `isSiegedAmor` = true if the unit is a Ballistae, **or** a war engine (`al==4`) with a friendly Ballistae within Manhattan 2. | `computeDamage`: `dist==1 && _siegeArmored(def) → ×0.8`; `ballistae.siegeArmor`, `T.warEngine = al==4`           |
| **Absorb**      | Bodyguard (33)     | A unit within Manhattan 2 of a friendly Bodyguard takes **ranged** damage ×0.5 (`Map::isUnitShielded` @0x3b3ca scans same-owner units, `                                                                                                                  | dx                                                                                                               | +   | dy  | ≤2`; `calculateAttackDamage`@0x6b0e8 halves for`dist>1`). | `computeDamage`: `dist>1 && _absorbShielded(def) → ×0.5`; `bodyguard.absorb` |

Split is by distance, exactly as the binary: **ranged → Absorb (½)**, **melee → Siege Armor (×0.8)**. Priest
Prayer shield (Ep1, ×0.75) is left untouched and still applies by weapon range.

## Field Manual (Ep2) — units, upgrade tree, deploy points (all from record 5010)

The Ep2 route's Field Manual is episode-aware (`ep2` prop threaded from ReignShell). On the Ep2 route the seven
new units are tagged into the existing **Abilities / Armour / Movement** tabs (via `unitsWithAbility/Armour/
Movement(key, ep2)` — they include `EP2_ORDER` when ep2), the **Abilities** tab appends the Ep2 abilities
(`EP2_ABILITY_HELP`, condensed from 5004 strings 579–588), and the **Upgrades** tree adds the Ep2 branches.
All confirmed byte-for-byte from record 5010:

- **Deploy points** (`cost = seg[15:17]`, BE u16): Craftsmen 300 · Ballistae 400 · Conjurer 500 · Dune Sirens 250
  · Blood Gorgers 100 · Sapper 0 · Bodyguard 0 (0 = summoned, never deployed). In `DEPLOY_COST` + `UNIT_META`.
- **Upgrade tree** (`seg[29:35]` = 6 collectible-indexed slots `[Medal, Armor, Weapons, Beasts, Spirit, Lore]`
  → target unit): new edges are **Footmen→Craftsmen** (Lore), **Halberdiers→Blood Gorgers** (Beasts),
  **Shamans→Dune Sirens** (Weapons) & **→Conjurer** (Lore), **Trebuchet→Ballistae** (Spirit). Sapper & Bodyguard
  have no upgrade slot (conjured). Validated militiamen slot[1]=Footmen / slot[5]=Catapult vs the Ep1 reference.
- The help strings also **confirm** decoded values: Conjurer "maximum of two minions" (cap 2) + "within Range 8"
  (leash 8); Blood Gorger heals on Bite + strikes last; Ballistae Siege Armor to self + nearby war engines.

### Corrections applied (help strings 5004 — the four impl bugs are FIXED)

- **Quicksand** (760): now **5 damage/turn** (was 12) and a quicksand tile is a **dead-end in the move graph**
  (`computeReach`) — a non-immune unit can step onto it but not move through it ("forced to stop moving");
  fliers/sirens pass. Verified: enter-yes / through-no (budget-2 test), 5 dmg.
- **Absorb** (763): the passive ½-ranged aura is gone; now when a Conjurer would take a damaging hit and has a
  living **Bodyguard** minion, the Bodyguard is **sacrificed** and the hit fully negated (`_applyHit`). Verified:
  1st hit negated + guard dies, 2nd hit lands.
- **Detonate** (764/586): no longer an attack cross-blast; the Sapper now **self-destructs** (`_detonate`) — it
  dies and deals **weapon damage ×1.25 to ALL adjacent units (friend and foe)** + adjacent structures — AI-
  triggered (`_shouldDetonate`: ≥2 adjacent foes, or a foe while wounded). Verified: ×1.25, friendly fire, far
  spared, sapper dies.
- **Ballistae Piercing Bolt** (758): now hits **three squares in a row** (`T.pierce` — target + 2 behind along
  the firing line). Verified: 3 in a row hit, 4th spared.

### Arc (ability 29) — NOT a confirmed mechanic, deliberately left unimplemented

Ballistae carry ability index 29 in the `.dat`, but the binary **never calls `hasAbility(29)`** anywhere, and
there is no ability-29-gated code. The Ballistae's projectile is handled by _type-keyed_ code (type 30):
`findBallistaeFirePoint` @0x64d28 is a 60-entry precomputed fire-point/trajectory table, and `renderProjectile`
/`_executeAction` branch on type 30 — i.e. an aiming/animation system, not a damage or line-of-sight ability.
So "Arc" has no isolable gameplay effect to port; equating it with Ep1 Low Arc (25) was an unverified analogy
and has been reverted (`T.lowArc` is only `A.includes(25)`; note `T.lowArc` is in any case a dead flag — the
engine only reads `mayDeviate`). Revisit only if the fire-point table proves to encode an over-obstacle lob.

## DECODED, not yet implemented

- **Quicksand** (Dune Sirens 34) — FULLY DECODED, ready to build:
  - **Damage: 12 raw HP/turn** to a unit standing on quicksand — `applyDamageRaw(u, #0xc)`, subtracts straight
    from HP 0x190, ignores armour (`applyQuicksandDamage` @0x662cc; also the cast resolution `_executeAction`
    @0x7f704 hits each occupant for `#0xc`).
  - **Duration: 4 turns.** Each tile stores a countdown byte (grid at `Map+0x50`); `setQuickSandTile(x,y,val)`
    sets it to `val = Mission.field_0xd0 (=2, MissionC2 @0x620aa) << 1 = 4`; `updateQuickSandTurn` @0x3ae34
    decrements every non-zero tile by 1 each turn.
  - **Terrain restriction:** quicksand only forms on tile types **{2, 3, 18, 22, 26, 27}** and only where no
    quicksand already exists (`isQuickSandable` @0x3f69a).
  - **Immunity: flyers + the sirens.** Immune unit types = **9 (Griffon Riders), 26 (Great Eagles),
    34 (Dune Sirens)** — i.e. `al==0` fliers (griffon/greateagle are the only al==0 units) plus the caster.
    Checked at damage time (`_executeAction` @0x7f6f4, `applyQuicksandDamage` @0x66302) and in pathing
    (`calcQuickSandCost` skips {34,9}).
  - **Cast:** enemy-only (Mysterious Foes). The siren's action lays quicksand over an AREA — a list of tile
    offsets at `unit+0x54` (relative to the siren), each set to the 4-turn countdown and damaging its occupant.
    The AI picks candidate tiles in `considerQuickSand` @0x685ca (called from AI @0x7c50e). **The exact
    area shape is the one piece not yet fully traced** — do not invent it; finish decoding `considerQuickSand`'s
    candidate loop before implementing the cast footprint.
  - Also: `isQuickSandOnChargePath` (a charge through quicksand is checked), `Unit::isQuicksandable`
    (AI: is this unit next to castable ground).

  **Terrain restriction — the byte-faithful cost (getTileType pipeline).** `isQuickSandable` gates on
  `Map::getTileType(x,y) ∈ {2,3,18,22,26,27}`. `getTileType` @0x3b914 is a two-level, data-driven lookup:
  `rawTile = tileGrid[x][y]` (Map+0x98) → `TerrainInfo = tiledefs[rawTile]` (Map+0xc8) →
  `type = TerrainInfo.typeTable[variant]` where `typeTable` is `TerrainInfo.field_0xc` and `variant` is a
  **per-cell short** from a second grid `Map+0xa0`. `TerrainInfo` (ctor @0x63708, `Map::loadTerrainData`
  @0x3a66c, resource read at Context @0x127e4) reads `(id, ?, N)` then N type-shorts into `field_0xc[]`.
  Consequence: a byte-faithful terrain check is **not a flat tile→type legend** — it needs (1) parsing the
  terrain-data resource for each tile's type subtable, and (2) the per-cell **variant grid**, which our
  `levels.json` never exported (we captured only tile indices via `mapgrid`). Doing it faithfully = a
  terrain-data parse + a map re-export (add the variant layer) + the two-level lookup in-engine.

  **Terrain-data parse (partial).** The terrain data lives in record **5010**, right after the unit table and
  the weapon×armour matrix (same `mlib_DataInput` stream: `loadUnitTable → loadWeaponTable → loadTerrainData`;
  reads are big-endian shorts). It is **30 `TerrainInfo` tilesets** (count short @ the terrain offset), each:
  `id, ?, N`, then per sub-tile `sl` in 0..N-1: `type` (typeTable[sl]), `other`, then a variable sublist read
  until `-1` (inclusive). So the type is **per (tileset, sub-index)** — i.e. per real map tile, reached by
  splitting a map cell short into tileset index + sub-index (`getTileSetIndex`/`getTileSetSubIndex`). Simple
  tilesets (0–23) parse cleanly with types {1,2,4}; the big atlases (tileset 24 has N=100, 27→27, 28→49) hold
  the bulk of the sub-tile types.

  **RESOLVED — terrain gate decoded byte-faithfully.** `loadTerrainData` has two sections: (1) a per-tileset
  table we skip, and (2) the **7 `TerrainInfo` tilesets `getTileType` actually uses** (`[Map+0xc8]`, count at
  `[Map+0xc4]`). Each `TerrainInfo` = `id, ?, N`, then per sub-tile `type, other, sublist-until-(-1)`. Parsing
  both sections consumes record 5010 **exactly** (offset 5881 == len). `getTileType(t,v) = tinfos[t].types[v]`
  where `t` = tileset, `v` = sub-index. A map cell in `levels.json` is the **global sub-tile id** (cumulative
  across tilesets: t0 ids 0–62, t1 63–123, t2 124, t3 125–178, t4 179–234, t5 235–246, t6 247–259), which
  `getTileSetIndex`/`SubIndex` split into `(t,v)` — so no map re-export is needed. Validation: Ep2 desert maps
  come out 50–90% quicksandable sand (types 2,3,18,22) dotted with rock/water features — exactly right. The
  legend (260 ids → type) is baked to `public/games/reign-of-swords-2/terrain-types.json`; `_quicksandable`
  reads it. Decode scripts: scratchpad `ep2_terrain3.py` → `ep2_tinfo.json`, `ep2_qsmap.py` → `ep2_tile_types.json`.

- **Conjurer ward** (Conjurer 31) — IMPLEMENTED. The first hit the Conjurer takes each turn deals **0** damage
  and consumes the ward (field `0x384`, refreshed each turn at `startTurn`/`onTick`, consumed only for type 31 in
  `applyDamage` @0x6b2ec / `applyDamageRaw` @0x6573a / `applyWeaponDamage` @0x6b194). Engine: `u.ward` refreshed
  for conjurers in the turn reset (`engine/turnflow`), absorbed at the top of `_applyHit` with an ice-shield FX +
  "Warded". Verified: first hit 0, second hit lands.
- **Conjure** (Conjurer 31) — IMPLEMENTED. The conjurer summons its "children" via `GameScreen::createUnitAt`
  (`onTick` @0x793c6); the summoned **type is 0x20 (32 = Sapper) or 0x21 (33 = Bodyguard)** (state branch
  @0x79332/@0x793aa) — which is why Sapper and Bodyguard cost 0 (summoned, not deployed). Engine: `conjurer.conjure`
  → AI cast branch (`ai/ai`) spawns a Sapper/Bodyguard on an adjacent tile via `_makeUnit`, tagged
  `_conjuredBy = conjurer.id`, with a nature FX. Verified: the enemy AI conjures children in-battle, no errors.
  **DECODED:** what it summons + child-death. **INTERIM (not decoded):** the standing-child CAP (using 2) and the
  Sapper-vs-Bodyguard choice rule (using: Bodyguard if a foe ≤4 tiles, else Sapper) — the real choice is field
  0x3a4 and the cap/frequency live in the AI decision path; refine when decoded.
- **Leashing** (Conjurer/Sapper/Bodyguard, ability 30) — FULLY IMPLEMENTED. Child-death: `_killConjuredChildren`
  (rules/combat) unsummons every child when the conjurer dies (iOS `killConjurerChild` @0x7fdcc). Movement tether:
  the **leash range = 8** (`getConjuredsOutOfLeashingRange` @0x7fb94 calls `createLeashingRangeLoc(pos, 1, 8, …)`);
  a conjured child's AI reachable stops are filtered to within 8 of its living conjurer (ai/ai), and if it has
  drifted out it only takes stops that step it back. Verified: children stay adjacent to the conjurer, all within 8.
- **Build / Repair** (Craftsmen 29) — IMPLEMENTED (enemy-only — all Ep2 units are enemy, so AI-driven).
  **Build = construct a VILLAGE** (`Map::isBuildable` @0x3bbe0: an empty, quicksand-free tile of getTileType
  ∈ **{2,3,18,26}**). Engine: `_buildVillage`/`_buildableTile` (rules/combat) add the tile to `builtVillages`;
  `terrainAt` (engine/grid) returns village props there (heal 20, +15% cover), à la `breached`; rendered as the
  village tile. **Repair = restore a damaged adjacent War Engine** (`Unit::canRepair` @0x74d2c: adjacent al==4
  unit with HP < max). Engine: `_repairTargetFor` + the Craftsmen AI heals it +20 (Craftsmen reuse `Unit::heal`).
  Verified: build → village terrain (heal 20), repair → +20 to an adjacent damaged ballistae, enemy-only,
  friendly/near/full-HP filters correct, no errors. INTERIM: the repair amount uses the game's +20 heal step.
  **Build is once per battle** (help string 581: "Craftsmen can only Build once per battle"; string 759: "a
  healing Hut or a Tent once per battle") — enforced via a per-unit `_built` flag. The Ep2 5004 help strings
  (564 Fear, 574 Siege, 581/759 Build, 583 Siege Armor, 587 Quicksand, 659 Blood Gorger, 758 Ballistae) confirm
  the decoded ability behaviours.
- **Detonate** (Sapper 32) — IMPLEMENTED. The sapper's attack is an area blast: `hasAbility(36)` routes its
  attack through `startAreaAttack` (`onTick` @0x78162), which builds a **+ cross** (centre + 4 orthogonal, the
  offsets pushed at @0x729e0+) and applies **full damage per cell** via `applyDamage` (@0x78786+, no area
  falloff), with `GameScreen::shakeMap` + `Map::burnLocation` FX. **No self-destruct** — the sapper goes to a
  normal post-attack state (state 5). Engine: `sapper.detonate` → `resolveDamage` sprays the full-damage cross
  (no team check = friendly fire) with a fiery burst. Verified: 4 neighbours hit, distance-2 spared, friendly
  fire real, `UNIT_TYPES.sapper.detonate === true`.

## Under-determined constant

- **Life Steal fraction.** The binary stores the _full_ bite damage on the gorger (0x35c) and a ×100/256
  (~0.39) value (0x1b0); both fields are consumed by `GameScreen`/`renderDamage` (read-out). We implement heal
  = **full damage dealt** (the primary recorded value); if a later pass shows the applied heal is the ~0.39
  field, adjust `_applyHit`.
