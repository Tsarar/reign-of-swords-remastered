// The campaign shell's pure data + helpers (data/shell-data.js): per-episode saves, dialogue portraits, the unit
// skill pills built from the real unit table, the Field Manual's ability/armour/movement tagging, heraldry rank &
// colour maths, the player-name swap in the story, and the reward draw / cutscene de-duplication.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ASSET_PATHS,
  base,
  PROGRESS_KEY,
  epKey,
  loadProgress,
  saveProgress,
  FACE_SRC,
  LINE_FACE,
  faceSide,
  UNIT_META,
  unitSkills,
  hudClass,
  UPGRADE_FROM,
  SANDBOX_ARMY,
  SANDBOX_ARMY_EP2,
  EP2_ORDER,
  combineCounts,
  jload,
  jsave,
  GET_OPTIONS,
  unitsWithAbility,
  unitsWithArmour,
  movementClass,
  unitsWithMovement,
  abilityTitle,
  heraldTitle,
  shadeHex,
  rgb01,
  loadHeraldry,
  loadPlayerName,
  NAME_KEY,
  subName,
  drawReward,
  unseenLines,
} from "../data/shell-data.js";
import { UNIT_TYPES } from "../engine/engine.js";

afterEach(() => vi.restoreAllMocks());

const names = (key) => unitSkills(key).map((s) => s.n);

describe("per-episode campaign save", () => {
  it("Episode II keeps its own keys; Episode I uses the bare key", () => {
    expect(epKey("ros-x", false)).toBe("ros-x");
    expect(epKey("ros-x", true)).toBe("ros-x-ep2");
  });

  it("progress round-trips through localStorage, separately per episode", () => {
    expect(loadProgress().size).toBe(0);
    saveProgress(new Set([5400, 5401]));
    saveProgress(new Set([5424]), true);
    expect([...loadProgress()]).toEqual([5400, 5401]);
    expect([...loadProgress(true)]).toEqual([5424]);
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY))).toEqual([5400, 5401]);
  });

  it("a corrupted save loads as a fresh campaign, and a blocked storage never throws", () => {
    localStorage.setItem(PROGRESS_KEY, "{not json");
    expect(loadProgress().size).toBe(0);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveProgress(new Set([1]))).not.toThrow();
    expect(() => jsave("k", 1)).not.toThrow();
  });

  it("jload returns the default for a missing / broken value and the stored value otherwise", () => {
    expect(jload("nope", { a: 1 })).toEqual({ a: 1 });
    localStorage.setItem("bad", "{");
    expect(jload("bad", 7)).toBe(7);
    jsave("good", { Armor: 2 });
    expect(jload("good", {})).toEqual({ Armor: 2 });
  });

  it("combineCounts adds roster maps and clamps a negative total to zero", () => {
    expect(combineCounts({ footmen: 2 }, { footmen: 1, archers: 1 }, { archers: -3 })).toEqual({
      footmen: 3,
      archers: 0,
    });
    expect(combineCounts()).toEqual({});
  });
});

describe("dialogue portraits", () => {
  it("a decoded face id resolves against the episode dir; a narration line has no bust", () => {
    expect(LINE_FACE({ face: "face013" })).toBe(base + "portraits/face013.png");
    expect(LINE_FACE({ face: "face052" }, "/ep2/")).toBe("/ep2/portraits/face052.png");
    expect(LINE_FACE({ face: "" })).toBeNull();
    expect(LINE_FACE({ text: "x" })).toBeNull();
    expect(LINE_FACE(null)).toBeNull();
  });

  it("a legacy role key falls back through the cast table (unknown roles get the soldier)", () => {
    expect(LINE_FACE({ face: "weird", portrait: "emperor" })).toBe(base + "portraits/face005.png");
    expect(FACE_SRC("nobody")).toBe(base + "portraits/face008.png");
  });

  it("left-looking busts sit on the right so they face the text", () => {
    expect(faceSide("anston")).toBe("right");
    expect(faceSide("emperor")).toBe("left");
  });

  it("the asset list ships every unit sprite, the portraits and the audio", () => {
    expect(ASSET_PATHS).toContain("campaign.json");
    expect(ASSET_PATHS).toContain("sprites/knights.png");
    expect(ASSET_PATHS).toContain("portraits/face015.png");
    expect(ASSET_PATHS).toContain("audio/victory.mp3");
  });
});

