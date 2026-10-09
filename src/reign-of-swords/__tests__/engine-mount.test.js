// The engine's outer layer (engine/engine.js): mountReign (levels + shared assets + audio + the controller the React screen
// drives), the asset loader and its session cache, preloadReign's menu-time warm-up, the hidden-tab timer, the
// player's heraldry ramps, destroy and rosterSummary. Images load through a stub (jsdom decodes none) and the audio
// manager is a recorder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const audioInst = [];
vi.mock("../engine/audio.js", async (importOriginal) => {
  const real = await importOriginal();
  class FakeAudio {
    constructor(base) {
      this.base = base;
      this.ctx = { state: "running" };
      for (const m of [
        "setSfxMuted",
        "setMusicMuted",
        "startAmbient",
        "stopAmbient",
        "_ensure",
        "setMuted",
        "nextTrack",
        "dispose",
        "play",
        "setFast",
        "setVolume",
      ])
        this[m] = vi.fn();
      this.preload = vi.fn(() => Promise.resolve());
      audioInst.push(this);
    }
  }
  return { ...real, AudioManager: FakeAudio, preloadSounds: vi.fn() };
});

const { mountReign, preloadReign, rosterSummary, Game } = await import("../engine/engine.js");
const { preloadSounds } = await import("../engine/audio.js");

const EP1 = "/games/reign-of-swords/";
const loaded = [];
class FakeImage {
  constructor() {
    this.width = 64;
    this.height = 64;
  }
  set src(v) {
    this._src = v;
    loaded.push(v);
    // stand poses and one effect are "missing" on this server; everything else loads
    queueMicrotask(() =>
      /stand\/|fx\/arrow_fire|ballista_bolt|hammer_/.test(v)
        ? this.onerror && this.onerror()
        : this.onload && this.onload(),
    );
  }
  get src() {
    return this._src;
  }
}
let origImage;
beforeEach(() => {
  origImage = globalThis.Image;
  globalThis.Image = FakeImage;
  audioInst.length = 0;
});
afterEach(() => {
  globalThis.Image = origImage;
  vi.useRealTimers();
});

function host() {
  const div = document.createElement("div");
  div.appendChild(document.createElement("canvas"));
  document.body.appendChild(div);
  return div;
}

describe("mountReign", () => {
  it("builds the battle with the loaded art, starts the music once its clips are in, and hands back the controller", async () => {
    const onState = vi.fn();
    const c = await mountReign(host(), { base: EP1, onState, muted: true });
    expect(c.game).toBeInstanceOf(Game);
    expect(c.missions.length).toBeGreaterThan(70);
    const a = audioInst[0];
    expect(a.setSfxMuted).toHaveBeenCalledWith(true); // the legacy "both" mute
    expect(a.setMusicMuted).toHaveBeenCalledWith(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(a.startAmbient).toHaveBeenCalled();
    const assets = c.game.assets;
    expect(assets.sheets.footmen.blue).toBeInstanceOf(FakeImage);
    expect(assets.stands.footmen).toBeNull(); // a pose that failed to load is simply absent
    expect(assets.arrows.normal).toBeInstanceOf(FakeImage);
    expect(assets.arrows.fire).toBeNull();
    expect(assets.proj.bolt).toBeNull(); // the Ep2 projectile strips missing here
    expect(assets.proj.hammerA).toBeNull();
    expect(assets.proj.stone).toBeInstanceOf(FakeImage);
    expect(onState).toHaveBeenCalled();
    c.destroy();
    expect(a.dispose).toHaveBeenCalled();
  });

  it("every controller call reaches the game / audio", async () => {
    const c = await mountReign(host(), { base: EP1, onState: () => {}, sfxMuted: false, musicMuted: true });
    const g = c.game;
    const a = audioInst[0];
    expect(a.setSfxMuted).toHaveBeenCalledWith(false);
    expect(a.setMusicMuted).toHaveBeenCalledWith(true);
    const calls = {
      endTurn: [],
      undoMove: [],
      holdUnit: [],
      selectNextUnit: ["nextUnit"],
      beginMarch: [],
      cancelOrder: [],
      toggleAim: [],
      cancelAim: [],
      aimSkill: ["aimSkill", "grapeshot"],
      setRetribPreview: ["setRetribPreview", true],
      shapeshiftSelected: ["shapeshift", "bear"],
      setSpell: ["setSpell", "ice"],
      invokeRetribution: [],
      invokeShield: [],
      confirmSkip: [],
      cancelSkip: [],
      casualtyReport: [],
      debugDump: [],
      reset: [],
      setPlacing: ["setPlacing", "footmen"],
      startBattle: [],
      openBattle: [],
      eventClosed: [],
      shownLines: [],
      focusEventLine: ["focusEventLine", 0],
      setFastForward: ["setFastForward", true],
      setInputLocked: ["setInputLocked", false],
      selectMission: ["selectMission", 1],
    };
    for (const [gm, spec] of Object.entries(calls)) {
      const name = spec[0] || gm;
      const spy = vi.spyOn(g, gm).mockImplementation(() => "ok");
      c[name](...spec.slice(1));
      expect(spy, gm).toHaveBeenCalledWith(...spec.slice(1));
    }
    c.setMuted(true);
    expect(a.setMuted).toHaveBeenCalledWith(true);
    c.setSfxMuted(true);
    c.setMusicMuted(false);
    c.nextTrack();
    expect(a.nextTrack).toHaveBeenCalled();
    c.destroy();
  });

  it("a page interaction unlocks the sound once the audio context runs; resizing resizes the battle", async () => {
    const c = await mountReign(host(), { base: EP1, onState: () => {} });
    const a = audioInst[0];
    const resize = vi.spyOn(c.game, "resize").mockImplementation(() => {});
    window.dispatchEvent(new Event("resize"));
    expect(resize).toHaveBeenCalled();
    a.ctx = { state: "suspended" };
    document.dispatchEvent(new Event("click"));
    expect(a._ensure).toHaveBeenCalledTimes(1);
    a.ctx = { state: "running" };
    document.dispatchEvent(new Event("keydown"));
    expect(a._ensure).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event("keydown")); // listeners gone once unlocked
    expect(a._ensure).toHaveBeenCalledTimes(2);
    c.destroy();
  });

  it("a failed asset load isn't cached: the next battle tries again", async () => {
    globalThis.Image = class {
      set src(v) {
        queueMicrotask(() => this.onerror());
      }
    };
    await expect(
      mountReign(host(), { base: "/nowhere/", spriteBase: "/broken-art/", onState: () => {} }),
    ).rejects.toThrow();
    globalThis.Image = FakeImage;
    loaded.length = 0;
    await mountReign(host(), { base: EP1, spriteBase: "/broken-art/", onState: () => {} }).then((c) => c.destroy());
    expect(loaded.some((s) => s.startsWith("/broken-art/sprites/"))).toBe(true);
  });
});

