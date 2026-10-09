// util/options.js — the ⚙ gameplay options: the original's behaviour by default, saved in localStorage, and read by a
// battle when it starts (so a change applies from the next battle).
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { getGameOptions, setGameOption, subscribeGameOptions, OPTION_DEFAULTS } from "../util/options.js";
import { loadEpisode, makeGame } from "./battle.js";

beforeAll(() => loadEpisode(2));
afterEach(() => setGameOption({ ...OPTION_DEFAULTS }));

describe("gameplay options", () => {
  it("default to the original game", () => {
    expect(OPTION_DEFAULTS).toEqual({ realisticSiege: false });
    expect(getGameOptions().realisticSiege).toBe(false);
  });

  it("are saved to localStorage and announced to subscribers", () => {
    let calls = 0;
    const off = subscribeGameOptions(() => calls++);
    setGameOption({ realisticSiege: true });
    expect(getGameOptions().realisticSiege).toBe(true);
    expect(JSON.parse(localStorage.getItem("ros-options")).realisticSiege).toBe(true);
    expect(calls).toBe(1);
    off();
    setGameOption({ realisticSiege: false });
    expect(calls).toBe(1);
  });

  it("are read back when the game loads; an unreadable value gives the defaults", async () => {
    localStorage.setItem("ros-options", JSON.stringify({ realisticSiege: true }));
    vi.resetModules();
    expect((await import("../util/options.js")).getGameOptions().realisticSiege).toBe(true);
    localStorage.setItem("ros-options", "{broken");
    vi.resetModules();
    expect((await import("../util/options.js")).getGameOptions()).toEqual(OPTION_DEFAULTS);
    localStorage.removeItem("ros-options");
  });

  it("a battle takes Realistic siege when it starts and keeps it to the end", () => {
    setGameOption({ realisticSiege: true });
    const g = makeGame(5417);
    expect(g.realisticSiege).toBe(true);
    setGameOption({ realisticSiege: false });
    expect(g.realisticSiege).toBe(true); // unchanged mid-battle
    expect(makeGame(5417).realisticSiege).toBe(false);
  });
});
