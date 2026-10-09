// Counter-attacks (rules/combat.js canCounter): a defender strikes back at an adjacent attacker when EITHER weapon slot
// reaches range 1 — the original's Unit::isInRange tries slot 0 and then the sidearm (iOS Ep2 @0x664e8, used by
// Unit::attack @0x7666c and estimated the same way by calcDamageRatio @0x70054). War engines never strike back.
import { describe, it, expect, beforeAll, vi } from "vitest";

import { loadEpisode, makeGame, startBattle, spawn, only, settle } from "./battle.js";

beforeAll(() => loadEpisode(1));

function field() {
  const g = makeGame(5412);
  startBattle(g);
  return g;
}

describe("counter-attacks use the sidearm too", () => {
  it("the archer line, rangers, wizards and craftsmen strike back; horse bowmen and war engines don't", () => {
    const g = field();
    const unit = (type) => spawn(g, type, "red", 1, 1);
    for (const type of ["swordsmen", "archers", "crossbowmen", "musketeers", "rangers", "wizards", "craftsmen"])
      expect([type, g.canCounter(unit(type))]).toEqual([type, true]);
    for (const type of ["horsebowmen", "cannon", "ballistae", "catapult", "trebuchet"])
      expect([type, g.canCounter(unit(type))]).toEqual([type, false]);
  });

  it("an archer attacked in melee answers with its Short Sword", () => {
    const g = field();
    const levy = spawn(g, "militiamen", "blue", 5, 5); // a light blow, so the archer survives to answer
    const archer = spawn(g, "archers", "red", 5, 4);
    only(g, levy, archer);
    g.doAttack(levy, archer);
    settle(g);
    expect(archer.dead).toBe(false);
    expect(levy.hp).toBeLessThan(100);
  });

  it("horse bowmen have no sidearm: a melee blow goes unanswered", () => {
    const g = field();
    const sword = spawn(g, "swordsmen", "blue", 5, 5);
    const rider = spawn(g, "horsebowmen", "red", 5, 4);
    only(g, sword, rider);
    g.doAttack(sword, rider);
    settle(g);
    expect(rider.dead).toBe(false);
    expect(sword.hp).toBe(100);
  });

  it("the AI's attack score counts the sidearm counter", () => {
    const g = field();
    const levy = spawn(g, "militiamen", "red", 5, 5);
    const archer = spawn(g, "archers", "blue", 5, 4);
    only(g, levy, archer);
    const priced = g.ai._aiDamageRatio(levy, levy, archer, false);
    vi.spyOn(g, "canCounter").mockReturnValue(false); // the old rule: a bow unit never strikes back
    const free = g.ai._aiDamageRatio(levy, levy, archer, false);
    expect(priced).toBeLessThan(free);
  });
});
