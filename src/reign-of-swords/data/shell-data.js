/* ============================================================
   Reign of Swords — shell data & pure helpers (no React).
   The campaign-shell's static reference data and framework-free helpers, split
   out of ui/ReignShell.jsx so the components read cleanly: asset paths + the
   base/version constants, campaign map node positions, the unit encyclopedia
   (UNIT_META / ability & HUD tables / unitSkills / hudClass), the army &
   collectible economy (roster keys, UPGRADE_FROM, jload/jsave, ...), the Field
   Manual wiring (unitsWithAbility/Armour/Movement, ability names, upgrade-tree
   layout) and the heraldry rank titles + colour maths + localStorage loaders
   (loadHeraldry / loadPlayerName / subName). Pure data + pure functions only;
   the only import is the unit table from the engine.
   ============================================================ */

import { UNIT_TYPES, ASSET_V } from "../engine/engine.js";

// Every static asset the game ships, for the "download all assets" button.
export const ASSET_PATHS = [
  "campaign.json",
  "levels.json",
  "terrain.json",
  "tileset.png",
  "worldmap.jpg",
  ...[...new Set(Object.values(UNIT_TYPES).map((T) => T.sprite))].map((s) => "sprites/" + s + ".png"),
  ...["face002", "face005", "face008", "face010", "face013", "face015", "face021", "face024", "face027"].map(
    (p) => "portraits/" + p + ".png",
  ),
  ...["arrow", "cannon", "death", "defeat", "gun", "melee_blade1", "move", "select", "victory"].map(
    (n) => "audio/" + n + ".mp3",
  ),
];

export const base = import.meta.env.BASE_URL + "games/reign-of-swords/";
export const AV = "?v=" + ASSET_V; // sprite cache-buster (see engine ASSET_V) — public/ PNGs aren't HMR'd
export const PROGRESS_KEY = "ros-campaign-v1";
// Each episode keeps its OWN save (the originals are separate apps): Episode II's progress, army deltas, spoils and
// losses live under "<key>-ep2". Name and heraldry stay shared — they are the player, not the campaign.
export const epKey = (key, ep2) => (ep2 ? key + "-ep2" : key);
export const loadProgress = (isEp2 = false) => {
  try {
    return new Set(JSON.parse(localStorage.getItem(epKey(PROGRESS_KEY, isEp2)) || "[]"));
  } catch (e) {
    return new Set();
  }
};
export const saveProgress = (set, isEp2 = false) => {
  try {
    localStorage.setItem(epKey(PROGRESS_KEY, isEp2), JSON.stringify([...set]));
  } catch (e) {}
};

// Kingdom nodes on the empire world-map, as % of the 1260x1411 map image.
// REAL coordinates: hit-rect centers extracted from the Android build's map
// screen (classes.dex La/m constructor arrays W/X/Y/Z; node = rect center;
// frame = resource 6500 = worldmap.jpg 1260x1411). All 8 confidence: high.
export const KINGDOM_POS = {
  carrone: { left: "44.76%", top: "38.87%" },
  merovin: { left: "25.52%", top: "44.93%" },
  marsur: { left: "39.64%", top: "58.54%" },
  bordavia: { left: "55.83%", top: "47.55%" },
  sangsoleil: { left: "8.69%", top: "33.42%" },
  aguilleon: { left: "18.03%", top: "80.79%" },
  hunewold: { left: "26.19%", top: "9.99%" },
  rukiev: { left: "66.11%", top: "13.75%" },
  // EPISODE II — the five Eastern Kingdoms, positioned on the Ep2 world map (misc/030, Mare Nostra + the east).
  zayandi: { left: "38%", top: "90%" },
  "sabbi-amar": { left: "76%", top: "84%" },
  abbisin: { left: "86%", top: "74%" },
  isoluccia: { left: "72%", top: "65%" },
  tilicia: { left: "87%", top: "47%" },
};

// Episode II world map ("The Eastern Kingdoms", 480×544). The Ep2 map redraws the empire, so the Ep1 hit-rect
// coordinates land slightly off each Ep2 settlement. These legacy positions are measured on the Ep2 map itself
// (label-text centroids sampled from worldmap.jpg), so every chapter dot sits on its own kingdom; the three new
// Eastern realms keep their read-off positions. Selected in ReignShell when isEp2; the Ep1 route uses KINGDOM_POS.
export const KINGDOM_POS_EP2 = {
  hunewold: { left: "29.4%", top: "10.5%" },
  rukiev: { left: "63.6%", top: "12.6%" },
  sangsoleil: { left: "11.8%", top: "32.2%" },
  carrone: { left: "46%", top: "35.6%" },
  merovin: { left: "26.6%", top: "41.4%" },
  bordavia: { left: "58.9%", top: "44.3%" },
  marsur: { left: "40%", top: "54.2%" },
  aguilleon: { left: "23.3%", top: "77.7%" },
  zayandi: { left: "45%", top: "94%" },
  "sabbi-amar": { left: "76%", top: "90%" },
  abbisin: { left: "87%", top: "76%" },
};
// The original's optional training battles (levels.json special group, mapIds 5800-5802). They open
// the first campaign kingdom's War Plans as a "Training" section rather than a separate main-menu button.
export const TUTORIALS = [
  { mapId: 5800, title: "Movement" },
  { mapId: 5801, title: "Combat" },
  { mapId: 5802, title: "Deployment" },
];
// EPISODE II ships six 5800-slot records; 5800 is the campaign prologue map (not a drill) and 5803 is the old
// Carrone 1 clone, so the real training set is Combat / Deployment / Combat Training / the advanced drill.
export const TUTORIALS_EP2 = [
  { mapId: 5806, title: "Movement" }, // Episode I's movement drill on loan (levels.json 5806, alias 5800) — Ep2 has none of its own
  { mapId: 5801, title: "Combat" },
  { mapId: 5802, title: "Deployment" },
  { mapId: 5804, title: "Combat Training" },
  { mapId: 5805, title: "Combat Training — Part 2" }, // 5805 has no title string (the list ends at 299 "Combat Training"); it is that drill's siege half
];
// Every unit uses the game's dedicated STANDING-pose art from its OWN roster atlas (android units/006,
// one upright frame per unit; frame index = sprite index), not the battle attack-animation strips.
// The Hero (king) uses stand/king.png — his strip's first frame cropped tight; drawn from the 96×96 strip, the empty
// margin shrank him to ~45×52 px in a 57 px icon, smaller than the infantry beside him.
export const STAND_UNITS = new Set([
  "king",
  "militiamen",
  "footmen",
  "swordsmen",
  "greatswordsmen",
  "pikemen",
  "halberdiers",
  "archers",
  "crossbowmen",
  "musketeers",
  "shamans",
  "druids",
  "wizards",
  "priests",
  "cavalry",
  "knights",
  "griffon",
  "raiders",
  "catapult",
  "cannon",
  "greateagle",
  "bear",
  "stag",
  "rangers",
  "horsebowmen",
  "trebuchet",
  // Ep2: real static poses sliced from ios-episode-2/units/024_1440x51.png (frames 29-35, 5010 order)
  "craftsmen",
  "ballistae",
  "conjurer",
  "sapper",
  "bodyguard",
  "dunesirens",
  "bloodgorgers",
]);
export const IDLE_FRAME = { griffon: 3 }; // strip idle-frame override (only used for units NOT in STAND_UNITS)

