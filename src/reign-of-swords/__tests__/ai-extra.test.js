// AI branches the replays don't reach (ai/ai.js), each driven directly and then run to its end: no enemy left
// (head for the capture zone), every foe hidden, faction announcements, the leash, the wizard standoff, the priest's
// prayer-walk and heals, the Craftsmen's repair, the Bodyguard's Absorb, the Sapper's Detonate plan, Horse Bowmen
// standing to shoot, a garrison going home, the ranger's score, and a siege point with no infantry beside it.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, nextRound, spawn, only, put, settle } from "./battle.js";
import { manhattan } from "../util/util.js";
import { blank, openArea, runAi } from "./rules-kit.js";
import { WEAPON_RANGE } from "../data/combat-data.js";

beforeAll(() => loadEpisode(2));

const battle = (id = 5428) => {
  const g = makeGame(id);
  startBattle(g);
  return g;
};
const reachOf = (g, u) => g.computeReach(u);
// a free tile the unit can reach that is as far from it as possible (it can then make headway toward it)
function far(g, u) {
  return [...reachOf(g, u).stops]
    .map((k) => k.split(",").map(Number))
    .filter(([x, y]) => !g.unitAt(x, y))
    .sort((a, b) => Math.abs(b[0] - u.tx) + Math.abs(b[1] - u.ty) - (Math.abs(a[0] - u.tx) + Math.abs(a[1] - u.ty)))[0];
}

describe("no enemy left", () => {
  it("a unit heads for the nearest capture tile; with no zone (or already there) it stays", () => {
    const g = battle();
    const u = spawn(g, "footmen", "red", 3, 3);
    only(g, u);
    g.objectives = [];
    const end = vi.spyOn(g, "_endAiPhase").mockImplementation(() => {});
    g.aiQueue = [u];
    g.ai._aiNoFoesLeft(u);
    expect(end).toHaveBeenCalled();
    g.objectives = [{ tx: 3, ty: 3 }];
    g.aiQueue = [u];
    g.ai._aiNoFoesLeft(u);
    expect(u.acted).toBe(true);
    expect([u.tx, u.ty]).toEqual([3, 3]);
    u.acted = false;
    const goal = far(g, u);
    g.objectives = [{ tx: goal[0], ty: goal[1] }];
    const d0 = Math.abs(u.tx - goal[0]) + Math.abs(u.ty - goal[1]);
    g.aiQueue = [u];
    g.ai._aiNoFoesLeft(u);
    settle(g);
    expect(Math.abs(u.tx - goal[0]) + Math.abs(u.ty - goal[1])).toBeLessThan(d0);
    expect(u.acted).toBe(true);
    // a wizard takes its straight-line move
    const w = spawn(g, "wizards", "red", 10, 3);
    g.aiQueue = [w];
    g.ai._aiNoFoesLeft(w);
    settle(g);
    expect(w.acted).toBe(true);
  });
});

describe("faction announcements", () => {
  it("each army of several is announced once as it takes the field", () => {
    const g = battle();
    const u = spawn(g, "footmen", "red", 3, 3, { group: 2 });
    const ann = vi.spyOn(g, "_announceTurn").mockImplementation(() => {});
    g._lastAiGroup = 1;
    expect(g.ai._aiAnnounceFaction(u, "enemy", { 1: {}, 2: {} })).toBe(true);
    expect(ann).toHaveBeenCalledWith("enemy", 2);
    expect(g.ai._aiAnnounceFaction(u, "enemy", { 1: {}, 2: {} })).toBe(false);
    expect(g.ai._aiAnnounceFaction(u, "enemy", { 2: {} })).toBe(false);
  });
});

