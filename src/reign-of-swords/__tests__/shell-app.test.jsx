// The campaign shell (ui/ReignShell.jsx) as a player meets it: main menu, prologue, world map, kingdoms and their
// tutorials / missions / raids, the pre-battle briefs, the battle hand-off and its result (cutscene → spoils → map),
// the camp screens (Upgrade Army, Merchant, Heraldry), the Field Manual, Online Battles, Settings and the dev bar.
// The battle itself (ui/ReignOfSwords.jsx) is a stub that records its props, so a test can end a battle on cue.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act, within } from "@testing-library/react";
import { stubAudio, patchFetch } from "./shell-helpers.js";

const battle = { props: null, renders: 0 };
vi.mock("../ui/ReignOfSwords.jsx", () => ({
  default: (p) => {
    battle.props = p;
    battle.renders++;
    return <div data-testid="battle">battle {String(p.campaignMapId)}</div>;
  },
}));
vi.mock("../engine/engine.js", async (importOriginal) => ({ ...(await importOriginal()), preloadReign: vi.fn() }));

const { default: ReignShell } = await import("../ui/ReignShell.jsx");
const { preloadReign } = await import("../engine/engine.js");

const EP2 = "/games/reign-of-swords-2/";
const btn = (name) => screen.getByRole("button", { name });
let plays;

