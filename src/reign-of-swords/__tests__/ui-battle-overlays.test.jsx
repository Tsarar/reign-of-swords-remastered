// The battle screen's popovers (ui/ReignOfSwords.jsx): the briefing, objectives, Field Manual, debug snapshot, end-turn
// and skip confirmations, the victory / defeat cards (Major Victory medals, defeat reasons, campaign Continue / Retry,
// skirmish Next Battle / Retry) and the mid-battle dialogue overlay. The engine is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mountReign } from "../engine/engine.js";
import ReignOfSwords from "../ui/ReignOfSwords.jsx";
import { mountBattle, mission } from "./ui-helpers.js";

vi.mock("../engine/engine.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, mountReign: vi.fn() };
});

const BASE = "/games/reign-of-swords/";
const mount = (props, o) => mountBattle(mountReign, ReignOfSwords, props, o);
const btn = (name) => screen.getByRole("button", { name });
const qBtn = (name) => screen.queryByRole("button", { name });
const card = (c) => c.querySelector(".ros-overlay-card");

beforeEach(() => {
  mountReign.mockReset();
});
afterEach(() => {
  cleanup();
  delete navigator.clipboard;
});

describe("briefing (skirmish)", () => {
  it("shows the mission's kingdom, name, subtitle, story and objective; March opens the battle", async () => {
    const { push, ctrl, container } = await mount();
    push({ mission: mission() });
    const b = container.querySelector(".ros-briefing");
    expect(b.querySelector(".ros-brief-kingdom").textContent).toBe("Bordavia");
    expect(b.querySelector("h2").textContent).toBe("Green Field");
    expect(b.querySelector(".ros-brief-sub").textContent).toBe("A test of arms");
    expect(b.querySelector(".ros-brief-text").textContent).toBe("The enemy waits beyond the river.");
    expect(b.querySelector(".ros-brief-obj").textContent).toBe("Objective. Destroy the enemy army.");
    fireEvent.click(btn(/March/));
    expect(ctrl.openBattle).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ros-briefing")).toBeNull();
  });

  it("no subtitle line when the mission has none", async () => {
    const { push, container } = await mount();
    push({ mission: mission({ subtitle: "" }) });
    expect(container.querySelector(".ros-brief-sub")).toBeNull();
  });
});

describe("objectives popover", () => {
  it("shows the mission, turn, points held, morale and the two armies; closes three ways", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      mission: mission(),
      turn: 4,
      turnLimit: 20,
      blue: 10,
      red: 7,
      objectives: { total: 2, held: 1, morale: false },
    });
    fireEvent.click(btn(/Objectives/));
    const o = container.querySelector(".ros-objectives");
    expect(o.querySelector("h2").textContent).toBe("Green Field");
    expect(o.querySelector(".ros-brief-kingdom").textContent).toBe("Bordavia");
    expect(o.querySelector(".ros-brief-obj").textContent).toBe("Objective. Destroy the enemy army.");
    const stats = [...o.querySelectorAll(".ros-obj-stats > span")].map((x) => x.textContent);
    expect(stats).toEqual(["Turn 4 / 20", "Points held 1 / 2", "Morale — contested", "Your legion 10 · Enemy 7"]);
    fireEvent.click(o); // a click on the card itself keeps it open
    expect(container.querySelector(".ros-objectives")).toBeTruthy();
    fireEvent.click(btn(/Return to Battle/));
    expect(container.querySelector(".ros-objectives")).toBeNull();
    push({ mission: mission(), objectives: { total: 2, held: 2, morale: true } });
    fireEvent.click(btn(/Objectives/));
    const morale = [...container.querySelectorAll(".ros-obj-stats > span")].find((x) =>
      x.textContent.startsWith("Morale"),
    );
    expect(morale.textContent).toBe("Morale ✓ yours");
    expect(morale.className).toBe("ros-obj-good");
    fireEvent.click(container.querySelector(".ros-overlay"));
    expect(container.querySelector(".ros-objectives")).toBeNull();
  });

  it("without a mission it is just 'Objectives' and no held-points lines", async () => {
    const { container } = await mount({ campaignMapId: 200 });
    fireEvent.click(btn(/Objectives/));
    const o = container.querySelector(".ros-objectives");
    expect(o.querySelector("h2").textContent).toBe("Objectives");
    expect(o.querySelector(".ros-brief-kingdom").textContent).toBe("");
    expect(o.querySelector(".ros-obj-stats").textContent).not.toContain("Points held");
  });

  it("raid medal standing: with a budget (and the hold bonus) and without one", async () => {
    const { push, container } = await mount({ campaignMapId: 200, medals: true });
    push({ mission: mission(), medal: { pct: 55, ok: true, hold: true } });
    fireEvent.click(btn(/Objectives/));
    let md = container.querySelector(".ros-obj-medal");
    expect(md.className).toContain("ros-obj-good");
    expect(md.textContent).toContain("Major Victory 55% / 40%");
    expect(md.textContent).toContain("at least 40% of your deploy budget");
    expect(md.textContent).toContain("Holding the objective: +25% strength.");
    push({ mission: mission(), medal: { pct: 10, ok: false, hold: false } });
    md = container.querySelector(".ros-obj-medal");
    expect(md.className).toBe("ros-obj-medal");
    expect(md.textContent).not.toContain("Holding");
    push({ mission: mission(), medal: { pct: null, ok: true } });
    md = container.querySelector(".ros-obj-medal");
    expect(md.textContent).toContain("Major Victory ✓");
    expect(md.textContent).toContain("no deploy budget");
  });
});