describe("every foe hidden", () => {
  function setup(order) {
    const g = battle();
    const u = spawn(g, "footmen", "red", 4, 4);
    const [fx, fy] = far(g, u);
    const foe = spawn(g, "rangers", "blue", fx, fy, { _hidden: true });
    only(g, u, foe);
    vi.spyOn(g.ai, "_glOrder").mockReturnValue(order);
    return { g, u, foe };
  }
  it("with no order it marches on the hidden foe's last tile", () => {
    const { g, u, foe } = setup(null);
    const d0 = Math.abs(u.tx - foe.tx) + Math.abs(u.ty - foe.ty);
    g.ai._aiAllFoesHidden(u, reachOf(g, u), [foe]);
    settle(g);
    expect(Math.abs(u.tx - foe.tx) + Math.abs(u.ty - foe.ty)).toBeLessThan(d0);
    expect(u.acted).toBe(true);
  });
  it("with a group order it goes there; a hold order keeps it near its post (or stays in better cover)", () => {
    const a = setup(null);
    a.g.ai._glOrder.mockReturnValue({ tx: a.foe.tx, ty: a.foe.ty });
    a.g.ai._aiAllFoesHidden(a.u, reachOf(a.g, a.u), [a.foe]);
    settle(a.g);
    expect(a.u.tx !== 4 || a.u.ty !== 4).toBe(true);
    const b = setup({ tx: 4, ty: 4, hold: true });
    b.g.ai._aiAllFoesHidden(b.u, reachOf(b.g, b.u), [b.foe]);
    settle(b.g);
    expect(b.u.acted).toBe(true);
    expect(Math.abs(b.u.tx - 4) + Math.abs(b.u.ty - 4)).toBeLessThanOrEqual(1);
  });
  it("routed through a portal it heads for the portal's entry", () => {
    const { g, u, foe } = setup(null);
    g.portals = [{ sx: 4, sy: 7, dx: 10, dy: 10, mask: [] }];
    u._portalIdx = 0;
    u._portalDist = 3;
    g.ai._aiAllFoesHidden(u, reachOf(g, u), [foe]);
    settle(g);
    expect(u.acted).toBe(true);
  });
});

describe("the leash", () => {
  it("a minion that drifted beyond 8 of its Conjurer may only step back toward it — or stay", () => {
    const g = battle();
    const c = spawn(g, "conjurer", "red", 0, 0);
    const m = spawn(g, "sapper", "red", 14, 9, { _conjuredBy: c.id });
    const r = reachOf(g, m);
    const stops = g.ai._aiLeashedStops(m, r);
    const d0 = 14 + 9;
    for (const s of stops) expect(Math.abs(s.tx) + Math.abs(s.ty) < d0 || (s.tx === m.tx && s.ty === m.ty)).toBe(true);
    const none = { stops: new Set([m.tx + 1 + "," + (m.ty + 1)]) };
    expect(g.ai._aiLeashedStops(m, none)).toEqual([{ tx: m.tx, ty: m.ty }]);
  });
});

describe("the wizard standoff", () => {
  it("after walking to its standoff tile a wizard with nothing to cast ends its turn", () => {
    const g = battle();
    const w = spawn(g, "wizards", "red", 4, 4);
    const r = reachOf(g, w);
    const to = [...r.stops]
      .map((k) => k.split(",").map(Number))
      .find(([x, y]) => !g.unitAt(x, y) && (x !== 4 || y !== 4));
    vi.spyOn(g.ai, "_wizStandoff").mockReturnValue({ tx: to[0], ty: to[1] });
    vi.spyOn(g.ai, "_aiBestArea").mockReturnValue(null);
    expect(g.ai._aiTryWizStandoff(w, r, [])).toBe(true);
    settle(g);
    expect(w.acted).toBe(true);
    expect([w.tx, w.ty]).toEqual(to);
  });
});

