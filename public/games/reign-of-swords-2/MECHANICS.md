# Reign of Swords — Mechanics & Decompilation Reference

This is the complete account of how the recreation works and where every rule comes from. Each finding cites the
original code it was read from: a C++ symbol and address in the iOS binaries (`ros_ep2` = _Reign of Swords Episode II_
1.0.11, 2009; `ros_ep1` = _Reign of Swords_ 1.2, 2008 — addresses are `ros_ep2` unless marked Ep1), a resource id in
the `.dat` archive, or a string id from the 5004 text table. Where a rule is ours rather than the original's, it says
so. The decoder scripts named here live in the project's `tools/ros/` folder and everything they read is in the
download.

## 1. Sources and tools

- **iOS binaries** — Mach-O armv6 Thumb with full C++ symbol tables (unencrypted). Read with `tools/ros/rosbin.py`
  (annotated disassembly of any symbol; `--all` dumps everything) and `tools/ros/rosrange.py` (an address range, for
  the static helpers that carry no symbol, e.g. the unit-AI handlers at 0x7c6e2–0x7d6f2).
- **`reignofswords.dat`** — the packed resource archive: `u32 count`, then per record `{id, packed type/offset, len}`;
  type 1 payloads are zlib. Reader: `tools/ros/rosdat.py`.
- **Resource families** — 5004 strings (unit/ability names, help, tutorial and menu text); 5009 dialogue screens
  (34-byte records, field[2] speaker, field[7] string); 5010 the unit table + weapon×armour damage matrix + terrain
  rows; 5017 the in-battle animation list; 5064 the quicksand whirlpool strip; 6201–6209 heraldic fields, 6301–6366
  charges, 6401–6409 frames; 5006 dialogue portraits (Ep1) — Ep2 portraits are 5017 frames 52–87; scenario records
  (mapId − 100) per mission; map grids per mapId.
- **`audio.dat`** — `u32 count (LE)`, then `count × {id, offset, len}`; offsets are relative to the end of the table.
  Entry N is sound id N exactly as `Context::play(id)` uses it.
- **Decoder toolkit** — `scenario.py` (mission grammar = `Mission::load*`, every record consumes exactly),
  `campaign.py` (kingdoms + unlock graph from `MenuScreen::selectKingdom`), `units.py` (5010 audit), `anim.py` (5017),
  `dialogue.py`, `audit.py`, `atlas.py` (the visual atlas at `/ros-atlas/`), `export_levels.py` (regenerates
  `levels.json`, `waves.json`, `battle_events.json`, `scripts.json`, `scripts_ai.json`, `group_heraldry.json`,
  `rewards.json`, `campaign.json`).
- **Android build** — the older notes came from the Android `classes.dex` (damage code `La/q`, turn cycle `La/g`).
  Where the two disagree the iOS binaries win; the Android reading of the shield (×0.75) and of the unit AI were both
  wrong and have been replaced.
- **Archive reader** — verified against `ResourceManager::read` in both binaries (u32 LE count, `{id, type/offset, len}`
  records, zlib for type 1).
- **Resource ids by slot** (`Context::deleteAllSaves` literal ranges, `MenuScreen::onMenuEvent` @0x5cd42): story map =
  5400 + 3·kingdom + slot, raid = 5600 + 3·kingdom + slot, skirmish = 5200 + 4·kingdom + slot, tutorial = 5800 + slot;
  scenario record = map id − 100. Names come from a per-kingdom block of 11 strings (`Context::getKingdomName`,
  `Context::getMapName`: +0 "Kingdom of X", +1..3 story, +4..6 raids, +7..10 skirmishes).

## 2. Units — the 5010 table

- Each unit record is 15 bytes `B[0..14]` + 3 lists + 6 upgrade slots, then a weapon table with header
  `[minRange, maxRange, ability, ability]` — ref: `Unit::readTypeInfo` @0x6482a, decoded by `tools/ros/units.py`.
- **B[0]** move points · **B[2]** armour id · **B[3]** weapon · **B[4]** second weapon (side-arm: the archer's short
  sword, the cannon's Grapeshot) · **B[5], B[6]** ability ids · **B[7]** COURAGE tier (stored at Unit+0x188, what
  `getCourage` switches on) · **B[8]** ATTACK rating tier (Unit+0x18c, what `getSkill` uses) · `lists[0][0]` the
  deployment cost the game shows as POW.
- **Rating tiers** 0..5 → attack skill 45/60/75/90/100/115 (`Unit::getSkill`) and courage 35/50/65/85/100/125
  (`Unit::getCourage` @0x66e90).
- **Weapons** 1 Staff · 2 Talon · 3 Spear · 4 Antlers · 5 Sword · 6 Mace · 7 Wand · 8 Short Sword · 9 Paw · 10 Halberd ·
  11 Flail · 12 Pike · 13 Greatsword · 14 Scythe · 15 Lance · 16 Longbow · 17 Crossbow · 18 Musket · 19 Short Bow ·
  20 Rock · 21 Boulder · 22 Pitch · 23 Cannonball · 24 Grapeshot · 25 Fireball · 26 Lightning · 27 Bolt; Episode II adds
  29 Hammer Throw, 30 Mallet, 31 Conjured Blade and the Ballistae's Piercing Bolt.
- **Armour** 0 None · 1 Padded · 2 Robes · 3 Light · 4 Nature's Cloak · 5 Breastplate · 6 Light & Shield · 7 Hide ·
  8 Heavy · 9 Holy Vestment · 10 Heavy & Shield · 11 Nature's Shield · 12 War Engine · 13 wood and 14 stone are the
  structure "armours" (see §6) · 15 Relic Armour.
- **Abilities** (5004 string order): 1 First Strike · 2 Last Strike · 3 Blast Area · 4 Fearless (no unit carries it) ·
  5 Formation · 6 Spot · 7 Move or Shoot · 8 Shoot and Move · 9 Fire Arrows · 10 Flammable · 11 Battle Standard ·
  12 Awaken Spirits · 13 Burst · 14 Fear · 15 Charge · 16 Stealth · 17 Ambush · 18/22 Magic · 19/23 Prayer ·
  20/21 Greater Shapeshift · 24 Siege · 25 Barrage · 26 Low Arc · 27 Pike Wall · 28 Spirit Shroud · 29 Arc · Episode II
  30 Leashing · 31 Build · 32 Repair · 33 Siege Armor · 34 Conjure · 35 Absorb · 36 Detonate · 37 Quicksand ·
  38 Life Steal. (An older table had the siege names off by one.)
- **Episode II units** — Craftsmen (type 29, rating 2), Ballistae (30, rating 3), Conjurer (31, rating 2), Sapper
  (rating 0, conjured), Bodyguard (rating 4, conjured), Dune Sirens (34, rating 2), Blood Gorgers (35). Their rating
  tiers were once read from the wrong byte and are now from B[8].
- The recreation's `data/combat-data.js` is generated from this table (0 mismatches on Ep1, ranges compared on the ranged
  weapon only). `kind` (spear/melee/cavalry/ranged/siege/hero) is OUR grouping for icons and AI, not a table field.

## 3. Combat — `Unit::calculateAttackDamage` @0x6af20 and friends

- **Damage is weapon-versus-armour.** `base = WEAPON_DMG[weapon−1][armour]` from the 5010 matrix; there is no
  weapon triangle. The original keeps HP on a 256 scale (100 HP = 256, Unit+0x190) and shows `HP·100 >> 8`; the
  recreation keeps whole HP (§13).
  Combat is deterministic apart from courage, deviation and the Lightning Storm's start.
- **Distance is Manhattan everywhere** — `Unit::getDistance(u, false, true)` → `getUnitMoveCost(.., true)` = |dx|+|dy|.
  Melee is 4-directional; the "diagonal ×0.8" branch in calculateAttackDamage is unreachable.
- **Attack rating** (`Unit::getSkill`): tier 45/60/75/90/100/115, +15 with a friendly Battle Standard or Spirit Shroud
  within 4 (not for the Hero himself), −15 with an enemy Spirit Shroud within 4, +30 per PINCER ally
  (`Unit::calcFlankBonuses`: a friendly unit adjacent to the target directly opposite the attacker) for melee, +15 for
  the team holding the capture points (Mission+0x260, written by `GameScreen::updateCapturePoints` = the team with
  STRICTLY the most units on the capture tiles).
- **Courage** (`Unit::getCourage` @0x66e90): tier 35/50/65/85/100/125, +15 friendly Standard/Shroud within 4 (the Hero
  included — only getSkill leaves him out), −15 enemy Shroud, +15 for the capture-point holder. A unit attacking a
  Fear-causer rolls `(random(1000)·256/1000) ≤ courage·256/100` and balks on failure (`Unit::attack`, sound 44); Fear
  units and Fearless units skip it (no unit is Fearless).
- **Charge** +30 (flag @0xb4): a mounted unit whose foe is more than 2 tiles (Manhattan) from its START tile and
  within its move, along a straight or diagonal lane of empty, affordable tiles — ref: `Unit::createChargeTargetList`
  (Ep1 @0x6037a, Ep2 @0x70d78), `Unit::isValidChargePath` @0x68d38 (Griffon/Great Eagle skip terrain). So it gallops
  two tiles and strikes the third. The foot unit behind the target is trampled with the same blow; a charge that kills
  its target carries the rider onto the cleared tile, and on to the trampled unit's tile if that one died too
  (`Unit::charge` @0x6bfe6 builds the run as a path; the two-kill landing is user-confirmed from play). Episode II
  adds one rule: no charge out of quicksand (`createChargeTargetList` @0x70bd2 lists no target while the rider's own
  tile is quicksand). Otherwise both episodes run the same charge code, bar Episode I's Pike Wall +30 vs a charge.
