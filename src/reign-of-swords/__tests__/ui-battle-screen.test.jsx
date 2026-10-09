// The battle screen (ui/ReignOfSwords.jsx) against a fake engine controller: mounting / unmounting, the header (mission
// select, menu, settings, debug), the HUD, toasts, briefing / objectives / help / debug / end-turn / skip overlays,
// the victory & defeat cards (medals), the dialogue overlay and the control row. The engine itself is mocked —
// these tests pin what the player SEES for a given engine state and which controller action each button calls.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mountReign } from "../engine/engine.js";
import ReignOfSwords from "../ui/ReignOfSwords.jsx";
import { mountBattle, makeCtrl, mission, MISSIONS } from "./ui-helpers.js";

vi.mock("../engine/engine.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, mountReign: vi.fn() };
});

const BASE = "/games/reign-of-swords/";
const mount = (props, o) => mountBattle(mountReign, ReignOfSwords, props, o);
const btn = (name) => screen.getByRole("button", { name });
const qBtn = (name) => screen.queryByRole("button", { name });

beforeEach(() => {
  mountReign.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("mounting the engine", () => {
  it("shows the muster text until the engine is up, and passes the battle options to mountReign", async () => {
    let resolve;
    const ctrl = makeCtrl();
    mountReign.mockImplementation(() => new Promise((r) => (resolve = r)));
    const army = [["militiamen", 1, 1]];
    const { container } = render(<ReignOfSwords sfxMuted musicMuted={false} army={army} godArmy />);
    expect(container.querySelector(".ros-loading").textContent).toBe("Gathering the armies…");
    const [host, opts] = mountReign.mock.calls[0];
    expect(host.classList.contains("ros-stage")).toBe(true);
    expect(opts).toMatchObject({
      base: BASE,
      spriteBase: BASE,
      sfxMuted: true,
      musicMuted: false,
      army,
      godArmy: true,
    });
    await act(async () => resolve(ctrl));
    expect(container.querySelector(".ros-loading")).toBeNull();
  });

  it("Episode II (assetBase) reads its data from its own dir but sprites from Episode I's", async () => {
    await mount({ assetBase: "/games/reign-of-swords-2/" });
    const opts = mountReign.mock.calls[0][1];
    expect(opts.base).toBe("/games/reign-of-swords-2/");
    expect(opts.spriteBase).toBe(BASE);
  });

  it("a failed load shows the error", async () => {
    mountReign.mockRejectedValue(new Error("levels.json 404"));
    const { container } = render(<ReignOfSwords />);
    await waitFor(() => expect(container.textContent).toContain("Couldn't load the battle: levels.json 404"));
    expect(container.textContent).not.toContain("Gathering the armies");
  });

  it("a failure without a message still shows something", async () => {
    mountReign.mockRejectedValue("bad");
    const { container } = render(<ReignOfSwords />);
    await waitFor(() => expect(container.textContent).toContain("Couldn't load the battle: bad"));
  });

  it("leaving before the engine is up destroys it as soon as it arrives (and shows no error)", async () => {
    let resolve;
    const ctrl = makeCtrl();
    mountReign.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { unmount } = render(<ReignOfSwords />);
    unmount();
    await act(async () => resolve(ctrl));
    expect(ctrl.destroy).toHaveBeenCalledTimes(1);
    expect(ctrl.selectMission).not.toHaveBeenCalled();
  });

  it("a load that fails after leaving is ignored", async () => {
    let reject;
    mountReign.mockImplementation(() => new Promise((_, r) => (reject = r)));
    const { unmount } = render(<ReignOfSwords />);
    unmount();
    await act(async () => reject(new Error("late")));
    expect(document.body.textContent).not.toContain("late");
  });

  it("unmounting destroys the engine", async () => {
    const { ctrl, unmount } = await mount();
    unmount();
    expect(ctrl.destroy).toHaveBeenCalledTimes(1);
  });

  it("re-fits the canvas when the stage box resizes", async () => {
    const observers = [];
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb;
        this.disconnect = vi.fn();
        observers.push(this);
      }
      observe(el) {
        this.el = el;
      }
    };
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (f) => (f(), 7);
    try {
      const { ctrl, unmount } = await mount();
      const stage = observers.find((o) => o.el && o.el.classList.contains("ros-stage")); // (the button row has one too)
      expect(stage).toBeTruthy();
      stage.cb();
      expect(ctrl.game.resize).toHaveBeenCalledTimes(1);
      unmount();
      expect(stage.disconnect).toHaveBeenCalled();
    } finally {
      delete globalThis.ResizeObserver;
      globalThis.requestAnimationFrame = raf;
    }
  });

  it("a resize before the engine is up does nothing", async () => {
    let cb;
    globalThis.ResizeObserver = class {
      constructor(f) {
        cb = f;
      }
      observe() {}
      disconnect() {}
    };
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (f) => (f(), 1);
    try {
      mountReign.mockImplementation(() => new Promise(() => {}));
      render(<ReignOfSwords />);
      expect(() => cb()).not.toThrow();
    } finally {
      delete globalThis.ResizeObserver;
      globalThis.requestAnimationFrame = raf;
    }
  });
});