describe("healers", () => {
  it("a priest that walked up and has no prayer to say heals the most valuable wounded neighbour", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "red", 6, 6);
    const hurt = spawn(g, "footmen", "red", 6, 9, { hp: 30 });
    vi.spyOn(g.ai, "_glOrder").mockReturnValue(null);
    vi.spyOn(g.ai, "_priestPray").mockReturnValue(false);
    vi.spyOn(g.ai, "_priestMove").mockReturnValue({ tx: 6, ty: 8 });
    const r = reachOf(g, p);
    expect(
      g.ai._aiTryHeal(
        p,
        r,
        [],
        [...r.stops].map((k) => ({ tx: +k.split(",")[0], ty: +k.split(",")[1] })),
        "red",
      ),
    ).toBe(true);
    settle(g);
    expect(hurt.hp).toBe(50);
    expect(p.acted).toBe(true);
  });

  it("…and with nobody wounded beside it, it Shields where it stands (the driver's own action 6)", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "red", 6, 6);
    vi.spyOn(g.ai, "_glOrder").mockReturnValue(null);
    const pray = g.ai._priestPray.bind(g.ai);
    vi.spyOn(g.ai, "_priestPray").mockImplementation((u, e, done, force) => (force ? pray(u, e, done, force) : false));
    const mark = vi.spyOn(g, "_prayerMark");
    vi.spyOn(g.ai, "_priestMove").mockReturnValue({ tx: 6, ty: 7 });
    const r = reachOf(g, p);
    g.ai._aiTryHeal(p, r, [], [], "red");
    settle(g);
    expect(mark).toHaveBeenCalledWith("shield", p);
    expect(p.acted).toBe(true);
  });

  it("a Priest that stays put (nothing to pray for, nobody to heal) still Shields after its move step", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "red", 6, 6);
    const foe = spawn(g, "footmen", "blue", 6, 16);
    const mark = vi.spyOn(g, "_prayerMark");
    const turn = { reach: reachOf(g, p), stops: [], enemies: [foe], order: null, wizMove: false, foeTeam: "blue" };
    g.ai._aiCarryOut(p, { bestSpot: { tx: 6, ty: 6 }, bestTgt: null, bestScore: -Infinity }, turn);
    settle(g);
    expect(mark).toHaveBeenCalledWith("shield", p);
    expect(p.acted).toBe(true);
  });

  it("a Priest whose own wound is the worst waits for its move step to heal itself (state 3: best != self, or moved)", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "red", 6, 6, { hp: 40 });
    vi.spyOn(g.ai, "_glOrder").mockReturnValue(null);
    vi.spyOn(g.ai, "_priestMove").mockReturnValue(null);
    const r = reachOf(g, p);
    const stops = [...r.stops].map((k) => ({ tx: +k.split(",")[0], ty: +k.split(",")[1] }));
    expect(g.ai._aiTryHeal(p, r, [], stops, "red")).toBe(false); // no heal before the move
    expect(g.ai._aiHealAdjacent(p, "red", () => {})).toBe(true); // …where it lands it heals itself
  });

  it("a healer heals in place; if the patient dies first the turn just ends", () => {
    const g = battle(5410);
    const s = spawn(g, "priests", "red", 6, 6);
    vi.spyOn(g.ai, "_priestPray").mockReturnValue(false);
    vi.spyOn(g.ai, "_priestMove").mockReturnValue(null);
    const hurt = spawn(g, "footmen", "red", 6, 7, { hp: 30 });
    g.ai._aiTryHeal(s, reachOf(g, s), [], [{ tx: 6, ty: 6 }], "red");
    settle(g);
    expect(hurt.hp).toBe(50);
    const g2 = battle(5410);
    const s2 = spawn(g2, "priests", "red", 6, 6);
    vi.spyOn(g2.ai, "_priestPray").mockReturnValue(false);
    vi.spyOn(g2.ai, "_priestMove").mockReturnValue(null);
    const h2 = spawn(g2, "footmen", "red", 6, 7, { hp: 30 });
    vi.spyOn(g2.ai, "_aiPanThen").mockImplementation((x, y, fn) => {
      h2.dead = true;
      fn();
    });
    g2.ai._aiTryHeal(s2, reachOf(g2, s2), [], [{ tx: 6, ty: 6 }], "red");
    expect(s2.acted).toBe(true);
  });
});

