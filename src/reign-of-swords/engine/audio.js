/* ============================================================
   Reign of Swords — audio.
   Two independent buses: SFX route through `sfxGain`, battle music through the
   ambient gain (`_amb.g`); both feed `master`, so Music and Effects mute apart.
   ============================================================ */

import { ASSET_V } from "../util/util.js";
import { masterLevel, getVolume, subscribeVolume } from "../util/volume.js";

// The ORIGINAL clips, straight from the iOS Episode II audio archive (ios-episode-2/_raw/audio.dat: entry N = sound
// id N; ids 7-60 are 8-bit WAVs at their own rates, converted losslessly-enough to mp3 in audio/orig/). Which id plays
// for which event was read from the binary (Context::play call sites — see AI-HANDOFF §8i). Episode I uses the same
// clips numbered two lower, so one table serves both. Names are what the engine's play() calls use.
export const SOUND_FILES = {
  // UI (GameScreen / MenuScreen): 41 = cursor move / unit pick, 37 = menu button & popup, 39/40 = deploy place /
  // take back, 43 = menu closes, 38 = turn-start sting (mp3), 36 = victory fanfare (mp3), 24 = defeat sting
  select: "orig/snd_41",
  click: "orig/snd_37",
  place: "orig/snd_39",
  remove: "orig/snd_40",
  menu_close: "orig/snd_43",
  turn: "orig/snd_38",
  victory: "orig/snd_36",
  defeat: "orig/snd_24",
  // movement (Unit::playMovingSound by class): foot 19/20 alternating, cavalry 15/16 alternating, flying 12,
  // war engines 42, Blood Gorgers 45, Conjurer 46; 34 = the stag / mount whinny
  move: "orig/snd_19",
  move2: "orig/snd_20",
  gallop: "orig/snd_15",
  gallop2: "orig/snd_16",
  fly: "orig/snd_12",
  march: "orig/snd_42",
  move_gorger: "orig/snd_45",
  move_conjurer: "orig/snd_46",
  horse: "orig/snd_34",
  // melee (changeState's weapon switch): Spear / Pike / Druid Lance cycle 27/28/29, other blades alternate 30/31; a
  // Bodyguard's blow is 48, the Blood Gorger's Bite 47, the Craftsmen's Mallet 49
  melee_pole1: "orig/snd_27",
  melee_pole2: "orig/snd_28",
  melee_pole3: "orig/snd_29",
  melee_blade1: "orig/snd_30",
  melee_blade2: "orig/snd_31",
  melee_guard: "orig/snd_48",
  melee_bite: "orig/snd_47",
  melee_mallet: "orig/snd_49",
  // shooting: 35 bow (every arrow, Fire Arrows included — 23 is NOT a fire arrow: _executeAction plays it right after
  // Map::removeUnit, the unit-leaves-the-field clip, kept here as "leave"), 21 musket, 8 cannon + 13 the shell's burst, 32 the Trebuchet's boulder, 9 point-blank
  // Grapeshot, 33 catapult / trebuchet launch + 25 the rock's crash, 51 ballista launch + 52 the bolt's hit (and Shock),
  // 50 the Craftsmen's hammer throw
  arrow: "orig/snd_35",
  leave: "orig/snd_23",
  gun: "orig/snd_21",
  boulder_hit: "orig/snd_32",
  cannon: "orig/snd_08",
  explosion: "orig/snd_13",
  grapeshot: "orig/snd_09",
  catapult: "orig/snd_33",
  rock_hit: "orig/snd_25",
  ballista: "orig/snd_51",
  bolt_hit: "orig/snd_52",
  hammer: "orig/snd_50",
  // magic & abilities: 14 Fireball, 18 Ice Shard, 26 Lightning Storm, 22 the cast (Shield dome / Quicksand / Absorb),
  // 10 Heal & Retribution, 44 the Fear balk, 17 Spirit Shroud (Unit::curse), 11 the druid's shapeshift (Ep1 action
  // sound), 53 Build / Repair, 55 Conjure, 54 unsummon, 56 the Sapper's blast, 58/59 Teleport out / in, 57 the
  // Quicksand cast (with 22)
  spellfire: "orig/snd_14",
  spell: "orig/snd_18",
  thunder: "orig/snd_26",
  cast: "orig/snd_22",
  ability: "orig/snd_22",
  heal: "orig/snd_10",
  fear: "orig/snd_44",
  shroud: "orig/snd_17",
  shapeshift: "orig/snd_11",
  build: "orig/snd_53",
  conjure: "orig/snd_55",
  unsummon: "orig/snd_54",
  detonate: "orig/snd_56",
  teleport_out: "orig/snd_58",
  teleport_in: "orig/snd_59",
  quicksand: "orig/snd_57",
};
export const SOUND_NAMES = Object.keys(SOUND_FILES);

