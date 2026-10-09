// The campaign unlock rules (data/campaign-rules.js), on a small hand-made campaign.
import { describe, it, expect } from "vitest";
import {
  kingdomComplete,
  kingdomUnlocked,
  missionUnlocked,
  kingdomRaids,
  raidGate,
  raidUnlocked,
  progressBefore,
} from "../data/campaign-rules.js";

const k = (name, ids, unlockAfter) => ({
  name: "Kingdom of " + name,
  missions: ids.map((mapId) => ({ mapId })),
  unlockAfter,
});
const camp = {
  kingdoms: [k("Carrone", [1, 2], []), k("Bordavia", [3], ["Carrone"]), k("Merovin", [4], ["Carrone", "Bordavia"])],
};
const levels = [
  { mapId: 12, group: "siege", kingdom: "Carrone" },
  { mapId: 11, group: "siege", kingdom: "Carrone" },
  { mapId: 13, group: "siege", kingdom: "Carrone", hidden: true },
  { mapId: 31, group: "siege", kingdom: "Bordavia" },
  { mapId: 2, group: "story", kingdom: "Carrone" },
];

describe("campaign rules", () => {
  it("a kingdom opens once every kingdom in its unlockAfter list is complete; its battles go in order", () => {
    const p = new Set();
    expect(kingdomUnlocked(camp, 0, p)).toBe(true); // a root
    expect(kingdomUnlocked(camp, 1, p)).toBe(false);
    expect(missionUnlocked(camp, 0, 0, p)).toBe(true);
    expect(missionUnlocked(camp, 0, 1, p)).toBe(false);
    expect(missionUnlocked(camp, 1, 0, p)).toBe(false);
    p.add(1);
    expect(missionUnlocked(camp, 0, 1, p)).toBe(true);
    p.add(2);
    expect(kingdomComplete(camp.kingdoms[0], p)).toBe(true);
    expect(kingdomUnlocked(camp, 1, p)).toBe(true);
    expect(kingdomUnlocked(camp, 2, p)).toBe(false); // needs Bordavia too
    p.add(3);
    expect(kingdomUnlocked(camp, 2, p)).toBe(true);
    expect(kingdomUnlocked(null, 0, p)).toBe(false);
    expect(kingdomComplete(undefined, p)).toBe(false);
  });

  it("without unlockAfter data, a kingdom follows the previous one", () => {
    const linear = { kingdoms: [k("A", [1]), k("B", [2])] };
    expect(kingdomUnlocked(linear, 0, new Set())).toBe(true);
    expect(kingdomUnlocked(linear, 1, new Set())).toBe(false);
    expect(kingdomUnlocked(linear, 1, new Set([1]))).toBe(true);
  });

  it("a kingdom's raids are its visible siege levels in map order", () => {
    expect(kingdomRaids(levels, camp.kingdoms[0]).map((l) => l.mapId)).toEqual([11, 12]);
    expect(kingdomRaids(null, camp.kingdoms[2])).toEqual([]);
  });

  it("raids open with the story, not one after another (MenuScreen::initMenuState)", () => {
    const kd = (name, order, ids, unlockAfter) => ({ ...k(name, ids, unlockAfter), order });
    const saga = {
      kingdoms: [
        kd("Carrone", 0, [1, 2, 3], []),
        kd("Merovin", 1, [4, 5, 6], ["Carrone"]),
        kd("Zayandi", 8, [7, 8, 9], []),
      ],
    };
    const open = (ki, ri, won) => raidUnlocked(saga, ki, ri, new Set(won));
    // Carrone's raid: after its last story battle
    expect(raidGate(saga, 0, 0).mapId).toBe(3);
    expect(open(0, 0, [1, 2])).toBe(false);
    expect(open(0, 0, [1, 2, 3])).toBe(true);
    // the old kingdoms: raid i after story battle i, whether or not the raid before it is won
    expect(open(1, 0, [1, 2, 3])).toBe(false);
    expect(open(1, 0, [1, 2, 3, 4])).toBe(true);
    expect(open(1, 1, [1, 2, 3, 4])).toBe(false);
    expect(open(1, 1, [1, 2, 3, 4, 5])).toBe(true);
    expect(open(1, 2, [1, 2, 3, 4, 5, 6])).toBe(true);
    expect(open(1, 0, [4])).toBe(false); // the kingdom itself is still closed
    // Episode II's Eastern kingdoms: raid i after story battle i + 1
    expect(open(2, 0, [7])).toBe(false);
    expect(open(2, 0, [7, 8])).toBe(true);
    expect(open(2, 1, [7, 8])).toBe(false);
    expect(open(2, 1, [7, 8, 9])).toBe(true);
    expect(raidGate(saga, 2, 2)).toBeNull();
    expect(raidGate(null, 0, 0)).toBeNull();
  });

  it("dev 'set progress': everything before the chosen battle is won, plus the raids those battles opened", () => {
    expect([...progressBefore(camp, levels, 3)]).toEqual([1, 2, 11, 12]);
    expect([...progressBefore(camp, levels, 1)]).toEqual([]);
    expect([...progressBefore(camp, levels, 999)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 11, 12, 31]); // unknown → all
  });
});