describe("skirmish header", () => {
  it("opens on the first Battlefield map and lists the battles by group", async () => {
    const { ctrl, container } = await mount();
    expect(ctrl.selectMission).toHaveBeenCalledWith(1);
    expect(ctrl.openBattle).not.toHaveBeenCalled();
    expect(container.querySelector(".ros-kingdom").textContent).toBe("Skirmish");
    const groups = [...container.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Campaign", "Battlefields", "Tutorials"]); // no Raids: no siege missions
    const opts = [...container.querySelectorAll(".ros-mission-select option")].map((o) => o.textContent);
    expect(opts).toEqual(["The Opening · 20×15", "Green Field · 30×22", "Drill Yard · 12×10"]);
  });

  it("an unknown mission group is listed under its own name only if it is one of the four", async () => {
    const { container } = await mount({}, { missions: [{ index: 0, name: "X", group: "siege", cols: 1, rows: 1 }] });
    expect([...container.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Raids"]);
  });

  it("without a Battlefield map it stays on whatever the engine picked", async () => {
    const { ctrl } = await mount({}, { missions: [MISSIONS[0]] });
    expect(ctrl.selectMission).not.toHaveBeenCalled();
  });

  it("an engine with no mission list mounts an empty select", async () => {
    const ctrl = makeCtrl();
    delete ctrl.missions;
    const { container } = await mount({}, { ctrl });
    expect(container.querySelectorAll(".ros-mission-select option").length).toBe(0);
  });

  it("choosing a battle selects it in the engine and brings up its briefing", async () => {
    const { ctrl, push, container } = await mount();
    push({ mission: mission() });
    fireEvent.click(btn(/March/));
    expect(container.querySelector(".ros-briefing")).toBeNull();
    fireEvent.change(screen.getByLabelText("Choose battle"), { target: { value: "2" } });
    expect(ctrl.selectMission).toHaveBeenLastCalledWith(2);
    expect(container.querySelector(".ros-briefing")).toBeTruthy();
  });

  it("the select shows the current mission (or the first when none)", async () => {
    const { push } = await mount();
    expect(screen.getByLabelText("Choose battle").value).toBe("0");
    push({ mission: mission({ index: 2 }) });
    expect(screen.getByLabelText("Choose battle").value).toBe("2");
  });

  it("Menu / Settings buttons appear only when the shell passes handlers", async () => {
    await mount();
    expect(qBtn(/Menu/)).toBeNull();
    expect(qBtn("Settings")).toBeNull();
    cleanup();
    const onExit = vi.fn(),
      onSettings = vi.fn();
    await mount({ onExit, onSettings });
    fireEvent.click(btn(/^Menu$/));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(btn("Settings"));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

describe("campaign header", () => {
  it("selects the campaign map, skips the briefing and opens the battle at once", async () => {
    const { ctrl, container, push } = await mount({ campaignMapId: 300 });
    expect(ctrl.selectMission).toHaveBeenCalledWith(2);
    expect(ctrl.openBattle).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ros-mission-select")).toBeNull();
    expect(container.querySelector(".ros-kingdom").textContent).toBe("");
    push({ mission: mission({ kingdom: "Carrone" }) });
    expect(container.querySelector(".ros-kingdom").textContent).toBe("Carrone");
    expect(container.querySelector(".ros-briefing")).toBeNull(); // the shell's cutscene replaces the briefing
    expect(container.querySelector(".ros-frame-name").textContent).toBe("Green Field");
  });

  it("an unknown campaign map still opens the battle", async () => {
    const { ctrl } = await mount({ campaignMapId: 999 });
    expect(ctrl.selectMission).not.toHaveBeenCalled();
    expect(ctrl.openBattle).toHaveBeenCalledTimes(1);
  });

  it("a campaign engine with no mission list still opens the battle", async () => {
    const ctrl = makeCtrl();
    delete ctrl.missions;
    await mount({ campaignMapId: 100 }, { ctrl });
    expect(ctrl.openBattle).toHaveBeenCalledTimes(1);
  });

  it("always shows Menu (a no-op without onExit) and Settings when given", async () => {
    await mount({ campaignMapId: 100 });
    expect(() => fireEvent.click(btn(/^Menu$/))).not.toThrow();
    expect(qBtn("Settings")).toBeNull();
    cleanup();
    const onExit = vi.fn(),
      onSettings = vi.fn();
    await mount({ campaignMapId: 100, onExit, onSettings });
    fireEvent.click(btn(/^Menu$/));
    fireEvent.click(btn("Settings"));
    expect(onExit).toHaveBeenCalled();
    expect(onSettings).toHaveBeenCalled();
  });
});