// Battle-music PLAYLIST: the original orchestral loop plus the added DnD ambient tracks. They are STREAMED
// (one <audio> element) and played back-to-back in a fresh RANDOM order; when the list is exhausted it reshuffles
// — never repeating the track that just played — and plays on, so a battle cycles the whole set endlessly.
// The game's own battle loop is sound id 6 (Context::loop(6) in GameScreen, a 32 s mp3); the DnD pieces stay as extras.
export const MUSIC_TRACKS = [
  "orig/snd_06.mp3",
  "music_battle.mp3",
  "music_dnd_boss.mp3",
  "music_dnd_darkness.mp3",
  "music_dnd_fight.mp3",
  "music_dnd_victory.mp3",
  "music_dnd_winter.mp3",
  "music_inner_glow.mp3", // Inner Glow — Gabriel Saban
  "music_return_to_the_warrens.mp3", // Return to the Warrens — Stuart Chatwood
  "music_samurais_dance.mp3", // Samurai's Dance — Cinematic Delirium
  "music_weightless.mp3", // Weightless — Twelve Titans Music
  "music_celtic_fire.mp3", // Celtic Fire — Everrune
];

// Session-wide sound caches: the raw clip bytes (fetched once, by the first battle or the menu preload) and the decoded
// AudioBuffers (an AudioBuffer isn't tied to the context that decoded it, so every later battle reuses them).
const RAW = new Map(),
  DECODED = new Map();
const fetchRaw = (url) => {
  if (!RAW.has(url))
    RAW.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(url);
          return r.arrayBuffer();
        })
        .catch((e) => {
          RAW.delete(url);
          throw e;
        }),
    );
  return RAW.get(url);
};
const soundUrl = (base, n) => base + "audio/" + (SOUND_FILES[n] || n) + ".mp3?v=" + ASSET_V;
export function preloadSounds(base) {
  for (const n of SOUND_NAMES) fetchRaw(soundUrl(base, n)).catch(() => {});
}