// The dialogue screen shows the speaker's FACE from the iOS build's 32-bust portrait atlas
// (ios-episode-1/portraits, 86x144). The speaker->face table is now DECODED, not guessed:
// res 5009 stores each line's speaker id at field 2, and face index = speakerId - 41 (speakers span
// 41..72 = the 32 busts; the debug "CHEAT ACTIVATED" line spk41 -> placeholder bust 000). The IN-BATTLE
// dialogue below carries that real face id straight from battle_events.json. The pre-battle briefing
// script (campaign.json) still uses these authored role->face casts for its narrative lines.
export const FACE = {
  anston: "face015", // Lord Anston, your hero — the blue-plumed knight
  emperor: "face005", // Emperor Sebatini — crowned, purple & gold
  advisor: "face002", // imperial counsellor — the white-bearded elder
  squire: "face010", // young attendant — a fresh imperial soldier
  soldier: "face008", // imperial rank-and-file — dark helm, blue tabard
  brigand: "face013", // Carrone looters — the brown-hooded rough
  pellus: "face021", // Duke Pellus — the black-haired, sinister lord
  valeuve: "face024", // enemy lord — a fair-haired kingdom noble
  enemylord: "face027", // generic rebel king — fair lord in a red tabard
};
export const FACE_SRC = (role) => base + "portraits/" + (FACE[role] || "face008") + ".png";
// A dialogue line's portrait: a genuine decoded face id ("face013") wins; a legacy authored role key
// falls back through FACE; a narration line (Narrator, no face) returns null -> a scroll glyph, no bust.
export const LINE_FACE = (line, pbase = base) => {
  if (line && typeof line.face === "string") {
    if (/^face\d/.test(line.face)) return pbase + "portraits/" + line.face + ".png";
    if (line.face === "") return null;
  }
  return line && line.portrait ? FACE_SRC(line.portrait) : null;
};
// The real faces look in different directions, so seat each one to face INTO the text box:
// a LEFT-facing bust goes on the RIGHT (text on its left); a RIGHT-facing bust goes on the LEFT.
// FACES_LOOK_LEFT lists the cast faces whose gaze points left → right side; everything else
// (emperor/squire/soldier/advisor face right) → left side.
export const FACES_LOOK_LEFT = new Set(["face015", "face013", "face021", "face024", "face027"]); // anston, brigand, pellus, valeuve, enemylord
export const faceSide = (role) => (FACES_LOOK_LEFT.has(FACE[role]) ? "right" : "left");