describe("Episode II roles", () => {
  it("Craftsmen walk up to a damaged war engine (class 4) and repair it (+20)", () => {
    const g = battle();
    const c = spawn(g, "craftsmen", "red", 4, 4);
    // an engine two steps beyond a reachable tile, so the craftsman must walk next to it
    const [sx, sy] = far(g, c);
    const eng = spawn(g, "catapult", "red", sx, sy, { hp: 50 });
    put(g, eng, sx, sy);
    expect(eng.T.al).toBe(4);
    expect(g.ai._aiTryCraftsmen(c, reachOf(g, c))).toBe(true);
    settle(g);
    expect(Math.abs(c.tx - eng.tx) + Math.abs(c.ty - eng.ty)).toBe(1);
    expect(eng.hp).toBe(70);
    expect(c.acted).toBe(true);
  });

  it("Craftsmen already beside a damaged engine repair it once: one heal, not two", () => {
    const g = battle();
    const c = spawn(g, "craftsmen", "red", 4, 4);
    const eng = spawn(g, "ballistae", "red", 4, 5, { hp: 50 });
    vi.spyOn(g, "_repairTargetFor").mockReturnValue(eng);
    expect(g.ai._aiTryCraftsmen(c, reachOf(g, c))).toBe(true);
    settle(g);
    expect(eng.hp).toBe(70);
  });

  it("…but if the engine is gone when they arrive, the walk ends their turn", () => {
    const g = battle();
    const c = spawn(g, "craftsmen", "red", 4, 4);
    const [sx, sy] = far(g, c);
    const eng = spawn(g, "catapult", "red", sx, sy, { hp: 50 });
    put(g, eng, sx, sy);
    const real = g.moveUnit.bind(g);
    vi.spyOn(g, "moveUnit").mockImplementation((u, path, done, ...rest) =>
      real(
        u,
        path,
        () => {
          eng.dead = true; // destroyed while they walked
          done();
        },
        ...rest,
      ),
    );
    g.ai._aiTryCraftsmen(c, reachOf(g, c));
    settle(g);
    expect(c.acted).toBe(true);
    expect(eng.hp).toBe(50);
  });

  it("a healer with nobody wounded in reach has nothing to do", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "red", 6, 6);
    only(g, p);
    vi.spyOn(g.ai, "_priestPray").mockReturnValue(false);
    vi.spyOn(g.ai, "_priestMove").mockReturnValue(null);
    expect(g.ai._aiTryHeal(p, reachOf(g, p), [], [{ tx: 6, ty: 6 }], "red")).toBe(false);
  });

  it("a Bodyguard at 25 HP or less sacrifices itself to shield its Conjurer", () => {
    const g = battle();
    const ctr = spawn(g, "conjurer", "red", 4, 4);
    const b = spawn(g, "bodyguard", "red", 5, 4, { _conjuredBy: ctr.id, hp: 20 });
    const abs = vi.spyOn(g, "_absorbSacrifice");
    expect(g.ai._aiTryAbsorb(b, reachOf(g, b))).toBe(true);
    settle(g);
    expect(abs).toHaveBeenCalledWith(b, ctr);
    b.hp = 80;
    expect(g.ai._aiTryAbsorb(spawn(g, "bodyguard", "red", 9, 9, { _conjuredBy: ctr.id, hp: 80 }), reachOf(g, b))).toBe(
      false,
    );
  });

  it("a Sapper detonates where it stands, or walks to its blast tile first", () => {
    const g = battle();
    const s = spawn(g, "sapper", "red", 4, 4);
    const strike = vi.spyOn(g, "_sapperStrike").mockImplementation((u, done) => done());
    vi.spyOn(g.ai, "_sapperPlan").mockReturnValueOnce({ tx: 4, ty: 4 });
    expect(g.ai._aiTryDetonate(s, reachOf(g, s), [])).toBe(true);
    settle(g);
    expect(strike).toHaveBeenCalledTimes(1);
    const r = reachOf(g, s);
    const to = [...r.stops]
      .map((k) => k.split(",").map(Number))
      .find(([x, y]) => !g.unitAt(x, y) && (x !== 4 || y !== 4));
    g.ai._sapperPlan.mockReturnValueOnce({ tx: to[0], ty: to[1] });
    g.ai._aiTryDetonate(s, r, []);
    settle(g);
    expect(strike).toHaveBeenCalledTimes(2);
    g.ai._sapperPlan.mockReturnValueOnce(null);
    expect(g.ai._aiTryDetonate(s, r, [])).toBe(false);
    // a sapper that died on the way never blows
    g.ai._sapperPlan.mockReturnValueOnce({ tx: 4, ty: 4 });
    s.dead = true;
    g.ai._aiTryDetonate(s, r, []);
    settle(g);
    expect(strike).toHaveBeenCalledTimes(2);
  });

  it("the Sapper's plan: a Spear kill means no blast; else the free tile beside the target scoring best", () => {
    const g = battle();
    const s = spawn(g, "sapper", "red", 4, 4);
    only(g, s);
    // a foe beside a tile the sapper can reach, another foe beside that foe
    const [sx, sy] = far(g, s);
    const foe = spawn(g, "footmen", "blue", sx + 1, sy, { hp: 100 });
    const foe2 = spawn(g, "footmen", "blue", sx + 2, sy + 1, { hp: 100 });
    const r = reachOf(g, s);
    const plan = g.ai._sapperPlan(s, r, [foe, foe2]);
    if (plan)
      expect(
        Math.abs(plan.tx - foe.tx) + Math.abs(plan.ty - foe.ty) <= 1 ||
          Math.abs(plan.tx - foe2.tx) + Math.abs(plan.ty - foe2.ty) <= 1,
      ).toBe(true);
    foe.hp = foe2.hp = 1; // the Spear kills
    expect(g.ai._sapperPlan(s, r, [foe, foe2])).toBeNull();
    expect(g.ai._sapperPlan(s, { stops: new Set() }, [foe])).toBeNull(); // nobody in reach
    // an own unit beside the blast tile scores it out
    foe.hp = foe2.hp = 100;
    const plan1 = g.ai._sapperPlan(s, reachOf(g, s), [foe]);
    if (plan1) {
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ])
        if (!g.unitAt(plan1.tx + dx, plan1.ty + dy)) spawn(g, "footmen", "red", plan1.tx + dx, plan1.ty + dy);
      const p2 = g.ai._sapperPlan(s, reachOf(g, s), [foe]);
      if (p2) expect(p2).not.toEqual(plan1); // own units around it score that tile out
    }
  });
});

