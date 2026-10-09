# Reign of Swords — game-structure & extracted-data reference

Complete reverse-engineering notes for the 2008 Punch Entertainment game, recovered for this
React re-creation. The authoritative data source is the **iOS** archive
`extracted-assets/ios-episode-1/_raw/reignofswords.dat`. The Android build
(`apk/assets/ros.dat` = art, `audio.dat` = SFX, `classes.dex` = obfuscated game logic) is used to
reverse the _code_ (damage formula, AI, record grammars) via androguard 4.1.4.

Two layers of data:

1. **`reignofswords.dat`** — a flat resource archive (strings, unit table, level grids, scenario
   records, images, heraldry, screen definitions).
2. **`classes.dex`** — the game logic. The obfuscated classes are `La/*`; the god-object is
   `com.blacksheep.kingoflands.a`. This is where the record _grammars_ and combat _formulas_ live.

---

## 1. Archive format (`reignofswords.dat`)

```
u32 LE  count
count × { u32 id ; u32 packed (type = packed>>24, offset = packed & 0xFFFFFF) ; u32 length }
data base = 4 + count*12
type == 1  → zlib-compressed (78 9c); else raw
```

`res(rid)` returns the (decompressed) bytes. Every scratchpad script has this helper.

## 2. Resource families (what each id block is)

| id block                       | n    | contents                                                                                                                                                                         |
| ------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5004**                       | 1    | **STRING TABLE** — `u16 count`, then `count × u32` offsets (base 4354), NUL-terminated latin1. ~1088 strings. Player name is a `PlayerStyle PlayerName` token.                   |
| **5005**                       | 85   | **SCREEN/EVENT table (variant)** — parallel to 5009, indexed by screen id.                                                                                                       |
| **5009**                       | 306  | **SCREEN/EVENT table** — every menu, dialogue box & UI screen (see §6). Conversation screens carry the dialogue string id **and the speaker id**.                                |
| **5006 / 5017**                | —    | large baked atlases.                                                                                                                                                             |
| **5007 / 5008 / 5011 / 5014+** | many | tileset & sprite PNG atlases (baked to `tileset.png` / `sprites/`).                                                                                                              |
| **5010**                       | 1    | **UNIT TABLE** (29 units) + the **27×16 weapon×armour damage matrix** right after it (see §3).                                                                                   |
| **5100**                       | 28   | SCENARIO records — **Skirmish/Battlefield** maps (mapId = recId + 100 → 5204+).                                                                                                  |
| **5300**                       | 24   | SCENARIO records — **Campaign** story battles (→ 5400-5423).                                                                                                                     |
| **5500**                       | 22   | SCENARIO records — **Raids** (→ 5600-5623).                                                                                                                                      |
| **5700**                       | 4    | SCENARIO records — **Tutorials** (→ 5800-5803).                                                                                                                                  |
| **5200 / 5400 / 5600 / 5800**  |      | LEVEL tile grids: `u16 W, u16 H`, then W*H × `u16 BE` tile values. Paired to the scenario record at `recId − 100`. mapId = 5400 + kingdomIdx*3 + local.                          |
| **6100**                       | 12   | UI text banners / strips.                                                                                                                                                        |
| **6200**                       | 9    | **HERALDRY — shield backgrounds** (blue field patterns: plain, chevron, checky, pale, hearts, wavy, embattled, saltire).                                                         |
| **6300**                       | 66   | **HERALDRY — charges/emblems** (griffon, eagle, fleur-de-lis, horse, stag, tree, lion, skull…). The **last 7 (6360-6366) are full COLOURED coats of arms** (the kingdom crests). |
| **6400**                       | 9    | **HERALDRY — shield frames/borders** (plain → crossed-swords → banner → helm → winged → crowned).                                                                                |
| **6500**                       | 21   | world map (6500 = `worldmap.jpg`, 1260×1411) + region overlays. Kingdom hit-rects are DEX `La/m` arrays.                                                                         |
| **7000**                       | 25   | misc UI (buttons, HUD, cursors).                                                                                                                                                 |

---

## 3. Unit table 5010 + the damage matrix

`u16 count=29`, then per unit `u8 nameLen · name · fixed bytes`. The 29 units, in table order
(this index is used everywhere — spawns, upgrades, reward tokens −100):

```
0 Militiamen  1 Footmen  2 Halberdiers  3 Swordsmen  4 Cavalry  5 Pikemen  6 Greatswordsmen
7 Knights  8 Hero  9 Griffon Riders  10 Archers  11 Rangers  12 Crossbowmen  13 Musketeers
14 Horse Bowmen  15 Raiders  16 Shamans  17 Old Druids  18 Old Wizards  19 Old Priests
20 Druids  21 Wizards  22 Priests  23 Catapults  24 Trebuchet  25 Cannon  26 Great Eagles
27 Guardian Bear  28 Stag
```

### The real record layout (loader `La/q.a(Llibs/framework/a;)V`) — authoritative