// ---- Upgrade Army: the game's real Spoils-of-War collectible economy ----
// Each unit upgrades into a stronger type by spending a collectible you win in
// battle (the game: "collectibles can be used to upgrade your units from one
// type to another. The required collectible for upgrading a unit is listed…").
// Order matches the game's upgrade-table slots (unit table 5010) AND the collectible icon
// strip 5032: [Medal, Armor, Weapons, Beasts, Spirit, Lore]. "Flight" is a unit ability
// keyword (griffon), not a collectible — no upgrade in the real data spends it.
export const COLLECTIBLES = [
  { id: "Medal", icon: "🏅" },
  { id: "Armor", icon: "🛡" },
  { id: "Weapons", icon: "⚔" },
  { id: "Beasts", icon: "🐾" },
  { id: "Spirit", icon: "✨" },
  { id: "Lore", icon: "📜" },
];
// The Merchant (MenuScreen::handlePopUpEvent, popup 61 "Confirm Purchase" — iOS Ep1 @0x3ed2a, Ep2 @0x4ab1c; Android
// a_m): a collectible costs THREE of one other kind (spendItem ×3; the player picks the kind, a Medal included), a
// Militiaman one Armor, one Weapons and one Lore (spendItem 1, 2, 5). An upgrade costs one collectible per unit.
export const MERCHANT_PRICE = 3;
export const MILITIA_PRICE = ["Armor", "Weapons", "Lore"];
// "There is a maximum of 500 for units and collectibles." (string 64): an upgrade or a purchase that would take a kind
// past 500 is refused (iOS Ep2 handlePopUpEvent @0x4a8de / @0x4aa30; Android caps at 200).
export const MAX_HELD = 500;
// keyed by engine unit key. cost/kit (weapon·armor), the branching `upgrades`, AND the collectible
// `need` per branch are all REAL — from the game's unit table 5010 (upgrade slots 0-5 =
// [Medal, Armor, Weapons, Beasts, Spirit, Lore]; value = the unit that slot's collectible yields).
export const UNIT_META = {
  militiamen: {
    name: "Militiamen",
    cost: 50,
    role: "Levy",
    kit: "⚔ Spear · 🛡 Shield",
    upgrades: [
      { to: "footmen", need: "Armor" },
      { to: "archers", need: "Weapons" },
      { to: "raiders", need: "Beasts" },
      { to: "shamans", need: "Spirit" },
      { to: "catapult", need: "Lore" },
    ],
    note: "Raw folk called to arms.",
  },
  footmen: {
    name: "Footmen",
    cost: 75,
    role: "Formation Infantry",
    kit: "⚔ Spear · 🛡 Light Armor & Shield",
    upgrades: [
      { to: "swordsmen", need: "Armor" },
      { to: "halberdiers", need: "Weapons" },
      { to: "cavalry", need: "Beasts" },
      { to: "craftsmen", need: "Lore", ep2: true },
    ],
    note: "Spear-and-shield formation; defensive bonus when adjacent to allies.",
  },
  swordsmen: {
    name: "Swordsmen",
    cost: 125,
    role: "Heavy Infantry",
    kit: "⚔ Sword · 🛡 Heavy Armor & Shield",
    upgrades: [
      { to: "greatswordsmen", need: "Weapons" },
      { to: "knights", need: "Beasts" },
    ],
    note: "Heavy armour turns spear, pike and sword.",
  },
  greatswordsmen: {
    name: "Greatswordsmen",
    cost: 150,
    role: "Elite Infantry",
    kit: "⚔ Greatsword · 🛡 Heavy Armor",
    upgrades: null,
    note: "Best melee damage, but strikes last.",
  },
  pikemen: {
    name: "Pikemen",
    cost: 150,
    role: "Anti-Cavalry",
    kit: "⚔ Pike · 🛡 Breastplate",
    upgrades: null,
    note: "Pikewall strikes first against all but the Hero.",
  },
  halberdiers: {
    name: "Halberdiers",
    cost: 125,
    role: "Armour-breaker",
    kit: "⚔ Halberd · 🛡 Light Armor",
    upgrades: [
      { to: "pikemen", need: "Lore" },
      { to: "bloodgorgers", need: "Beasts", ep2: true },
    ],
    note: "A pole-axe with excellent damage even through heavy armour.",
  },
  archers: {
    name: "Archers",
    cost: 100,
    role: "Ranged",
    kit: "⚔ Longbow · 🛡 No Armor",
    upgrades: [
      { to: "crossbowmen", need: "Weapons" },
      { to: "horsebowmen", need: "Beasts" },
      { to: "rangers", need: "Spirit" },
    ],
    note: "Good damage at range; may move OR shoot, not both.",
  },
  crossbowmen: {
    name: "Crossbowmen",
    cost: 125,
    role: "Ranged",
    kit: "⚔ Crossbow · 🛡 No Armor",
    upgrades: [{ to: "musketeers", need: "Lore" }],
    note: "Punches heavy armour better than the longbow.",
  },
  musketeers: {
    name: "Musketeers",
    cost: 175,
    role: "Ranged",
    kit: "⚔ Musket · 🛡 No Armor",
    upgrades: null,
    note: "Greatest range; effective against any armour.",
  },
  knights: {
    name: "Knights",
    cost: 300,
    role: "Heavy Cavalry",
    kit: "⚔ Lance · 🛡 Heavy Armor & Shield",
    upgrades: [{ to: "king", need: "Medal" }],
    note: "Its charge rides on through every foot soldier it cuts down — but pikes strike it first.",
  }, // record 5010 Knights: Medal slot -> type 8 (Hero), both episodes
  cavalry: {
    name: "Cavalry",
    cost: 200,
    role: "Light Cavalry",
    kit: "⚔ Lance · 🛡 Light Armor & Shield",
    upgrades: [
      { to: "griffon", need: "Medal" },
      { to: "knights", need: "Armor" },
    ],
    note: "Fast flanking lancers; charge like knights, lighter.",
  },
  raiders: {
    name: "Raiders",
    cost: 100,
    role: "Raider Cavalry",
    kit: "⚔ Sword · 🛡 Shield",
    upgrades: [
      { to: "cavalry", need: "Armor" },
      { to: "horsebowmen", need: "Weapons" },
    ],
    note: "Fastest riders — hit-and-run light horse.",
  },
  catapult: {
    name: "Catapult",
    cost: 300,
    role: "War Engine",
    kit: "⚔ Rock · 🛡 War Engine",
    upgrades: [{ to: "trebuchet", need: "Lore" }],
    note: "Long-range siege; slow, can't enter forest or buildings.",
  },
  cannon: {
    name: "Cannon",
    cost: 400,
    role: "War Engine",
    kit: "⚔ Cannonball · 🛡 War Engine",
    upgrades: null,
    note: "Devastating vs fortifications; can't enter forest.",
  },
  shamans: {
    name: "Shamans",
    cost: 200,
    role: "Nature Caster",
    kit: "⚔ Spear · 🛡 Nature's Cloak",
    upgrades: [
      { to: "wizards", need: "Medal" },
      { to: "druids", need: "Beasts" },
      { to: "priests", need: "Spirit" },
      { to: "dunesirens", need: "Weapons", ep2: true },
      { to: "conjurer", need: "Lore", ep2: true },
    ],
    note: "Tribal casters whose Spirit Shroud spurs nearby allies (+15 attack) and weakens nearby foes (−15).",
  },
  druids: {
    name: "Druids",
    cost: 300,
    role: "Nature Caster",
    kit: "⚔ Druid Lance · 🛡 Nature's Cloak",
    upgrades: null,
    note: "Nature casters — rally allies, sap the enemy.",
  },
  wizards: {
    name: "Wizards",
    cost: 500,
    role: "Arcane Caster",
    kit: "⚔ Wizard Blade · 🛡 Minor Ward",
    upgrades: null,
    note: "Arcane masters — Fireball, Lightning Storm and Ice Field.",
  },
  priests: {
    name: "Priests",
    cost: 300,
    role: "Holy Caster",
    kit: "⚔ Holy Staff · 🛡 Holy Vestment",
    upgrades: null,
    note: "Holy casters garbed in blessed vestment.",
  },
  griffon: {
    name: "Griffon Riders",
    cost: 400,
    role: "Flying",
    kit: "⚔ Lance · 🛡 Feathered Hide",
    upgrades: null,
    note: "Flying lancers — cross any terrain, strike from above.",
  },
  // The Hero is a regular army unit (an elite): won as a battle reward (Carrone 3; Ep2 also The Wizard's Palace) or
  // upgraded from Knights with a Medal (5010 table). No one-Hero cap in the original — it stacks like any unit.
  // Below it, the three forms a Druid shapeshifts into (reference only; you don't buy or upgrade them).
  king: {
    name: "Hero",
    cost: 500,
    role: "Hero",
    kit: "⚔ Runesword · 🛡 Relic Armor",
    upgrades: null,
    note: "Bears the Battle Standard that emboldens nearby allies, and strikes first. Won as a battle reward, or upgraded from Knights with a Medal.",
  },
  bear: {
    name: "Guardian Bear",
    role: "Nature Spirit",
    upgrades: null,
    special: true,
    note: "A form a Druid shapeshifts into — a fearsome bruiser whose presence cows nearby foes.",
  },
  greateagle: {
    name: "Great Eagle",
    role: "Nature Spirit",
    upgrades: null,
    special: true,
    note: "A form a Druid shapeshifts into — a swift flyer that crosses any terrain.",
  },
  stag: {
    name: "Stag",
    role: "Nature Spirit",
    upgrades: null,
    special: true,
    note: "A form a Druid shapeshifts into — a fast charger that runs down the enemy.",
  },
  // FIELDABLE upgrade targets — the real 5010 table (Android == iOS) makes all three purchasable via upgrade,
  // so the recreation now offers them: Archers → Horse Bowmen (Beasts) / Rangers (Spirit); Raiders → Horse
  // Bowmen (Weapons); Catapult → Trebuchet (Lore) → Cannon (Medal). Costs are the real deploy costs.
  rangers: {
    name: "Rangers",
    cost: 200,
    role: "Ranged Scout",
    kit: "⚔ Short Bow · 🛡 Light Armor",
    upgrades: null,
    note: "A stealthy short-bow scout. Hides in cover and can Shoot-and-Move the same turn.",
  },
  horsebowmen: {
    name: "Horse Bowmen",
    cost: 250,
    role: "Mounted Archer",
    kit: "⚔ Short Bow · 🛡 Light Armor",
    upgrades: null,
    note: "Fast light horse archers — Shoot-and-Move, striking and repositioning in one turn.",
  },
  trebuchet: {
    name: "Trebuchet",
    cost: 300,
    role: "War Engine",
    kit: "⚔ Boulder · 🛡 War Engine",
    upgrades: [
      { to: "cannon", need: "Medal" },
      { to: "ballistae", need: "Spirit", ep2: true },
    ],
    note: "Heavy siege that lobs a single Boulder in a high Arc over great range (4–10) — one tile, no splash.",
  },
  // ===== EPISODE II units (record 5010; costs = seg[15:17], descriptions verbatim from the 5004 help strings
  // 758-764). ep2:true keeps them out of the Ep1 Field Manual. Sapper & Bodyguard are conjured (cost 0). =====
  craftsmen: {
    name: "Craftsmen",
    cost: 300,
    role: "Engineer",
    kit: "⚔ Mallet / Hammer Throw · 🛡 Light Armor",
    upgrades: null,
    ep2: true,
    note: "Repair damaged structures or war engines, or Build a healing Hut once per battle. Hammer Throw hits at a short distance; Mallet smashes adjacent foes.",
  },
  ballistae: {
    name: "Ballistae",
    cost: 400,
    role: "War Engine",
    kit: "⚔ Piercing Bolt / Shock · 🛡 War Engine",
    upgrades: null,
    ep2: true,
    note: "War engines firing Piercing Bolts that damage three squares in a row; Shock finishes close foes. Grant Siege Armor (less melee damage) to themselves and nearby friendly war engines.",
  },
  conjurer: {
    name: "Conjurer",
    cost: 500,
    role: "Dark Caster",
    kit: "⚔ Conjured Blade · 🛡 Minor Ward",
    upgrades: null,
    ep2: true,
    note: "Masters of dark magic who conjure minions (Sappers/Bodyguards) — up to two at once, each leashed within Range 8 and unable to act the turn it is summoned.",
  },
  sapper: {
    name: "Sapper",
    cost: 0,
    role: "Conjured Sapper",
    kit: "⚔ Knives · 🛡 Light Armor & Shield",
    upgrades: null,
    ep2: true,
    conjured: true,
    note: "Deformed wretches, lightning quick with their Knives. Can be sacrificed with Detonate — exploding to damage all adjacent enemies and structures.",
  },
  bodyguard: {
    name: "Bodyguard",
    cost: 0,
    role: "Conjured Guard",
    kit: "⚔ Armblades · 🛡 Heavy Armor",
    upgrades: null,
    ep2: true,
    conjured: true,
    note: "Terrifying creatures that strike adjacent foes with Armblades. Can be sacrificed with Absorb to shield their Conjurer from the next damaging attack.",
  },
  dunesirens: {
    name: "Dune Sirens",
    cost: 250,
    role: "Desert Sorceress",
    kit: "⚔ Khopesh · 🛡 Heavy Armor",
    upgrades: null,
    ep2: true,
    note: "Desert sorceresses who turn terrain into Quicksand — a unit that enters stops and suffers 5 damage. Sirens are immune to all Quicksand.",
  },
  bloodgorgers: {
    name: "Blood Gorgers",
    cost: 100,
    role: "Leech",
    kit: "⚔ Bite · 🛡 Light Armor",
    upgrades: null,
    ep2: true,
    note: "Giant leeches that heal themselves each time they Bite. Slow, so they always strike last.",
  },
};
// Your Army grid order (one flat grid, no headers): by unit class — infantry, ranged, cavalry, casters, war engines,
// flyers — and, inside a class, by upgrade depth (TREE_COL/TREE_ROW) so every upgrade chain reads in sequence. Ep2 units
// sit with the class they fight in and show only on the Ep2 route (they are in EP2_ORDER, not ORDER).
export const ARMY_GROUPS = [
  {
    id: "foot",
    label: "Infantry",
    icon: "class_light",
    units: ["militiamen", "footmen", "swordsmen", "halberdiers", "greatswordsmen", "pikemen"],
  },
  { id: "ranged", label: "Ranged", icon: "skill_ranged", units: ["archers", "crossbowmen", "rangers", "musketeers"] },
  {
    id: "cavalry",
    label: "Cavalry",
    icon: "class_cavalry",
    units: ["raiders", "cavalry", "horsebowmen", "knights", "king"],
  },
  {
    id: "caster",
    label: "Casters",
    icon: "class_caster",
    units: ["shamans", "druids", "priests", "wizards", "dunesirens", "conjurer"],
  },
  {
    id: "siege",
    label: "War Engines",
    icon: "class_siege",
    units: ["craftsmen", "catapult", "trebuchet", "cannon", "ballistae"],
  },
  { id: "fly", label: "Flyers", icon: "class_fly", units: ["bloodgorgers", "griffon"] },
];
export const ORDER = [
  "militiamen",
  "footmen",
  "swordsmen",
  "halberdiers",
  "greatswordsmen",
  "pikemen",
  "archers",
  "crossbowmen",
  "rangers",
  "musketeers",
  "raiders",
  "cavalry",
  "horsebowmen",
  "knights",
  "king",
  "shamans",
  "druids",
  "wizards",
  "priests",
  "catapult",
  "trebuchet",
  "cannon",
  "griffon",
];
export const SPECIAL_ORDER = ["bear", "greateagle", "stag"]; // reference-only units (the Druid's shapeshift forms)
export const EP2_ORDER = ["craftsmen", "ballistae", "conjurer", "dunesirens", "bloodgorgers", "sapper", "bodyguard"]; // Episode II units (Field Manual, Ep2 route only)
export const UNFIELDED_ORDER = []; // all real units are now fielded (Rangers/Horse Bowmen/Trebuchet are reachable via upgrade — real 5010 table)
// ALL of a unit's skills as discrete tags (name + hover description), grounded in the engine's real
// ability strings (UNIT_TYPES[...].ability) and the recovered keyword mechanics. Shown as pills in the camp panel.
export const FORMATION_D =
  "Takes 10% less damage for each adjacent formation ally (Footmen, Pikemen, Greatswordsmen, Crossbowmen, Musketeers) — so keep your line intact. Doesn't help against boulders or cannonballs.";
