// Online battles (engine/online.js): two devices — two Game instances here — play one hot-seat battle. Each musters
// only its own army; every command of the mover is replayed on the watcher, which must end each turn in exactly the
// same state (compared through the stored snapshot); a drifted or reconnecting device loads the snapshot.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, settle } from "./battle.js";
import { canonical } from "../engine/online.js";

beforeAll(() => loadEpisode(1));

const PICKET_FIELD = 5210; // West (host) vs East (guest)

function pair({ first = 0, seed = 12345, terms = { budget: 3500 } } = {}) {
  const sent = { 0: [], 1: [] },
    turns = [],
    deploys = {};
  const make = (me) => {
    const g = makeGame(PICKET_FIELD, { god: false });
    g.setOnline({
      me,
      seed,
      first,
      names: ["Host", "Guest"],
      ...terms,
      send: (cmd) => sent[me].push(cmd),
      onDeploy: (army) => (deploys[me === 0 ? "host" : "guest"] = army),
      onTurnEnd: (snap, info) => turns.push({ snap, ...info }),
    });
    g.reset();
    return g;
  };
  return { A: make(0), B: make(1), sent, turns, deploys };
}
const zone = (g) => [...g.deployZone].map((k) => k.split(",").map(Number));
// deliver one device's sent commands to the other and let it replay them
function deliver(from, to, sent, idx) {
  for (const cmd of sent[idx].splice(0)) to.onlineReceive(cmd);
  for (let i = 0; i < 4000; i++) {
    to.update(0.05);
    if (!to.online.expect || (!to.online.inbox.size && to._onlineIdle())) break;
  }
  settle(to);
}
const state = (g) => canonical(g.onlineSnapshot());
const mine = (g) => g.units.filter((u) => !u.dead && u.team === "blue");

