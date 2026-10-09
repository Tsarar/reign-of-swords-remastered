// Escape missions — Sangsoleil 1 (5412, header type 3: "A majority of your forces must escape alive"). Units that
// reach the goal area leave the field and are SAVED. The loss is the map's own script: each death (tag 7) bumps
// counter 0 and at 6 (tag 8) the Herald says "We've lost too many men to have hope of reaching Stokeshire. We must
// turn back." — a screen that leaves the battle. checkOutcome sees a field with none of yours as outcome 0, whose
// sequence (tag 5) on this map is "We've escaped their trap" → Spoils of War: emptying the field is a win.
import { describe, it, expect, beforeAll } from "vitest";
import { loadEpisode, makeGame, startBattle, put, spawn, step } from "./battle.js";

beforeAll(() => loadEpisode(1));

const mine = (g) => g.units.filter((u) => u.team === "blue" && !u.ally && !u.dead);
function escape(g, u, i = 0) {
  const [gx, gy] = g.mission.script.goals[i % g.mission.script.goals.length];
  put(g, u, gx, gy);
  g.scenario.onTileReached(u);
}
// read every queued line, as the player does
function readAll(g) {
  for (let i = 0; i < 20 && (g.battleEvent || (g._sc && g._sc.queue.length)); i++) {
    g.scenario.flush(true);
    if (g.battleEvent) g.eventClosed();
  }
}

describe("Sangsoleil 1: escape", () => {
  it("starts with nobody escaped and nobody lost; 5 may fall (the 6th death turns the army back)", () => {
    const g = makeGame(5412);
    startBattle(g);
    expect(g.escapeStatus()).toEqual({ escaped: 0, lost: 0, maxLost: 5, goal: true });
  });

  it("escaped units are saved, not lost: seven escape and the battle goes on", () => {
    const g = makeGame(5412);
    startBattle(g);
    const us = mine(g).filter((u) => !u.hero);
    for (let i = 0; i < 7; i++) escape(g, us[i], i);
    expect(g.escapeStatus()).toMatchObject({ escaped: 7, lost: 0 });
    expect(g._terminal()).toBeNull();
  });

  it("a Wizard that TELEPORTS onto the goal area escapes too (the blink ends its move like a walk)", () => {
    const g = makeGame(5412);
    startBattle(g);
    const [gx, gy] = g.mission.script.goals[0];
    let from = null;
    for (let d = 2; d < 6 && !from; d++)
      for (const [x, y] of [
        [gx - d, gy],
        [gx + d, gy],
        [gx, gy - d],
        [gx, gy + d],
      ])
        if (!from && g.inBounds(x, y) && !g.unitAt(x, y) && g.terrainAt(x, y).passable) from = [x, y];
    const wiz = spawn(g, "wizards", "blue", from[0], from[1]);
    let moved = false;
    g.moveUnit(
      wiz,
      [
        { tx: wiz.tx, ty: wiz.ty },
        { tx: gx, ty: gy },
      ],
      () => (moved = true),
    );
    for (let i = 0; i < 200 && !moved; i++) step(g);
    expect(moved).toBe(true);
    expect(g.escapeStatus().escaped).toBe(1);
    expect(g.units.includes(wiz)).toBe(false);
  });

  it("everyone off the field (escaped) is a victory", () => {
    const g = makeGame(5412);
    startBattle(g);
    const us = mine(g);
    us.forEach((u, i) => escape(g, u, i));
    expect(g.phase).toBe("victory");
  });

  it("the last unit falling after the rest got away still empties the field: a victory (the tag-5 sequence)", () => {
    const g = makeGame(5412);
    startBattle(g);
    const us = mine(g);
    us.slice(0, -1).forEach((u, i) => escape(g, u, i));
    g.phase = "player";
    us[us.length - 1].dead = true;
    expect(g._terminal()).toBe("victory");
  });

  it("5 lost is still in the game; the 6th loss plays the retreat and ends the battle (script)", () => {
    const g = makeGame(5412);
    startBattle(g);
    readAll(g);
    const us = mine(g).filter((u) => !u.hero);
    for (let i = 0; i < 5; i++) us[i].dead = true;
    expect(g._terminal()).toBeNull();
    readAll(g);
    expect(g.escapeStatus()).toMatchObject({ lost: 5, maxLost: 5 });
    expect(g.phase).not.toBe("defeat");
    us[5].dead = true;
    expect(g._terminal()).toBeNull();
    readAll(g);
    expect(g.phase).toBe("defeat");
    expect(g.defeatReason).toBe("script");
  });

  it("the Hero falling is no defeat by itself (checkOutcome has no Hero rule)", () => {
    const g = makeGame(5412);
    startBattle(g);
    const hero = g.units.find((u) => u.team === "blue" && u.hero);
    expect(hero).toBeTruthy();
    hero.dead = true;
    expect(g._terminal()).toBeNull();
  });

  it("the battle state sent to the HUD carries the counts; maps with no loss counter carry none", () => {
    const g = makeGame(5412);
    startBattle(g);
    let st = null;
    g.onState = (s) => (st = s);
    mine(g)[0].dead = true;
    g._terminal();
    g._emit();
    expect(st.escape).toEqual({ escaped: 0, lost: 1, maxLost: 5, goal: true });
    const h = makeGame(5400);
    startBattle(h);
    h.onState = (s) => (st = s);
    h._emit();
    expect(st.escape).toBeNull();
  });
});

describe("other loss counters", () => {
  it("Sangsoleil 2 has none (a plain destroy mission: out of time is lost)", () => {
    const g = makeGame(5413);
    startBattle(g, "auto");
    expect(g.escapeStatus()).toBeNull();
    expect(g._timeoutOutcome()).toBe("defeat");
  });

  it("The High Pass counts its war engines: 2 may fall, no escaped count", () => {
    const g = makeGame(5416);
    startBattle(g, "auto");
    expect(g.escapeStatus()).toEqual({ escaped: 0, lost: 0, maxLost: 2, goal: false });
  });
});
