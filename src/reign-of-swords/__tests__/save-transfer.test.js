// Carrying an army between the episodes (data/save-transfer.js — ours, user decision): the file, the limits, Episode
// II's own units reaching Episode I as what they upgrade from, and re-imports that can't multiply an army.
import { describe, it, expect } from "vitest";
import { makeTransfer, readTransfer, applyTransfer, TRANSFER_LIMITS as L } from "../data/save-transfer.js";

const file = (episode, army, spoils = {}) => ({ kind: "reign-of-swords-army", v: 1, episode, army, spoils });

describe("army transfer", () => {
  it("writes the army and collectibles in hand, nothing else", () => {
    const t = makeTransfer({ ep2: false, army: { footmen: 3, archers: 0, dragon: 4 }, spoils: { Lore: 2, Gold: 9 } });
    expect(t).toMatchObject({ kind: "reign-of-swords-army", episode: 1, army: { footmen: 3 }, spoils: { Lore: 2 } });
  });

  it("reads only a file from the OTHER episode", () => {
    expect(() => readTransfer({ army: {} }, { ep2: true })).toThrow("not a Reign of Swords army file");
    expect(() => readTransfer(file(2, {}), { ep2: true })).toThrow("import it in Episode I");
    expect(() => readTransfer(file(1, {}), { ep2: false })).toThrow("import it in Episode II");
    expect(readTransfer(file(1, { footmen: 2 }), { ep2: true }).units).toEqual({ footmen: 2 });
  });

  it("caps each unit, the whole army and each collectible (Medals harder)", () => {
    const got = readTransfer(
      file(
        1,
        { militiamen: 50, footmen: 50, archers: 50, knights: 50, cannon: 50, wizards: 50 },
        { Lore: 9, Medal: 9 },
      ),
      { ep2: true },
    );
    expect(Math.max(...Object.values(got.units))).toBe(L.perUnit);
    expect(Object.values(got.units).reduce((a, n) => a + n, 0)).toBe(L.units);
    expect(got.spoils).toEqual({ Lore: L.perSpoil, Medal: L.medals });
    expect(got.capped).toBe(true);
  });

  it("Episode II's own units reach Episode I as what they upgrade from; the Conjurer's summons never travel", () => {
    const got = readTransfer(file(2, { craftsmen: 2, ballistae: 1, dunesirens: 1, conjurer: 1, sapper: 3 }), {
      ep2: false,
    });
    expect(got.units).toEqual({ footmen: 2, trebuchet: 1, shamans: 2 });
    expect(got.converted).toBe(true);
    // Episode II keeps them as they are
    expect(readTransfer(file(1, { footmen: 1 }), { ep2: true }).converted).toBe(false);
  });

  it("a re-import replaces the units and only tops collectibles up to the most ever brought in", () => {
    const first = applyTransfer(undefined, { units: { footmen: 6 }, spoils: { Lore: 3 } });
    expect(first.addSpoils).toEqual({ Lore: 3 });
    const again = applyTransfer(first.stored, { units: { archers: 2 }, spoils: { Lore: 3, Armor: 1 } });
    expect(again.stored.units).toEqual({ archers: 2 }); // not 6 footmen + 2 archers
    expect(again.addSpoils).toEqual({ Armor: 1 }); // the Lore was already given
  });
});
