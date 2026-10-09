/* ============================================================
   Reign of Swords — AUTOPILOT: the player's own army played by the AI (the Battle Lab and its Watch replays).
   Not part of the original game. Each of your units runs the same per-unit AI as the computer's armies (ai/ai.js
   aiStep — attacks, spells, prayers, charges, the original movers); a STRATEGY only sets where a unit heads when it
   has nothing to strike (its "order", the slot GroupLogic fills for the computer's armies — see _glOrder):
     attack  — no order: every unit goes for its closest foe, as the computer's own units do;
     hold    — every unit stays where it stands and strikes only what comes within its reach;
     advance — the army moves as one block toward the enemy nearest its centre, at its slowest unit's pace;
     safe    — "fight locally, then bombard": first clear the foes standing on ground your army can walk to, then
               never cross (no portals) — ranged units and casters take the edge of that ground nearest the enemy and
               shoot over it; the rest hold. On a map where everything is one walk away it is plain `attack`.
     fortress — "hold the fort": every unit acts only from the ground the army mustered on (the muster zone; on a
               map without one, the tiles around where each unit started) — it never steps out to strike — and an
               attack from a tile where more foes would stand around it scores lower; once your side is clearly the
               stronger (hp × cost 1.5× theirs), five foes or fewer are left, or the last six turns have come, it
               sallies out and plays as `attack`.
   The loop (engine/loop.js _updateAutopilotClock) calls autopilotStep() once per unit during your turn, with the same
   settle gate and pauses as an AI turn, so every move and strike plays out on screen.
   ============================================================ */
import { manhattan } from "../util/util.js";
import { DEPLOY_COST } from "../data/game-data.js";

// The strategies, in menu order: name and one-line help (the Battle Lab).
export const AUTOPILOT_STRATEGIES = {
  attack: { label: "Attack", help: "Every unit goes for its closest foe, as the computer's own units do." },
  hold: { label: "Hold ground", help: "Every unit stays where it stands and strikes only what comes within reach." },
  advance: {
    label: "Advance as one",
    help: "The army moves as one block toward the nearest enemy, at its slowest unit's pace.",
  },
  safe: {
    label: "Fight locally, then bombard",
    help: "First clear the foes on ground you can walk to; then never cross — archers and casters shoot from the edge nearest the enemy, the rest hold.",
  },
  fortress: {
    label: "Hold the fort",
    help: "Fight only from the ground you mustered on — never step out to strike, and keep off tiles where a unit would be surrounded; sally out to finish the enemy once you are clearly the stronger side or the turns run short.",
  },
};

const mineOf = (game) => game.units.filter((u) => !u.dead && u.team === "blue" && !u.ally);