After the name, in order (`d()`=signed byte, `f()`=BE short):

```
0 move · 1 category(al) · 2 armour(am) · 3 weapon[0] melee · 4 weapon[1] ranged/2nd ·
5 mode[0] · 6 mode[1] · 7 ap(unused def-rating) · 8 attackRating(aq) · 9 ax · 10 ay ·
11 flag(az) · 12-14 (3 discarded) · f()=cost(as) · 3 ability lists (f() until −1) ·
6 UPGRADE SLOTS (d(), collectible-indexed)
```

- HP is **NOT** in the record — every unit is `ar = aY = 256` internal (bar = `ar*100/256` = 0-100).
- `at` (AI value) = `((cost−50)*50/450)+50`.
- **byte 7 `ap` is loaded but never read** — the game shows no ATK/DEF number.

### Upgrade slots (the 6 collectible-indexed slots) — the key economy insight

Slot **position = required collectible**, slot **value = the unit that collectible upgrades you into**
(0 = no upgrade with that collectible). Collectible enum (strings 438-444):
`0 Medal, 1 Armor, 2 Weapons, 3 Beasts, 4 Spirit, 5 Lore, 6 Flight` (Flight has no slot).
So Militiamen slot[1]=Footmen ("spend Armor → Footmen"), slot[5]=Catapult ("spend Lore → Catapult").

### Weapon enum (byte 3 = stringId − 556)

`1 Staff 2 Talon 3 Spear 4 Antlers 5 Sword 6 Runesword 7 WizardBlade 8 ShortSword 9 Paw 10 Halberd
11 HolyStaff 12 Pike 13 Greatsword 14 DruidLance 15 Lance 16 Longbow 17 Crossbow 18 Musket 19 ShortBow
20 Rock 21 Boulder 22 Pitch 23 Cannonball 24 Grapeshot 25 Fireball 26 LightningStorm`

### Armour enum (byte 2; strings 456+ with gaps)

`0 NoArmor 3 LightArmor 4 Nature'sCloak 5 Breastplate 6 LightArmor+Shield 8 HeavyArmor 9 HolyVestment
10 HeavyArmor+Shield 11 Nature'sShield 15 RelicArmor` (2 Robes, 7 Hide used by casters/flyers)

### The 27×16 damage matrix (loader `La/q.b`, right after the units)

`f()=16 armours · f()=27 weapons`, then per weapon-row `bT,bU,bV,bW` (4 bytes) + 16 shorts:

- **`bS[weapon−1][armour]` = base damage**
- **`bT` = min range** (0→1), **`bU` = max range**, **`bV`/`bW` = weapon property tags** (ability ids).
  Ranges: melee 1-1; Longbow/Crossbow 2-6; Musket 2-7; Rock 3-8; Cannonball 3-10; Fireball 2-7; Lightning 3-7.

## 4. The damage model (method `La/q.a(La/q; I)I`, byte-exact)

```
base = bS[weapon-1][defenderArmour]
if (charging, min 3 tiles: c(target) ≥ 3)   base += 30
if (pike g(27) && target moveclass ∈ {3,4}) base += 30      // pike wall vs mounted/siege
if (fire g(9)/g(13)/weapon==25 && target g(10) Flammable)  base <<= 1   // fire ×2 vs flammable
rating = S()  →  {1:60, 2:75, 3:90, 4:100, 5:115}   ±15 aura (g11 Battle Standard / g28 Spirit Shroud, ≤4 tiles)
cover  = af[terrain][0]   (open 100, forest/hill 60-90, road 120)
formation: −10% incoming per adjacent Formation ally (not vs Boulder/Cannonball)
damage(internal) = base/100 · cover/100 · rating/100 · ar    (clamped to target ar)
```

Display (0-100, full HP) = **`base · rating/100 · cover/100`**. **No random variance** (`a.g.l(int)`
is identity). **Heal = +51 internal = +20 display**. Ranged units below min range swing `weapon[1]`.

---

## 5. Scenario record grammar (`La/n`) — teams, forces, scripts, triggers, rewards

Each battle is one record in family 5100/5300/5500/5700; **mapId = recId + 100**. Parsed by
`La/n.<init>(app, id, La/j)` over the `libs/framework/a` byte reader. Order:

```
header:  i(theme) · am=TURN LIMIT · an(budget word) · v3 + o[v3] aux shorts · p · q
a(reader) = TEAMS      b(reader) = GROUPS      c(reader) = UNIT TEMPLATES
c(reader,0); b(reader,0)   = side-0 SCRIPT + COMMAND LIST az[0]
c(reader,1); b(reader,1)   = side-1 SCRIPT + COMMAND LIST az[1]
d(reader) = DEPLOY TILES + formations + aux position lists
```

### Teams (`La/n.a`) — who is the player

Per team: `nameLen+name · Y(byte) · Z=f()gold · X=h()colour · aa=h() · ab=f()`.

