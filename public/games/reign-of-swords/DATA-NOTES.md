# Reign of Swords — Reverse-Engineering & Data Notes

A faithful, data-grounded re-creation of the 2008 **Punch Entertainment** mobile game *Reign of Swords*
(a.k.a. *Mobile Battles: Reign of Swords*). Every gameplay number in the recreation is carved from the
**original game's own data**, not invented. This document records what was extracted, how it was decoded,
and — honestly — which parts are real DATA vs. AUTHORED reconstruction.

Everything referenced here is included in the download: raw extracted art & data under `extracted/`, the
processed game assets the recreation actually loads (sprites, portraits, tileset, audio, JSON), and this file.

> **2026-09 update:** the authoritative rule-by-rule reference, with a decompiled-code citation for every finding
> (units, combat, abilities, maps and scripts, turn order and heraldry, the group AI, economy, sounds, animations),
> is **MECHANICS.md** in this download. Where this older file disagrees with it — the combat formula below was read
> from the Android build and is superseded by the iOS `Unit::calculateAttackDamage` reading (Shield halves ranged
> damage and is invoked, ratings are 6 tiers, courage is a roll) — MECHANICS.md is right.

---

## 1. Sources

| Source | What it is | What we pulled from it |
|--------|-----------|------------------------|
| **iOS `reignofswords.dat`** | The iPhone build's packed resource archive | Strings, dialogue screens, the unit table, per-mission scenario/terrain data, portraits, tileset |
| **Android `classes.dex`** | The Android build's compiled Java (via androguard) | The damage code (`La/q`), scenario command chains, deploy/economy logic, map hit-rects |
| **`extracted/` (this download)** | Everything the two builds yielded, minus raw binaries | Original unit atlases (android + iOS ep1/ep2), portraits, heraldry, UI, terrain, audio, `MANIFEST.json` |

The archive format: a u32 record count, then per record `{id, packed type/offset, length}`; `type==1` payloads
are zlib-compressed. Resources are grouped into **families** by id range.

---

## 2. Resource families (iOS `.dat`)

| Family | Contents |
|--------|----------|
| **5004** | UI/gameplay **strings** (unit names, ability names, tutorial text, menu labels) |
| **5009** | **Dialogue screens** — 34-byte records; field[2] = speaker id, field[7] = string id |
| **5010** | **Unit table** + the weapon×armour **damage matrix** (the heart of combat) |
| **5006** | Dialogue **portraits** (the 31 character faces) |
| **6300 / 6360–6366** | **Heraldry / crests** (the kingdom coats of arms) |
| **scenario records** | Per-mission maps, armies, deploy zones, waves, triggered events (mapId = recordId + 100) |

---

## 3. The unit table (5010) — every stat is here

Each unit record carries a `B[]` array. The fields we decoded and verified (0 mismatches across all 23 units):

