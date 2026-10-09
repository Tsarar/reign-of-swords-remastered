/* ============================================================
   Reign of Swords — sound levels (⚙ Settings): Master, Effects, Music, each 0–100, saved in localStorage.
   Read by the battle's AudioManager (Web Audio buses) and the shell's menu clicks; React reads it via useVolume().
   The Music / Effects on-off toggles stay separate (a mute keeps the chosen level for when it's switched back on).
   ============================================================ */
import { useSyncExternalStore } from "react";

const KEY = "ros-volume";
const DEFAULTS = { master: 100, sfx: 100, music: 100 };
let vol = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && typeof v === "object") return { ...DEFAULTS, ...v };
  } catch {
    /* none saved */
  }
  return { ...DEFAULTS };
})();
const subs = new Set();

export function getVolume() {
  return vol;
}
export function setVolume(part) {
  vol = { ...vol, ...part };
  try {
    localStorage.setItem(KEY, JSON.stringify(vol));
  } catch {
    /* private mode: lasts this session */
  }
  subs.forEach((f) => f());
}
export function subscribeVolume(listener) {
  subs.add(listener);
  return () => subs.delete(listener);
}
export function useVolume() {
  return useSyncExternalStore(subscribeVolume, getVolume, getVolume);
}
// 0..1 multipliers
export const masterLevel = () => vol.master / 100;
export const sfxLevel = () => (vol.master / 100) * (vol.sfx / 100);
export const musicLevel = () => vol.music / 100;
