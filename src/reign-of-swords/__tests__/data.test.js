// Data contracts of the shipped game data (public/games/*), and the shell's pure helpers (reward draw, cutscene
// filter). A data re-export or a shell refactor that breaks one of these breaks the game.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawReward, unseenLines } from "../data/shell-data.js";
import RU_STORY from "../i18n/ru-story.js";
import UK_STORY from "../i18n/uk-story.js";

const json = (ep, file) =>
  JSON.parse(
    readFileSync(join(process.cwd(), "public/games", ep === 2 ? "reign-of-swords-2" : "reign-of-swords", file), "utf8"),
  );

describe("rewards", () => {
  const R2 = json(2, "rewards.json");

  it("Ep2's three 'Raid 3' maps carry a random 2-of-7 pool (the record's q flag)", () => {
    for (const m of ["5626", "5629", "5632"]) {
      expect(R2[m].random).toBe(true);
      expect(R2[m].pick).toBe(2);
      expect(R2[m].pool.map((e) => e.unit || e.spoil)).toEqual([
        "Armor",
        "Weapons",
        "Beasts",
        "Spirit",
        "Lore",
        "militiamen",
        "footmen",
      ]);
    }
  });

  it("no mission's fixed reward lists a Medal (Medals come only from Major Victories)", () => {
    for (const ep of [1, 2])
      for (const r of Object.values(json(ep, "rewards.json"))) expect((r.spoils || {}).Medal).toBeUndefined();
  });

  it("drawReward picks `pick` distinct entries, each equally often", () => {
    const r = R2["5626"];
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const count = {};
    for (let i = 0; i < 14000; i++) {
      const w = drawReward(r, rnd);
      expect(w.drawn.length).toBe(2);
      expect(new Set(w.drawn).size).toBe(2);
      for (const k of w.drawn) count[k] = (count[k] || 0) + 1;
    }
    for (const k of Object.keys(count)) expect(count[k] / 14000).toBeCloseTo(2 / 7, 1);
  });

  it("drawReward returns a fixed reward unchanged", () => {
    const fixed = { units: { footmen: 2 }, spoils: { Armor: 2 } };
    expect(drawReward(fixed)).toBe(fixed);
    expect(drawReward(null)).toBeNull();
  });
});

describe("levels", () => {
  const L2 = Object.fromEntries(json(2, "levels.json").levels.map((l) => [l.mapId, l]));

  it("the placeholder 'Raid 3' maps the original never lists stay hidden", () => {
    for (const m of [5626, 5629, 5632]) expect(L2[m].hidden).toBe(true);
  });

  it("every Ep2 story / raid / battlefield name is a real string (no 'Item' / undefined)", () => {
    for (const l of Object.values(L2))
      if (!l.hidden) expect(typeof l.name === "string" && l.name.length > 0).toBe(true);
  });
});

describe("campaign", () => {
  it("both kingdom trees are the original's: one prerequisite each (MenuScreen::selectKingdom, Android a_m.k)", () => {
    const tree = (ep) =>
      Object.fromEntries(
        json(ep, "campaign.json").kingdoms.map((k) => [k.name.replace("Kingdom of ", ""), k.unlockAfter]),
      );
    const ep1 = {
      Carrone: [],
      Merovin: ["Carrone"],
      Marsur: ["Merovin"],
      Bordavia: ["Carrone"],
      Sangsoleil: ["Merovin"],
      Aguilleon: ["Marsur"],
      Hunewold: ["Sangsoleil"],
      Rukiev: ["Hunewold"],
    };
    expect(tree(1)).toEqual(ep1);
    expect(tree(2)).toEqual({ ...ep1, Zayandi: [], "Sabbi Amar": ["Zayandi"], Abbisin: ["Sabbi Amar"] });
  });
});

describe("result cutscenes", () => {
  it("unseenLines drops the lines the battle already showed", () => {
    const lines = [{ text: "a" }, { text: "b" }, { text: "c" }];
    expect(unseenLines(lines, ["b"]).map((l) => l.text)).toEqual(["a", "c"]);
    expect(unseenLines(undefined, ["b"])).toEqual([]);
  });

  it("Episode I mission intros don't repeat lines their own battles speak", () => {
    const C = json(1, "campaign.json"),
      L = Object.fromEntries(json(1, "levels.json").levels.map((l) => [l.mapId, l])),
      E = json(1, "battle_events.json");
    for (const k of C.kingdoms)
      for (const m of k.missions) {
        const l = L[m.mapId];
        if (!l) continue;
        const spoken = new Set([
          ...((l.script && l.script.actions) || []).flatMap((a) =>
            a.op === 1 ? (a.lines || []).map((x) => x.text) : [],
          ),
          ...(E[m.mapId] || []).map((e) => e.text),
        ]);
        for (const x of m.intro || []) expect(spoken.has(x.text), `${m.mapId}: ${x.text}`).toBe(false);
      }
  });
});

describe("the campaign openings", () => {
  it("Episode II enters on Episode I's intro (its archive's copy), and keeps its own for the Eastern Kingdoms", () => {
    const C2 = json(2, "campaign.json");
    expect(C2.prologue.map((l) => l.text)).toEqual(
      json(1, "campaign.json")
        .prologue.slice(0, 3)
        .map((l) => l.text),
    );
    const P = C2.episodePrologue;
    expect(P.map((l) => l.text.slice(0, 28))).toEqual([
      "The power and grandeur of th",
      "However, pockets of rebellio",
      "Your loyalty and honor are w",
    ]);
    expect(P.every((l) => l.speaker === "Emperor Sebatini" && l.face === "face056" && l.side === "you")).toBe(true);
    expect(P[2].text).toContain("without question Varius."); // PlayerName FamilyName, offline
    for (const l of P) {
      expect(RU_STORY[l.text]).toBeTruthy();
      expect(UK_STORY[l.text]).toBeTruthy();
    }
  });
});

describe("weapon descriptions (View Unit, UnitSelector::createUnitInfoMenu)", () => {
  it("every weapon has its line; the Sapper and Bodyguard show their own Knives / Armblades", async () => {
    const { WEAPON_NAME, WEAPON_DESC } = await import("../data/combat-data.js");
    const { UNIT_TYPES } = await import("../data/game-data.js");
    for (const w of Object.keys(WEAPON_NAME)) expect(WEAPON_DESC[w], `weapon ${w}`).toBeTruthy();
    expect(UNIT_TYPES.archers.weaponDesc).toBe(WEAPON_DESC[16]);
    expect(UNIT_TYPES.wizards.weaponDesc).toBe(WEAPON_DESC[25]); // the Fireball the card names
    expect(UNIT_TYPES.sapper.weaponName).toBe("Knives");
    expect(UNIT_TYPES.sapper.weaponDesc).toMatch(/^The Knives deliver/);
    expect(UNIT_TYPES.bodyguard.weaponName).toBe("Armblades");
  });
});
