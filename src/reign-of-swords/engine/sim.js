/* ============================================================
   Reign of Swords — BATTLE LAB runner (not in the original): a battle played start to finish with no screen, your
   side under the 🤖 Autopilot (ai/autopilot.js), on any map, with a chosen army, strategy and dice seed. The Battle
   Lab panel (ui/shell/BattleLab.jsx) runs batches of these; its "Watch" opens the same battle on screen with the same
   seed, army and strategy (autoDeploy + seedBattle below), so what you watch is the run in the table.
   ============================================================ */
import { Game, missionList } from "./engine.js";
import { DEPLOY_COST, UNIT_TYPES } from "../data/game-data.js";
import { makeRng, manhattan } from "../util/util.js";

// Melee / heavy units muster nearest the enemy, ranged units, casters and war engines behind them.
const backRank = (type) => {
  const T = UNIT_TYPES[type] || {};
  return T.range > 1 || T.canLightning || T.magic || T.kind === "siege" || T.prayer || T.heal ? 1 : 0;
};

export const armyCost = (army) => Object.entries(army || {}).reduce((s, [t, n]) => s + (DEPLOY_COST[t] || 0) * n, 0);

// Fill a budget in order: each step takes up to `n` of a type while the points last.
function fill(budget, steps) {
  const army = {};
  let left = budget;
  for (const step of steps) {
    const [type, share] = step(left, budget);
    const cost = DEPLOY_COST[type] || 0;
    const k = cost ? Math.min(share, Math.floor(left / cost)) : 0;
    if (k > 0) {
      army[type] = (army[type] || 0) + k;
      left -= k * cost;
    }
  }
  return army;
}
// A starting mix for a budget (the Battle Lab's default army, and the map runner's): the elite slots as Wizards, one
// Priest, then Pikemen / Crossbowmen / Swordsmen, the rest Militiamen.
export function suggestArmy(budget) {
  let rest = 0;
  return fill(budget, [
    () => ["wizards", Math.floor(budget / 1000)],
    () => ["priests", budget >= 1500 ? 1 : 0],
    (left) => ((rest = left), ["pikemen", Math.floor((rest * 0.45) / DEPLOY_COST.pikemen)]),
    () => ["crossbowmen", Math.floor((rest * 0.35) / DEPLOY_COST.crossbowmen)],
    () => ["swordsmen", 99],
    () => ["militiamen", 99],
  ]);
}
// A line army with no elite unit (the map runner's second army): a Priest, then Knights, Pikemen, Crossbowmen and
// Archers by share, the rest Swordsmen and Militiamen.
export function lineArmy(budget) {
  let rest = 0;
  return fill(budget, [
    () => ["priests", budget >= 1500 ? 1 : 0],
    (left) => ((rest = left), ["knights", Math.floor((rest * 0.15) / DEPLOY_COST.knights)]),
    () => ["pikemen", Math.floor((rest * 0.25) / DEPLOY_COST.pikemen)],
    () => ["crossbowmen", Math.floor((rest * 0.2) / DEPLOY_COST.crossbowmen)],
    () => ["archers", Math.floor((rest * 0.15) / DEPLOY_COST.archers)],
    () => ["swordsmen", 99],
    () => ["militiamen", 99],
  ]);
}

// Hand the page a turn between chunks of a battle. A MessageChannel task, not setTimeout: background tabs throttle
// timers to about one a second, which would stall a batch the moment you look at another tab.
const yieldToPage = () =>
  typeof MessageChannel === "undefined"
    ? new Promise((r) => setTimeout(r, 0))
    : new Promise((r) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          r();
        };
        channel.port2.postMessage(0);
      });

// The dice of a battle about to start: the same seed gives the same battle (Lab run and Watch alike).
export function seedBattle(game, seed) {
  game.seed = seed >>> 0 || 1;
  game.rng = makeRng(game.seed);
}

// Muster `army` ({type: count}) over the deployment zone. First WHAT goes: the army's units in its own order, each
// while the mission's muster rules still allow it (points budget, 1 elite per 1000 points, the roster's counts) —
// so a long list is cut at its end, never its expensive units. Then WHERE: the front rows (nearest the enemy) take the
// melee units, the back rows the rest. Returns the number placed.
export function autoDeploy(game, army) {
  if (game.phase !== "deploy" || !game.deployZone) return 0;
  const foes = game.units.filter((u) => !u.dead && u.team === "red");
  const centre = foes.length
    ? {
        tx: foes.reduce((s, u) => s + u.tx, 0) / foes.length,
        ty: foes.reduce((s, u) => s + u.ty, 0) / foes.length,
      }
    : { tx: game.cols / 2, ty: game.rows / 2 };
  const zone = [...game.deployZone]
    .map((k) => k.split(",").map(Number))
    .map(([tx, ty]) => ({ tx, ty }))
    .sort((a, b) => manhattan(a, centre) - manhattan(b, centre) || a.ty - b.ty || a.tx - b.tx);
  const list = [];
  let spent = game.deploySpent(),
    elites = game.eliteCount();
  const counts = {};
  for (const [type, n] of Object.entries(army || {}))
    for (let i = 0; i < n; i++) {
      const cost = game.deployCost(type),
        elite = game.isElite(type),
        cap = game.rosterCount(type);
      if (game.rosterMap && !game.rosterMap[type]) break;
      if (spent + cost > game.deployBudget() || (elite && elites >= game.maxElite())) break;
      if (cap != null && (counts[type] || 0) + game.placedCount(type) >= cap) break;
      list.push(type);
      spent += cost;
      if (elite) elites++;
      counts[type] = (counts[type] || 0) + 1;
    }
  list.sort((a, b) => backRank(a) - backRank(b));
  let placed = 0;
  for (const type of list) {
    const before = game.units.length;
    for (const t of zone) {
      if (game.unitAt(t.tx, t.ty) || !game._canDeployAt(type, t.tx, t.ty)) continue;
      game.placeUnit(type, t.tx, t.ty);
      break;
    }
    if (game.units.length > before) placed++;
  }
  return placed;
}