export const AutopilotMethods = {
  // One unit of yours acts (or, with none left, your turn ends). The AI runs with the PLAYER as its side.
  autopilotStep() {
    const game = this.game;
    if (!game._apQueue || game._apTurn !== game.turn) {
      game._apQueue = mineOf(game).sort((a, b) => a.id - b.id);
      game._apTurn = game.turn;
    }
    game._apQueue = game._apQueue.filter((u) => !u.dead && !u.acted && u.team === "blue" && !u.ally);
    const foesLeft = game.units.some((e) => !e.dead && e.team === "red");
    if (!game._apQueue.length || !foesLeft) {
      game._apQueue = null;
      game._playerTurnAt = -1e9; // not a double tap: let End Turn through
      game.endTurn();
      return;
    }
    game._aiSelf = "blue";
    game._aiFoe = "red";
    game._aiAlly = false;
    game._aiPhase = "player";
    game._lastAiGroup = game._apQueue[0].group || 0; // no faction banner before each of your units
    game.aiQueue = game._apQueue;
    const before = game._apQueue.length;
    this.aiStep();
    if (game._apQueue.length === before && !game.anim) game._apQueue.shift(); // it found nothing to do: skip it
    game.aiQueue = null;
    game.aiDelay = 0.35;
  },

  // The strategy's destination for one of your units (null = the AI's own choice, its closest foe).
  _apOrder(u) {
    const game = this.game;
    switch (game.autopilot) {
      case "hold":
        return { tx: u.tx, ty: u.ty };
      case "advance":
        return this._apAdvanceOrder(u);
      case "safe":
        return this._apSafeOrder(u);
      case "fortress":
        return this._apSally() ? null : { tx: u.tx, ty: u.ty };
      default:
        return null;
    }
  },

  // HOLD THE FORT — is `spot` on the ground the army mustered on? The muster zone (kept for the whole battle), or on a
  // map without one the tiles around where each of your units stood when it first acted.
  _apFortHas(spot) {
    const game = this.game;
    if (game.deployZone && game.deployZone.size) return game.deployZone.has(spot.tx + "," + spot.ty);
    return mineOf(game).some((o) => o._apStart && manhattan(o._apStart, spot) <= 1);
  },
  // …and the sally: your strength (hp × deploy cost) at least 1.5× theirs, five foes or fewer left, or the last six
  // turns — then the fort is left to finish the enemy (a Rangers band hiding in the woods never comes to the walls).
  _apSally() {
    const game = this.game;
    return this._apPlan("sally", () => {
      const strength = (team) =>
        game.units
          .filter((o) => !o.dead && o.team === team && !(team === "blue" && o.ally))
          .reduce((s, o) => s + (o.hp / 100) * (DEPLOY_COST[o.type] || 0), 0);
      const foes = game.units.filter((o) => !o.dead && o.team === "red").length;
      const limit = (game.mission && game.mission.turnLimit) || 0;
      return foes <= 5 || strength("blue") >= 1.5 * strength("red") || (limit > 0 && game.turn > limit - 6);
    });
  },
  // The tiles one of your units may act from this turn (ai.js _aiLeashedStops): under Hold the fort, the fort's only —
  // its own tile always. Other strategies: unchanged.
  _apStops(u, stops) {
    if (this.game.autopilot !== "fortress") return stops;
    if (!u._apStart) u._apStart = { tx: u.tx, ty: u.ty };
    if (this._apSally()) return stops;
    const inFort = stops.filter((s) => (s.tx === u.tx && s.ty === u.ty) || this._apFortHas(s));
    return inFort.length ? inFort : [{ tx: u.tx, ty: u.ty }];
  },
  // What striking from `spot` costs one of your units under Hold the fort (ai.js _aiPickAttack): each foe next to it
  // beyond the one it strikes — a shooter: every foe next to it — at one blow's worth (15 ratio steps). Else 0.
  _apSpotRisk(u, spot) {
    if (this.game.autopilot !== "fortress" || this._apSally()) return 0;
    let adjacent = 0;
    for (const e of this.game.units) if (!e.dead && e.team === "red" && manhattan(e, spot) === 1) adjacent++;
    return (u.T.range > 1 ? adjacent : Math.max(0, adjacent - 1)) * 1500;
  },

  // ADVANCE AS ONE: the army's centre steps toward the enemy nearest it by the slowest unit's move; each unit keeps
  // its place in the block (its offset from the centre).
  _apAdvanceOrder(u) {
    const game = this.game;
    const plan = this._apPlan("advance", () => {
      const mine = mineOf(game);
      const foes = game.units.filter((e) => !e.dead && e.team === "red" && !game._isHidden(e));
      if (!mine.length || !foes.length) return null;
      const centre = {
        tx: Math.round(mine.reduce((s, o) => s + o.tx, 0) / mine.length),
        ty: Math.round(mine.reduce((s, o) => s + o.ty, 0) / mine.length),
      };
      let foe = foes[0];
      for (const e of foes) if (manhattan(e, centre) < manhattan(foe, centre)) foe = e;
      const pace = Math.max(1, Math.min(...mine.map((o) => game.moveOf(o))));
      const dist = manhattan(foe, centre);
      const k = dist ? Math.min(1, pace / dist) : 0;
      return {
        centre,
        next: {
          tx: Math.round(centre.tx + (foe.tx - centre.tx) * k),
          ty: Math.round(centre.ty + (foe.ty - centre.ty) * k),
        },
      };
    });
    if (!plan) return null;
    return {
      tx: Math.max(0, Math.min(game.cols - 1, plan.next.tx + u.tx - plan.centre.tx)),
      ty: Math.max(0, Math.min(game.rows - 1, plan.next.ty + u.ty - plan.centre.ty)),
    };
  },

  // FIGHT LOCALLY, THEN BOMBARD (see the header).
  _apSafeOrder(u) {
    const game = this.game;
    const plan = this._apPlan("safe", () => {
      const home = this._apHomeGround();
      const local = game.units.filter((e) => !e.dead && e.team === "red" && home.has(e.tx + "," + e.ty));
      const tiles = [...home]
        .map((k) => k.split(",").map(Number))
        .filter(([x, y]) => !this.game._srcPortal(x, y, null) && !this.game._dstPortal(x, y, null))
        .map(([x, y]) => ({ tx: x, ty: y }));
      return { home, local, tiles };
    });
    const nearest = (list, from) => {
      let best = null;
      for (const o of list) if (!best || manhattan(o, from) < manhattan(best, from)) best = o;
      return best;
    };
    const local = plan.local.filter((e) => !e.dead);
    if (local.length) {
      const foe = nearest(local, u);
      return { tx: foe.tx, ty: foe.ty };
    }
    const shooter = u.T.range > 1 || u.T.canLightning || u.T.magic;
    if (!shooter) return { tx: u.tx, ty: u.ty };
    const foe = nearest(
      game.units.filter((e) => !e.dead && e.team === "red" && !game._isHidden(e)),
      u,
    );
    return foe ? nearest(plan.tiles, foe) || { tx: u.tx, ty: u.ty } : { tx: u.tx, ty: u.ty };
  },

  // The ground your army can walk to from where it stands, without portals (terrain only, units ignored).
  _apHomeGround() {
    const game = this.game;
    const mine = mineOf(game);
    const probe = mine.find((o) => !o.T.fly) || mine[0];
    const seen = new Set(),
      queue = [];
    for (const o of mine) {
      const k = o.tx + "," + o.ty;
      if (!seen.has(k)) {
        seen.add(k);
        queue.push([o.tx, o.ty]);
      }
    }
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy,
          k = nx + "," + ny;
        if (seen.has(k) || !game.inBounds(nx, ny) || game.moveCost(probe, nx, ny, x, y) >= 99) continue;
        seen.add(k);
        if (!game._srcPortal(nx, ny, null)) queue.push([nx, ny]); // a gate ends the walk: no crossing
      }
    }
    return seen;
  },

  // A strategy's per-turn plan, built once per turn on first use.
  _apPlan(kind, build) {
    const game = this.game;
    if (!game._apPlans || game._apPlans.turn !== game.turn) game._apPlans = { turn: game.turn };
    if (!(kind in game._apPlans)) game._apPlans[kind] = build();
    return game._apPlans[kind];
  },
};
