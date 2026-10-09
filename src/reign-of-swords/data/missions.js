/* ============================================================
   Reign of Swords — the mission / level data layer.
   Everything that turns a decoded scenario record (levels.json) into a playable
   mission: the deploy-roster economy, the varied win-conditions, the fixed-force
   tutorial armies, the per-level build (buildMissionFromLevel), the runtime
   skirmish-army generator, and the async fetch+build (buildMissions). Pure data
   + pure functions — NO Game state, NO module globals. The engine keeps the episode's
   MISSIONS list (each Game its own this.mission) and calls buildMissions(base) to fill it, so a
   different episode is served by pointing `base` at its own asset directory.
   Only leaf data/geometry is imported (util/util RNG, rules/terrain tiles, data/game-data
   costs/HP bands). ============================================================ */

import { makeRng } from "../util/util.js";
import { tileProp, setTerrain, setTerrainTypes, setStructures, setMovement } from "../rules/terrain.js";
import { DEPLOY_COST, ALLY_HP, ENEMY_HP, levelTitle } from "./game-data.js";

// ---- Deployment roster -------------------------------------------------
// Real per-unit deploy points (unit table 5010); elites per DEPLOY_ELITE below. In campaign play the roster is the
// player's OWNED army (from the Upgrade screen), Heroes included; DEPLOY_ROSTER is the standalone default.
// Ep2 units the player can field once upgraded into them (Field Manual tree): Craftsmen, Ballistae, Conjurer,
// Dune Sirens, Blood Gorgers. Sapper /
// Bodyguard are CONJURED in battle, never mustered, so they stay out of the roster. Without these in DEPLOY_ORDER
// an owned Ep2 unit was silently dropped from the muster roster → "can't place new units in Ep2".
// ELITE units (help 826 "TOO MANY ELITES: You may only deploy 1 Elite unit per 1000 deployment points") are exactly the
// unit types UnitSelector::placeCurrent (iOS Ep2 @0x8154a) tests before spending an elite slot: 21 Wizards, 8 Hero,
// 9 Griffon Riders, 25 Cannon, 30 Ballistae, 31 Conjurer. Catapults, trebuchets, knights, cavalry, rangers, druids and
// priests are NOT elite (the siege drill's 900 points buy its three catapults and no elite at all).
export const DEPLOY_ELITE = { wizards: true, king: true, griffon: true, cannon: true, ballistae: true, conjurer: true };
export const DEPLOY_ORDER = [
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
  "king",
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
  "craftsmen",
  "bloodgorgers",
  "dunesirens",
  "ballistae",
  "conjurer",
];
// entries: [key, cost, count(null=unlimited), elite]
export const DEPLOY_ROSTER = DEPLOY_ORDER.map((k) => [k, DEPLOY_COST[k], null, !!DEPLOY_ELITE[k]]);

