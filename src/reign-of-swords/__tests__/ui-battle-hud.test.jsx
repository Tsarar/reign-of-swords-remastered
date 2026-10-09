// The battle screen's HUD (ui/ReignOfSwords.jsx): engine-setting sync (fast-forward, mutes, input lock), the top HUD
// (counts, phase, turn, objectives, the raid Medal track), the floating hint and the toasts (notices, reinforcement
// waves, the whose-turn banner). The engine is mocked: a test pushes a state snapshot and checks the screen.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mountReign } from "../engine/engine.js";
import ReignOfSwords from "../ui/ReignOfSwords.jsx";
import { mountBattle, makeCtrl, mission } from "./ui-helpers.js";

vi.mock("../engine/engine.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, mountReign: vi.fn() };
});

const BASE = "/games/reign-of-swords/";
const mount = (props, o) => mountBattle(mountReign, ReignOfSwords, props, o);
const btn = (name) => screen.getByRole("button", { name });

beforeEach(() => {
  mountReign.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("engine settings kept in sync", () => {
  it("fast-forward starts off, steps fast → super fast → off on clicks, persists and reaches the engine", async () => {
    const { ctrl } = await mount();
    await waitFor(() => expect(ctrl.setFastForward).toHaveBeenLastCalledWith(0));
    fireEvent.click(btn(/⏩ Fast$/));
    await waitFor(() => expect(ctrl.setFastForward).toHaveBeenLastCalledWith(1));
    expect(localStorage.getItem("ros-fastenemy")).toBe("1");
    expect(btn(/Fast: on/).className).toContain(" on");
    fireEvent.click(btn(/Fast: on/));
    await waitFor(() => expect(ctrl.setFastForward).toHaveBeenLastCalledWith(2));
    expect(localStorage.getItem("ros-fastenemy")).toBe("2");
    const superBtn = btn(/⏩⏩ Fast$/); // the hidden "Fast: on" copy that holds its width is not in its name
    expect(superBtn.className).toContain(" super");
    expect(superBtn.querySelector(".ros-fast-ghost").textContent).toBe("⏩ Fast: on");
    fireEvent.click(superBtn);
    await waitFor(() => expect(ctrl.setFastForward).toHaveBeenLastCalledWith(0));
    expect(localStorage.getItem("ros-fastenemy")).toBe("0");
  });

  it("a blocked localStorage: hints and fast-forward start off, and toggling them doesn't throw", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const { ctrl } = await mount();
      await waitFor(() => expect(ctrl.setFastForward).toHaveBeenLastCalledWith(0));
      fireEvent.click(btn(/⏩ Fast$/));
      await waitFor(() => expect(ctrl.setFastForward).toHaveBeenLastCalledWith(1));
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("fast-forward remembered from an earlier battle", async () => {
    localStorage.setItem("ros-fastenemy", "1");
    const { ctrl } = await mount();
    expect(ctrl.setFastForward).toHaveBeenLastCalledWith(1);
    expect(btn(/Fast: on/)).toBeTruthy();
    cleanup();
    localStorage.setItem("ros-fastenemy", "2");
    const again = await mount();
    expect(again.ctrl.setFastForward).toHaveBeenLastCalledWith(2);
    expect(btn(/⏩⏩ Fast$/)).toBeTruthy();
  });

  it("the shell's Music / Effects mutes reach the engine; ⏭ in the top bar skips to the next song", async () => {
    const { ctrl, rerender } = await mount();
    rerender(<ReignOfSwords sfxMuted musicMuted />);
    expect(ctrl.setSfxMuted).toHaveBeenLastCalledWith(true);
    expect(ctrl.setMusicMuted).toHaveBeenLastCalledWith(true);
    expect(ctrl.nextTrack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next song" }));
    expect(ctrl.nextTrack).toHaveBeenCalledTimes(1);
  });

  it("⏭ is harmless with an engine without a playlist", async () => {
    const ctrl = makeCtrl();
    delete ctrl.nextTrack;
    await mount({}, { ctrl });
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Next song" }))).not.toThrow();
  });

  it("the field is locked while a popover is up and unlocked once the briefing is dismissed", async () => {
    const { ctrl, push } = await mount();
    // (each effect lands after React commits — wait for it rather than racing a loaded machine)
    await waitFor(() => expect(ctrl.setInputLocked).toHaveBeenLastCalledWith(true)); // the briefing is up
    push({ mission: mission() });
    fireEvent.click(btn(/March/));
    expect(ctrl.openBattle).toHaveBeenCalled();
    await waitFor(() => expect(ctrl.setInputLocked).toHaveBeenLastCalledWith(false));
    fireEvent.click(btn(/Objectives/));
    await waitFor(() => expect(ctrl.setInputLocked).toHaveBeenLastCalledWith(true));
  });
});

describe("HUD", () => {
  it("shows the counts, the phase, the turn (clamped to the limit) and held objectives", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ blue: 12, red: 9, turn: 30, turnLimit: 25, objectives: { total: 3, held: 1, morale: false } });
    expect(container.querySelector(".ros-blue .ros-count").textContent).toBe("12");
    expect(container.querySelector(".ros-red .ros-count").textContent).toBe("9");
    expect(container.querySelector(".ros-turn").textContent).toBe("Turn 25 / 25");
    expect(container.querySelector(".ros-obj").textContent).toBe("⚑ 1/3");
    push({ objectives: { total: 3, held: 3, morale: true } });
    expect(container.querySelector(".ros-obj").textContent).toBe("⚑ 3/3 ▲ morale");
    push({ objectives: null });
    expect(container.querySelector(".ros-obj")).toBeNull();
  });

  it("an escape mission shows escaped and lost counts, red once the last allowed loss is taken", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ escape: { start: 12, escaped: 3, lost: 2, maxLost: 5, goal: true } });
    const el = container.querySelector(".ros-escape");
    expect(el.textContent).toBe("Escaped 3 · Lost 2 / 5");
    expect(el.className).not.toContain("warn");
    push({ escape: { start: 12, escaped: 3, lost: 5, maxLost: 5, goal: true } });
    expect(container.querySelector(".ros-escape").className).toContain("ros-escape-warn");
    push({ escape: { start: 10, escaped: 0, lost: 1, maxLost: 5, goal: false } }); // no goal area: losses only
    expect(container.querySelector(".ros-escape").textContent).toBe("Lost 1 / 5");
    push({ escape: null });
    expect(container.querySelector(".ros-escape")).toBeNull();
  });

  it.each([
    ["deploy", "Deployment"],
    ["player", "Your turn"],
    ["ally", "Allied turn"],
    ["enemy", "Enemy turn"],
    ["victory", "Victory"],
    ["defeat", "Defeat"],
  ])("phase %s reads %s", async (phase, label) => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ phase });
    const el = container.querySelector(".ros-phase");
    expect(el.textContent).toBe(label);
    expect(el.className).toContain(phase);
  });

  it("the live hint floats over the map until dismissed, and stays dismissed", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ hint: "Select a unit to move it." });
    expect(container.querySelector(".ros-hint-map .ros-hint-text").textContent).toBe("Select a unit to move it.");
    fireEvent.click(btn("Hide tips"));
    expect(container.querySelector(".ros-hint-map")).toBeNull();
    expect(localStorage.getItem("ros-hints-off")).toBe("1");
    cleanup();
    const again = await mount({ campaignMapId: 200 });
    again.push({ hint: "Select a unit to move it." });
    expect(again.container.querySelector(".ros-hint-map")).toBeNull();
  });

  it("the hint is hidden while a popover is open", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ hint: "Tip", unmoved: 2, canEnd: true });
    expect(container.querySelector(".ros-hint-map")).toBeTruthy();
    fireEvent.click(btn(/End Turn/));
    expect(container.querySelector(".ros-hint-map")).toBeNull();
  });

  describe("Medal track (raids with medals)", () => {
    it("no deploy budget: 'Wipe them out'", async () => {
      const { push, container } = await mount({ campaignMapId: 200, medals: true });
      push({ medal: { pct: null } });
      const t = container.querySelector(".ros-medal-track");
      expect(t.className).toContain("ok");
      expect(t.textContent).toBe("Wipe them out");
      expect(t.title).toContain("no deploy budget");
    });

    it("a budget: the strength bar, % and the holding bonus in the tooltip", async () => {
      const { push, container } = await mount({ campaignMapId: 200, medals: true });
      push({ medal: { pct: 120, ok: true, strength: 1200, budget: 1000, need: 400, hold: true } });
      let t = container.querySelector(".ros-medal-track");
      expect(t.className).toBe("ros-medal-track ok");
      expect(t.textContent).toBe("120%");
      expect(t.querySelector(".ros-mdl-bar i").style.width).toBe("100%"); // capped
      expect(t.title).toContain("Strength 1200 / 1000 (need 400).");
      expect(t.title).toContain("Holding the objective: +25% strength.");
      push({ medal: { pct: 25, ok: false, strength: 250, budget: 1000, need: 400, hold: false } });
      t = container.querySelector(".ros-medal-track");
      expect(t.className).toBe("ros-medal-track low");
      expect(t.querySelector(".ros-mdl-bar i").style.width).toBe("25%");
      expect(t.title).not.toContain("Holding");
    });

    it("hidden once the battle is over, and absent without the medals prop", async () => {
      const { push, container } = await mount({ campaignMapId: 200, medals: true });
      push({ phase: "victory", medal: { pct: null } });
      expect(container.querySelector(".ros-medal-track")).toBeNull();
      cleanup();
      const m2 = await mount({ campaignMapId: 200 });
      m2.push({ medal: { pct: 50, ok: true } });
      expect(m2.container.querySelector(".ros-medal-track")).toBeNull();
    });
  });
});

