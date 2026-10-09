// The campaign shell's screens (ui/shell/) rendered on their own: unit sprites & skill chips, the cutscene
// player, the army/upgrade panel, the Merchant, the spoils screen, the Story & Assets codex (with its mission table
// and mechanics reference), the Field Manual, the Heraldry editor and the Settings panel.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, within, waitFor } from "@testing-library/react";
import { UnitSprite, UnitChips, SvgIcon, ResIcon } from "../ui/shell/common.jsx";
import { Cutscene } from "../ui/shell/Cutscene.jsx";
import { Stat, UpgradeArmy } from "../ui/shell/UpgradeArmy.jsx";
import { MerchantShop } from "../ui/shell/MerchantShop.jsx";
import { RewardScreen } from "../ui/shell/RewardScreen.jsx";
import { parseMdChapters, MechanicsDoc } from "../ui/shell/MechanicsDoc.jsx";
import { DialogueThread, StoryCodex } from "../ui/shell/StoryCodex.jsx";
import { UpgradeTree, HelpScreen } from "../ui/shell/FieldManual.jsx";
import { Heraldry } from "../ui/shell/Heraldry.jsx";
import { SettingsPanel } from "../ui/shell/SettingsPanel.jsx";
import { base, AV, NAME_KEY } from "../data/shell-data.js";
import { UNIT_TYPES } from "../engine/engine.js";
import { setGameLang, gameLang } from "../i18n/i18n.js";
import { getVolume, setVolume } from "../util/volume.js";
import { getGameOptions, setGameOption } from "../util/options.js";
import { patchFetch } from "./shell-helpers.js";

const zip = vi.hoisted(() => ({ calls: [], result: { ok: 3, failed: [] }, impl: null }));
vi.mock("../util/zip-assets.js", () => ({
  zipAndDownload: async (b, paths, name, onProgress) => {
    zip.calls.push({ base: b, paths, name });
    if (zip.impl) return zip.impl(b, paths, name, onProgress);
    onProgress(1, paths.length, paths[0]);
    return zip.result;
  },
}));

let restoreFetch = null;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (restoreFetch) (restoreFetch(), (restoreFetch = null));
  setGameLang("en");
  setVolume({ master: 100, sfx: 100, music: 100 });
  zip.impl = null;
});

const btn = (name) => screen.getByRole("button", { name });

