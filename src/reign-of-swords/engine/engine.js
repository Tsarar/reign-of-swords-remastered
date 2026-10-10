/* ============================================================
   Reign of Swords — turn-based grid tactics engine
   A faithful re-creation of the 2008 Punch Entertainment game.
   The battle maps here are the ORIGINAL game's real battlefields:
   78 terrain grids reverse-engineered straight out of the iOS
   data file (reignofswords.dat) and shipped as levels.json —
   the same castles, keeps, fords, arenas and open fields, at
   their true 15×15…25×25 sizes. Because the maps are larger than
   the viewport, the board is a PANNABLE camera (drag / arrow keys
   / edge-scroll), exactly as the original ("Drag across the map or
   hold down on the edge of the screen to scroll the view").
   Framework-agnostic: mountReign(container, opts) -> controller.
   ============================================================ */

import { clamp, key, makeRng, ASSET_V, strictMost, FAR, shownHp } from "../util/util.js";
import { AudioManager, preloadSounds } from "./audio.js";
import { tr } from "../i18n/i18n.js";
import { Renderer } from "../render/render.js";
import { mixInto } from "../util/mixin.js";
import { getGameOptions } from "../util/options.js";
import { AiController } from "../ai/controller.js";
import { GridMethods } from "./grid.js";
import { CombatMethods } from "../rules/combat.js";
import { InputMethods } from "./input.js";
import { TurnFlowMethods } from "./turnflow.js";
import { DeployMethods } from "./deploy.js";
import { HotseatMethods } from "./hotseat.js";
import { OnlineMethods } from "./online.js";
import { LoopMethods } from "./loop.js";
import { ScenarioRunner } from "./script.js";
import { AbilityMethods } from "../rules/abilities.js";
import { DebugMethods } from "./debug.js";
import { UNIT_TYPES, TINCTURE_RGB, FX_TYPES, DEPLOY_COST, UNIT_RAMPS } from "../data/game-data.js";
import { DEPLOY_ELITE, DEPLOY_ORDER, DEPLOY_ROSTER, fallbackMission, buildMissions } from "../data/missions.js";
export { ASSET_V, UNIT_TYPES }; // re-exported for the React layer (ReignShell imports them from here)

// The unit roster + real combat-model merge live in data/game-data.js (UNIT_TYPES imported & re-exported at the top).

// ---- Terrain -----------------------------------------------------------
// Terrain lookup (tileProp / setTerrain) lives in rules/terrain.js — used by the grid mixin and by data/missions
// (buildMissions calls setTerrain once at mount). The mission/level build itself lives in data/missions.js.
function readPlayerTint() {
  try {
    const heraldry = JSON.parse(localStorage.getItem("ros-heraldry-v1"));
    const rgb = TINCTURE_RGB[heraldry && (heraldry.bgColor || heraldry.field)];
    if (rgb) return rgb;
  } catch (e) {}
  return TINCTURE_RGB.argent;
}
// YOUR ARMY'S COLOURS — Mission::setupTeamColors gives the player group the player's own heraldry (Context +0x144
// symbolColor, +0x14c bgColor) and Context::createUnitImages palette-swaps its units with them: the primary key greens
// → the symbol colour's ramp, the secondary key blues → the background colour's. Context::clearUserData's default
// crest is a gules symbol on a plain argent field (symbolColor 3, bgColor 8) — the red-and-white Carrone Army.
function readPlayerRamps() {
  let symbol = "gules",
    bg = "argent";
  try {
    const heraldry = JSON.parse(localStorage.getItem("ros-heraldry-v1"));
    if (heraldry) {
      symbol = heraldry.symbolColor || heraldry.chief || symbol;
      bg = heraldry.bgColor || heraldry.field || bg;
    }
  } catch (e) {}
  return UNIT_RAMPS[symbol] && UNIT_RAMPS[bg] ? [symbol, bg] : ["gules", "argent"];
}

// ---- Mission list (built at load from levels.json) ---------------------
// The loaded episode's missions — static data shared by every Game; each Game keeps its OWN current mission
// (this.mission, chosen with selectMission). Falls back to a single built-in field if levels.json can't be fetched.
export let MISSIONS = [fallbackMission()];

export async function loadLevels(base) {
  const built = await buildMissions(base); // fetch + build this episode's missions (data/missions.js)
  if (built && built.length) {
    MISSIONS = built;
  }
  return MISSIONS;
}
export function missionList() {
  return MISSIONS.map((m, i) => ({
    index: i,
    mapId: m.mapId,
    group: m.group,
    kingdom: m.kingdom,
    name: m.name,
    cols: m.cols,
    rows: m.rows,
  }));
}

