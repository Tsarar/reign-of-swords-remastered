// Helpers for the campaign-shell tests (shell-*.test.jsx): patch the game-data fetch per test, and a fake Audio
// that records which menu sounds play.

// Wrap the setup's disk-backed fetch: `patches` maps a URL suffix to either a function (json) => json that edits the
// real file's data, or "fail" (the request rejects). Returns a restore function.
export function patchFetch(patches) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [suffix, fn] of Object.entries(patches)) {
      if (!u.endsWith(suffix)) continue;
      if (fn === "fail") throw new Error("network down: " + u);
      const r = await orig(url);
      const raw = r.ok ? await r.text() : null;
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* a text file (e.g. MECHANICS.md): hand over the raw text */
      }
      const data = fn(parsed);
      const text = typeof data === "string" ? data : JSON.stringify(data);
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    }
    return orig(url);
  };
  return () => {
    globalThis.fetch = orig;
  };
}

// Replace window.Audio with a recorder: every play() lands in the returned array as {src, volume}.
export function stubAudio() {
  const plays = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.volume = 1;
      this.currentTime = 0;
    }
    play() {
      plays.push({ src: this.src, volume: this.volume });
      return Promise.resolve();
    }
  }
  globalThis.Audio = FakeAudio;
  return plays;
}
