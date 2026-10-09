/* ============================================================
   Reign of Swords — debug snapshot (a Game mixin).

   "🐞 Debug" in the battle bar copies a JSON snapshot of the battle to the clipboard so a problem can be sent
   with its full context: map, turn, phase, every unit (position, HP, state, group, AI routing), structures, tiles,
   script / wave / group-logic state, and a log of the last moves, attacks and casts (who went where, and why it
   was aimed there). `debugLoad(snapshot)` rebuilds that position on the same map for reproduction (dev console:
   `__reign.debugLoad(json)` after jumping to the map).
   ============================================================ */
const LOG_MAX = 400;
const ROLLS_MAX = 2000; // a whole battle's rolls
const pos = (u) => (u ? [u.tx, u.ty] : null);
const sv = (s) => (s instanceof Set ? [...s] : s);

export const DebugMethods = {
  // One line of the decision log: the turn, the phase, what happened. Kept short (the last LOG_MAX entries).
  _dbg(kind, data) {
    const log = this._dbgLog || (this._dbgLog = []);
    log.push({ t: this.turn, ph: this.phase, k: kind, ...data });
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  },
  // EVERY GAMEPLAY DICE ROLL (war-engine deviation + its direction, the Fear courage check, the Lightning Storm's
  // cells): one readable line in the browser console (every build — the live site too), a "roll" entry in the
  // decision log, and the same line in the battle's own roll list (`rolls` in the snapshot, every roll of this
  // battle, beside its `seed`), so a streak can be checked against the real numbers. `text` is the line, `data` the entry.
  _roll(text, data) {
    this._dbg("roll", data);
    const line = "T" + this.turn + " " + text;
    const rolls = this._rolls || (this._rolls = []);
    rolls.push(line);
    if (rolls.length > ROLLS_MAX) rolls.splice(0, rolls.length - ROLLS_MAX);
    console.info("[ROS roll] " + line);
  },
  // The AI's reasons for a move, recorded by the movers just before the unit walks (ai/ai.js).
  _dbgAim(u, info) {
    if (u) u._dbgAim = info;
  },

  debugDump() {
    const mission = this.mission || {};
    const units = this.units.map((u) => ({
      id: u.id,
      type: u.type,
      team: u.team,
      ally: !!u.ally,
      group: u.group,
      hero: !!u.hero,
      at: pos(u),
      // where its SPRITE is drawn (in tiles) — only when that is not its tile, so a "drawn on the wrong tile" report
      // carries the evidence
      drawn:
        Math.abs(u.px - u.tx * this.tile) > 0.5 || Math.abs(u.py - u.ty * this.tile) > 0.5
          ? [+(u.px / this.tile).toFixed(2), +(u.py / this.tile).toFixed(2)]
          : undefined,
      teleporting: u._teleporting || undefined,
      hp: Math.round(u.hp),
      dead: !!u.dead,
      acted: !!u.acted,
      attacked: !!u.attackedTurn,
      hidden: !!u._hidden,
      spell: u.spell || undefined,
      walled: !!u.walled || undefined,
      spawn: pos(u.spawn),
      portal: u._portalIdx != null && u._portalIdx >= 0 ? u._portalIdx : undefined,
      glc: u._glc || undefined,
      aim: u._dbgAim || undefined,
    }));
    const gl = {};
    for (const [k, group] of Object.entries(this._gl || {}))
      gl[k] = {
        mode: group.mode,
        center: group.center,
        dest: group.dest,
        next: group.next,
        f50: group.f50,
        f51: group.f51,
      };
    const S = this._sc;
    return {
      v: 1,
      at: new Date().toISOString(),
      ep: mission.ep || (location.pathname.includes("-2") ? 2 : 1),
      mapId: mission.mapId,
      name: mission.name,
      turn: this.turn,
      phase: this.phase,
      seed: this.seed, // the battle's dice (engine.js: a fresh one per battle in real play)
      cols: this.cols,
      rows: this.rows,
      selected: this.selected ? this.selected.id : null,
      units,
      structHp: this.structHp ? [...this.structHp.entries()] : [],
      tiles: this.tiles ? [...this.tiles] : null,
      firedWaves: sv(this._firedWaves) || [],
      script: S
        ? {
            counters: S.counters,
            flags: S.flags,
            firedTrig: sv(S.firedTrig),
            doneAct: sv(S.doneAct),
            spawned: sv(S.spawned),
          }
        : null,
      groups: gl,
      log: this._dbgLog || [],
      rolls: this._rolls || [], // every dice roll of this battle, as the console prints it
      ua: navigator.userAgent,
    };
  },

  // Rebuild a snapshot on the SAME map (already loaded): units by id (missing ones created), positions, HP and
  // state, structures, tiles, fired waves, script state; then it is the player's turn of that round.
  debugLoad(snap) {
    const data = typeof snap === "string" ? JSON.parse(snap) : snap;
    if (!data || (this.mission && data.mapId !== this.mission.mapId))
      throw new Error("load map " + (data && data.mapId) + " first");
    const tile = this.tile;
    const keep = new Set();
    for (const saved of data.units) {
      if (saved.dead) continue;
      let u = this.units.find((x) => x.id === saved.id);
      if (!u) {
        u = this._makeUnit(saved.type, saved.team, saved.at[0], saved.at[1], saved.hero);
        u.id = saved.id;
        this._nid = Math.max(this._nid, saved.id + 1);
      }
      Object.assign(u, {
        type: saved.type,
        team: saved.team,
        ally: saved.ally,
        group: saved.group,
        tx: saved.at[0],
        ty: saved.at[1],
        px: saved.at[0] * tile,
        py: saved.at[1] * tile,
        hp: saved.hp,
        dead: false,
        acted: false,
        attackedTurn: false,
        _hidden: saved.hidden,
        walled: !!saved.walled,
        _glc: undefined,
      });
      if (saved.spell) u.spell = saved.spell;
      keep.add(u.id);
    }
    this.units = this.units.filter((u) => keep.has(u.id));
    if (data.structHp) this.structHp = new Map(data.structHp);
    if (data.tiles && this.tiles && data.tiles.length === this.tiles.length) this.tiles = data.tiles.slice();
    if (data.firedWaves) this._firedWaves = new Set(data.firedWaves);
    if (data.script && this._sc)
      Object.assign(this._sc, {
        counters: data.script.counters,
        flags: data.script.flags,
        firedTrig: new Set(data.script.firedTrig),
        doneAct: new Set(data.script.doneAct),
        spawned: new Set(data.script.spawned),
      });
    this._gl = {};
    this.turn = data.turn;
    this.phase = "player";
    this.anim = null;
    this.aiQueue = null;
    this.selected = null;
    this._delayed = [];
    this._aiSchedule = null;
    this._groupCursor = false;
    this._teleportLock = false; // drop any pending opening / AI cycle
    this._pendingEnemyOpen = false;
    this._pendingDrillWin = false;
    this.battleEvent = null;
    this._playerTurnAt = 0;
    this._dbgLog = data.log ? data.log.slice() : [];
    this._rolls = data.rolls ? data.rolls.slice() : [];
    if (data.seed != null) this.seed = data.seed;
    this._emit();
    return this.units.length;
  },
};
