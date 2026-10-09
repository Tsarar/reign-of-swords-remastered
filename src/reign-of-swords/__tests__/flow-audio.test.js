// engine/audio: the AudioManager's two buses (SFX via sfxGain, music via the ambient gain, both into master), clip
// playback handles, fast-forward SFX culling, the shuffled never-repeat music playlist, and the session caches.
// WebAudio is mocked (jsdom has none) — the mock records what the manager asks of the graph.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioManager, SOUND_FILES, SOUND_NAMES, MUSIC_TRACKS, preloadSounds } from "../engine/audio.js";
import { setVolume } from "../util/volume.js";

const param = (v = 1) => ({ value: v, setTargetAtTime: vi.fn() });
let ctxs = [];
class MockCtx {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = { dest: true };
    this.gains = [];
    this.sources = [];
    this.resume = vi.fn(() => {
      this.state = "running";
    });
    this.suspend = vi.fn(() => {
      this.state = "suspended";
    });
    this.close = vi.fn();
    this.decodeFail = false;
    ctxs.push(this);
  }
  createGain() {
    const g = { gain: param(1), connect: vi.fn() };
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = {
      buffer: null,
      playbackRate: param(1),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      context: this,
      onended: null,
    };
    this.sources.push(s);
    return s;
  }
  decodeAudioData(ab) {
    return this.decodeFail ? Promise.reject(new Error("bad")) : Promise.resolve({ decoded: ab });
  }
}
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

let realFetch;
let fetched;
beforeEach(() => {
  ctxs = [];
  fetched = [];
  window.AudioContext = MockCtx;
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url) => {
    fetched.push(String(url));
    if (String(url).includes("missing")) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete window.AudioContext;
  delete window.webkitAudioContext;
  vi.useRealTimers();
  setVolume({ master: 100, sfx: 100, music: 100 });
});

describe("sound table", () => {
  it("names the original clips (e.g. the turn-start sting is sound 38, the Fear balk 44)", () => {
    expect(SOUND_FILES.turn).toBe("orig/snd_38");
    expect(SOUND_FILES.fear).toBe("orig/snd_44");
    expect(SOUND_NAMES).toContain("victory");
    expect(MUSIC_TRACKS[0]).toBe("orig/snd_06.mp3"); // the game's own battle loop (Context::loop(6))
  });
});

describe("a hidden page goes silent (visibilitychange)", () => {
  const setHidden = (hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => setHidden(false));

  it("suspends the context when the browser is minimised and resumes it on return; nothing wakes it meanwhile", () => {
    const a = new AudioManager("/b/");
    a._ensure();
    setHidden(true);
    expect(a.ctx.suspend).toHaveBeenCalled();
    expect(a.ctx.state).toBe("suspended");
    a.play("select"); // the battle ticking in the background plays an effect: it must not resume the context
    expect(a.ctx.resume).not.toHaveBeenCalled();
    setHidden(false);
    expect(a.ctx.resume).toHaveBeenCalled();
    expect(a.ctx.state).toBe("running");
  });

  it("effects asked for while hidden are dropped, not queued: nothing piles up for the return", async () => {
    const a = new AudioManager("/b/");
    a.buffers.select = { b: 1 };
    a.raw.click = new ArrayBuffer(4); // not decoded yet: it finishes decoding while the page is hidden
    a._ensure();
    const late = a.play("click");
    setHidden(true);
    await flush();
    for (let i = 0; i < 30; i++) a.play("select"); // the enemy turn ticking on in the background
    const handle = a.play("select");
    expect(handle.cancelled).toBe(true);
    expect(() => handle.stop()).not.toThrow();
    expect(late.src).toBeNull();
    expect(a.ctx.sources).toHaveLength(0);
    setHidden(false);
    a.play("select"); // back on the page: sound as usual
    expect(a.ctx.sources).toHaveLength(1);
    expect(a.ctx.sources[0].start).toHaveBeenCalledTimes(1);
  });

  it("stops listening once disposed", () => {
    const a = new AudioManager("/b/");
    a._ensure();
    const ctx = a.ctx;
    a.dispose();
    setHidden(true);
    expect(ctx.suspend).not.toHaveBeenCalled();
  });
});