// ---- Fixed-force tutorial armies — the REAL preset units & positions ---------
// (5700/5701/5703 → maps 5800/5801/5803), team-split by the record's team names.
// Movement tutorial (5800) has 7 player units and no enemy; Combat (5801) is 8 vs
// 9 Brigands; Tutorial 4 (5803) is your 11 against the rebels' 10. No Hero is spawned in
// any of them. entries: [unitKey, x, y]. (Deployment tutorial 5802 keeps its muster.)
export const TUTORIAL_FORCES = {
  // Movement drill: the record's DEPLOY-START spawns (script actions 0-6, record 5700), north of the castle green;
  // the player marches them down into the 3×3 objective area (tag-9 goal trigger, see drillGoalOf).
  5800: {
    blue: [
      ["footmen", 9, 3],
      ["pikemen", 8, 5],
      ["pikemen", 11, 4],
      ["footmen", 10, 5],
      ["crossbowmen", 7, 5],
      ["pikemen", 8, 6],
      ["footmen", 10, 3],
    ],
    red: [],
  },
  5801: {
    blue: [
      ["footmen", 15, 10],
      ["footmen", 15, 11],
      ["footmen", 15, 12],
      ["crossbowmen", 16, 11],
      ["knights", 13, 11],
      ["pikemen", 14, 10],
      ["pikemen", 14, 11],
      ["pikemen", 14, 12],
    ],
    red: [
      ["militiamen", 9, 7],
      ["militiamen", 8, 7],
      ["footmen", 7, 6],
      ["militiamen", 8, 6],
      ["militiamen", 7, 9],
      ["militiamen", 8, 8],
      ["militiamen", 9, 8],
      ["militiamen", 6, 7],
      ["footmen", 7, 7],
    ],
  },
  // Tutorial 4: YOU are the Carrone Army (the record's team 1 — "We have crossbowmen and catapults well placed on the
  // ridge…"), holding the east against the Rebel Army's ten (team 0) in the west corner.
  5803: {
    blue: [
      ["cavalry", 11, 8],
      ["knights", 12, 7],
      ["cavalry", 13, 6],
      ["pikemen", 12, 3],
      ["pikemen", 12, 4],
      ["pikemen", 12, 5],
      ["footmen", 13, 3],
      ["footmen", 13, 4],
      ["footmen", 13, 5],
      ["crossbowmen", 6, 8],
      ["catapult", 6, 9],
    ],
    red: [
      ["swordsmen", 1, 1],
      ["swordsmen", 1, 2],
      ["swordsmen", 1, 3],
      ["footmen", 2, 1],
      ["footmen", 2, 2],
      ["footmen", 2, 3],
      ["militiamen", 4, 2],
      ["militiamen", 4, 3],
      ["militiamen", 4, 4],
      ["knights", 0, 2],
    ],
  },
};

export function fallbackMission() {
  const cols = 15,
    rows = 10,
    tiles = new Array(cols * rows).fill(63); // all grass
  const zone = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < 4; x++) zone.push([x, y]);
  return {
    id: "field",
    group: "skirmish",
    kingdom: "Skirmish",
    name: "Open Field",
    subtitle: "",
    objectiveText: "Destroy the enemy — keep your Hero alive.",
    cols,
    rows,
    turnLimit: 20,
    tiles,
    objectives: [[7, 4]],
    red: [
      ["spearman", 12, 3],
      ["archer", 13, 5],
      ["knight", 13, 4],
      ["axeman", 11, 6],
    ],
    deploy: { budget: 700, zone, hero: ["king", 1, 5], roster: DEPLOY_ROSTER },
  };
}

// Build a mission from a decoded level. The battle data is REAL — carved from
// the original iOS data file (reignofswords.dat): the terrain grid, the enemy
// army composition (and, where the record stores them, its exact tile
// positions), the turn limit, and the objective text. The deployment budget is
// the enemy army's own total cost in the game's REAL per-unit deployment points
// (from the unit table), so the sides are matched by the game's own numbers.
const GROUP_TITLE = { story: "Campaign", siege: "Raid", skirmish: "Battlefield", special: "Tutorial" };

// The 37 symmetric skirmishes store NO fixed enemy — the original builds each side at RUNTIME by having
// the AI buy units from a points budget. This reproduces that: it spends the level's REAL budget through
// the REAL deploy economy (real per-unit costs from table 5010, the 1-elite-per-1000 cap), so the army's
// size & make-up come from the game's own numbers, not a hand-picked theme. Seeded by mapId → deterministic.
function skirmishArmy(level, farCells) {
  const budget = level.enemyBudget || level.budget || 3000,
    eliteMax = Math.max(1, Math.floor(budget / 1000));
  const random = makeRng(((level.mapId || 1) * 2654435761) >>> 0);
  const CHEAP = ["militiamen", "footmen", "pikemen", "archers", "swordsmen", "crossbowmen", "halberdiers"];
  const ELITE = ["knights", "cavalry", "musketeers", "greatswordsmen", "catapult"];
  const cheapest = CHEAP.reduce((a, b) => (DEPLOY_COST[b] < DEPLOY_COST[a] ? b : a));
  const types = [];
  let spent = 0,
    elites = 0,
    guard = 0;
  while (elites < eliteMax && spent < budget * 0.45) {
    const type = ELITE[(random() * ELITE.length) | 0];
    if (spent + DEPLOY_COST[type] > budget) break;
    types.push(type);
    spent += DEPLOY_COST[type];
    elites++;
  }
  while (spent + DEPLOY_COST[cheapest] <= budget && guard++ < 400) {
    const type = CHEAP[(random() * CHEAP.length) | 0],
      cost = DEPLOY_COST[type];
    if (spent + cost <= budget) {
      types.push(type);
      spent += cost;
    } else {
      types.push(cheapest);
      spent += DEPLOY_COST[cheapest];
    }
  }
  // The bought army is the map's enemy group: carry its global group index (groupOrder) so the per-group turn
  // cycle runs it — without it the army sat in group 0 (the player's slot) and never took a turn.
  const enemyGroup = (level.groupOrder || []).find((g) => g.side === "enemy");
  const out = [];
  for (let i = 0; i < types.length && i < farCells.length; i++)
    out.push([types[i], farCells[i][0], farCells[i][1], 0, enemyGroup ? enemyGroup.gi : undefined]);
  return out;
}

