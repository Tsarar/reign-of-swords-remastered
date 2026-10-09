/* ============================================================
   Reign of Swords — ONLINE BATTLES (ours: the original's head-to-head ran through Punch Entertainment's servers,
   long gone). Built on hot-seat (engine/hotseat.js): both players run the same skirmish battle, from the same seed.
     • DEPLOYMENT: each player musters only their own army; the two arrive together (Supabase match_deploys) and are
       placed in a fixed order on both devices, so every unit has the same id everywhere.
     • LIVE MOVES: every command the player gives (a tap, End Turn, Undo, a skill…) is sent to the opponent as it is
       made and replayed there through the very same method, once the field is idle — the opponent watches the turn
       happen. The engine is deterministic for the same commands from the same state (one seeded generator).
     • TURN HAND-OVER: at the end of a turn the mover's snapshot of the battle is stored with the match. The watcher
       compares it with its own and, if anything drifted (a lost message, a reconnect), simply loads it.
   Mixed onto Game.prototype in engine/engine.js. The network side lives in online/ (Supabase), the screen in ui/.
   ============================================================ */

import { makeRng } from "../util/util.js";
import { UNIT_TYPES } from "../data/game-data.js";

// The player's commands that change the battle (everything else — the camera, hover previews — stays local).
const COMMANDS = [
  "click",
  "peekAt",
  "endTurn",
  "undoMove",
  "holdUnit",
  "selectNextUnit",
  "beginMarch",
  "cancelOrder",
  "toggleAim",
  "cancelAim",
  "aimSkill",
  "shapeshiftSelected",
  "setSpell",
  "invokeRetribution",
  "invokeShield",
  "confirmSkip",
  "cancelSkip",
];
// Per-unit fields rebuilt rather than stored: the type table, the screen position, the running animation, its idle
// bob (look only, each device its own), and hitPending (the last unit it struck or was struck by — a pointer kept for
// the strike animation; two units that traded blows point at each other).
const UNIT_SKIP = new Set([
  "T",
  "px",
  "py",
  "anim",
  "animT",
  "attacking",
  "flash",
  "balk",
  "_glc",
  "hitPending",
  "bob",
]);
const isUnit = (x) => !!(x && typeof x === "object" && x.T && x.id != null && x.tx != null);

// Snapshots travel as JSON: Sets and Maps are tagged on the way out and rebuilt on the way in. A pointer to a unit
// inside another unit's fields is stored as nothing (the unit itself is in the list), and a loop can't recurse.
function encode(v, seen = new WeakSet()) {
  if (v && typeof v === "object") {
    if (seen.has(v)) return null;
    seen.add(v);
  }
  let out = v;
  if (v instanceof Set) out = { __set: [...v].map((x) => encode(x, seen)) };
  else if (v instanceof Map) out = { __map: [...v].map(([k, x]) => [encode(k, seen), encode(x, seen)]) };
  else if (Array.isArray(v)) out = v.map((x) => encode(x, seen));
  else if (v && typeof v === "object") {
    out = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== "function" && !isUnit(x)) out[k] = encode(x, seen);
  }
  if (v && typeof v === "object") seen.delete(v); // only the current path counts: shared plain data is stored twice
  return out;
}
// Stable JSON (sorted keys): two devices build the same objects with fields added in a different order.
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v === undefined ? null : v);
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    if (v.__set) return new Set(v.__set.map(decode));
    if (v.__map) return new Map(v.__map.map(([k, x]) => [decode(k), decode(x)]));
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = decode(x);
    return o;
  }
  return v;
}

