// The 🤖 Autopilot (ai/autopilot.js — the AI plays your turns with a strategy) and the Battle Lab runner
// (engine/sim.js — a whole battle with no screen, autoDeploy, seeded dice).
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, step } from "./battle.js";
import { simulateBattle, autoDeploy, armyCost, seedBattle } from "../engine/sim.js";
import { SANDBOX_ARMY_EP2 } from "../data/shell-data.js";
import { DEPLOY_ELITE } from "../data/missions.js";
import { AUTOPILOT_STRATEGIES } from "../ai/autopilot.js";

beforeAll(() => loadEpisode(2));

const mine = (g) => g.units.filter((u) => !u.dead && u.team === "blue" && !u.ally);
// Run frames until the player's turn number moves on (or the battle ends).
function playTurn(g, max = 20000) {
  const t = g.turn;
  for (let i = 0; i < max && g.turn === t && g.phase !== "victory" && g.phase !== "defeat"; i++) {
    if (g.battleEvent) g.eventClosed();
    if (g.pendingSkip) g.confirmSkip();
    step(g);
  }
}

describe("Autopilot in battle", () => {
  it("plays your whole turn and ends it — your units act without a tap, then the enemy moves", () => {
    const g = makeGame(5625);
    startBattle(g, "auto");
    expect(g.phase).toBe("player");
    const before = new Map(mine(g).map((u) => [u.id, u.tx + "," + u.ty]));
    g.setAutopilot("attack");
    const turn = g.turn;
    playTurn(g);
    expect(g.turn).toBe(turn + 1);
    expect(mine(g).some((u) => before.get(u.id) !== u.tx + "," + u.ty)).toBe(true);
  });

  it("taps on the field do nothing while it plays; switching it off hands the army back", () => {
    const g = makeGame(5625);
    startBattle(g, "auto");
    g.setAutopilot("hold");
    const u = mine(g)[0];
    g.click({ tx: u.tx, ty: u.ty });
    expect(g.selected).toBeNull();
    g.setAutopilot(null);
    expect(g.autopilot).toBeNull();
    g.click({ tx: u.tx, ty: u.ty });
    expect(g.selected).toBe(u);
  });

  it("Hold ground: a unit with no foe in reach stays where it stands", () => {
    const g = makeGame(5625);
    startBattle(g, "auto");
    g.setAutopilot("hold");
    const far = mine(g).filter((u) => g.targetsFrom(u, u.tx, u.ty).length === 0);
    expect(g.ai._apOrder(far[0])).toEqual({ tx: far[0].tx, ty: far[0].ty });
  });

  it("Advance as one: every unit's order is its place in the block, shifted toward the nearest foe", () => {
    const g = makeGame(5625);
    startBattle(g, "auto");
    g.setAutopilot("advance");
    const [a, b] = mine(g);
    const oa = g.ai._apOrder(a),
      ob = g.ai._apOrder(b);
    expect(oa.tx - ob.tx).toBe(a.tx - b.tx); // the block keeps its shape (away from the map's edges)
    expect(oa.ty - ob.ty).toBe(a.ty - b.ty);
  });

  it("Fight locally, then bombard: your home ground ends at the portals (Palace Assault's palace is not on it)", () => {
    const g = makeGame(5625);
    startBattle(g, "auto");
    g.setAutopilot("safe");
    const home = g.ai._apHomeGround();
    expect(home.has("2,22")).toBe(true); // the deploy corner
    expect(home.has("9,2")).toBe(false); // inside the palace, across the ridge
  });

  it("Hold the fort: a unit acts only from the muster ground, shies from being surrounded, and sallies when stronger", () => {
    const g = makeGame(5625);
    startBattle(g, "auto");
    g.setAutopilot("fortress");
    const u = mine(g)[0];
    const stops = [...g.computeReach(u).stops].map((k) => {
      const [tx, ty] = k.split(",").map(Number);
      return { tx, ty };
    });
    const kept = g.ai._apStops(u, stops);
    expect(kept.length).toBeGreaterThan(0);
    for (const s of kept) expect((s.tx === u.tx && s.ty === u.ty) || g.deployZone.has(s.tx + "," + s.ty)).toBe(true);
    expect(stops.some((s) => !g.deployZone.has(s.tx + "," + s.ty))).toBe(true); // it could have stepped out
    expect(g.ai._apOrder(u)).toEqual({ tx: u.tx, ty: u.ty });
    // three foes around a tile: a melee unit pays for the two it is not striking
    const spot = { tx: u.tx, ty: u.ty };
    const foes = g.units.filter((e) => !e.dead && e.team === "red").slice(0, 3);
    [
      [1, 0],
      [-1, 0],
      [0, 1],
    ].forEach(([dx, dy], i) => Object.assign(foes[i], { tx: spot.tx + dx, ty: spot.ty + dy }));
    g._apPlans = null;
    expect(g.ai._apSpotRisk({ ...u, T: { ...u.T, range: 1 } }, spot)).toBe(2 * 1500);
    // the field is clearly yours: the fort is left, every tile is open again and the order is the AI's own
    for (const e of g.units) if (e.team === "red") e.hp = 1;
    g._apPlans = null;
    expect(g.ai._apSally()).toBe(true);
    expect(g.ai._apStops(u, stops)).toBe(stops);
    expect(g.ai._apOrder(u)).toBeNull();
    expect(g.ai._apSpotRisk(u, spot)).toBe(0);
    // other strategies are untouched
    g.setAutopilot("hold");
    expect(g.ai._apStops(u, stops)).toBe(stops);
    expect(g.ai._apSpotRisk(u, spot)).toBe(0);
  });

  it("every strategy has a name and a line of help", () => {
    for (const info of Object.values(AUTOPILOT_STRATEGIES)) expect(info.label && info.help).toBeTruthy();
  });
});

