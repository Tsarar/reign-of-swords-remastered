/* ============================================================
   Reign of Swords — campaign unlock rules (pure functions).
   `camp` is campaign.json ({ kingdoms: [{ name, missions: [{ mapId }], unlockAfter }] }),
   `progress` the Set of map ids already won, `levels` the level list (levels.json).
   ============================================================ */

const shortName = (kd) => kd.name.replace("Kingdom of ", "");

// Every story battle of the kingdom is won.
export const kingdomComplete = (kd, progress) => !!kd && kd.missions.every((m) => progress.has(m.mapId));

// The world map is a BRANCHING tree: a kingdom opens once EVERY kingdom in its `unlockAfter` list is complete, so
// Carrone opens both Bordavia and Merovin. The original (MenuScreen::selectKingdom, iOS Ep1 @0x38f38 / Ep2 @0x44344)
// gives each kingdom one prerequisite and checks that its third story battle is won; the battles go in order, so
// that is the same as "complete". A kingdom without `unlockAfter` data falls back to "the previous kingdom is
// complete".
export function kingdomUnlocked(camp, kingdomIdx, progress) {
  if (!camp) return false;
  const kingdom = camp.kingdoms[kingdomIdx];
  const prereqs = kingdom && kingdom.unlockAfter;
  if (!prereqs) return kingdomIdx === 0 || kingdomComplete(camp.kingdoms[kingdomIdx - 1], progress);
  if (!prereqs.length) return true; // a root (Carrone)
  return prereqs.every((name) =>
    kingdomComplete(
      camp.kingdoms.find((k) => shortName(k) === name),
      progress,
    ),
  );
}

// A kingdom's battles are fought in order.
export function missionUnlocked(camp, kingdomIdx, missionIdx, progress) {
  if (!kingdomUnlocked(camp, kingdomIdx, progress)) return false;
  if (missionIdx === 0) return true;
  return progress.has(camp.kingdoms[kingdomIdx].missions[missionIdx - 1].mapId);
}

// A kingdom's optional RAIDS ("siege" levels of that kingdom), in map order.
export function kingdomRaids(levels, kingdom) {
  const name = shortName(kingdom);
  return (levels || [])
    .filter((l) => l.group === "siege" && l.kingdom === name && !l.hidden)
    .sort((a, b) => a.mapId - b.mapId);
}

// The story battle that opens a raid. Raids open as the kingdom's story advances, not one after another
// (MenuScreen::initMenuState — iOS Ep1 @0x45d7e, Ep2 @0x51ea6 / @0x5201c; Android a_m): raid i once story battle i is
// won; Carrone's single raid once its last story battle is won; in Episode II's Eastern kingdoms (index 8 and up)
// raid i once story battle i + 1 is won.
export function raidGate(camp, kingdomIdx, raidIdx) {
  const kingdom = camp && camp.kingdoms[kingdomIdx];
  if (!kingdom) return null;
  const order = kingdom.order ?? kingdomIdx;
  const storyIdx = order === 0 ? kingdom.missions.length - 1 : order >= 8 ? raidIdx + 1 : raidIdx;
  return kingdom.missions[storyIdx] || null;
}

export function raidUnlocked(camp, kingdomIdx, raidIdx, progress) {
  const gate = raidGate(camp, kingdomIdx, raidIdx);
  return !!gate && kingdomUnlocked(camp, kingdomIdx, progress) && progress.has(gate.mapId);
}

// DEV "set progress": the chosen story battle becomes the NEXT one to play — every battle before it (campaign order)
// counts as won, and so does every raid whose story battle is won by then. An unknown id marks it all won.
export function progressBefore(camp, levels, mapId) {
  const order = [];
  for (const kingdom of camp.kingdoms) for (const mission of kingdom.missions) order.push(mission.mapId);
  const cut = order.indexOf(mapId);
  const next = new Set(cut < 0 ? order : order.slice(0, cut));
  camp.kingdoms.forEach((kingdom, kingdomIdx) =>
    kingdomRaids(levels, kingdom).forEach((raid, raidIdx) => {
      const gate = raidGate(camp, kingdomIdx, raidIdx);
      if (gate && next.has(gate.mapId)) next.add(raid.mapId);
    }),
  );
  return next;
}