describe("Field Manual", () => {
  it("opens the original help (help.json) over the battle and goes back", async () => {
    const { container } = await mount({ campaignMapId: 200 });
    fireEvent.click(btn(/Manual/));
    expect(container.querySelector(".ros-help-modal")).toBeTruthy();
    const back = await waitFor(() => btn(/Back to battle/));
    fireEvent.click(back);
    expect(container.querySelector(".ros-help-modal")).toBeNull();
  });

  it("closes on a backdrop click but not on a click inside", async () => {
    const { container } = await mount({ campaignMapId: 200, assetBase: "/games/reign-of-swords-2/" });
    fireEvent.click(btn(/Manual/));
    fireEvent.click(container.querySelector(".ros-help-modal"));
    expect(container.querySelector(".ros-help-modal")).toBeTruthy();
    fireEvent.click(container.querySelector(".ros-help-modal").parentElement);
    expect(container.querySelector(".ros-help-modal")).toBeNull();
  });
});

describe("debug snapshot (🐞)", () => {
  it("shows the engine's JSON dump; without clipboard access it asks you to copy it by hand", async () => {
    const { ctrl, container } = await mount({ campaignMapId: 200 });
    fireEvent.click(btn("Debug"));
    expect(ctrl.debugDump).toHaveBeenCalled();
    const d = container.querySelector(".ros-dbg-card");
    expect(d.querySelector("textarea").value).toBe('{"turn":3,"units":7}');
    expect(d.textContent).toContain("Copy this text and paste it");
    fireEvent.focus(d.querySelector("textarea"));
    fireEvent.click(btn("Copy")); // no clipboard → silently nothing
    expect(d.textContent).toContain("Copy this text");
    fireEvent.click(d); // inside: stays
    expect(container.querySelector(".ros-dbg-card")).toBeTruthy();
    fireEvent.click(btn("Close"));
    expect(container.querySelector(".ros-dbg-card")).toBeNull();
  });

  it("copies to the clipboard and says so; Copy again; backdrop closes", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = await mount();
    fireEvent.click(btn("Debug"));
    await waitFor(() =>
      expect(container.querySelector(".ros-dbg-card").textContent).toContain("Copied to the clipboard"),
    );
    expect(writeText).toHaveBeenCalledWith('{"turn":3,"units":7}');
    await act(async () => fireEvent.click(btn("Copy")));
    expect(writeText).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector(".ros-dbg-card").parentElement);
    expect(container.querySelector(".ros-dbg-card")).toBeNull();
  });

  it("a refused clipboard keeps the copy-by-hand text", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    const { container } = await mount();
    await act(async () => fireEvent.click(btn("Debug")));
    expect(container.querySelector(".ros-dbg-card").textContent).toContain("Copy this text");
  });

  it("does nothing before the engine is up, or with an engine without debugDump", async () => {
    mountReign.mockImplementation(() => new Promise(() => {}));
    const { render } = await import("@testing-library/react");
    const r = render(<ReignOfSwords />);
    fireEvent.click(btn("Debug"));
    expect(r.container.querySelector(".ros-dbg-card")).toBeNull();
  });
});