// ---- helpers -----------------------------------------------------------
// Pure grid/colour/RNG helpers and ASSET_V live in util/util.js; audio in engine/audio.js (imported at the top).
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(src));
    i.src = src;
  });
}
// Foot infantry / casters have a dedicated STANDING pose (sprites/stand/*.png, the same art the roster
// uses) — the attack STRIPS have no neutral frame, so a standing unit drawn at strip-frame-0 looks mid-swing.
// We draw the stand pose while idle and only switch to the strip during the attack animation.
// Every unit's dedicated STANDING pose, extracted from the game's own roster atlas (android units/006,
// 29 upright frames — frame index = the unit's sprite index). This is the true idle art; the battle
// STRIPS have no neutral frame. Hero (king) keeps its battle atlas — its roster frame is a special render.
const STAND_UNITS = [
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
  // Ep2: real idle poses (sprites/stand/<key>.png, sliced from the walk sheet's frame 0)
  "craftsmen",
  "ballistae",
  "conjurer",
  "sapper",
  "bodyguard",
  "dunesirens",
  "bloodgorgers",
];
// WALKING animation: each unit has its own 4-frame walk cycle (android walk sheets, 256x72 = 4 frames @ 64x72),
// extracted to sprites/walk/<key>.png. A unit uses this real leg cycle while it moves; before, everything glided.
// Wizards are the one unit with no android walk sheet, so they keep the glide (no walk entry → falls back).
const WALK_UNITS = [
  "militiamen",
  "footmen",
  "halberdiers",
  "swordsmen",
  "cavalry",
  "pikemen",
  "greatswordsmen",
  "knights",
  "griffon",
  "archers",
  "rangers",
  "crossbowmen",
  "musketeers",
  "horsebowmen",
  "raiders",
  "shamans",
  "druids",
  "priests",
  "catapult",
  "trebuchet",
  "cannon",
  "greateagle",
  "bear",
  "stag",
  // Ep2: real 4-frame walk cycles sliced from ios-episode-2/terrain/003_6480x51.png (36 units × 4 frames @45px)
  "craftsmen",
  "ballistae",
  "conjurer",
  "sapper",
  "bodyguard",
  "dunesirens",
  "bloodgorgers",
];
// (WALK_FRAMES/WALK_W/WALK_H — the walk-strip frame dimensions — live in render/render.js, their only consumer.)
async function loadAssets(base, dataBase = base) {
  const cacheBust = "?v=" + ASSET_V;
  const sheets = {};
  await Promise.all(
    Object.keys(UNIT_TYPES).map(async (k) => {
      const img = await loadImage(base + "sprites/" + UNIT_TYPES[k].sprite + ".png" + cacheBust);
      sheets[k] = { blue: img, red: img };
    }),
  );
  const stands = {};
  await Promise.all(
    STAND_UNITS.map(async (k) => {
      stands[k] = await loadImage(base + "sprites/stand/" + k + ".png" + cacheBust).catch(() => null);
    }),
  );
  const walks = {};
  await Promise.all(
    WALK_UNITS.map(async (k) => {
      const img = await loadImage(base + "sprites/walk/" + k + ".png" + cacheBust).catch(() => null);
      walks[k] = img ? { blue: img, red: img } : null;
    }),
  );
  const tileset = await loadImage(dataBase + "tileset.png" + cacheBust).catch(() => null); // per-EPISODE tileset (Ep1=124 tiles, Ep2=260 incl. desert) — from the DATA dir, not the shared sprite dir
  const statusIcons = await loadImage(base + "hud/status.png" + cacheBust).catch(() => null); // android units/067 — 13 status badges @52px
  const orderIcons = await loadImage(base + "hud/orders.png" + cacheBust).catch(() => null); // android units/001 — 10 order/cursor icons @50px
  const flags = await loadImage(base + "hud/flags.png" + cacheBust).catch(() => null); // android units/066 — objective flags: 3 frames @64×88 (white/green/red)
  const fx = {};
  await Promise.all(
    Object.keys(FX_TYPES).map(async (fxName) => {
      fx[fxName] = await loadImage(base + "fx/" + (FX_TYPES[fxName].src || fxName) + ".png" + cacheBust).catch(
        () => null,
      );
    }),
  ); // `src` lets several FX share one strip (e.g. arcane_out/arcane_in reuse arcane.png)
  // The in-flight arrow sprites — higher-res ANDROID effect art (z_014 green-nock, z_015 flaming, 48×48).
  // Normal bows fly the green arrow; Fire Arrows (archers) fly the flaming one.
  const img = (p) => loadImage(base + p + cacheBust).catch(() => null);
  const arrows = {};
  [arrows.normal, arrows.fire] = await Promise.all([img("fx/arrow.png"), img("fx/arrow_fire.png")]);
  // In-flight projectile sprites — confirmed against the La/q weapon→sprite switch, then upgraded to the higher-res
  // ANDROID effect art: musket bullet = z_016 (32px), catapult stone = z_019 (3 frames @40px), cannonball = z_020 (32px).
  // Magic spell missiles: fireball = higher-res ANDROID rotating fireball (z_018, 5 frames @64px); ice/lightning =
  // iOS blue bolts (ui/007/008). The wizard's flying "ball" is drawn per spell.
  const PROJ = ["bullet", "stone", "cannonball", "fireball", "spellbolt", "spellbolt2"];
  const proj = {};
  (await Promise.all(PROJ.map((n) => img("fx/" + n + ".png")))).forEach((image, i) => {
    proj[PROJ[i]] = image;
  });
  Object.assign(proj, {
    // Episode II BALLISTAE bolt — a pre-rendered 18-frame ROTATION atlas (ios-episode-2 misc/010_648x36, 36×36
    // each): the in-flight frame is picked by the shot's angle so the bolt always points where it's headed.
    bolt: await loadImage(base + "fx/ballista_bolt.png" + cacheBust).catch(() => null),
    // Episode II CRAFTSMEN thrown Hammer — two 4-frame spin sheets (ios-episode-2 ui/009 + ui/010, 22×22 each),
    // played back-to-back as one 8-frame tumble so the hammer whirls end-over-end in flight.
    hammerA: await loadImage(base + "fx/hammer_a.png" + cacheBust).catch(() => null),
    hammerB: await loadImage(base + "fx/hammer_b.png" + cacheBust).catch(() => null),
  });
  return { sheets, stands, walks, tileset, statusIcons, orderIcons, flags, fx, arrows, proj };
}
// One asset set per (sprite dir, episode dir) for the whole session: a battle reuses what an earlier battle — or the
// menu's background preload (preloadReign) — already fetched and decoded, instead of reloading ~150 images each time.
const ASSET_MEMO = new Map();
function loadAssetsShared(artBase, dataBase) {
  const k = artBase + "|" + dataBase;
  if (!ASSET_MEMO.has(k))
    ASSET_MEMO.set(
      k,
      loadAssets(artBase, dataBase).catch((e) => {
        ASSET_MEMO.delete(k);
        throw e;
      }),
    );
  return ASSET_MEMO.get(k);
}
// Warm the caches while the player is still in the menus (ReignShell calls it once the menu is up): sprites, effects,
// the tileset and every sound clip, so the first battle opens without the loading pause.
// Also the INTERFACE images — skill/class/status icons, unit icons, heraldry, crests, portraits, frames — listed in
// each dir's preload.json (tools/ros/gen_preload.py), fetched at the exact URLs the menus use so the camp's unit card
// and the dialogue boxes draw instantly. The Image objects are kept so the decoded bitmaps stay warm.
const UI_WARM = [];
const UI_DONE = new Set();
function preloadUi(dir) {
  if (UI_DONE.has(dir)) return;
  UI_DONE.add(dir);
  fetch(dir + "preload.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((files) => {
      for (const file of files) {
        const i = new Image();
        i.decoding = "async";
        i.src = dir + file;
        UI_WARM.push(i);
      }
    })
    .catch(() => {});
}
export function preloadReign({ base, spriteBase }) {
  const artBase = spriteBase || base;
  loadAssetsShared(artBase, base).catch(() => {});
  preloadSounds(artBase);
  preloadUi(artBase);
  if (base !== artBase) preloadUi(base);
}

// ---- Combat effect animations (real extracted sprites) -----------------
// FX_TYPES (visual-effect sprite strips) + meleeHitFx live in data/game-data.js (imported at the top).

// ---- Audio -------------------------------------------------------------
// All extracted from the original iOS/Android sound set and matched to the event the game's own code plays them
// at (decompiled La/q `switch h(aW)` + the `al` locomotion switch — see memory ros-groups-allies AUDIO map):
//   MELEE is a per-weapon 2-group split — Spear/Pike/Scythe (weapons 3/12/14) cycle snd_020/021/022 = melee_pole*;
//   every OTHER melee weapon cycles snd_023/024 = melee_blade*. RANGED: bows→arrow(snd_028), musket & cannon
//   FIRE→gun(snd_014), cannonball IMPACT→cannon(snd_001), catapult/trebuchet→catapult(snd_026). MOVEMENT by al:
//   flying(al0)→fly(snd_005), siege(al4)→march(snd_034), cavalry→gallop(snd_008), foot→move(snd_013).
// SOUND_NAMES + AudioManager live in engine/audio.js (imported at the top).

// ========================================================================
//  Game
// ========================================================================
// A new seed for the dice: real play rolls fresh dice each battle (crypto when there is one).
function freshSeed() {
  try {
    if (globalThis.crypto && globalThis.crypto.getRandomValues)
      return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  } catch (e) {}
  return Math.floor(Math.random() * 4294967295) + 1;
}