export const MOVE_OR_SHOOT_D = "Each turn it may move OR attack, not both — position carefully.";
export const CHARGE_D =
  "Gallop at least two clear tiles in a straight line (straight or diagonal) and strike the foe on the next: +30 damage and no counter-attack. The whole lane — the run-up and the foe's tile — must fit within the unit's movement: rough ground (hills, forest) costs more, a diagonal step costs double. Every foot soldier it cuts down, it rides on through to the next foe in the lane, while its movement lasts. Pikes strike a charging mount first.";
// Real ability index -> {n: name, d: description}, matching data/combat-data.js ABILITY_NAME exactly. A unit's
// skills are DERIVED from its real ability list (UNIT_TYPES[u].abilities, straight from unit table 5010) plus
// real trait flags — never hand-assigned per unit — so nothing here can drift from the game data. (Flammable,
// index 10, is a VULNERABILITY not a skill, so it is deliberately absent.)
export const ABILITY_INFO = {
  1: { n: "First Strike", d: "Strikes before the enemy in a melee exchange." },
  2: { n: "Last Strike", d: "Deals the highest melee damage in the game, but always strikes last in an exchange." },
  3: {
    n: "Blast Area",
    d: "Hits a + shape — full damage to the struck tile, half to the 4 tiles touching its edges (up, down, left, right); friendly units included.",
  },
  4: { n: "Fearless", d: "Immune to Fear — will attack even beside a fearsome foe." },
  5: { n: "Formation", d: FORMATION_D },
  6: { n: "Spot", d: "Reveals hidden (Stealth) enemies nearby." },
  7: { n: "Move or Shoot", d: MOVE_OR_SHOOT_D },
  8: {
    n: "Shoot and Move",
    d: "May both fire AND move in the same turn — unlike Move-or-Shoot units, which do one or the other.",
  },
  9: {
    n: "Fire Arrows",
    d: "Flaming shots deal double damage to flammable war engines (Catapults, Trebuchets, Ballistae).",
  },
  11: { n: "Battle Standard", d: "Allies within 4 tiles gain +15 attack." },
  14: {
    n: "Fear",
    d: "A unit attacking it must pass a courage check or balk and lose its turn: courage is 35/50/65/85/100/125 by rating tier, +15 with a friendly Battle Standard or Spirit Shroud within 4 tiles, −15 under an enemy Spirit Shroud, +15 while its side holds the objective. Fearless units and other Fear units are immune.",
  },
  15: { n: "Charge", d: CHARGE_D },
  16: {
    n: "Stealth",
    d: "Hides from the enemy in defensive terrain (woods/hills) until it strikes or an enemy with Spot draws near.",
  },
  17: {
    n: "Ambush",
    d: "Stays hidden until an enemy enters weapon range, then strikes first before the enemy can react.",
  },
  18: {
    n: "Fireball",
    d: "Hurls an explosive that bursts in a + shape — the target tile plus the 4 tiles touching its edges (up, down, left, right) at half damage; the damage ignores armour.",
  },
  19: { n: "Prayer", d: "Heals 20 HP to an adjacent ally and shields nearby allies from ranged fire." },
  20: {
    n: "Greater Shapeshift",
    d: "Shapeshifts into a Stag, Great Eagle or Guardian Bear, gaining new movement and combat abilities. It keeps the form until it shapeshifts again — back to a Druid or into another beast.",
  },
  21: {
    n: "Greater Shapeshift",
    d: "Shapeshifts into a Stag, Great Eagle or Guardian Bear, gaining new movement and combat abilities. It keeps the form until it shapeshifts again — back to a Druid or into another beast.",
  },
  22: {
    n: "Fireball",
    d: "Hurls an explosive that bursts in a + shape — the target tile plus the 4 tiles touching its edges (up, down, left, right) at half damage; the damage ignores armour.",
  },
  23: {
    n: "Prayer",
    d: "Three prayers, one per turn: Heal 20 HP to an adjacent ally; Shield — allies within 2 tiles (the priest included) take half ranged damage until its next turn; Retribution — nearby allies' counter-attacks hit harder.",
  },
  24: {
    n: "Siege",
    d: "Siege units can damage structures, knocking holes in castle walls to provide access to your troops.",
  },
  25: {
    n: "Barrage",
    d: "Rains its payload in a + shape — the struck tile plus the 4 tiles touching its edges (up, down, left, right) at half damage; the arcing stone may drift one tile; friendly units caught in the blast take it too.",
  },
  26: {
    n: "Low Arc",
    d: "How the Cannon shoots: flat and far (3–10 tiles), hitting one tile only. Up close it fires Grapeshot instead.",
  },
  29: {
    n: "Arc",
    d: "How the Trebuchet (4–10 tiles) and Ballistae (3–8 tiles) shoot: a high lob that comes down on one tile. The Ballistae's bolt then flies on through three tiles in a line.",
  },
  27: {
    n: "Pike Wall",
    d: "A pikeman that ends its turn without attacking braces a wall (moving is fine) and strikes first against any attacker but the Hero, until it attacks or lands a blow on a foe that is not mounted (Episode I: +30 when the attacker is mounted or a war engine). Even unbraced, pikemen strike first against cavalry.",
  },
  28: { n: "Spirit Shroud", d: "Allies within 4 tiles gain +15 attack while enemies within 4 lose 15." },
};
// The skill pills one ability index gives a unit — usually its ABILITY_INFO entry, with a few worded per unit:
// [[name, description], …].
function abilityPills(idx, T, key) {
  // The cannon's Blast Area(3) IS its point-blank Grapeshot scatter (weapon 24 / La/q.i(1)) — show it as
  // "Grapeshot", not the generic + Blast Area, since the cannon's ranged Cannonball is a single true shell.
  if (idx === 3 && T.grapeshot)
    return [
      [
        "Grapeshot",
        "Point-blank the cannon rakes a forward SCATTER cone — the struck tile, its two flanks and the tile beyond, each at full damage. At range it fires a single Cannonball instead.",
      ],
    ];
  // Low Arc / Arc are trajectories, not blasts — word and badge them per war engine.
  if (idx === 26)
    return [["Low Arc", "The Cannon fires flat and far (3–10 tiles). The ball hits one tile only — no splash."]];
  if (idx === 29 && key === "trebuchet")
    return [["Arc", "The Trebuchet lobs its Boulder high (4–10 tiles). It lands on one tile only — no splash."]];
  if (idx === 29 && key === "ballistae")
    return [
      [
        "Arc",
        "The Ballistae shoots its bolt in a high curve (3–8 tiles); the bolt then flies on through three tiles in a line.",
      ],
    ];
  const info = ABILITY_INFO[idx];
  if (!info) return [];
  // The Priest's Prayer is three prayers (one per turn) — list each by name.
  if (info.n === "Prayer" && T.prayer)
    return [
      ["Prayer: Heal", "Heals 20 HP to an adjacent wounded ally."],
      [
        "Prayer: Shield",
        "Allies within 2 tiles (the priest included) take half damage from ranged fire until the priest's next turn.",
      ],
      [
        "Prayer: Retribution",
        "Until the priest's next turn, an enemy that strikes an ally within 2 tiles of it in melee on its own turn is smitten for about 10 HP, armour ignored, before the counter.",
      ],
    ];
  return [[info.n, info.d]];
}

