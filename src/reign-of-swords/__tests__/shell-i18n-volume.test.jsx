// The game's own language setting (i18n/i18n.js) and sound levels (util/volume.js): both are module-level stores
// persisted to localStorage that React screens subscribe to. Restored to English / full volume after each test.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { tr, gameLang, setGameLang, useGameLang, GAME_LANGS } from "../i18n/i18n.js";
import { getVolume, setVolume, subscribeVolume, useVolume, masterLevel, sfxLevel, musicLevel } from "../util/volume.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import RU from "../i18n/ru.js";
import UK from "../i18n/uk.js";
import RU_STORY from "../i18n/ru-story.js";
import UK_STORY from "../i18n/uk-story.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setGameLang("en");
  setVolume({ master: 100, sfx: 100, music: 100 });
});

describe("game language", () => {
  it("offers English, Russian and Ukrainian, English by default", () => {
    expect(GAME_LANGS.map((l) => l.code)).toEqual(["en", "ru", "uk"]);
    expect(gameLang()).toBe("en");
    expect(tr("Campaign")).toBe("Campaign");
  });

  it("switching translates interface strings and the story, and persists the choice", () => {
    setGameLang("ru");
    expect(gameLang()).toBe("ru");
    expect(localStorage.getItem("ros-lang")).toBe("ru");
    expect(tr("Campaign")).toBe("Кампания");
    expect(tr("Skirmish Battles")).toBe("Сражения");
    expect(tr("A formation of cavalry has appeared in the northeast Varius!")).toMatch(/кавалерии/);
    setGameLang("uk");
    expect(tr("Skirmish Battles")).toBe("Бої");
  });

  it("every literal tr() / notify() string in the game has a Russian and a Ukrainian translation", () => {
    const root = join(process.cwd(), "src/reign-of-swords");
    const files = [];
    (function walk(dir) {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (!/__tests__|i18n|docs/.test(f)) walk(p);
        } else if (/\.(js|jsx)$/.test(f)) files.push(p);
      }
    })(root);
    const keys = new Set();
    for (const f of files)
      for (const m of readFileSync(f, "utf8").matchAll(/\b(?:tr|notify)\(\s*("(?:[^"\\]|\\.)*")/g))
        keys.add(JSON.parse(m[1]));
    expect(keys.size).toBeGreaterThan(300);
    for (const [lang, dicts] of [
      ["ru", [RU, RU_STORY]],
      ["uk", [UK, UK_STORY]],
    ])
      for (const k of keys)
        expect(
          dicts.some((d) => k in d),
          `${lang}: ${k}`,
        ).toBe(true);
  });

  it("an untranslated string comes back in English, with {placeholders} filled", () => {
    setGameLang("ru");
    expect(tr("zz no such string")).toBe("zz no such string");
    expect(tr("{n} of {m}", { n: 2 })).toBe("2 of {m}"); // a missing var keeps its placeholder
    expect(tr(null)).toBeNull();
    expect(tr(42)).toBe(42);
  });

  it("ignores an unknown code or a no-op switch (no write, no re-render)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    setGameLang("de");
    setGameLang("en");
    expect(spy).not.toHaveBeenCalled();
    expect(gameLang()).toBe("en");
  });

  it("a blocked storage still switches for the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setGameLang("uk");
    expect(gameLang()).toBe("uk");
  });

  it("useGameLang re-renders a component on a switch", () => {
    function Label() {
      useGameLang();
      return <span>{tr("Campaign")}</span>;
    }
    const { unmount } = render(<Label />);
    expect(screen.getByText("Campaign")).toBeTruthy();
    act(() => setGameLang("ru"));
    expect(screen.getByText("Кампания")).toBeTruthy();
    unmount();
  });

  it("the saved language is restored on load; a bad or unreadable value falls back to English", async () => {
    vi.resetModules();
    localStorage.setItem("ros-lang", "uk");
    expect((await import("../i18n/i18n.js")).gameLang()).toBe("uk");
    vi.resetModules();
    localStorage.setItem("ros-lang", "xx");
    expect((await import("../i18n/i18n.js")).gameLang()).toBe("en");
    vi.resetModules();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect((await import("../i18n/i18n.js")).gameLang()).toBe("en");
  });
});

describe("sound levels", () => {
  it("default to 100% and multiply master × effects", () => {
    expect(getVolume()).toEqual({ master: 100, sfx: 100, music: 100 });
    setVolume({ master: 50, sfx: 40 });
    expect(masterLevel()).toBe(0.5);
    expect(sfxLevel()).toBeCloseTo(0.2);
    expect(musicLevel()).toBe(1);
    expect(JSON.parse(localStorage.getItem("ros-volume"))).toEqual({ master: 50, sfx: 40, music: 100 });
  });

  it("subscribers hear every change until they unsubscribe", () => {
    const f = vi.fn();
    const off = subscribeVolume(f);
    setVolume({ music: 30 });
    off();
    setVolume({ music: 20 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("useVolume re-renders on a change; a blocked storage keeps the level for the session", () => {
    function V() {
      return <span>{useVolume().music}%</span>;
    }
    render(<V />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => setVolume({ music: 35 }));
    expect(screen.getByText("35%")).toBeTruthy();
  });

  it("saved levels load merged over the defaults; garbage loads the defaults", async () => {
    vi.resetModules();
    localStorage.setItem("ros-volume", JSON.stringify({ sfx: 10 }));
    expect((await import("../util/volume.js")).getVolume()).toEqual({ master: 100, sfx: 10, music: 100 });
    vi.resetModules();
    localStorage.setItem("ros-volume", "{bad");
    expect((await import("../util/volume.js")).getVolume()).toEqual({ master: 100, sfx: 100, music: 100 });
    vi.resetModules();
    localStorage.setItem("ros-volume", "5");
    expect((await import("../util/volume.js")).getVolume().master).toBe(100);
  });
});