- **The human is team 0** — `La/n.D` (the human-team index) defaults to 0 and is only overwritten by a
  save-restore. Proven three ways: in every "muster" mission team 0 is EMPTY (impossible if it were the
  enemy); the Emperor/Anston hero always rides with team 0; team-0's name is always the imperial faction.
- **`Z` = the team's GOLD budget** = the player's per-mission deploy budget. It grows across the campaign
  (0, 1000, 1500, 2000, 2750 … 5000). `gold 0` ⇒ the force is pre-placed (set-piece); `gold > 0` ⇒ you
  deploy up to the budget on top of any preset core.
- **`X` = team colour** (e.g. 0x00FF00). `La/n.d()` recolours groups by whether `group.team == D`.

### Groups & templates

`GROUPS` (`La/n.b`): per group `name · team(byte) · 5 attr bytes` — maps a deployment group → a team.
`TEMPLATES` (`La/n.c`): per template `type(a0) · group(a1) · name` — a spawnable (unit type, its group).

### Command list (`az[side]`) + opcode executor `La/n.a([S)[S`

Commands are `[op, args…]`; the arg count is `La/n.a[op]` from the stride table
`{5,2,3,4,2,3,2,3,2,2,2,3}`. The executor runs the side-effect and returns the **next** command
(each opcode carries its own `next` field index → **op-0 spawns CHAIN into columns**):

| op          | args                        | action                                               | next    |
| ----------- | --------------------------- | ---------------------------------------------------- | ------- |
| **0 SPAWN** | x,y,templateIdx,facing,next | spawn `templates[idx]` at (x,y)                      | field 5 |
| **1**       | screenId,next               | `La/g.f(screenId)` — show a SCREEN (dialogue/UI, §6) | field 2 |
| **2**       | id,param,next               | `La/g.f(id,param)` — map/tile op                     | field 3 |
| 3           | a,b,region,next             | tile/region op                                       | field 4 |
| 4 / 6       | id,next                     | unit-group op                                        | field 2 |
| 5           | a,b                         | terminal op (objective/win)                          | —       |
| 7           | a,b                         | camera/`La/j` op                                     | —       |
| 8           | unitId,next                 | act-on-unit                                          | field 2 |
| 9           | counterId,next              | increment counter + fire `ar[]` sub-trigger          | field 2 |
| 10          | flag,next                   | set state flag                                       | field 2 |
| 11          | unitId,flag                 | set a unit's L-state                                 | —       |

### Scripts & TRIGGERS (`La/n.c` tag reader)

The per-side "script" is a tagged list. Tag decides where the entry goes:

- **tag 0 → `aB[side]` = TRIGGER TABLE** — `[round, team, cmdIdx]`. **Reinforcement waves.**
- tags 1-5 → `aA[side][tag]` = SETUP command index (the initial spawn phases).
- tags 6/7/8/9 → aux lists `ap/aq/ar/as` (objective counters, camera pans, area lists).

**Trigger firing** (`La/g.e()`): at the start of each turn it calls `bg.a((aD/J)+1, aQ)` — matches a
trigger whose type == the round `(aD/J)+1` and whose team == the acting team `aQ`, fires it once
(removed from `aB`), and runs its command chain. An op-0 chain drops a reinforcement column; the arrival
line is a screen (strings 1023/1024 "a Horselord column has ridden in").

### Rewards (header `o[] / p / q`)

The per-mission reward list lives in the record header aux fields (`o[]`, with `p`=count, `q`=random
flag): a token **≥100 is a unit** (type = token − 100), a token **0-6 is a collectible**. Extracted for
all 71 missions → `rewards.json`.

### Deploy tiles (`La/n.d`)

`k` deploy tiles `[owner, m, x, y]` (owner = which side deploys there), then formation groups and two
aux position lists (`listX`/`listZ` — used for goal/objective areas in some missions).

---

## 6. Screen / event & dialogue table (5005 / 5009) — the speaker mapping

Every screen (menus, options, credits **and every dialogue box**) is one entry in the **5009** table,
indexed by screen id, shown by op-1 (`La/g.f(screenId)`; `app.bl` = `La/g`). 5005 is a parallel variant.

A **conversation screen** is a 34-byte (17-short) entry:

```
[ type, screenId, SPEAKER_ID(f2), 0, 1, 0, 0, STRING_ID(f7), 0, 0, -1, 0, 1, 0, f14, -1, -1 ]
```

- **`field[7]` = the dialogue string id** (into the 5004 string table).
- **`field[2]` = the SPEAKER id** — the per-line speaker. Proven real, not layout: **zero** correlation
  with text length (−0.011), and its 22 clusters across the campaign are perfectly coherent
  (49 = your field officer's status reports, 50 = victory heralds, 51 = your sergeant, 54 = Duke Pellus's
  "Capture the boy alive!", 57/58 = Baron Valeuve, 71 = the Martin finale). Recovered → `line2speaker.json`.