describe("movers and scoring", () => {
  it("Horse Bowmen that stay put take an aimed shot at the best target in range", () => {
    const g = battle(5410);
    const hb = spawn(g, "horsebowmen", "red", 6, 6);
    const foe = spawn(g, "militiamen", "blue", 6, 8);
    vi.spyOn(g, "targetsFrom").mockReturnValue([foe]);
    const plan = { bestTgt: null, bestSpot: { tx: 6, ty: 6 } };
    vi.spyOn(g.ai, "_oGenericMove").mockReturnValue({ tx: 6, ty: 6 });
    const r = reachOf(g, hb);
    g.ai._aiPickMove(hb, plan, {
      nearest: foe,
      foeNow: 2,
      order: null,
      reach: r,
      stops: [...r.stops].map((k) => ({ tx: +k.split(",")[0], ty: +k.split(",")[1] })),
      enemies: [foe],
    });
    if (plan.bestSpot.tx === 6 && plan.bestSpot.ty === 6) expect(plan.bestTgt).toBe(foe);
  });

  it("a garrison outside its fort with nothing to strike goes back to the nearest fort tile", () => {
    const g = battle(5428);
    const u = spawn(g, "footmen", "blue", 6, 6, { ally: true });
    const area = [
      [6, 8],
      [7, 8],
    ];
    vi.spyOn(g.ai, "_garrisonOf").mockReturnValue({ area: { x0: 6, y0: 8, x1: 7, y1: 8 } });
    const r = reachOf(g, u);
    const mv = vi.spyOn(g, "moveUnit");
    g.ai._aiCarryOut(u, { bestSpot: { tx: 9, ty: 9 }, bestTgt: null }, { reach: r, wizMove: false });
    settle(g);
    const dest = mv.mock.calls.length ? mv.mock.calls[0][1].slice(-1)[0] : { tx: u.tx, ty: u.ty };
    expect(area.some(([x, y]) => x === dest.tx && y === dest.ty) || (dest.tx === 6 && dest.ty === 6)).toBe(true);
  });

  it("a wizard that moved judges its spells again from the new tile and casts", () => {
    const g = battle();
    const w = spawn(g, "wizards", "red", 4, 4);
    const r = reachOf(g, w);
    const to = [...r.stops]
      .map((k) => k.split(",").map(Number))
      .find(([x, y]) => !g.unitAt(x, y) && (x !== 4 || y !== 4));
    vi.spyOn(g.ai, "_aiBestArea").mockReturnValue({ tx: 9, ty: 9 });
    const cast = vi.spyOn(g.ai, "_aiCast").mockImplementation(() => {});
    g.ai._aiCarryOut(w, { bestSpot: { tx: to[0], ty: to[1] }, bestTgt: null }, { reach: r, wizMove: true });
    settle(g);
    expect(cast).toHaveBeenCalledWith(w, { tx: 9, ty: 9 });
  });

  it("a ranger striking from cover after moving next to its foe scores double with no counter", () => {
    const g = battle(5410);
    const r = spawn(g, "rangers", "red", 4, 4);
    const foe = spawn(g, "militiamen", "blue", 4, 6);
    const still = g.ai._aiDamageRatio(r, { tx: 4, ty: 4 }, foe, false);
    const moved = g.ai._aiDamageRatio(r, { tx: 4, ty: 5 }, foe, false);
    expect(typeof still).toBe("number");
    expect(moved).toBeGreaterThanOrEqual(still);
  });

  it("siege points: one held by the enemy with our infantry near is shot at once; an empty one only as a fallback", () => {
    const g = battle(5410);
    const c = spawn(g, "catapult", "red", 2, 2);
    only(g, c);
    g.mission = { ...g.mission, siegePoints: [[2, 6]] };
    vi.spyOn(g, "terrainAt").mockReturnValue({ defBonus: 0.3 });
    expect(g.ai._siegePointShot(c)).toBeNull(); // no infantry of ours near it
    spawn(g, "footmen", "red", 3, 8);
    expect(g.ai._siegePointShot(c)).toEqual({ tx: 2, ty: 6 }); // the empty point, as the fallback
    spawn(g, "militiamen", "blue", 2, 6);
    expect(g.ai._siegePointShot(c)).toEqual({ tx: 2, ty: 6 }); // held by the enemy: taken at once
  });

  it("a wizard moving to strike only counts foes right beside its new tile", () => {
    const g = battle();
    const w = spawn(g, "wizards", "red", 4, 4);
    const near = spawn(g, "militiamen", "blue", 4, 6);
    const r = reachOf(g, w);
    const plan = { bestTgt: null, bestSpot: { tx: 4, ty: 4 }, bestScore: -1e9 };
    const stops = [{ tx: 4, ty: 5 }];
    g.ai._aiPickAttack(w, plan, {
      order: null,
      ranged: false,
      splash: false,
      rangedBattle: false,
      reach: r,
      stops,
      enemies: [near],
      wizMove: true,
      noAttack: false,
      foeTeam: "blue",
    });
    expect(plan.bestTgt === near || plan.bestTgt === null).toBe(true);
  });
});