describe("unit skill pills (from the real unit table)", () => {
  it("the cannon's Blast Area is its Grapeshot, and Low Arc is a trajectory", () => {
    const n = names("cannon");
    expect(n).toContain("Grapeshot");
    expect(n).not.toContain("Blast Area");
    expect(n).toContain("Low Arc");
    expect(n).toContain("Siege");
    expect(n).toContain("Ranged");
  });

  it("the trebuchet and ballistae each get their own Arc wording", () => {
    const tre = unitSkills("trebuchet").find((s) => s.n === "Arc");
    const bal = unitSkills("ballistae").find((s) => s.n === "Arc");
    expect(tre.d).toMatch(/Trebuchet/);
    expect(bal.d).toMatch(/Ballistae/);
    expect(names("ballistae")).toEqual(expect.arrayContaining(["Siege Armor", "Piercing Bolt"]));
  });

  it("the wizard gets Fireball, Lightning Storm, Ice Field and Teleport; the priest gets Retribution", () => {
    expect(names("wizards")).toEqual(expect.arrayContaining(["Fireball", "Lightning Storm", "Ice Field", "Teleport"]));
    expect(names("priests")).toEqual(
      expect.arrayContaining(["Prayer: Heal", "Prayer: Shield", "Prayer: Retribution", "Formation"]),
    );
  });

  it("Ep2 traits become pills (Quicksand, Life Steal, Conjure, Absorb, Detonate, Build, Repair)", () => {
    expect(names("dunesirens")).toContain("Quicksand");
    expect(names("bloodgorgers")).toEqual(expect.arrayContaining(["Life Steal", "Last Strike"]));
    expect(names("conjurer")).toContain("Conjure");
    expect(names("bodyguard")).toContain("Absorb");
    expect(names("sapper")).toContain("Detonate");
    expect(names("craftsmen")).toEqual(expect.arrayContaining(["Build", "Repair", "Ranged"]));
  });

  it("the griffon flies and frightens; skills are de-duplicated; an unknown unit has none", () => {
    expect(names("griffon")).toEqual(expect.arrayContaining(["Flight", "Fear", "Charge"]));
    for (const k of Object.keys(UNIT_TYPES)) expect(new Set(names(k)).size).toBe(names(k).length);
    expect(unitSkills("no-such-unit")).toEqual([]);
  });

  it("hudClass picks one emblem per unit by precedence", () => {
    expect(hudClass("griffon", UNIT_TYPES.griffon)).toBe("class_fly");
    expect(hudClass("catapult", UNIT_TYPES.catapult)).toBe("class_siege");
    expect(hudClass("druids", UNIT_TYPES.druids)).toBe("class_caster");
    expect(hudClass("x", { magic: true })).toBe("class_caster");
    expect(hudClass("king", UNIT_TYPES.king)).toBe("class_cavalry");
    expect(hudClass("horsebowmen", UNIT_TYPES.horsebowmen)).toBe("class_cavalry");
    expect(hudClass("footmen", UNIT_TYPES.footmen)).toBe("class_light");
  });
});

describe("the army economy tables", () => {
  it("UPGRADE_FROM names the first unit (and collectible) that upgrades into each type", () => {
    expect(UPGRADE_FROM.footmen).toEqual({ from: "militiamen", need: "Armor" });
    expect(UPGRADE_FROM.king).toEqual({ from: "knights", need: "Medal" });
    expect(UPGRADE_FROM.militiamen).toBeUndefined();
    for (const [to, e] of Object.entries(UPGRADE_FROM))
      expect(UNIT_META[e.from].upgrades.some((u) => u.to === to && u.need === e.need)).toBe(true);
  });

  it("the Ep2 sandbox fields the Episode II units too; the merchant never sells Medals", () => {
    for (const k of EP2_ORDER) {
      expect(SANDBOX_ARMY_EP2[k]).toBe(30);
      expect(SANDBOX_ARMY[k]).toBeUndefined();
    }
    expect(GET_OPTIONS.map((o) => o.id)).not.toContain("Medal");
    expect(GET_OPTIONS.at(-1)).toMatchObject({ id: "militiamen", unit: true });
  });
});