- Larger screens (menus) carry a `count + offsets` sub-element list after the header.

**The dialogue screen shows the speaker's FACE.** The iOS build's own portrait atlas (res **5006**,
extracted to `ios-episode-1/portraits`) is explicitly labelled the game's **dialogue portraits** — 31 real
86×144 character busts. (An earlier pass wrongly concluded "a crest, not a face" and put kingdom heraldry
in the dialogue box — that was the "weird sigil" the build showed; corrected: faces are the real thing and
they are all present.) The exact field[2]→face-index step is computed in the screen code, not a flat
resource, so we **cast** the 9 story speaker-roles to the best-matching real faces (authored casting). The
field[2] grouping still corrected an earlier conflation (we had lumped officer/herald/advisor under "Anston").

## 7. Heraldry / coats of arms (6200 + 6300 + 6400)

A coat of arms composes three layers:

- **6200** (9) = the shield **background** (blue field pattern).
- **6300** (66) = the **charge/emblem** — mostly single-colour devices, but **6360-6366 are 7 full
  coloured kingdom crests**: `6360 red rising-sun (Sangsoleil) · 6361 tree (Hunewold) · 6362 black
double-headed imperial eagle (Carrone / your side) · 6363 horse head (Rukiev / the Horselords) ·
6364 fleur-de-lis (Merovin — Merovingian) · 6365 three silver swords · 6366 crossed pickaxes`.
- **6400** (9) = the shield **frame/border** (rising ornament).

These coats of arms are **faction/kingdom devices** (the iOS build also carries 73 small 34×53 shields in
res 6300) — used on the map / roster / faction UI, **not** in the dialogue box (dialogue uses the res-5006
faces, §6). The crest art is shipped in `crests/` and kept for a future map/faction marker.

Both the dialogue faces (5006) and these crests (6300) load by a computed `base+offset`, **never** as literal
constants in the DEX — which is why each is a family/index scheme, not a flat line→asset lookup.

## 8. Audio system (`libs/c/*`) + the real event→sound map

- **`audio.dat`** (Android) = the sound **bank**: `u32 count = 32` sounds. The iOS `.dat` carries no audio.
- **`libs/c/c`** = a sound **clip** (`.c` = id, `.g` = group/sound id, flags). **`libs/c/d`** = the sound
  **manager** — `d.a(id)` plays by `.c`; `d.a(id, chan)` plays the clip whose `.g == id` on channel `chan`.
- App wrappers `a.a(id)/a.a(id,chan)/a.b(id,chan)` forward to `libs/c/d`. Combat plays on the unit's own
  channel `aT` (`= this.az++`).
- **The real event→sound map is a switch on the WEAPON type** in `La/q` (`switch (h(aW))`), so it IS
  liftable — it's not one flat table but a byte-exact per-weapon switch (sound ids are clip `.g` values):

| event / weapon                                    | sound id(s)                      | category |
| ------------------------------------------------- | -------------------------------- | -------- |
| **move** — foot                                   | `b(279, aT)`                     | march    |
| **move** — Griffon (fly)                          | `a(178, aT)`                     | wings    |
| **melee** — Spear/Pike/DruidLance (3,12,14)       | `593 / 620 / 647` (rotates bV%3) | clang A  |
| **melee** — Sword/Greatsword/Halberd/… (default)  | `674 / 701` (rotates bV%2)       | clang B  |
| **ranged** — Longbow/Crossbow/ShortBow (16,17,19) | `815`                            | arrow    |
| **ranged** — Musket (18) **and Cannonball (23)**  | `453`                            | bang     |
| **siege** — Rock/Pitch (catapult, 20,22)          | `763`                            | thud     |
| **magic** — Lightning (26)                        | `566`                            | thunder  |

Our recreation's SOUND_NAMES (`melee/arrow/gun/cannon/move/death`) already match these categories; the only
sub-byte gaps are the spear-vs-sword melee variant and the catapult-thud vs cannon-bang split.
**No background music** — verified exhaustively (the earlier "music" was a looped horse-gallop SFX).

## 9. DEX class map