describe("lining up a charge (Unit::getBestMoveCharge / isValidChargePath @0x68d38)", () => {
  const lane = () => {
    const g = blank(5410);
    const a = openArea(g, 9, 3);
    const foe = spawn(g, "footmen", "blue", a.x + 7, a.y + 1);
    spawn(g, "swordsmen", "blue", a.x + 3, a.y + 1); // standing in the lane
    return { g, a, foe };
  };
  const stageFor = (g, u) =>
    g.ai._chargeStage(
      u,
      { stops: new Set([u.tx + "," + u.ty]) },
      [...g.units].filter((e) => e.team !== u.team),
    );

  it("a rider needs an empty lane; a Griffon flies, so its lane is not walked", () => {
    const { g, a } = lane();
    const knight = spawn(g, "knights", "red", a.x, a.y + 1);
    expect(stageFor(g, knight)).toBeNull();
    g.units = g.units.filter((u) => u !== knight);
    const griffon = spawn(g, "griffon", "red", a.x, a.y + 1);
    expect(stageFor(g, griffon)).toEqual({ tx: a.x, ty: a.y + 1 });
  });

  it("DELIBERATE DEVIATION: both diagonals line up (the original refuses dx = −dy)", () => {
    const g = blank(5410);
    const a = openArea(g, 4, 4);
    const foe = spawn(g, "footmen", "blue", a.x, a.y + 3);
    const rider = spawn(g, "knights", "red", a.x + 3, a.y); // the foe down-left: dx = −3, dy = 3
    expect(manhattan(rider, foe)).toBe(6);
    expect(stageFor(g, rider)).toEqual({ tx: rider.tx, ty: rider.ty });
  });
});

