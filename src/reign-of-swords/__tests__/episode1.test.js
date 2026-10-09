// Episode I runs on the same engine with its own data: battles start, the Marsur 3 surrender ends the battle, and a
// golden replay pins the AI on a few Episode I maps.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, step, nextRound } from "./battle.js";

beforeAll(() => loadEpisode(1));

describe("Episode I", () => {
  it("Marsur 3: the commander yields → victory once the lines are read", () => {
    const g = makeGame(5408);
    startBattle(g, "auto");
    const cmd = g.units.find((u) => u.sid === 10 && u.team === "red");
    cmd.hp = 0;
    cmd.dead = true;
    g._terminal();
    step(g, 3, { keepDialogue: true });
    expect(g.battleEvent && g.battleEvent.lines.some((l) => l.text === "The siege is over! They surrender!")).toBe(
      true,
    );
    g.eventClosed();
    expect(g.phase).toBe("victory");
  });

  for (const mapId of [5400, 5402, 5406, 5414])
    it(`golden replay: map ${mapId}, 3 rounds`, () => {
      const g = makeGame(mapId);
      startBattle(g, "auto");
      for (let r = 0; r < 3 && g.phase === "player"; r++) nextRound(g);
      const board = g.units
        .map((u) => [u.id, u.type, u.team, u.tx, u.ty, Math.round(u.hp), u.dead ? "dead" : ""].join(" "))
        .sort();
      expect({ turn: g.turn, phase: g.phase, board }).toMatchSnapshot();
    });
  // GameScreen::gameStateUpdate state 2: after the battle-start staging, before the first turn, every Priest outside
  // group 0 prays where it stands (the AI's choice, else Shield).
  const watchPrayers = (g) => {
    const marks = [];
    const mark = g._prayerMark.bind(g);
    g._prayerMark = (kind, u) => (marks.push([kind, u.group, g.turn, g.phase]), mark(kind, u));
    return marks;
  };
  it("the battle-start prayer: Carrone 3's allied Priest (group 2) shields before the first turn", () => {
    const g = makeGame(5402);
    const marks = watchPrayers(g);
    startBattle(g, "auto");
    expect(marks[0]).toEqual(["shield", 2, 1, "player"]);
  });
  it("…a Priest in group 0 does not pray at the start", () => {
    const g = makeGame(5402);
    for (const u of g.units) if (u.T.prayer) u.group = 0;
    const marks = watchPrayers(g);
    startBattle(g, "auto");
    expect(marks).toEqual([]);
  });
  it("a braced Pike Wall striking a charging mount adds +30 (Episode I only)", () => {
    const g = makeGame(5406);
    startBattle(g, "auto");
    expect(g.mission.ep).toBe(1);
    const p = g._makeUnit("pikemen", "red", 0, 0, false);
    p.walled = true;
    const cav = g._makeUnit("cavalry", "blue", 1, 0, false);
    expect(g._firstStrikeOf(cav, p)).toMatchObject({ label: "Pike Wall!", brace: true });
    expect(g.computeDamage(p, cav, { brace: true }) - g.computeDamage(p, cav, {})).toBeGreaterThan(0);
  });
});

describe("Tutorial 4 (5803)", () => {
  it("you command the Carrone Army (the record's team 1, crossbows and catapult on the ridge), not the rebels", () => {
    const g = makeGame(5803);
    startBattle(g, "auto");
    const types = (team) => g.units.filter((u) => u.team === team).map((u) => u.type);
    expect(types("blue")).toEqual(expect.arrayContaining(["crossbowmen", "catapult", "cavalry", "pikemen"]));
    expect(types("blue").length).toBe(11);
    expect(types("red")).toEqual(expect.arrayContaining(["swordsmen", "militiamen"]));
    expect(types("red").length).toBe(10);
  });
});