export class OnlineMethods {
  // Turn this battle into an online one. cfg = { me: 0 | 1 (0 = the host, West), seed, first: 0 | 1, names: [h, g],
  // budgets: [h, g], elites: [h, g] (null = 1 per 1000 gold), send(cmd), onDeploy(army), onTurnEnd(snapshot, info), onFinish(winnerIdx, reason) }. Call before the
  // battle is built (selectMission / reset); the commands are wrapped once.
  setOnline(cfg) {
    this.online = cfg ? { ...cfg, seq: 0, inbox: new Map(), expect: null, replaying: false, deployed: false } : null;
    if (!cfg) return;
    this.setHotseat(true);
    this.setHotseatOptions({
      names: cfg.names,
      budget: cfg.budget, // older matches: one amount for both
      budgets: cfg.budgets,
      elites: cfg.elites,
      first: cfg.first,
    });
    if (this._onlineWrapped) return;
    this._onlineWrapped = true;
    for (const name of COMMANDS) {
      const original = this[name];
      if (typeof original !== "function") continue;
      this[name] = (...args) => {
        const o = this.online;
        if (!o || this.phase === "deploy" || this.phase === "victory" || this.phase === "defeat")
          return original.apply(this, args);
        if (o.replaying) return original.apply(this, args);
        if (!this.onlineMyTurn()) return undefined; // the opponent's turn: the field is theirs
        if (!this._onlineIdle()) return undefined; // mid-animation: the opponent would apply it at a different moment
        if (
          name === "endTurn" &&
          typeof performance !== "undefined" &&
          performance.now() - (this._playerTurnAt || 0) < 900
        )
          return undefined; // ignored by endTurn itself — don't send it
        const cmd = {
          turn: this.turn,
          side: this.hs.active,
          seq: o.seq++,
          name,
          args: JSON.parse(JSON.stringify(args)),
        };
        const result = original.apply(this, args);
        if (o.send) o.send(cmd);
        return result;
      };
    }
  }
  onlineMyTurn() {
    return !!(this.online && this.hs && this.phase === "player" && this.hs.active === this.online.me);
  }
  _onlineIdle() {
    return !this.anim && !this.marchQueue && !this._teleportLock && !(this._delayed && this._delayed.length);
  }

  // ---- deployment ----------------------------------------------------------------------------------------------
  // After the battle is built: the guest musters as player 2 straight away (no hand-over screen).
  _onlineMuster() {
    if (!this.online || !this.hs) return;
    if (this.online.me === 1) {
      this.hs.handover = { next: 1, kind: "deploy" };
      this.hotseatContinue();
    }
  }
  // Fight on one's own muster: send the army and wait for the opponent's (the battle opens in onlineBegin).
  _onlineMusterDone() {
    if (this.online.deployed) return true;
    const army = this.units
      .filter((u) => u.team === "blue" && !u.ally)
      .map((u) => ({ type: u.type, tx: u.tx, ty: u.ty, hero: !!u.hero }));
    this.online.deployed = true;
    this.placing = null;
    this.pickUp = null;
    if (this.online.onDeploy) this.online.onDeploy(army);
    this._emit();
    return true;
  }
  // Both armies are in: place them in a fixed order (the host's, then the guest's) and open the first mover's turn.
  onlineBegin(deploys) {
    const hs = this.hs;
    this.units = [];
    this.selected = null;
    this.placing = null;
    this.pickUp = null;
    for (const [idx, army] of [
      [0, deploys.host || []],
      [1, deploys.guest || []],
    ]) {
      hs.active = idx;
      for (const d of army) {
        if (!UNIT_TYPES[d.type]) continue;
        this._hsTagUnit(this._makeUnit(d.type, idx === hs.first ? "blue" : "red", d.tx, d.ty, !!d.hero)); // (adds it)
      }
    }
    hs.active = hs.first;
    hs.mustered = true;
    this.online.deployed = true;
    this.online.begun = true;
    this.phase = "deploy";
    this.startBattle(); // the usual opening: hide in cover, ready the first side, then _hsOpen → their turn
  }