// The skill pills a unit's movement / range traits and its Episode II abilities give it, in display order: `has` picks
// the units, `d` is the description (or a function of the unit's stats). Episode II texts: the 5004 help strings 579–588.
const TRAIT_SKILLS = [
  {
    has: (T) => T.canLightning,
    n: "Lightning Storm",
    d: "Five bolts strike random cells of a 3×3 area — the target and the 8 tiles around it — and a unit can be struck more than once; magic gets through most armour. (Fireball bursts in a + shape.)",
  },
  {
    has: (T) => T.canLightning,
    n: "Ice Field",
    d: "Freezes a 2×2 block — the struck tile and the tiles to its right, below and diagonally below-right — dealing light damage and SLOWING every unit caught for a turn (no charging). (The Wizard's third spell; switch between Fireball, Lightning Storm and Ice Field.)",
  },
  { has: (T) => T.fly, n: "Flight", d: "Flies over any terrain and over pikewalls, striking from the air." },
  { has: (T) => T.teleport, n: "Teleport", d: "Blinks instantly to a distant tile, ignoring any terrain in between." },
  { has: (T) => T.skirmish, n: "Skirmish", d: "The fastest riders — hit-and-run raids, then fall back." },
  {
    has: (T) => T.range > 1,
    n: "Ranged",
    d: (T) => "Attacks from a distance (" + T.minRange + "–" + T.range + " tiles) and takes no counter-blow.",
  },
  {
    has: (T) => T.kind === "siege",
    n: "Siege",
    d: "Shatters walls, gates and fortifications; cannot enter forest or buildings.",
  },
  {
    has: (T) => T.siegeArmor,
    n: "Siege Armor",
    d: "Melee damage to this war engine is cut by a fifth — and so is melee damage to friendly war engines within 2 squares of it.",
  },
  { has: (T) => T.pierce, n: "Piercing Bolt", d: "The bolt punches through three squares in a row." },
  {
    has: (T) => T.quicksand,
    n: "Quicksand",
    d: "Turns nearby ground to quicksand — a unit that enters is forced to stop and suffers 5 damage. Sirens are immune.",
  },
  {
    has: (T) => T.lifeSteal,
    n: "Life Steal",
    d: "While wounded, each Bite heals it by one and a half times the damage dealt. Being slow, it always strikes last.",
  },
  {
    has: (T) => T.conjure,
    n: "Conjure",
    d: "Summons minions (Sappers/Bodyguards) — up to two at once, each leashed within range 8 and unable to act the turn it appears.",
  },
  {
    has: (T) => T.absorb,
    n: "Absorb",
    d: "Sacrifice it to give its Conjurer a buff that ignores 100% of the damage from the next attack; one hit spends the buff.",
  },
  {
    has: (T) => T.detonate,
    n: "Detonate",
    d: "Can self-destruct — exploding for weapon damage ×1.25 to all adjacent units (friend and foe) and structures.",
  },
  {
    has: (T) => T.build,
    n: "Build",
    d: "Builds a structure that provides healing — once per battle, on clear ground.",
  },
  { has: (T) => T.repair, n: "Repair", d: "Repairs a damaged adjacent structure or war engine." },
];

// Build the skill pills for a unit from real data: its ability indices, then its trait flags. Each name once.
export function unitSkills(key) {
  const T = UNIT_TYPES[key] || {};
  const out = [],
    seen = new Set();
  const add = (name, desc) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push({ n: name, d: desc });
    }
  };
  for (const idx of T.abilities || []) for (const [name, desc] of abilityPills(idx, T, key)) add(name, desc);
  for (const skill of TRAIT_SKILLS)
    if (skill.has(T)) add(skill.n, typeof skill.d === "function" ? skill.d(T) : skill.d);
  return out;
}
// ---- Original-game HUD badges (extracted from android units/004 branch emblems + 005 action/range badges,
// sliced into public/.../hud/*.png). We surface the REAL art on the unit card. Range badges map to each unit's
// real ranged-weapon band (WEAPON_RANGE), which is exactly what the original's 005 strip labels (2-5…4-10). ----
export const HUD_RANGE_BADGE = {
  archers: "2-6",
  crossbowmen: "2-6",
  horsebowmen: "2-6",
  musketeers: "2-7",
  wizards: "2-7",
  rangers: "2-5",
  catapult: "3-8",
  cannon: "3-10",
  trebuchet: "4-10",
};
// Class emblem (android 004): a runner = infantry, horse = cavalry, catapult = war engine, bird = flyer, potions = caster.
export const HUD_CLASS_TITLE = {
  class_fly: "Flying unit",
  class_cavalry: "Cavalry",
  class_siege: "War engine",
  class_caster: "Caster",
  class_light: "Infantry",
};
// A short pros/cons/speciality line per category, shown on the emblem's hover tooltip.
export const HUD_CLASS_DESC = {
  class_light:
    "The foot soldiers who form the battle line — mostly slow and short-ranged, but sturdy and cheap. Many lock into a Formation to take less damage while the line holds; each unit brings its own tricks. Speciality: hold ground and box the enemy in.",
  class_cavalry:
    "Mounted troops — a long move to reach and flank, and many hit hard on a Charge — a straight gallop onto a foe at least 3 tiles away: +30, no counter-attack, and it rides on through foot soldiers it cuts down. Weak point: pikes strike first against a charge (+30 when braced). Speciality: speed and pincer attacks.",
  class_fly:
    "Take to the air, ignoring terrain — they cross water, walls, even pikewalls, and strike from above. Very mobile but usually lightly armoured. Speciality: reach anywhere, above the fray.",
  class_siege:
    "War engines — long range and area/splash damage, and they smash walls. Very slow and thin-skinned, can't enter forest or buildings, and most Move OR Shoot (not both). Speciality: siege and crowds.",
  class_caster:
    "Spellcasters and holy folk — some hurl magic that gets through most armour, others heal allies, raise attack auras, or shapeshift into beasts. Powerful but fragile. Speciality: force multiplier; keep them protected.",
};
export function hudClass(key, T) {
  if (T.fly) return "class_fly";
  if (T.kind === "siege") return "class_siege";
  if (["shamans", "druids", "wizards", "priests"].includes(key) || T.magic || T.heal) return "class_caster";
  if (T.kind === "cavalry" || T.kind === "hero" || key === "horsebowmen") return "class_cavalry"; // mounted units (the Hero rides; Horse Bowmen are mounted archers) — not foot
  return "class_light"; // the single running-soldier emblem (foot infantry) — clearer than the "ranks" group icon
}
// Ability name → the original game's own icon (005 action / 004 class / 067 status). Only the ones with a clear, correct
// icon; everything else keeps its word pill. These maps are VISUAL reads of the art (the original refers to these frames
// by computed index, so there is no code label to lift) — re-checked at high zoom.
export const ABILITY_ICON = {
  Charge: "skill_charge", // gallop icon (arrow + speed lines)
  Skirmish: "skill_skirmish",
  "Greater Shapeshift": "skill_shapeshift",
  "Fire Arrows": "skill_firearrows",
  Fireball: "skill_fireball",
  Teleport: "skill_teleport",
  "First Strike": "skill_first",
  "Last Strike": "skill_last",
  "Move or Shoot": "skill_moveshoot",
  "Shoot and Move": "skill_shootmove", // f4 (boot+bow+slash = OR) vs f3 (boot + '+' + bow = AND)
  // Barrage / Blast Area splash a + CROSS (target + 4 adjacent) → the cross glyph. Low Arc / Arc are single-target
  // trajectories → the game's own arc-arrow range badges (per-unit ranges are set in unitSkills). Lightning Storm is
  // the only true 3×3 → the 3×3 grid icon.
  Barrage: "skill_blast",
  "Blast Area": "skill_blast",
  "Lightning Storm": "skill_lightning", // Low Arc / Arc deliberately have NO icon (word chips)
  Grapeshot: "skill_grapeshot", // cannon point-blank scatter cone — the original 005 action strip's rightmost glyph
  Formation: "skill_formation",
  Fear: "skill_fear",
  "Pike Wall": "skill_pikewall",
  "Battle Standard": "skill_standard",
  "Spirit Shroud": "skill_shroud",
  Prayer: "skill_prayer",
  "Prayer: Heal": "skill_prayer",
  "Prayer: Shield": "status_shield",
  "Prayer: Retribution": "status_bless",
  Stealth: "skill_stealth",
  Ambush: "skill_ambush",
  // Ice Field → its own frost/slow badge (the status it inflicts); Retribution → the blessed-sword badge.
  "Ice Field": "status_slowed",
  Retribution: "status_bless",
  // EPISODE II abilities (own icon art)
  Quicksand: "skill_quicksand",
  "Life Steal": "skill_lifesteal",
  Absorb: "skill_absorb",
  Detonate: "skill_detonate",
  "Siege Armor": "skill_siegearmor",
  "Piercing Bolt": "skill_pierce",
  "Build & Repair": "skill_build",
  Build: "skill_build",
  Repair: "skill_repair",
  Conjure: "skill_conjure",
};
// Field Manual: the original help text is shown verbatim; where the recreation's mechanic reads differently (the four
// siege tags especially), a short "in this recreation" line is added under it.
export const ABILITY_NOTE = {
  Barrage:
    "In this recreation: the Catapult's stone bursts in a + shape — full damage on the struck tile, half on the 4 tiles touching its edges — and may drift one tile.",
  "Low Arc":
    "In this recreation: just how the Cannon shoots — flat and far (3–10 tiles), one tile hit, no splash, no drifting. Up close it fires Grapeshot instead.",
  Arc: "In this recreation: just how the Trebuchet and Ballistae shoot — a high lob onto one tile, no splash, no drifting. The Ballistae's bolt then flies on through three tiles in a line.",
  "Blast Area":
    "In this recreation: the Cannon's point-blank Grapeshot cone — the struck tile, its two flanks and the tile beyond. Its ranged Cannonball hits one tile.",
};
// Class emblem (unit type) + range/melee (attack type) are shown as the FIRST chips, so their duplicate ability tags are dropped.
// Low Arc / Arc are only the war engines' shot trajectories, not skills you use — kept out of the unit skill pills
// (upgrade page + in-battle card); the Field Manual's ability list still documents them.
export const SKILL_SKIP = new Set(["Ranged", "Siege", "Flight", "Low Arc", "Arc"]);