describe("Battle Lab runner", () => {
  it("autoDeploy keeps to the mission's muster rules: points budget and 1 elite per 1000 points", () => {
    const g = makeGame(5625, { army: SANDBOX_ARMY_EP2, god: false });
    for (let i = 0; i < 20; i++) step(g);
    autoDeploy(g, { wizards: 6, pikemen: 30 });
    const placed = mine(g).filter((u) => !u.hero);
    const spent = placed.reduce((s, u) => s + g.deployCost(u.type), 0);
    expect(spent).toBeLessThanOrEqual(g.deployBudget());
    expect(placed.filter((u) => DEPLOY_ELITE[u.type]).length).toBe(Math.floor(g.deployBudget() / 1000));
    expect(armyCost({ wizards: 2, pikemen: 1 })).toBe(2 * g.deployCost("wizards") + g.deployCost("pikemen"));
  });

  it("plays a battle to its end; the same seed gives the same battle, another seed another one", async () => {
    const opts = {
      mapId: 5625,
      army: { wizards: 3, priests: 1, pikemen: 6, crossbowmen: 4 },
      roster: SANDBOX_ARMY_EP2,
      strategy: "attack",
      yieldMs: 0,
    };
    const a = await simulateBattle({ ...opts, seed: 3 });
    const b = await simulateBattle({ ...opts, seed: 3 });
    expect(["victory", "defeat"]).toContain(a.result);
    expect(a.spent).toBeGreaterThan(0);
    expect(a.timeline.length).toBeGreaterThan(1);
    expect(b).toEqual(a);
    const c = await simulateBattle({ ...opts, seed: 4 });
    expect(c).not.toEqual(a);
  }, 60000);

  it("a turn-limit override and a stop signal are honoured", async () => {
    const signal = { aborted: true };
    const r = await simulateBattle({
      mapId: 5625,
      army: { pikemen: 4 },
      roster: SANDBOX_ARMY_EP2,
      strategy: "hold",
      seed: 1,
      turnLimit: 3,
      realisticSiege: true, // ⚙ Realistic siege for this battle, whatever the stored setting
      yieldMs: 0,
      signal,
    });
    expect(r.result).toBe("unfinished");
    expect(r.realisticSiege).toBe(true);
    const g = makeGame(5625);
    seedBattle(g, 5);
    const roll = g.rng();
    seedBattle(g, 5);
    expect(g.rng()).toBe(roll);
  });
});
