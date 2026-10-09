/* ============================================================
   Reign of Swords — carrying an army between the episodes (⚙ Settings → Army transfer).
   The two originals are separate apps with separate saves and no such feature: this is ours (user decision). An
   episode EXPORTS its army and collectibles to a small JSON file; the OTHER episode IMPORTS it, within limits, as a
   head start rather than a finished army. Battles won never carry over — each campaign is its own story.
   Pure functions only; the save hook (ui/shell/useCampaignSave.js) applies the result.
   ============================================================ */

import { ALL_TYPES, EP2_ORDER, COLLECTIBLES } from "./shell-data.js";

export const TRANSFER_KIND = "reign-of-swords-army";
export const TRANSFER_VERSION = 1;
// What comes across: at most PER_UNIT of each unit and UNITS in all (taken in roster order), and PER_SPOIL of each
// collectible (MEDALS Medals — they mark Major Victories).
export const TRANSFER_LIMITS = { perUnit: 6, units: 30, perSpoil: 3, medals: 1 };
// Episode II's own units reach Episode I as the unit they are upgraded from there (UPGRADE_FROM, record 5010:
// Footmen → Craftsmen, Halberdiers → Blood Gorgers, Shamans → Dune Sirens / Conjurer, Trebuchet → Ballistae).
// The Conjurer's Sapper and Bodyguard are summoned in battle, never owned, so they never travel.
export const EP1_FALLBACK = {
  craftsmen: "footmen",
  bloodgorgers: "halberdiers",
  dunesirens: "shamans",
  conjurer: "shamans",
  ballistae: "trebuchet",
};
const SUMMONED = new Set(["sapper", "bodyguard"]);

// The file an episode writes: its army and collectibles in hand.
export function makeTransfer({ ep2, army, spoils }) {
  const counts = (m, keys) => Object.fromEntries(keys.filter((k) => (m[k] | 0) > 0).map((k) => [k, m[k] | 0]));
  return {
    kind: TRANSFER_KIND,
    v: TRANSFER_VERSION,
    episode: ep2 ? 2 : 1,
    army: counts(army || {}, [...ALL_TYPES, ...EP2_ORDER]),
    spoils: counts(
      spoils || {},
      COLLECTIBLES.map((c) => c.id),
    ),
  };
}

// Read a file into this episode: { units, spoils, converted, capped } — or throw an Error whose message says why not.
export function readTransfer(data, { ep2 }) {
  if (!data || data.kind !== TRANSFER_KIND || typeof data.army !== "object" || data.army === null)
    throw new Error("This is not a Reign of Swords army file.");
  if ((data.episode === 2) === !!ep2)
    throw new Error(
      ep2
        ? "This army is from Episode II — import it in Episode I."
        : "This army is from Episode I — import it in Episode II.",
    );
  const L = TRANSFER_LIMITS;
  const roster = ep2 ? [...ALL_TYPES, ...EP2_ORDER] : ALL_TYPES;
  const wanted = {};
  let converted = false,
    capped = false;
  for (const [k, raw] of Object.entries(data.army)) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    if (!n || SUMMONED.has(k)) continue;
    const to = roster.includes(k) ? k : !ep2 && EP1_FALLBACK[k];
    if (!to) continue;
    if (to !== k) converted = true;
    wanted[to] = (wanted[to] || 0) + n;
  }
  const units = {};
  let room = L.units;
  for (const k of roster) {
    if (!wanted[k]) continue;
    const n = Math.min(wanted[k], L.perUnit, room);
    if (n < wanted[k]) capped = true;
    if (n > 0) units[k] = n;
    room -= n;
  }
  const spoils = {};
  for (const { id } of COLLECTIBLES) {
    const have = Math.max(0, Math.floor(Number((data.spoils || {})[id]) || 0));
    const n = Math.min(have, id === "Medal" ? L.medals : L.perSpoil);
    if (n < have) capped = true;
    if (n > 0) spoils[id] = n;
  }
  return { units, spoils, converted, capped };
}

// Re-importing REPLACES the earlier import's units, and tops collectibles up only to the most ever brought in, so
// carrying an army back and forth can't multiply it. `prev` = { units, granted } stored with the save.
export function applyTransfer(prev, incoming) {
  const granted = { ...((prev && prev.granted) || {}) },
    add = {};
  for (const [k, n] of Object.entries(incoming.spoils)) {
    const more = n - (granted[k] || 0);
    if (more > 0) {
      add[k] = more;
      granted[k] = n;
    }
  }
  return { stored: { units: { ...incoming.units }, granted }, addSpoils: add };
}