beforeEach(() => {
  plays = stubAudio();
  battle.props = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(props = {}) {
  const r = render(<ReignShell {...props} />);
  await waitFor(() => expect(r.container.querySelector(".ros-menu")).toBeTruthy());
  // levels + rewards land after the campaign file
  await waitFor(() => expect(r.container.querySelectorAll(".ros-admin-sel, .ros-dev-show").length).toBeGreaterThan(0));
  await act(async () => {
    await new Promise((res) => setTimeout(res, 30));
  });
  return r;
}
const skip = () => fireEvent.click(btn(/Skip/));
const carroneWon = () => localStorage.setItem("ros-campaign-v1", JSON.stringify([5400, 5401, 5402]));
const openKingdom = (name) =>
  fireEvent.click(screen.getByText(name, { selector: ".ros-kmark-label, .ros-kmark-label *" }).closest("button"));
const progressOf = (ep2 = false) =>
  JSON.parse(localStorage.getItem(ep2 ? "ros-campaign-v1-ep2" : "ros-campaign-v1") || "[]");

describe("loading", () => {
  it("shows the loader until the campaign file arrives, and warms the battle caches once idle", async () => {
    vi.useFakeTimers();
    const ric = globalThis.requestIdleCallback;
    delete globalThis.requestIdleCallback;
    const { container, unmount } = render(<ReignShell />);
    expect(container.querySelector(".ros-shell")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(preloadReign).toHaveBeenCalled();
    unmount();
    vi.useRealTimers();
    globalThis.requestIdleCallback = ric;
  });

  it("a missing campaign file still opens the menu, with an empty world map", async () => {
    const restore = patchFetch({
      "campaign.json": "fail",
      "levels.json": "fail",
      "rewards.json": "fail",
      "battle_events.json": "fail",
    });
    try {
      const { container } = render(<ReignShell />);
      await waitFor(() => expect(container.querySelector(".ros-menu")).toBeTruthy());
      fireEvent.click(btn("Campaign"));
      expect(container.querySelectorAll(".ros-kmark").length).toBe(0);
    } finally {
      restore();
    }
  });
});

describe("main menu", () => {
  it("Campaign plays the prologue on a fresh save, then opens the world map", async () => {
    const { container } = await mount();
    expect(container.querySelector(".ros-menu-sub")).toBeTruthy();
    fireEvent.click(btn("Campaign"));
    expect(container.querySelector(".ros-cutscene")).toBeTruthy();
    skip();
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
    fireEvent.click(btn(/Main Menu/));
    expect(container.querySelector(".ros-menu")).toBeTruthy();
  });

  it("Skirmish opens a free battle that exits back to the menu", async () => {
    const { container } = await mount();
    fireEvent.click(btn("Skirmish Battles"));
    expect(screen.getByTestId("battle")).toBeTruthy();
    expect(battle.props.campaignMapId).toBeUndefined();
    act(() => battle.props.onExit());
    expect(container.querySelector(".ros-menu")).toBeTruthy();
  });

  it("Field Manual, Online Battles and Settings open and close", async () => {
    const { container } = await mount();
    fireEvent.click(btn(/Field Manual/));
    expect(container.querySelector(".ros-menu")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Main Menu/ })); // once the manual has loaded
    // Online Battles: the lobby screen — signed out (no account here), it says how to get in and offers hot-seat
    fireEvent.click(btn("Online Battles"));
    expect(container.querySelector(".ros-online")).toBeTruthy();
    expect(btn(/Hot-seat/)).toBeTruthy(); // the head-to-head battle, for two players on one device
    fireEvent.click(btn(/Main Menu/));
    expect(container.querySelector(".ros-online")).toBeNull();
    expect(container.querySelector(".ros-menu")).toBeTruthy();
    fireEvent.click(btn(/Settings/));
    fireEvent.click(btn("Close"));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("every button press plays the menu click (debounced), and nothing while effects are muted", async () => {
    await mount();
    let t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    fireEvent.click(btn("Online Battles"));
    expect(plays.filter((p) => p.src.endsWith("select.mp3")).length).toBe(1);
    fireEvent.click(btn(/Main Menu/)); // within 90 ms: no second blip
    expect(plays.filter((p) => p.src.endsWith("select.mp3")).length).toBe(1);
    t += 500;
    fireEvent.click(document.body); // not a button
    expect(plays.filter((p) => p.src.endsWith("select.mp3")).length).toBe(1);
    fireEvent.click(btn(/Dev/));
    fireEvent.click(btn(/Effects/)); // mute effects
    t += 500;
    const n = plays.length;
    fireEvent.click(btn("Online Battles"));
    expect(plays.length).toBe(n);
    expect(localStorage.getItem("ros-muted")).toBe("1");
  });
});

describe("the world map", () => {
  it("only Carrone is open on a fresh save; its panel lists the tutorials, the war plans and the raids", async () => {
    const { container } = await mount();
    fireEvent.click(btn("Campaign"));
    skip();
    const marks = [...container.querySelectorAll(".ros-kmark")];
    expect(marks.filter((b) => !b.disabled).length).toBe(1);
    openKingdom("Carrone");
    expect(container.querySelectorAll(".ros-ktut").length).toBeGreaterThan(0);
    const missions = [...container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")];
    expect(missions[0].disabled).toBe(false);
    expect(missions[1].disabled).toBe(true);
    // Carrone's raid opens once its last story battle is won (MenuScreen::initMenuState)
    const raids = [...container.querySelectorAll(".ros-kraid")];
    expect(raids.length).toBe(1);
    expect(raids[0].disabled).toBe(true);
    expect(raids[0].title).toMatch(/^Win Defense of the Emperor to unlock /);
    // the panel closes with ✕ or a click outside it, not a click inside
    fireEvent.click(container.querySelector(".ros-kpanel"));
    expect(container.querySelector(".ros-kpanel")).toBeTruthy();
    fireEvent.click(btn("✕"));
    expect(container.querySelector(".ros-kpanel")).toBeNull();
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kpanel-back"));
    expect(container.querySelector(".ros-kpanel")).toBeNull();
  });

  it("a tutorial is fought with the practice army and is marked done by a win", async () => {
    const { container } = await mount();
    fireEvent.click(btn("Campaign"));
    skip();
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-ktut"));
    expect(screen.getByTestId("battle")).toBeTruthy();
    const tut = battle.props.campaignMapId;
    act(() => battle.props.onEnd("victory"));
    expect(progressOf()).toContain(tut);
    openKingdom("Carrone");
    expect(container.querySelector(".ros-ktut.done")).toBeTruthy();
    // leaving a tutorial by its menu just returns
    fireEvent.click(container.querySelector(".ros-ktut"));
    act(() => battle.props.onExit());
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
  });

  it("a mission: brief → Start → story → battle → victory story → spoils → the map; the next mission opens", async () => {
    const { container } = await mount();
    fireEvent.click(btn("Campaign"));
    skip();
    openKingdom("Carrone");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[0]);
    expect(container.querySelector(".ros-mission-preview")).toBeTruthy();
    expect(screen.getByText("Turn Limit")).toBeTruthy();
    fireEvent.click(btn(/Back/));
    expect(container.querySelector(".ros-mission-preview")).toBeNull();
    openKingdom("Carrone");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[0]);
    fireEvent.click(container.querySelector(".ros-mission-preview")); // inside: stays
    fireEvent.click(btn(/Start Mission/));
    skip(); // the Emperor's brief + the mission's intro
    expect(screen.getByTestId("battle")).toBeTruthy();
    const mid = battle.props.campaignMapId;
    expect(mid).toBe(5400);
    expect(battle.props.army).toEqual({});
    act(() => battle.props.onEnd("victory", [], false, []));
    skip(); // the victory story
    expect(progressOf()).toContain(5400);
    if (container.querySelector(".ros-reward")) {
      expect(plays.some((p) => p.src.endsWith("coins.mp3"))).toBe(true);
      fireEvent.click(btn(/Continue/));
    }
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
    openKingdom("Carrone");
    const missions = [...container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")];
    expect(missions[0].classList.contains("done")).toBe(true);
    expect(missions[1].disabled).toBe(false);
  });

  it("a replayed story mission pays no second reward; a defeat just returns to the map", async () => {
    localStorage.setItem("ros-campaign-v1", JSON.stringify([5400]));
    const { container } = await mount();
    fireEvent.click(btn("Campaign")); // progress exists: no prologue
    openKingdom("Carrone");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[0]);
    fireEvent.click(btn(/Start Mission/));
    skip();
    act(() => battle.props.onEnd("victory", [], false, []));
    skip();
    expect(container.querySelector(".ros-reward")).toBeNull();
    openKingdom("Carrone");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[1]);
    fireEvent.click(btn(/Start Mission/));
    skip();
    act(() => battle.props.onEnd("defeat", [], false, []));
    skip();
    expect(progressOf()).toEqual([5400]);
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
    // exiting a battle from its menu returns to the map
    openKingdom("Carrone");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[1]);
    fireEvent.click(btn(/Start Mission/));
    skip();
    act(() => battle.props.onExit());
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
  });

  it("a raid: preview with its spoils → Begin → victory pays the spoils every win; a Major Victory adds a Medal", async () => {
    carroneWon(); // Carrone's story won: its raid is open (and no prologue plays)
    const { container } = await mount();
    fireEvent.click(btn("Campaign"));
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    expect(screen.getByText("Spoils on victory")).toBeTruthy();
    expect(screen.getByText("Major Victory: +1 Medal")).toBeTruthy();
    fireEvent.click(container.querySelector(".ros-mission-preview"));
    fireEvent.click(btn(/Back/));
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    fireEvent.click(btn(/Begin Raid/));
    expect(battle.props.medals).toBe(true);
    const rid = battle.props.campaignMapId;
    act(() => battle.props.onEnd("victory", [], true));
    expect(container.querySelector(".ros-reward")).toBeTruthy();
    expect(container.querySelector(".ros-reward").textContent).toMatch(/Medal/);
    fireEvent.click(btn(/Continue/));
    const spoils = JSON.parse(localStorage.getItem("ros-spoils-v3"));
    expect(spoils.Medal).toBe(1);
    expect(progressOf()).toContain(rid);
    // a second win pays again (raids are farmable); its units go into the army
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    expect(screen.getByText(/cleared/)).toBeTruthy();
    fireEvent.click(btn(/Begin Raid/));
    act(() => battle.props.onEnd("victory", [], false));
    if (container.querySelector(".ros-reward")) fireEvent.click(btn(/Continue/));
    // a lost raid changes nothing
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    fireEvent.click(btn(/Begin Raid/));
    act(() => battle.props.onEnd("defeat", [], false));
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
    // and leaving it from its menu
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    fireEvent.click(btn(/Begin Raid/));
    act(() => battle.props.onExit());
    expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
  });

  it("a raid with no reward on file returns straight to the map", async () => {
    carroneWon(); // Carrone's story won: its raid is open (and no prologue plays)
    const restore = patchFetch({ "rewards.json": () => ({}) });
    try {
      const { container } = await mount();
      fireEvent.click(btn("Campaign"));
      openKingdom("Carrone");
      fireEvent.click(container.querySelector(".ros-kraid"));
      expect(screen.getByText("Spoils of war on victory.")).toBeTruthy();
      fireEvent.click(btn(/Begin Raid/));
      act(() => battle.props.onEnd("victory", [], false));
      expect(container.querySelector(".ros-reward")).toBeNull();
      expect(screen.getByRole("heading", { name: "March of the Empire" })).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe("the camp", () => {
  it("the Merchant and the Heraldry screens open from the map and return to it", async () => {
    const { container } = await mount();
    fireEvent.click(btn(/Dev/));
    fireEvent.click(btn(/Give resources/));
    fireEvent.click(btn("Campaign"));
    skip();
    fireEvent.click(btn(/The Merchant/));
    expect(container.querySelector(".ros-worldmap")).toBeNull();
    fireEvent.click(btn(/Main Menu/));
    expect(container.querySelector(".ros-worldmap")).toBeTruthy();
    fireEvent.click(container.querySelector(".ros-res-crest-btn"));
    expect(screen.getByText("Background Colour")).toBeTruthy();
    fireEvent.click(btn(/Main Menu/));
    expect(container.querySelector(".ros-worldmap")).toBeTruthy();
  });

  it("the Merchant trades a collectible for another one, or for a Militiaman", async () => {
    const { container } = await mount();
    fireEvent.click(btn(/Dev/));
    fireEvent.click(btn(/Give resources/));
    fireEvent.click(btn("Campaign"));
    skip();
    fireEvent.click(btn(/The Merchant/));
    const before = JSON.parse(localStorage.getItem("ros-spoils-v3"));
    const cols = container.querySelectorAll(".ros-mch-col");
    fireEvent.click(within(cols[0]).getByText("Armor").closest("button"));
    fireEvent.click(within(cols[1]).getByText("Lore").closest("button"));
    fireEvent.click(btn("More"));
    fireEvent.click(btn("Exchange"));
    const after = JSON.parse(localStorage.getItem("ros-spoils-v3"));
    expect(after.Armor).toBe(before.Armor - 6); // 2 Lore at 3 Armor each
    expect(after.Lore).toBe(before.Lore + 2);
    expect(plays.some((p) => p.src.endsWith("coins.mp3"))).toBe(true);
    // a Militiaman for one Armor, one Weapons and one Lore
    fireEvent.click(container.querySelector(".ros-mch-chip.unit"));
    fireEvent.click(btn("Exchange"));
    expect(JSON.parse(localStorage.getItem("ros-updelta-v1")).militiamen).toBe(1);
    const paid = JSON.parse(localStorage.getItem("ros-spoils-v3"));
    expect([paid.Armor, paid.Weapons, paid.Lore]).toEqual([after.Armor - 1, after.Weapons - 1, after.Lore - 1]);
  });
});

describe("the dev bar", () => {
  it("opens and hides; jumps into any battle and back; sets campaign progress; god army; resources; reset", async () => {
    const { container } = await mount();
    fireEvent.click(btn(/Dev/));
    const [jump] = container.querySelectorAll(".ros-admin-sel");
    // jump to a battle, then leave it
    fireEvent.change(jump, { target: { value: "5412" } });
    expect(battle.props.campaignMapId).toBe(5412);
    expect(battle.props.godArmy).toBe(true);
    // in a battle the bar is a small pill
    expect(container.querySelector(".ros-admin-battle")).toBeTruthy();
    fireEvent.click(btn(/Dev/));
    expect(container.querySelector(".ros-admin.ros-admin-battle")).toBeTruthy();
    fireEvent.click(btn("Hide developer tools"));
    act(() => battle.props.onEnd("victory"));
    expect(container.querySelector(".ros-menu")).toBeTruthy();
    fireEvent.change(jump.isConnected ? jump : container.querySelectorAll(".ros-admin-sel")[0], {
      target: { value: "" },
    });
    // the deployment tutorial is fought with the tutorial army, never god mode
    fireEvent.change(container.querySelectorAll(".ros-admin-sel")[0], { target: { value: "5802" } });
    expect(battle.props.godArmy).toBe(false);
    act(() => battle.props.onExit());
    // progress: the chosen mission becomes the next one to play
    fireEvent.change(container.querySelectorAll(".ros-admin-sel")[1], { target: { value: "5403" } });
    expect(progressOf()).toEqual(expect.arrayContaining([5400, 5401, 5402]));
    expect(progressOf()).not.toContain(5403);
    fireEvent.change(container.querySelectorAll(".ros-admin-sel")[1], { target: { value: "" } }); // the placeholder: no change
    expect(progressOf()).not.toContain(5403);
    // Bordavia is open now; its raids are listed in order, the first one unlocked
    openKingdom("Bordavia");
    const braids = [...container.querySelectorAll(".ros-kraid")];
    expect(braids.length).toBeGreaterThan(1);
    expect(braids[0].disabled).toBe(false);
    fireEvent.click(btn("✕"));
    // god army
    fireEvent.click(btn(/God army/));
    expect(localStorage.getItem("ros-godarmy")).toBe("1");
    expect(btn(/God army ON/)).toBeTruthy();
    openKingdom("Carrone");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[0]);
    fireEvent.click(btn(/Start Mission/));
    skip();
    expect(battle.props.godArmy).toBe(true);
    expect(Object.keys(battle.props.army).length).toBeGreaterThan(5);
    act(() => battle.props.onExit());
    fireEvent.click(btn(/God army ON/));
    expect(localStorage.getItem("ros-godarmy")).toBe("0");
    // music toggles (♪ Next song lives in the battle's top bar now)
    fireEvent.click(btn(/Music/));
    expect(localStorage.getItem("ros-muted-music")).toBe("1");
    fireEvent.click(btn(/Music off/));
    expect(localStorage.getItem("ros-muted-music")).toBe("0");
    // hard reset wipes the save and returns to the menu
    fireEvent.click(btn(/Hard reset/));
    expect(localStorage.getItem("ros-campaign-v1")).toBeNull();
    expect(container.querySelector(".ros-menu")).toBeTruthy();
    fireEvent.click(btn("Hide developer tools"));
    expect(container.querySelector(".ros-admin")).toBeNull();
  });
});

describe("Episode II", () => {
  it("has its own logo, world map title, save slot and tutorial list", async () => {
    const { container } = await mount({ assetBase: EP2 });
    expect(container.querySelector(".ros-menu-ep2")).toBeTruthy();
    expect(container.querySelector(".ros-menu-sub")).toBeNull();
    fireEvent.click(btn("Campaign"));
    if (container.querySelector(".ros-cutscene")) skip();
    expect(screen.getByRole("heading", { name: "The Eastern Kingdoms" })).toBeTruthy();
    const open = [...container.querySelectorAll(".ros-kmark")].find((b) => !b.disabled);
    fireEvent.click(open);
    fireEvent.click(container.querySelector(".ros-ktut"));
    act(() => battle.props.onEnd("victory"));
    expect(progressOf(true).length).toBe(1);
    expect(battle.props.assetBase).toBe(EP2);
  });
});

describe("training armies (GameScreen::startGameModeCampaign)", () => {
  const tut = (container, re) => [...container.querySelectorAll(".ros-ktut")].find((b) => re.test(b.textContent));
  it("the Deployment drill musters 2 Militiamen, 2 Footmen and a Pikeman", async () => {
    const { container } = await mount();
    fireEvent.click(btn("Campaign"));
    skip();
    openKingdom("Carrone");
    fireEvent.click(tut(container, /Deployment/));
    expect(battle.props.army).toEqual({ militiamen: 2, footmen: 2, pikemen: 1 });
    expect(battle.props.godArmy).toBe(false);
  });
  it("Episode II's Combat Training part 2 musters 2 Catapults and 3 Trebuchets, not the whole sandbox", async () => {
    const { container } = await mount({ assetBase: EP2 });
    fireEvent.click(btn("Campaign"));
    for (let i = 0; i < 3 && container.querySelector(".ros-cutscene"); i++) skip();
    openKingdom("Carrone");
    fireEvent.click(tut(container, /Part 2/));
    expect(battle.props.army).toEqual({ catapult: 2, trebuchet: 3 });
  });
});

describe("Episode II unit unlocks", () => {
  it("The Wizard's Palace's first win says the Ballistae upgrade is open", async () => {
    localStorage.setItem("ros-campaign-v1-ep2", JSON.stringify([5424, 5425]));
    const { container } = await mount({ assetBase: EP2 });
    fireEvent.click(btn("Campaign"));
    for (let i = 0; i < 3 && container.querySelector(".ros-cutscene"); i++) skip();
    openKingdom("Zayandi");
    fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")[2]);
    fireEvent.click(btn(/Start Mission/));
    for (let i = 0; i < 3 && container.querySelector(".ros-cutscene"); i++) skip();
    expect(battle.props.campaignMapId).toBe(5426);
    act(() => battle.props.onEnd("victory", [], false, []));
    for (let i = 0; i < 3 && !container.querySelector(".ros-reward"); i++) skip();
    expect(container.querySelector(".ros-reward-unlock").textContent).toMatch(
      /^Congratulations! The ability to upgrade units to Ballistae has been unlocked/,
    );
  });
});

describe("Episode II openings", () => {
  const firstLine = (container) => {
    fireEvent.click(container.querySelector(".ros-cutscene")); // finish the typing
    return container.querySelector(".ros-cut-text").textContent;
  };
  it("the campaign opens on Episode I's intro; Episode II's own plays before the first Eastern Kingdoms battle only", async () => {
    const { container } = await mount({ assetBase: EP2 });
    fireEvent.click(btn("Campaign"));
    expect(firstLine(container)).toMatch(/^Much of the known world/);
    skip();
    const zayandi = () => {
      openKingdom("Zayandi");
      return [...container.querySelectorAll(".ros-kmission:not(.ros-ktut):not(.ros-kraid)")];
    };
    fireEvent.click(zayandi()[0]);
    fireEvent.click(btn(/Start Mission/));
    expect(firstLine(container)).toMatch(/^The power and grandeur/);
    skip();
    if (container.querySelector(".ros-cutscene")) skip(); // the mission's own story, if any
    expect(battle.props.campaignMapId).toBe(5424);
    act(() => battle.props.onEnd("victory", [], false, []));
    for (let i = 0; i < 3 && container.querySelector(".ros-cutscene"); i++)
      container.querySelector(".ros-reward") ? fireEvent.click(btn(/Continue/)) : skip();
    fireEvent.click(zayandi()[1]);
    fireEvent.click(btn(/Start Mission/));
    if (container.querySelector(".ros-cutscene")) expect(firstLine(container)).not.toMatch(/^The power and grandeur/);
  });
});

describe("edge cases", () => {
  it("a blocked localStorage falls back to defaults (sound on, god army off)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mount();
    fireEvent.click(btn(/Dev/));
    expect(btn(/^⚡ God army$/)).toBeTruthy();
    expect(btn(/🔊 Effects/)).toBeTruthy();
    fireEvent.click(btn(/God army/));
    fireEvent.click(btn(/Effects/));
    fireEvent.click(btn(/Music/));
    fireEvent.click(btn(/Hard reset/));
    expect(btn(/🔊 Effects/)).toBeTruthy();
  });

  it("Upgrade Army spends a collectible to turn a unit into its upgrade", async () => {
    localStorage.setItem("ros-campaign-v1", JSON.stringify([5400]));
    const { container } = await mount();
    fireEvent.click(btn(/Dev/));
    fireEvent.click(btn(/Give resources/));
    fireEvent.click(btn("Campaign"));
    const footmen = container.querySelector('[title^="Footmen ×"]');
    const n = Number(footmen.getAttribute("title").split("×")[1]);
    expect(n).toBeGreaterThan(0);
    fireEvent.click(footmen);
    const up = [...container.querySelectorAll(".ros-up-btn")].find((b) => !b.disabled);
    fireEvent.click(up);
    expect(container.querySelector('[title^="Footmen ×"]').getAttribute("title")).toBe("Footmen ×" + (n - 1));
    fireEvent.click(up); // one tap each
    expect(container.querySelector('[title^="Footmen ×"]').getAttribute("title")).toBe("Footmen ×" + (n - 2));
    expect(plays.some((p) => p.src.endsWith("upgrade.mp3"))).toBe(true);
    // with no collectible left to spend nothing happens
    const delta = localStorage.getItem("ros-updelta-v1");
    localStorage.setItem("ros-spoils-v3", "{}");
    cleanup();
    const r2 = await mount();
    fireEvent.click(btn("Campaign"));
    fireEvent.click(r2.container.querySelector('[title^="Footmen ×"]'));
    expect([...r2.container.querySelectorAll(".ros-up-btn")].every((b) => b.disabled)).toBe(true);
    expect(localStorage.getItem("ros-updelta-v1")).toBe(delta);
  });

  it("a random-reward raid lists its pool and draws from it on a win (logged)", async () => {
    carroneWon(); // Carrone's story won: its raid is open (and no prologue plays)
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    // every reward on file becomes a draw of 1 from a two-entry pool
    const restore = patchFetch({
      "rewards.json": (r) =>
        Object.fromEntries(
          Object.keys(r).map((k) => [k, { random: true, pick: 1, pool: [{ unit: "knights" }, { spoil: "Armor" }] }]),
        ),
    });
    try {
      const { container } = await mount();
      fireEvent.click(btn("Campaign"));
      openKingdom("Carrone");
      fireEvent.click(container.querySelector(".ros-kraid"));
      expect(screen.getByText("1 of these, drawn at random on each win:")).toBeTruthy();
      expect(container.querySelectorAll(".ros-preview-spoils .ros-reward-item").length).toBe(3);
      fireEvent.click(btn(/Begin Raid/));
      act(() => battle.props.onEnd("victory", [], false));
      expect(info.mock.calls.some(([m]) => /\[ROS roll\] Reward — map \d+: drew/.test(m))).toBe(true);
      expect(container.querySelector(".ros-reward")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("a kingdom with no raids shows none; briefs close on a click outside; the battles can open Settings", async () => {
    const restore = patchFetch({
      "levels.json": (d) => ({ ...d, levels: d.levels.filter((l) => l.group !== "siege") }),
    });
    try {
      const { container } = await mount();
      fireEvent.click(btn("Campaign"));
      skip();
      openKingdom("Carrone");
      expect(container.querySelector(".ros-kraid")).toBeNull();
      fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut)")[0]);
      fireEvent.click(container.querySelector(".ros-overlay-fixed"));
      expect(container.querySelector(".ros-mission-preview")).toBeNull();
      openKingdom("Carrone");
      fireEvent.click(container.querySelectorAll(".ros-kmission:not(.ros-ktut)")[0]);
      fireEvent.click(btn(/Start Mission/));
      skip();
      act(() => battle.props.onSettings());
      expect(btn("Close")).toBeTruthy();
      fireEvent.click(btn("Close"));
    } finally {
      restore();
    }
  });

  it("raid previews close on a click outside; admin, raid and skirmish battles open Settings too", async () => {
    carroneWon(); // Carrone's story won: its raid is open (and no prologue plays)
    const { container } = await mount();
    fireEvent.click(btn("Campaign"));
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    fireEvent.click(container.querySelector(".ros-overlay-fixed"));
    expect(container.querySelector(".ros-mission-preview")).toBeNull();
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-kraid"));
    fireEvent.click(btn(/Begin Raid/));
    act(() => battle.props.onSettings());
    fireEvent.click(btn("Close"));
    act(() => battle.props.onExit());
    openKingdom("Carrone");
    fireEvent.click(container.querySelector(".ros-ktut"));
    act(() => battle.props.onSettings());
    fireEvent.click(btn("Close"));
    act(() => battle.props.onExit());
    fireEvent.click(btn(/Main Menu/));
    fireEvent.click(btn("Skirmish Battles"));
    act(() => battle.props.onSettings());
    expect(btn("Close")).toBeTruthy();
  });
});
