/* i18n/i18n.js — the game's interface translations (Russian, Ukrainian).

   The game has its OWN language setting, separate from the site's: the game's ⚙ Settings screen sets it (saved under
   localStorage "ros-lang"), and the site header's EN / RU / UA switch does not touch it. English until changed (the
   original game was English-only — every RU/UA line is our own: the interface in i18n/ru|uk.js, the story — dialogue,
   briefings, mission / kingdom / faction names — in i18n/ru|uk-story.js). Strings are keyed by their English text, so
   `tr("Campaign")` returns the English itself when no translation exists (and always in English mode). `{name}`
   placeholders are filled from `vars`. React screens call useGameLang() so they re-render on a switch; the canvas
   re-reads tr() every frame. */
import { useSyncExternalStore } from "react";
import RU_UI from "./ru.js";
import UK_UI from "./uk.js";
import RU_STORY from "./ru-story.js";
import UK_STORY from "./uk-story.js";

const RU = { ...RU_STORY, ...RU_UI },
  UK = { ...UK_STORY, ...UK_UI }; // interface strings win on a clash

export const GAME_LANGS = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
];
const KEY = "ros-lang";
let lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return GAME_LANGS.some((l) => l.code === v) ? v : "en";
  } catch {
    return "en";
  }
})();
const subs = new Set();
export const gameLang = () => lang;
export function setGameLang(code) {
  if (!GAME_LANGS.some((l) => l.code === code) || code === lang) return;
  lang = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private mode: the choice lasts this session */
  }
  subs.forEach((f) => f());
}
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s);
export function tr(s, vars) {
  if (s == null || typeof s !== "string") return s;
  const L = gameLang();
  const d = L === "ru" ? RU : L === "uk" ? UK : null;
  return fill((d && d[s]) || s, vars);
}
// Subscribe a component to game-language changes (returns the current code).
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};
export function useGameLang() {
  return useSyncExternalStore(subscribe, gameLang, gameLang);
}