class Game {
  constructor(canvas, assets, onState, audio, army, godArmy) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.onState = onState || (() => {});
    this.audio = audio || { play() {}, setMuted() {} };
    this.playerArmy = army || null; // {unitKey: count} owned army for campaign deployment (points-budget, count-capped)
    this.godArmy = !!godArmy; // DEV: lift the deploy point limit to 90000 so the full sandbox army can be fielded
    // DELIBERATE DEVIATION (MECHANICS.md §13): our own seeded generator, not the original's mlib_Random::getRandom —
    // every chance matches, the sequence of rolls does not. A fixed seed for the tests and the headless Battle Lab;
    // real play (mountReign sets freshSeeds) draws a new one for each battle and each retry, so a replayed battle
    // doesn't roll the same dice again. The seed is in the 🐞 snapshot.
    this.seed = 0x51a7;
    this.rng = makeRng(this.seed);
    this.playerTint = readPlayerTint(); // your heraldry colour, washed over your units
    this.playerRamps = readPlayerRamps(); // [symbolColor, bgColor] — your units' palette swap (createUnitImages)
    this.floaters = [];
    this.projectiles = [];
    this.particles = [];
    this.bolts = [];
    this.anim = null;
    this.aiQueue = null;
    this.inputLocked = false; // true while a React modal covers the field — swallows canvas taps/pan
    this.musterHold = null; // set by the battle screen: (mapId) => true when it asks "Previous Setup Found" first
    this.selected = null;
    this.hover = null;
    this.hoverPx = null;
    this.autopilot = null; // 🤖 the AI plays your turns with this strategy (ai/autopilot.js); null = you play
    this.renderer = new Renderer(this); // draws the battlefield (render/render.js)
    this.ai = new AiController(this); // runs the AI-controlled sides (ai/controller.js)
    this.scenario = new ScenarioRunner(this); // runs the map's scenario script (engine/script.js)
    this.reach = null;
    this.targets = null;
    this.mode = "select";
    this.phase = "player";
    this.turn = 1;
    this.missionIndex = 0;
    this.mission = MISSIONS[0]; // the battle this Game plays (selectMission)
    this._openingEnemy = false;
    this.cam = { x: 0, y: 0 }; // world-pixel scroll offset
    this.camTarget = null; // eased camera focus
    this.edge = { x: 0, y: 0 }; // edge-scroll velocity (tiles/s * tile)
    this.keys = {};
    this._raf = 0;
    this._last = 0;
    this.setup();
    this.resize();
    this.centerOnDeploy();
    this._bind();
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
    // requestAnimationFrame is throttled to ~0 when the tab/pane is hidden, which FREEZES the sim — so a
    // fast-forwarded enemy turn would stall the moment you minimize. While hidden, drive the sim with a
    // timer instead (no render — nothing to see); on return, reset the clock so there's no giant catch-up jump.
    this._onVis = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        if (!this._bgTimer) {
          this._last = performance.now();
          this._bgTimer = setInterval(() => this._tickBg(), 100);
        }
      } else {
        if (this._bgTimer) {
          clearInterval(this._bgTimer);
          this._bgTimer = null;
        }
        this._last = performance.now();
      }
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVis);
    this._emit();
  }

  // (Re)build the battle for this.mission — at mount, on a mission change and on Restart: the map and its
  // objectives, a clean slate of per-battle state, the armies, then either the muster (a deploy mission) or a held
  // fixed-force opening.
  setup() {
    if (this.hotseatMode) this.mission = this._hsMission(this.mission); // a skirmish becomes a two-player muster
    this._hsInit();
    this._setupMap();
    this._resetBattleState();
    this._spawnEnemies();
    this._spawnBlueForces();
    this.scenario.init(); // tag scripted units with their ids, apply battle-start holds/hides, arm the escort
    if (this.mission.deploy) {
      this._setupMuster();
      if (this.online) this._onlineMuster(); // online: the guest musters as player 2 at once
    } else {
      // Fixed-force mission (no deploy): HOLD the opening — turn banner, round-1 dialogue and any enemy-first
      // move — until the briefing is dismissed (openBattle), so they don't all stack on top of the briefing modal.
      this.phase = "player";
      this._needsOpen = true;
    }
  }

  // The map: its tiles, structures, objectives and capture areas, the tutorial guide and the Ep2 portals.
  _setupMap() {
    this.cols = this.mission.cols;
    this.rows = this.mission.rows;
    // A per-battle COPY of the map: structures change tile as they are damaged (Map::applyDamage rewrites the cell), so
    // a restart must start again from the mission's pristine grid.
    this.tiles = (this.mission.tiles || new Array(this.cols * this.rows).fill(63)).slice();
    this.structHp = new Map(); // key -> structure HP on the game's 256 scale (Map::loadMap seeds every cell with 256)
    this.razed = new Set(); // cells knocked down to their end tile this battle — they take the rubble terrain
    // Ep2 map state laid DURING a battle must not survive a restart / mission change: Dune Siren quicksand tiles and
    // the Craftsmen's villages.
    this.quicksand = new Map();
    this.builtVillages = new Map();
    const objs = new Set((this.mission.objectives || []).map(([x, y]) => key(x, y)));
    const areaOf = new Map();
    (this.mission.objectiveAreas || []).forEach((tiles, i) => tiles.forEach(([x, y]) => areaOf.set(key(x, y), i)));
    this.objectives = [...objs].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { tx: x, ty: y, area: areaOf.has(k) ? areaOf.get(k) : null }; // which capture area it belongs to
    });
    // the capture areas a "hold" (1) / "conquer" (2) mission scores (GameScreen::updateCapturePoints). In a conquer
    // mission every area starts as the ENEMY's (an unowned area is given to faction 1) — the red flags at the start.
    // Every record keeps its areas (Mission+0x40) whatever its type — the group AI weighs them (_glConcentration) —
    // but only a hold / conquer mission scores and flags them (captureAreas).
    this.captureMode = this.mission.captureMode || 0;
    this.areas = (this.mission.objectiveAreas || [])
      .filter((tiles) => tiles.length)
      .map((tiles) => ({
        tiles: tiles.map(([x, y]) => ({ tx: x, ty: y })),
        owner: this.captureMode === 2 ? "red" : null,
      }));
    this.captureAreas = this.captureMode ? this.areas : [];
    this.tutZone = this.mission.tutZone ? new Set(this.mission.tutZone.map(([x, y]) => key(x, y))) : null; // tutorial "green" guide (no deploy)
    // EPISODE II warp portals: one-way source -> destination records + the teams allowed through (rules in engine/grid _portalWarp).
    this.portals = this.mission.portals
      ? this.mission.portals.map(([sx, sy, dx, dy, mask]) => ({ sx, sy, dx, dy, mask: mask || [] }))
      : null;
  }

  // Per-battle state that must not leak from the previous battle (or into a Restart).
  _resetBattleState() {
    this.deployZone = new Set(); // fresh each setup — fixed-force missions (incl. the combat tutorial) never fill it, so it must not carry a stale zone
    // the AI's hold-group records (GroupLogic) and the muster roster / deploy-opening flags (only a deploy mission
    // sets them again, in _setupMuster)
    this._gl = {};
    this.rosterMap = null;
    this._rosterOrder = null;
    this._deployOpen = false;
    this._deployOpened = false;
    this._musterHeld = false; // the muster's opening, waiting for the "Previous Setup Found" answer
    this.units = [];
    this._nid = 0;
    this.placing = null;
    this.pickUp = null; // pickUp = an issued unit held for repositioning during deploy
    this._firedWaves = new Set();
    this.wave = null; // triggered reinforcement waves (waves.json)
    this._firedMoves = new Set(); // triggered scripted moves (op3, scripts_ai.json)
    this.turnBanner = null;
    this.bannerHold = 0; // seconds left on the whose-turn banner — the battle waits while it's up
    this._turnBannerId = 0; // one-shot whose-turn announcement
    this._firedEventRounds = new Set();
    this.battleEvent = null; // triggered mid-battle dialogue (battle_events.json)
    this._lossTrig = undefined; // the script's loss counter (escapeStatus), looked up once per battle
    this._redSeen = false; // the elimination check waits until the enemy has been on the field or a turn has ended
    this._turnEnded = false;
    this.majorVictory = false;
    this._shownLines = new Set(); // dialogue already shown this battle (the result cutscene skips it)
    this._garrisonReleased = false; // town garrisons (ai/ai.js ALLY_GARRISON) hold again
    this.defeatReason = null; // why the battle was lost (_lose) — the defeat card's line
    this.prayerMarks = []; // Priest Shield / Retribution casts: { kind, team, ally, group, tx, ty, caster } (rules/combat)
  }

  // The enemy armies. An enemy tuple is [type, x, y, group, globalGroup] — the 4th value is the real faction/group
  // index (see enemyGroups), NOT a hero flag; several campaign maps field two or three independent enemy armies on
  // one side. group = the REAL global scenario group index (5th tuple value) when the map carries groupOrder, else
  // the legacy per-side index. The whole turn cycle (_advanceAi) orders by this global index.
  _spawnEnemies() {
    const holdSet = this.mission.holdTiles ? new Set(this.mission.holdTiles.map(([hx, hy]) => hx + "," + hy)) : null;
    this.mission.red.forEach(([type, x, y, groupNo, groupIdx]) => {
      const u = this._makeUnit(type, "red", x, y, false);
      u.group = groupIdx != null ? groupIdx : groupNo || 0;
      if (holdSet && holdSet.has(x + "," + y)) this.ai._glSetMode(u, 1);
      // scripts_ai holdTiles = the AIMODE(unit,1) units → their marker group HOLDS (GroupLogic mode 2,
      // ai/grouplogic.js); without that list, a mission-wide enemyHold keeps every enemy at home.
      if (holdSet ? holdSet.has(x + "," + y) : this.mission.enemyHold) u._home = { tx: x, ty: y };
    });
  }

  // The player's PRE-PLACED force (real team-0 preset from the scenario record) — always on the field.
  // Allied AI armies (real team-0 non-player groups): on your side (team "blue") but AI-run and marked
  // `ally` so they take their OWN turn and wear their OWN heraldry — you never command them.
  // Both are created in the scenario's spawn order (this.mission.spawnOrder, where they interleave): the original's unit
  // list order, which its AI walks (first unit wins a tie).
  _spawnBlueForces() {
    const blueSpawns = [
      ...(this.mission.blue || []).map((e) => ["preset", e]),
      ...(this.mission.allies || []).map((e) => ["ally", e]),
    ];
    if (this.mission.spawnOrder) {
      const spawnIdx = (x, y) => {
        const i = this.mission.spawnOrder.findIndex(([sx, sy]) => sx === x && sy === y);
        return i < 0 ? FAR : i;
      };
      blueSpawns.sort((a, b) => spawnIdx(a[1][1], a[1][2]) - spawnIdx(b[1][1], b[1][2]));
    }
    for (const [kind, e] of blueSpawns) {
      if (kind === "preset") {
        const [type, x, y, hero, groupIdx] = e;
        const u = this._makeUnit(type, "blue", x, y, hero);
        u.preset = true;
        if (groupIdx != null) u.group = groupIdx;
      } else {
        const [type, x, y, groupNo, groupIdx] = e;
        const u = this._makeUnit(type, "blue", x, y, false);
        u.preset = true;
        u.ally = true;
        u.group = groupIdx != null ? groupIdx : groupNo || 0;
      }
    }
  }

  // A deploy mission: the Hero joins the muster (unless pre-placed), the roster and the deploy zone are set up and
  // the battle waits in the "deploy" phase for Fight (startBattle).
  _setupMuster() {
    const hasHeroOnField = this.units.some((u) => u.team === "blue" && u.hero);
    let heroX, heroY;
    if (this.mission.deploy.hero && !hasHeroOnField) {
      // no pre-placed hero → the Hero joins the muster
      [, heroX, heroY] = this.mission.deploy.hero;
      this._makeUnit("king", "blue", heroX, heroY, true);
    }
    // No one-Hero cap (the original has none): owned Heroes muster like any elite, limited by the elite slots.
    this.rosterMap = {};
    this._rosterOrder = [];
    this._musterRoster().forEach(([type, cost, count, elite]) => {
      if (!UNIT_TYPES[type]) return;
      this.rosterMap[type] = { cost, count: count == null ? null : count, elite: !!elite };
      this._rosterOrder.push(type);
    });
    this.deployZone = new Set((this.mission.deploy.zone || []).map(([x, y]) => key(x, y)));
    if (heroX != null) this.deployZone.add(key(heroX, heroY));
    this.phase = "deploy";
    this._needsOpen = false; // a deploy mission opens from startBattle, NOT openBattle — clear any stale flag
    // …but its battle-start SCRIPT runs as the muster opens: GameScreen::startGameModeCampaign (iOS Ep2 @0x25234)
    // queues game state 1 at once for a mission with a deploy budget, and activateGameState(1) (@0x2a634) starts
    // sequence 2 — the record's tag-2 chain (camera, the enemy's arrival, its opening lines) — as soon as sequence 1
    // ends, i.e. BEFORE the player deploys (Merovin 3: the Baron treats with you, "What is your command?").
    this._deployOpen = !!(this.mission.script && !this.mission.deployDrill);
    this._deployOpened = false;
    // Deployment DRILL: greet the player with the commander's opening line ("Wake up, squire… the men need
    // to be assembled") DURING the muster — its natural place — leaving the "ready then? Good" beat for Begin.
    if (this.mission.deployDrill && this.mission.events) {
      const intro = this.mission.events.filter((e) => e.round === 1)[0];
      if (intro)
        this.battleEvent = {
          lines: [{ speaker: intro.speaker, side: intro.side, face: intro.face, text: intro.text }],
          id: (this._eventId = (this._eventId || 0) + 1),
        };
    }
  }

  // The muster roster as [type, cost, count, elite] rows: the player's OWNED army (deploy from what you own, gated
  // by the points budget + elite cap — the real game's model); else the standalone mission default.
  _musterRoster() {
    const army = this.playerArmy;
    const owned = army && DEPLOY_ORDER.some((k) => (army[k] || 0) > 0 && UNIT_TYPES[k]);
    if (!owned) return (this.mission.deploy.roster || DEPLOY_ROSTER).slice();
    return DEPLOY_ORDER.filter((k) => (army[k] || 0) > 0 && UNIT_TYPES[k]).map((k) => [
      k,
      DEPLOY_COST[k] || 100,
      army[k],
      !!DEPLOY_ELITE[k],
    ]);
  }
  // Kick off a fixed-force battle once the briefing is gone. Deploy missions don't use this (their opening runs
  // from startBattle). Campaign missions, which show no briefing, call this right after mounting.
  openBattle() {
    if (this._deployOpen && this.phase === "deploy") {
      // The original asks "Previous Setup Found" as the muster opens (activateControlState, control state 0x33 →
      // popup 24), before the opening sequence is queued, and runs no script while a popup is up (activateNextMenu
      // sets GameScreen+0x1d0, onTick skips updateScriptSequencing until hideCurrentMenu clears it): the opening
      // waits for the answer — releaseMuster().
      if (this.musterHold && this.musterHold(this.mission.mapId)) {
        this._musterHeld = true;
        this._emit();
        return;
      }
      this._runMusterOpening();
      return;
    }
    if (!this._needsOpen) return;
    this._needsOpen = false;
    if (this.mission.script) {
      // real battle-start staging (camera, lines, scripted moves), then round 1 (turnflow _openRound1)
      this.scenario.runInitial(() => this._openRound1());
      this._emit();
      return;
    }
    this._openRound1();
    this._emit();
  }
  // deploy mission: play the opening chain now, over the muster
  _runMusterOpening() {
    this._musterHeld = false;
    this._deployOpen = false;
    this._deployOpened = true;
    this.scenario.runInitial(() => this._emit());
    this._emit();
  }
  // "Previous Setup Found" was answered (or there was nothing to ask): the held opening plays now.
  releaseMuster() {
    if (this._musterHeld && this._deployOpen && this.phase === "deploy") this._runMusterOpening();
  }
  // A blocking opening dialogue was just dismissed — release whatever was waiting on it, so the dialogue never
  // overlaps the enemy's opening move or the victory modal. No-op for ordinary mid-battle dialogue.
  // Every dialogue line the battle has shown (script beats and round events). The campaign's victory / defeat
  // cutscene is often the very conversation the battle just played (a commander's surrender, "the Emperor has
  // fallen"), so the shell skips those lines instead of showing them twice.
  _noteShownLines(lines) {
    this._shownLines = this._shownLines || new Set();
    for (const line of lines || []) if (line && line.text) this._shownLines.add(line.text);
  }
  shownLines() {
    return [...(this._shownLines || [])];
  }
  eventClosed() {
    this.battleEvent = null; // the beat is dismissed — the AI (paused on it) and the script queue may continue
    if (this.scenario.finish()) return; // that conversation ended the battle (a surrender / a rout)
    if (this.scenario.resume()) {
      this._emit();
      return;
    } // a staged battle-start chain continues (e.g. the commander rides off)
    if (this._pendingScriptedMoves) {
      const pending = this._pendingScriptedMoves;
      this._pendingScriptedMoves = null;
      pending();
      this._emit();
      return;
    } // the commander's line was dismissed → he now flees / moves up
    if (this._pendingDrillWin) {
      this._pendingDrillWin = false;
      this.phase = "victory";
      this._emit();
      return;
    }
    if (this._pendingEnemyOpen) {
      this._pendingEnemyOpen = false;
      if (this._hasGroupOrder()) this._openBattle();
      else {
        this._openingEnemy = true;
        this.startEnemyPhase();
      }
      this._emit();
      return;
    }
  }

  _makeUnit(type, team, tx, ty, hero) {
    const T = UNIT_TYPES[type] || UNIT_TYPES.footmen,
      tile = this.tile || 44;
    // player-side units default to the player's own global group (so deployed/hero units share the player's
    // turn slot); red/ally callers override group right after creation.
    const defGroup = team === "blue" && this.mission && this.mission.playerGroup != null ? this.mission.playerGroup : 0;
    const u = {
      id: this._nid++,
      type,
      team,
      T,
      tx,
      ty,
      hp: 100,
      acted: false,
      hero: !!hero,
      group: defGroup,
      spawn: { tx, ty },
      face: tx < (this.cols || 15) / 2 ? 1 : -1, // GameScreen::createUnitAt: byte 0x14f = (x < cols/2) — a new unit looks toward the map's centre line, whichever side it fights for
      ambush: !!T.ambush,
      ambushUsed: false,
      attackedTurn: false,
      walled: false, // Pike Wall braces at the end of a turn without an attack (Unit::endTurn), not at creation
      px: tx * tile,
      py: ty * tile,
      anim: 0,
      animT: 0,
      attacking: false,
      dead: false,
      bob: Math.random() * 6.28, // look only: not the game's dice
    };
    if (T.canLightning && team !== "blue") u.spell = "fireball"; // ENEMY/AI wizards default to Fireball; the PLAYER's wizard starts with NO spell chosen — you must pick one (which drops into aim). All spell branches read undefined as Fireball, so AI is unaffected.
    this.units.push(u);
    return u;
  }

  // --- objectives & morale ---
  objectiveOwner(obj) {
    const u = this.unitAt(obj.tx, obj.ty);
    return u ? u.team : obj.owner || null;
  }
  updateObjectives() {
    for (const obj of this.objectives) {
      const u = this.unitAt(obj.tx, obj.ty);
      if (u) obj.owner = u.team;
    }
    this.updateCapturePoints();
  }
  // GameScreen::updateCapturePoints: per area, the side with STRICTLY the most living units on its tiles. A "hold"
  // area (type 1) goes to that side and stays with it while nobody has the majority (white until first taken). A
  // "conquer" area (type 2) is the enemy's until YOUR side has the majority, and then it is yours for good — the
  // enemy cannot take it back. Only team 0 ever conquers (@0x1d622): in hot-seat that is player 1 (the map's player
  // group), whose units are "blue" on their own turns and "red" on player 2's.
  updateCapturePoints() {
    const conqueror = this.hs && this.hs.active !== 0 ? "red" : "blue";
    for (const a of this.captureAreas || []) {
      const tally = {};
      for (const cell of a.tiles) {
        const u = this.unitAt(cell.tx, cell.ty);
        if (u && !u.dead) tally[u.team] = (tally[u.team] || 0) + 1;
      }
      const top = strictMost(tally);
      if (this.captureMode === 1) {
        if (top) a.owner = top;
      } else if (top === conqueror && a.owner !== conqueror) {
        a.owner = conqueror;
        // the game's own lines (Ep2 strings 716 / 717), shown as the area falls (GameScreen message 54 / 55): the
        // second when the side looking on is not team 0
        this.notify(
          conqueror === "blue" ? "Our forces have conquered a vital area!" : "The enemy has conquered a vital area!",
        );
      }
    }
  }
  controlled(team) {
    return this.objectives.filter((o) => this.objectiveOwner(o) === team).length;
  }
  hasMorale(team) {
    if (this.captureAreas && this.captureAreas.length) return this._captureHolder() === team;
    if (!this.objectives.length) return false;
    const other = team === "blue" ? "red" : "blue";
    return this.controlled(team) > this.controlled(other) && this.controlled(team) * 2 > this.objectives.length;
  }
  // Villages & keeps heal 20 HP to a unit that starts its turn on them — once a round, at the start of ITS army's
  // turn: `only` narrows the team to the army whose turn it is (the player's own units vs an allied army on the same
  // side, one enemy army of several).
  healOnKeeps(team, only) {
    for (const u of this.units) {
      if (u.dead || u.team !== team || (only && !only(u))) continue;
      const terrain = this.terrainAt(u.tx, u.ty);
      if (terrain.heal && u.hp < 100) {
        // GameScreen::hideCurrentMenu's turn-start heal (iOS Ep2 @0x1f856) works on the shown HP: + bonus, capped at 100
        const before = u.hp;
        u.hp = Math.min(100, before + terrain.heal);
        if (u.hp > before)
          this.floaters.push({
            x: u.px + this.tile / 2,
            y: u.py,
            t: 0,
            life: 0.8,
            vy: -22,
            text: "+" + (u.hp - before),
            heal: true,
          });
      }
    }
  }

  // --- camera / viewport ---
  resize() {
    const stage = this.canvas.parentElement;
    const rect = stage ? stage.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    // MOBILE (≤820px): the battle is a full-screen flex column (see reign.css) — the stage is flex:1, so its own
    // measured height IS the space the board may fill. Read that instead of the desktop's window-minus-chrome
    // formula, so the board dominates the phone screen instead of a small letterbox. Desktop keeps the old model.
    // (A phone on its side counts too: a short landscape screen, however wide — reign.css uses the same test.)
    const winW = window.innerWidth || 900,
      winH = window.innerHeight || 800;
    const mobile = winW <= 820 || (winH <= 500 && winW > winH);
    // DESKTOP: the frame hugs the board (set below) — tiles stop at 56px, so a map of 16 columns or fewer would
    // otherwise sit in a band of the frame's dark ground on each side. The room is therefore measured on the column
    // the frame stands in (its content box, less the frame's own border), never on the frame sized from the result.
    const frame = this._stageFrame(stage, mobile);
    const availW = Math.max(280, (frame ? frame.room : rect.width) || 900);
    // On mobile the canvas fills the flex-sized stage EXACTLY (no min that could exceed the stage and overflow it);
    // only fall back to half the viewport if the stage hasn't been measured yet (rect.height 0 on first mount).
    const availH = mobile
      ? Math.round(rect.height) || Math.round((window.innerHeight || 800) * 0.5)
      : clamp((window.innerHeight || 800) - 470, 300, 530);
    // Tile sized so ~N columns fill the available width. Desktop targets ~15 cols; on a phone we target fewer so
    // tiles (and tap targets) stay large — the camera pans/zooms to reveal wider maps.
    this.tile = mobile
      ? clamp(Math.round(availW / Math.min(this.cols, 10)), 40, 64)
      : clamp(Math.round(availW / Math.min(this.cols, 15)), 34, 56);
    this.world = { w: this.tile * this.cols, h: this.tile * this.rows };
    const viewW = Math.min(availW, this.world.w);
    const viewH = Math.min(availH, this.world.h);
    this.view = { w: Math.round(viewW), h: Math.round(viewH) };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.view.w * this.dpr);
    this.canvas.height = Math.round(this.view.h * this.dpr);
    this.canvas.style.width = this.view.w + "px";
    this.canvas.style.height = this.view.h + "px";
    this.canvas.style.display = "block";
    this.canvas.style.margin = "0 auto";
    this.canvas.style.touchAction = "none";
    if (stage && stage.style) {
      stage.style.width = frame ? this.view.w + frame.border + "px" : "";
      stage.style.marginLeft = stage.style.marginRight = frame ? "auto" : "";
    }
    for (const u of this.units) {
      u.px = u.tx * this.tile;
      u.py = u.ty * this.tile;
    }
    this.clampCam();
  }
  // The desktop frame's room (the content width of the column it stands in, less its own side borders) and those
  // borders; null on a phone, where the stage is laid out by CSS and measured as it is.
  _stageFrame(stage, mobile) {
    const column = stage && stage.parentElement;
    if (mobile || !column || typeof getComputedStyle !== "function") return null;
    const px = (v) => parseFloat(v) || 0;
    const cs = getComputedStyle(column),
      ss = getComputedStyle(stage);
    const border = px(ss.borderLeftWidth) + px(ss.borderRightWidth);
    const room = column.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight) - border;
    return room > 0 ? { room, border } : null;
  }
  clampCam() {
    const maxX = this.world.w - this.view.w,
      maxY = this.world.h - this.view.h;
    this.cam.x = maxX <= 0 ? -maxX / 2 : clamp(this.cam.x, 0, maxX);
    this.cam.y = maxY <= 0 ? -maxY / 2 : clamp(this.cam.y, 0, maxY);
  }
  centerOn(tx, ty, ease) {
    let camX = (tx + 0.5) * this.tile - this.view.w / 2;
    let camY = (ty + 0.5) * this.tile - this.view.h / 2;
    if (ease) {
      // Clamp the eased TARGET the way clampCam clamps the camera — otherwise a unit near the map edge sets a target
      // the camera can never reach, camTarget never clears, and anything waiting on the pan (the AI turn) stalls.
      const maxX = this.world.w - this.view.w,
        maxY = this.world.h - this.view.h;
      camX = maxX <= 0 ? -maxX / 2 : clamp(camX, 0, maxX);
      camY = maxY <= 0 ? -maxY / 2 : clamp(camY, 0, maxY);
      this.camTarget = { x: camX, y: camY };
    } else {
      this.cam.x = camX;
      this.cam.y = camY;
      this.camTarget = null;
      this.clampCam();
    }
  }
  centerOnDeploy() {
    // frame the player's side at battle start
    const blue = this.units.filter((u) => !u.dead && u.team === "blue");
    const zone =
      this.mission.deploy && this.mission.deploy.zone && this.mission.deploy.zone.length
        ? this.mission.deploy.zone
        : blue.length
          ? blue.map((u) => [u.tx, u.ty])
          : [[Math.floor(this.cols * 0.2), Math.floor(this.rows / 2)]];
    const meanX = zone.reduce((s, p) => s + p[0], 0) / zone.length,
      meanY = zone.reduce((s, p) => s + p[1], 0) / zone.length;
    this.centerOn(meanX, meanY, false);
  }
  panBy(dx, dy) {
    this.cam.x += dx;
    this.cam.y += dy;
    this.camTarget = null;
    this.clampCam();
  }

  reset() {
    if (this.freshSeeds) this.seed = freshSeed();
    this.rng = makeRng(this.seed);
    this._rolls = []; // the snapshot's record is of THIS battle: its rolls and its decisions
    this._dbgLog = [];
    this.floaters = [];
    this.projectiles = [];
    this.particles = [];
    this.bolts = [];
    this.fx = [];
    this.anim = null;
    this.aiQueue = null;
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.mode = "select";
    this.orderMode = null;
    this.marchQueue = null;
    this.marchTarget = null;
    this.marchDelay = 0;
    this.phase = "player";
    this.turn = 1;
    this._endSfx = false;
    this._undoFrom = null;
    this.inspect = null;
    this._openingEnemy = false;
    this.pendingSkip = null;
    this._teleportLock = false;
    this._delayed = []; // clear transient modals/locks so a restart isn't stuck on an old "end turn?" prompt
    this._lossTrig = undefined;
    this.majorVictory = false;
    this._shownLines = new Set(); // dialogue already shown this battle (the result cutscene skips it)
    this._garrisonReleased = false; // town garrisons (ai/ai.js ALLY_GARRISON) hold again
    this.defeatReason = null;
    this.setup();
    this.resize();
    this.centerOnDeploy();
    this._emit();
  }

  // ⚡ Auto-charge (⚙ Settings; engine/input _judgeChargeRun) is read LIVE: it shapes only a player's own moves (the AI
  // never uses it), so a change applies at once, mid-battle too. An online battle always plays it on, the default —
  // both devices replay the same moves and must agree.
  _autoChargeOn() {
    return this.online ? true : getGameOptions().autoCharge !== false;
  }

  selectMission(i) {
    if (i < 0 || i >= MISSIONS.length) return;
    this.mission = MISSIONS[i];
    this.missionIndex = i;
    this.realisticSiege = !!getGameOptions().realisticSiege; // ⚙ Settings, fixed for the battle (ai.js _glValidTarget)
    this.reset();
  }

  // Contextual "what do I do now" hint, phrased from the real in-game manual (help.json). The React layer
  // shows it as a dismissable line; it changes with the phase/selection so it reads like the original's tips.
  // A short-lived message to the player (an invalid action explained) — shown as a toast by the battle UI, independent
  // of the tutorial tips. `vars` fill the {placeholders} of the (translatable) text.
  notify(text, vars) {
    this.notice = { id: (this._noticeId = (this._noticeId || 0) + 1), text, vars: vars || null };
  }
  _hint() {
    // Always-on coaching tips are TUTORIAL-only (the "special" group / the movement + deploy drills). Real
    // campaign / skirmish / raid battles show no persistent hint line.
    if (!(this.mission && this.mission.group === "special")) return null;
    if (this.phase === "deploy")
      return "Place your units in the yellow formation blocks — watch each unit's cost and your points left.";
    if (this.phase !== "player") return null;
    if (this.tutZone && this.tutZone.size) {
      // movement drill: show how many are on the green
      const blue = this.units.filter((u) => !u.dead && u.team === "blue");
      const onGreen = blue.filter((u) => this.tutZone.has(key(u.tx, u.ty))).length;
      if (onGreen < blue.length)
        return tr(
          "{on} of {all} on the green. Tap a unit, then a glowing green tile to march it there — get them all onto the green.",
          { on: onGreen, all: blue.length },
        );
    }
    if (this.orderMode === "march")
      return "Tap a destination to march your whole un-moved line there (Formation Order).";
    if (this.mode === "act" && this.selected)
      return "Targets in range glow red. Tap once to preview the damage, tap again to strike.";
    if (this.selected)
      return "Yellow highlights show where this unit can move (up, down, left, right). Tap a square to move or a red enemy to attack; tap the unit again to read its stats.";
    return "Tap one of your units to give it orders. Drag the map — or use the arrow keys — to look around.";
  }
  // What the React layer MUST see for the battle to move on: the phase (incl. the victory / defeat card), the
  // mid-battle dialogue the AI and the script pause on, the "skip this strike?" prompt, and the one-shot banners.
  _uiSignature() {
    return [
      this.phase,
      this.battleEvent ? this.battleEvent.id || 1 : 0,
      this.pendingSkip ? 1 : 0,
      this.wave ? this.wave.id || 1 : 0,
      this.turnBanner ? this.turnBanner.id || 1 : 0,
    ].join("|");
  }
  // Called by the loop every frame: if any of those changed without an _emit (a path that set the state and forgot
  // to publish it), publish now — the screen can lag at most one frame, never hang on an invisible dialogue.
  _uiGuard() {
    if (this.onState && this._uiSignature() !== this._uiSig) this._emit();
  }
  // Publish the battle's state to the UI (onState → ui/ReignOfSwords.jsx). This object is the whole engine → React
  // contract: the screen renders only what is here, and calls the controller for every action.
  _emit() {
    this._uiSig = this._uiSignature();
    if ((this.phase === "victory" || this.phase === "defeat") && !this._endSfx) {
      this._endSfx = true;
      this.audio.play(this.phase, 0.6);
    }
    const peek = !!(this.inspect && this.inspect.peek); // right-click / long-press read-out wins over the selection
    const sel = peek ? null : this.selected;
    const raid = this.mission.group === "skirmish" || this.mission.group === "siege"; // raids = game modes 2/3, the only Medal source
    this.onState({
      phase: this.phase,
      turn: this.turn,
      turnLimit: this.mission.turnLimit,
      major: raid && this.phase === "victory" && !!this.majorVictory, // a raid Major Victory → +1 Medal (checkOutcome 3)
      medal: raid && this.phase !== "deploy" ? this.medalStatus() : null, // live Major-Victory tracker (raids only)
      wave: this.wave || null, // one-shot reinforcement banner (id changes per wave)
      turnBanner: this.turnBanner || null, // one-shot whose-turn announcement (id changes per turn)
      hotseat: this._hotseatView(), // two players on one device: names, who's up, the handover, the winner
      battleEvent: this.battleEvent || null, // mid-battle dialogue lines (id changes per round)
      musterHeld: !!this._musterHeld, // the muster's opening waits for the "Previous Setup Found" answer
      blue: this.units.filter((u) => !u.dead && u.team === "blue").length,
      red: this.units.filter((u) => !u.dead && u.team === "red").length,
      canEnd: this.phase === "player" && !this.anim && !this.marchQueue,
      canUndo: this.canUndo(),
      canHold: this.canHold(), // the selected unit can end its turn where it stands (Hold)
      defeatReason: this.phase === "defeat" ? this.defeatReason || null : null,
      canOrder: this.canOrder(),
      orderMode: this.orderMode || null,
      canAim: this.canAim(),
      aimMode: !!this.aimMode,
      aimSkills: this.aimSkills(), // shared in-battle skill row (wizard spells / Grapeshot / Barrage)
      aimActive: this.aimActive(), // which of those is currently armed
      marching: !!this.marchQueue,
      autopilot: this.autopilot || null,
      unmoved:
        this.phase === "player"
          ? this.units.filter((u) => !u.dead && u.team === "blue" && !u.ally && !u.acted).length
          : 0,
      selected: sel ? this._selectedView(sel) : null,
      inspect: !sel && this.inspect ? this._inspectView(this.inspect.unit) : null,
      tileInfo: !sel && !this.inspect && this.tileInfo ? this.tileInfo : null,
      mode: this.mode,
      // "end its turn without attacking / healing?" modal
      confirmSkip: this.pendingSkip ? { name: this.pendingSkip.T.name, heal: this.pendingSkipKind === "heal" } : null,
      hint: this._hint(),
      notice: this.notice || null, // one-shot message toast (id changes per notice)
      mission: {
        mapId: this.mission.mapId,
        kingdom: this.mission.kingdom,
        name: this.mission.name,
        subtitle: this.mission.subtitle,
        group: this.mission.group,
        briefing: this.mission.briefing,
        objectiveText: this.mission.objectiveText,
        index: this.missionIndex,
        cols: this.mission.cols,
        rows: this.mission.rows,
      },
      escape: this.escapeStatus(), // escape missions: escaped / lost / how many may still fall
      objectives: this._objectivesView(),
      deploy: this.mission.deploy && this.phase === "deploy" ? this._deployView() : null,
    });
  }

  // The selected unit's card (ui/battle/UnitCard.jsx SelectedUnit).
  _selectedView(unit) {
    const spell = unit.T.canLightning ? this._spellDisplay(unit) : null; // wizard: show the SELECTED spell, not always Fireball
    return {
      ground: this._groundView(unit), // the tile it stands on and what that does to it (engine/input.js)
      id: unit.id,
      name: unit.T.name,
      type: unit.type,
      hp: shownHp(unit.hp),
      move: unit.T.move,
      atk: unit.T.atk,
      range: spell ? spell.max : unit.T.range,
      kind: unit.T.kind,
      hero: unit.hero,
      cost: DEPLOY_COST[unit.type] || null, // the game's own "relative power" indicator (Deployment Cost, strings 488/489)
      def: Math.round((unit.T.def || 0) * 100),
      minRange: spell ? spell.min : unit.T.minRange || 1,
      projectile: unit.T.projectile || null,
      weapon: (spell ? spell.name : unit.T.weaponName) || null,
      weaponDesc: spell ? null : unit.T.weaponDesc || null,
      weapons: unit.T.weaponSlots || null, // every weapon slot, as the original's View Unit lists them
      armour: unit.T.armourName || null,
      rating: unit.T.rating || null,
      ability: (spell ? spell.ability : unit.T.ability) || null,
      magic: !!unit.T.magic,
      heal: !!unit.T.heal,
      ambush: !!unit.ambush,
      grapeshot: !!unit.T.grapeshot,
      retribution: !!(unit.T.prayer && !unit.acted), // Priest can invoke Retribution (3rd Prayer option)
      // once a turn (the shifted flag Unit+0x27c — Undo clears it again)
      shapeshift:
        !unit.acted && unit.T.shapeshiftForms && unit._shiftTurn !== this.turn ? unit.T.shapeshiftForms : null,
      shapeshiftBlocked: !!unit.T.shapeshiftForms && !this._canShapeshiftHere(unit), // over water / cliffs: greyed out
      canLightning: !!unit.T.canLightning,
      spell: unit.T.canLightning ? unit.spell || "fireball" : null,
      formation: !!unit.T.formation,
      formationAllies: unit.T.formation ? this.formationAllies(unit) : 0, // live Formation cover
      statuses: this._statusesOf(unit), // active buff/debuff effects, with descriptions
      charge: unit.T.hasCharge ? this._chargeState(unit) : null, // idle / ready / short (run-up used the movement)
      autoCharge: this._autoChargeOn(), // off: the ⚡ Charge button charges (the card's hint says so)
      chargeOffer: !this._autoChargeOn() && this.chargeTargets(unit).length > 0, // the ⚡ Charge button is offered
      chargeMode: !!this.chargeMode && this.selected === unit, // …and pressed
      chargeMove: unit.T.hasCharge ? this.moveOf(unit) : 0,
    };
  }

  // A tapped unit's readout (threat range + who they are): name, HP, kit and abilities — so you can scout what a
  // foe does before you engage it (ui/battle/UnitCard.jsx InspectedUnit).
  _inspectView(e) {
    const isAlly = e.team === "blue" && e.ally;
    const group = e.team === "red" || isAlly ? this._groupMeta(e) : null;
    const fcol = e.team === "red" || isAlly ? `rgb(${this._factionColor(e)})` : null;
    return {
      ground: this._groundView(e), // the tile it stands on and what that does to it (engine/input.js)
      id: e.id,
      name: e.T.name,
      type: e.type,
      hp: shownHp(e.hp),
      move: e.T.move,
      atk: e.T.atk,
      range: e.T.range,
      minRange: e.T.minRange || 1,
      kind: e.T.kind,
      hero: e.hero,
      foe: e.team === "red",
      ally: isAlly,
      acted: !!e.acted,
      faction: group ? group.name : isAlly ? "Allied Army" : null,
      factionColor: fcol,
      cost: DEPLOY_COST[e.type] || null,
      def: Math.round((e.T.def || 0) * 100),
      weapon: e.T.weaponName || null,
      weaponDesc: e.T.weaponDesc || null,
      weapons: e.T.weaponSlots || null,
      armour: e.T.armourName || null,
      rating: e.T.rating || null,
      formation: !!e.T.formation,
      formationAllies: e.T.formation ? this.formationAllies(e) : 0, // live Formation cover of the scouted unit
      ability: e.T.ability || null,
      charge: !!e.T.hasCharge, // a charger: the card explains the Charge with its own icon
      magic: !!e.T.magic,
      heal: !!e.T.heal,
      statuses: this._statusesOf(e),
    };
  }

  // The objective standing: capture areas held (a hold / conquer mission) or objective points controlled, and
  // whether your side has the morale bonus.
  _objectivesView() {
    if (this.captureAreas.length)
      return {
        total: this.captureAreas.length,
        held: this.captureAreas.filter((a) => a.owner === "blue").length,
        morale: this.hasMorale("blue"),
      };
    return { total: this.objectives.length, held: this.controlled("blue"), morale: this.hasMorale("blue") };
  }

  // The muster panel (ui/battle/DeployPanel.jsx): points, elite slots and the roster with what's left to place.
  _deployView() {
    return {
      budget: this.deployBudget(),
      spent: this.deploySpent(),
      placing: this.placing,
      placed: this.units.filter((u) => u.team === "blue" && !u.hero && !u.ally).length, // YOUR own mustered units (allies don't count toward "start allowed")
      eliteMax: this.maxElite(),
      eliteUsed: this.eliteCount(), // medals: how many elite slots are spent vs the cap
      roster: (this._rosterOrder || []).map((type) => {
        const entry = this.rosterMap[type];
        return {
          type,
          name: UNIT_TYPES[type].name,
          cost: entry.cost,
          elite: !!entry.elite,
          kind: UNIT_TYPES[type].kind,
          count: entry.count,
          left: entry.count == null ? null : Math.max(0, entry.count - this.placedCount(type)),
          affordable: this.canAfford(type),
        };
      }),
    };
  }

  // --- render (under camera translate) ---
  // --- render --- the draw methods + unit-colour logic live in render/render.js (copied onto Game.prototype below the class).

  destroy() {
    cancelAnimationFrame(this._raf);
    if (this._bgTimer) {
      clearInterval(this._bgTimer);
      this._bgTimer = null;
    }
    if (this._onVis && typeof document !== "undefined") document.removeEventListener("visibilitychange", this._onVis);
    if (this.audio.stopAmbient) this.audio.stopAmbient();
    this.canvas.removeEventListener("pointerdown", this._onDown);
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onUp);
    this.canvas.removeEventListener("pointerleave", this._onLeave);
    if (this._onContext) this.canvas.removeEventListener("contextmenu", this._onContext);
    clearTimeout(this._holdT);
    this.canvas.removeEventListener("keydown", this._onKey);
  }
}