describe("ending the turn", () => {
  it("End Turn is disabled until the engine allows it", async () => {
    const { push } = await mount({ campaignMapId: 200 });
    expect(btn(/End Turn/).disabled).toBe(true);
    push({ canEnd: true, unmoved: 0 });
    expect(btn(/End Turn/).disabled).toBe(false);
  });

  it("with every unit spent it ends at once", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ canEnd: true, unmoved: 0 });
    fireEvent.click(btn(/End Turn/));
    expect(ctrl.endTurn).toHaveBeenCalledTimes(1);
    expect(card(container)).toBeNull();
  });

  it("with units still to act it asks first: End Turn / Keep Playing / backdrop", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ canEnd: true, unmoved: 3 });
    fireEvent.click(btn(/End Turn/));
    expect(card(container).querySelector("h2").textContent).toBe("End Turn?");
    expect(card(container).textContent).toContain("Units that have not yet moved or attacked: 3.");
    fireEvent.click(card(container)); // inside: stays
    fireEvent.click(btn("Keep Playing"));
    expect(card(container)).toBeNull();
    expect(ctrl.endTurn).not.toHaveBeenCalled();
    fireEvent.click(btn(/End Turn/));
    fireEvent.click(container.querySelector(".ros-overlay"));
    expect(card(container)).toBeNull();
    fireEvent.click(btn(/End Turn/));
    fireEvent.click(card(container).querySelector(".btn-primary"));
    expect(ctrl.endTurn).toHaveBeenCalledTimes(1);
    expect(card(container)).toBeNull();
  });
});

describe("skip confirmation (a unit that could still strike)", () => {
  it("Back cancels, the backdrop cancels, End without attacking confirms", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ confirmSkip: { name: "Archers" } });
    expect(card(container).querySelector("h2").textContent).toBe("Archers can still attack");
    expect(card(container).textContent).toContain("There's an enemy in range.");
    fireEvent.click(btn(/◂ Back/));
    expect(ctrl.cancelSkip).toHaveBeenCalledTimes(1);
    fireEvent.click(card(container)); // inside: nothing
    expect(ctrl.cancelSkip).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".ros-overlay"));
    expect(ctrl.cancelSkip).toHaveBeenCalledTimes(2);
    fireEvent.click(btn("End without attacking"));
    expect(ctrl.confirmSkip).toHaveBeenCalledTimes(1);
  });

  it("a healer with a wounded ally in reach is asked about the heal", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ confirmSkip: { name: "Priests", heal: true } });
    expect(card(container).querySelector("h2").textContent).toBe("Priests can still heal");
    expect(card(container).textContent).toContain("A wounded ally is in reach.");
    fireEvent.click(btn("End without healing"));
    expect(ctrl.confirmSkip).toHaveBeenCalledTimes(1);
  });
});