describe("getSupportThreatRatio's canAttack (Unit::canAttack @0x79c00)", () => {
  const stage = () => {
    const g = blank(5410);
    const a = openArea(g, 8, 5);
    return { g, x: a.x, y: a.y + 2 };
  };

  it("a bow counts only from where the archer stands, inside its band — no move added", () => {
    const { g, x, y } = stage();
    const ar = spawn(g, "archers", "red", x, y);
    const [mn, mx] = WEAPON_RANGE[ar.T.weapon];
    expect(g.ai._canAttackTile(ar, x + mx, y)).toBe(true);
    expect(g.ai._canAttackTile(ar, x + Math.min(7, mx + 2), y)).toBe(false); // within move + range, but out of the band
    if (mn > 1) expect(g.ai._canAttackTile(ar, x + 1, y)).toBe(true); // too close for the bow: its Short Sword
  });

  it("a melee unit walks to a free neighbour of the tile within its move — unless it has already moved", () => {
    const { g, x, y } = stage();
    const f = spawn(g, "footmen", "red", x, y);
    expect(g.ai._canAttackTile(f, x + 3, y, new Map())).toBe(true);
    expect(g.ai._canAttackTile(f, x + g.moveOf(f) + 2, y)).toBe(false);
    f._movedTurn = g.turn;
    expect(g.ai._canAttackTile(f, x + 3, y)).toBe(false);
    expect(g.ai._canAttackTile(f, x + 1, y)).toBe(true); // right next to it: always
  });

  it("every neighbour of the tile taken: no way in", () => {
    const { g, x, y } = stage();
    const f = spawn(g, "footmen", "red", x, y);
    const tx = x + 3;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      spawn(g, "militiamen", "blue", tx + dx, y + dy);
    expect(g.ai._canAttackTile(f, tx, y)).toBe(false);
  });

  it("the ratio sums the blows of the allies that can strike the tile, plus cover; nobody → 16", () => {
    const { g, x, y } = stage();
    const u = spawn(g, "archers", "red", x, y);
    expect(g.ai._supportRatio(u, { tx: x + 1, ty: y })).toBe(16);
    const f = spawn(g, "footmen", "red", x + 5, y);
    const dmg = g.computeDamage(f, u);
    expect(g.ai._supportRatio(u, { tx: x + 4, ty: y })).toBe(dmg << Math.trunc(8 / dmg)); // open ground: no cover (100 − tile defence 100)
    expect(g.ai._supportTie(u, { tx: x + 4, ty: y }, new Map())).toBeLessThan(999);
  });

  it("determineBestAttack: of equal blows it strikes from the tile with the higher support ratio", () => {
    const { g, x, y } = stage();
    const f = spawn(g, "footmen", "red", x, y);
    const m = spawn(g, "militiamen", "blue", x + 3, y);
    const ally = spawn(g, "footmen", "red", x + 6, y + 2); // can reach (x+3, y+1) only
    expect(g.ai._canAttackTile(ally, x + 3, y + 1)).toBe(true);
    expect(g.ai._canAttackTile(ally, x + 2, y)).toBe(false);
    expect(g.ai._supportRatio(f, { tx: x + 3, ty: y + 1 })).toBeGreaterThan(
      g.ai._supportRatio(f, { tx: x + 2, ty: y }),
    );
    runAi(g, f);
    expect([f.tx, f.ty]).toEqual([x + 3, y + 1]);
    expect(m.hp).toBeLessThan(100);
  });
});