export class AudioManager {
  constructor(base) {
    this.base = base;
    this.raw = {};
    this.buffers = {};
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.sfxMuted = false;
    this.musicMuted = false;
    this._unVol = subscribeVolume(() => this.applyVolume()); // ⚙ Settings sliders apply live
    // A HIDDEN page (the browser minimised, the phone locked, another tab) goes silent: the context is suspended —
    // the music keeps its place — and resumed on return. Mobile browsers otherwise play on in the background, and the
    // battle keeps ticking while hidden (engine.js _tickBg), so its sound effects must not wake the context either.
    this._onVis = () => this._applyVisibility();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVis);
  }
  _pageHidden() {
    return typeof document !== "undefined" && !!document.hidden;
  }
  _applyVisibility() {
    if (!this.ctx) return;
    try {
      if (this._pageHidden()) {
        if (this.ctx.state === "running" && this.ctx.suspend) this.ctx.suspend();
      } else if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (e) {}
  }
  // Leaving the battle: stop the music now (so it doesn't play on in the menus), close the audio context, and make sure a
  // playlist still loading — or a start armed for the next click — can't bring it back.
  dispose() {
    this._disposed = true;
    if (this._onVis && typeof document !== "undefined") document.removeEventListener("visibilitychange", this._onVis);
    this._onVis = null;
    if (this._unVol) {
      this._unVol();
      this._unVol = null;
    }
    if (this._amb) {
      const a = this._amb;
      this._amb = null;
      a.token++;
      if (a.src) {
        a.src.onended = null;
        try {
          a.src.stop();
        } catch (e) {}
      }
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      try {
        ctx.close();
      } catch (e) {}
    }
  }
  // Bus levels from the Settings sliders (util/volume.js): master → the master bus; Effects → the SFX bus; Music →
  // the music bus (its base level _ambVol × the slider). A mute zeroes its bus but keeps the chosen level.
  _sfxLvl() {
    return this.sfxMuted ? 0 : getVolume().sfx / 100;
  }
  _musicLvl() {
    return this.musicMuted ? 0 : ((this._ambVol || 0.32) * getVolume().music) / 100;
  }
  applyVolume() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      this.master.gain.setTargetAtTime(masterLevel(), now, 0.05);
      this.sfxGain.gain.setTargetAtTime(this._sfxLvl(), now, 0.05);
    } catch (e) {}
    if (this._amb) {
      try {
        this._amb.g.gain.setTargetAtTime(this._musicLvl(), now, 0.05);
      } catch (e) {}
    }
  }
  async preload() {
    await Promise.all(
      SOUND_NAMES.map(async (n) => {
        try {
          this.raw[n] = await fetchRaw(soundUrl(this.base, n));
        } catch (e) {}
        if (DECODED.has(n)) this.buffers[n] = DECODED.get(n);
      }),
    );
    // Battle music is STREAMED at play time (see MUSIC_TRACKS / startAmbient), so nothing to prefetch here —
    // decoding the whole ~15 MB playlist upfront would be wasteful. Episode 1 shipped no battle track, so these
    // are chosen pieces; the stitched game-theme loop is kept alongside as music_battle_themes.mp3.
  }
  _ensure() {
    if (this._disposed) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = masterLevel();
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); // the SFX bus — muted independently of music
      this.sfxGain.gain.value = this._sfxLvl();
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended" && !this._pageHidden()) this.ctx.resume();
  }
  setFast(on) {
    this._fast = !!on;
  } // fast-forward on: cut lingering SFX so they don't pile up over the sped-up actions
  play(name, gain = 1, rate = 1, maxDur = 0, offset = 0) {
    this._ensure();
    if (!this.ctx || this.sfxMuted) return;
    // FAST MODE: when a new action's sound starts, cut any earlier SFX still ringing from a finished action
    // (older than ~one sped-up action) — so a stack of galloping/clashing tails doesn't overlap. Same-instant
    // layers (a swing + its impact, fired within a frame) survive the grace window.
    if (this._fast && this._active) {
      const now = this.ctx.currentTime;
      this._active = this._active.filter((source) => {
        if (now - source._t > 0.12) {
          try {
            source.stop();
          } catch (e) {}
          return false;
        }
        return true;
      });
    }
    // Returns a HANDLE so a caller can cut the clip short — a unit's movement clip is faded out the moment its glide
    // ends (the originals are 1-3s, far longer than a hop, so they kept playing after the unit had already stopped).
    const handle = {
      src: null,
      gain: null,
      cancelled: false,
      // minPlay: never cut a clip before it has sounded this long (a one-tile hop ends in ~0.17s)
      stop(fade = 0.12, minPlay = 0.35) {
        this.cancelled = true;
        if (!this.src || !this.gain) return;
        try {
          const now = this.src.context.currentTime,
            stopAt = Math.max(now, (this.src._t || now) + minPlay);
          this.gain.gain.setTargetAtTime(0, stopAt, fade / 3);
          this.src.stop(stopAt + fade);
        } catch (e) {}
      },
    };
    // A HIDDEN page plays no effects at all. Its context is suspended (_applyVisibility) while the battle ticks on
    // (engine.js _tickBg), so a clip started now would wait at the frozen clock — and every effect of the enemy turn
    // you were away for would sound at once on your return.
    if (this._pageHidden()) {
      handle.cancelled = true;
      return handle;
    }
    const spawn = (buffer) => {
      if (handle.cancelled || this._pageHidden()) return; // (a clip still decoding when the page was hidden)
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      if (rate !== 1) source.playbackRate.value = rate; // lower rate = heavier/slower (a mount's gallop vs footsteps)
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode);
      gainNode.connect(this.sfxGain);
      // offset = start position INTO the clip (skip leading dead air, e.g. the musket gun's ~0.5s of silence before
      // the crack); maxDur = how long to play from there before a quick fade-out (trim a long tail to a punch).
      try {
        source.start(this.ctx.currentTime, Math.max(0, offset));
      } catch (e) {
        try {
          source.start();
        } catch (e2) {}
      }
      if (maxDur > 0) {
        try {
          gainNode.gain.setTargetAtTime(0, this.ctx.currentTime + maxDur * 0.7, maxDur * 0.15);
          source.stop(this.ctx.currentTime + maxDur);
        } catch (e) {}
      }
      handle.src = source;
      handle.gain = gainNode;
      source._t = this.ctx.currentTime;
      (this._active || (this._active = [])).push(source);
      source.onended = () => {
        if (this._active) this._active = this._active.filter((x) => x !== source);
      };
    };
    if (this.buffers[name]) spawn(this.buffers[name]);
    else if (this.raw[name]) {
      this.ctx
        .decodeAudioData(this.raw[name].slice(0))
        .then((b) => {
          this.buffers[name] = b;
          DECODED.set(name, b);
          spawn(b);
        })
        .catch(() => {});
    }
    return handle;
  }
  setSfxMuted(muted) {
    this.sfxMuted = muted;
    if (this.sfxGain) this.sfxGain.gain.value = this._sfxLvl();
  }
  setMusicMuted(muted) {
    this.musicMuted = muted;
    if (this._amb && this.ctx) {
      try {
        this._amb.g.gain.setTargetAtTime(this._musicLvl(), this.ctx.currentTime, 0.3);
      } catch (e) {}
    }
    if (!muted && !this._amb) this.startAmbient(); // un-muting music before it ever started → start it now
  }
  setMuted(muted) {
    this.setSfxMuted(muted);
    this.setMusicMuted(muted);
  } // back-compat: mute/unmute both
  // Battle music — a randomised, endlessly-looping PLAYLIST (MUSIC_TRACKS). Each track is fetched, decoded and played
  // as a Web Audio BUFFER (not an <audio> element): a playing media element makes the browser treat the tab as a
  // media player — the keyboard's Play/Pause / Next keys and the OS media overlay would pause or skip the game's
  // music instead of whatever else you're listening to. The buffer source feeds a gain node on the master bus, so
  // the Music mute simply ducks that gain (the track keeps advancing silently). The next track's bytes are
  // prefetched while the current one plays; only the playing track is held decoded. Each finished track triggers the next; when the
  // shuffled queue empties it reshuffles (no back-to-back repeat) and plays on. Starts on the first user gesture
  // (autoplay policy) — if play() is blocked it re-arms itself for the next gesture. Method names kept so callers
  // are unchanged.
  _shuffleTracks(last) {
    const order = MUSIC_TRACKS.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    if (order.length > 1 && order[0] === last) {
      const swap = order[0];
      order[0] = order[1];
      order[1] = swap;
    } // never replay the just-heard track first
    return order;
  }
  _armMusicGesture(fn) {
    if (this._musicGestureArmed) return;
    this._musicGestureArmed = true;
    const start = () => {
      this._musicGestureArmed = false;
      for (const ev of ["pointerdown", "click", "keydown", "touchstart"]) document.removeEventListener(ev, start);
      try {
        if (this.ctx && this.ctx.state === "suspended" && !this._pageHidden()) this.ctx.resume();
      } catch (e) {}
      fn();
    };
    for (const ev of ["pointerdown", "click", "keydown", "touchstart"]) document.addEventListener(ev, start);
  }
  startAmbient() {
    this._ensure();
    if (!this.ctx || this._amb || !MUSIC_TRACKS.length) return;
    this._ambVol = 0.32;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.master);
    const ambient = (this._amb = {
      g: gainNode,
      src: null,
      queue: this._shuffleTracks(null),
      last: null,
      next: null,
      token: 0,
      pre: null,
      fails: 0,
    });
    const load = (track) =>
      fetch(this.base + "audio/" + track).then((r) => {
        if (!r.ok) throw new Error(track);
        return r.arrayBuffer();
      });
    const playNext = () => {
      if (this._amb !== ambient) return; // stopped/replaced while pending
      if (!ambient.queue.length) ambient.queue = this._shuffleTracks(ambient.last);
      const track = ambient.queue.shift();
      ambient.last = track;
      const token = ++ambient.token;
      if (ambient.src) {
        const source = ambient.src;
        ambient.src = null;
        source.onended = null;
        try {
          source.stop();
        } catch (e) {}
      }
      const bytes = ambient.pre && ambient.pre.track === track ? ambient.pre.p : load(track);
      ambient.pre = null;
      bytes
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((buffer) => {
          if (this._amb !== ambient || token !== ambient.token) return; // skipped / stopped while it was loading
          ambient.fails = 0;
          const source = this.ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(gainNode);
          source.onended = () => {
            if (ambient.src === source) playNext();
          };
          ambient.src = source;
          source.start();
          if (!ambient.queue.length) ambient.queue = this._shuffleTracks(track);
          const nextTrack = ambient.queue[0];
          ambient.pre = { track: nextTrack, p: load(nextTrack) }; // prefetch the next track's bytes
          ambient.pre.p.catch(() => {});
        })
        .catch(() => {
          // a missing/broken track → skip to the next one
          if (this._amb !== ambient || token !== ambient.token) return;
          if (++ambient.fails <= MUSIC_TRACKS.length) setTimeout(playNext, 300);
        });
      if (this.ctx.state === "suspended") this._armMusicGesture(() => {}); // autoplay policy: the next gesture resumes the context
    };
    ambient.next = playNext; // "Next song" (dev menu) skips straight to the next track
    playNext();
    try {
      gainNode.gain.setTargetAtTime(this._musicLvl(), this.ctx.currentTime, 1.2);
    } catch (e) {} // fade in
  }
  // Skip to the next playlist track now (the dev menu's "Next song"); starts the music if it isn't playing yet.
  nextTrack() {
    if (this._amb && this._amb.next) this._amb.next();
    else this.startAmbient();
  }
  stopAmbient() {
    if (!this._amb) return;
    const a = this._amb;
    this._amb = null;
    try {
      a.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    } catch (e) {}
    a.token++; // cancel a track still loading
    setTimeout(() => {
      if (a.src) {
        a.src.onended = null;
        try {
          a.src.stop();
        } catch (e) {}
        a.src = null;
      }
    }, 700);
  }
}