// ---- The real game's model (recovered from the DEX) ----
// Each mission ISSUES your force directly (scenario record, team 0): 'set-piece' battles pre-place a
// fixed squad; 'muster' battles give a gold DEPLOY budget (1 elite / 1000 pts). Units carry between
// battles and you UPGRADE them with earned collectibles ("Spoils of War"). Crucially, the game stores
// NO persistent STARTER ARMY — a new game ZEROES the roster (La/r.e(), the new-game/clear-data reset;
// the only non-zero init is a debug cheat). So we seed an EMPTY roster; it fills from the forces the
// missions hand you (their preset squads carry forward) plus the real per-mission rewards. Admin/
// skirmish get a full sandbox army so you can field anything.
export const ARMY_KEY = "ros-army-v3",
  DELTA_KEY = "ros-updelta-v1",
  SPOILS_KEY = "ros-spoils-v3",
  LOSS_KEY = "ros-losses-v1",
  MEDAL_RAIDS_KEY = "ros-medalraids-v1", // map ids of the raids you have won with a Major Victory (Medal)
  TRANSFER_KEY = "ros-transfer-v1"; // the army brought in from the other episode (data/save-transfer.js)
export const ALL_TYPES = [
  "militiamen",
  "footmen",
  "swordsmen",
  "greatswordsmen",
  "pikemen",
  "halberdiers",
  "archers",
  "crossbowmen",
  "musketeers",
  "rangers",
  "horsebowmen",
  "knights",
  "king", // the Hero: an elite you may own several of (no one-Hero cap in the original)
  "cavalry",
  "raiders",
  "catapult",
  "trebuchet",
  "cannon",
  "shamans",
  "druids",
  "wizards",
  "priests",
  "griffon",
];
export const STARTER_ARMY = {}; // the game seeds NO starting roster (La/r.e() zeros it) — you begin empty
// How you obtain a unit you don't yet have. The game grows your army through REAL per-mission
// rewards (rewards.json, decoded from each scenario record) plus Upgrade-Army conversions — NOT
// weekly "levies" (the original has no levy table; that was an earlier invention). This static map
// powers the only acquisition hint we still surface: for a type you lack, which lower unit upgrades
// into it. (The earlier "Fielded at / Won from" mission-provenance line was authored, not in the
// original upgrade screen, and stated the obvious for base units — removed.)
export const UPGRADE_FROM = (() => {
  const m = {};
  for (const [from, u] of Object.entries(UNIT_META))
    for (const e of u.upgrades || []) if (!m[e.to]) m[e.to] = { from, need: e.need };
  return m;
})();
// The upgrades each episode offers: Episode I has none of Episode II's units, so its camp never lists them.
export const upgradeOffered = (branch, isEp2) => isEp2 || !branch.ep2;
// Episode II's new units open with its campaign (MenuScreen::onMenuEvent @0x5d2c2 and UnitSelector::createUnitInfoMenu
// @0x8376e test the save's story bytes, Context+0x258 + story index): an upgrade TO one of them is listed but refused
// until that story battle is won — "You have not completed the campaign mission required to unlock this unit upgrade."
// (string 124). MenuScreen::onActivate then shows "Congratulations! The ability to upgrade units to … has been
// unlocked." (800–804). Values are the map ids of those story battles.
export const UPGRADE_GATES_EP2 = {
  ballistae: 5426, // Zayandi 3, The Wizard's Palace
  craftsmen: 5428, // Sabbi Amar 2, Warning Caladrin
  dunesirens: 5429, // Sabbi Amar 3, Caladrin Defense
  bloodgorgers: 5430, // Abbisin 1, Dune with a View
  conjurer: 5431, // Abbisin 2, Secrets in the Sands
};
// The story battle an upgrade to `toKey` waits on, or null.
export const upgradeGate = (toKey, isEp2) => (isEp2 && UPGRADE_GATES_EP2[toKey]) || null;
// The units whose upgrade the story battle `mapId` opens (Episode II).
export const unlocksOf = (mapId, isEp2) =>
  isEp2 ? Object.keys(UPGRADE_GATES_EP2).filter((k) => UPGRADE_GATES_EP2[k] === mapId) : [];
export const SANDBOX_ARMY = Object.fromEntries(ALL_TYPES.map((k) => [k, 30])); // admin/skirmish: field anything
// Episode II sandbox: the same plus the seven Ep2 units (sapper / bodyguard cost 0 in the table and stay unbuyable via DEPLOY_ORDER).
export const SANDBOX_ARMY_EP2 = Object.fromEntries([...ALL_TYPES, ...EP2_ORDER].map((k) => [k, 30]));
// The two training battles with a muster bring their own army (GameScreen::startGameModeCampaign — iOS Ep2 @0x252be /
// @0x2535e, Ep1 isLoadingMap @0x200d8: UnitSelector::clear, then addUnit for each): the Deployment drill (5802) two
// Militiamen, two Footmen and a Pikeman — exactly its 400 points — and Episode II's Combat Training part 2 (5805, its
// siege half) two Catapults and three Trebuchets for its 900.
export const TRAINING_ARMIES = {
  5802: { militiamen: 2, footmen: 2, pikemen: 1 },
  5805: { catapult: 2, trebuchet: 3 },
};
export const combineCounts = (...maps) => {
  const out = {};
  for (const m of maps) for (const k in m) out[k] = (out[k] || 0) + m[k];
  for (const k in out) if (out[k] < 0) out[k] = 0;
  return out;
};
export const jload = (k, fallback) => {
  try {
    const saved = JSON.parse(localStorage.getItem(k));
    return saved == null ? fallback : saved;
  } catch (e) {
    return fallback;
  }
};
export const jsave = (k, value) => {
  try {
    localStorage.setItem(k, JSON.stringify(value));
  } catch (e) {}
};
export const STARTER_SPOILS = {}; // spoils are EARNED by winning battles — you start with none