describe("toasts", () => {
  it("a notice explains an invalid action (unit name translated into the text) and fades after 3.2 s", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    vi.useFakeTimers();
    push({ notice: { id: 1, text: "{u} has already acted.", vars: { u: "Knights" } } });
    expect(container.querySelector(".ros-notice-toast").textContent).toBe("Knights has already acted.");
    act(() => vi.advanceTimersByTime(3100));
    expect(container.querySelector(".ros-notice-toast")).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".ros-notice-toast")).toBeNull();
  });

  it("a notice without vars, and with vars but no unit", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ notice: { id: 1, text: "Out of range." } });
    expect(container.querySelector(".ros-notice-toast").textContent).toBe("Out of range.");
    push({ notice: { id: 2, text: "Needs {n} more.", vars: { n: 3 } } });
    expect(container.querySelector(".ros-notice-toast").textContent).toBe("Needs 3 more.");
  });

  it("reinforcement waves: yours and the enemy's", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    vi.useFakeTimers();
    push({ wave: { id: 1, side: "blue", count: 4 } });
    let t = container.querySelector(".ros-wave-toast");
    expect(t.className).toContain("blue");
    expect(t.textContent).toBe("⚔ Reinforcements! 4 of your units have marched in.");
    push({ wave: { id: 2, side: "red", count: 6 } });
    t = container.querySelector(".ros-wave-toast");
    expect(t.className).toContain("red");
    expect(t.textContent).toBe("⚑ A column has ridden in — 6 enemy reinforcements!");
    act(() => vi.advanceTimersByTime(3300));
    expect(container.querySelector(".ros-wave-toast")).toBeNull();
  });

  describe("turn banner", () => {
    it("your turn: your own heraldry, turn number and turns left; gone after 1.7 s", async () => {
      const { push, container } = await mount({ campaignMapId: 200 });
      vi.useFakeTimers();
      push({ turnBanner: { id: 1, side: "player", turn: 3, turnLimit: 20, turnsLeft: 17 } });
      const b = container.querySelector(".ros-turn-banner");
      expect(b.className).toContain("you");
      expect(b.querySelector("svg.ros-shield")).toBeTruthy();
      expect(b.querySelector(".ros-turn-label").textContent).toBe("Your Turn");
      expect(b.querySelector(".ros-turn-sub").textContent).toBe("Your turn · Turn 3 — Turns Left: 17");
      act(() => vi.advanceTimersByTime(1800));
      expect(container.querySelector(".ros-turn-banner")).toBeNull();
    });

    it("an allied army with its scenario coat of arms, tinted in its colour", async () => {
      const { push, container } = await mount({ campaignMapId: 200 });
      push({
        turnBanner: {
          id: 1,
          side: "ally",
          name: "Rebel Army",
          color: "40,80,200",
          turn: 2,
          crestH: { bgColor: "azure", bgType: 0, symbol: 66, symbolColor: "or", frame: 1 },
        },
      });
      const b = container.querySelector(".ros-turn-banner");
      expect(b.className).toContain("ally");
      expect(b.style.borderColor).toBe("rgb(40, 80, 200)");
      expect(b.querySelector("svg.ros-shield")).toBeTruthy();
      expect(b.querySelector(".ros-turn-label").textContent).toBe("Rebel Army");
      expect(b.querySelector(".ros-turn-sub").textContent).toBe("Allied turn · Turn 2");
    });

    it("a named faction with a known crest (Aguilleon) gets it even with a generic banner", async () => {
      const { push, container } = await mount({ campaignMapId: 200 });
      push({ turnBanner: { id: 1, side: "enemy", name: "Aguilleon Gate Guard", turn: 4 } });
      const b = container.querySelector(".ros-turn-banner");
      expect(b.className).toContain("foe");
      expect(b.querySelector("svg.ros-shield")).toBeTruthy();
      expect(b.querySelector(".ros-turn-sub").textContent).toBe("Enemy turn · Turn 4");
    });

    it("a crest image on the team colour, and the plain fallbacks", async () => {
      const { push, container } = await mount({ campaignMapId: 200 });
      push({ turnBanner: { id: 1, side: "enemy", crest: "wolf", turn: 1 } });
      let b = container.querySelector(".ros-turn-banner");
      expect(b.querySelector(".ros-tcs-sym").getAttribute("src")).toBe(BASE + "crests/wolf.png");
      expect(b.querySelector(".ros-tcs-field").style.background).toBe("rgb(120, 124, 134)");
      expect(b.querySelector(".ros-turn-label").textContent).toBe("Enemy Turn");
      push({ turnBanner: { id: 2, side: "enemy", crest: "wolf", color: "200,10,10", turn: 1 } });
      expect(container.querySelector(".ros-tcs-field").style.background).toBe("rgb(200, 10, 10)");
      push({ turnBanner: { id: 3, side: "enemy", turn: 1 } });
      b = container.querySelector(".ros-turn-banner");
      expect(b.querySelector(".ros-turn-crest").textContent).toBe("⚑");
      push({ turnBanner: { id: 4, side: "ally", turn: 1 } });
      b = container.querySelector(".ros-turn-banner");
      expect(b.querySelector(".ros-turn-crest").textContent).toBe("🛡");
      expect(b.querySelector(".ros-turn-label").textContent).toBe("Allied Army");
      expect(b.style.borderColor).toBe(""); // no colour → stock style
    });
  });
});