describe("preloadReign", () => {
  it("warms the shared art, the sound clips and each dir's interface images once", async () => {
    // preloading is fire-and-forget: wait until the image loads stop arriving (a fixed delay was flaky under load)
    const quiet = async () => {
      for (let prev = -1; loaded.length !== prev;) {
        prev = loaded.length;
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    loaded.length = 0;
    preloadReign({ base: "/games/reign-of-swords-2/", spriteBase: EP1 });
    await quiet();
    expect(preloadSounds).toHaveBeenCalledWith(EP1);
    expect(loaded.some((s) => s.startsWith(EP1 + "sprites/"))).toBe(true);
    const n = loaded.length;
    preloadReign({ base: "/games/reign-of-swords-2/", spriteBase: EP1 }); // UI lists already fetched
    await quiet();
    expect(loaded.length).toBe(n);
    preloadReign({ base: "/missing-dir/" }); // no preload.json there: nothing breaks
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe("the Game shell", () => {
  it("the player's saved heraldry colours the army; an unknown tincture falls back", async () => {
    const c = await mountReign(host(), { base: EP1, onState: () => {} });
    localStorage.setItem("ros-heraldry-v1", JSON.stringify({ symbolColor: "azure", bgColor: "or" }));
    const g = new Game(host().querySelector("canvas"), c.game.assets, () => {}, audioInst[0], null, true);
    expect(g.playerRamps).toEqual(["azure", "or"]);
    localStorage.setItem("ros-heraldry-v1", JSON.stringify({ symbolColor: "plaid", bgColor: "or" }));
    const h = new Game(host().querySelector("canvas"), c.game.assets, () => {}, audioInst[0], null, true);
    expect(h.playerRamps).toEqual(["gules", "argent"]);
    g.destroy();
    h.destroy();
    c.destroy();
  });

  it("a hidden tab drives the battle on a timer; back in view the timer stops; destroy clears it too", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const c = await mountReign(host(), { base: EP1, onState: () => {} });
    const g = c.game;
    const bg = vi.spyOn(g, "_tickBg").mockImplementation(() => {});
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    g._onVis();
    g._onVis(); // already ticking
    vi.advanceTimersByTime(250);
    expect(bg).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    g._onVis();
    expect(g._bgTimer).toBeNull();
    g._onVis();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    g._onVis();
    c.destroy();
    expect(g._bgTimer).toBeNull();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  it("panBy moves the camera and drops any eased target", async () => {
    const c = await mountReign(host(), { base: EP1, onState: () => {} });
    const g = c.game;
    g.world = { w: 5000, h: 5000 };
    g.view = { w: 300, h: 300 };
    g.cam = { x: 100, y: 100 };
    g.camTarget = { x: 1, y: 1 };
    g.panBy(40, -20);
    expect(g.cam).toEqual({ x: 140, y: 80 });
    expect(g.camTarget).toBeNull();
    c.destroy();
  });
});

describe("rosterSummary", () => {
  it("counts a deploy list by type with each unit's name", () => {
    expect(
      rosterSummary([
        ["footmen", 1, 1],
        ["footmen", 2, 1],
        ["archers", 3, 1],
      ]),
    ).toEqual([
      { type: "footmen", n: 2, name: "Footmen" },
      { type: "archers", n: 1, name: "Archers" },
    ]);
  });
});

describe("assembling the Game from its mixin files", () => {
  it("copies class and object methods onto the class; a name defined twice is an error", async () => {
    const { mixInto } = await import("../engine/engine.js");
    class T {
      own() {
        return 1;
      }
    }
    class A {
      a() {
        return "a";
      }
    }
    mixInto(T, { A, B: { b: () => "b" } });
    expect(new T().a()).toBe("a");
    expect(new T().b()).toBe("b");
    expect(() => mixInto(T, { C: { own() {} } })).toThrow("Game.own is defined twice (again in C)");
  });
});