// ---- assemble the Game ----------------------------------------------------
// Game is ONE class whose methods are spread over several files by concern (README "The Game object"). Each file
// exports its methods as a class or a plain object; here they are all copied onto Game.prototype, so every method
// runs with `this` = the live battle. A name defined twice would silently shadow the other one — that is an error.
const MIXINS = {
  GridMethods, // engine/grid.js — tiles, movement, reach, targets
  InputMethods, // engine/input.js — taps, selection, moving units
  TurnFlowMethods, // engine/turnflow.js — turns, phases, win / lose
  DeployMethods, // engine/deploy.js — muster and battle start
  HotseatMethods, // engine/hotseat.js — two players on one device (skirmish maps)
  OnlineMethods, // engine/online.js — the same battle between two devices (live moves, stored turns)
  LoopMethods, // engine/loop.js — the per-frame update
  DebugMethods, // engine/debug.js — bug-report snapshots
  CombatMethods, // rules/combat.js — damage, counters, charges, projectiles, spells
  AbilityMethods, // rules/abilities.js — Episode II skills, Spirit Shroud, leashing
};
mixInto(Game, MIXINS);
export { Game, mixInto }; // the engine class itself — the unit tests build battles with it (src/reign-of-swords/__tests__)

export async function mountReign(container, { base, spriteBase, onState, muted, sfxMuted, musicMuted, army, godArmy }) {
  const canvas = container.querySelector("canvas");
  // `base` supplies the DATA (levels.json / terrain / heraldry per episode); `spriteBase` supplies the shared
  // ASSETS (sprites / fx / audio). Episode II points base at its own dir but reuses Episode I's asset dir, so the
  // asset library isn't duplicated. Defaults to base (Episode I, where they're the same dir).
  const artBase = spriteBase || base;
  await loadLevels(base); // build the real battles for THIS episode
  const assets = await loadAssetsShared(artBase, base); // sprites/fx from the shared dir (ab); tileset from the EPISODE data dir (base) — cached for the session
  const audio = new AudioManager(artBase);
  audio.setSfxMuted(sfxMuted != null ? !!sfxMuted : !!muted); // separate Music / Effects mutes (muted = legacy "both")
  audio.setMusicMuted(musicMuted != null ? !!musicMuted : !!muted);
  // Start the battle music as soon as its clip is loaded — so it begins at the very start of the mission (the
  // deploy screen), not on the player's first click. The browser already has activation from the menu/campaign
  // clicks, so a fresh AudioContext can resume here; the pointerdown handler is a fallback if it can't. Each
  // battle is a fresh instance, so the track always starts from its beginning (0:00).
  audio.preload().then(() => {
    try {
      audio.startAmbient();
    } catch (e) {}
  });
  const game = new Game(canvas, assets, onState, audio, army, godArmy);
  game.freshSeeds = true; // real play: fresh dice for each battle and each retry (online / Battle Lab set their own)
  if (import.meta.env && import.meta.env.DEV) window.__reign = game;
  const onResize = () => game.resize();
  window.addEventListener("resize", onResize);
  const unlock = () => {
    audio._ensure();
    if (audio.ctx && audio.ctx.state === "running") {
      // music is owned by the shell (<audio> loop); here we only unlock SFX
      for (const evName of ["pointerdown", "click", "keydown", "touchstart"])
        document.removeEventListener(evName, unlock);
    }
  };
  for (const evName of ["pointerdown", "click", "keydown", "touchstart"]) document.addEventListener(evName, unlock);
  return {
    game,
    missions: missionList(),
    endTurn: () => game.endTurn(),
    undoMove: () => game.undoMove(),
    holdUnit: () => game.holdUnit(),
    nextUnit: () => game.selectNextUnit(),
    beginMarch: () => game.beginMarch(),
    cancelOrder: () => game.cancelOrder(),
    toggleAim: () => game.toggleAim(), // #15: free-pick AOE targeting for the selected area weapon
    cancelAim: () => game.cancelAim(),
    aimSkill: (id) => game.aimSkill(id), // shared skill row — arm a wizard spell / cannon Grapeshot / catapult Barrage
    setRetribPreview: (on) => game.setRetribPreview(on), // #5: preview the Retribution radius on button hover
    shapeshift: (form) => game.shapeshiftSelected(form),
    setSpell: (sp) => game.setSpell(sp),
    invokeRetribution: () => game.invokeRetribution(),
    invokeShield: () => game.invokeShield(),
    toggleCharge: () => game.toggleCharge(), // ⚡ Charge (Auto-charge off): arm / disarm the Charge action
    confirmSkip: () => game.confirmSkip(), // "end this unit's turn without striking?" — yes
    cancelSkip: () => game.cancelSkip(), // ...no, go back and let it attack
    casualtyReport: () => game.casualtyReport(),
    debugDump: () => game.debugDump(),
    reset: () => game.reset(),
    setPlacing: (t) => game.setPlacing(t),
    startBattle: () => game.startBattle(),
    setHotseat: (on) => game.setHotseat(on), // two players on one device (engine/hotseat.js) — set before selectMission
    setHotseatOptions: (opts) => game.setHotseatOptions(opts), // names, budget, first move — applied on the next reset
    hotseatContinue: () => game.hotseatContinue(), // the next player took the device: their muster / turn begins
    openBattle: () => game.openBattle(),
    setMusterHold: (fn) => (game.musterHold = fn), // (mapId) => true: the muster's opening waits (releaseMuster)
    releaseMuster: () => game.releaseMuster(),
    eventClosed: () => game.eventClosed(),
    shownLines: () => game.shownLines(), // dialogue already read in this battle (the result cutscene skips it)
    focusEventLine: (idx) => game.focusEventLine(idx), // op2 CAMERA: pan to the current dialogue line's focus
    setFastForward: (on) => game.setFastForward(on),
    setAutopilot: (strategy) => game.setAutopilot(strategy), // 🤖 the AI plays your turns (ai/autopilot.js)
    setInputLocked: (on) => game.setInputLocked(on),
    selectMission: (i) => game.selectMission(i),
    setMuted: (m) => audio.setMuted(m),
    setSfxMuted: (m) => audio.setSfxMuted(m),
    setMusicMuted: (m) => audio.setMusicMuted(m),
    nextTrack: () => audio.nextTrack(),
    destroy: () => {
      window.removeEventListener("resize", onResize);
      for (const evName of ["pointerdown", "click", "keydown", "touchstart"])
        document.removeEventListener(evName, unlock);
      game.destroy();
      audio.dispose();
    },
  };
}

export function rosterSummary(list) {
  const counts = {};
  for (const [unitType] of list) counts[unitType] = (counts[unitType] || 0) + 1;
  return Object.entries(counts).map(([type, n]) => ({ type, n, name: UNIT_TYPES[type].name }));
}