  // ---- turns ---------------------------------------------------------------------------------------------------
  // The hand-overs need no "pass the device" screen: the next turn opens at once (called from hotseat.js).
  _onlineHandover() {
    const h = this.hs.handover;
    const o = this.online;
    if (h && h.kind === "turn" && !h.opening) {
      const mover = this.hs.active; // the side whose turn just ended
      try {
        const snap = this.onlineSnapshot();
        o.lastEnd = { turn: this.turn, mover, json: canonical(snap) };
        if (mover === o.me && o.onTurnEnd) o.onTurnEnd(snap, { turn: this.turn, mover });
      } catch (e) {
        // never strand the hand-over: the next turn still opens (the opponent then syncs from the live moves)
        console.error("online: the turn could not be stored", e);
      }
    }
    this.hotseatContinue();
    // Now watching the opponent: their commands of this turn are expected from seq 0.
    o.expect = this.hs.active === o.me ? null : { turn: this.turn, side: this.hs.active, seq: 0 };
    if (this.hs.active === o.me) o.seq = 0;
    this._emit();
  }
  // A command from the opponent: kept until the field is idle and it is next in line (onlinePump, every frame).
  onlineReceive(cmd) {
    if (!this.online || !cmd) return;
    this.online.inbox.set(cmd.turn + ":" + cmd.side + ":" + cmd.seq, cmd);
  }
  onlinePump() {
    const o = this.online;
    if (!o || !o.expect || o.replaying || !this._onlineIdle()) return;
    const e = o.expect;
    const k = e.turn + ":" + e.side + ":" + e.seq;
    const cmd = o.inbox.get(k);
    if (!cmd) return;
    o.inbox.delete(k);
    e.seq++;
    o.replaying = true;
    try {
      if (cmd.name === "endTurn") this._playerTurnAt = 0; // its "just opened" guard measures the sender's clock
      const fn = this[cmd.name];
      if (typeof fn === "function") fn.apply(this, cmd.args || []);
    } finally {
      o.replaying = false;
    }
  }
  // The stored snapshot after the opponent's turn: if this device drifted (or missed the turn) it takes the stored
  // battle and opens its own turn from there.
  onlineSync(snapshot, moverIdx) {
    const o = this.online;
    if (!o || !snapshot) return false;
    const json = canonical(snapshot);
    if (o.lastEnd && o.lastEnd.mover === moverIdx && o.lastEnd.json === json && this.onlineMyTurn()) return false;
    this.onlineRestore(snapshot);
    this.hs.handover = { next: 1 - moverIdx, kind: "turn" };
    this.hotseatContinue();
    o.expect = this.hs.active === o.me ? null : { turn: this.turn, side: this.hs.active, seq: 0 };
    o.seq = 0;
    o.inbox.clear();
    this._emit();
    return true;
  }

  // ---- snapshots -----------------------------------------------------------------------------------------------
  onlineSnapshot() {
    const units = this.units.map((u) => {
      const o = {};
      for (const [k, v] of Object.entries(u))
        if (!UNIT_SKIP.has(k) && typeof v !== "function" && !isUnit(v)) o[k] = encode(v);
      return o;
    });
    return encode({
      v: 1,
      turn: this.turn,
      phase: this.phase,
      rng: this.rng.state ? this.rng.state() : 0,
      nid: this._nid,
      hs: { active: this.hs.active, first: this.hs.first, mustered: this.hs.mustered },
      units,
      tiles: this.tiles ? this.tiles.slice() : null,
      structHp: this.structHp,
      razed: this.razed,
      quicksand: this.quicksand,
      builtVillages: this.builtVillages,
      captureAreas: this.captureAreas,
      objectives: this.objectives,
      prayerMarks: this.prayerMarks,
      majorVictory: this.majorVictory,
      defeatReason: this.defeatReason,
    });
  }
  onlineRestore(snapshot) {
    const s = decode(snapshot);
    this.units = [];
    for (const raw of s.units) {
      if (!UNIT_TYPES[raw.type]) continue;
      const u = this._makeUnit(raw.type, raw.team, raw.tx, raw.ty, !!raw.hero);
      Object.assign(u, raw);
      u.T = UNIT_TYPES[u.type];
      u.px = u.tx * this.tile;
      u.py = u.ty * this.tile; // (_makeUnit already listed it)
    }
    if (s.tiles) this.tiles = s.tiles;
    this.structHp = s.structHp || new Map();
    this.razed = s.razed || new Set();
    this.quicksand = s.quicksand || new Map();
    this.builtVillages = s.builtVillages || new Map();
    if (s.captureAreas) this.captureAreas = s.captureAreas;
    if (s.objectives) this.objectives = s.objectives;
    this.prayerMarks = s.prayerMarks || [];
    this.majorVictory = !!s.majorVictory;
    this.defeatReason = s.defeatReason || null;
    this.turn = s.turn;
    this.phase = s.phase;
    this._nid = s.nid;
    Object.assign(this.hs, s.hs, { handover: null });
    if (!this.rng.setState) this.rng = makeRng(0);
    this.rng.setState(s.rng);
    // nothing in flight from before
    Object.assign(this, {
      selected: null,
      reach: null,
      targets: null,
      inspect: null,
      anim: null,
      marchQueue: null,
      marchTarget: null,
      orderMode: null,
      pendingSkip: null,
      _undoFrom: null,
      _teleportLock: false,
      aimMode: false,
    });
    this.projectiles = [];
    this.particles = [];
    this.bolts = [];
    this.floaters = [];
    this._delayed = [];
  }
}
