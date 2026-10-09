/* ============================================================
   Reign of Swords — pure, framework-free utilities.
   Leaf module: no game state, no DOM. Safe to import anywhere.
   ============================================================ */

// --- grid / geometry -----------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const key = (x, y) => x + "," + y; // tile-set key "x,y"
export const manhattan = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
// "No distance / index found yet": the starting value of a nearest-so-far search — larger than any map distance.
export const FAR = 1e9;
// The key of a {side: count} tally with STRICTLY the highest count — null for a tie or an empty tally (the
// original's capture-point majority test).
export function strictMost(tally) {
  let best = null,
    top = 0,
    tie = false;
  for (const k in tally) {
    if (tally[k] > top) {
      best = k;
      top = tally[k];
      tie = false;
    } else if (tally[k] === top && top > 0) tie = true;
  }
  return tie ? null : best;
}
export const cheb = (a, b) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty)); // king-move distance — only for the true 3×3 area spell (Lightning Storm)

// --- colour: palette-swap helpers ---------------------------------------
// Recolour only a sprite's saturated "heraldry" pixels to an army hue (like the original's per-team palette),
// leaving skin / metal / leather (low saturation) untouched.
export function rgbHue(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  let h;
  if (mx === r) h = ((g - b) / (mx - mn)) % 6;
  else if (mx === g) h = (b - r) / (mx - mn) + 2;
  else h = (r - g) / (mx - mn) + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function _hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
export function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
      p = 2 * l - q;
    r = _hue2rgb(p, q, h + 1 / 3);
    g = _hue2rgb(p, q, h);
    b = _hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// --- misc ----------------------------------------------------------------
export function makeRng(seed) {
  let state = seed >>> 0;
  const rng = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // its position in the sequence, so an online battle's snapshot carries it (engine/online.js)
  rng.state = () => state;
  rng.setState = (s) => {
    state = s >>> 0;
  };
  return rng;
}

// Bump when a sprite/tileset PNG is re-baked. Vite does NOT hot-reload public/ assets, and the browser caches
// them by URL — appending ?v=<ASSET_V> forces a fresh fetch so swapped art shows up.
export const ASSET_V = "27";

// HIT POINTS — DELIBERATE DEVIATION (MECHANICS.md §13): kept in WHOLE points, 0..100. The original runs Unit+0x190 on
// a 256 scale (100 HP = 256) and shows floor(HP·100/256), so its badge and its numbers drift a point apart (a heal
// "+20" from 50 lands on 69, quicksand reads 5 while the badge drops 4). Here every amount is rounded to whole HP as
// it lands — a blow from the original's integer damage chain (on the 256 scale, with the attacker's HP as HP256), a
// heal +20, quicksand 5, a smite 10 — so the badge and every number agree.
export const toHp256 = (hp) => Math.round((hp * 256) / 100);
export const fromHp256 = (n) => (n * 100) / 256;
// a 256-scale amount as whole HP: rounded, and at least 1 when it is anything at all
export const wholeHp = (n256) => (n256 > 0 ? Math.max(1, Math.round((n256 * 100) / 256)) : 0);
export const shownHp = (hp) => (hp > 0 ? Math.max(1, Math.round(hp)) : 0);
// the damage a blow of `dmg` on a unit at `hp` reads: what it takes (never more than the unit had)
export const shownDamage = (hp, dmg) => Math.max(0, Math.min(shownHp(hp), dmg));
// the heal state (a Priest's Heal, a Craftsman's repair — the original's +51 of 256 is 20 whole HP), capped at full
export const healStep = (hp) => {
  const after = Math.min(100, hp + 20);
  return { hp: after, shown: after - hp };
};