describe("victory card", () => {
  it("skirmish: the field is won; Next Battle selects the next map; Retry resets to the briefing", async () => {
    const { push, ctrl, container } = await mount();
    push({ mission: mission() });
    fireEvent.click(btn(/March/));
    push({ phase: "victory", mission: mission({ index: 1 }), turn: 8, turnLimit: 20 });
    const c = container.querySelector(".ros-overlay.victory");
    expect(c.querySelector("h2").textContent).toBe("⚔️ Victory!");
    expect(c.querySelector("p").textContent).toBe(
      "The field is yours — Green Field is won. Your Hero stands triumphant.",
    );
    expect(ctrl.setInputLocked).toHaveBeenLastCalledWith(true);
    fireEvent.click(btn(/Next Battle/));
    expect(ctrl.selectMission).toHaveBeenLastCalledWith(2);
    fireEvent.click(btn(/Retry/));
    expect(ctrl.reset).toHaveBeenCalledTimes(1);
    push({ mission: mission() });
    expect(container.querySelector(".ros-briefing")).toBeTruthy();
  });

  it("skirmish: no Next Battle after the last map; a turn-limit win says so", async () => {
    const { push, container } = await mount();
    push({ phase: "victory", mission: mission({ index: 2 }), turn: 21, turnLimit: 20 });
    expect(qBtn(/Next Battle/)).toBeNull();
    expect(container.querySelector(".ros-overlay.victory p").textContent).toBe(
      "The turn limit is reached — your army holds the stronger position, so Green Field is yours.",
    );
  });

  it("a turn-limit win on a story map is an ordinary win; with no mission it is 'the battle'", async () => {
    const { push, container } = await mount();
    push({ phase: "victory", mission: mission({ group: "story" }), turn: 21, turnLimit: 20 });
    expect(container.querySelector(".ros-overlay.victory p").textContent).toContain("Green Field is won");
    push({ phase: "victory", mission: null });
    expect(container.querySelector(".ros-overlay.victory p").textContent).toContain("the battle is won");
    expect(qBtn(/Next Battle/)).toBeNull();
  });

  it("campaign raid Major Victory: the Medal, and Continue reports the result to the shell", async () => {
    const onEnd = vi.fn();
    const { push, ctrl, container } = await mount({ campaignMapId: 200, medals: true, onEnd });
    push({ phase: "victory", major: true, red: 0, mission: mission(), medal: { pct: 62, ok: true } });
    const c = container.querySelector(".ros-overlay.victory");
    expect(c.querySelector("h2").textContent).toBe("⚔️ Major Victory!");
    expect(c.querySelector(".ros-medal-won").textContent).toContain("+1 Medal");
    expect(c.querySelector(".ros-medal-won").textContent).toContain("worth 62% of your deploy budget");
    expect(qBtn(/Retry/)).toBeNull(); // no retry after a win
    fireEvent.click(btn(/Continue/));
    expect(onEnd).toHaveBeenCalledWith("victory", { lost: { militiamen: 2 } }, true, ["line-a"]);
    expect(ctrl.casualtyReport).toHaveBeenCalled();
  });

  it("Major Victory with no deploy budget", async () => {
    const { push, container } = await mount({ campaignMapId: 200, medals: true });
    push({ phase: "victory", major: true, mission: mission(), medal: { pct: null } });
    expect(container.querySelector(".ros-medal-won").textContent).toContain(
      "With no deploy budget, every such win counts.",
    );
  });

  it("no Medal: why — the enemy survived, or your strength fell short", async () => {
    const onEnd = vi.fn();
    const { push, container } = await mount({ campaignMapId: 200, medals: true, onEnd });
    // a skirmish won on strength at the turn limit: the enemy is still standing
    push({ phase: "victory", major: false, red: 2, turn: 25, turnLimit: 24, mission: mission(), medal: { pct: 70 } });
    expect(container.querySelector("h2").textContent).toBe("⚔️ Victory!");
    let miss = container.querySelector(".ros-medal-miss");
    expect(miss.textContent).toContain("No Medal this time");
    expect(miss.textContent).toContain("The enemy army was not destroyed.");
    push({ phase: "victory", major: false, red: 0, mission: mission(), medal: { pct: 30 } });
    miss = container.querySelector(".ros-medal-miss");
    expect(miss.textContent).toContain("Yours: 30%.");
    push({ phase: "victory", major: false, red: 0, mission: mission(), medal: { pct: null } });
    miss = container.querySelector(".ros-medal-miss");
    expect(miss.textContent).not.toContain("Yours");
    expect(miss.textContent).not.toContain("not destroyed");
    fireEvent.click(btn(/Continue/));
    expect(onEnd).toHaveBeenCalledWith("victory", { lost: { militiamen: 2 } }, false, ["line-a"]);
  });

  it("an escape raid won by getting away: no 'field is yours', and no Medal to miss", async () => {
    const { push, container } = await mount({ campaignMapId: 200, medals: true });
    push({
      phase: "victory",
      major: false,
      red: 9,
      mission: mission({ name: "Run the Gauntlet" }),
      medal: { pct: 55 },
      escape: { escaped: 4, lost: 2, maxLost: 6, goal: false },
    });
    const card = container.querySelector(".ros-overlay-card");
    expect(card.textContent).toContain("You broke through — Run the Gauntlet is won.");
    expect(card.textContent).not.toContain("The field is yours");
    const miss = container.querySelector(".ros-medal-miss");
    expect(miss.textContent).toContain("Getting away wins the raid but no Medal");
    expect(miss.textContent).not.toContain("No Medal this time");
    // the same map won by wiping the enemy out is an ordinary field win
    push({
      phase: "victory",
      major: false,
      red: 0,
      mission: mission({ name: "Run the Gauntlet" }),
      medal: { pct: 30 },
      escape: { escaped: 4 },
    });
    expect(container.querySelector(".ros-overlay-card").textContent).toContain("The field is yours");
    expect(container.querySelector(".ros-medal-miss").textContent).toContain("Yours: 30%.");
  });

  it("a win with your army gone and the enemy still there (The Squire's Siege): the battle is over, no Medal", async () => {
    const { push, container } = await mount({ campaignMapId: 200, medals: true });
    push({
      phase: "victory",
      major: false,
      red: 6,
      blue: 0,
      mission: mission({ name: "The Squire's Siege" }),
      medal: { pct: 0 },
      escape: null,
    });
    const card = container.querySelector(".ros-overlay-card");
    expect(card.textContent).toContain("The battle is over — The Squire's Siege is won.");
    expect(card.textContent).not.toContain("Your Hero stands triumphant");
    expect(container.querySelector(".ros-medal-miss").textContent).toContain("This win brings no Medal");
  });

  it("without the medals prop a 'major' win is plain Victory and pays no medal", async () => {
    const onEnd = vi.fn();
    const { push, container } = await mount({ campaignMapId: 200, onEnd });
    push({ phase: "victory", major: true, mission: mission(), medal: { pct: 90 } });
    expect(container.querySelector("h2").textContent).toBe("⚔️ Victory!");
    expect(container.querySelector(".ros-medal-won")).toBeNull();
    fireEvent.click(btn(/Continue/));
    expect(onEnd.mock.calls[0][2]).toBe(false);
  });

  it("Continue without an onEnd handler is harmless", async () => {
    const { push } = await mount({ campaignMapId: 200 });
    push({ phase: "victory", mission: mission() });
    expect(() => fireEvent.click(btn(/Continue/))).not.toThrow();
  });
});