describe("Field Manual tagging", () => {
  it("numeric ability indices match the units' real ability lists", () => {
    expect(unitsWithAbility(27)).toEqual(["pikemen"]);
    expect(unitsWithAbility(15)).toEqual(expect.arrayContaining(["knights", "cavalry", "king", "stag"]));
  });

  it("trait keys resolve to the units carrying the trait (Ep2 traits only on the Ep2 route)", () => {
    expect(unitsWithAbility("fly")).toEqual(expect.arrayContaining(["griffon", "greateagle"]));
    expect(unitsWithAbility("siege")).toEqual(expect.arrayContaining(["catapult", "cannon", "trebuchet"]));
    expect(unitsWithAbility("skirmish")).toEqual([]);
    expect(unitsWithAbility("teleport")).toEqual(["wizards"]);
    expect(unitsWithAbility("cavalry")).toContain("knights");
    expect(unitsWithAbility("lightning")).toEqual(["wizards"]);
    expect(unitsWithAbility("ice")).toEqual(["wizards"]);
    expect(unitsWithAbility("flammable")).toEqual(expect.arrayContaining(["catapult", "trebuchet"]));
    expect(unitsWithAbility("siegeArmor")).toEqual([]);
    expect(unitsWithAbility("siegeArmor", true)).toEqual(["ballistae"]);
    expect(unitsWithAbility("pierce", true)).toEqual(["ballistae"]);
    expect(unitsWithAbility("quicksand", true)).toEqual(["dunesirens"]);
    expect(unitsWithAbility("lifeSteal", true)).toEqual(["bloodgorgers"]);
    expect(unitsWithAbility("conjure", true)).toEqual(["conjurer"]);
    expect(unitsWithAbility("absorb", true)).toEqual(["bodyguard"]);
    expect(unitsWithAbility("detonate", true)).toEqual(["sapper"]);
    expect(unitsWithAbility("build", true)).toEqual(["craftsmen"]);
    expect(unitsWithAbility("repair", true)).toEqual(["craftsmen"]);
    expect(unitsWithAbility("bogus")).toEqual([]);
  });

  it("armour entry i lists the units whose armour index is i", () => {
    expect(unitsWithArmour(12)).toEqual(expect.arrayContaining(["catapult", "cannon", "trebuchet"]));
    expect(unitsWithArmour(12, true)).toContain("ballistae");
    expect(unitsWithArmour(99)).toEqual([]);
  });

  it("each unit has exactly one movement class, by precedence", () => {
    expect(movementClass("griffon")).toBe("fly");
    expect(movementClass("wizards")).toBe("teleport");
    expect(movementClass("cannon")).toBe("siege");
    expect(movementClass("horsebowmen")).toBe("cavalry");
    expect(movementClass("footmen")).toBe("formation");
    expect(movementClass("militiamen")).toBe("standard");
    expect(movementClass("nope")).toBe("standard");
    expect(unitsWithMovement("teleport")).toEqual(["wizards"]);
    expect(unitsWithMovement("siege", true)).toContain("ballistae");
  });

  it("abilityTitle names an entry, or null for none", () => {
    expect(abilityTitle(27)).toBe("Pike Wall");
    expect(abilityTitle("ice")).toBe("Ice Field");
    expect(abilityTitle(null)).toBeNull();
    expect(abilityTitle(99)).toBeNull();
  });
});