describe("the audio graph", () => {
  it("_ensure builds one context: master at the master level, the SFX bus under it; a suspended context resumes", () => {
    setVolume({ master: 50, sfx: 40 });
    const a = new AudioManager("/b/");
    a._ensure();
    a._ensure();
    expect(ctxs.length).toBe(1);
    expect(a.master.gain.value).toBe(0.5);
    expect(a.sfxGain.gain.value).toBe(0.4);
    expect(a.master.connect).toHaveBeenCalledWith(a.ctx.destination);
    expect(a.sfxGain.connect).toHaveBeenCalledWith(a.master);
    a.ctx.state = "suspended";
    a._ensure();
    expect(a.ctx.resume).toHaveBeenCalled();
  });
  it("falls back to webkitAudioContext, and does nothing without Web Audio or once disposed", () => {
    delete window.AudioContext;
    const none = new AudioManager("/b/");
    none._ensure();
    expect(none.ctx).toBeNull();
    expect(none.play("select")).toBeUndefined();
    window.webkitAudioContext = MockCtx;
    const w = new AudioManager("/b/");
    w._ensure();
    expect(w.ctx).toBeInstanceOf(MockCtx);
    const d = new AudioManager("/b/");
    d.dispose();
    d._ensure();
    expect(d.ctx).toBeNull();
  });
  it("the Settings sliders apply live to master, SFX and music buses", () => {
    const a = new AudioManager("/b/");
    a.applyVolume(); // no context yet: nothing to do
    a._ensure();
    a.startAmbient();
    setVolume({ master: 80, sfx: 30, music: 50 });
    expect(a.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 0, 0.05);
    expect(a.sfxGain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 0, 0.05);
    expect(a._amb.g.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.32 * 0.5, 0, 0.05);
    // broken nodes never throw out of applyVolume
    a.master.gain.setTargetAtTime = () => {
      throw new Error("x");
    };
    a._amb.g.gain.setTargetAtTime = () => {
      throw new Error("x");
    };
    expect(() => a.applyVolume()).not.toThrow();
    a.dispose();
  });
  it("mutes zero a bus but keep the chosen level", () => {
    setVolume({ sfx: 60, music: 50 });
    const a = new AudioManager("/b/");
    a.setSfxMuted(true); // before the context exists
    a._ensure();
    expect(a.sfxGain.gain.value).toBe(0);
    a.setSfxMuted(false);
    expect(a.sfxGain.gain.value).toBe(0.6);
    expect(a._musicLvl()).toBe(0.32 * 0.5);
    a.musicMuted = true;
    expect(a._musicLvl()).toBe(0);
  });
});

describe("play", () => {
  it("returns nothing while the effects are muted", () => {
    const a = new AudioManager("/b/");
    a.setSfxMuted(true);
    expect(a.play("select")).toBeUndefined();
  });
  it("plays a decoded buffer at the given gain / rate / offset and trims it to maxDur", () => {
    const a = new AudioManager("/b/");
    a._ensure();
    a.buffers.gun = { buf: 1 };
    const h = a.play("gun", 0.7, 0.9, 1.0, 0.5);
    const s = a.ctx.sources[0];
    expect(s.buffer).toEqual({ buf: 1 });
    expect(s.playbackRate.value).toBe(0.9);
    expect(s.start).toHaveBeenCalledWith(0, 0.5);
    expect(s.stop).toHaveBeenCalledWith(1.0); // currentTime + maxDur
    const g = a.ctx.gains[a.ctx.gains.length - 1];
    expect(g.gain.value).toBe(0.7);
    expect(g.connect).toHaveBeenCalledWith(a.sfxGain);
    expect(h.src).toBe(s);
    expect(a._active).toContain(s);
    s.onended();
    expect(a._active).not.toContain(s);
  });
  it("a handle cut short fades the clip after its minimum play time", () => {
    const a = new AudioManager("/b/");
    a._ensure();
    a.buffers.move = {};
    a.ctx.currentTime = 1;
    const h = a.play("move");
    a.ctx.currentTime = 1.1; // a one-tile hop ends early: the clip still sounds its 0.35 s minimum
    h.stop(0.2);
    expect(h.gain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 1.35, 0.2 / 3);
    expect(h.src.stop).toHaveBeenCalledWith(1.35 + 0.2);
    a.ctx.currentTime = 3; // long past the minimum: fades from now
    h.stop(0.3);
    expect(h.src.stop).toHaveBeenLastCalledWith(3.3);
    // a broken source never throws out of stop()
    h.src.stop = () => {
      throw new Error("x");
    };
    expect(() => h.stop()).not.toThrow();
  });
  it("a raw clip is decoded once, cached for later battles, then played; a handle stopped first never plays", async () => {
    const a = new AudioManager("/b/");
    a._ensure();
    a.raw.arrow = new ArrayBuffer(8);
    const h1 = a.play("arrow");
    h1.stop(); // cancelled before the decode finished
    await flush();
    expect(a.buffers.arrow).toBeTruthy();
    expect(a.ctx.sources.length).toBe(0);
    a.play("arrow");
    expect(a.ctx.sources.length).toBe(1);
    // a broken decode is swallowed
    const b = new AudioManager("/b/");
    b._ensure();
    b.ctx.decodeFail = true;
    b.raw.cast = new ArrayBuffer(2);
    b.play("cast");
    await flush();
    expect(b.buffers.cast).toBeUndefined();
    // an unknown clip with no bytes is a silent handle
    expect(b.play("nothing").src).toBeNull();
  });
  it("falls back to start() when start(time, offset) throws; maxDur errors are swallowed", () => {
    const a = new AudioManager("/b/");
    a._ensure();
    a.buffers.x = {};
    const orig = a.ctx.createBufferSource.bind(a.ctx);
    a.ctx.createBufferSource = () => {
      const s = orig();
      let n = 0;
      s.start = vi.fn(() => {
        if (n++ === 0) throw new Error("offset unsupported");
      });
      s.stop = () => {
        throw new Error("no stop");
      };
      return s;
    };
    a.play("x", 1, 1, 0.5);
    expect(a.ctx.sources[0].start).toHaveBeenCalledTimes(2);
    // both starts throwing is also survived
    a.ctx.createBufferSource = () => {
      const s = orig();
      s.start = () => {
        throw new Error("nope");
      };
      return s;
    };
    expect(() => a.play("x")).not.toThrow();
  });
  it("fast-forward cuts SFX older than ~0.12 s when a new one starts, keeping same-instant layers", () => {
    const a = new AudioManager("/b/");
    a._ensure();
    a.buffers.s = {};
    a.setFast(true);
    a.play("s");
    a.play("s");
    const [s1, s2] = a.ctx.sources;
    a.ctx.currentTime = 0.05;
    a.play("s"); // within the grace window: nothing is cut
    expect(s1.stop).not.toHaveBeenCalled();
    a.ctx.currentTime = 0.5;
    s2.stop = () => {
      throw new Error("already stopped");
    };
    a.play("s");
    expect(s1.stop).toHaveBeenCalled();
    expect(a._active.length).toBe(1);
  });
});

