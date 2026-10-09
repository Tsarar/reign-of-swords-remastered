# Reign of Swords — Extracted Assets

Clean, deduplicated, typed extraction of the art / audio / data from three related
Punch Entertainment tactics games. Every sprite is sorted into a category subfolder.
Pair this with **`MANIFEST.json`** (one record per file).

> Extracted for asset-recovery from packages the owner has clearance to use. These are
> game assets; the original source code was not reproduced.

---

## Folder structure

```
extracted-assets/
├─ README.md            ← this file
├─ MANIFEST.json        ← per-file metadata (see schema below)
├─ _sheets/             ← overview montages (open these first)
│    android__units.png · ios-episode-1__units.png · ios-episode-2__units.png
│    android__effects.png · android__portraits.png · heraldry.png
│
├─ android/             REIGN OF SWORDS — Android 2015 (highest-res; best source)
│    ├─ units/          69  unit / creature animation strips
│    ├─ effects/        31  combat FX (fire, explosions, projectiles, magic)
│    ├─ terrain/         6  tile sheets (grass/path/wall/tree autotiles)
│    ├─ portraits/      33  dialogue faces (character emotional/damage states)
│    ├─ heraldry/       73  coat-of-arms emblems (banner charges)
│    ├─ backgrounds/     1  JPEG (was zlib-compressed inside the pack)
│    ├─ ui/             18  icons / bars / buttons
│    ├─ misc/           18  unclassified (mixed UI / small sprites)
│    ├─ audio/          raw only — see NOTE.txt (index uncracked)
│    ├─ fonts/          font_celtic.ttf, font_title.ttf
│    └─ _raw/           original ros.dat + audio.dat (untouched)
│
├─ ios-episode-1/       REIGN OF SWORDS — iOS 2008 (the original)
│    ├─ units/ 26 · terrain/ 6 · portraits/ 32 · heraldry/ 73 · ui/ · misc/
│    ├─ audio/ 37 wav   └─ _raw/
│
└─ ios-episode-2/       REIGN OF SWORDS: EPISODE II "Hexhammer" — a SEPARATE sequel
     ├─ units/ 40 · terrain/ 5 · portraits/ 37 · heraldry/ 73 · ui/ · misc/
     ├─ notable/         the crimson "spear-demon" (g_021 / g_022, 16f × 140px)
     ├─ audio/ 53 wav   └─ _raw/
```

These are **three different games**, not one. Android is a 2015 high-res redraw of
Episode I; Episode II is a distinct, larger sequel.

---

## Category meanings

| Folder | What it holds |
|---|---|
| `units/` | Battlefield unit & creature **animation strips** (a row of equal-width frames). May include a few wide FX strips. |
| `effects/` | Combat particles: fire, explosions, arrows, cannonballs, muzzle flashes, magic, smoke. |
| `terrain/` | Tileset sheets — grass / dirt-path / water / wall / tree autotiles (64px & 88px cells). |
| `portraits/` | Character dialogue faces in normal / talking / wounded states (**not** one-per-unit). |
| `heraldry/` | Coat-of-arms emblems (lions, eagles, crowns, weapons…) for banner customization. |
| `backgrounds/` | Scene / menu JPEG art. |
| `ui/`, `misc/` | Icons, bars, buttons, and small unclassified sprites. |
| `audio/` | SFX (iOS = WAV; Android = raw, see note). |

The **clean roster to look at first is `_sheets/*.png`.**

---

## Naming & frames

Files are `<idx>_<W>x<H>.png` (a `z_` prefix means it was zlib-compressed inside the pack).
Animation strips are a horizontal row of equal frames:

```
frameCount = round(W / H)      # e.g. 616/88 = 7
frameWidth = W / frameCount    # 88 px
frame k    = crop(k*frameWidth, 0, frameWidth, H)
```

Known non-square exception: the **King** strip is 4 frames × 72px (288×88), not 3×96.
`MANIFEST.json` stores the detected `frames` / `frameW` for every strip.

### `MANIFEST.json` record
```json
{ "path":"android/units/039_616x88.png", "game":"android", "category":"units",
  "w":616, "h":88, "frames":7, "frameW":88, "compressed":false, "bytes":12345 }
```

---

## The `.dat` container format

Custom indexed archives. Payload is a mix of **raw PNG**, **raw JPEG**, **zlib streams**
(`78 9C`, must be inflated — they held ~65% of the Android pack), and raw data tables.
To re-extract: carve PNG/JPEG by magic, then scan for `78 9C`, `inflate` each stream, and
carve PNG/JPEG from the output. The **image index is not cracked**, so sprites are named by
carve-order + dimensions rather than their original logical names.

---

## What the assets are FOR — game mechanics

**Turn-based tactics on a tile grid** (Advance-Wars / Fire-Emblem family), confirmed by
decompiling the Android `classes.dex`: the main game class holds a 2-D tile map (`[[I`),
there is an `AStar` pathfinder, `TerrainInfo`, `UnitSelector`, `GroupLogic`, and
`HeraldryControl`; each unit carries per-tile move/attack state. In-game strings:
`"- SET THE PATH -"`, `"cell status"`, `"Turn Limit:"`, `"Mission Type:"`,
`"Deployment Cost:"`, `"- REPOSITION UNIT -"`, plus an AI (`"INVALID AI MOVE LOCATION"`).

Loop: build/deploy an army within a cost budget (with heraldry) → each turn select a unit,
path it across tiles (A*, limited by movement + terrain), attack an enemy in range → HP
shown as a 0–100 number over the unit → alternate turns vs an AI → missions have a turn
limit + objective.

---

## Roster & reuse notes

- Definitive unit roster ≈ **60 types** (Android) — see `_sheets/android__units.png`.
  Infantry (sword/greatsword/spear/halberd/axe/mace), cavalry (knight/lancer/mounted
  variants), ranged (archer/crossbow/handgunner), siege (catapult/ballista/cannon×2),
  casters (mage/druid/priest), beasts (boar/bear/elk/griffin), King + banner-bearers.
- Team colour is baked in (blue). For a second team, tint via canvas
  `source-atop` fill `rgba(196,42,42,0.5)` (crimson).
- Terrain grass tiles are seamless autotiles — tile on a fixed grid, don't random-flip.

## Known gaps
- Android `audio.dat` index uncracked → 32 MP3s not split (raw preserved in `android/_raw/`).
- Graphics `.dat` index uncracked → no original logical sprite names.
- iOS `reignofswords.dat` zlib streams contained no PNGs (raw bitmap/data needing the index).
