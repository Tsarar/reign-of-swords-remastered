/* ============================================================
   Reign of Swords — terrain lookup.
   The REAL per-tile table carved from the game's own code (resource 5010 /
   mTerrainTable): each map cell is a tile-index 0..123 → { category, passable,
   movecost, defBonus, blocksMounted, blocksEngine, heal }. Loaded once at mount
   via setTerrain(); read by both the engine (movement/logic) and the renderer.
   ============================================================ */

let PROPS = {}; // tileValue(string) -> props
let CELL = 40; // source tile WIDTH in the baked tileset strip (tileset.png = 124 tiles wide)
let CELL_H = 40; // source tile HEIGHT — Ep2 bakes 40×55 cells (native height) so tall terrain rises out of its cell
export const DEFAULT_PROP = {
  category: "grass",
  passable: true,
  movecost: 1,
  defBonus: 0,
  blocksMounted: false,
  blocksEngine: false,
  heal: 0,
};

export function setTerrain(props, cell, cellH) {
  if (props) PROPS = props;
  CELL = cell || 40;
  CELL_H = cellH || CELL;
  clearRealProps();
}
// The props a tile plays by. Category / passable / move cost come from terrain.json (the recreation's per-tile
// legend), but DEFENCE and HEAL are the original's own: movement.json def[type] / heal[type], decoded from record
// 5010's terrain-type rows (Map::getTileDefense = damage taken there in %, field 6 = HP healed each turn). So a
// damaged house still heals and shelters like a whole one, a damaged gatehouse heals, water costs cover, and the
// stage a wood/wall is knocked down to plays by its own row.
const REAL = {};
function clearRealProps() {
  for (const k in REAL) delete REAL[k];
}
export function tileProp(tileVal) {
  const base = PROPS[tileVal] || DEFAULT_PROP;
  if (!MOVE || !MOVE.def) return base;
  if (REAL[tileVal]) return REAL[tileVal];
  const typeIdx = MOVE.types[tileVal];
  if (typeIdx == null || typeIdx < 0 || MOVE.def[typeIdx] == null) return (REAL[tileVal] = base);
  return (REAL[tileVal] = {
    ...base,
    defBonus: (100 - MOVE.def[typeIdx]) / 100,
    heal: (MOVE.heal && MOVE.heal[typeIdx]) || 0,
  });
}
// What a tile is CALLED (the terrain readout). The original names no terrain types, so the name follows the tile's REAL
// terrain type (movement.json types[] = Map::getTileType) — one name per rule set, read off each type's tiles in the
// tilesets: grass and tall grass, barricades and their burnt stubs, roads and the rocky ground beside them, walls, gates and
// their ruins all play differently, so they read differently. Types 0-23 are shared by both episodes; 24-29 are
// Episode II's (portals, the desert). A few Episode II tiles share a rule set with different ground and get their own.
const TYPE_NAME = [
  "Village", // 0  heals 20, cover 20, no war engines (help: "Village or Keep")
  "Burnt village", // 1  a burnt-out house
  "Grass", // 2  open ground
  "Tall grass", // 3  cover 10, slows formations / cavalry / engines
  "Forest", // 4  cover 20, cavalry 3, no war engines (help: forest terrain)
  "Shallow water", // 5  wadeable, but troops in it take MORE damage (cover −20)
  "Palisade", // 6  wooden wall: cover 40, no cavalry or engines
  "Burnt palisade", // 7  what a palisade (6) burns down to
  "Barricade", // 8  spiked wooden barricades: cover 30, cavalry 8, no war engines; wood — it burns (→ 9)
  "Burnt barricade", // 9  what a barricade burns down to
  "Keep", // 10 heals 20, cover 30 (help: "Village or Keep")
  "Ruined keep", // 11
  "Tower", // 12 cover 50
  "Ruined tower", // 13
  "Rampart", // 14 wall walk: cover 40, foot only
  "Rubble", // 15 a breached wall
  "Gate", // 16 a wall gate: cover 40, hard going
  "Broken gate", // 17
  "Road", // 18
  "Deep water", // 19 impassable to ground troops
  "Bridge", // 20
  "Cliffs", // 21 impassable to ground troops
  "Rocky ground", // 22 rocks and gullies, slows formations / cavalry / engines
  "Wooden gate", // 23 a palisade gate (59 → 58 → 57 as it burns): cover 30
  "Warp portal", // 24
  "Fountain", // 25 heals 10, cover 10
  "Sand", // 26
  "Scrub", // 27 cover 10
  "Grove", // 28 forest rules
  "Obelisk", // 29 cover 10
];
const TILE_NAME = {
  125: "Sand",
  127: "Sand",
  129: "Sand",
  131: "Sand",
  133: "Sand",
  134: "Sand",
  135: "Sand", // Ep2 open ground, sandy
  136: "Boulders",
  137: "Boulders", // Ep2 tall-grass rules on rocky sand
  250: "Obelisk", // Ep2 tall-grass rules, a standing stone
  60: "Wooden posts",
  61: "Wooden posts",
  62: "Wooden posts", // wooden-gate rules, standalone posts
};
export function tileName(tileVal) {
  const typeIdx = MOVE && MOVE.types ? MOVE.types[tileVal] : null;
  if (typeIdx != null && typeIdx >= 0) return TILE_NAME[tileVal] || TYPE_NAME[typeIdx] || null;
  return null;
}