describe("defeat card", () => {
  it.each([
    ["wiped", "Your whole army has fallen. Regroup and try again."],
    ["script", "Your commanders have called the retreat. Regroup and try again."],
    [
      "escort",
      "Too many of the units you were escorting have fallen — too few are left to reach safety. Regroup and try again.",
    ],
    ["turns", "The turn limit passed before you could prevail. Regroup and try again."],
    ["mystery", "The battle is lost. Regroup and try again."],
  ])("reason %s", async (defeatReason, text) => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ phase: "defeat", defeatReason, mission: mission() });
    const c = container.querySelector(".ros-overlay.defeat");
    expect(c.querySelector("h2").textContent).toBe("🩸 Defeat");
    expect(c.querySelector("p").textContent).toBe(text);
  });

  it("no reason: past the turn limit it is the turn limit, otherwise a plain loss", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ phase: "defeat", turn: 25, turnLimit: 24 });
    expect(container.querySelector(".ros-overlay.defeat p").textContent).toContain("The turn limit passed");
    push({ phase: "defeat", turn: 3, turnLimit: 24 });
    expect(container.querySelector(".ros-overlay.defeat p").textContent).toBe(
      "The battle is lost. Regroup and try again.",
    );
  });

  it("campaign: Retry restarts and reopens the battle; Continue reports the defeat", async () => {
    const onEnd = vi.fn();
    const { push, ctrl } = await mount({ campaignMapId: 200, onEnd, medals: true });
    push({ phase: "defeat", defeatReason: "hero", mission: mission(), medal: { pct: 80 } });
    expect(document.querySelector(".ros-medal-miss")).toBeNull(); // medals only on a win
    ctrl.openBattle.mockClear();
    fireEvent.click(btn(/Retry/));
    expect(ctrl.reset).toHaveBeenCalledTimes(1);
    expect(ctrl.openBattle).toHaveBeenCalledTimes(1);
    fireEvent.click(btn(/Continue/));
    expect(onEnd).toHaveBeenCalledWith("defeat", { lost: { militiamen: 2 } }, false, ["line-a"]);
  });

  it("skirmish: Retry only (no Next Battle)", async () => {
    const { push, ctrl } = await mount();
    push({ phase: "defeat", mission: mission({ index: 0 }) });
    expect(qBtn(/Next Battle/)).toBeNull();
    fireEvent.click(btn(/Retry/));
    expect(ctrl.reset).toHaveBeenCalled();
  });
});