describe("preload / caches", () => {
  it("preload fetches every clip once (session cache) and reuses already-decoded buffers", async () => {
    const a = new AudioManager("/pre/");
    await a.preload();
    expect(Object.keys(a.raw).length).toBe(SOUND_NAMES.length);
    const n = fetched.length;
    const b = new AudioManager("/pre/");
    await b.preload();
    expect(fetched.length).toBe(n); // the raw bytes are cached across managers
    // a buffer decoded by one manager is reused by the next
    b._ensure();
    b.play("select");
    await flush();
    const c = new AudioManager("/pre/");
    await c.preload();
    expect(c.buffers.select).toBeTruthy();
  });
  it("a failed fetch is not cached (retried later) and never throws", async () => {
    const a = new AudioManager("/missing/");
    await a.preload();
    expect(Object.keys(a.raw).length).toBe(0);
    const n = fetched.length;
    preloadSounds("/missing/");
    await flush();
    expect(fetched.length).toBe(n + new Set(Object.values(SOUND_FILES)).size); // clips shared by two names fetch once
  });
});

describe("battle music playlist", () => {
  it("shuffles every track and never starts with the one just heard", () => {
    const a = new AudioManager("/m/");
    for (let i = 0; i < 20; i++) {
      const q = a._shuffleTracks(MUSIC_TRACKS[0]);
      expect([...q].sort()).toEqual([...MUSIC_TRACKS].sort());
      expect(q[0]).not.toBe(MUSIC_TRACKS[0]);
    }
  });
  it("streams a track, fades in, prefetches the next, and plays on when one ends", async () => {
    const a = new AudioManager("/m/");
    a.startAmbient();
    a.startAmbient(); // already playing: ignored
    const amb = a._amb;
    expect(amb.g.gain.value).toBe(0);
    expect(amb.g.gain.setTargetAtTime).toHaveBeenCalledWith(0.32, 0, 1.2);
    await flush(10);
    const s = amb.src;
    expect(s.start).toHaveBeenCalled();
    expect(amb.pre && amb.pre.track).toBe(amb.queue[0]);
    const nextTrack = amb.queue[0];
    s.onended();
    await flush(10);
    expect(amb.last).toBe(nextTrack);
    expect(amb.src).not.toBe(s);
    // "Next song" skips at once, stopping the current source
    const cur = amb.src;
    a.nextTrack();
    expect(cur.stop).toHaveBeenCalled();
    await flush(10);
    // exhausting the queue reshuffles and plays on
    amb.queue = [];
    amb.src.onended();
    await flush(10);
    expect(amb.queue.length).toBeGreaterThan(0);
    a.dispose();
  });
  it("a track that was skipped while loading is dropped; a broken track skips to the next", async () => {
    vi.useFakeTimers();
    const a = new AudioManager("/m/");
    a._ensure();
    a.ctx.decodeFail = true;
    a.startAmbient();
    const amb = a._amb;
    await flush(10);
    expect(amb.fails).toBe(1);
    a.ctx.decodeFail = false;
    vi.advanceTimersByTime(300);
    await flush(10);
    expect(amb.fails).toBe(0);
    expect(amb.src).toBeTruthy();
    // stale: a load that resolves after a newer skip is ignored
    const tok = amb.token;
    a.nextTrack();
    a.nextTrack();
    await flush(10);
    expect(amb.token).toBe(tok + 2);
    a.dispose();
  });
  it("a suspended context arms a one-shot gesture that resumes it", async () => {
    const a = new AudioManager("/m/");
    a._ensure();
    a.ctx.resume = vi.fn(); // stays suspended until the gesture
    a.ctx.state = "suspended";
    a.startAmbient();
    expect(a._musicGestureArmed).toBe(true);
    a._armMusicGesture(() => {}); // already armed: no second listener
    document.dispatchEvent(new Event("pointerdown"));
    expect(a._musicGestureArmed).toBe(false);
    expect(a.ctx.resume).toHaveBeenCalled();
    // a throwing resume is swallowed
    a.ctx.resume = () => {
      throw new Error("x");
    };
    const fn = vi.fn();
    a._armMusicGesture(fn);
    document.dispatchEvent(new Event("keydown"));
    expect(fn).toHaveBeenCalled();
    a.dispose();
  });
  it("nextTrack starts the music when none plays; music unmute starts it; mute ducks it", async () => {
    const a = new AudioManager("/m/");
    a.nextTrack();
    expect(a._amb).toBeTruthy();
    a.setMusicMuted(true);
    expect(a._amb.g.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.3);
    a._amb.g.gain.setTargetAtTime = () => {
      throw new Error("x");
    };
    expect(() => a.setMusicMuted(true)).not.toThrow();
    const b = new AudioManager("/m/");
    b.setMuted(false); // un-muting before it ever started → starts it
    expect(b._amb).toBeTruthy();
    expect(b.sfxMuted).toBe(false);
    b.setMuted(true);
    expect(b.sfxMuted && b.musicMuted).toBe(true);
    a.dispose();
    b.dispose();
  });
  it("stopAmbient fades out, cancels a loading track and stops the source after the fade", async () => {
    vi.useFakeTimers();
    const a = new AudioManager("/m/");
    a.stopAmbient(); // nothing playing: no-op
    a.startAmbient();
    await flush(10);
    const amb = a._amb,
      src = amb.src;
    a.stopAmbient();
    expect(a._amb).toBeNull();
    expect(amb.g.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.4);
    src.stop = vi.fn(() => {
      throw new Error("x");
    });
    vi.advanceTimersByTime(700);
    expect(src.stop).toHaveBeenCalled();
    expect(amb.src).toBeNull();
    // a broken gain is swallowed
    a.startAmbient();
    a._amb.g.gain.setTargetAtTime = () => {
      throw new Error("x");
    };
    expect(() => a.stopAmbient()).not.toThrow();
    vi.advanceTimersByTime(700);
  });
  it("dispose stops the music, closes the context and unsubscribes from the volume sliders", async () => {
    const a = new AudioManager("/m/");
    a.startAmbient();
    await flush(10);
    const amb = a._amb,
      ctx = a.ctx;
    amb.src.stop = () => {
      throw new Error("x");
    };
    ctx.close = vi.fn(() => {
      throw new Error("x");
    });
    a.dispose();
    expect(a._amb).toBeNull();
    expect(a.ctx).toBeNull();
    expect(ctx.close).toHaveBeenCalled();
    const spy = vi.spyOn(a, "applyVolume");
    setVolume({ master: 10 });
    expect(spy).not.toHaveBeenCalled();
    a.dispose(); // twice is harmless
    a.startAmbient(); // a disposed manager never restarts the music
    expect(a._amb).toBeNull();
  });
  it("a missing track (HTTP error) counts as a failure and is skipped", async () => {
    vi.useFakeTimers();
    const a = new AudioManager("/missing/");
    a.startAmbient();
    await flush(10);
    expect(a._amb.fails).toBe(1);
    // the playlist gives up after one failure per track
    for (let i = 0; i < MUSIC_TRACKS.length + 2; i++) {
      vi.advanceTimersByTime(300);
      await flush(10);
    }
    expect(a._amb.fails).toBe(MUSIC_TRACKS.length + 1);
    a.dispose();
  });
});