// CAPTURE AREAS (GameScreen::updateCapturePoints, Ep1 @0x18a2a / Ep2 @0x1d4d2): only a mission of header type 1
// ("hold") or 2 ("conquer") keeps score over the record's areas; every other type ignores them. Each area has an
// owner and a flag on its FIRST tile (Map::tag on area.tiles[0]).
function captureOf(level) {
  const mode = level.missionType === 1 || level.missionType === 2 ? level.missionType : 0;
  const areas = mode ? (level.areas || []).map((a) => a.tiles || []).filter((t) => t.length) : [];
  return { captureMode: areas.length ? mode : 0, captureAreas: areas };
}

// FALLBACK deploy band — a safety net: every deploy mission in both episodes' data lists its deploy tiles (marker
// section A, tools/ros/export_levels.py), but a record without them would leave the player nowhere to muster. Then
// generate a band of passable ground on the side FARTHEST from the enemy (or the bottom rows if no enemy is placed).
function fallbackDeployZone(level, red) {
  const pass = [];
  for (let y = 0; y < level.rows; y++)
    for (let x = 0; x < level.cols; x++) if (tileProp(level.tiles[y * level.cols + x]).passable) pass.push([x, y]);
  if (red.length) {
    const enemyX = red.reduce((s, r) => s + r[1], 0) / red.length,
      enemyY = red.reduce((s, r) => s + r[2], 0) / red.length;
    pass.sort(
      (a, b) => Math.abs(b[0] - enemyX) + Math.abs(b[1] - enemyY) - (Math.abs(a[0] - enemyX) + Math.abs(a[1] - enemyY)),
    );
  } else pass.sort((a, b) => b[1] - a[1]);
  return pass.slice(0, Math.min(48, pass.length));
}

// The Hero's tile as [x, y]. L.hero is [type, x, y] (Ep2 exporter) or [x, y]; off the map or absent → the first
// deploy tile, else the left edge mid-height.
function heroTile(level, zone, inBounds) {
  const given =
    level.hero && level.hero.length >= 3
      ? [level.hero[1], level.hero[2]]
      : Array.isArray(level.hero)
        ? level.hero
        : null;
  return given && inBounds(given[0], given[1]) ? given : zone[0] || [1, Math.floor(level.rows / 2)];
}

// THE MOVEMENT DRILL'S GOAL — the record's goal trigger (tag 9 [count, area, cmd]; GameScreen::checkLocationTriggers'
// "CHECKING GOAL TRIGGERS", iOS Ep2 @0x27462 / Android a_g d()): once `count` of your units STAND in objective area
// `area`, command `cmd` plays (5800: "Very good, Commander. Men of Carrone!…", whose last screen leaves the battle —
// the drill is done). Null when the level has none.
function drillGoalOf(level) {
  const sc = level.script;
  const trig = sc && (sc.triggers || []).find((t) => t.tag === 9);
  const area = trig && (level.areas || [])[trig.a[1]];
  if (!area || !area.tiles || !area.tiles.length) return null;
  const lines = [];
  for (let i = trig.a[2], guard = 0; i >= 0 && i < sc.actions.length && guard < 40; guard++) {
    lines.push(...(sc.actions[i].lines || []));
    i = sc.actions[i].next;
  }
  return { count: trig.a[0], tiles: area.tiles, lines };
}