describe("atoms", () => {
  it("UnitSprite uses the standing-pose art for roster units and a strip frame otherwise", () => {
    const { container, rerender } = render(<UnitSprite unit="footmen" />);
    const img = container.querySelector("img.ros-unit-stand");
    expect(img.getAttribute("src")).toBe(`${base}sprites/stand/footmen.png${AV}`);
    expect(container.firstChild.className).toBe("ros-unit-frame");

    rerender(<UnitSprite unit="king" />); // the Hero too: his cropped standing pose, not the 96×96 strip
    expect(container.querySelector("img.ros-unit-stand").getAttribute("src")).toBe(
      `${base}sprites/stand/king.png${AV}`,
    );

    // no standing pose (an unknown key): the first frame of a 4-frame default strip, named after the key
    rerender(<UnitSprite unit="mystery" size={44} framed={false} />);
    const strip = container.querySelector(".ros-unit-sprite");
    expect(strip.style.backgroundImage).toContain("sprites/mystery.png");
    expect(strip.style.backgroundSize).toBe("400% 100%");
    expect(container.firstChild.className).toBe("ros-unit-bare");
    expect(container.firstChild.style.width).toBe("44px");
  });

  it("SvgIcon draws the glyphs; the sword is the original's own art", () => {
    const { container, rerender } = render(<SvgIcon name="lock" className="x" />);
    expect(container.querySelector("svg.ros-svg.x rect")).toBeTruthy();
    rerender(<SvgIcon name="sword" />);
    expect(container.querySelector("img").getAttribute("src")).toBe(base + "hud/sword.png");
    rerender(<SvgIcon name="sword" className="big" />);
    expect(container.querySelector("img").className).toContain("big");
    for (const n of ["mov", "rng", "shield", "cost", "star", "trade", "up", "book", "nothing"]) {
      rerender(<SvgIcon name={n} />);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });

  it("ResIcon shows a collectible's native icon, an emoji fallback otherwise", () => {
    const { container, rerender } = render(<ResIcon id="Medal" size={30} />);
    const img = container.querySelector("img");
    expect(img.getAttribute("src")).toBe(base + "icons/medal.png");
    expect(img.getAttribute("title")).toBe("Medal");
    rerender(<ResIcon id="Gold" title="Gold coin" />);
    expect(container.querySelector(".ros-ico-emoji").textContent).toBe("•");
    expect(container.querySelector(".ros-ico-emoji").title).toBe("Gold coin");
    rerender(<Stat label="MOV" val={4} />);
    expect(container.textContent).toBe("MOV4");
  });

  it("UnitChips: class emblem, then the range badge or Melee, then the abilities", () => {
    const { container, rerender } = render(<UnitChips unitKey="archers" base={base} />);
    const srcs = () =>
      [...container.querySelectorAll("img")].map((i) => i.getAttribute("src").replace(base + "hud/", ""));
    expect(srcs()).toEqual(["class_light.png", "range_2-6.png", "skill_moveshoot.png", "skill_firearrows.png"]);
    rerender(<UnitChips unitKey="pikemen" base={base} />);
    expect(srcs()).toEqual(["class_light.png", "skill_melee.png", "skill_formation.png", "skill_pikewall.png"]);
    rerender(<UnitChips unitKey="craftsmen" base={base} />); // ranged with no badge band: no range/melee chip
    expect(srcs()).not.toContain("skill_melee.png");
    expect(srcs()[1]).not.toMatch(/^range_/);
    rerender(<UnitChips unitKey="nobody" base={base} />);
    expect(container.innerHTML).toBe("");
  });

  it("UnitChips falls back to a word pill for an ability with no game icon", () => {
    const T = UNIT_TYPES.militiamen,
      saved = T.abilities;
    T.abilities = [4]; // Fearless has no icon art
    try {
      render(<UnitChips unitKey="militiamen" base={base} />);
      const pill = screen.getByText("Fearless");
      expect(pill.closest(".ros-skill").title).toMatch(/Immune to Fear/);
    } finally {
      T.abilities = saved;
    }
  });
});

describe("Cutscene", () => {
  const lines = [
    { text: "Hail, Varius!", face: "face005" },
    { text: "Die!", face: "face013", side: "foe" },
    { text: "So it ends.", face: "" },
  ];

  it("types each line, completes it on a click, steps through and calls onDone at the end", async () => {
    localStorage.setItem(NAME_KEY, "bob");
    const onDone = vi.fn();
    const { container } = render(<Cutscene lines={lines} title="Kingdom of Carrone" onDone={onDone} />);
    expect(screen.getByText("Kingdom of Carrone")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    await waitFor(() => expect(container.querySelector(".ros-cut-text").textContent).toBe("Hail, Bob!▌"));
    expect(container.querySelector(".ros-cut-portrait").getAttribute("src")).toBe(base + "portraits/face005.png");
    expect(container.querySelector(".ros-cut-left")).toBeTruthy();

    fireEvent.click(btn(/Next/)); // line 2: still typing → the click completes it
    fireEvent.click(container.querySelector(".ros-cutscene"));
    expect(container.querySelector(".ros-cut-text").textContent).toBe("Die!▌");
    expect(container.querySelector(".ros-cut-right")).toBeTruthy();
    fireEvent.click(btn(/Next/)); // to the last line, half-typed
    fireEvent.click(btn(/Next/)); // completes it
    expect(screen.getByText("3 / 3")).toBeTruthy();
    // narration has no bust: Ep1 keeps its soldier stand-in
    expect(container.querySelector(".ros-cut-portrait").getAttribute("src")).toBe(base + "portraits/face008.png");
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(btn(/Continue/));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Skip ends the scene at once; Ep2 narration shows no bust; a broken portrait hides", () => {
    const onDone = vi.fn();
    const { container } = render(<Cutscene lines={[lines[2], lines[0]]} title="" onDone={onDone} pbase="/ep2/" />);
    expect(container.querySelector(".ros-cut-portrait")).toBeNull();
    expect(container.querySelector(".ros-cut-name")).toBeNull();
    fireEvent.click(btn(/Skip/));
    expect(onDone).toHaveBeenCalledTimes(1);
    cleanup();
    render(<Cutscene lines={[lines[0]]} title="t" onDone={onDone} />);
    const img = document.querySelector(".ros-cut-portrait");
    fireEvent.error(img);
    expect(img.style.visibility).toBe("hidden");
  });

  it("an empty script still renders and finishes", () => {
    const onDone = vi.fn();
    render(<Cutscene lines={[]} title="x" onDone={onDone} />);
    fireEvent.click(btn(/Continue/));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("UpgradeArmy (the camp panel)", () => {
  it("selects the first owned unit and upgrades one per tap, spending a collectible each", () => {
    const onUpgrade = vi.fn();
    const onBack = vi.fn();
    const { container } = render(
      <UpgradeArmy army={{ footmen: 2 }} spoils={{ Armor: 3 }} onUpgrade={onUpgrade} onBack={onBack} />,
    );
    expect(screen.getByRole("heading", { name: "Upgrade Army" })).toBeTruthy();
    expect(container.querySelector(".ros-army-line1").textContent).toMatch(/Footmen×2/);
    expect(container.querySelector(".ros-res-crest").tagName).toBe("SPAN"); // no heraldry handler → a plain crest
    const toSwords = container.querySelector(".ros-up-btn");
    expect(toSwords.textContent).toMatch(/Swordsmen/);
    expect(toSwords.disabled).toBe(false);
    expect(toSwords.title).toBe("Upgrade 1 Footmen → 1 Swordsmen (spends 1 Armor)");
    const halberd = [...container.querySelectorAll(".ros-up-btn")].find((b) => /Halberdiers/.test(b.textContent));
    expect(halberd.disabled).toBe(true);
    expect(halberd.title).toBe("Needs 1 Weapons collectible");
    // one tap, one unit — no number to pick (the original's popup 62 asks for one; §13): two taps, two upgrades
    fireEvent.click(toSwords);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onUpgrade).toHaveBeenLastCalledWith("footmen", "swordsmen", "Armor", 1);
    expect(container.querySelector(".ros-count")).toBeNull();
    fireEvent.click(toSwords);
    expect(onUpgrade).toHaveBeenCalledTimes(2);
    expect(onUpgrade).toHaveBeenLastCalledWith("footmen", "swordsmen", "Armor", 1);
    fireEvent.click(btn(/Main Menu/));
    expect(onBack).toHaveBeenCalled();
  });

  it("on a phone (stacked layout) tapping a unit scrolls its card into view; on a wide screen it doesn't", () => {
    vi.useFakeTimers();
    const scroll = vi.fn();
    const proto = window.HTMLElement.prototype;
    const prevScroll = proto.scrollIntoView,
      prevMM = window.matchMedia;
    proto.scrollIntoView = scroll;
    try {
      let narrow = true;
      window.matchMedia = (q) => ({ matches: narrow && /max-width/.test(q) });
      render(<UpgradeArmy army={{}} spoils={{}} onUpgrade={() => {}} />);
      fireEvent.click(screen.getByTitle("Archers ×0"));
      vi.advanceTimersByTime(50);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.calls[0][0]).toMatchObject({ block: "nearest" });
      narrow = false;
      fireEvent.click(screen.getByTitle("Footmen ×0"));
      vi.advanceTimersByTime(50);
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      proto.scrollIntoView = prevScroll;
      window.matchMedia = prevMM;
      vi.useRealTimers();
    }
  });

  it("an unowned unit can't upgrade; the detail shows the source, range, elite and reference-only units", () => {
    const { container } = render(<UpgradeArmy army={{}} spoils={{}} onUpgrade={() => {}} />);
    // no units owned → the grid starts on Militiamen ("recruit at the Merchant")
    expect(screen.getByText("Recruit at the Merchant")).toBeTruthy();
    expect(container.querySelector(".ros-up-btn").title).toBe("You have no Militiamen to upgrade");
    fireEvent.click(screen.getByTitle("Archers ×0"));
    expect(container.querySelector(".ros-army-src").textContent).toMatch(/Upgrade from Militiamen — spend.*Weapons/);
    expect(container.querySelector(".ros-stats").textContent).toMatch(/RNG6/);
    // every weapon slot with its own reach, then each description (the original's View Unit screen)
    expect(container.querySelector(".ros-army-kit").textContent).toMatch(/Longbow \(rng 2–6\).*Short Sword/);
    expect(container.querySelectorAll(".ros-army-weapon").length).toBe(2);
    fireEvent.click(screen.getByTitle("Wizards ×0"));
    expect(container.querySelector(".ros-elite-img")).toBeTruthy();
    // a Wizard's record holds only its Wizard Blade — the spells are its Magic, not a weapon slot
    expect(container.querySelector(".ros-army-kit").textContent).toMatch(/Wizard Blade/);
    expect(container.querySelector(".ros-army-kit").textContent).not.toMatch(/Fireball/);
    // the reference shelf: a Druid form is reference-only, never counted
    const shelf = container.querySelectorAll(".ros-army-grid")[1];
    fireEvent.click(shelf.querySelector("button"));
    expect(screen.getByText("Reference only")).toBeTruthy();
    expect(container.querySelector(".ros-army-count")).toBeNull();
    expect(container.querySelector(".ros-army-src")).toBeNull();
  });

  it("embedded beside the map it offers the Merchant and the Heraldry crest; Ep2 adds its units", () => {
    const onMerchant = vi.fn(),
      onHeraldry = vi.fn();
    const { container } = render(
      <UpgradeArmy
        embedded
        ep2
        army={{ craftsmen: 1 }}
        spoils={{ Lore: 2 }}
        onUpgrade={() => {}}
        onMerchant={onMerchant}
        onHeraldry={onHeraldry}
        heraldTier={1}
      />,
    );
    expect(container.querySelector("aside.ros-camp-panel")).toBeTruthy();
    expect(screen.getByTitle("Craftsmen ×1")).toBeTruthy();
    expect(container.querySelector(".ros-res.has").title).toMatch(/^Lore/);
    fireEvent.click(btn(/The Merchant/));
    fireEvent.click(screen.getByTitle(/Your coat of arms/));
    expect(onMerchant).toHaveBeenCalled();
    expect(onHeraldry).toHaveBeenCalled();
    // the Ep2 conjured summons sit on the reference shelf: no cost, not "reference only"
    const shelf = container.querySelectorAll(".ros-army-grid")[1];
    const tiles = shelf.querySelectorAll("button");
    expect(tiles.length).toBe(5); // bear, great eagle, stag, sapper, bodyguard
    fireEvent.click(tiles[3]);
    expect(container.querySelector(".ros-army-line1").textContent).toMatch(/Sapper/);
    expect(container.querySelector(".ros-army-cost")).toBeNull();
  });

  it("Episode I offers none of Episode II's upgrades", () => {
    const { container } = render(<UpgradeArmy army={{ footmen: 1 }} spoils={{ Lore: 1 }} onUpgrade={() => {}} />);
    const names = [...container.querySelectorAll(".ros-up-btn .ros-up-name")].map((e) => e.textContent);
    expect(names).toEqual(["Swordsmen", "Halberdiers", "Cavalry"]);
  });

  it("Episode II: an upgrade to a new unit is locked until its story battle is won (MenuScreen::onMenuEvent)", () => {
    const onUpgrade = vi.fn();
    const titles = { 5428: "Warning Caladrin" };
    const props = {
      ep2: true,
      army: { footmen: 1 },
      spoils: { Lore: 1 },
      onUpgrade,
      missionTitle: (id) => titles[id] || "",
    };
    const { container, rerender } = render(<UpgradeArmy {...props} progress={new Set()} />);
    const toCraftsmen = () =>
      [...container.querySelectorAll(".ros-up-btn")].find((b) => /Craftsmen/.test(b.textContent));
    expect(toCraftsmen().disabled).toBe(true);
    expect(toCraftsmen().title).toBe("Win Warning Caladrin to unlock this upgrade");
    expect(toCraftsmen().querySelector(".ros-up-cost svg")).toBeTruthy(); // the lock
    fireEvent.click(toCraftsmen());
    expect(onUpgrade).not.toHaveBeenCalled();
    // the unit's own card names the battle too
    fireEvent.click(screen.getByTitle("Craftsmen ×0"));
    expect(container.querySelector(".ros-army-src").textContent).toMatch(/opens after Warning Caladrin/);
    // won: the upgrade opens
    rerender(<UpgradeArmy {...props} progress={new Set([5428])} />);
    fireEvent.click(screen.getByTitle("Footmen ×1"));
    expect(toCraftsmen().disabled).toBe(false);
    fireEvent.click(toCraftsmen());
    expect(onUpgrade).toHaveBeenCalledWith("footmen", "craftsmen", "Lore", 1);
  });

  it("no kind passes 500 (string 64)", () => {
    const { container } = render(
      <UpgradeArmy army={{ footmen: 3, swordsmen: 500 }} spoils={{ Armor: 3 }} onUpgrade={() => {}} />,
    );
    const toSwords = container.querySelector(".ros-up-btn");
    expect(toSwords.disabled).toBe(true);
    expect(toSwords.title).toBe("There is a maximum of 500 for units and collectibles.");
  });
});

describe("MerchantShop", () => {
  it("a collectible costs three of another kind, a Militiaman one Armor, Weapons and Lore — any number at once", () => {
    const onTrade = vi.fn(),
      onRecruit = vi.fn(),
      onBack = vi.fn();
    const { container } = render(
      <MerchantShop
        spoils={{ Armor: 7, Weapons: 1, Lore: 2, Medal: 3 }}
        onTrade={onTrade}
        onRecruit={onRecruit}
        onBack={onBack}
      />,
    );
    const [giveCol, getCol] = container.querySelectorAll(".ros-mch-col");
    const give = (id) => within(giveCol).getByText(id).closest("button");
    const get = (id) => within(getCol).getByText(id).closest("button");
    expect(give("Weapons").disabled).toBe(true); // fewer than 3
    expect(give("Medal").disabled).toBe(false); // a Medal pays too
    expect(within(getCol).queryByText("Medal")).toBeNull(); // but can't be bought
    const exchange = btn("Exchange");
    expect(exchange.disabled).toBe(true);
    fireEvent.click(give("Armor"));
    expect(get("Armor").disabled).toBe(true);
    fireEvent.click(get("Weapons"));
    expect(container.querySelector(".ros-mch-cost").textContent).toBe("Each costs 3 Armor");
    expect(exchange.disabled).toBe(false);
    fireEvent.click(btn("More"));
    expect(btn("More").disabled).toBe(true); // 7 Armor buys 2
    fireEvent.click(exchange);
    expect(onTrade).toHaveBeenCalledWith("Armor", "Weapons", 2);
    // a Militiaman: the price is fixed, the Give column is out of play
    fireEvent.click(get("Militiaman"));
    expect(give("Armor").disabled).toBe(true);
    expect(container.querySelector(".ros-mch-cost").textContent).toBe("Each costs 1 Armor, 1 Weapons and 1 Lore");
    fireEvent.click(exchange);
    expect(onRecruit).toHaveBeenCalledWith(1);
    fireEvent.click(btn(/Main Menu/));
    expect(onBack).toHaveBeenCalled();
  });

  it("nothing past 500 of a kind", () => {
    const { container } = render(
      <MerchantShop spoils={{ Armor: 9, Lore: 500 }} onTrade={() => {}} onRecruit={() => {}} />,
    );
    const [giveCol, getCol] = container.querySelectorAll(".ros-mch-col");
    fireEvent.click(within(giveCol).getByText("Armor").closest("button"));
    fireEvent.click(within(getCol).getByText("Lore").closest("button"));
    expect(btn("Exchange").disabled).toBe(true);
  });

  it("can't trade a collectible for itself", () => {
    const { container } = render(<MerchantShop spoils={{ Armor: 3 }} onTrade={() => {}} onRecruit={() => {}} />);
    const [giveCol, getCol] = container.querySelectorAll(".ros-mch-col");
    fireEvent.click(within(getCol).getByText("Armor").closest("button"));
    fireEvent.click(within(giveCol).getByText("Armor").closest("button"));
    expect(btn("Exchange").disabled).toBe(true);
  });
});

describe("RewardScreen", () => {
  it("lists the troops and collectibles won, skipping zero entries", () => {
    const onDone = vi.fn();
    const { container } = render(
      <RewardScreen
        reward={{
          name: "Brigands in the Vale",
          units: { knights: 1, ghost: 2, footmen: 0 },
          spoils: { Armor: 2, Lore: 0 },
        }}
        onDone={onDone}
      />,
    );
    expect(screen.getByText("Brigands in the Vale")).toBeTruthy();
    const items = [...container.querySelectorAll(".ros-reward-item")].map((e) => e.textContent.trim());
    expect(items).toEqual(["+1 Knights", "+2 ghost", "+2 Armor"]);
    fireEvent.click(container.querySelector(".ros-reward")); // a click on the card doesn't close it
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(btn(/Continue/));
    fireEvent.click(container.querySelector(".ros-cutscene"));
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("Episode II: names the unit upgrade a battle opened", () => {
    const { container } = render(<RewardScreen reward={{ unlocked: ["ballistae"] }} onDone={() => {}} />);
    expect(container.querySelector(".ros-reward-unlock").textContent).toBe(
      "Congratulations! The ability to upgrade units to Ballistae has been unlocked. Visit the Upgrade Army screen to check possible upgrades.",
    );
  });

  it("with nothing to list shows only the header", () => {
    const { container } = render(<RewardScreen reward={{}} onDone={() => {}} />);
    expect(container.querySelector(".ros-reward-sub")).toBeNull();
    expect(container.querySelector(".ros-reward-grp")).toBeNull();
  });
});

describe("the mechanics reference (Markdown)", () => {
  it("parseMdChapters splits ## chapters into headings, lists, numbered lists and paragraphs", () => {
    const md = [
      "# Title (skipped)",
      "intro before any chapter (skipped)",
      "## One",
      "### Sub",
      "- a",
      "  continued",
      "- b",
      "",
      "- c",
      "1. first",
      "  more",
      "2. second",
      "para line",
      "goes on",
      "",
      "## Two  ",
      "3. solo",
      "",
      "4. again",
    ].join("\n");
    const ch = parseMdChapters(md);
    expect(ch.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(ch[0].blocks).toEqual([
      { h: "Sub" },
      { li: ["a continued", "b", "c"] },
      { ol: ["first more", "second"] },
      { p: "para line goes on" },
    ]);
    expect(ch[1].blocks).toEqual([{ ol: ["solo", "again"] }]);
  });

  it("MechanicsDoc loads MECHANICS.md and expands a chapter with inline code and bold", async () => {
    restoreFetch = patchFetch({
      "MECHANICS.md": () => "## Combat `calc` and **bold**\n### Head\n- item `x`\n1. step\npara **b**\n",
    });
    const { container } = render(<MechanicsDoc />);
    expect(screen.getByText(/Loading the mechanics reference/)).toBeTruthy();
    const head = await screen.findByRole("button", { name: /Combat/ });
    expect(head.textContent).toMatch(/4 entries/);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    const body = container.querySelector(".ros-mech-body");
    expect(body.querySelector("h4").textContent).toBe("Head");
    expect(body.querySelector("ul code").textContent).toBe("x");
    expect(body.querySelector("ol li").textContent).toBe("step");
    expect(body.querySelector("p b").textContent).toBe("b");
    expect(head.querySelector("b code").textContent).toBe("calc");
    fireEvent.click(head);
    expect(container.querySelector(".ros-mech-body")).toBeNull();
  });

  it("MechanicsDoc renders the real Ep1 reference", async () => {
    render(<MechanicsDoc />);
    expect(await screen.findByRole("button", { name: /Sources and tools/ })).toBeTruthy();
  });

  it("MechanicsDoc renders nothing when the file can't be read", async () => {
    restoreFetch = patchFetch({ "MECHANICS.md": "fail" });
    const { container } = render(<MechanicsDoc dbase="/nowhere/" />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});

describe("Story & Assets codex", () => {
  const camp = {
    prologue: [{ text: "Long ago…", face: "face005" }],
    kingdoms: [
      {
        id: "carrone",
        name: "Kingdom of Carrone",
        emperorBrief: [{ text: "Council line" }],
        missions: [
          {
            mapId: 5400,
            title: "Brigands in the Vale",
            intro: [{ text: "Intro, Varius", face: "face001" }],
            victory: [{ text: "Won", side: "foe", face: "" }],
            defeat: [{ text: "Lost" }],
          },
        ],
      },
      { id: "merovin", name: "Kingdom of Merovin", missions: [{ mapId: 5403, title: "M1" }] },
    ],
  };
  const events = { 5400: [{ text: "Charge!", round: 3, reinforce: true }, { text: "Hold" }] };

  it("is collapsed by default and opens to the dialogue of every kingdom", () => {
    const { container } = render(<StoryCodex camp={camp} events={events} />);
    const bar = container.querySelector(".ros-codex-bar");
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".ros-codex-inner")).toBeNull();
    fireEvent.click(bar);
    expect(
      screen
        .getByText(/Map atlas/)
        .closest("a")
        .getAttribute("href"),
    ).toBe("/ros-atlas/index.html#5400");
    // the first kingdom is open: council + briefing + in-battle + victory + defeat = 6 lines
    expect(screen.getByRole("button", { name: /Carrone1 missions · 6 lines/ })).toBeTruthy();
    expect(screen.getByText("turn 3 · reinforcements")).toBeTruthy();
    expect(container.querySelectorAll(".ros-flow-line.foe").length).toBe(1);
    expect(container.querySelectorAll(".ros-flow-narr").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Prologue/ }));
    expect(screen.getByText("Long ago…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Prologue/ }));
    expect(screen.queryByText("Long ago…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Merovin1 missions · 0 lines/ }));
    expect(screen.getByText("map 5403")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Merovin/ }));
    expect(screen.queryByText("map 5403")).toBeNull();
    fireEvent.click(bar);
    expect(container.querySelector(".ros-codex-inner")).toBeNull();
  });

  it("an Ep2 codex links the Ep2 atlas; no prologue, no events", () => {
    render(<StoryCodex camp={{ kingdoms: camp.kingdoms }} events={null} pbase="/games/reign-of-swords-2/" />);
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    expect(
      screen
        .getByText(/Map atlas/)
        .closest("a")
        .getAttribute("href"),
    ).toBe("/ros-atlas/index.html#5424");
    expect(screen.queryByRole("button", { name: /Prologue/ })).toBeNull();
  });

  it("downloads everything listed in the manifest as one zip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    zip.calls.length = 0;
    zip.result = { ok: 1380, failed: ["a", "b"] };
    render(<StoryCodex camp={camp} events={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download EVERYTHING/ }));
    expect(await screen.findByText("Done — 1380 files (2 missed)")).toBeTruthy();
    expect(zip.calls[0].name).toBe("reign-of-swords-assets.zip");
    expect(zip.calls[0].paths.length).toBe(1396); // the real download-manifest.json
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("Download EVERYTHING (.zip)")).toBeTruthy();
  });

  it("falls back to the curated asset list when the manifest can't be read", async () => {
    zip.calls.length = 0;
    zip.result = { ok: 5, failed: [] };
    restoreFetch = patchFetch({ "download-manifest.json": "fail" });
    render(<StoryCodex camp={camp} events={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download EVERYTHING/ }));
    expect(await screen.findByText("Done — 5 files")).toBeTruthy();
    expect(zip.calls[0].paths).toContain("campaign.json");
  });

  it("the manifest-less run shows its progress while packing", async () => {
    let release;
    zip.calls.length = 0;
    restoreFetch = patchFetch({ "download-manifest.json": () => ({ files: [] }) });
    const gate = new Promise((r) => (release = r));
    zip.impl = async (b, paths, name, onProgress) => {
      onProgress(2, paths.length);
      await gate;
      return { ok: 2, failed: [] };
    };
    render(<StoryCodex camp={camp} events={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download EVERYTHING/ }));
    expect(screen.getByText("Reading manifest…")).toBeTruthy();
    const packing = await screen.findByText(/^Packing 2\//);
    expect(packing.closest("button").disabled).toBe(true);
    await act(async () => release());
    expect(await screen.findByText("Done — 2 files")).toBeTruthy();
  });
});

describe("Enemies & rewards table", () => {
  it("lists each mission's opening enemies, reinforcements and reward from the real Ep1 data", async () => {
    const [camp, levels, rewards] = await Promise.all(
      ["campaign.json", "levels.json", "rewards.json"].map((f) =>
        fetch("/games/reign-of-swords/" + f).then((r) => r.json()),
      ),
    );
    const { container } = render(
      <StoryCodex camp={camp} events={{}} levels={levels.levels} rewards={rewards} pbase={base} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    await waitFor(() => expect(container.querySelector(".ros-mt")).toBeTruthy());
    const rows = container.querySelectorAll(".ros-mt-row");
    expect(rows.length).toBe(24 + 22); // 24 story missions + 22 raids
    const first = rows[0];
    expect(first.textContent).toMatch(/Mission 1/);
    expect(first.textContent).toMatch(/pays the first win · map 5400/);
    expect(container.querySelectorAll(".ros-mt-row.raid")[0].textContent).toMatch(/Raid — pays every win/);
  });

  it("counts script spawns by side, or the opening army + red waves for a scriptless map", async () => {
    restoreFetch = patchFetch({
      "/t/waves.json": () => ({
        2: [
          {
            side: "red",
            units: [
              ["archers", 0, 0],
              ["footmen", 0, 0, 9],
            ],
          },
          {
            side: "blue",
            units: [
              ["knights", 0, 0],
              ["pikemen", 0, 0, 1],
            ],
          },
        ],
      }),
    });
    const camp = {
      kingdoms: [
        { id: "a", name: "Kingdom of A", missions: [{ mapId: 1, title: "Scripted" }, { mapId: 2 }, { mapId: 99 }] },
        { id: "b", name: "Kingdom of B", missions: [] },
      ],
    };
    const levels = [
      {
        mapId: 1,
        groupOrder: [
          { gi: 1, side: "enemy" },
          { gi: 2, side: "ally" },
        ],
        script: {
          initial: [0],
          actions: [
            { op: 0, key: "swordsmen", gi: 1 },
            { op: 0, key: "swordsmen", gi: 1 },
            { op: 0, key: "cavalry", gi: 2 },
            { op: 3, key: "x", gi: 1 },
          ],
        },
      },
      {
        mapId: 2,
        name: "Open field",
        groupOrder: [{ gi: 1, side: "enemy" }],
        enemy: [["militiamen"], ["militiamen"]],
      },
      { mapId: 3, group: "siege", kingdom: "A", name: "A raid" },
    ];
    const rewards = { 1: { units: { knights: 1 } }, 2: { spoils: { Armor: 2 } } };
    const { container } = render(<StoryCodex camp={camp} events={{}} levels={levels} rewards={rewards} pbase="/t/" />);
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    await waitFor(() => expect(container.querySelector(".ros-mt")).toBeTruthy());
    const rows = [...container.querySelectorAll(".ros-mt-row")];
    expect(rows.length).toBe(3); // mapId 99 has no level; kingdom B has no rows
    const cells = (r) =>
      [...r.querySelectorAll(".ros-mt-cell")].map((c) => [...c.querySelectorAll(".ros-mt-chip")].map((ch) => ch.title));
    expect(cells(rows[0])).toEqual([["1× Swordsmen"], ["1× Swordsmen"], ["1× Knights"]]);
    // scriptless: opening militia; reinforcements = the red wave's archers + the footmen of enemy group 9? (unknown
    // group → falls back to the wave's own side, red) — but blue pikemen of enemy group 1 count too
    expect(cells(rows[1])).toEqual([
      ["2× Militiamen"],
      expect.arrayContaining(["1× Archers", "1× Footmen", "1× Pikemen"]),
      ["2× Armor"],
    ]);
    expect(cells(rows[1])[1].length).toBe(3);
    expect(rows[1].querySelector(".ros-mt-name b").textContent).toBe("Open field");
    expect(cells(rows[2])).toEqual([[], [], []]);
    expect(rows[2].querySelectorAll(".ros-mt-none").length).toBe(3);
  });

  it("waits for the level list, and survives a missing waves file", async () => {
    restoreFetch = patchFetch({ "waves.json": "fail" });
    const { container } = render(<StoryCodex camp={{ kingdoms: [] }} events={{}} levels={[]} rewards={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Story & Assets/ }));
    await waitFor(() => expect(container.querySelector(".ros-mt-load")).toBeTruthy());
  });
});

describe("DialogueThread", () => {
  it("renders nothing for no lines", () => {
    const { container } = render(<DialogueThread title="x" lines={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Field Manual", () => {
  it("opens on How to Play and switches between the help tabs", async () => {
    const onBack = vi.fn();
    const { container } = render(<HelpScreen onBack={onBack} />);
    expect(screen.getByText("Opening the field manual…")).toBeTruthy();
    await screen.findByRole("heading", { name: "Field Manual" });
    const tabs = [...container.querySelectorAll(".ros-help-tab")].map((t) => t.textContent);
    expect(tabs).toEqual(["How to Play", "Abilities", "Armour", "Movement", "Upgrades", "Online (original)"]);
    expect(screen.getByText("BATTLEFIELD")).toBeTruthy();

    fireEvent.click(btn("Abilities"));
    const items = [...container.querySelectorAll(".ros-help-item")];
    const pike = items.find((i) => /Pike Wall/.test(i.querySelector(".ros-help-title")?.textContent || ""));
    expect(pike.querySelector(".ros-help-units").textContent).toMatch(/Pikemen/);
    // abilities no fielded unit carries sink to the bottom, flagged honestly
    const firstOrphan = items.findIndex((i) => i.classList.contains("ros-help-orphan"));
    expect(firstOrphan).toBeGreaterThan(0);
    expect(items.slice(firstOrphan).every((i) => i.classList.contains("ros-help-orphan"))).toBe(true);
    expect(container.querySelector(".ros-help-rec")).toBeTruthy(); // a recreation note (e.g. Barrage)

    fireEvent.click(btn("Armour"));
    expect(screen.getByText("War Engine").closest(".ros-help-item").textContent).toMatch(/Catapult/);
    expect(container.querySelectorAll(".ros-help-item").length).toBe(13);

    fireEvent.click(btn("Movement"));
    expect(screen.getByText("Standard March").closest(".ros-help-item").textContent).toMatch(/Militiamen/);

    fireEvent.click(btn("Upgrades"));
    expect(container.querySelector("svg.ros-tree-svg")).toBeTruthy();
    expect(container.querySelector(".ros-tree-card.root")).toBeTruthy();

    fireEvent.click(btn("Online (original)"));
    expect(container.querySelector(".ros-help-note")).toBeTruthy();

    fireEvent.click(btn(/Main Menu/));
    expect(onBack).toHaveBeenCalled();
  });

  it("on the Ep2 route tags the Episode II abilities; a custom back label", async () => {
    render(<HelpScreen onBack={() => {}} ep2 backLabel="Back to battle" />);
    await screen.findByRole("button", { name: "Back to battle" });
    fireEvent.click(btn("Abilities"));
    expect(screen.getByText("Life Steal").closest(".ros-help-item").textContent).toMatch(/Blood Gorgers/);
  });

  it("with no help file only our own Standard March entry and the upgrade tree remain", async () => {
    restoreFetch = patchFetch({ "help.json": "fail" });
    const { container } = render(<HelpScreen onBack={() => {}} />);
    await screen.findByRole("heading", { name: "Field Manual" });
    expect([...container.querySelectorAll(".ros-help-tab")].map((t) => t.textContent)).toEqual([
      "Movement",
      "Upgrades",
    ]);
    expect(screen.getByText("Standard March")).toBeTruthy(); // falls back to the first remaining tab
    fireEvent.click(btn("Upgrades"));
    expect(container.querySelector("svg.ros-tree-svg")).toBeTruthy();
  });

  it("help items without a title render text only", async () => {
    restoreFetch = patchFetch({ "help.json": () => ({ manual: [{ text: "Untitled tip" }] }) });
    render(<HelpScreen onBack={() => {}} />);
    const tip = await screen.findByText("Untitled tip");
    expect(tip.closest(".ros-help-item").querySelector(".ros-help-title")).toBeNull();
  });

  it("the upgrade tree shows Ep2's branches only on the Ep2 route", () => {
    const { container, rerender } = render(<UpgradeTree />);
    const names = () => [...container.querySelectorAll(".ros-tree-nm")].map((t) => t.textContent);
    expect(names()).not.toContain("Craftsmen");
    const ep1Edges = container.querySelectorAll("path").length;
    rerender(<UpgradeTree ep2 />);
    expect(names()).toEqual(expect.arrayContaining(["Craftsmen", "Ballistae", "Blood Gorgers"]));
    expect(container.querySelectorAll("path").length).toBeGreaterThan(ep1Edges);
    expect(container.querySelector(".ros-tree-special-row").textContent).toMatch(/Sapper.*Bodyguard/);
  });
});

describe("Heraldry editor", () => {
  it("edits the crest and the player's name, saving each change", () => {
    const onBack = vi.fn();
    const { container } = render(<Heraldry progress={new Set([1, 2, 3])} onBack={onBack} />);
    expect(container.querySelector(".ros-herald-title").textContent).toBe("Knight");
    expect(screen.getByText(/Rank Knight \(3 won\)/)).toBeTruthy();
    const nameInput = screen.getByRole("textbox");
    expect(nameInput.value).toBe("Varius");
    fireEvent.change(nameInput, { target: { value: "A very long knightly name indeed" } });
    expect(localStorage.getItem(NAME_KEY)).toBe("A very long knightly");
    const saved = () => JSON.parse(localStorage.getItem("ros-heraldry-v1"));
    const [bgSw, symSw] = container.querySelectorAll(".ros-herald-swatches");
    fireEvent.click(bgSw.querySelectorAll(".ros-swatch")[2]);
    const bg = saved().bgColor;
    expect(bgSw.querySelectorAll(".ros-swatch")[2].className).toContain(" on");
    fireEvent.click(container.querySelectorAll(".ros-bgtype")[4]);
    expect(saved()).toMatchObject({ bgColor: bg, bgType: 4 });
    fireEvent.click(symSw.querySelectorAll(".ros-swatch")[0]);
    expect(saved().symbolColor).toBe("gules");
    fireEvent.click(screen.getByTitle("Symbol 12"));
    expect(saved().symbol).toBe(12);
    fireEvent.click(btn(/Main Menu/));
    expect(onBack).toHaveBeenCalled();
  });

  it("sizes its symbol grid to the viewport and keeps working when storage is blocked", () => {
    vi.useFakeTimers();
    const { container, unmount } = render(<Heraldry progress={null} onBack={() => {}} />);
    expect(container.querySelector(".ros-herald-title").textContent).toBe("Squire");
    const grid = container.querySelector(".ros-herald-devices");
    expect(grid.style.maxHeight).toBe(window.innerHeight - 20 + "px");
    window.innerHeight = 50;
    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(400);
    });
    expect(grid.style.maxHeight).toBe("96px");
    window.innerHeight = 768;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Zed" } });
    fireEvent.click(screen.getByTitle("Symbol 9"));
    expect(screen.getByRole("textbox").value).toBe("Zed");
    expect(screen.getByTitle("Symbol 9").className).toContain(" on");
    unmount();
    act(() => vi.advanceTimersByTime(400)); // the pending re-fit timers were cleared with the screen
  });
});

describe("Settings panel", () => {
  it("switches the game language, toggles sound and sets the volume levels", () => {
    const onClose = vi.fn(),
      onToggleMusic = vi.fn(),
      onToggleSfx = vi.fn();
    const { container, rerender } = render(
      <SettingsPanel
        onClose={onClose}
        musicMuted={false}
        sfxMuted
        onToggleMusic={onToggleMusic}
        onToggleSfx={onToggleSfx}
      />,
    );
    expect(btn(/English/).getAttribute("aria-pressed")).toBe("true");
    expect(btn(/English/).title).toBe("Original — recommended");
    fireEvent.click(btn("Русский"));
    expect(gameLang()).toBe("ru");
    expect(screen.getByRole("heading", { name: "⚙ Настройки" })).toBeTruthy();
    fireEvent.click(btn("Українська"));
    expect(gameLang()).toBe("uk");
    fireEvent.click(btn(/English/));
    expect(gameLang()).toBe("en");

    expect(btn(/Music on/).getAttribute("aria-pressed")).toBe("true");
    expect(btn(/Effects off/).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn(/Music on/));
    fireEvent.click(btn(/Effects off/));
    expect(onToggleMusic).toHaveBeenCalled();
    expect(onToggleSfx).toHaveBeenCalled();
    rerender(
      <SettingsPanel
        onClose={onClose}
        musicMuted
        sfxMuted={false}
        onToggleMusic={onToggleMusic}
        onToggleSfx={onToggleSfx}
      />,
    );
    expect(btn(/Music off/)).toBeTruthy();
    expect(btn(/Effects on/)).toBeTruthy();

    fireEvent.change(container.querySelector("#ros-vol-music"), { target: { value: "40" } });
    fireEvent.change(container.querySelector("#ros-vol-master"), { target: { value: "75" } });
    expect(getVolume()).toMatchObject({ master: 75, music: 40, sfx: 100 });
    expect(screen.getByText("40%")).toBeTruthy();

    fireEvent.click(container.querySelector(".ros-settings-card"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(btn("Close"));
    fireEvent.click(container.querySelector(".ros-overlay"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Army transfer: exports this episode's army to a file and imports the other episode's, saying what came", async () => {
    const onExport = vi.fn(() => ({ kind: "reign-of-swords-army", episode: 1, army: { footmen: 2 }, spoils: {} }));
    const onImport = vi.fn(() => ({ units: { footmen: 2 }, spoils: { Lore: 1 }, converted: false, capped: true }));
    const url = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = render(
      <SettingsPanel
        onClose={() => {}}
        musicMuted={false}
        sfxMuted={false}
        transfer={{ ep2: false, onExport, onImport }}
      />,
    );
    fireEvent.click(btn(/Export army/));
    expect(onExport).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/import it in Episode II/);
    const input = container.querySelector("#ros-army-import");
    const pick = async (text) => {
      const file = new File([text], "army.json", { type: "application/json" });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        await new Promise((r) => setTimeout(r, 20));
      });
      return screen.getByRole("status");
    };
    expect((await pick('{"kind":"reign-of-swords-army","episode":2,"army":{}}')).textContent).toMatch(
      /Brought in 2 units and 1 collectibles\. The rest stayed behind/,
    );
    expect(onImport).toHaveBeenCalledWith({ kind: "reign-of-swords-army", episode: 2, army: {} });
    expect((await pick("not json")).className).toContain("bad");
    onImport.mockImplementation(() => {
      throw new Error("This is not a Reign of Swords army file.");
    });
    expect((await pick("{}")).textContent).toBe("This is not a Reign of Swords army file.");
    click.mockRestore();
  });

  it("Report a bug: where (GitHub Issues, LinkedIn) and what to attach — in the menu and in a battle", () => {
    render(<SettingsPanel onClose={() => {}} musicMuted={false} sfxMuted={false} />);
    expect(screen.getByText("Report a bug")).toBeTruthy();
    const gh = screen.getByRole("link", { name: "GitHub Issues" });
    expect(gh.getAttribute("href")).toBe("https://github.com/Tsarar/reign-of-swords-remastered/issues");
    expect(gh.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "LinkedIn" }).getAttribute("href")).toBe("https://bit.ly/dmytro-linkedin");
    expect(screen.getByText(/the 🐞 snapshot/)).toBeTruthy();
    expect(screen.getByText(/faithfulness to the original game/)).toBeTruthy();
  });

  it("no Army transfer inside a battle (no transfer handlers)", () => {
    render(<SettingsPanel onClose={() => {}} musicMuted={false} sfxMuted={false} />);
    expect(screen.queryByText("Army transfer")).toBeNull();
  });

  it("toggles ⚙ Realistic siege (off by default — the original), saved for the next battle", () => {
    setGameOption({ realisticSiege: false });
    render(<SettingsPanel onClose={() => {}} musicMuted={false} sfxMuted={false} />);
    const off = btn(/Realistic siege: off/);
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(/Off — the original/)).toBeTruthy();
    fireEvent.click(off);
    expect(getGameOptions().realisticSiege).toBe(true);
    expect(btn(/Realistic siege: on/).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn(/Realistic siege: on/));
    expect(getGameOptions().realisticSiege).toBe(false);
  });
});
