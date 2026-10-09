// Scenario scripts: battle-ending conversations ("Spoils of War" / "Units Lost" screens), the escort, the Caladrin
// garrison (a deliberate deviation), and the dialogue record the result cutscene uses to avoid repeats.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, step, put, moveTo, nextRound } from "./battle.js";

beforeAll(() => loadEpisode(2));

describe("a conversation that ends on the result screen ends the battle", () => {
  it("Siege of Corbeau: the commander falls → 'Yield! I yield!' → victory once read", () => {
    const g = makeGame(5408);
    startBattle(g); // deploys a single unit in the deployment zone
    const cmd = g.units.find((u) => u.sid === 10 && u.team === "red");
    cmd.hp = 0;
    cmd.dead = true;
    g._terminal(); // fires the unit-lost trigger
    step(g, 3, { keepDialogue: true });
    expect(g.battleEvent && g.battleEvent.lines.map((l) => l.text)).toEqual([
      expect.stringContaining("Yield! I yield!"),
      "The siege is over! They surrender!",
    ]);
    expect(g.phase).not.toBe("victory"); // not before it is read
    g.eventClosed();
    expect(g.phase).toBe("victory");
    expect(g.majorVictory).toBeFalsy(); // a surrender is a plain victory
    expect(g.shownLines()).toContain("The siege is over! They surrender!");
  });
});

describe("escort (Warning Caladrin)", () => {
  it("two Craftsmen reaching the town win the battle", () => {
    const g = makeGame(5428);
    startBattle(g);
    const S = g._sc,
      sc = g.mission.script;
    const esc = g.units.filter((u) => !u.dead && S.escortLeft.includes(u.sid));
    for (const u of esc.slice(0, S.escortReq)) {
      const m = sc.escort.markers.find(([x, y]) => !g.unitAt(x, y));
      put(g, u, ...m);
      g.scenario.onTileReached(u);
    }
    // the escort trigger (tag 11 [2, 79]) runs command 79, whose screen ends the battle (UnitInEscortSafetyRegion)
    expect(g.battleEvent.lines.map((l) => l.text)).toEqual([expect.stringContaining("made it safely inside")]);
    expect(g.phase).toBe("player"); // not before it is read
    g.eventClosed();
    expect(g.phase).toBe("victory");
  });

  it("losing a third Craftsman shows the record's 'Our escort has failed…' before the defeat", () => {
    const g = makeGame(5428);
    startBattle(g);
    const S = g._sc;
    for (const u of g.units.filter((x) => !x.dead && S.escortLeft.includes(x.sid)).slice(0, 3)) {
      u.hp = 0;
      u.dead = true;
      u.dieT = 0;
    }
    g.scenario.onDeath();
    expect(g.phase).toBe("player"); // not before the line is read
    // the conversations come up one after another ("…one of the Craftsmen has been slain!", then the failure)
    const read = [];
    for (let i = 0; i < 40 && g.phase !== "defeat"; i++) {
      step(g, 1, { keepDialogue: true });
      if (g.battleEvent) {
        read.push(...g.battleEvent.lines.map((l) => l.text));
        g.eventClosed();
      }
    }
    expect(read.join(" ")).toContain("Our escort has failed");
    expect(g.phase).toBe("defeat");
    expect(g.defeatReason).toBe("escort");
  });
});

describe("Caladrin garrison (deviation: allies stay in the fort until the last portals)", () => {
  it("the town's allies never leave the fort while it holds, then march out after a portal jump", () => {
    const g = makeGame(5428);
    startBattle(g);
    const inFort = (u) => u.tx >= 3 && u.tx <= 16 && u.ty <= 3; // the fort plus the one-tile sally ring
    for (let r = 0; r < 6 && g.phase === "player"; r++) {
      nextRound(g);
      for (const a of g.units.filter((u) => !u.dead && u.ally)) expect(inFort(a)).toBe(true);
    }
    expect(g._garrisonReleased).toBeFalsy();
    const u = g.units.find((x) => !x.dead && x.team === "blue" && !x.ally && x.type === "swordsmen");
    if (g.phase !== "player") return;
    put(g, u, 3, 20);
    moveTo(g, u, 3, 21); // through (3,21) → (16,8)
    expect(g._garrisonReleased).toBe(true);
    expect(g.notice && g.notice.text).toBe("The town's defenders march out to meet you.");
  });
});

describe("dialogue record", () => {
  it("round events and script beats shown in battle are recorded once each", () => {
    const g = makeGame(5428);
    startBattle(g);
    const shown = g.shownLines();
    expect(shown.length).toBeGreaterThan(0);
    expect(new Set(shown).size).toBe(shown.length);
  });
});

describe("script data", () => {
  it("the battle-ending conversations are marked in the data", () => {
    const end = (mapId, i) => {
      const g = makeGame(mapId);
      return g.mission.script.actions[i].end;
    };
    expect(end(5408, 37)).toBe("victory"); // Siege of Corbeau surrender
    expect(end(5414, 51)).toBe("victory"); // Defense of Stokeshire: the attackers flee
    expect(end(5428, 79)).toBe("victory"); // Warning Caladrin: the Craftsmen are inside
  });
});

describe("counter-gated round triggers wait for a turn start (Mission::getSequenceOnTurn)", () => {
  it("Zayandi Shores: the second ambush comes when the next turn begins, not the moment the first squad falls", () => {
    const g = makeGame(5424);
    startBattle(g, "auto");
    const alive = (lo, hi) => g.units.filter((u) => !u.dead && u.team === "red" && u.sid >= lo && u.sid <= hi).length;
    const mine = g.units.find((u) => u.team === "blue" && !u.dead);
    put(g, mine, 6, 2); // into the forest: the first ambush
    g.scenario.onTileReached(mine);
    step(g, 40);
    expect(alive(9, 14)).toBe(6);
    for (const u of g.units.filter((x) => x.team === "red" && x.sid >= 9 && x.sid <= 14)) {
      u.hp = 0;
      u.dead = true;
      u.dieT = 0;
    }
    g.scenario.onDeath();
    step(g, 40);
    expect(g.shownLines()).toContain("Those fighters were no match for us. Let us continue onwards.");
    expect(alive(15, 20)).toBe(0); // still your turn: no second ambush yet
    nextRound(g);
    expect(alive(15, 20)).toBe(6);
    expect(g.shownLines()).toContain("Ambush!");
  });
});

describe("round chains the exported data does not carry", () => {
  it("Caladrin Defense: on round 3 Landower walks off the field and is gone, wherever the fighting took him", () => {
    const g = makeGame(5429);
    startBattle(g, "auto");
    const landower = g.units.find((u) => u.sid === 0 && u.team === "red");
    expect(landower && landower.type).toBe("king");
    put(g, landower, 10, 3); // he has left his spawn tile (7,1) by round 3
    for (let r = 0; r < 3 && g.turn < 3; r++) nextRound(g);
    expect(g.turn).toBe(3);
    for (let i = 0; i < 400 && (g.anim || g._delayed.length); i++) step(g);
    expect(g.units.includes(landower)).toBe(false);
  });

  it("Precarious Pass: the bandits are hidden while you deploy (op 6) and revealed when round 1 starts (op 4)", () => {
    const g = makeGame(5627);
    step(g, 20);
    const bandits = g.units.filter((u) => u.team === "red" && u.sid != null && u.sid <= 5); // the six raiders
    expect(bandits.length).toBe(6);
    expect(bandits.every((u) => g._isHidden(u))).toBe(true);
    startBattle(g, "auto");
    expect(bandits.filter((u) => !u.dead).every((u) => !g._isHidden(u))).toBe(true);
  });
});