| Field | Meaning | Example (Militiamen / Knights) |
|-------|---------|-------------------------------|
| **B[0]** | **Movement** points | 4 / 8 |
| **B[2]** | **Armour** id (into the armour-name table) | 1 Padded / 10 Heavy Armour & Shield |
| **B[3]** | **Weapon** id (into the damage matrix) | 3 Spear / 15 Lance |
| **B[4]** | **Second weapon** (side-arm; e.g. archer's short sword, cannon's grapeshot) | 0 / 0 |
| **B[5], B[6]** | **Ability** ids | — / 15 Charge |
| **B[8]** | **Rating** tier (→ a rating factor rf: 0→45 … 5→115) | 1 / 4 |
| **`lists[0][0]`** | **Deployment cost** (the game's own relative-power gauge, shown as "POW") | 50 / 300 |

> The recreation's `data/combat-data.js` is auto-generated from this table — do not hand-edit it.

### Weapons (id → name)
1 Staff · 2 Talon · 3 Spear · 4 Antlers · 5 Sword · 6 Mace · 7 Wand · 8 Short Sword · 9 Paw ·
10 Halberd · 11 Flail · 12 Pike · 13 Greatsword · 14 Scythe · 15 Lance · 16 Longbow · 17 Crossbow ·
18 Musket · 19 Short Bow · 20 Rock · 21 Boulder · 22 Pitch · 23 Cannonball · 24 Grapeshot ·
25 Fireball · 26 Lightning · 27 Bolt

### Armour (id → name)
0 None · 1 Padded · 2 Robes · 3 Light Armour · 4 Nature's Cloak · 5 Breastplate · 6 Light Armour & Shield ·
7 Hide · 8 Heavy Armour · 9 Holy Vestment · 10 Heavy Armour & Shield · 11 Nature's Shield · 12 War Engine ·
15 Relic Armour

### Abilities (index → name)
1 First Strike · 2 Last Strike · 3 Blast Area · 4 Fearless · 5 Formation · 6 Spot · 7 Move or Shoot ·
8 Shoot and Move · 9 Fire Arrows · 10 Flammable · 11 Battle Standard · 12 Awaken Spirits · 13 Burst ·
14 Fear · 15 Charge · 16 Stealth · 17 Ambush · 18/22 Magic · 19/23 Prayer · 20/21 Greater Shapeshift ·
24 Barrage · 25 Low Arc · 26 Pike Wall · 27 Pike Wall · 28 Spirit Shroud

---

## 4. The combat model (Android `La/q` damage code)

Damage is **weapon-vs-ARMOUR** — there is **no weapon-vs-weapon triangle** (no "sword beats spear").
On a 0–100 scale, HP = 100 for every unit:

```
base   = WEAPON_DMG[attackerWeapon - 1][defenderArmour]     // the extracted matrix
       + 30   if Charge      (cavalry, ≥3-tile straight run-up)
       + 30   if Pike-Wall brace  (a braced pike vs a charging mount)
base  *= 2    if fire weapon (Fire Arrows / Fireball) vs a Flammable target

rf     = attacker.ratingFactor ± 15 aura   (Battle Standard / Spirit Shroud within 4 tiles)
cover  = 1 − terrainDefBonus − 0.10·(adjacent Formation allies)   // siege Boulder/Cannonball ignore cover
damage = base · (rf/100) · cover · (attackerHP/100)
       ×0.75  if the target is Shielded by a nearby Priest (Prayer, vs ranged)
```

No random rolls — combat is fully deterministic.

---

## 5. Terrain (per-tile table)

Each map cell is a **tile index 0–123** into `tileset.png` (124 tiles, 40×40). `terrain.json` maps each
index to `{ category, passable, movecost, defBonus, blocksMounted, blocksEngine, heal }`. The tileset
**has transition/edge tiles** for dirt, water, hills, roads and hedges (so those borders blend), but **no
forest-to-grass transition** — forest (tile 0) was always placed as solid blocks, so its sharp edges are
authentic to the original, not a shortcut.

---

## 6. Sprites — the roster atlas

The clean upright **idle** poses come from the game's own **roster atlas** (`extracted/android/units/006_…png`,
also the low-res iOS twin `ios-episode-1/units/017_…png`): 29 upright frames, one per unit, where the **frame
index = the unit's sprite index** (e.g. frame 22 = the holy Priest). The battle **attack strips** have no
neutral frame, which is why idle units use the roster pose. Mounted/siege/beast idles come from the same atlas.

---

## 7. DATA vs. AUTHORED — full honesty

**Real, from the game's data (verified):** every unit's move, weapon(s), armour, rating, range, attack &
defence display numbers, ability set, deploy cost; the weapon×armour damage matrix; all 78 battle maps
(terrain grids, army placements, deploy zones, reinforcement waves) at their true sizes; the world map node
coordinates; the campaign structure; the dialogue text, speakers and portraits; the crests; the tutorial
battles; the battle and menu music loops (audio ids 6 and 3) and every sound effect by id.

**Authored / derived (labeled as such, not raw stats):**
- `kind` (spear/melee/axe/cavalry/ranged/siege/hero) — a grouping for AI + UI icons, derived from each
  unit's role (this is why Footmen, who carry a *Spear*, are grouped "melee"). Not a raw table field.
- The quick "combat tip" per kind — describes the *real* mechanic (Formation, Pike Wall, Charge…), but the
  phrasing is written by us.
- Ability description **text** — human-readable; the ability *set* behind it is data.
- Sprite animation params (frame counts, hit-frame timing) and projectile visuals — tuned for the recreation.
- Some presentation (the parchment UI skin, the pannable camera feel) approximates the original.

**Known gaps / not reproduced:** the original's two-finger group-select banner UI; the reactive per-action
hint pop-ups (the 4 tutorial *battles* AND their scripted Captain dialogue — assemble on the green, hold the
ridge, position cavalry for a charge, flank & surround — ARE reproduced, extracted from the tutorial scenario
message-events 5700–5703; only the contextual "tap here" hints are not); Episode II is now fully wired (its own route with all 110 records, the seven new units and abilities);
see MECHANICS.md §6–8 for what is data and what is ours.

---

*Generated for the Reign of Swords recreation. The `extracted/MANIFEST.json` lists every raw file with its
original resource id, dimensions and frame layout.*