// All 6 collectibles use the game's OWN native icons, sliced from resource 5032 (the 312×52
// collectible strip in ros.dat) — 52px framed art, in slot order Medal·Armor·Weapons·Beasts·Spirit·Lore.
export const RES_ICON = {
  Medal: "medal",
  Armor: "armor",
  Weapons: "weapons",
  Beasts: "beasts",
  Spirit: "spirit",
  Lore: "lore",
};

export const GET_OPTIONS = [
  ...COLLECTIBLES.filter((c) => c.id !== "Medal"),
  { id: "militiamen", icon: "🗡️", unit: true, label: "Militiaman" },
];

// ---- Field Manual ability↔unit wiring ----
// Which fielded units (roster incl. the Hero + the reference Druid-forms) actually carry an ability — computed from
// the real data (UNIT_TYPES abilities + trait flags), so the manual can say WHERE each ability lives.
export const MANUAL_UNIT_KEYS = [...ORDER, ...SPECIAL_ORDER, ...UNFIELDED_ORDER];
// On the Ep2 route the Episode II units join the manual's ability/armour/movement tagging.
const manualKeys = (ep2) => (ep2 ? [...MANUAL_UNIT_KEYS, ...EP2_ORDER] : MANUAL_UNIT_KEYS);
export function unitsWithAbility(key, isEp2) {
  return manualKeys(isEp2).filter((u) => {
    const T = UNIT_TYPES[u] || {};
    if (typeof key === "number") return (T.abilities || []).includes(key);
    switch (key) {
      case "fly":
        return !!T.fly;
      case "siege":
        return T.kind === "siege";
      case "skirmish":
        return !!T.skirmish;
      case "teleport":
        return !!T.teleport;
      case "cavalry":
        return T.kind === "cavalry";
      case "lightning":
      case "ice":
        return !!T.canLightning;
      case "flammable":
        return !!T.flammable;
      // Episode II trait-keyed abilities
      case "siegeArmor":
        return !!T.siegeArmor;
      case "pierce":
        return !!T.pierce;
      case "quicksand":
        return !!T.quicksand;
      case "lifeSteal":
        return !!T.lifeSteal;
      case "conjure":
        return !!T.conjure;
      case "absorb":
        return !!T.absorb;
      case "detonate":
        return !!T.detonate;
      case "build":
        return !!T.build;
      case "repair":
        return !!T.repair;
      default:
        return false;
    }
  });
}
// Which fielded units WEAR each armour. The Armour help entries are in armour-index order (unit table 5010's
// armour byte), so entry i lists every unit whose armour index is i.
export function unitsWithArmour(idx, isEp2) {
  return manualKeys(isEp2).filter((u) => (UNIT_TYPES[u] || {}).armour === idx);
}
// Each unit belongs to exactly ONE movement class (the original's mutually-exclusive move types), by precedence:
// flight > teleport > war-engine > skirmish > cavalry (mounted, move ≥ 7 — catches Horse Bowmen) > formation.
export function movementClass(u) {
  const T = UNIT_TYPES[u] || {};
  if (T.fly) return "fly";
  if (T.teleport) return "teleport";
  if (T.kind === "siege") return "siege";
  if (T.skirmish) return "skirmish";
  if (T.kind === "cavalry" || T.move >= 7) return "cavalry";
  if ((T.abilities || []).includes(5)) return "formation";
  return "standard"; // ordinary foot (militiamen, archers, shamans, druids, rangers, bear) — no special move class
}
export function unitsWithMovement(cls, isEp2) {
  return manualKeys(isEp2).filter((u) => movementClass(u) === cls);
}
// EPISODE II abilities for the Field Manual's Abilities tab — descriptions condensed from the 5004 help strings
// (579–588), each tagged with the units that carry it (via the trait key). Shown only on the Ep2 route.
export const EP2_ABILITY_HELP = [
  {
    trait: "siegeArmor",
    title: "Siege Armor",
    text: "Ballistae are enchanted with Siege Armor that reduces damage from melee attacks — and it also protects nearby allied war engines.",
  },
  {
    trait: "pierce",
    title: "Piercing Bolt",
    text: "Ballistae fire large Piercing Bolts that damage three squares in a row.",
  },
  {
    trait: "quicksand",
    title: "Quicksand",
    text: "Dune Sirens turn surrounding terrain into Quicksand; any unit that enters is forced to stop moving and suffers 5 damage. Sirens themselves are immune.",
  },
  {
    trait: "lifeSteal",
    title: "Life Steal",
    text: "When wounded, a Blood Gorger will Life Steal — each Bite heals it by one and a half times the damage it deals. It always strikes last.",
  },
  {
    trait: "conjure",
    title: "Conjure",
    text: "Conjurers summon minions that fight without fear — at most two at once, each unable to act the turn it is summoned and leashed within range 8 of the Conjurer.",
  },
  {
    trait: "absorb",
    title: "Absorb",
    text: "A Bodyguard can be sacrificed using Absorb, giving the Conjurer a buff that ignores 100% of the damage from the next attack.",
  },
  {
    trait: "detonate",
    title: "Detonate",
    text: "A Sapper can be sacrificed using Detonate, exploding for weapon damage ×1.25 to all adjacent units (friend and foe) and damaging adjacent structures.",
  },
  {
    trait: "build",
    title: "Build",
    text: "Craftsmen can Build a structure that provides healing — once per battle, only where the ground is clear.",
  },
  { trait: "repair", title: "Repair", text: "Craftsmen can Repair damaged structures or war engines." },
];
export const MOVEMENT_KEY = ["fly", "skirmish", "formation", "cavalry", "siege", "teleport", "standard"]; // aligned to the movement items (last is our derived catch-all)
// help.json `abilities` entry index → the ability it describes (a real ability index, or a trait key). Aligned
// to the recovered order. Some describe abilities only the ORIGINAL had on units we don't field (Horse Bowmen's
// Shoot-and-Move, scouts' Stealth/Ambush, etc.) or that are engine-dormant — those resolve to zero units and are
// flagged honestly rather than pretended-present.
export const HELP_ABILITY_KEY = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  "flammable",
  11,
  28,
  13,
  14,
  15,
  16,
  17,
  21,
  21,
  23,
  "siege",
  25,
  26,
  27,
  28,
  29,
  22,
  "lightning",
  "ice",
  23,
];
export const ABILITY_NAMES = {
  1: "First Strike",
  2: "Last Strike",
  3: "Blast Area",
  4: "Fearless",
  5: "Formation",
  6: "Spot",
  7: "Move or Shoot",
  8: "Shoot and Move",
  9: "Fire Arrows",
  11: "Battle Standard",
  13: "Burst",
  14: "Fear",
  15: "Charge",
  16: "Stealth",
  17: "Ambush",
  21: "Greater Shapeshift",
  22: "Fireball",
  23: "Prayer",
  24: "Siege",
  25: "Barrage",
  26: "Low Arc",
  27: "Pike Wall",
  29: "Arc",
  28: "Spirit Shroud",
  flammable: "Flammable",
  siege: "Siege",
  lightning: "Lightning Storm",
  ice: "Ice Field",
};
export const abilityTitle = (key) => (key == null ? null : ABILITY_NAMES[key] || null);

// Field Manual — the original game's own help text, recovered verbatim from the 5004 string table
// (help.json, extracted in scratchpad/extract_help.py). Read-only reference screen.
// The Armour & Movement help lines are description-only in the source; we prefix the matching name (from the
// unit-table armour list / the movement classes) so every tab reads as a titled card like the Abilities tab.
export const ARMOUR_TITLES = [
  "No Armour",
  "Shield",
  "Minor Ward",
  "Light Armour",
  "Nature's Cloak",
  "Breastplate",
  "Light Armour & Shield",
  "Airborne",
  "Heavy Armour",
  "Holy Vestment",
  "Heavy Armour & Shield",
  "Nature's Shield",
  "War Engine",
];
export const MOVEMENT_TITLES = ["Flight", "Skirmish", "Formation", "Cavalry", "War Engine", "Teleport"];
export const HELP_TAB_ICON = { play: "sword", armour: "shield", move: "mov" }; // per-tab header glyph (Abilities uses the star)