// One battle with no screen. `onDamage` gets every blow to your army. Resolves to the summary the Lab shows.
// `yieldMs`: give the browser a frame back this often, so a batch never freezes the page; `signal.aborted` stops it.
export async function simulateBattle({
  mapId,
  army,
  roster,
  strategy,
  seed,
  turnLimit,
  realisticSiege,
  yieldMs = 25,
  signal = null,
}) {
  const index = missionList().findIndex((m) => m.mapId === mapId);
  if (index < 0) throw new Error("map " + mapId + " is not in this episode");
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const game = new Game(canvas, {}, () => {}, null, roster || null, false);
  cancelAnimationFrame(game._raf);
  game._loop = () => {};
  // no hidden-tab background ticks either: only this loop advances the battle
  if (game._onVis && typeof document !== "undefined") document.removeEventListener("visibilitychange", game._onVis);
  try {
    game.selectMission(index);
    if (turnLimit) game.mission = { ...game.mission, turnLimit };
    if (realisticSiege != null) game.realisticSiege = !!realisticSiege; // else the ⚙ setting, as a real battle
    seedBattle(game, seed);
    const damage = {},
      timeline = [];
    const hit = game._applyHit.bind(game);
    game._applyHit = (defender, attacker, amount, ...rest) => {
      const mine = defender && defender.team === "blue" && !defender.ally;
      const before = mine ? defender.hp : 0;
      const result = hit(defender, attacker, amount, ...rest);
      if (mine && attacker) {
        const k = UNIT_TYPES[attacker.type] ? UNIT_TYPES[attacker.type].name : attacker.type;
        damage[k] = (damage[k] || 0) + Math.max(0, before - Math.max(0, defender.hp));
      }
      return result;
    };
    if (game.openBattle) game.openBattle();
    game.setAutopilot(strategy || "attack");
    const count = (f) => game.units.filter((u) => !u.dead && f(u)).length;
    const mineAlive = () => count((u) => u.team === "blue" && !u.ally);
    let deployed = game.phase !== "deploy",
      spent = 0,
      lastTurn = 0,
      t0 = Date.now();
    for (let frame = 0; frame < 400000; frame++) {
      if (game.phase === "victory" || game.phase === "defeat" || (signal && signal.aborted)) break;
      if (game.battleEvent) game.eventClosed();
      if (game.pendingSkip) game.confirmSkip();
      if (
        !deployed &&
        game.phase === "deploy" &&
        !game.battleEvent &&
        !(game._sc && game._sc.queue && game._sc.queue.length)
      ) {
        autoDeploy(game, army);
        spent = game.units
          .filter((u) => u.team === "blue" && !u.ally && !u.hero)
          .reduce((s, u) => s + (DEPLOY_COST[u.type] || 0), 0);
        game.startBattle();
        deployed = true;
      }
      if (game.turn !== lastTurn && game.phase === "player") {
        lastTurn = game.turn;
        timeline.push({
          turn: game.turn,
          mine: mineAlive(),
          foes: count((u) => u.team === "red"),
          allies: count((u) => u.ally),
        });
      }
      game.update(0.05);
      if (yieldMs && Date.now() - t0 > yieldMs) {
        await yieldToPage();
        t0 = Date.now();
      }
    }
    const mine = game.units.filter((u) => !u.dead && u.team === "blue" && !u.ally);
    const startValue = spent || 1;
    const left = mine.filter((u) => !u.hero).reduce((s, u) => s + (DEPLOY_COST[u.type] || 0) * (u.hp / 100), 0);
    return {
      mapId,
      strategy,
      seed,
      result: game.phase === "victory" ? "victory" : game.phase === "defeat" ? "defeat" : "unfinished",
      major: !!game.majorVictory,
      reason: game.defeatReason || null,
      realisticSiege: !!game.realisticSiege,
      turn: game.turn,
      spent,
      kept: Math.round((left / startValue) * 100),
      mineLeft: mine.length,
      foesLeft: count((u) => u.team === "red"),
      alliesLeft: count((u) => u.ally),
      damage,
      timeline,
    };
  } finally {
    game.destroy();
  }
}