describe("online battles", () => {
  it("each side deploys with its own gold and Medals when the battle sets them", () => {
    const { A, B } = pair({ terms: { budgets: [2000, 4500], elites: [1, null] } });
    expect(A.mission.deploy.budget).toBe(2000);
    expect(A._hsEliteSlots()).toBe(1);
    expect(B.mission.deploy.budget).toBe(4500);
    expect(B._hsEliteSlots()).toBe(null); // the rule: 1 per 1000 gold
  });
  it("each device musters only its own army, in its own blocks; the battle opens when both are in", () => {
    const { A, B, deploys } = pair();
    expect(A.hs.active).toBe(0);
    expect(B.hs.active).toBe(1); // the guest musters as player 2 at once, no hand-over screen
    const [ax, ay] = zone(A)[0],
      [bx, by] = zone(B)[0];
    expect(zone(A).some(([x, y]) => x === bx && y === by)).toBe(false);
    A.placeUnit("militiamen", ax, ay);
    B.placeUnit("archers", bx, by);
    A.startBattle();
    B.startBattle();
    expect(deploys.host).toEqual([{ type: "militiamen", tx: ax, ty: ay, hero: false }]);
    expect(deploys.guest).toEqual([{ type: "archers", tx: bx, ty: by, hero: false }]);
    expect(A.phase).toBe("deploy"); // waiting for the opponent
    A.onlineBegin(deploys);
    B.onlineBegin(deploys);
    for (const g of [A, B]) {
      expect(g.phase).toBe("player");
      expect(g.units.map((u) => [u.id, u.type, u.tx, u.ty])).toEqual([
        [A.units[0].id, "militiamen", ax, ay],
        [A.units[1].id, "archers", bx, by],
      ]);
    }
    expect(A.onlineMyTurn()).toBe(true); // the host moves first here
    expect(B.onlineMyTurn()).toBe(false);
  });

  it("the watcher replays the mover's turn live and ends it in the very same state, then it's their turn", () => {
    const { A, B, sent, turns, deploys } = pair();
    const za = zone(A),
      zb = zone(B);
    A.placeUnit("militiamen", ...za[0]);
    A.placeUnit("footmen", ...za[1]);
    B.placeUnit("archers", ...zb[0]);
    B.placeUnit("militiamen", ...zb[1]);
    A.startBattle();
    B.startBattle();
    A.onlineBegin(deploys);
    B.onlineBegin(deploys);
    expect(state(A)).toBe(state(B));

    // the host's turn: select a unit, move it somewhere it can reach, end the turn
    const u = mine(A)[0];
    A.click({ tx: u.tx, ty: u.ty });
    const dest = [...A.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => x !== u.tx || y !== u.ty);
    A.click({ tx: dest[0], ty: dest[1] });
    settle(A);
    B.click({ tx: dest[0], ty: dest[1] }); // the watcher can't touch the field
    expect(sent[1]).toEqual([]);
    A._playerTurnAt = -1e9;
    A.endTurn();
    settle(A);
    expect(turns.map((t) => [t.mover, t.turn])).toEqual([[0, 1]]);
    expect(A.onlineMyTurn()).toBe(false);

    deliver(A, B, sent, 0);
    expect(B.onlineMyTurn()).toBe(true);
    expect(B.units.find((x) => x.id === u.id)).toMatchObject({ tx: dest[0], ty: dest[1] });
    expect(state(B)).toBe(state(A)); // identical battles, the dice too
    expect(B.onlineSync(turns[0].snap, 0)).toBe(false); // nothing to fix

    // and back: the guest's turn replayed on the host
    const v = mine(B)[0];
    B.click({ tx: v.tx, ty: v.ty });
    const d2 = [...B.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => x !== v.tx || y !== v.ty);
    B.click({ tx: d2[0], ty: d2[1] });
    settle(B);
    B._playerTurnAt = -1e9;
    B.endTurn();
    settle(B);
    deliver(B, A, sent, 1);
    expect(A.onlineMyTurn()).toBe(true);
    expect(state(A)).toBe(state(B));
    expect(A.turn).toBe(2);
  });

  it("units that traded blows (pointing at each other) still hand the turn over — the live-test hang", () => {
    const { A, B, sent, turns, deploys } = pair();
    A.placeUnit("militiamen", ...zone(A)[0]);
    B.placeUnit("archers", ...zone(B)[0]);
    A.startBattle();
    B.startBattle();
    A.onlineBegin(deploys);
    B.onlineBegin(deploys);
    for (const g of [A, B]) {
      const [a, b] = g.units;
      a.hitPending = b; // what combat leaves behind after a strike and its counter
      b.hitPending = a;
      a.lastFoe = { unit: b, at: [b.tx, b.ty] }; // any other pointer to a unit is dropped too
    }
    A._playerTurnAt = -1e9;
    A.endTurn();
    settle(A);
    expect(A.hs.handover).toBe(null);
    expect(A.onlineMyTurn()).toBe(false);
    expect(turns.map((t) => [t.mover, t.turn])).toEqual([[0, 1]]);
    expect(JSON.stringify(turns[0].snap)).not.toContain("hitPending");
    deliver(A, B, sent, 0);
    expect(B.hs.handover).toBe(null);
    expect(B.onlineMyTurn()).toBe(true);
    expect(state(B)).toBe(state(A));
  });

  it("a device that missed the turn (or reconnects) loads the stored snapshot and opens its own turn", () => {
    const { A, B, sent, turns, deploys } = pair();
    A.placeUnit("militiamen", ...zone(A)[0]);
    B.placeUnit("archers", ...zone(B)[0]);
    A.startBattle();
    B.startBattle();
    A.onlineBegin(deploys);
    B.onlineBegin(deploys);
    const u = mine(A)[0];
    A.click({ tx: u.tx, ty: u.ty });
    const dest = [...A.reach.stops].map((k) => k.split(",").map(Number)).find(([x, y]) => x !== u.tx || y !== u.ty);
    A.click({ tx: dest[0], ty: dest[1] });
    settle(A);
    A._playerTurnAt = -1e9;
    A.endTurn();
    settle(A);
    sent[0].length = 0; // every live message lost
    expect(B.onlineSync(turns[0].snap, 0)).toBe(true);
    expect(B.onlineMyTurn()).toBe(true);
    expect(B.units.find((x) => x.id === u.id)).toMatchObject({ tx: dest[0], ty: dest[1] });
    expect(state(B)).toBe(state(A));
  });

  it("an attack (with its dice) replays to the same result on the watcher", () => {
    const { A, B, sent, turns } = pair();
    const [hx, hy] = zone(A)[0];
    // the guest's militia 3 tiles from the host's archers, on open ground (deploys can be anywhere in a test)
    let target = null;
    for (let y = 0; y < A.rows && !target; y++)
      for (let x = 0; x < A.cols && !target; x++) {
        const d = Math.abs(x - hx) + Math.abs(y - hy);
        if (d === 3 && A.terrainAt(x, y).passable !== false) target = [x, y];
      }
    const deploys = {
      host: [{ type: "archers", tx: hx, ty: hy, hero: false }],
      guest: [
        { type: "militiamen", tx: target[0], ty: target[1], hero: false },
        { type: "militiamen", tx: zone(B)[0][0], ty: zone(B)[0][1], hero: false },
      ],
    };
    A.onlineBegin(deploys);
    B.onlineBegin(deploys);
    const archer = mine(A)[0];
    A.click({ tx: archer.tx, ty: archer.ty });
    A.click({ tx: target[0], ty: target[1] }); // shoot
    settle(A);
    const hit = A.units.find((u) => u.tx === target[0] && u.ty === target[1]);
    expect(!hit || hit.dead || hit.hp < 100).toBe(true); // it was struck
    A._playerTurnAt = -1e9;
    A.endTurn();
    settle(A);
    deliver(A, B, sent, 0);
    expect(state(B)).toBe(state(A));
    expect(B.onlineSync(turns[0].snap, 0)).toBe(false);
  });

  it("the snapshot carries the dice: the next rolls match after a restore", () => {
    const { A, deploys, B } = pair();
    A.placeUnit("militiamen", ...zone(A)[0]);
    B.placeUnit("archers", ...zone(B)[0]);
    A.startBattle();
    B.startBattle();
    A.onlineBegin(deploys);
    B.onlineBegin(deploys);
    A.rng();
    A.rng();
    const snap = A.onlineSnapshot();
    B.onlineRestore(snap);
    expect([A.rng(), A.rng()]).toEqual([B.rng(), B.rng()]);
  });
});