describe("heraldry", () => {
  it("the rank rises with missions won", () => {
    expect(heraldTitle(0).title).toBe("Squire");
    expect(heraldTitle(3).title).toBe("Knight");
    expect(heraldTitle(14).title).toBe("Knight Banneret");
    expect(heraldTitle(24).title).toBe("Warden of Carrone");
    expect(heraldTitle(99).border).toBe(1);
  });

  it("shadeHex darkens / lightens a colour, rgb01 splits it into 0..1 channels", () => {
    expect(shadeHex("#808080", -0.5)).toBe("#404040");
    expect(shadeHex("#000000", 1)).toBe("#ffffff");
    expect(shadeHex("#123456", 0)).toBe("#123456");
    expect(rgb01("#ff0080")).toEqual([1, 0, 128 / 255]);
  });

  it("loadHeraldry defaults to argent/gules and migrates both old save formats", () => {
    expect(loadHeraldry()).toEqual({ bgColor: "argent", bgType: 0, symbol: 51, symbolColor: "gules" });
    const cur = { bgColor: "azure", bgType: 3, symbol: 12, symbolColor: "or" };
    localStorage.setItem("ros-heraldry-v1", JSON.stringify(cur));
    expect(loadHeraldry()).toEqual(cur);
    localStorage.setItem("ros-heraldry-v1", JSON.stringify({ bgColor: "vert" }));
    expect(loadHeraldry()).toEqual({ bgColor: "vert", bgType: 0, symbol: 51, symbolColor: "gules" });
    localStorage.setItem("ros-heraldry-v1", JSON.stringify({ bgColor: "vert", symbolColor: "or" }));
    expect(loadHeraldry().symbolColor).toBe("or");
    localStorage.setItem("ros-heraldry-v1", JSON.stringify({ field: "sable", chief: "or" }));
    expect(loadHeraldry()).toEqual({ bgColor: "sable", bgType: 0, symbol: 51, symbolColor: "or" });
    localStorage.setItem("ros-heraldry-v1", JSON.stringify({ field: "sable" }));
    expect(loadHeraldry().symbolColor).toBe("gules");
    localStorage.setItem("ros-heraldry-v1", "{broken");
    expect(loadHeraldry().bgColor).toBe("argent");
  });
});

describe("the player's name in the story", () => {
  it("is canonically Varius, and the story is untouched until renamed", () => {
    expect(loadPlayerName()).toBe("Varius");
    expect(subName("Rest well, Varius.")).toBe("Rest well, Varius.");
    expect(subName("")).toBe("");
    expect(subName(null)).toBeNull();
    localStorage.setItem(NAME_KEY, "Varius");
    expect(subName("Sir Varius")).toBe("Sir Varius");
  });

  it("a custom name is title-cased and replaces Varius (whole word only)", () => {
    localStorage.setItem(NAME_KEY, "  jOHN smith ");
    expect(loadPlayerName()).toBe("  jOHN smith ");
    expect(subName("Sir Varius! Varius, rest. Variuses stay.")).toBe(
      "Sir John Smith! John Smith, rest. Variuses stay.",
    );
  });

  it("the Russian / Ukrainian declined forms are replaced whole", () => {
    localStorage.setItem(NAME_KEY, "Олег");
    expect(subName("Сэр Вариус, слава Вариусу!")).toBe("Сэр Олег, слава Олег!");
    expect(subName("Варіусе, вперед")).toBe("Олег, вперед");
  });

  it("a blocked storage falls back to the canonical name", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPlayerName()).toBe("Varius");
    expect(subName("Sir Varius")).toBe("Sir Varius");
  });
});

describe("rewards and cutscene lines", () => {
  it("drawReward with a random pool draws `pick` distinct entries, tallied into units / spoils", () => {
    const pool = [{ spoil: "Armor" }, { unit: "footmen" }, { spoil: "Lore" }];
    const seq = [0, 0, 0];
    let i = 0;
    const w = drawReward({ random: true, pick: 3, pool }, () => seq[i++]);
    expect(w.drawn).toEqual(["Armor", "footmen", "Lore"]);
    expect(w.units).toEqual({ footmen: 1 });
    expect(w.spoils).toEqual({ Armor: 1, Lore: 1 });
  });

  it("drawReward never draws more than the pool holds, and a missing pick draws nothing", () => {
    expect(drawReward({ random: true, pick: 9, pool: [{ spoil: "Armor" }] }).drawn).toEqual(["Armor"]);
    expect(drawReward({ random: true, pool: [{ spoil: "Armor" }] }).drawn).toEqual([]);
    expect(drawReward({ random: true })).toEqual({ random: true }); // no pool → returned as is
    expect(drawReward(undefined)).toBeNull();
  });

  it("unseenLines drops what the battle already showed", () => {
    const lines = [{ text: "a" }, { text: "b" }];
    expect(unseenLines(lines, ["a"])).toEqual([{ text: "b" }]);
    expect(unseenLines(lines)).toEqual(lines);
    expect(unseenLines(null, ["a"])).toEqual([]);
  });
});