// ---- Upgrade tree (Field Manual "Upgrades" tab) — the REAL 5010 upgrade flow as a branching diagram.
// Militiamen are the only recruit; every other unit is reached by spending a collectible (Armor/Weapons/
// Beasts/Spirit/Lore/Medal). Columns = upgrade depth; edges are coloured by the collectible they cost.
export const TREE_COL = {
  militiamen: 0,
  footmen: 1,
  archers: 1,
  raiders: 1,
  shamans: 1,
  catapult: 1,
  swordsmen: 2,
  halberdiers: 2,
  cavalry: 2,
  crossbowmen: 2,
  horsebowmen: 2,
  rangers: 2,
  druids: 2,
  wizards: 2,
  priests: 2,
  trebuchet: 2,
  greatswordsmen: 3,
  knights: 3,
  pikemen: 3,
  griffon: 3,
  musketeers: 3,
  cannon: 3,
  king: 4,
  // EPISODE II upgrade targets (rendered only on the Ep2 route). Sapper & Bodyguard are conjured, not upgraded,
  // so they have no tree node. craftsmen/dunesirens/conjurer branch off col-1 units → col 2; bloodgorgers off
  // halberdiers (col 2) and ballistae off trebuchet (col 2) → col 3.
  craftsmen: 2,
  dunesirens: 2,
  conjurer: 2,
  bloodgorgers: 3,
  ballistae: 3,
};
export const TREE_ROW = {
  militiamen: 0,
  footmen: 0,
  archers: 1,
  raiders: 2,
  shamans: 3,
  catapult: 4,
  swordsmen: 0,
  halberdiers: 1,
  cavalry: 2,
  crossbowmen: 3,
  horsebowmen: 4,
  rangers: 5,
  druids: 6,
  wizards: 7,
  priests: 8,
  trebuchet: 9,
  greatswordsmen: 0,
  knights: 1,
  pikemen: 2,
  griffon: 3,
  musketeers: 4,
  cannon: 5,
  king: 1,
  craftsmen: 10,
  dunesirens: 11,
  conjurer: 12,
  bloodgorgers: 6,
  ballistae: 7,
};
export const NEED_COLOR = {
  Armor: "#6f93bf",
  Weapons: "#c0603a",
  Beasts: "#5a8c4a",
  Spirit: "#9070b8",
  Lore: "#3a9c9c",
  Medal: "#d2a53a",
};

// The heraldic tincture ramps, field/symbol/frame art tables, per-faction crests and the HeraldryShield component
// live in ui/HeraldryShield.jsx (imported at the top). The rank titles + editor stay here (player progress).
// The rank still rises with wins, but the player's own crest border is ALWAYS the crossed-swords frame (frame 1)
// — no banner/spears/helm/crown extras. (The faction crests keep their own ornate frames via BANNER_HERALDRY.)
export const HERALD_TITLES = [
  { min: 0, title: "Squire", border: 1 },
  { min: 3, title: "Knight", border: 1 },
  { min: 9, title: "Knight Banneret", border: 1 },
  { min: 15, title: "Baron", border: 1 },
  { min: 21, title: "Marshal", border: 1 },
  { min: 24, title: "Warden of Carrone", border: 1 },
];
export function heraldTitle(medals) {
  let title = HERALD_TITLES[0];
  for (const tier of HERALD_TITLES) if (medals >= tier.min) title = tier;
  return title;
}
// darken (f<0) / lighten (f>0) a #rrggbb hex by fraction f
export function shadeHex(hex, amount) {
  const rgbInt = parseInt(hex.slice(1), 16);
  let r = (rgbInt >> 16) & 255,
    g = (rgbInt >> 8) & 255,
    b = rgbInt & 255;
  const shade = (v) => Math.max(0, Math.min(255, Math.round(v + (amount < 0 ? v * amount : (255 - v) * amount))));
  return "#" + [shade(r), shade(g), shade(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export function rgb01(hex) {
  // "#rrggbb" -> "r g b" with each channel in 0..1 (for SVG feFunc tableValues)
  const rgbInt = parseInt(hex.slice(1), 16);
  return [((rgbInt >> 16) & 255) / 255, ((rgbInt >> 8) & 255) / 255, (rgbInt & 255) / 255];
}
export function loadHeraldry() {
  try {
    const saved = JSON.parse(localStorage.getItem("ros-heraldry-v1"));
    if (saved && typeof saved.bgType === "number" && typeof saved.symbol === "number") return saved; // current (index) format
    if (saved && saved.bgColor)
      return { bgColor: saved.bgColor, bgType: 0, symbol: 51, symbolColor: saved.symbolColor || "gules" }; // migrate crest-name format
    if (saved && saved.field)
      return { bgColor: saved.field, bgType: 0, symbol: 51, symbolColor: saved.chief || "gules" }; // migrate oldest 3-axis
  } catch (e) {}
  return { bgColor: "argent", bgType: 0, symbol: 51, symbolColor: "gules" }; // Context::clearUserData: symbol 42 (our 51), symbolColor 3 gules, bgType 0, bgColor 8 argent — and your units wear these two colours
}
// PLAYER NAME. The player character is canonically **Sir Varius** — the campaign dialogue addresses you by that
// name throughout ("Sir Varius", "Varius, rest well tonight", "What is your command, Sir Varius?"). The Heraldry
// screen lets you rename him; at render time the chosen name is swapped in for "Varius" everywhere (the data is
// left untouched, so clearing the field — or keeping "Varius" — restores the original wording). "squire" is a
// separate, canonical vocative (the mentor to a young squire) and is deliberately NOT touched.
export const NAME_KEY = "ros-name-v1";
export function loadPlayerName() {
  try {
    return localStorage.getItem(NAME_KEY) || "Varius";
  } catch (e) {
    return "Varius";
  }
}
// The dialogue carries the offline name "Varius" where the original writes PlayerName (export_levels); swap in the
// player's own name, formatted like Context::formattedNameAppend (each word capitalised, the rest lower case).
export function subName(text) {
  if (!text) return text;
  let name = "";
  try {
    name = (localStorage.getItem(NAME_KEY) || "").trim();
  } catch (e) {}
  if (!name || name === "Varius") return text;
  const formatted = name.toLowerCase().replace(/(^|\s)(\S)/g, (m, s, c) => s + c.toUpperCase());
  // The Russian / Ukrainian story writes him «Вариус» / «Варіус» with case endings (Вариусу, Варіусе…): the name
  // replaces the whole declined word there (a custom name is not declined).
  return text.replace(/\bVarius\b/g, formatted).replace(/(^|[^Ѐ-ӿ'])(?:Вариус|Варіус)[Ѐ-ӿ]*/g, (m, p) => p + formatted);
}

// A mission's reward as won: a RANDOM reward (the record's q flag) draws `pick` DISTINCT entries from its whole pool
// (GameScreen::createRewardsMenu: getRandom % pool size, re-drawing one already taken); a fixed one comes back as it is.
// Returns { units, spoils, drawn } — `drawn` lists what a random draw picked (for the roll log).
export function drawReward(reward, random = Math.random) {
  if (!reward || !reward.random || !reward.pool) return reward || null;
  const left = reward.pool.map((_, i) => i),
    units = {},
    spoils = {},
    drawn = [];
  for (let pickNo = 0; pickNo < Math.min(reward.pick || 0, reward.pool.length); pickNo++) {
    const e = reward.pool[left.splice(Math.floor(random() * left.length), 1)[0]];
    if (e.unit) units[e.unit] = (units[e.unit] || 0) + 1;
    else spoils[e.spoil] = (spoils[e.spoil] || 0) + 1;
    drawn.push(e.unit || e.spoil);
  }
  return { units, spoils, drawn };
}

// A result cutscene's lines minus those the battle already showed (its ending conversation, a mid-battle "the Emperor
// has fallen") — each line is shown once, as in the original.
export function unseenLines(lines, shown = []) {
  return (lines || []).filter((l) => !shown.includes(l.text));
}