| class                           | role                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `La/q`                          | **UNIT** — parallel-array state (`ac`=team, `ar`=HP/256, `as`=cost, `ad`=type) + the damage code (`a(La/q;I)I`), the 5010/table loaders (`a`,`b`), and the sound/channel `t()`. Shapeshift saves the druid's type in `aZ` and reverts (`a(20)`). |
| `La/n`                          | **SCENARIO RECORD** — teams/groups/templates/scripts/commands/triggers/deploy/rewards (§5). Human team = `La/n.D` (default 0). Stride table `La/n.a[]`.                                                                                          |
| `La/g`                          | **BATTLE CONTROLLER** (super `La/b`) — turn flow, command execution (queued in `aP`), trigger firing `e()`, the spawn executor `a(IIIIIZ)La/q`, screen transitions `f()`.                                                                        |
| `La/r`                          | **MERCHANT / DEPLOY / SAVE** — owned army `z/A/B[29]`, collectibles `t/u[6]`, deploy budget `x` (elite cap `x/1000`). `e()` zeroes everything (new game), `d()` saves to `<mapId>.mry`, loads `<mapId>.mry` → `army0.sav` → empty default.       |
| `La/m`                          | **MAP / MENU** — kingdom hit-rect coords (arrays W/X/Y/Z), unlock prereqs `k(I)`.                                                                                                                                                                |
| `La/j`                          | **AI** — influence map (radius-4 diamond, 41-cell spread, ring weights `[100,50,25,12,6]`), geometry (`c`=Manhattan, `d`=direction, `b`=camera).                                                                                                 |
| `La/s`                          | **Point** (a=x, b=y).                                                                                                                                                                                                                            |
| `com.blacksheep.kingoflands.a`  | **god object / main app** — resource loader `l.a(id)`, sound wrappers, persistent save state (`aL/aM[13]`, `ah[36][6]`, `ag[39]` map progress), `m()` = save, `a(La/r;Z)V` = full reset. The debug cheat flag is `a.b`.                          |
| `libs/c/*` / `libs/framework/*` | audio (§8) / engine (byte reader, images, math).                                                                                                                                                                                                 |

