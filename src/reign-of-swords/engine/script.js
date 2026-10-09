/* ============================================================
   Reign of Swords — scenario script runner (game.scenario)

   Its own object: `this` is the runner, the battle is `this.game` (its script state lives in game._sc, which the
   turn flow and the HUD read too). The battle calls in at a few points — init / runInitial at setup, onDeath /
   flush / onTileReached from the loop, checkFlags / tagUnit from the turn flow, resume / finish as dialogue closes.

   Runs the parts of the original scenario command VM that the legacy paths do not cover.
   Data: mission.script = { actions, triggers, initial, rounds } exported by tools/ros/export_levels.py
   straight from the .dat record (side-0 lists; see Mission::performAction / loadTriggers in the iOS binary).

   Already handled elsewhere (skipped here): battle-start spawns (initial), round-triggered spawns
   (waves.json) and round-triggered dialogue (battle_events.json).
   Handled here:
     tag 7  UNIT-LOST   [unitId, cmd]        - a scripted unit dies
     tag 6  TILE-REACHED [x, y, .., cmd]     - one of your units ends its move on the tile
     tag 8  COUNTER     [ctr, value, cmd]    - branch taken by op9 when the counter hits the value
     tag 0  flag-gated  [-1, -1, ctr, value, cmd] (Ep2) - fires once the counter reaches the value
     ops: 0 SPAWN, 1 SCREEN (dialogue), 2 CAMERA, 3 MOVE, 6 SHOW, 8 REMOVE, 9 COUNTER, 10 SETFLAG, 11 AIMODE
   Unit ids: the spawn command's template index (op0 arg 3) - verified on 5400/5406/5407/5428.
   Escort (Ep2 5428): escort.units must reach an escort marker tile; all delivered -> victory, one lost -> defeat.
   ============================================================ */
import { UNIT_TYPES } from "../data/game-data.js";
import { mixInto } from "../util/mixin.js";

// Mission::performAction's switch (iOS Ep2 @0x60b44, Ep1 @0x50f4c): op 4 → GameScreen::setUnitHide(id, false) and op 6
// → setUnitHide(id, true) in BOTH episodes — so 4 REVEALS and 6 HIDES (the Android reading had them the other way).
const OP = {
  SPAWN: 0,
  SCREEN: 1,
  CAMERA: 2,
  MOVE: 3,
  SHOW: 4,
  ATTACK: 5,
  HIDE: 6,
  TAG: 7,
  REMOVE: 8,
  COUNTER: 9,
  SETFLAG: 10,
  AIMODE: 11,
};