// The name a tile READS as. terrain.json's per-tile category is the recreation's own legend and mislabels some woods as
// grass; the original names no terrain types, but its forest row is unmistakable — cover, cavalry slowed to 3, war
// engines kept out ("Cavalry units … are slowed through forest terrain. War Engine units … can not move through forest",
// help) — so a tile on that row reads as forest (Ep1 type 4, Ep2 types 4 & 28). Display only: play reads the table.
export function tileCategory(tileVal) {
  const base = PROPS[tileVal] || DEFAULT_PROP;
  const typeIdx = MOVE && MOVE.types ? MOVE.types[tileVal] : null;
  const row = typeIdx != null && typeIdx >= 0 && MOVE.rows ? MOVE.rows[typeIdx] : null;
  const damagePct = typeIdx != null && typeIdx >= 0 && MOVE.def ? MOVE.def[typeIdx] : 100;
  const heal = typeIdx != null && typeIdx >= 0 && MOVE.heal ? MOVE.heal[typeIdx] || 0 : 0;
  if (row && row[1] <= 2 && row[3] === 3 && row[4] >= 100 && damagePct < 100 && !heal && base.category === "grass")
    return "forest";
  return base.category;
}
export function tileCell() {
  return CELL;
}
export function tileCellH() {
  return CELL_H;
}

// EPISODE II — the real getTileType legend (terrain-types.json, decoded byte-for-byte from record 5010's
// TerrainInfo tilesets). TYPES[globalTileId] = the iOS terrain type; quicksand forms only on QS_TYPES.
// Ep1 loads no such file, so TYPES stays null and isQuicksandTile() is always false (quicksand is Ep2-only).
let TYPES = null;
let QS_TYPES = new Set([2, 3, 18, 22, 26, 27]);
export function setTerrainTypes(types, qsTypes) {
  TYPES = types && types.length ? types : null;
  if (qsTypes && qsTypes.length) QS_TYPES = new Set(qsTypes);
}
// Map::getTileType. Episode I ships no terrain-types.json, but its movement.json carries the very same table (types[],
// equal tile for tile to Episode II's first 124), and its AI reads it too: Unit::isNearGate (Ep1 @0x652ea) and
// checkOpportunityMove (@0x6589c) test type 16, the gate.
export function tileType(tileVal) {
  if (TYPES) return TYPES[tileVal];
  return MOVE && MOVE.types ? MOVE.types[tileVal] : undefined;
}
export function isQuicksandTile(tileVal) {
  return !!(TYPES && QS_TYPES.has(TYPES[tileVal]));
}
// EPISODE II — a village can be built (Craftsmen) on open-ground types {2,3,18,26} (iOS Map::isBuildable).
const BUILD_TYPES = new Set([2, 3, 18, 26]);
export function isBuildableType(tileVal) {
  return !!(TYPES && BUILD_TYPES.has(TYPES[tileVal]));
}

// DESTRUCTIBLE STRUCTURES (both episodes) — structures.json, decoded from record 5010: which tiles are wood (13) or
// stone (14) (Map::getTileArmorType = terrain-type field 0xe, a WEAPON_DMG column), the next damage stage of each
// tile (Map::getTransitionTile), the stage Repair restores (Map::getPreTransitionTile), and the REAL terrain row of
// every fully-destroyed end tile (its defence %, per-class move cost, heal) so a flattened wall is open ground.
let STRUCT = null;
const RUBBLE = {};
export function setStructures(data) {
  STRUCT = data && data.trans ? data : null;
  for (const k in RUBBLE) delete RUBBLE[k];
}
export function structTrans(tileVal) {
  const typeIdx = STRUCT && STRUCT.trans[tileVal];
  return typeIdx == null ? null : typeIdx;
}
export function structPre(tileVal) {
  const typeIdx = STRUCT && STRUCT.pre[tileVal];
  return typeIdx == null ? null : typeIdx;
}
export function structArmor(tileVal) {
  return (STRUCT && STRUCT.armor[tileVal]) || 0;
}
// The props of a structure knocked down to its end tile (used only for cells razed DURING the battle).
export function rubbleProp(tileVal) {
  if (!STRUCT || !STRUCT.rubble[tileVal]) return null;
  if (RUBBLE[tileVal]) return RUBBLE[tileVal];
  const rubble = STRUCT.rubble[tileVal],
    moveCosts = rubble.mv;
  return (RUBBLE[tileVal] = {
    category: "rubble",
    passable: moveCosts[1] < 99,
    movecost: moveCosts[1],
    defBonus: (100 - rubble.def) / 100,
    blocksMounted: moveCosts[3] >= 99,
    blocksEngine: moveCosts[4] >= 99,
    heal: rubble.heal || 0,
    moveRow: moveCosts,
  });
}

// MOVEMENT (both episodes) — movement.json, decoded from record 5010: MOVE.types[tileId] = Map::getTileType,
// MOVE.rows[type] = [fly, skirmish, formation, cavalry, engine] costs Map::getMoveCost reads (0 -> 1, 100 = impassable),
// MOVE.links[type] = the only neighbouring types a ground unit may step between (Map::isMoveAllowed).
let MOVE = null;
export function setMovement(data) {
  MOVE = data && data.types && data.rows ? data : null;
  clearRealProps();
}
export function hasMovement() {
  return !!MOVE;
}
export function moveType(tileVal) {
  if (!MOVE) return undefined;
  const typeIdx = MOVE.types[tileVal];
  return typeIdx == null ? -1 : typeIdx;
}
export function moveRow(typeIdx) {
  return (MOVE && typeIdx != null && typeIdx >= 0 && MOVE.rows[typeIdx]) || null;
}
export function moveLinks(typeIdx) {
  return (MOVE && MOVE.links && MOVE.links[typeIdx]) || null;
}