describe("mid-battle dialogue", () => {
  const lines = [
    { speaker: "Sir Varius", text: "Hold the line, Varius!", face: "face003", side: "you" },
    { speaker: "Warlord", text: "You will fall.", side: "foe" },
  ];

  it("steps line by line (Next pans the camera), then Continue closes it and tells the engine", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ battleEvent: { id: 1, lines } });
    let cut = container.querySelector(".ros-event-cut");
    expect(cut.querySelector(".ros-cut-stage").className).toContain("ros-cut-left");
    expect(cut.querySelector(".ros-cut-name").textContent).toBe("Sir Varius");
    expect(cut.querySelector(".ros-cut-text").textContent).toBe("Hold the line, Varius!");
    expect(cut.querySelector(".ros-cut-portrait").getAttribute("src")).toBe(BASE + "portraits/face003.png");
    expect(cut.querySelector(".ros-cut-count").textContent).toBe("1 / 2");
    expect(ctrl.setInputLocked).toHaveBeenLastCalledWith(true);
    fireEvent.click(btn(/Next ▸/));
    expect(ctrl.focusEventLine).toHaveBeenCalledWith(1);
    cut = container.querySelector(".ros-event-cut");
    expect(cut.querySelector(".ros-cut-stage").className).toContain("ros-cut-right");
    expect(cut.querySelector(".ros-cut-name").className).toBe("ros-cut-name foe");
    expect(cut.querySelector(".ros-cut-portrait").getAttribute("src")).toBe(BASE + "portraits/face008.png"); // stand-in
    expect(cut.querySelector(".ros-cut-count").textContent).toBe("2 / 2");
    fireEvent.click(btn(/Continue ▸/));
    expect(ctrl.eventClosed).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ros-event-cut")).toBeNull();
    expect(ctrl.setInputLocked).toHaveBeenLastCalledWith(false);
  });

  it("a tap anywhere on the overlay advances too", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ battleEvent: { id: 1, lines } });
    fireEvent.click(container.querySelector(".ros-event-cut"));
    expect(container.querySelector(".ros-cut-count").textContent).toBe("2 / 2");
    fireEvent.click(container.querySelector(".ros-event-cut"));
    expect(ctrl.eventClosed).toHaveBeenCalledTimes(1);
  });

  it("the player's chosen name replaces Varius in the lines", async () => {
    localStorage.setItem("ros-name-v1", "aldric");
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ battleEvent: { id: 1, lines } });
    expect(container.querySelector(".ros-cut-text").textContent).toBe("Hold the line, Aldric!");
  });

  it("a missing portrait hides itself", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ battleEvent: { id: 1, lines } });
    const img = container.querySelector(".ros-cut-portrait");
    fireEvent.error(img);
    expect(img.style.visibility).toBe("hidden");
  });

  it("Episode II: a line without a bust shows no portrait (no face008 stand-in there)", async () => {
    const { push, container } = await mount({ campaignMapId: 200, assetBase: "/games/reign-of-swords-2/" });
    push({ battleEvent: { id: 1, lines } });
    expect(container.querySelector(".ros-cut-portrait").getAttribute("src")).toBe(
      "/games/reign-of-swords-2/portraits/face003.png",
    );
    fireEvent.click(btn(/Next ▸/));
    expect(container.querySelector(".ros-cut-portrait")).toBeNull();
  });

  it("an event with no lines can still be closed", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ battleEvent: { id: 1 } });
    expect(container.querySelector(".ros-cut-count").textContent).toBe("1 / 0");
    fireEvent.click(btn(/Continue ▸/));
    expect(ctrl.eventClosed).toHaveBeenCalled();
  });

  it("waits behind the briefing (skirmish) and a new event restarts at line 1", async () => {
    const { push, container } = await mount();
    push({ mission: mission(), battleEvent: { id: 1, lines } });
    expect(container.querySelector(".ros-event-cut")).toBeNull();
    fireEvent.click(btn(/March/));
    expect(container.querySelector(".ros-event-cut")).toBeTruthy();
    fireEvent.click(btn(/Next ▸/));
    push({ mission: mission(), battleEvent: { id: 2, lines } });
    expect(container.querySelector(".ros-cut-count").textContent).toBe("1 / 2");
  });

  it("an engine without the dialogue hooks still steps and closes", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    delete ctrl.focusEventLine;
    delete ctrl.eventClosed;
    push({ battleEvent: { id: 1, lines } });
    fireEvent.click(btn(/Next ▸/));
    fireEvent.click(btn(/Continue ▸/));
    expect(container.querySelector(".ros-event-cut")).toBeNull();
  });
});
