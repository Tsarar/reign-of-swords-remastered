/* ============================================================
   Reign of Swords — gameplay options (⚙ Settings), saved in localStorage. Every option defaults to the original
   game's behaviour. A battle reads them when it starts (Game.selectMission), so a change takes effect from the next
   battle; React reads them via useGameOptions().
   ============================================================ */
import { useSyncExternalStore } from "react";

const KEY = "ros-options";
export const OPTION_DEFAULTS = {
  // ⚙ Realistic siege — DELIBERATE DEVIATION when on (MECHANICS.md §13): an AI army's shooters ignore their group's
  // 8-tile target leash (Unit::isValidFormationTarget), so a walled garrison fires on whatever is in range.
  realisticSiege: false,
};
let options = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    if (stored && typeof stored === "object") return { ...OPTION_DEFAULTS, ...stored };
  } catch {
    /* none saved */
  }
  return { ...OPTION_DEFAULTS };
})();
const subs = new Set();

export function getGameOptions() {
  return options;
}
export function setGameOption(part) {
  options = { ...options, ...part };
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    /* private mode: lasts this session */
  }
  subs.forEach((f) => f());
}
export function subscribeGameOptions(listener) {
  subs.add(listener);
  return () => subs.delete(listener);
}
export function useGameOptions() {
  return useSyncExternalStore(subscribeGameOptions, getGameOptions, getGameOptions);
}