// Fixed-force missions: the original's scripted tutorials hand you a preset squad already arrayed on the field and
// SKIP deployment. BOTH armies are the real spawn data (TUTORIAL_FORCES). 5802 is the exception — it teaches
// deploy, so it keeps it.
function tutorialMission(level, forces, objectives, objectiveText, zone) {
  const inbf = ([, x, y]) => x >= 0 && y >= 0 && y < level.rows && x < level.cols;
  const blue = forces.blue.filter(inbf).map(([k, x, y]) => [k, x, y, 0]);
  const redF = forces.red.filter(inbf).map(([k, x, y]) => [k, x, y, 0]);
  const noEnemy = redF.length === 0;
  return {
    markers: level.markers || [], // scenario marker table [x, y, group, team] → the original's AI groups (ai/grouplogic.js)
    id: `b${level.bid}`,
    group: level.group,
    kingdom: level.kingdom || "Tutorial",
    name: level.name || `Tutorial ${level.mapId}`,
    subtitle: level.subtitle || "",
    mapId: level.mapId,
    objectiveText,
    briefing: noEnemy
      ? `${objectiveText} Your column is already drawn up — practise moving it. Drag the map or use the arrow keys to survey the field.`
      : `${objectiveText} Your squad is already drawn up for battle — no deployment this time. Drag the map or use the arrow keys to survey the field.`,
    cols: level.cols,
    rows: level.rows,
    turnLimit: level.turnLimit || 24,
    tiles: level.tiles,
    ep: level.ep || 1, // the episode (Ep1-only rules, e.g. the braced Pike Wall's +30, check it)
    objectives,
    objectiveAreas: (level.areas || []).map((a) => a.tiles || []), // the record's capture areas (tile lists) — one flag each
    ...captureOf(level),
    red: redF,
    blue,
    noEnemy,
    events: level.events || null, // dialogue carried inline (the Ep1 movement drill on loan to Ep2)
    // The green "assemble here" guide (and its goal + hint) is ONLY the no-enemy MOVEMENT drill (5800): the record's
    // objective area. Combat tutorials (5801, with a real enemy) win by fighting, not by standing on green.
    ...(() => {
      const goal = noEnemy ? drillGoalOf(level) : null;
      return {
        tutZone: noEnemy ? (goal ? goal.tiles : zone) : null,
        drillGoal: goal,
        // out of turns: the record's VICTORY sequence (tag 4) — Sir Anston's "Perhaps your days as a squire…" — then
        // the drill ends (its screen leaves the battle)
        timeoutLines: noEnemy && goal ? level.victoryLines || null : null,
      };
    })(),
  };
}

// A generated skirmish splits the deploy band: the half farthest from the Hero is the enemy's (filled by
// skirmishArmy), the near half plus the Hero's tile the player's muster.
function splitSkirmishField(level, zone, hero) {
  const passable = zone.filter(([x, y]) => tileProp(level.tiles[y * level.cols + x]).passable);
  const dist = (c) => Math.abs(c[0] - hero[0]) + Math.abs(c[1] - hero[1]);
  const byFar = passable.slice().sort((a, b) => dist(b) - dist(a));
  const half = Math.max(1, Math.floor(byFar.length / 2));
  const farCells = byFar.slice(0, half); // enemy side (far from the hero)
  return {
    red: skirmishArmy(level, farCells),
    playZone: byFar.slice(half).concat([[hero[0], hero[1]]]), // player musters near the hero
  };
}

// A fast lookup by global group index (groupByGi) and the HP "unit strength colour" per group (hpByGi): player
// green, allied groups Blue/Cyan… by turn order, enemy groups Red/Orange/Yellow… by turn order (the game's
// ally=Green/Blue/Cyan, enemy=Red/Orange/Yellow rule).
function assignGroupColours(mission) {
  mission.groupByGi = {};
  const allyGis = [],
    enemyGis = [];
  for (const g of mission.groupOrder) {
    mission.groupByGi[g.gi] = g;
    if (g.side === "ally") allyGis.push(g.gi);
    else if (g.side === "enemy") enemyGis.push(g.gi);
  }
  allyGis.sort((a, b) => a - b);
  enemyGis.sort((a, b) => a - b);
  mission.hpByGi = {};
  if (mission.playerGroup != null) mission.hpByGi[mission.playerGroup] = ALLY_HP[0];
  allyGis.forEach((gi, k) => {
    mission.hpByGi[gi] = ALLY_HP[(k + 1) % ALLY_HP.length];
  });
  enemyGis.forEach((gi, k) => {
    mission.hpByGi[gi] = ENEMY_HP[k % ENEMY_HP.length];
  });
}