**Meta-progression facts:** a new game **zeroes** the army (`La/r.e()` + the reset + the empty default),
so there is **no stored starter army** (the only non-zero init is the `a.b` debug cheat = 2 of each unit).
The persistent army grows only from the real per-mission rewards (the rewards routine adds them to the stored
counts and saves `<player>.mry`, the player's army file), the Merchant and Upgrade Army. A mission's issued force
and its casualties don't touch it. The Merchant charges 3 of one collectible per collectible and Armor + Weapons +
Lore per Militiaman (`a_m` / iOS `MenuScreen::handlePopUpEvent` popup 61).

## 10. Ability enum (index = string 5004 − 492, pinned by Pike Wall = 27 = string 519)

```
1 First Strike  2 Last Strike  3 Blast Area  4 Fearless  5 Formation  6 Spot  7 Move-or-Shoot
8 Shoot-and-Move  9 Fire Arrows  10 Flammable  11 Battle Standard  12 Awaken Spirits  13 Burst
14 Fear  15 Charge  16 Stealth  17 Ambush  18/21 Magic  19/22 Prayer  20 Greater Shapeshift
23 Siege  24 Barrage  25 Low Arc  26/27 Pike Wall  28 Spirit Shroud
```

A unit **has** ability N iff `ao[0]==N ‖ ao[1]==N ‖ its weapon's bV/bW == N` (see `data/combat-data.js`).

---

## 11. Fidelity ledger — recreation vs source

Where each mechanic comes from: **DATA** (byte/string/bytecode-proven) vs **AUTHORED** (real mechanic,
our tuning). Ordered roughly by subsystem.

### Units & combat

| Feature                                                               | Where                                                               | Source                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Cost / MOVE / weapon+armour kit                                       | `engine/engine.js` UNIT_TYPES, `ReignShell` UNIT_META               | **DATA** — 5010 bytes 0,2,3,cost                                                                                                     |
| Branching upgrade tree + collectible per upgrade                      | `ReignShell` UNIT_META.upgrades                                     | **DATA** — 5010 upgrade slots                                                                                                        |
| Damage formula + 27×16 weapon×armour matrix                           | `data/combat-data.js` WEAPON_DMG + `engine/engine.js` computeDamage | **DATA** — table `bS` + `La/q.a`, byte/bytecode-exact (§3-4)                                                                         |
| Per-unit ATK rating / armour / weapon / range                         | `data/combat-data.js` UNIT_COMBAT                                   | **DATA** — 5010 move/am/weapon/aq + bT/bU                                                                                            |
| HP = 100 for all (toughness = armour)                                 | uniform                                                             | **DATA** — `ar=aY=256`, no per-unit HP                                                                                               |
| Charge min 3 tiles +30 · no variance · Heal +20                       | `engine/engine.js`                                                  | **DATA** — `c(target)`, `a.g.l` identity, `ar+=51`                                                                                   |
| Aura ±15 within 4 tiles                                               | `engine/engine.js` ratingAura                                       | **DATA** — Hero Battle Standard (g11) + Shamans Spirit Shroud (g28); NOT Druids                                                      |
| Per-unit abilities (index = string5004−492)                           | `data/combat-data.js` UNIT_COMBAT.abilities                         | **DATA** — `ao[0]∪ao[1]∪weapon{bV,bW}`                                                                                               |
| Formation −10% incoming per adjacent ally                             | `engine/engine.js` formationAllies                                  | **DATA** — the `g(5)` loop                                                                                                           |
| Fire ×2 vs Flammable (arrows/fireball → catapults)                    | `engine/engine.js` computeDamage                                    | **DATA** — `g10 = Flammable` (earlier mis-called "pierce vs shield")                                                                 |
| Pike Wall — braced first-strike, persists until broken                | `engine/engine.js` `_preStrike`/`walled`                            | **DATA** — `g(27)&&P&&aU∈{3,4}`; survives cavalry, breaks on a non-cavalry melee hit                                                 |
| Two-weapon range switching (bow↔sidearm, ball↔grape)                  | `engine/engine.js` weaponAt                                         | **DATA** — the `aW` mode pick; range = union of both bands                                                                           |
| Move-or-Shoot / First-Last Strike / Fear / Siege area / Priest Shield | `engine/engine.js`                                                  | **DATA** — ability sets from data/combat-data.js                                                                                     |
| Shapeshift — TEMPORARY (transform → act → revert)                     | `engine/engine.js` shapeshiftSelected/_revertShift                  | **DATA** — `La/q.a(20)` saves type in `aZ`, reverts after acting; was a one-way transform                                            |
| Wizard casts Fireball / Priest Heal 20                                | `engine/engine.js`                                                  | Heal **DATA**; Wizard=Fireball(25) is the Magic ability's spell (weapon slot is a Wand) — AUTHORED override                          |
| Fireball splash 50% to neighbours                                     | `engine/engine.js` resolveDamage                                    | area **DATA** (Blast/Barrage); the 50% falloff AUTHORED                                                                              |
| Lightning Storm & Ice Field (wizard spell cycle)                      | `engine/engine.js` weaponAt/resolveDamage                           | Lightning & Fireball **DATA** (552/553); Ice Field assigned to the Wizard is AUTHORED                                                |
| Destructible ramparts (siege / fire breach walls)                     | `engine/engine.js` damageStructure/breached                         | **DATA** (545/530) — walls block mounted/siege; breach opens to all                                                                  |
| Ambush / Stealth-Spot (dormant)                                       | `engine/engine.js` (dormant)                                        | mechanic **DATA** (508/509/537/1030); no roster unit carries them (tribal), kept faithful but off                                    |
| Unit card readout (Cost-as-power, no ATK/DEF/★)                       | `ReignShell`/`ReignOfSwords`                                        | **DATA** — game shows Deployment Cost (488/489) + weapon/armour + Abilities (491); byte7 `ap` never read. Invented ATK/DEF/★ removed |

### Forces, economy & meta-progression

| Feature                                                                                   | Where                                                                      | Source                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-mission force model (player=team0, enemy=team1)                                       | `levels.json` (regen_forces.py) + `engine/engine.js` + `ReignShell` armyOf | **DATA** — §5 team table; gold-0 = preset set-piece, gold>0 = deploy budget. Fixed a side-inversion; flyers kept over terrain                                                                                                                                                                                                                                                                                                                    |
| Per-mission rewards (units + collectibles)                                                | `rewards.json` + `ReignShell` grantMissionReward                           | **DATA** — header `o[]/p/q` (§5), all 71 missions. The `q` "random" flag is **0 for all 78 records** → rewards are never randomised, so our deterministic grant is byte-exact. Verified: Carrone-1 → {Armor2,Lore2,Spirit1}; Carrone-2 → {footmen2,halberdiers2,Armor2}                                                                                                                                                                          |
| Army growth (rewards + Merchant + upgrades; no losses)                                    | `useCampaignSave` armyOf()                                                 | **DATA** — `STARTER_ARMY({}) + Σ rewards[done] + upgrades/merchant`. `createRewardsMenu` reloads the stored counts and only adds the reward list; nothing is subtracted for the dead (help 751's UNITS LOST is online-only), and a mission's issued force never joins the army.                                                                                                                                                                  |
| Starter army = **empty**                                                                  | `ReignShell` STARTER_ARMY={}                                               | **DATA** — new game zeroes (`La/r.e()`, reset, empty default); no `.sav` bundled; only non-zero init is the `a.b` debug cheat                                                                                                                                                                                                                                                                                                                    |
| Spoils per victory                                                                        | `ReignShell` grantMissionReward                                            | **DATA** — exact per-mission collectibles (not random); story totals Armor6/Lore2/Spirit1/Medal11                                                                                                                                                                                                                                                                                                                                                |
| Deploy = own army + points budget + elite cap (1/1000)                                    | `engine/engine.js` deploy                                                  | **DATA** — strings 747/675/690 + team gold `Z`                                                                                                                                                                                                                                                                                                                                                                                                   |
| The Merchant (3 of one kind per collectible, Armor+Weapons+Lore per Militiaman; ×N, ≤500) | `ReignShell` MerchantShop                                                  | **DATA** — `MenuScreen::handlePopUpEvent` popup 61 (iOS Ep1 @0x3ed2a / Ep2 @0x4ab1c, Android `a_m`)                                                                                                                                                                                                                                                                                                                                              |
| Skirmish armies                                                                           | `levels.json` + `engine/engine.js` skirmishArmy                            | **DATA (mostly).** The 5100 family splits: **5 skirmishes (5204/5205/5206/5207/5218) store REAL preset armies** — now used byte-exact like campaign set-pieces. The other **23 store only a gold budget** and the game builds both sides at _runtime_ — there is no stored data to lift, so we generate through the real deploy economy (real costs, 1-elite-per-1000, the record's real budget); only the runtime buy-weighting is a heuristic. |

### Missions, waves, objectives, AI

| Feature                                                              | Where                                                 | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed-force tutorial squads (5800/5801/5803)                         | `engine/engine.js` TUTORIAL_FORCES                    | **DATA** — real op-0 spawns for both sides, team-split                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reinforcement waves (real triggered columns)                         | `waves.json` + `engine/engine.js` _fireWaves          | **DATA** — trigger `[round,team,cmdIdx]` → op-0 spawn chain (§5). 8 missions: enemy columns + player relief. Fires once at the matching side's phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mid-battle dialogue events (real triggered messages)                 | `battle_events.json` + `engine/engine.js` _fireEvents | **DATA** — the same triggers' **op-1 `f(screenId)` MESSAGE** chains (resource-5009 screen → field[7]=5004 string, field[2]=speaker). **31 events / 19 missions**: tactical beats (Carrone 1's 4-part R1-4), enemy taunts (Pellus, Valeuve), ambush stings, and the callouts that announce a reinforcement column ("Horselords riding hard from the west!"). Fired once at the top of their round; shown as a speaker-named dialogue banner. (Speaker NAMES: Pellus/Valeuve/Martin confident, the rest are role labels + a your/foe side split — the one authored part.)                                                                                                                                                                                                                                                                                           |
| Varied win-conditions (escape/hold/engines +protect/capture/destroy) | `engine/engine.js` WIN_CONDITIONS/_terminal           | **mechanics DATA** (strings 1036/1039/869/1034/826/917). The per-mission _type_ is genuinely **code-selected, not a liftable byte**: verified that no record header field (`i/am/an/p/q`) correlates with the known conditions, and the objective string per mission is a computed index. So the type is grounded in the real objective/dialogue strings (5406 hold=869, 5412/5413 escape=904/1039, 5416 engines=1034) — near-exact, not byte-exact.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Enemy AI — influence map + real target scoring                       | `engine/engine.js` buildInfluence + aiStep            | **DATA** — `La/j` influence (radius-4, weights [100,50,25,12,6]) **plus the real target scoring ported from `La/q.y()` case 4/5**: the objective is the enemy maximising **AI-value × current HP** = `at × ar` (`at=((cost−50)·50/450)+50`). So the AI attacks the strongest INTACT high-value foe — it does NOT focus-fire the wounded and does NOT retreat on its own HP (my earlier authored focus-fire/retreat were the _opposite_ of the real behaviour, now removed). Verified: picks the full-HP knight over the 15-HP cavalry; 5/5 units still advance.                                                                                                                                                                                                                                                                                                   |
| Enemy AI — the `La/q.y()` role branches                              | `engine/engine.js` aiStep                             | **DATA (ported & verified)** — the per-role cases of the real state machine now drive the AI: **case 3 heal** (a unit with `T.heal` heals the wounded ally that maximises `(100−hp)·AI-value` at an adjacent tile instead of attacking), **case 2 shapeshift** (an AI druid transforms — becomes a bear — before acting), **case 9 ranged standoff** (`if(ranged) score += dToE·30` → archers keep their distance rather than closing), **case 10 siege coverage** (`if(splash) score += (blue within 1 of e)·500` → catapults aim at the densest cluster), **case 15 objective-seeking** (`objTarget` = nearest non-red objective; a unit with no juicy target advances to contest the capture point). Each verified in-browser: healer 30→50 hp (no attack), druid→bear, archer holds dist 3, catapult picks the 3-cluster, red unit walks a capture point 4→0. |
| Formation "March Order" (group move + attack)                        | `engine/engine.js` beginMarch/_marchAttack            | mechanic **DATA** (671); the banner/two-finger UI not reproduced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Story, dialogue, presentation

| Feature                                          | Where                                                   | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-mission dialogue (text + order + grouping)   | `campaign.json`                                         | **DATA** — string table 5004 is mission-ordered (anchored by objective strings 797/804/826…)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Speaker per line                                 | resource **5009** field[2] → `line2speaker.json`        | **DATA** — the conversation screen's speaker id (§6); 22 coherent clusters. Corrects an earlier "not liftable" claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Dialogue portrait = a real character FACE        | `portraits/face0NN.png` + `ReignShell` FACE/FACE_SRC    | **DATA (art) — CORRECTS the earlier "crest, not face" claim.** The iOS build's own portrait atlas (res **5006**, `ios-episode-1/portraits`) is explicitly the game's **31 dialogue faces** (86×144 busts: the crowned Emperor, the white-bearded advisor, blue-helm imperial soldiers, red-helm foes, sinister lords, + wounded variants). We ship these real faces. The exact speaker-id→face-index table is computed in the screen code (not a flat resource), so the 9 story speaker-roles are **cast** to the best-matching real faces (authored casting, documented §6). The busts face different ways, so each portrait is seated to look **into** the text box — a left-facing bust (Anston, the lords, brigands) sits on the **right**, a right-facing bust (Emperor, soldiers, advisor) on the **left** (`FACES_LOOK_LEFT`) |
| Heraldic crests = kingdom devices (NOT dialogue) | `crests/*.png` (available)                              | **DATA (art)** — 7 real coloured crests (6360-6366) + composed Aguilleon griffon, plus the 73 small iOS shields (res 6300, 34×53). These are **faction/map heraldry**, not the dialogue portrait — the prior build wrongly put them in the dialogue box (that was the "weird sigil"). Kept for a future map/roster faction marker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SFX event → sound                                | `engine/engine.js` audio + `public/…/audio`             | **DATA — the real map is a byte-exact per-weapon switch** in `La/q` (§8): spear/pike → clang A (593/620/647), other melee → clang B (674/701), bows → arrow (815), musket & cannonball → bang (453), catapult → thud (763), lightning → thunder (566), foot-move 279 / griffon-fly 178. Our SOUND_NAMES categories match; only the melee-variant and catapult/cannon split are sub-byte gaps. 32-sound `audio.dat` bank                                                                                                                                                                                                                                                                                                                                                                                                              |
| Terrain props / maps / world-map coords          | terrain.json / tileset.png / worldmap.jpg / KINGDOM_POS | **DATA (props) + heuristic (category label)** — real per-tile passable/movecost/defBonus, baked 124-tile tileset, resource 6500, `La/m` coord arrays. The per-tile **category** (grass/forest/hill/…) is a visual classification of the baked tiles and had residual errors — fixed **tile 0** (a dense pine-forest tile, 2nd-most-common at 4576 cells, was mislabeled `grass` with 0 cover → now `forest`, defBonus 0.25). Known lower-confidence mismatches remain (t72-76 rocks tagged "water"; t101-108 mossy tagged "road"), left as-is pending certainty                                                                                                                                                                                                                                                                      |
| No background music                              | —                                                       | **DATA** — verified: the archive/bundle/binary/APK carry no music track                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## 12. Genuinely NOT byte-exactly reproducible (with the code evidence)

These are the only items that cannot be lifted as data — each because the source is runtime-computed,
obfuscated, or a UI gesture, not a stored value. For each, we get as close as the code allows.

| Item                                                                  | Why it can't be byte-exact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | How close we get                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **23 empty-skirmish armies** (5208-5231 minus the 5 preset)           | The record stores only a gold budget; **both sides are built at runtime** — there is no army in the file to lift.                                                                                                                                                                                                                                                                                                                                                                                              | Generate through the _real_ deploy economy (real costs, 1-elite-per-1000, the record's real budget). Only the buy _order_ is heuristic.                                       |
| **Win-condition TYPE per mission**                                    | Verified no record field (`i/am/an/p/q`) encodes it; the objective string is a **computed index**, so the condition is code-selected per map.                                                                                                                                                                                                                                                                                                                                                                  | Grounded in the real objective/dialogue strings (5406=869 hold, 5412/5413=904/1039 escape, 5416=1034 engines).                                                                |
| **Exact speaker→face lookup**                                         | field[2] (the speaker id) is real & lifted; the field[2]→portrait-index step is computed in the conversation-screen code, not a flat resource.                                                                                                                                                                                                                                                                                                                                                                 | Ship the **real 31 dialogue faces** (res 5006) and **cast** the 9 story speaker-roles to the best-matching real face; the per-line face is authored casting, the art is real. |
| **The last two AI state-machine states**                              | Most of `La/q.y()` is now ported — influence map, `at × ar` target scoring (case 4/5), and the role branches: heal (3), shapeshift (2), ranged standoff (9), siege coverage (10), objective-seeking (15). What remains is only the **squad-cohesion formation march (case 6)** and the **self-preservation flank/retreat (case 14)** — cross-unit _emergent_ states (a unit's choice depends on every squadmate's choice this tick), which is a coupled multi-agent solve, not a per-unit rule or a data lift. | The per-unit roles are all in and verified; only the two group-emergent states (formation cohesion, flank/retreat) are unported.                                              |
| **Formation-Order two-finger gesture UI**                             | A touch-drag _interaction_, not data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | The order itself (march a group to a point and attack, string 671) works; the gesture UI doesn't.                                                                             |
| **Exact WAV per event** (melee variant, catapult-thud vs cannon-bang) | The `.g` sound ids are known (§8) but the `.g`→`audio.dat`-index step is runtime clip registration.                                                                                                                                                                                                                                                                                                                                                                                                            | Our category mapping (melee/arrow/gun/cannon/move) matches the real per-weapon switch.                                                                                        |

**Everything else in this document is byte / bytecode / string-exact.**
