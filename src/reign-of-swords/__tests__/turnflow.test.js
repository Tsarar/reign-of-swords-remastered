// Turn flow: per-army turn starts (healing once a round), Major Victory standing (GameScreen::checkOutcome), defeat
// reasons, the turn limit.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, nextRound, put } from "./battle.js";
import { missionList } from "../engine/engine.js";

beforeAll(() => loadEpisode(2));

describe("healing", () => {
  it("a unit on a village heals once a round even on a map with an allied army (Warning Caladrin)", () => {
    const g = makeGame(5428);
    startBattle(g);
    const u = g.units.find((x) => x.team === "blue" && !x.ally && x.type === "crossbowmen");
    const v = [13, 0]; // a village inside Caladrin (heals 10)
    put(g, u, ...v);
    u.hp = 30;
    const hps = [u.hp];
    for (let r = 0; r < 3; r++) {
      put(g, u, ...v);
      nextRound(g);
      hps.push(Math.floor(u.hp));
    }
    expect(hps).toEqual([30, 40, 50, 60]);
  });
});

describe("Major Victory standing (medalStatus)", () => {
  it("needs surviving strength (cost x HP) of 40% of the deploy budget", () => {
    const g = makeGame(5410);
    startBattle(g, [["cavalry", 2, 11]]);
    const st = g.medalStatus();
    expect(st.budget).toBe(2000);
    expect(st.need).toBe(800);
    const cav = g.units.find((u) => u.team === "blue" && u.type === "cavalry");
    cav.hp = 50;
    expect(g.medalStatus().strength).toBe(Math.round(0.5 * st.strength));
  });
});

describe("defeat reasons", () => {
  it("losing your whole army is reason 'wiped'", () => {
    const g = makeGame(5410);
    startBattle(g, [["cavalry", 2, 11]]);
    for (const u of g.units) if (u.team === "blue") u.dead = true;
    expect(g._terminal()).toBe("defeat");
    expect(g.defeatReason).toBe("wiped");
  });
});

describe("turn limit", () => {
  it("a story battle is lost when the turns run out", () => {
    const g = makeGame(5410);
    startBattle(g, [["cavalry", 2, 11]]);
    g.turn = g.mission.turnLimit + 1;
    expect(g._timeoutOutcome()).toBe("defeat");
    expect(g.defeatReason).toBe("turns");
  });
});

describe("a new battle starts clean", () => {
  it("the AI's hold groups and the muster roster don't leak from the previous battle (or into a Restart)", () => {
    const g = makeGame(5428);
    startBattle(g);
    nextRound(g);
    expect(Object.keys(g._gl).length).toBeGreaterThan(0);
    const fresh = JSON.stringify(makeGame(5428)._gl);
    g.reset(); // Restart
    expect(JSON.stringify(g._gl)).toBe(fresh);
    const h = makeGame(5428);
    const kinds = missionList().map((m) => (h.selectMission(m.index), !!h.mission.deploy));
    h.selectMission(kinds.indexOf(true)); // a deploy mission…
    expect(h.rosterMap).not.toBeNull();
    h.selectMission(kinds.indexOf(false)); // …then a fixed-force one
    expect(h.rosterMap).toBeNull();
    expect(h._rosterOrder).toBeNull();
    expect(h._deployOpen).toBe(false);
    expect(h._deployOpened).toBe(false);
  });
});

describe("when a cleared field wins (GameScreen::checkOutcome)", () => {
  it("a skirmish battlefield doesn't end at the start: its victory screen is never played as an opening", () => {
    const g = makeGame(5208);
    startBattle(g, "auto");
    expect(g.phase).toBe("player");
    expect(g._sc.end).toBeFalsy();
  });

  it("a map that opens with no enemy on the field waits for its round-1 wave (Rukiev 2 / Reprisal)", () => {
    const g = makeGame(5422);
    startBattle(g, "auto");
    expect(g.phase).not.toBe("victory");
  });

  it("with no win switch, clearing the field wins before later waves come (The Lower Gate: griffons still due on round 9)", () => {
    const g = makeGame(5415);
    startBattle(g, "auto");
    expect(g.mission.waves.some((w) => w.round > g.turn)).toBe(true);
    for (const u of g.units) if (u.team === "red") u.dead = true;
    expect(g._terminal()).toBe("victory");
  });
});