export const ScriptMethods = {
  // Called at the end of mission setup, after the fixed forces exist.
  init() {
    const script = this.game.mission && this.game.mission.script;
    this.game._sc = script
      ? {
          counters: {},
          flags: {},
          firedTrig: new Set(),
          doneAct: new Set(script.initial || []),
          queue: [],
          escortLeft: null,
          spawned: new Set(),
        }
      : null;
    if (!script) return;
    // ROUND triggers (tag 0 [round, group, ...]): the exporter turned the spawns and dialogue of their chains into
    // waves.json / battle_events.json, which the turn flow plays, so those actions are pre-marked done. A chain that
    // also steps a COUNTER or sets a FLAG carries logic that data can't express — The Wizard's Palace brings each enemy
    // wave through op9 → tag-8 branch — so the script engine fires that round chain itself (scenario.checkFlags), skipping
    // only its already-exported spawns / lines. (Pre-marking the head of such a chain as done killed the branch, so
    // neither wave ever came and the battle could never be won.)
    this.game._sc.roundScript = new Set();
    for (const trig of script.triggers) {
      if (trig.tag !== 0 || trig.a[0] < 0) continue;
      const head = trig.a[trig.a.length - 1],
        chain = [];
      for (let i = head, guard = 0; i >= 0 && i < script.actions.length && guard < 200; guard++) {
        chain.push(i);
        i = script.actions[i].next;
      }
      // …and so is a chain that hides / reveals units, orders an attack, tags a unit or sets a group's AI mode: the
      // exporter kept none of those (Precarious Pass's round-1 chain reveals the bandits hidden at the start). MOVE /
      // REMOVE stay with the exported scripted moves (scripts_ai moves → engine/deploy _fireScriptedMoves).
      const SCRIPT_ONLY = [OP.COUNTER, OP.SETFLAG, OP.SHOW, OP.HIDE, OP.ATTACK, OP.TAG, OP.AIMODE];
      if (chain.some((i) => SCRIPT_ONLY.includes(script.actions[i].op))) {
        this.game._sc.roundScript.add(head);
        for (const i of chain)
          if (script.actions[i].op === OP.SPAWN || script.actions[i].op === OP.SCREEN) this.game._sc.doneAct.add(i);
      } else this.game._sc.doneAct.add(head);
    }
    // tag every unit that stands on a battle-start spawn tile with its script id
    const bySid = {};
    for (const a of script.actions)
      if (a.op === OP.SPAWN && a.sid != null)
        (bySid[a.gi + ":" + a.x + "," + a.y] = bySid[a.gi + ":" + a.x + "," + a.y] || []).push(a.sid);
    for (const u of this.game.units) {
      const k = (u.group || 0) + ":" + u.tx + "," + u.ty;
      if (bySid[k] && bySid[k].length) {
        u.sid = bySid[k].shift();
        this.game._sc.spawned.add(u.sid);
      }
    }
    // AIMODE holds issued in the battle-start chain (unit already on the field)
    for (const i of script.initial || []) {
      const a = script.actions[i];
      if (!a) continue;
      if (a.op === OP.AIMODE) this.aiMode(a);
      else if (a.op === OP.HIDE) this.hide(a.a[0]);
    }
    if (script.escort && script.escort.units && script.escort.units.length) {
      this.game._sc.escortLeft = script.escort.units.slice();
      this.game._sc.delivered = 0;
      this.game._sc.escortReq = script.escort.required || script.escort.units.length;
    }
  },
  unit(sid) {
    return this.game.units.find((u) => !u.dead && u.sid === sid);
  },
  sideOf(groupIdx) {
    const group = this.game.mission.groupByGi && this.game.mission.groupByGi[groupIdx];
    return group ? group.side : groupIdx === this.game.mission.playerGroup ? "player" : "enemy";
  },
  // Wave spawns (engine/turnflow _fireWaves) call this so reinforcements get their script id too.
  // A wave unit takes the script id of a spawn action on its tile that has NOT taken the field yet in this battle
  // (this._sc.spawned). Several actions can share a tile — A Timely Rescue's west-wave footman spawns on the same
  // (7,1) as the opening bandit footman. So a mark on the ACTION won't do: it would hand the wave unit the opening
  // unit's id (whose unit-lost trigger already fired, so the kill never counts) and stick to the shared mission data
  // across retries — either way the kill counter falls short and the last wave never comes.
  tagUnit(u, x, y, groupIdx) {
    const script = this.game.mission && this.game.mission.script,
      S = this.game._sc;
    if (!script || !u || !S) return;
    const a = script.actions.find(
      (c) => c.op === OP.SPAWN && c.gi === groupIdx && c.x === x && c.y === y && c.sid != null && !S.spawned.has(c.sid),
    );
    if (a) {
      u.sid = a.sid;
      S.spawned.add(a.sid);
    }
  },
  // Battle start: play the tag-1 / tag-2 chains the way the original does — camera pans, the commander's line
  // (pause until dismissed), then scripted moves / removals — and hand over to `cb` when the chain ends. The
  // spawns of those chains are already on the field (fixed forces), so only the staging ops run.
  runInitial(cb) {
    const script = this.game.mission && this.game.mission.script;
    if (!script) {
      cb && cb();
      return;
    }
    const starts = script.triggers.filter((t) => t.tag === 1 || t.tag === 2).map((t) => t.a[0]);
    // also pick up entry tags the exporter did not keep in `triggers` (it stores 0/6/7/8/9/11): use `initial` heads —
    // but never a result screen (a victory / defeat sequence, tags 4/5): the skirmish battlefields' only scripts are
    // those two, and running the first as an "opening" ended the battle as a win once its line was read.
    const isEnding = (i) => !!(script.actions[i] && script.actions[i].end);
    const heads = (starts.length ? starts : [(script.initial || [])[0]]).filter((x) => x != null && !isEnding(x));
    const run = (k) => {
      if (k >= heads.length) {
        cb && cb();
        return;
      }
      this.exec(heads[k], { initial: true, cb: () => run(k + 1) });
    };
    run(0);
  },
  // Execute a command chain starting at action index `start` (follows `next`, stops at -1).
  // opts.initial: staging pass over the battle-start chain (SPAWNs skipped, SCREEN pauses, MOVE waits);
  // opts.cb: called when the chain (and its pauses) completes.
  exec(start, opts) {
    const script = this.game.mission.script,
      S = this.game._sc;
    if (!script || !S) return;
    opts = opts || {};
    let i = start,
      guard = 0,
      spawned = 0,
      spawnSide = null,
      cam = opts.cam || null;
    const lines = [];
    while (i >= 0 && i < script.actions.length && guard++ < 200) {
      const a = script.actions[i];
      let next = a.next;
      // Actions re-execute every time a chain reaches them (only TRIGGERS are one-shot); the legacy paths already
      // applied the battle-start and round-wave chains, so those indices are skipped here — except in the
      // staging pass, which replays everything but the spawns.
      const skip = a.op === OP.SPAWN ? S.doneAct.has(i) : S.doneAct.has(i) && !opts.initial;
      if (!skip) {
        switch (a.op) {
          case OP.SPAWN: {
            const team = this.spawn(a);
            if (team) {
              spawned++;
              spawnSide = team;
            }
            break;
          }
          case OP.SCREEN: // queue at once, so a nested chain (counter branch) cannot overtake these lines
            for (const line of a.lines || []) S.queue.push(Object.assign({ cam }, line));
            lines.push(1);
            if (a.end && !S.end) S.end = a.end; // the conversation ends on the result screen: the battle is over once read
            if (opts.initial && S.queue.length) {
              // staging: show now and PAUSE the chain until dismissed
              this.flush(true);
              if (this.game.battleEvent) {
                S.resume = { i: next, opts: Object.assign({}, opts, { cam }) };
                this.game._emit();
                return;
              }
            }
            break;
          case OP.CAMERA:
            cam = [a.a[0], a.a[1]];
            this.game.centerOn(cam[0], cam[1], true);
            break;
          case OP.MOVE:
            if (this.walk(a, next, Object.assign({}, opts, { cam }))) return; // the rest of the chain waits for the walk
            break;
          case OP.SHOW:
            this.show(a.a[0]);
            break;
          case OP.HIDE:
            this.hide(a.a[0]);
            break;
          case OP.REMOVE: {
            const u = this.unit(a.a[0]);
            if (u) this.game.units = this.game.units.filter((x) => x !== u);
            break;
          }
          case OP.COUNTER: {
            const counter = a.a[0];
            S.counters[counter] = (S.counters[counter] || 0) + 1;
            const branch = script.triggers.find(
              (t) => t.tag === 8 && t.a[0] === counter && t.a[1] === S.counters[counter],
            );
            if (branch) next = branch.a[2];
            // (a counter-gated ROUND trigger waits for the next turn start — see checkFlags)
            break;
          }
          case OP.SETFLAG:
            S.flags[0] = a.a[0];
            break;
          case OP.AIMODE:
            this.aiMode(a);
            break;
          default:
            break;
        }
      }
      i = next;
    }
    if (spawned > 0)
      this.game.wave = { side: spawnSide, count: spawned, id: (this.game._waveId = (this.game._waveId || 0) + 1) };
    if (lines.length) this.flush();
    this.game._emit();
    if (opts.cb) opts.cb();
  },
  // SPAWN: a scripted unit enters at its cell (or the nearest free one) for its group's side. Returns its team, or
  // null when there was no room / no such unit type.
  spawn(a) {
    const S = this.game._sc;
    const side = this.sideOf(a.gi),
      team = side === "enemy" ? "red" : "blue";
    const cell = this.game._freeSpawnCell(a.x, a.y);
    if (!cell || !UNIT_TYPES[a.key]) return null;
    const u = this.game._makeUnit(a.key, team, cell[0], cell[1], a.key === "king");
    u.group = a.gi;
    u.sid = a.sid;
    u.wave = true;
    if (side === "ally") u.ally = true;
    if (S.spawned) S.spawned.add(a.sid);
    if (a.a[3] === 1) u.face = -1;
    return team;
  },
  // MOVE: a scripted unit walks to (tx, ty) — by its real path when it has one, else straight there — and the chain
  // resumes at `next` (with `opts`) when it arrives. False when the unit isn't on the field (the chain just goes on).
  walk(a, next, opts) {
    const u = this.unit(a.a[2]);
    if (!u) return false;
    const [tx, ty] = a.a;
    u.acted = true;
    let path = null;
    try {
      path = this.game.pathTo(this.game.computeReach(u, 99), tx, ty);
    } catch (e) {
      path = null;
    }
    if (!path || path.length < 2)
      path = [
        { tx: u.tx, ty: u.ty },
        { tx, ty },
      ];
    this.game.centerOn(u.tx, u.ty, true);
    this.game.moveUnit(u, path, () => this.exec(next, opts), true);
    return true;
  },
  // The React overlay dismissed a scripted line: continue a paused staging chain.
  resume() {
    const S = this.game._sc;
    if (!S || !S.resume) return false;
    const resume = S.resume;
    S.resume = null;
    this.exec(resume.i, resume.opts);
    return true;
  },
  // HIDE / SHOW — GameScreen::setUnitHide(id, hidden) → Unit::setIsHidden: the unit stays on its tile, hidden the way
  // a Stealth unit hides (unseen and untargetable by its enemies) until a SHOW — or, for a unit that can hide itself,
  // until its own end-of-turn hide rule says otherwise.
  hide(sid) {
    const u = this.unit(sid);
    if (u) this.game._setHidden(u, true);
  },
  show(sid) {
    const u = this.unit(sid);
    if (u) this.game._setHidden(u, false);
  },
  aiMode(a) {
    const u = this.unit(a.a[0]);
    if (!u) return;
    // Mission::performAction op 11 (@0x60f7c): mode 1 → the unit's marker GROUP enters mode 2 = HOLD its initial centre
    // (flag7 = 0); anything else → mode 0 = advance in formation on the player's concentration (ai/grouplogic.js).
    this.game.ai._glSetMode(u, a.a[1]);
    u._home = null;
  },
  // Ep2 counter-gated round triggers: [round=-1, group=-1, counter, value, cmd] — and the ROUND triggers whose chain the
  // script engine runs itself (roundScript, see scenario.init): they fire once, at the top of their round.
  // Mission::getSequenceOnTurn (iOS Ep2 @0x5ff2c) is asked only as a TURN-START banner closes (hideCurrentMenu
  // @0x1f714, menus 35 "Player Turn Start" / 36 "CPU Turn Start"): a counter that reaches its value mid-turn brings its
  // chain at the next turn start, the player's or an AI army's (Zayandi Shores: the second ambush comes when the turn
  // after the first squad's fall begins). `countersOnly` — an AI army's turn start: only the counter-gated ones.
  checkFlags(countersOnly = false) {
    const script = this.game.mission && this.game.mission.script,
      S = this.game._sc;
    if (!script || !S) return;
    script.triggers.forEach((trig, k) => {
      if (trig.tag === 0 && trig.a[0] >= 0) {
        if (countersOnly) return;
        const head = trig.a[trig.a.length - 1];
        if (
          !S.roundScript ||
          !S.roundScript.has(head) ||
          S.firedTrig.has("r" + k) ||
          trig.a[0] !== (this.game.turn || 1)
        )
          return;
        if (trig.a.length >= 5 && trig.a[2] >= 0 && (S.counters[trig.a[2]] || 0) !== trig.a[3]) return;
        S.firedTrig.add("r" + k);
        this.exec(head);
        return;
      }
      if (trig.tag !== 0 || trig.a[0] >= 0 || S.firedTrig.has("f" + k)) return;
      const counter = trig.a[2],
        val = trig.a[3];
      if (counter >= 0 && (S.counters[counter] || 0) === val) {
        S.firedTrig.add("f" + k);
        this.exec(trig.a[trig.a.length - 1]);
      }
    });
  },
  // Poll from the update loop: scripted units that died fire their UNIT-LOST triggers (tag 7) once.
  onDeath() {
    const script = this.game.mission && this.game.mission.script,
      S = this.game._sc;
    if (!script || !S) return;
    for (const u of this.game.units) {
      if (u.sid == null || !u.dead || u._lostFired) continue;
      u._lostFired = true;
      let escortFail = false;
      if (S.escortLeft && S.escortLeft.includes(u.sid)) {
        // an escorted unit fell
        S.escortLeft = S.escortLeft.filter((s) => s !== u.sid);
        escortFail = S.escortLeft.length + S.delivered < S.escortReq; // too few left to make the required deliveries
      }
      script.triggers.forEach((trig, k) => {
        if (trig.tag === 7 && trig.a[0] === u.sid && !S.firedTrig.has("u" + k)) {
          S.firedTrig.add("u" + k);
          this.exec(trig.a[1]);
        }
      });
      if (escortFail) {
        // The record's own ending comes first: Warning Caladrin's counter trigger has just queued "Our escort has
        // failed…" + defeat — show it, then lose (as the escort) once it is read (scenario.finish).
        if (S.end) {
          S.endReason = "escort";
          return;
        }
        this.game.phase = this.game._lose("escort");
        this.game._emit();
        return;
      }
    }
  },
  // A unit finished a move: TILE-REACHED triggers (tag 6, your units) and escort delivery.
  onTileReached(u) {
    const script = this.game.mission && this.game.mission.script,
      S = this.game._sc;
    if (!script || !S || !u || u.dead) return;
    // TILE-REACHED: Ep2 [x, y, counter, count, team, cmd] / Ep1 [x, y, cmd] (GameScreen::checkLocationTriggers @0x272c8).
    // The list is the player side's (faction 0), so only your side's units trip it; team -1 = any of them. With a
    // counter (>= 0) it fires only while counters[counter] == count and then bumps that counter — so a whole band of
    // tiles springs ONE ambush, and only once the story has reached that point (Zayandi Shores' road guards wait for
    // the second ambush to be cleared); without one it is a plain one-shot per tile.
    if (u.team !== "blue") {
      /* enemy units never trip the player's tile triggers */
    } else
      script.triggers.forEach((trig, k) => {
        if (trig.tag !== 6 || trig.a[0] !== u.tx || trig.a[1] !== u.ty) return;
        const isEp2 = trig.a.length >= 6,
          team = isEp2 ? trig.a[4] : -1,
          counter = isEp2 ? trig.a[2] : -1,
          count = isEp2 ? trig.a[3] : -1;
        if (team >= 0 && (u.group || 0) !== team) return;
        if (counter >= 0) {
          if ((S.counters[counter] || 0) !== count) return;
          S.counters[counter] = (S.counters[counter] || 0) + 1;
        } else {
          if (S.firedTrig.has("t" + k)) return;
          S.firedTrig.add("t" + k);
        }
        this.game._commitMove(u); // a tile trigger fired: no undo
        this.exec(trig.a[trig.a.length - 1]);
      });
    // ESCAPE missions (header type 3): one of your units reaching the goal area leaves the field to safety;
    // tag 9 [n, ?, cmd] fires when the n-th unit has escaped.
    if (
      this.game.mission.missionType === 3 &&
      script.goals &&
      script.goals.length &&
      u.team === "blue" &&
      !u.ally &&
      !S.escortLeft &&
      script.goals.some(([gx, gy]) => gx === u.tx && gy === u.ty)
    ) {
      this.game._commitMove(u); // left the field: no undo
      S.escaped = (S.escaped || 0) + 1;
      this.game.units = this.game.units.filter((x) => x !== u);
      this.game.floaters &&
        this.game.floaters.push({
          x: u.px + this.game.tile / 2,
          y: u.py - 6,
          t: 0,
          life: 1.6,
          vy: -12,
          text: "Escaped!",
          crit: true,
          heal: true,
        });
      script.triggers.forEach((trig, k) => {
        if (trig.tag === 9 && trig.a[0] === S.escaped && !S.firedTrig.has("g" + k)) {
          S.firedTrig.add("g" + k);
          this.exec(trig.a[trig.a.length - 1]);
        }
      });
      const need = Math.max(0, ...script.triggers.filter((t) => t.tag === 9).map((t) => t.a[0]));
      const left = this.game.units.filter((x) => !x.dead && x.team === "blue" && !x.ally).length;
      if ((need && S.escaped >= need) || (!need && left === 0)) this.game.phase = "victory";
      this.game._emit();
    }
    if (
      S.escortLeft &&
      u.sid != null &&
      S.escortLeft.includes(u.sid) &&
      script.escort.markers.some(([mx, my]) => mx === u.tx && my === u.ty)
    ) {
      this.game._commitMove(u); // delivered: no undo
      S.escortLeft = S.escortLeft.filter((s) => s !== u.sid);
      S.delivered++;
      this.game.units = this.game.units.filter((x) => x !== u); // delivered — leaves the field
      this.game.floaters &&
        this.game.floaters.push({
          x: u.px + this.game.tile / 2,
          y: u.py - 6,
          t: 0,
          life: 1.6,
          vy: -12,
          text: "Escorted to safety!",
          crit: true,
          heal: true,
        });
      if (S.delivered >= S.escortReq) {
        // GameScreen::UnitInEscortSafetyRegion (iOS Ep2 @0x23dd8): the escort trigger (tag 11 [count, cmd]) runs its
        // command — Warning Caladrin's 79 says "the Craftsmen have made it safely inside the city walls" and ends the
        // battle on that screen — so, as for the failed escort, the victory comes once it is read (scenario.finish)
        if (script.escort.doneCmd >= 0) this.exec(script.escort.doneCmd);
        if (!S.end) this.game.phase = "victory";
      }
      this.game._emit();
    }
  },
  // Show queued scripted dialogue when the player can read it (player phase, nothing animating).
  flush(force) {
    const S = this.game._sc;
    if (S && !S.queue.length) this.finish();
    if (!S || !S.queue.length) return;
    if (
      this.game.battleEvent ||
      (!force && this.game.anim) ||
      this.game.phase === "victory" ||
      this.game.phase === "defeat"
    )
      return; // deploy too: the opening chain speaks over the muster (openBattle)   // shows during AI turns too (the AI pauses on it)
    const lines = S.queue.splice(0, S.queue.length);
    this.game._noteShownLines(lines);
    this.game.battleEvent = { lines, id: (this.game._eventId = (this.game._eventId || 0) + 1) };
    this.game.focusEventLine(0);
    this.game._emit(); // the React overlay only shows a beat it has been told about (the loop's per-tick flush never emitted)
  },
  // A conversation whose screen chain ends on the result screen — "Spoils of War" (victory) / "Units Lost" (defeat) —
  // ENDS the battle once its lines are read (Marsur 3: the garrison yields when its commander falls or your troops
  // reach the keep; Sangsoleil 3: the attackers flee when their leader falls). A plain victory, not a Major one
  // (checkOutcome's outcome 3 is an elimination win). Returns true when it ended the battle.
  finish() {
    const S = this.game._sc;
    if (
      !S ||
      !S.end ||
      S.queue.length ||
      this.game.battleEvent ||
      this.game.phase === "victory" ||
      this.game.phase === "defeat"
    )
      return false;
    this.game.phase = S.end === "victory" ? "victory" : this.game._lose(S.endReason || "script");
    this.game._emit();
    return true;
  },
};

export class ScenarioRunner {
  constructor(game) {
    this.game = game;
  }
}
mixInto(ScenarioRunner, { ScriptMethods }, "ScenarioRunner");
