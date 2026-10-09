/* ============================================================
   Reign of Swords — HOT-SEAT (not in the original as such: its head-to-head modes were online; this is the same
   battle for two players on ONE device). Only the skirmish maps — the original's head-to-head fields — qualify:
   each has two groups with their own deploy blocks (marker table [x, y, block, group]) and gold budgets.
   Both players muster from the full roster, then take turns; nothing is run by the AI.

   How the engine is shared: the active player's army is ALWAYS team "blue" — at each handover every unit's team is
   swapped (and the capture-area / objective owners with it), so the player controls, undo, march, unit card and the
   end-of-turn rules all work unchanged. `u.paint` keeps each army's own colours on the board through the swaps.
   Mixed onto Game.prototype in engine/engine.js.
   ============================================================ */

import { key, makeRng } from "../util/util.js";

const flip = (team) => (team === "blue" ? "red" : team === "red" ? "blue" : team);

export class HotseatMethods {
  // The battle screen turns hot-seat on BEFORE it picks a map; every (re)build of a skirmish then becomes one.
  setHotseat(on) {
    this.hotseatMode = !!on;
  }
  // The match settings from the setup card, applied on the next (re)build: { names: [p1, p2], budget (one amount for
  // both; null = the map's own gold per side), budgets: [p1, p2] (each side's own points — wins over budget),
  // elites: [p1, p2] (each side's elite slots, the muster's Medals; null = 1 per 1000 points), first (0 / 1, null =
  // the map's turn order), coin (the first move was a coin toss) }.
  setHotseatOptions(opts) {
    this.hotseatOpts = opts || null;
  }
  // A skirmish mission as a hot-seat battle: no preset armies, no AI, no script (its lines brief a single player);
  // the deploy phase opens for player 1 in the map's player-group blocks. Non-skirmish maps are returned as they are.
  _hsMission(mission) {
    const base = mission.hotseatBase || mission;
    const order = base.groupOrder || [];
    const p1 = order.find((g) => g.side === "player"),
      p2 = order.find((g) => g.side === "enemy");
    if (base.group !== "skirmish" || !p1 || !p2) return base;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < base.cols && y < base.rows;
    const zoneOf = (gi) =>
      (base.markers || []).filter((m) => m[3] === gi && inBounds(m[0], m[1])).map((m) => [m[0], m[1]]);
    const budgets = base.sideBudgets || {},
      opts = this.hotseatOpts || {};
    const players = [
      { gi: p1.gi, side: p1.name || "West", paint: "blue", mapBudget: budgets.player || 3000, zone: zoneOf(p1.gi) },
      { gi: p2.gi, side: p2.name || "East", paint: "red", mapBudget: budgets.enemy || 3000, zone: zoneOf(p2.gi) },
    ];
    players.forEach((p, i) => {
      p.name = (opts.names && opts.names[i] && String(opts.names[i]).trim().slice(0, 20)) || `Player ${i + 1}`;
      const own = opts.budgets && opts.budgets[i];
      p.budget = own > 0 ? own : opts.budget > 0 ? opts.budget : p.mapBudget;
      const elites = opts.elites && opts.elites[i];
      p.elites = Number.isInteger(elites) && elites >= 0 ? elites : null; // null = the rule, 1 per 1000 points
    });
    return {
      ...base,
      hotseatBase: base,
      hotseat: players,
      red: [],
      blue: [],
      allies: [],
      script: null,
      events: null,
      heroFlee: null,
      enemyFirst: false,
      holdTiles: null,
      deploy: { budget: players[0].budget, zone: players[0].zone, roster: (base.deploy || {}).roster },
    };
  }
  // Fresh per-battle hot-seat state (setup): who is active, who moves first (the setup's choice or coin toss, else
  // the lower group index — the map's own turn order), and the pending "pass the device" screen.
  _hsInit() {
    const players = this.mission.hotseat,
      opts = this.hotseatOpts || {};
    const first = opts.first === 0 || opts.first === 1 ? opts.first : players && players[0].gi <= players[1].gi ? 0 : 1;
    this.hs = players ? { players, active: 0, first, coin: !!opts.coin, handover: null, mustered: false } : null;
    if (this.hs && this.online) this.rng = makeRng((this.seed = this.online.seed)); // online: both devices roll the same dice
  }
  // The active player's elite slots when the setup set them (else the muster's own 1 per 1000 points rule).
  _hsEliteSlots() {
    if (!this.hs) return null;
    const p = this.hs.players[this.hs.active];
    return p.elites != null ? p.elites : null;
  }
  // The board colour of a team as it stands now ("blue" = whoever is active).
  paintOfTeam(team) {
    if (!this.hs || !team) return team;
    return this.hs.players[this.hs.active].paint === "blue" ? team : flip(team);
  }
  // Hot-seat musters are blind: while one player sets up, the other's army is off the board and the mini-map.
  hsMusterHidden(u) {
    return !!this.hs && this.phase === "deploy" && u.team === "red";
  }
  // A unit mustered by the active player joins that player's group and colours.
  _hsTagUnit(u) {
    if (!this.hs) return;
    const p = this.hs.players[this.hs.active];
    u.group = p.gi;
    u.paint = p.paint;
  }
  // Hand the field to the other player: swap every team (and the owners of the capture areas and objective tiles).
  _hsSwap() {
    for (const u of this.units) u.team = flip(u.team);
    for (const a of this.captureAreas || []) a.owner = flip(a.owner);
    for (const o of this.objectives || []) o.owner = flip(o.owner);
    for (const m of this.prayerMarks || []) m.team = flip(m.team);
    this.hs.active = 1 - this.hs.active;
  }
  // Fight on player 1's muster: hand the device over for player 2's muster instead of starting. Returns true when
  // it took the press.
  _hsMusterDone() {
    if (!this.hs || this.hs.mustered) return false;
    if (!this.units.some((u) => u.team === "blue" && !u.ally)) return false; // startBattle explains the empty muster
    if (this.online) return this._onlineMusterDone(); // online: send this army, the opponent musters on their own device
    this.hs.mustered = true;
    this.placing = null;
    this.pickUp = null;
    this.hs.handover = { next: 1, kind: "deploy" };
    this._emit();
    return true;
  }
  // Both armies are on the field: the opening card names the first mover (and the coin toss), then their turn opens.
  _hsOpen() {
    this.hs.handover = { next: this.hs.first, kind: "turn", opening: true };
    if (this.online) return this._onlineHandover(); // online: no device to pass — the first turn opens at once
    this._emit();
  }
  _hsStartTurn() {
    this.units.forEach((u) => {
      if (u.team === "red" && u.ambush) u.ambushUsed = false; // the waiting side's ambushers rearm
    });
    this._startPlayerTurn();
    const mine = this.units.filter((u) => !u.dead && u.team === "blue");
    if (mine.length)
      this.centerOn(
        mine.reduce((s, u) => s + u.tx, 0) / mine.length,
        mine.reduce((s, u) => s + u.ty, 0) / mine.length,
        true,
      ); // look at the army whose turn it is
  }
  // End Turn: the side's end-of-turn rules, the round counter after the second mover, then the handover.
  _hsEndTurn() {
    this._turnEnded = true;
    const mine = this.units.filter((u) => u.team === "blue" && !u.ally);
    this._leashCheck("blue");
    this._endTurnHide(mine);
    this._endTurnSlow(mine);
    this._endTurnBrace(mine);
    const end = this._terminal();
    if (end) {
      this.phase = end;
      this._emit();
      return;
    }
    if (this.hs.active !== this.hs.first) {
      this._quicksandTurn(); // Ep2: quicksand bites its occupants, then decays
      this.turn++;
      if (this.turn > this.mission.turnLimit) {
        this.phase = this._timeoutOutcome();
        this._emit();
        return;
      }
    }
    this.selected = null;
    this.reach = null;
    this.targets = null;
    this.inspect = null;
    this._undoFrom = null;
    this.orderMode = null;
    this.marchQueue = null;
    this.marchTarget = null;
    this.hs.handover = { next: 1 - this.hs.active, kind: "turn" };
    if (this.online) return this._onlineHandover(); // online: store the turn, the opponent's opens at once
    this._emit();
  }
  // "I'm ready" on the handover screen: the next player's muster or turn begins.
  hotseatContinue() {
    const h = this.hs && this.hs.handover;
    if (!h) return;
    this.hs.handover = null;
    if (this.hs.active !== h.next) this._hsSwap();
    if (h.kind === "deploy") {
      const p = this.hs.players[this.hs.active];
      this.mission = { ...this.mission, deploy: { ...this.mission.deploy, budget: p.budget, zone: p.zone } };
      this.deployZone = new Set(p.zone.map(([x, y]) => key(x, y)));
      this.centerOnDeploy();
      this._emit();
      return;
    }
    this._hsStartTurn();
  }
  // The React layer's view: names, who is active, the pending handover and — once it's over — the winner.
  _hotseatView() {
    if (!this.hs) return null;
    const { players, active, handover } = this.hs;
    const over = this.phase === "victory" || this.phase === "defeat";
    const winner = over ? (this.phase === "victory" ? active : 1 - active) : null;
    const who = (i) => ({
      name: players[i].name,
      side: players[i].side,
      paint: players[i].paint,
      budget: players[i].budget,
      elites: players[i].elites,
      left: this.units.filter((u) => !u.dead && u.paint === players[i].paint).length, // units still standing
    });
    return {
      players: [who(0), who(1)],
      mapBudgets: players.map((p) => p.mapBudget),
      mapFirst: players[0].gi <= players[1].gi ? 0 : 1, // who opens by the map's own turn order
      active: who(active),
      waiting: who(1 - active), // the other player (the HUD's right-hand side)
      handover: handover
        ? { ...who(handover.next), kind: handover.kind, opening: !!handover.opening, coin: this.hs.coin }
        : null,
      winner: winner == null ? null : who(winner),
    };
  }
}