// One playable mission from a level record (levels.json): the map, both armies, the objective and briefing text,
// the deploy phase (budget, zone, roster), turn order and colours, and the scenario script.
export function buildMissionFromLevel(level) {
  const inBounds = (x, y) => x >= 0 && y >= 0 && y < level.rows && x < level.cols;
  const objectives = (level.objectives || []).filter(([x, y]) => inBounds(x, y));
  const red = (level.enemy || []).filter(([, x, y]) => inBounds(x, y));
  let zone = (level.deployZone || []).filter(([x, y]) => inBounds(x, y));
  if (!zone.length && level.tiles) zone = fallbackDeployZone(level, red);
  const hero = heroTile(level, zone, inBounds); // `hero` is [x, y] throughout
  const parts = (level.subtitle || "").split(" vs ");
  const ours = parts[0] || "Your legion",
    foe = parts[1] || "the enemy";
  const objectiveText =
    level.objectiveText ||
    (objectives.length ? "Capture and hold the objective area." : "Destroy the opponent's army.");
  const briefing = `${ours}${foe && foe !== "the enemy" ? ` face ${foe}` : " take the field"}. ${objectiveText} Drag the battlefield — or use the arrow keys — to survey the whole map before you march.`;
  // Hand-reconstructed tutorial forces only stand in when a level carries no decoded script (the Ep2 export puts the
  // real record spawns in every level, and slot 5800 there is the campaign prologue, not the movement drill).
  const forces = level.ep === 2 ? null : TUTORIAL_FORCES[level.alias || level.mapId]; // `alias`: Ep1's movement drill lent to the Ep2 route as 5806
  if (forces) return tutorialMission(level, forces, objectives, objectiveText, zone);
  // Skirmishes are two kinds in the record: 5 store a REAL preset army (5204/5205/5206/5207/5218 —
  // handled exactly like campaign set-pieces below); the other 23 store only a gold budget and the
  // game builds each side at runtime. Only the empty ones are generated (via the real deploy economy).
  const skirmishGen = level.group === "skirmish" && !(level.enemy && level.enemy.length);
  let outRed = red,
    playZone = zone;
  if (skirmishGen) ({ red: outRed, playZone } = splitSkirmishField(level, zone, hero));
  // Campaign & raids use the REAL per-mission force model recovered from each scenario record:
  //   • player (team 0) preset units are PRE-PLACED at their real tiles;   • enemy = team 1;
  //   • the deploy budget is the player team's real gold (La/n team Z). The game stores NO
  //     persistent starter army (La/r.e()/the new-game reset zero it) — every force is issued
  //     per mission this way. gold 0 => a fixed-force set-piece (fight the preset squad as drawn
  //     up); gold > 0 => you deploy MORE from your carried army on top of any preset core.
  const preset = (skirmishGen ? [] : level.player || [])
    .filter(([, x, y]) => inBounds(x, y))
    .map(([k, x, y, , gi]) => [k, x, y, k === "king", gi]);
  const hasHero = preset.some((b) => b[3]);
  // Allied AI armies (real team-0 non-player groups from the scenario record — e.g. The Emperor, the
  // Carrone Legion, Duke Stokeshire). They fight on YOUR side but run their OWN AI, each with its own
  // banner/heraldry. entries: [key, x, y, allyGroupIdx]. You don't command them — you command only your
  // own group (the preset above + whatever you deploy from your budget).
  const allies = (skirmishGen ? [] : level.allies || [])
    .filter(([, x, y]) => inBounds(x, y))
    .map(([k, x, y, g, gi]) => [k, x, y, g || 0, gi]);
  const budget = skirmishGen ? level.budget || 800 : level.budget || 0;
  const noEnemy = outRed.length === 0; // a no-combat drill (deployment tutorial 5802) — don't instant-win on red=0
  const mission = {
    markers: level.markers || [], // scenario marker table [x, y, group, team] → the original's AI groups (ai/grouplogic.js)
    id: `b${level.bid}`,
    group: level.group,
    kingdom: level.kingdom || GROUP_TITLE[level.group] || "Battle",
    name: levelTitle(level) || `${level.group} ${level.mapId}`,
    subtitle: level.subtitle || "",
    mapId: level.mapId,
    briefing,
    objectiveText,
    wipedWins: !!level.wipedWins, // the map's DEFEAT sequence (tag 5) is its "we've escaped" victory (checkOutcome 0)
    events: level.events || null, // Ep1 tutorial-slot rules don't apply to Ep2's 58xx records
    cols: level.cols,
    rows: level.rows,
    turnLimit: level.turnLimit || 24,
    tiles: level.tiles,
    ep: level.ep || 1, // the episode (Ep1-only rules, e.g. the braced Pike Wall's +30, check it)
    objectives,
    objectiveAreas: (level.areas || []).map((a) => a.tiles || []), // the record's capture areas (tile lists) — one flag each
    ...captureOf(level),
    red: outRed,
    blue: preset,
    allies,
    noEnemy,
    enemyGroups: level.enemyGroups || null, // real per-faction names for the independent enemy armies on this map
    allyGroups: level.allyGroups || null, // real per-faction names for the independent ALLIED armies on this map
    enemyFirst: !!level.enemyFirst, // real turn order (team Y): the enemy opens this battle
    // REAL turn order (decompile La/g: aQ cycles over bg.J GROUPS): groups act in ascending global group
    // index, the player's own group interactive, every other group AI (ally if player's team, else enemy).
    // groupOrder = [{gi,name,banner,team,side}] in scenario order; playerGroup = the player's global gi.
    groupOrder: level.groupOrder || null,
    playerGroup: level.playerGroup == null ? null : level.playerGroup,
    heroFlee: level.heroFlee || null, // an ENEMY unit type that flees off the map at battle start (Marsur 1: the coward commander)
    missionType: level.missionType || 0, // header type: 3 = escape/escort (units reaching the goal area leave the field)
    hidden: !!level.hidden,
    script: level.script || null, // scenario script (kill / tile / counter triggers, escort) — engine/script.js
    portals: level.portals || null, // EPISODE II warp portals: [srcX,srcY,dstX,dstY] — a unit ending its move on a source tile warps to the dest (Wizard's Palace)
    siegePoints: level.siegePoints || null, // Mission+0x7c point list (loadMarkers section D): walls/gates the ALLIED siege engines bombard (AI state 15)
    sideBudgets: { player: level.budget || 0, enemy: level.enemyBudget || level.budget || 0 }, // each side's gold (hot-seat)
    spawnOrder: level.spawnOrder || null, // scenario op0 spawn order of the preset + allied units, where the two interleave (the unit list order)
  };
  if (mission.groupOrder) assignGroupColours(mission);
  // Deployment DRILL (the deployment tutorial 5802): no enemy, just a muster phase. Its purpose is to teach
  // placing units, so give it a real objective (the game's own DEPLOYMENT help) and complete it the moment the
  // muster is done — rather than the nonsensical "destroy the enemy" on an empty map.
  mission.deployDrill = noEnemy && level.group === "special" && (budget > 0 || preset.length === 0);
  if (mission.deployDrill) {
    mission.objectiveText =
      "Assemble your force — place each unit in the yellow formation blocks, mind your points, then press Fight.";
    mission.briefing = mission.objectiveText;
  }
  // A deploy phase when the mission grants a gold budget, or when there's no preset force to field.
  if (budget > 0 || preset.length === 0) {
    mission.deploy = { budget: budget || 800, zone: playZone, roster: DEPLOY_ROSTER };
    // No Hero is offered for hire: the muster lists only YOUR army (UnitSelector::loadUserArmy copies the saved unit
    // counts, both iOS binaries — no Hero is added), so you field a Hero only if you own one (a reward, or Knights
    // upgraded with a Medal). The old $500 "hero for hire" was an invention and is gone. The Hero still joins the
    // muster where the scenario pre-places one (a heroField or a preset king).
    if (!hasHero && (level.hero || skirmishGen)) mission.deploy.hero = ["king", hero[0], hero[1]];
  }
  // DEFENSIVE GARRISON (#14): "hold ground" is the real op-11 script (La/n.a([S)[S case 11 → unit.L.d=2), which
  // flags SPECIFIC units to defend rather than march out. The exact per-unit hold tiles are decoded from every
  // record and attached in buildMissions (mission.holdTiles); a unit spawned on one of those tiles anchors there.
  // No blanket "assault the keep" heuristic any more — a map holds only the units the original scripted. Radius
  // is how far a held unit will step to strike a foe before it must return to its post.
  mission.holdRadius = 6;
  return mission;
}