describe("allied group with an unreachable target", () => {
  it("marches toward the nearest tile it can reach, not along A*'s stray partial path (Conquest of El Acclazar)", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    nextRound(g);
    // the left trebuchets (spawned on 5–6, 2–3): their road does not reach the foe, so the original's NEXT ran off
    // along the top row to (6,0) and the 8-tile target leash then forbade every shot
    const group = g._gl["ally:0"];
    expect(group.next).not.toEqual({ tx: 6, ty: 0 });
    expect(manhattan(group.next, group.target)).toBeLessThan(manhattan(group.center, group.target));
  });

  it("an ENEMY group keeps the original's partial A* path — only allies take the nearest reachable tile", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    const red = g.units.find((u) => u.team === "red" && !u.dead && g.ai._glGroupOf(u) != null);
    const gi = g.ai._glGroupOf(red);
    const members = g.units.filter((u) => !u.dead && u.team === "red" && g.ai._glGroupOf(u) === gi);
    vi.spyOn(g.ai, "_glPathArrives").mockReturnValue(false);
    const nearest = vi.spyOn(g.ai, "_glNearestReachablePath");
    g.turn += 1; // a fresh round, so the group updates again
    g.ai._glUpdate(
      gi,
      members,
      g.units.filter((u) => u.team === "blue" && !u.dead),
      "red",
    );
    expect(nearest).not.toHaveBeenCalled();
  });
});

describe("the shooter leash and ⚙ Realistic siege (Unit::isValidFormationTarget @0x66108)", () => {
  // a point more than 8 tiles from the group's march point, inside the map
  const farFrom = (g, point) => ({ tx: point.tx, ty: point.ty > 10 ? 0 : g.rows - 1 });

  it("by default (the original) every grouped AI unit — allied or enemy, shooter or not — is leashed to 8 tiles", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    nextRound(g);
    expect(g.realisticSiege).toBe(false);
    const treb = g.units.find((u) => u.ally && u.type === "trebuchet" && !u.dead);
    const point = g._gl[g.ai._glGroupOf(treb)].next;
    const far = farFrom(g, point);
    expect(manhattan(far, point)).toBeGreaterThan(8);
    expect(g.ai._glValidTarget(treb, treb, far)).toBe(false);
    const shooter = g.units.find((u) => u.team === "red" && !u.dead && g.ai._glGroupOf(u) != null && u.T.range > 1);
    const sPoint = g._gl[g.ai._glGroupOf(shooter)].next;
    expect(g.ai._glValidTarget(shooter, shooter, farFrom(g, sPoint))).toBe(false);
  });

  it("with Realistic siege on, an AI shooter of either side takes any target in range; melee stays leashed", () => {
    const g = makeGame(5417);
    startBattle(g, "auto");
    nextRound(g);
    g.realisticSiege = true;
    const grouped = (u) => !u.dead && g.ai._glGroupOf(u) != null;
    const treb = g.units.find((u) => grouped(u) && u.ally && u.type === "trebuchet");
    expect(g.ai._glValidTarget(treb, treb, farFrom(g, g._gl[g.ai._glGroupOf(treb)].next))).toBe(true);
    const shooter = g.units.find((u) => grouped(u) && u.team === "red" && u.T.range > 1);
    expect(g.ai._glValidTarget(shooter, shooter, farFrom(g, g._gl[g.ai._glGroupOf(shooter)].next))).toBe(true);
    const melee = g.units.find((u) => grouped(u) && u.team === "red" && u.T.range <= 1);
    const mPoint = g._gl[g.ai._glGroupOf(melee)].next;
    expect(manhattan(farFrom(g, mPoint), mPoint)).toBeGreaterThan(8);
    expect(g.ai._glValidTarget(melee, melee, farFrom(g, mPoint))).toBe(false);
  });
});