- **Pike Wall / First & Last Strike** (`Unit::isFirstStrike` @0x66fb4): pikemen always strike first against a mounted
  attacker (class 3 cavalry or Griffon Riders) unless it is the Hero; a braced wall strikes first against everyone but
  the Hero; Ep1 adds +30 to a braced pike's hit on a unit that is CHARGING (its state 3/4, @0x59902) — Ep2's damage
  code has no such +30 (see §13 for how the recreation applies it). A First Strike defender does not pre-empt a First Strike attacker; a Last Strike attacker
  still swings first against another Last Strike unit and against Cannon / Ballistae.
- **Formation**: −10 defence per adjacent Formation ally, skipped for Boulder (21) and Cannonball (23).
- **Cover**: terrain defence from the 5010 terrain row (`Map::getTileDefense`); Boulder and Cannonball half-ignore it
  (`def ≤ 80 → def += (100−def)/2`) and deal 0 to a FLYING target.
- **Shield** (`Map::isUnitShielded` @0x3b3ca): the map keeps a per-team list of priests who INVOKED Shield; a unit
  within Manhattan 2 of one (the priest included) takes ranged damage `>> 1` — it halves. It is a cast, not a passive
  aura, and expires at the team's next turn start.
- **Retribution** adds a smite to the counter. The prayer pushes the priest's tile on a per-group list (Map+0x158);
  `GameScreen::startTurn` clears that group's list. A unit within Manhattan 2 of a mark of its side
  (`Map::isUnitRetributioned` @0x3af88) is guarded: when an enemy's own MELEE blow lands on it on that enemy's turn
  (a shot never — a bow, musket or hammer goes straight to its projectile state, whose landing has no Retribution
  test; nor an area attack — exactly the help's "increase the counter attack strength of nearby allies"), it first goes to state 14 — `applyDamageRaw(25)` on the striker (@0x77846): 25 of
  256, about 10 HP, armour ignored, even if the guarded unit fell; the sword of light (#8) comes down on the striker and
  the read-out shows "10" — and then state 14's end decides the counter (@0x77a84): only if the striker had the
  initiative (`Unit::isFirstStrike(striker, guarded)`) and stands next to it (or the guarded unit has First Strike
  itself) — with no weapon that reaches (a Horse Bowman's bow at point blank) that counter is a bare swing for 0.
  A charge instead counts
  the guarded units it hits (Unit+0xc8, @0x78828) and is smitten for 25 per unit, +25 while its target stands, when it
  ends (`Unit::doFinishMoving` @0x774b2); that smite runs the same end, so a surviving target may then counter the
  rider — the only counter a charge ever meets. A slain priest takes its marks with it (`GameScreen::onEvent`, the
  unit-died event, deletes the positions on its tile); Shield's marks (Map+0x130) work the same way.
- **Siege Armor** (`Map::isSiegedAmor` @0x3ac3c): Ballistae always; other war engines when a friendly Ballistae is
  within the 5×5 square (Chebyshev 2). Melee damage ×8/10.
- **Absorb** (help 585, flag @0x384): an invoked one-hit shield on the Conjurer, laid by sacrificing a Bodyguard;
  `Unit::applyWeaponDamage` consumes it (target type 31 → damage 0, flag cleared; `calculateAttackDamage` returns 0 at
  @0x6af38).
- **Life Steal**: `Unit::applyDamage` @0x6b406 stores the Blood Gorgers' bite damage; `Unit::onTick` @0x780ac heals
  3/2 of it, capped at full health.
- **Flammable** ×2 from a fire WEAPON (`Unit::isFireWeapon` @0x80214: tag 9 Fire Arrows or 13, or the Fireball) — the
  weapon used, so an Archer's Short Sword is no fire. The binaries also have a BURNING tile overlay (5017 #41,
  `Map::renderBurning`, visual only) that the recreation does not draw.
- **Deviation** (`Unit::_executeAction`, `Unit::getDeviationChance` @0x665fa): a Barrage weapon (the Catapult's Rock)
  drifts on a flat 35 %; Arc weapons (Boulder) 15 % on cover / 100 % on a flier / 65 % vs cavalry and wizards / 25 % vs
  engines / 45 % otherwise; Low Arc and every Cannon shot 10/100/50/20/35; the Ballistae never. A drifting shot moves
  one tile in one of eight directions — off the board too, where it hits nobody.
- **Kills and score**: `applyWeaponDamage` adds the victim's point value (@0x194) to the killer's team for mission
  types 1–3. Units that die simply leave the field — there is no death sound in the original.
- **Villages and keeps** heal the shown HP by the terrain row's `heal` (20) at the start of the unit's turn; a
  Priest's Heal and a Craftsman's repair of a war engine add 51 of 256 (+20 here, in whole HP).
- **Pincer detail** — `Unit::calcFlankBonuses` @0x6ac50 is called by `getSkill` for a melee blow only: the axis is
  attacker → target (east-west or north-south) and every other friendly unit adjacent to the target on that axis adds
  +30.
- **Charge cost** — each lane step costs `Map::getMoveCost`, counted twice on a diagonal (`createChargeTargetList`
  @0x70ee0), and the whole run must fit the mount's move.
- **Destructible structures** — byte-faithful to `Map::applyDamage` @0x7ffa0: every cell starts at 256 structure HP
  (`Map::loadMap`); a blow of weapon w on a cell of material m (`Map::getTileArmorType`: 13 wood / 14 stone) removes
  `((HP256 · getSkill256) >> 8) · (w[m]·256/100 · share) >> 8`, where HP256 is the attacker's strength on the 256 scale,
  getSkill its attack rating with auras, and share the blast share of that cell (100 % at the centre). The cell drops
  ONE damage stage (`Map::getTransitionTile`, the tile is redrawn by `Map::tag`) when it was untouched and the blow did
  any damage, or when HP falls below 0; HP is not reset by a stage change, so a pristine house is damaged by the first
  real hit and destroyed once 256 damage has accumulated. Open ground loses HP too (material 0) and a village later
  built on it inherits that. The struck cell takes the blow whenever a unit sheltering there is hit
  (`Unit::onTick` → `Map::applyDamage`) and when a shot is aimed at the empty building.
- **Repair** — `Map::applyRepair` @0x80088 (called from `onTick` with 20): +20 structure HP and the cell steps back one
  stage; a Craftsman may mend an adjacent cell that some earlier stage transitions into (`Unit::canRepair` →
  `Map::isStructureRepairable`, `getPreTransitionTile != −1`) or an adjacent damaged war engine (+51 of 256 through
  `Unit::heal`, the same step as a priest's Heal).
- **Build** — `Map::applyBuildVillage` @0x3f744 replaces open ground (`Map::isBuildable`: terrain types 2, 3, 18, 26)
  with a village tile drawn from the cell's own tileset: tileset 3 → 249 if sub-index > 51 else 185; tileset 4 → 249 if
  sub-index − 7 in 0..27 else 185; tileset 6 → 249 if sub-index ≤ 3 else 3; any other → 3 (3 = wooden house on
  grass, 185 = desert house on sand, 249 = desert house on paving). The new hamlet heals, gives cover and burns like any
  house; Craftsmen build once per battle.

## 4. Abilities in play

- **Prayer** (strings 639/640/641): Heal +20 with the sparkle strip (5017 #3) and a glow on the ally (#40); Shield
  (the dome, #6, sound 22) as above; Retribution (#9 angel, sound 10).
- **Magic**: Fireball (weapon 25, strip #26, sound 14, burst 13), Ice Shard/Ice Field (18, overlay #7), Lightning Storm
  (26, bolts only, the one true 3×3). The player's wizard starts with no spell chosen; AI wizards default to Fireball.
- **Battle Standard / Spirit Shroud** are the two +15 auras above. Shroud is INVOKED at the end of turn (`Unit::curse`
  sets flag @0x45, sound 17); the spear-spirit strip (#4/#5) rises over each Shaman.
- **Greater Shapeshift** (druids): strip #0, sound 11. The form stays: nothing turns a shifted druid back (the saved
  type Unit+0x278 is read only by Undo), so it acts and waits out the enemy's turn as the beast. A Druid and each of
  its forms may shapeshift once a turn before acting — a beast back to the Druid or into one of the other two — and
  Undo right after takes the shift back. Not over water or cliffs: the option is greyed out where a Formation unit
  couldn't stand (`Map::getMoveCost(2, tile) > 4`, Ep1 `GameScreen::initMenuState` @0x1b670), and the AI keeps its
  form there too. The AI druid (`Unit::aiConsiderAction` state 2) is offered a shift twice a turn: before it moves
  (a Stag charge that scores → Stag; a foe within 5 → no change yet; else a Great Eagle, or the form that keeps its
  group's pace, back to the Druid for a foot group) and — as the move step takes the state back off its tried list
  (`mlib_Vector::removeElement`, iOS Ep2 0x31c2c / Ep1 0x28f26 / Android) — again after a plain move if it hasn't
  shifted: then a foe within 5 → **Guardian Bear** (the Bear test needs the moved flag Unit+0x112), which may still
  strike from where it stands.
- **Stealth / Ambush / Spot**: hidden units (`Unit::setIsHidden` @0x656b0, `Unit::canHide` @0x65fd8: own tile
  defence ≤ 90 and no enemy adjacent). A Stealth unit hides at battle start or when spawned, and at the end of its
  own turn if it did not attack. It is revealed when it attacks, when it is damaged, or when an enemy with Spot starts
  its turn within 4. A move that steps next to a hidden foe stops there; the foe is revealed and strikes once, and the
  mover's attack is spent (`Unit::onTick` @0x7839c, `doFinishMoving` @0x770ca). The original's "Ambush" menu command
  (hide in place, charge `Unit+0x288` = 3, which also lets Stealth hide after a move) needs ability 17, which no unit
  carries in either episode, so it never appears there either.
- **Move or Shoot / Shoot and Move**: Craftsmen carry Move or Shoot through the Hammer Throw (weapon 29): after moving
  they cannot attack at all, melee included — that is the data.
- **Siege**: Barrage (Catapult) bursts in a + cross, full on the tile, half on the four edge-neighbours, may drift one
  tile; Cannon fires one tile (Low Arc) and at point-blank rakes a Grapeshot cone (weapon 24, sound 9, pellets #25);
  Trebuchet's Boulder is one tile (Arc, dark round shot #28); Ballistae's Piercing Bolt flies on through three tiles
  (#29, sounds 51/52). Low Arc / Arc never gate gameplay in the binary — they are trajectory labels.
- **Episode II**: Build (Craftsmen raise a village stage, strip #13 + #12, sound 53) and Repair (restore a structure
  one stage); Quicksand (Dune Sirens: `Map::setQuickSandTile(x, y, turns)` writes a countdown layer at map+0x50, drawn
  as resource 5064 (a 4×40×40 strip built in `MenuScreen::loadStep`, laid over each tile by
  `Map::redrawTileInBuffer`) with frame = tick/100, sand skull #14, sound 22; it bites its occupants each turn); Conjure (the
  Conjurer raises a Sapper or Bodyguard, max two minions, pentagram #11, sound 55; minions farther than 8 from a living
  Conjurer die at the side's turn end — Leashing, help 592); Detonate (the Sapper's blast, sound 56); Absorb and Life
  Steal as in §3; Teleport (wizard, strip #1, sounds 58/59).
- **Leashing, the other half** — when a Conjurer falls, every unit it conjured is unsummoned at once
  (`killConjurerChild` @0x7fdcc).
- **Wizard Teleport** — `Unit::createMoveDestinations`' wizard branch @0x6e5f6 (type 21): every EMPTY tile within
  Manhattan distance ≤ move is a destination if its own move cost for a foot unit is ≤ move; nothing in between
  matters (the blink is a straight hop), but the landing tile must be ground a foot soldier can stand on. The help's
  "ignoring all terrain but water" describes the path, not the landing.
- **Retribution** rings the Heal chime (sound 10, `Unit::retribution`) and shows the angel (#9).

## 5. Turn order, sides and heraldry

- **Turn cycle** — the round cycles over the mission's GROUPS in ascending scenario order (Android `La/g` cycles
  `aQ = (aQ ± 1) % J` over `J` groups; iOS `GameScreen::startTurn` @0x276e8 rebuilds the point-concentration layers per
  team each turn). Group 0 is always an enemy, so every campaign map is enemy-first while the player sits at a
  variable index (0 on most maps, 1 on 5402/5405, 2 on 5417). `levels.json` carries `groupOrder` and `playerGroup`.
- **Teams and factions** — the binary's "faction" owns the gold budget (`factions[0]` is the human, `.b` = its team
  index, `.gold` = the deploy budget, `.ab` = the objective string); its "team" is a named army with heraldry
  (`Mission::loadTeams` @0x5dbc6).
- **Team record** — the 6 bytes after the name: `[faction, symbolColour, fieldColour, device, field, banner]`
  (0xff = 0). Verified arms: Carrone `[2,3,26,-,2]` = Or eagle on Gules, frame 2; the Emperor `[8,4,26,-,8]` = Argent
  eagle on Purpure, gold frame 8; Duke Pellus `[2,1,54,-,7]` = Or axe on Azure, frame 7.
- **Tinctures** — ten 3-shade ramps at `ros_ep2` @0x91d54: 0 vert, 1 azure, 2 or, 3 gules, 4 purpure, 5 sable,
  6 tenne, 7 rose (#d485b8/#cf6bac/#c9519f), 8 argent, 9 cyan (#a3faff/#5fc1c7/#1a878f). The player's picker offers
  the classic eight; rose and cyan are NPC colours (the Wizard's Palace Guard, the Caladrin Defenders).
- **Charges** 6301–6366 (66); the last seven (6360–6366) are pre-coloured faction crests (Sangsoleil's red fire,
  Aguilleon's black eagle, the Rebel gold fleur, Bordavia's three swords, Marsur's scythe…) and are never
  palette-swapped. **Frames** 6401–6409 in this order: plain, crossed swords, banner+swords, spears+drape,
  helm+drape, helm ornate, winged helm, winged helm+laurel, gold crown — the team's banner byte IS the frame index.
- **Rendering** — `Context::renderHeraldry(GL, x, y, frame, field, …)` palette-swaps the monochrome masks
  (`getPaletteColor` / `replacePaletteIndex`) — the FRAME too: its key greens take the symbol colour (the Emperor's
  gems → Argent, white → lavender → periwinkle) and its key blues the field colour (Carrone's drape → Gules); in battle `GameScreen::renderDecoporateMenu` draws the acting team's
  arms in the turn-start states 0x23/0x24 — so the original shows every army's crest at its turn, as we do.
- **Colours on units** — the unit's tabard tint is the group's banner colour; the HP number uses the "unit strength
  colour" (help 659): player green, allies blue/cyan, enemies red/orange/yellow by turn order.
- **Facing** — `GameScreen::createUnitAt` @0x292bc sets unit byte 0x14f = (x < cols/2): a new unit looks toward the
  map's centre line whichever side it is on; moving and attacking turn it (`Unit::changeState`, `moveAttack`).
- **The player's heraldry and rank titles** (Squire → Warden of Carrone) are ours.

## 6. Maps, scenarios and scripts

- **Map grid** — a tile index per cell into the tileset (Ep1 124 tiles at 40 px, Ep2 the same indices at 55 px plus
  more); `Map::getTileType` maps a tile to one of the 5010 terrain types, whose rows give defence %, heal and the
  per-class move cost `[fly, skirmish, formation, cavalry, engine]` (`Map::getMoveCost`; 0 → 1, 100 = impassable) and
  the only neighbouring types a ground unit may step between (`Map::isMoveAllowed`) — exported as `movement.json`.
- **Destructible structures** — `structures.json` from 5010: which tiles are wood (armour 13) or stone (14)
  (`Map::getTileArmorType` = terrain field 0xe, a column of the damage matrix), the next damage stage of each tile
  (`Map::getTransitionTile`), the stage Repair restores (`Map::getPreTransitionTile`), and the real terrain row of
  every razed end tile. Siege shots, fire arrows, magic and bolts knock a wall down one stage; Craftsmen repair it.
- **Scenario record** (`scenario.py`, grammar = `Mission::Mission` @0x62026 → `Mission::loadFactions`, `Mission::loadTeams`,
  `Mission::loadUnits`, `Mission::loadTriggers`, `Mission::loadActions`, `Mission::loadMarkers` @0x60050): header `[i = mission type, turnLimit, …, rewards p/q]`;
  factions; teams; unit templates `(type, team)`; per side (0 = the campaign perspective, 1 = raid defence) a trigger
  table and an action list; then the marker sections.
- **Mission type** `i`: 0 destroy the army, 1 hold one area, 2 hold areas by points (kills add the victim's point
  value), 3 escape/escort (the goal-area tiles; a player unit ending there leaves the field — tag 9 `[n, ?, cmd]`
  fires on the n-th escape; escort maps use the escort markers and tag 11 `[required, cmd]`).
- **Triggers** (tags): 1 deploy stage, 2 battle start, 0 round `[round, team, cmd]` (Ep2 `[round, team, counter,
value, cmd]`), 6 tile reached `[x, y, cmd]` / Ep2 `[x, y, counter, count, team, cmd]`
  (`GameScreen::checkLocationTriggers`), 7 unit lost, 8 counter, 4 victory chain, 5 defeat chain.
- **Actions** (opcodes, `Mission::performAction` @0x60b44): 0 SPAWN `[x, y, template, aiControlled, …, next]`
  (`GameScreen::createUnitAt` with group −1 → the marker lookup), 1 SCREEN (dialogue), 2 CAMERA, 3 MOVE, 4 HIDE,
  5 ATTACK, 6 SHOW, 7 TAG, 8 REMOVE (a fleeing hero leaves the map), 9 COUNTER, 10 SETFLAG, 11 AIMODE (see §7).
  Unit ids in MOVE/REMOVE/AIMODE = `10 × team + spawn index within the team`.
- **Markers** — section A `(group, team, x, y)` are the deployment blocks AND the AI group table
  (`Mission::getLocationGroup` @0x5f660); B warp portals (Ep2); C objective areas `flag; n × (points, tiles)`; D and E
  point lists; F the escort operation (Ep2). Exported as `levels[].markers = [x, y, group, team]`.
- **Waves and events** — round-triggered spawns and lines come from the trigger tables (`waves.json`,
  `battle_events.json`); kill-, tile- and counter-gated spawns, HIDE/SHOW, REMOVE and the escort rule run through the
  script runner from `scripts.json`. Victory is withheld while waves are pending, ambushers hidden or an escort en
  route.
- **Rewards** — `GameScreen::createRewardsMenu` (Ep1 @0x192b4, Ep2 @0x1e08a): the header list holds reward tokens;
  token < 100 = a unit of that 5010 type joins the army, token ≥ 100 = collectible token−100 (0 Medal, 1 Armor,
  2 Weapons, 3 Beasts, 4 Spirit, 5 Lore, 6 Flight); `q` draws p tokens at random. Exported as `rewards.json`.
- **Special win rules** pinned by the objective strings (ours, from the text): 5406 hold the line to the turn limit,
  5412/5413 escape with more than half the force, 5416 lose fewer than three war engines.
- **Episode II world** — `MenuScreen::selectKingdom` has hit-rects only for Zayandi, Sabbi Amar and Abbisin; the
  eight Episode I kingdoms are kept on the map by the user's decision (flagged "Episode I"). Episode II opens with
  Zayandi Shores (map 5424, record 5324); see the correction on record 5400 below. Ep2 Carrone 1 (record 5703) is Ep1's Carrone 1 with every coordinate shifted; the layout is taken
  from the Ep1 record 5300 because footage of the original shows it.
- **Placeholders** hidden from the lists: 5626/5629/5632 "Raid 3" (no start trigger) and 5235/5239/5243 "Server 4".
- **Move cost** — `Map::getMoveCost` @0x3ba3a (same table in Ep1): the cell's terrain type (`getTileType`; none →
  impassable) indexes the 5010 cost rows by the unit's movement class; 0 costs 1, 90+ (the data uses 100) is
  impassable; ground units must also obey `Map::isMoveAllowed` on the step they take; a type-16 cell held by the
  unit's own side costs 1. Not ported: the original also blocks the two bottom corner cells in one screen mode where
  the iPhone soft keys sit. Episode II only: a tile an enemy stands on blocks the step, except for Griffon Riders,
  Great Eagles and Dune Sirens, which fly / glide over enemy units (never stopping on one). Episode I's move search
  (`Unit::checkLocation` @0x58920) stops at any visible enemy for every unit, so its flyers go round them.
- **Warp portals** (Episode II) — `Mission::getSourcePortal` / `Mission::getDestPortal` / `Mission::canUsePortal`, `Unit::onTick`
  post-move, `Unit::getPortalOutput`: each portal is ONE-WAY source → destination with a list of the scenario groups
  allowed through (empty = everyone; a two-way gate is two records). `getMoveCost` makes an exit-only pad (90) and a
  gate the team may not use (100) impassable. The exit tile is searched outward from the destination pad in the
  order of the `gWarpPositionX/Y` tables (@0x95c38 / @0x95ba8, 72 offsets: the four axis cells at distance r, then the
  off-axis cells at Manhattan r+1 clockwise from the top-right, r = 1..8); the first cell the unit may stand on that
  touches the pad or paths back to it wins, and the camera follows (`GameScreen::moveViewport`).
- **Tile-reached triggers** are checked by `GameScreen::checkLocationTriggers` @0x272c8 from `GameScreen::onTick`
  against the player side's list (faction 0), team −1 meaning any of that side's units.
- **Sides of a script** — `Mission::getActionSequence` indexes the trigger table by the play side (Mission+0x90), so
  only side 0 is the campaign; side 1 is the raid-defence perspective. Tag-1 sequences run in the deploy stage
  (`GameScreen::isLoadingMap`), tag-2 at battle start (`GameScreen::activateGameState`); both spawn the fixed forces.
- **Correction on the Episode II prologue** — `MenuScreen::onMenuEvent` @0x5cd42 loads story map 5400 + 3·kingdom +
  slot, so Zayandi (kingdom 8) plays 5424/5425/5426 and record 5400 is only ever reached as Carrone's first slot.
  Record 5400 is an OLDER, unused copy of Zayandi Shores with placeholder unit templates (types 29–35) — the Craftsmen /
  Blood Gorgers / Conjurer roster it appears to field is that placeholder data, not a real army. The genuine opener is
  5424 "Zayandi Shores", whose Carrone force is Knights, Cavalry, Archers, Pikemen, Swordsmen and Militiamen. 5400 (and
  the 5800 copy with all-Gorger templates) stay in the data for the atlas, hidden from the campaign. The tutorial in
  slot 5805 has no title string in the table (the names end at "Combat Training").

## 7. The AI — `GroupLogic` and `Unit::aiConsiderAction`

- **Groups come from the marker table.** A unit spawned ON a marker joins its team's group number `marker.group`;
  the team's `GroupLogic[groupId]` is created on demand with the team byte (`GameScreen::createUnitAt` @0x29188,
  `Mission::getLocationGroup`). A unit spawned off any marker has NO group and uses only the per-unit rules.
  `Mission::setGroupId` (8-neighbour flood fill) is used by head-to-head raids only; `Mission::readRaidSide` builds the
  same per-marker groups for raid maps. So on Marsur 2 the militia block is group 0 and each musketeer pair and cannon
  its own group; on Bordavia 1 the gate block and the archer posts are four groups.
- **Modes** (`GroupLogic::determineTarget` @0x38bec, `GroupLogic::updateGroup` @0x38c5e). Mode 0 (default) = ADVANCE: the
  target is `Map::getBestPointConcentration(centre, 1 − teamByte)` @0x3eeb8 = the tile maximising `layer·6 ÷ (manhattan + 5)`
  in integers (the first of equal values wins), where layer t (`Map::updatePointConcentration` @0x3ae66, rebuilt each
  turn in `startTurn`) is every unit of team byte t — for the enemy that is the player's side, ALLIED armies included
  (they are team 0) — by (hp·256 × value) >> 8 under a diamond kernel, plus +100 on every capture tile that team does
  not own. An allied group (team 0) reads layer 1, the enemy's, the same way; only a third team (byte > 1, none in
  either episode) keeps `determineTarget`'s closest enemy. Value = Unit+0x198 = (cost − 50)·50 ÷ 450 + 50, integer. Mode 2 = HOLD (script op 11 AIMODE(unit, 1): `mode = 2, flag7 = 0`,
  `Mission::performAction` @0x60f7c): the target is `dest`, fixed at the first update to the group's initial centre.
- **March** — path = `Map::calcShortestPath(centre → target, leader)` @0x3b470; NEXT = the path point the group's
  pace reaches (min move over members; druids count 10); a formation width from the group size; each member takes a
  SLOT from the sixteen offset tables C.142–C.157 (`GroupLogic::getGroupPositionOffset` @0x38534 — facing = NEXT −
  centre, horizontal / vertical / diagonal layouts); `GroupLogic::getMoveOrder` @0x38794 = NEXT + offset. A group is "arrived"
  within 2 of its target.
- **Release** — `applyDamage` sets group flags 0x50/0x51; a HOLD group hit one round and not the next drops to mode 0
  (flag 0x52 chain at the top of `updateGroup`). An advancing group drops its path once an enemy is within
  min(pace, 4) of its centre and then fights by the unit rules.
- **Per-unit AI** — `Unit::aiConsiderAction` @0x7bb1c switches on the unit's PENDING ACTION id (unit+0x2a8, written by
  `prepareAction`/`_executeAction`/`cleanUpAction`), not on a state; values 8/9/default reach the generic path at
  0x7d4ea: closest enemy (`Unit::getClosestEnemy` @0x65ef8) → group order → `createChargeTargetList` (charge at
  once when a lane reaches a foe and `calcDamageRatio` @0x70054 is positive) → otherwise advance on the foe
  (`createMoveDestinations` @0x6e450, `getBestMoveLocation` @0x7d6f2). The "closest foe within 9 or wait" test exists
  only inside pending-action 10's handler (0x7ce06); an idle unit is never passive. Ep2 abilities have their own
  handlers (Quicksand `considerQuickSand` @0x685ca, Build/Repair, Conjure, the ranged `createSortedTargetList`
  @0x7ac98).
- **The state chooser and the move** — `GameScreen::aiUpdate` (Ep2 @0x31088, phase table @0x310d4) gives each unit a
  pending action from a fixed order (phase 3): charge (13, not once moved) → druid shift (2) → Priest prayer (6) and
  heal (3) → Wizard standoff (9, not once moved) → siege point (15, the player's side; Episode I's case does nothing)
  → area attack (10) → Episode II's Sapper (30), Bodyguard (29), Conjure (28), Craftsmen Repair (27) and Build (26),
  Dune Sirens' Quicksand (31) → then its target list: none → move (phase 4), else the attack step (phase 6: move to
  the attack tile, then strike). A state that fails goes on the unit's TRIED list; the move step takes states
  14/10/5/3/6/2 back off it (`mlib_Vector::removeElement`; the attack step also 27/26/31), so once it has moved
  (Unit+0x112) the chooser runs again before anything else: a druid that hasn't shifted may turn Bear, a Priest prays
  or heals an adjacent ally — and a moved Priest that has tried both is given Shield anyway (action 6 executed where it
  stands, Ep2 0x317fc / Ep1 0x28c6a; a Priest always takes the move step, so every AI Priest turn ends in a prayer or
  a heal) — a Wizard re-judges its spells, and on the attack step Craftsmen repair or build and
  Dune Sirens lay quicksand from where they stand — only then the strike. States 4 and 5 exist but are never offered.
- **The battle-start prayer** — between the battle-start staging (`activateGameState`'s tag-2 sequence) and the first
  turn, `GameScreen::gameStateUpdate` state 2 (iOS Ep2 @0x1fc3a; Android `aW == 2`) has every Priest outside group 0
  (Unit+0x14c — the player's own Priests too when their group isn't 0) pray where it stands: the AI's prayer choice,
  else Shield. Its side's first turn start clears the mark, as for any prayer.
- **Data check** — Marsur 2 (5307) flags the musketeers, cannons and hero to HOLD and leaves the militia block to
  advance in formation; Bordavia 1 (5309) flags every group, so the pike block holds the gate. Fields of Vuldyne's foes
  sit on no markers and simply advance.
- **Ours, not the original's**: the fine per-tile scoring when a unit weighs equally good tiles (the original's
  `Unit::checkLocation` @0x6967c was not ported line by line). Formation ranks and widths (`GroupLogic::updateGroup`),
  the movers (`getBestMoveLocation` and its Ranged / Horse Bowmen / Charge / Priest / Wizard variants), the Wizard's
  spell choice and the absence of any retreat follow the binary. The original's tactics for the PLAYER's deployment groups (Tactics Path / Set Tactics,
  strings 98–100 and 106–107: "Advance to Destination", "Defend Destination", "Hold in Reserve", "Hold Turns";
  `GameScreen::repositionTactics` → control state 0x35 "- SET THE PATH -") are not reproduced yet.

## 8. Economy and campaign

- **No starting army.** A new game zeroes the roster (Android `La/r.e()`); the only non-zero seed is a debug cheat.
  Units come from mission rewards (§6), the Merchant and Upgrade-Army conversions; the force a mission issues fights
  that battle only (`createRewardsMenu` adds the reward list to the stored army and nothing else).
- **Deploy budget** — `factions[0].gold`; each unit costs its POW (`lists[0][0]`: Militiamen 50 … Knights 300); the
  ELITE cap is budget / 1000 slots (`UnitSelector` constructor); only units you muster count against caps and type
  limits — allies and the record's pre-placed core do not. Starting with 100 or more points left asks "You have not
  fully utilized your deployment points. Victory will certainly be more challenging. Continue?" (Ep1
  `GameScreen::onMenuEvent` @0x2409e, string 103; Ep2 `GameScreen::onSendRaidClicked` @0x29646, 117); starting with
  nothing placed is refused with "ARMY SIZE TOO SMALL" (Ep1 746, Ep2 825). (Ep2's online raid also refused a muster
  that left more than 30 % unspent; there are no online raids here.)
- **Repeat the last setup** — when a muster is complete, the units you placed are kept per map (type, tile, facing;
  `GameScreen::saveRaidSetup` / `captureDeployData`, file `setup<map><side>.sav`); the next muster of that map asks
  "Previous Setup Found — Do you want to repeat the last battle setup for this map?" and sets them down again
  (`loadRaidSetup`), warning "Missing Units" when some are no longer in the army. It is asked as the muster opens,
  before the map's opening sequence (camera, the enemy's arrival, its lines), which waits for the answer: no script
  runs while a popup is up (`activateNextMenu` sets GameScreen+0x1d0, `onTick` skips `updateScriptSequencing`). The
  record's issued force and allies are not part of it; here the Hero's tile is kept too. Not offered in hot-seat, online or Battle Lab runs.
- **Upgrade tree** — the 5010 upgrade slots: Militiamen are the only recruit; every other unit is reached by spending
  a collectible (Armor / Weapons / Beasts / Spirit / Lore / Medal — the string "Medal - Major Victory" heads the
  seven-collectible enum in 5004). Episode II adds Craftsmen, Dune Sirens and Conjurer off the first column, Blood Gorgers
  off Halberdiers, Ballistae off Trebuchet; Sapper and Bodyguard are conjured, never bought. Those five open with the
  Eastern campaign (`UnitSelector::createUnitInfoMenu` @0x8376e and `MenuScreen::onMenuEvent` @0x5d2c2 test the save's
  story bytes): Ballistae after The Wizard's Palace (Zayandi 3), Craftsmen after Warning Caladrin (Sabbi Amar 2), Dune
  Sirens after Caladrin Defense (Sabbi Amar 3), Blood Gorgers after Dune with a View (Abbisin 1), Conjurer after
  Secrets in the Sands (Abbisin 2). Until then the upgrade is listed but refused ("You have not completed the campaign
  mission required to unlock this unit upgrade", 124); the first win shows "Congratulations! The ability to upgrade
  units to … has been unlocked" (800–804). Episode I offers none of them. An upgrade takes any number at once ("Confirm
  the number of units to upgrade", 454; `MenuScreen::handlePopUpEvent` popup 62), one collectible per unit; here one
  tap upgrades one unit (§13). The old
  "weekly levies" were an invention and are gone.
- **The Merchant** (popup 61 "Confirm Purchase", iOS Ep1 @0x3ed2a / Ep2 @0x4ab1c, Android `a_m`) — a collectible costs
  three of one other kind, the player choosing which (a Medal pays too; a Medal can't be bought); a Militiaman costs
  one Armor, one Weapons and one Lore. Any number at once.
- **500 of a kind** — an upgrade or a purchase that would take a unit type or a collectible past 500 is refused:
  "There is a maximum of 500 for units and collectibles." (string 64; Android's port caps at 200).
- **No losses** — the army after a campaign battle or raid is the saved army plus that battle's rewards:
  `GameScreen::createRewardsMenu` (Ep1 @0x192b4 / Ep2 @0x1e08a) reloads the stored counts (`UnitSelector::loadUserArmy`)
  and only adds; `UnitSelector::deleteUnit` is called by Upgrade Army alone. Units slain in battle are lost for good
  only in online battles (help 751 "UNITS LOST"). (The `.mry` file is the player profile that Reset Player deletes.)
- **Kingdoms and unlocks** — `campaign.py` reads `MenuScreen::selectKingdom`: each kingdom has one prerequisite
  (Merovin and Bordavia ← Carrone, Marsur and Sangsoleil ← Merovin, Aguilleon ← Marsur, Hunewold ← Sangsoleil,
  Rukiev ← Hunewold; the same table in Android `a_m.k`). Episode II keeps those rules for the old kingdoms, opens
  Zayandi at start, then Sabbi Amar and Abbisin in sequence (user decision). A kingdom opens once its prerequisite's
  third story battle is won: winning story battle *s* (= 3·kingdom + slot) sets byte *s* of a table in the save
  (`GameScreen::initMenuState` @0x1c8d2 in Episode I, `Context` +0x1c4; Episode II +0x258), and the story battles go
  in order (battle *i* waits on battle *i* − 1).
- **Raids** — they open as the story advances, not one after another (`MenuScreen::initMenuState`, Ep1 @0x45d7e, Ep2
  @0x51ea6 / @0x5201c; Android `a_m`): raid *i* once story battle *i* is won; Carrone's single raid once its third
  story battle is won; in Episode II's Eastern kingdoms raid *i* once story battle *i* + 1 is won. The original hides
  a raid until then; the world map here lists it locked, with the battle that opens it.
- **Training** — Episode I's optional drills (Movement 5800, Combat 5801, Deployment 5802) and Episode II's (Combat,
  Deployment, Combat Training, Advanced Training); Episode II ships no movement drill, so it borrows Episode I's as
  map 5806. Tutorial forces and lines come from the tutorial scenario records 5700–5703; only the reactive "tap here"
  hints are not reproduced. The two drills with a muster bring their own army (`GameScreen::startGameModeCampaign`):
  Deployment two Militiamen, two Footmen and a Pikeman (its 400 points exactly), Episode II's Combat Training part 2
  (5805, the siege half) two Catapults and three Trebuchets. Episode I's unlisted "Tutorial 4" (5803) puts you at the
  head of the Carrone Army (the record's team 1) against the Rebel Army. The Movement drill is the record's goal trigger (tag 9 [7, area 0, cmd 10],
  `checkLocationTriggers`' goal triggers): march the squad from its starting rows into the 3×3 green objective area —
  seven standing in it plays Sir Anston's address, whose last screen leaves the battle; out of its 5 turns, his
  "Perhaps your days as a squire…" (the record's victory sequence) ends it instead.
- **Saves** — progress, upgrade deltas and spoils are kept per episode (the originals are separate apps);
  the player's name and heraldry are shared.
- **Elite units** are exactly the types `UnitSelector::placeCurrent` @0x8154a tests before spending an elite slot:
  Wizards (21), Hero (8), Griffon Riders (9), Cannon (25), Ballistae (30), Conjurer (31) — help 826 "TOO MANY ELITES:
  You may only deploy 1 Elite unit per 1000 deployment points". Catapults, trebuchets, knights, cavalry, rangers,
  druids and priests are not elite. A unit type is capped at 500 (help 64).
- **No Hero for hire** — `UnitSelector::loadUserArmy` copies the saved unit counts and adds nothing, so a Hero is
  fielded only when owned (a reward such as Carrone 3 or The Wizard's Palace, or the Knights → Hero Medal upgrade in
  5010); Heroes stack like any unit — there is no one-Hero cap.
- **Kingdom prerequisites** (`MenuScreen::selectKingdom` switch table, kingdom → required kingdom): Episode I
  1←0, 2←1, 3←0, 4←1, 5←2, 6←4, 7←6, kingdom 0 always open; Episode II gates Rukiev (7) on Zayandi (8) in the binary and
  adds 9←8, 10←9 with 0 and 8 always open — the recreation keeps Ep1's rule for Rukiev by the user's decision.
  `selectKingdom` loops 8 hit-rects in Ep1 and 11 in Ep2.

## 9. Sound and music

- **Clips** — all 62 archive entries ship as `audio/orig/snd_NN.mp3`, id-numbered (ids 7–60 are the RIFF WAVs; 0/1/3/4/
  5/6/61 and 36/38 are MP3 loops and stings). Battle music loop = id 6 (`Context::loop(6)`), menu music = id 3; the
  extra ambient tracks after it are ours.
- **Interface** — cursor / unit pick 41 (Ep1 39), menu button and popup 37, deploy place 39 / take back 40, menu
  close 43, turn start 38 (`GameScreen::startTurn`), victory 36, defeat 24 (`activateGameState`).
- **Movement** (`Unit::playMovingSound` @0x64f78, by class): flying 12, foot 19/20 alternating, cavalry 15/16
  alternating, war engine 42, Blood Gorgers 45, Conjurer 46, stag / mount whinny 34; charge start 12 (Griffon) / 15.
  Movement clips are faded out when a short hop ends (ours — the originals are 1–3 s).
- **Melee** — by the weapon struck with (`Unit::changeState`'s weapon switch @0x6b84c): Spear, Pike and Druid Lance
  cycle 27→28→29, every other blade alternates 30/31 (one counter drives both, Context+5160), a Bodyguard's blow 48
  (@0x6bb82), the Blood Gorgers' Bite 47, the Craftsmen's Mallet 49.
- **Shooting** — bow 35 (Fire Arrows too; 23 is the "unit leaves the field" clip `Unit::_executeAction` plays after
  `Map::removeUnit`), musket 21, cannonball 8 + 13 on impact, Grapeshot 9, catapult / trebuchet launch 33, the
  Catapult's rocks land with 25 and the Trebuchet's boulder with 32 (`onTick` @0x781a8, unit type 24), ballista 51 +
  bolt hit 52, hammer throw 50. A direct shot (arrow, musket ball, hammer) lands without a clip.
- **Magic and casts** — Fireball 14 (+13), Ice Shard 18, Lightning Storm 26, spell cast 22 (dome, sand skull,
  Absorb), Heal and Retribution 10, Fear balk 44 (`Unit::attack`), Spirit Shroud 17 (`Unit::curse`), Build/Repair 53,
  Conjure 55, unsummon 54, Sapper blast 56, Teleport out 58 / in 59 (`onTick` states 0x20/0x21), Quicksand 22 + 57
  (`_executeAction` @0x7f750).
- Unassigned ids: 7 (probably the Ice Shard shatter), 60. There is no death sound.

## 10. Animations and effects — resource 5017

- The in-battle animation list (`DataLoader::loadAnimationList`, loaded by `GameScreen::loadStep2` via
  `loadAnimationImages(5017)`): `u16 count; count × u32 len; count × {u16 frameW, u16 frameH, png}`. 88 entries:
  0–51 effects and projectiles, 52–87 dialogue portraits. `tools/ros/anim.py` prints and extracts it.
- Strips are reached through unit+0x2f4 (`[.., #8]`, `#idx × 4`); the cast dispatcher in `Unit::changeState`
  @0x6bd80 stores each strip at unit+0x17a. Ep1 indices = Ep2 − 6 from #16 on and − 9 from #34 on.
- **Unit overlay slots** (set by `changeState`, drawn by `renderOverlay` / `renderDamage`): +0x2fc the projectile,
  +0x300 the impact (drawn on every cell of a blast), +0x304 the mark on a struck unit (drawn with its damage read-out,
  350 ms), +0x308 the state's overlay, +0x30c a second one, +0x2f8 the attacker's own swoosh.
- **Projectiles** #22/#23 arrows — the flaming #23 only when a Fire Arrows unit shoots a Flammable unit, a building or
  the ground (@0x6b8f8) — #24 bullet, #20/#21 hammer, #25 the Catapult's rocks, #27 the Trebuchet's Boulder (the same
  grey rock, startAreaAttack @0x72e70), #28 the Cannonball, #26 Fireball (and the unused Pitch), #29 piercing bolt.
  Ice Field and Lightning Storm fly nothing (state 5).
- **Marks on the struck unit** — a melee blow only: #30 slash for every blade, #32/#33 blood burst (by facing) for the
  Spear, Pike and Druid Lance, nothing for the Mallet and the Bite. A shot leaves no mark (+0x304 is cleared as it
  lands, @0x6b538); a blast puts the slash on the unit it was aimed at.
- **Impacts** (startAreaAttack) — Rocks #34 earth burst, Boulder #36 rock burst, Cannonball #37 fire burst, Fireball and
  Pitch #35 explosion, Piercing Bolt #38; the Grapeshot's muzzle blast #42–#45 by direction; Lightning #47 bolts. A
  structure an area attack brings down raises #12 the dust ring once the impact is over (Map+0x190, @0x79056).
- **Casts and states** #0 shapeshift, #1 teleport, #2 the Fear skull, #3 sparkles — on the HEALED unit for a Heal
  (state 18 is drawn at Map+0x1c, the target) and over a Blood Gorger draining (state 29) — #4/#5 Spirit Shroud spirit,
  #6 dome, #7 Ice Field, #8 sword of light (the Retribution smite), #9 angel, #10 unsummon, #11 pentagram, #12 dust
  ring, #13 debris, #14 sand skull, #15 Absorb flash, #40 the glow on the cells of an aimed Boulder or Cannonball
  (state 7). #30 also plays over a unit that steps into quicksand.
- **Never seen in battle**: #16–#19 the attackers' swooshes (set on every melee blow and charge, but drawn only by the
  army screen's unit preview, `UnitSelector::render`); #41 the burning unit and #39 the burning tiles
  (`Map::burnLocation` waits on Unit+0x80, which neither binary ever sets); #46 swirl. Three Android-only strips (dark
  dome, frost ring, small angel) have no iOS counterpart and are left out.
- **Animations atlas** — every 5017 strip of both episodes, the engine's effect table, the unit attack and walk sheets,
  and every multi-frame sheet of the raw extraction play live at `/ros-atlas/anim.html` (data by
  `tools/ros/animatlas.py`), each labelled with its use and source. The UNUSED ones are flagged: the Android-only dark
  dome (z_005), small frost ring (z_008) and small angel (z_010), the small Android effect strips z_013/z_017/z_029,
  the aim glow z_027 (5017 #40 — the recreation draws its own aim markers), the Android terrain animations and the iOS terrain strips 001/000 whose purpose was never located,
  the six small Android unit strips 000–005, and 5017 #46 (the swirl, referenced by neither binary).
- Unit walk/attack sheets are the Android sheets; idle poses come from the roster atlas (frame = sprite index). Frame
  counts and hit-frame timing are ours.

## 11. Original interface features and where we stand

- **Formation Order** (manual, string 739 "Hold down on a unit you control to issue a Formation order"): the whole
  deployment group moves and attacks by itself — reproduced as the Formation button on all un-moved units.
- **Tactics Path / Set Tactics** per deployment group before battle — in the original, not yet reproduced (a loose
  army-wide version was removed).
- **Help** — the original's 32-section manual ("Tap here for help") is shown verbatim in the Field Manual, in the
  menu and in battle.
- **Two-finger group selection**, the reactive tutorial hints, and online battles (mobilebattles.com) are not
  reproduced.

## 12. Data versus authored — the honest split

- **Real, from the data or binaries**: every unit stat, weapon, armour, ability set, rating and cost; the damage
  matrix and the combat rules of §3; all maps at true size with armies, deploy blocks, marker groups, objectives,
  portals, waves, triggered spawns and lines; mission types and rewards; the campaign structure and unlock graph;
  dialogue text, speakers and portraits; team heraldry bytes, tinctures, charges and frames; the group AI of §7; every
  sound id of §9 and every effect strip of §10; the tutorial battles and their lines.
- **Ours**: the per-tile AI scoring, formation slot ranking and width; frame timings and projectile visuals; the parchment UI, camera and ambient playlist;
  the special win rules pinned from objective text; the kind grouping and ability description prose; the player's
  heraldry ranks; the Ep2 world map keeping the Episode I kingdoms.
- **Open**: the slot-rank table (C.118), the original's wall pathing bound (9999) in `calcShortestPath`, and the AI's
  handling of a lone hero group. Every deliberate difference from the original is listed in §13.

## 13. Deviations from the original

Everything below plays, looks or works differently from the shipped game, on purpose, or is not reproduced. Anything
not on this list is meant to match the binaries — a difference that is not listed here is a bug, please report it.

### Rules that play differently

- **Whole-number HP** (user decision). The original keeps hit points on a 256 scale (Unit+0x190, 100 HP = 256) and
  shows them rounded down, so its badge and its numbers drift a point apart — a +20 heal from 50 lands on 69,
  quicksand reads 5 while the badge drops 4. Here HP is kept in whole points: a blow is the original's damage chain
  (the attacker's HP taken as HP256) rounded to whole HP, at least 1 when it does anything; a Heal or a repair is
  +20, quicksand 5, a Retribution smite 10 (a charge's 20, 29 …), Life Steal 3/2 of the bite rounded. A unit can
  live or die by a point where the original would not.
- **Warning Caladrin's town garrison** (map 5428). The allies a script spawns away from a group marker get no
  GroupLogic and, in the original, march on the nearest foe at once — the town empties long before the escort arrives.
  Here they stay inside the fort (striking a foe at its wall) until one of your units comes out of the last gates.
- **⚙ Realistic siege** (a setting, OFF by default = the original). The original leashes every AI army's units to
  targets within 8 tiles of the point their group marches on (`Unit::isValidFormationTarget`), shooters included: a
  garrison's musketeers and cannons hold fire on what is not near that point (El Acclazar's march out of the south
  gate), and the allied trebuchets there step sideways instead of shooting. With the setting on, an AI shooter —
  allied or enemy — takes any target in range. It makes walled maps far harder: in the map runner El Acclazar falls
  from 12 of 18 Autopilot wins to 0, Siege of Corbeau from 5 to 0; campaign wins overall drop by about a tenth.
- **A walled-off nearest foe.** `getClosestEnemy` is straight-line, so a melee unit beside an impassable wall picks a foe
  on the far side and stands pinned (The Wizard's Palace). Here a melee walker that cannot walk to it takes the foe
  nearest by real travel, through the portal its walk needs.
- **No rocking behind rocks.** Where the original's A* (bounded at 2 × move) leaves a unit stepping back and forth beside
  a rock ring or a corridor, the reachable tile nearest by real travel is taken; on open ground nothing changes.
- **An allied group whose target cannot be reached** marches on the reachable tile nearest it, instead of the end of
  A*'s partial path (which can lead away and freeze the group).
- **Online battles are ours** (user decision). The original's head-to-head ran on Punch Entertainment's servers, long
  gone. Here two signed-in players meet in a lobby (optional password) on a skirmish map and fight the hot-seat battle
  across two devices: each musters only their own army, every move is shown live on the other screen, each turn has a
  clock (out of time, the turn ends by itself; a player who has left can be beaten on time), and the result moves a
  per-episode Elo rating (the leaderboard). The battle's creator sets the gold (the map's, one amount, or each side's
  own points and Medals) and who moves first (coin toss, either player, or the map's order), as in hot-seat.
- **Armies travel between the episodes** (user decision). The originals are separate apps; here ⚙ Settings exports an
  army and its collectibles to a file the other episode imports — up to 6 of each unit and 30 in all, 3 of each
  collectible and 1 Medal, Episode II's own units reaching Episode I as the unit they upgrade from. Battles won stay
  behind, and a new import replaces the last.
- **Episode II opens on Episode I's intro** (user decision). Entering its campaign plays the "Much of the known world"
  intro its archive still carries; its own intro plays before the first battle of the Eastern Kingdoms.
- **No shapeshifting over water or cliffs in Episode II either** (user decision). Episode I's menu and both
  episodes' AI refuse a shift there; Episode II's rebuilt player menu shows no such check, so it may have let a Great
  Eagle turn into a Druid standing on water.
- **Both diagonals line up a charge** (user decision). The AI's charge staging (`Unit::isValidChargePath`) accepts a
  diagonal lane only when dx = dy, refusing the other diagonal — a slip for |dx| = |dy| (the charge itself takes
  both). Here the AI lines up along either diagonal.
- **A newly built village starts whole.** The original keeps the cell's worn structure HP, so a hamlet raised on ground
  fought over earlier falls to two blows.
- **Story missions reward their first win only.** The original computes the first-win flag and `createRewardsMenu`
  ignores it, paying every win; raids still pay every win here.
- **The bottom-left and bottom-right corner tiles are passable.** `Map::getMoveCost` blocks them outside one screen mode
  — the iPhone's softkeys sit there.
- **Episode I Pike Wall +30.** Given when a braced pikeman strikes a cavalry or war-engine attacker; the original gives it
  when the struck unit is charging.
- **Dice.** The recreation rolls its own seeded generator, not `mlib_Random::getRandom`: every chance matches (courage,
  deviation, the Lightning Storm's start), the sequence of rolls does not. Each battle and each retry gets a fresh seed
  (online battles share theirs, Battle Lab runs keep theirs), and only the rules draw from it — the look-only effects
  (bursts, smoke, a bolt's zigzag, a unit's idle bob) don't, so the dice never depend on what is drawn.

### On screen, not in the original

- Damage forecasts on every target and area cell (the original shows the damage of the one tapped target), the odds of
  keeping one's nerve against a Fear unit, "may deviate X %" warnings, structure HP bars, the charge banner, the
  "Courage!" cue on a passed roll, fast-forward.
- **One upgrade per tap** (user decision). The original's Upgrade asks for the number of units first (popup 62, "Confirm
  the number of units to upgrade"); here each tap of an upgrade turns one unit, for one collectible — three taps, three
  units. The Merchant keeps its number picker.
- A unit struck by a shot (arrow, bolt, ball, hammer) or caught in a blast shows the blood burst; the original marks
  only melee blows (and puts its slash on the unit a blast was aimed at).
- The musket's muzzle flash (the original keeps that blast for the Grapeshot), the blue sparkle as a Wizard casts, the
  bolt that carries an Ice Field (the frost simply appears on the target in the original), and the flames a Fireball
  leaves behind.
- The prose of unit, status and ability descriptions; the kind grouping; the parchment interface and its phone layout;
  the camera; the ambient playlist; Russian and Ukrainian translations; frame timings and projectile visuals; the
  higher-resolution Android sprite sheets where both sets exist.

### Added modes and content

- **Hot-seat** — two players on one device, in place of the original's online head-to-head; it plays the original rules
  (for instance only the map's player side conquers areas).
- **Battle Lab** — batch simulations, autopilot strategies and same-seed replays.
- Raid medal tracking on the world map; the raid titles (the original names them only "Hunewold Raid 1"…); the
  player's heraldry ranks; the Story Codex, the downloads and the map and animation atlases.

### Not reproduced

- Online battles, Rivals, challenges, levies and army upload (mobilebattles.com).
- Two-finger group selection.
- By user decision: the battle autosave ("Your progress is automatically saved at the start of every turn", "AutoSave
  Found"); Set Tactics at the muster (Advance to Destination / Defend Destination / Hold in Reserve, the Tactics Path
  and "Hold Turns — Advance to destination after how many turns?", 121); the one-time tutorial tips ("INVALID
  PLACEMENT…", "NOT ENOUGH POINTS…" and the other reactive hints); the Map Key screen.

## 14. Algorithms, step by step

These are the procedures the game runs, written out in order. Each names the function it was read from; where the
recreation does something different, the difference is stated.

### Turn cycle (`GameScreen::startTurn` @0x276e8, `endTurn` @0x2a1b0, Android `La/g`)

1. The mission holds its groups in scenario order; a cursor walks them 0, 1, 2 … and wraps.
2. When the cursor lands on the player's group the player acts; every other group is played by the AI, each as a
   separate army with its own allies and foes.
3. At the top of every group's turn: its units' acted flags reset, Retribution and Shield cast by that team expire,
   villages and keeps heal units standing on them, its round-triggered waves spawn and its lines fire, and the
   point-concentration layers are rebuilt (`Map::updatePointConcentration` for every team).
4. The round counter advances after the last group; past the turn limit the mission ends (defeat, or victory on a
   "survive" map). Victory is checked after every action: the opposing armies gone, the escape or points condition
   met, and no wave, hidden ambusher or escort still pending.

### Damage of one blow (`Unit::calculateAttackDamage` @0x6af20)

1. Take the attacker's weapon (its side-arm if the target is adjacent and the main weapon is ranged) and the
   defender's armour; `base = WEAPON_DMG[weapon−1][armour]`.
2. If the target flies and the weapon is Boulder or Cannonball, damage is 0; stop.
3. Double it for a fire weapon on a Flammable target; add +30 for a charge (and in Ep1 +30 for a braced pike's
   first strike).
4. Attack rating: the tier value (45…115) + 15 per friendly Standard/Shroud within 4 (once) − 15 for an enemy Shroud
   within 4 + 15 if the attacker's team holds the capture points + 30 per pincer ally for a melee blow.
5. Cover: the tile's defence from the terrain row; Boulder and Cannonball halve the gap to 100; every adjacent
   Formation ally of the defender takes 10 more off the defender's exposure.
6. On the 256 scale, each step truncated: `dmg = ((cover·256/100 · base·256/100) >> 8) · ((rating·256/100 · HP256) >> 8)
   > > 8`. It can be 0 — there is no minimum. The recreation turns it into whole HP: rounded, at least 1 when it is
   anything at all (§13).
7. Halve it if the blow comes from range and the defender is within 2 of its side's Shield mark; ×8/10 up close under
   Siege Armor; 0 if the defender carries Absorb (the buff is consumed). An area cell takes `dmg × share·256/100 >> 8`.
8. Apply, then the structure under the defender takes its own blow (§3).

### Attack resolution (`Unit::attack` @0x7666c, `isFirstStrike`, `charge`, `moveAttack`)

1. Fear check: if the target causes Fear and the attacker is not Fearless, roll courage; a failed roll balks
   (sound 44) and the action is spent.
2. Decide who swings first: a braced Pike Wall or a pikeman against a mounted attacker strikes first; a First Strike
   defender strikes first against an ordinary attacker; a Last Strike attacker swings after the defender; otherwise the
   attacker first. The Hero is never pre-empted.
3. The first striker hits; if the blow is melee, the target is guarded by Retribution and it is the striker's own
   turn, the striker is smitten (about 10 HP, armour ignored); then, if both survive and the target is in reach, it counters. A charge also
   tramples the foot unit directly behind the target with the same blow.
4. Kills add the victim's point value to the killer's team on point missions; Life Steal heals the Gorger 3/2 of its
   bite. A charge that kills its target advances onto the cleared tile, and on to the trampled unit's tile if that
   one died too.

### Courage roll (`Unit::getCourage` @0x66e90, `Unit::attack`)

1. courage = tier value (35/50/65/85/100/125) + the four ±15 modifiers of §3.
2. Draw `random(1000)`; the attacker balks when `draw·256/1000 > courage·256/100`.

### Deviation of a lobbed shot (`Unit::getDeviationChance` @0x665fa, `randomizeAttackLocation` @0x67532)

1. A Barrage weapon (the Catapult) drifts on a flat 35 %; otherwise pick the table by trajectory: Arc (Boulder) or Low
   Arc / any Cannon shot. The Ballistae never deviates.
2. Choose the row by what stands on the target: cover 15/10 %, a flier 100 %, cavalry or wizards 65/50 %, an engine
   25/20 %, anything else 45/35 %.
3. On a hit of the chance, move the impact one tile in a random direction (eight ways), off the board too, and resolve
   whatever is there.

### Movement reach (`Unit::createMoveDestinations` @0x6e450, `Map::getMoveCost` @0x3ba3a)

1. Start from the unit's tile with its move points; explore neighbours (4-way) breadth-first by remaining points.
2. Stepping onto a cell costs its terrain row's value for the unit's class (fly / skirmish / formation / cavalry /
   engine); 0 means 1; 90 or more cannot be entered; ground units may only cross between linked terrain types
   (`isMoveAllowed`); occupied cells cannot be ended on.
3. Wizards instead take every empty tile within Manhattan distance ≤ move whose own cost is affordable (the blink).
4. Portals: entering a source pad the unit's team may use ends the move at the pad and the unit is placed on the first
   free exit cell in the warp search order.

### Charge lane (`Unit::createChargeTargetList` @0x70d78, `isValidChargePath` @0x68d38)

1. For every enemy that is neither hidden nor spent: it must be more than 2 tiles (Manhattan) from the mount's start
   tile and within its move.
2. The line from mount to foe must be straight or exactly diagonal; every tile of it must be empty and affordable
   (diagonal steps cost double); Griffon and Great Eagle skip the terrain test.
3. The AI charges the first foe for which `calcDamageRatio` @0x70054 (its damage versus the expected counter) is
   positive; the player charges by simply moving that lane and striking.

### Group AI per round (`Mission::initAttackPhase` @0x5f812 → `GroupLogic::determineTarget` @0x38bec →

`updateGroup` @0x38c5e)

1. For every group of the acting team: clear the hold-release flags; if the group is in HOLD mode and was hit last
   round but not this one, drop it to ADVANCE.
2. Centre = the mean tile of its members; pace = the slowest member's move (druids count 10); with a hero present the
   hero's move is capped to the pace.
3. Target: HOLD → the group's initial centre (fixed at the first update); ADVANCE → the tile maximising
   `concentration·6 ÷ (distance + 5)` over the map, where concentration is the other side's units (allies count with
   the player) by hp × rating under a 4-wide diamond kernel plus 100 per capture tile that side does not own — for
   allied groups too.
4. The "drop the path when an enemy is within min(pace, 4)" rule only touches a scripted static path, which no record
   sets (the Android port's `a.i.a` is only ever cleared) — so it never fires.
5. Otherwise path = shortest path centre → target for the leader; NEXT = the farthest path point within one pace.
6. Width from the group size; facing = NEXT − centre picks one of the eight slot tables (horizontal, vertical, four
   diagonals); slot 0 is the front-centre and slots fill row by row outward.
7. Each member is given the slot nearest to it within its rank class (the original ranks by a per-type table; the
   recreation ranks melee foot, then cavalry, shooters, engines and casters). A member's move order is
   NEXT + its slot offset; a group within 2 of its target is "arrived" and its members hold.

### Unit AI, the generic path (`Unit::aiConsiderAction` @0x7bb1c → 0x7d4ea)

1. Find the closest enemy (`getClosestEnemy` @0x65ef8); none → do nothing.
2. If the unit has a group, take its move order (NEXT + slot); a scripted MOVE overrides everything.
3. Build the charge list; if a lane reaches a foe with a positive damage ratio, charge now.
4. Otherwise pick the attack with the best damage ratio among the tiles it can reach, preferring to keep formation
   and cover; with no attack, walk toward the move order, or toward the closest enemy when it has none.
   (The finest tile scoring inside step 4 is the recreation's own — `Unit::checkLocation` @0x6967c was not ported
   line by line; `getBestMoveLocation` @0x7d6f2 and its movers were.)
5. Skills come first for their carriers: a priest moves first (toward the threat, or with its group) or walks up to
   heal the most damaged ally in reach, and having moved prays — Shield when enemy shooters lead, Retribution when
   melee does — or heals an adjacent ally, else casts Shield anyway; Craftsmen mend an engine or build near the front; Dune Sirens lay quicksand across an
   approaching column; Conjurers raise a Sapper or Bodyguard up to two; Sappers detonate beside a cluster; Shamans'
   Shroud rises at the side's turn end.

### Structure damage, repair, build (`Map::applyDamage` @0x7ffa0, `applyRepair` @0x80088, `applyBuildVillage` @0x3f744)

1. Every cell begins at 256 HP. A blow subtracts `((HP256 × skill256) >> 8) × (weapon[material] × 256/100 × share) >> 8`.
2. If the cell was untouched and any damage landed, or its HP fell below 0, it drops one stage
   (`getTransitionTile`); the last stage becomes the razed end tile whose own terrain row now governs movement and cover.
3. Repair adds 20 HP and steps the tile back one stage; Build swaps open ground for the village tile matching the
   ground's tileset.

### Warp exit search (`Unit::getPortalOutput`, `gWarpPositionX/Y` @0x95c38/@0x95ba8)

1. Walk the 72 offsets from the destination pad: the four axis cells at distance 1, the off-axis cells at Manhattan 2
   clockwise from the top-right, then distance 2, 3 … up to 8.
2. The first cell the unit may stand on (`isTileDeployable`) that touches the pad, or from which a path leads back to
   the pad, is the exit; the camera pans there.

### Scenario execution (`Mission::performAction` @0x60b44, `getActionSequence`, `GameScreen::checkLocationTriggers` @0x272c8)

1. Load: factions, teams, unit templates, the side-0 trigger table and action list, markers.
2. Deploy stage: run the tag-1 chain (spawns the fixed forces, camera, lines).
3. Battle start: run the tag-2 chain; then each round, for every round trigger whose round (and counter, in Ep2)
   matches, follow its action chain: spawns join the trigger's team at the top of that team's phase, SCREEN shows a
   line and pauses, MOVE walks a unit, HIDE/SHOW toggle ambushers, REMOVE takes a unit off, COUNTER and SETFLAG update
   state, AIMODE sets a group to hold.
4. After every move check the tile-reached triggers; after every death the unit-lost triggers; on a counter change the
   counter-branch triggers (tag 8). A round trigger gated on a counter (Ep2 `[−1, −1, counter, value, cmd]`) is only
   looked at when a turn begins — `Mission::getSequenceOnTurn`, asked as the "Player Turn Start" / "CPU Turn Start"
   banner closes (`GameScreen::hideCurrentMenu`) — so Zayandi Shores' second ambush comes at the next turn start, not
   the moment the first squad falls.
5. On the end conditions run the tag-4 (victory) or tag-5 (defeat) chain and, on victory, draw the rewards.

### Deployment (`UnitSelector` ctor, `placeCurrent` @0x8154a, `loadUserArmy`)

1. The muster lists the units you own, at their POW cost; the budget is the mission's gold; elite slots = budget / 1000.
2. Placing a unit on a yellow block checks: enough points, the type's count and the 500 cap, and for an elite type a
   free elite slot; placing on your own unit replaces it and refunds its cost.
3. Holding a placed unit repositions it (or, in the original, opens the tactics path for its block); starting with
   100 or more points unspent asks for confirmation (string 103 / 117), starting with nothing placed is refused
   ("ARMY SIZE TOO SMALL"), and the muster is kept for the next battle on that map ("Previous Setup Found").

### Rewards (`GameScreen::createRewardsMenu`, Ep1 @0x192b4 / Ep2 @0x1e08a)

1. Read the record's reward list; if the random flag is set, draw p entries from it at random, else take them all.
2. A token under 100 adds a unit of that 5010 type to the roster; a token of 100 or more adds collectible token−100.

### Quicksand (`Map::setQuickSandTile`, `Unit::considerQuickSand` @0x685ca)

1. The Siren marks the three tiles of the row or column on the chosen side; each gets a countdown of 4 turns.
2. Every turn a unit standing on a marked tile takes the quicksand damage read-out; the countdown decays and the
   whirlpool art (5064) shows while it is above 0.

### Sounds of a fight (`Unit::changeState` @0x6b4e0, `playMovingSound` @0x64f78)

1. Movement plays the class clip and alternates between its two variants on successive moves.
2. A melee strike plays the state's clip: one attack state cycles 27, 28, 29 by a per-context counter; the other
   alternates 30 and 31 (Bodyguard 48); ranged states play their launch clip and the impact clip when the shot lands.