// Fetch the episode's data files under `base` and build the full mission list (with reinforcement waves,
// mid-battle dialogue, defensive-garrison/scripted-move scripts and per-group heraldry attached). Returns the
// built array, or null if the fetch/parse fails (the engine then keeps its fallback). Pure — sets no globals.
export async function buildMissions(base) {
  try {
    const [terr, data, wavesData, eventsData, aiData, heraldData, terrTypes, structs, movement] = await Promise.all([
      fetch(base + "terrain.json").then((r) => r.json()),
      fetch(base + "levels.json").then((r) => r.json()),
      fetch(base + "waves.json")
        .then((r) => r.json())
        .catch(() => ({})),
      fetch(base + "battle_events.json")
        .then((r) => r.json())
        .catch(() => ({})),
      fetch(base + "scripts_ai.json")
        .then((r) => r.json())
        .catch(() => ({})),
      fetch(base + "group_heraldry.json")
        .then((r) => r.json())
        .catch(() => ({})),
      // EPISODE II only: the real getTileType legend for the quicksand terrain gate. Ep1 has no such file
      // (fetch fails → null → quicksand never forms there, which is correct — it's an Ep2 ability).
      fetch(base + "terrain-types.json")
        .then((r) => r.json())
        .catch(() => null),
      // Both episodes: the destructible-structure table (armour, damage stages, rubble terrain) from record 5010.
      fetch(base + "structures.json")
        .then((r) => r.json())
        .catch(() => null),
      // Both episodes: the original's movement table (per-tile terrain type, per-class cost rows, step links).
      fetch(base + "movement.json")
        .then((r) => r.json())
        .catch(() => null),
    ]);
    if (terr && terr.props) setTerrain(terr.props, terr.cell, terr.cellH);
    setTerrainTypes(terrTypes && terrTypes.types, terrTypes && terrTypes.quicksandTypes);
    setStructures(structs);
    setMovement(movement);
    const built = data.levels.filter((L) => !L.hidden).map((L) => buildMissionFromLevel(L)); // placeholder slots stay out of the game
    // REAL reinforcement waves (waves.json, decoded from each record's triggered spawn-command chains):
    // at round R a triggered op-0 spawn chain drops a column onto the field (strings 1023/1024 "a column
    // has ridden in"). Attach per mission — the engine fires them at the matching side's phase start.
    built.forEach((m) => {
      m.waves = wavesData[m.mapId] || wavesData[String(m.mapId)] || null;
      // a map whose enemies arrive later (round waves / scripted ambushes) is NOT a no-enemy drill
      const scSpawns = m.script && m.script.actions.some((a, i) => a.op === 0 && !(m.script.initial || []).includes(i));
      if ((m.waves && m.waves.length) || scSpawns) m.noEnemy = false;
    });
    // REAL mid-battle dialogue events (battle_events.json, the triggered op-1 message chains, resolved to
    // resource-5009 screens → 5004 text): a line (sometimes several) fires at the top of round R — tactical
    // beats, enemy taunts, and the callouts that announce reinforcement columns arriving from a side.
    built.forEach((m) => {
      m.events = eventsData[m.mapId] || eventsData[String(m.mapId)] || m.events || null;
    }); // m.events: dialogue carried inline by a borrowed level
    // REAL defensive garrisons + scripted moves (scripts_ai.json, decoded from op-11 HOLD / op-3 MOVE commands):
    // holdTiles are the exact tiles the original flagged to stand ground; scriptedMoves reposition a unit at
    // battle start. Only units spawned on a holdTile hold — the rest of the army uses the default advancing AI.
    built.forEach((m) => {
      const aiInfo = aiData[m.mapId] || aiData[String(m.mapId)];
      if (aiInfo) {
        if (aiInfo.holdTiles && aiInfo.holdTiles.length) {
          m.holdTiles = aiInfo.holdTiles;
          m.enemyHold = true;
        }
        if (aiInfo.moves && aiInfo.moves.length) m.scriptedMoves = aiInfo.moves;
      }
    });
    // REAL per-group heraldry (group_heraldry.json, decoded from scenario group attrs: attrs[1]=field colour,
    // attrs[0]=symbol colour, attrs[2]=device, attrs[4]=banner). Merge onto every group object so _armyColor /
    // the turn banner render each faction's true field colour — universal, not just the banner-1..8 factions.
    // FACTION CHARGE: a scenario team with no device (byte 0xff -> symbol 0) borrows the charge its own faction flies
    // elsewhere in the episode — same faction name (first word) AND the same two tinctures. The original never draws an
    // enemy team's arms (Context::renderHeraldry is only called for the player's crest), so the scenario leaves some
    // devices blank; this keeps a faction's identity across maps. Hits two groups per episode: Bordavia 2's Valamir
    // Vanguard and Bordavia 1's Town Guard (via FACTION_ALIAS) take the azure griffin of Bordavia 3's Valamir Army.
    // Groups whose name doesn't carry their faction: Bordavia 1's "Town Guard" are Valamir's men (same azure-on-gules
    // arms) — user-directed, so it flies the Valamir griffin too. Keyed "mapId:group name" -> faction word.
    const FACTION_ALIAS = { "5409:Town Guard": "valamir" };
    const famOf = (h, mid) =>
      FACTION_ALIAS[mid + ":" + h.name] || ((h.name || "").trim().split(/\s+/)[0] || "").toLowerCase();
    const famKey = (h, mid) => famOf(h, mid) + "|" + h.bgColor + "|" + h.symbolColor;
    const famCharge = {};
    for (const mid in heraldData)
      for (const k in heraldData[mid]) {
        const heraldry = heraldData[mid][k];
        if (heraldry && heraldry.symbol > 0) {
          const familyKey = famKey(heraldry, mid);
          famCharge[familyKey] =
            famCharge[familyKey] == null || famCharge[familyKey] === heraldry.symbol ? heraldry.symbol : -1;
        } // -1 = ambiguous, don't borrow
      }
    const deviceOf = (h, mid) =>
      h.symbol > 0 ? h.symbol : famCharge[famKey(h, mid)] > 0 ? famCharge[famKey(h, mid)] : 0;
    built.forEach((m) => {
      const groupHeraldry = heraldData[m.mapId] || heraldData[String(m.mapId)];
      if (!groupHeraldry) return;
      // group_heraldry is keyed by the SCENARIO group index, but enemyGroups / allyGroups are re-numbered among their
      // own side (0, 1, …) — indexing one by the other handed most factions ANOTHER group's arms (Bordavia's Valamir
      // Vanguard flew the player's Vanguard crest; 45/69 Ep1 and 64/96 Ep2 groups were mismatched). Group names are
      // unique per map and resolve every group, so match by name; fall back to the index only if a name is missing.
      const byName = {};
      for (const k in groupHeraldry)
        if (groupHeraldry[k] && groupHeraldry[k].name) byName[groupHeraldry[k].name.toLowerCase()] = groupHeraldry[k];
      const merge = (group, gi) => {
        const heraldry = (group && group.name && byName[group.name.toLowerCase()]) || groupHeraldry[String(gi)];
        if (group && heraldry) {
          group.bgColor = heraldry.bgColor;
          group.symbolColor = heraldry.symbolColor;
          group.device = deviceOf(heraldry, m.mapId);
          group.bgType = heraldry.bgType;
          group.noRecolor = !!heraldry.noRecolor;
        }
      };
      if (m.groupByGi) for (const gi in m.groupByGi) merge(m.groupByGi[gi], gi);
      if (m.enemyGroups) for (const gi in m.enemyGroups) merge(m.enemyGroups[gi], gi);
      if (m.allyGroups) for (const gi in m.allyGroups) merge(m.allyGroups[gi], gi);
    });
    return built.length ? built : null;
  } catch (e) {
    return null;
  }
}
