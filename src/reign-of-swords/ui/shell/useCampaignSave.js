import { useEffect, useState } from "react";
import {
  PROGRESS_KEY,
  DELTA_KEY,
  SPOILS_KEY,
  LOSS_KEY,
  MEDAL_RAIDS_KEY,
  TRANSFER_KEY,
  epKey,
  loadProgress,
  saveProgress,
  jload,
  jsave,
  STARTER_ARMY,
  STARTER_SPOILS,
  COLLECTIBLES,
  MERCHANT_PRICE,
  MILITIA_PRICE,
  MAX_HELD,
  combineCounts,
  drawReward,
  UNIT_META,
  upgradeGate,
} from "../../data/shell-data.js";
import { makeTransfer, readTransfer, applyTransfer } from "../../data/save-transfer.js";

// The campaign save, one per episode (localStorage): which battles are won (`progress`, a Set of map ids), the army
// changes made in camp (`upDelta`: upgrades, recruits, extra raid units) and the collectibles in hand (`spoils`).
// The army itself is DERIVED, never stored — see armyOf. Everything that spends or earns goes through here.
export function useCampaignSave({ isEp2, rewards, playSfx }) {
  const [progress, setProgress] = useState(() => loadProgress(isEp2));
  const [upDelta, setUpDelta] = useState(() => jload(epKey(DELTA_KEY, isEp2), {}));
  const [spoils, setSpoils] = useState(() => jload(epKey(SPOILS_KEY, isEp2), STARTER_SPOILS));
  // the raids won with a Major Victory at least once (their row in the war plans shows the Medal)
  const [medalRaids, setMedalRaids] = useState(() => {
    const saved = jload(epKey(MEDAL_RAIDS_KEY, isEp2), []);
    return new Set(Array.isArray(saved) ? saved : []);
  });
  // The army brought in from the other episode: its units (replaced by each import) and the collectibles granted so far.
  const [transfer, setTransfer] = useState(() => jload(epKey(TRANSFER_KEY, isEp2), { units: {}, granted: {} }));
  // Save on change. `isEp2` is fixed for the life of the shell (each episode is its own page), and saving on an
  // episode switch would write this episode's state under the other one's key.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => jsave(epKey(DELTA_KEY, isEp2), upDelta), [upDelta]);
  useEffect(() => jsave(epKey(SPOILS_KEY, isEp2), spoils), [spoils]);
  useEffect(() => jsave(epKey(MEDAL_RAIDS_KEY, isEp2), [...medalRaids]), [medalRaids]);
  useEffect(() => jsave(epKey(TRANSFER_KEY, isEp2), transfer), [transfer]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Your ARMY = the starter force (empty in the original, La/r.e()) + the REAL unit rewards (rewards.json) of every
  // battle you've won + your camp changes — nothing else, per the original's own rules: help 748 "SPOILS: Completing
  // a battle rewards the victor with the spoils of war…", and help 751 "UNITS LOST: In online battles, some units in
  // the losing army that are slain in battle are permanently lost" — so a mission's fixed force never joins the roster
  // and campaign / raid casualties are not permanent. Heroes stack like any unit (no one-Hero cap in the original).
  const armyOf = () => {
    const parts = [STARTER_ARMY];
    for (const mapId of progress) {
      const reward = rewards[mapId];
      if (reward && reward.units) parts.push(reward.units);
    }
    return combineCounts(...parts, transfer.units || {}, upDelta);
  };
  const addUnits = (units) =>
    setUpDelta((delta) => {
      const next = { ...delta };
      for (const [k, count] of Object.entries(units)) next[k] = (next[k] || 0) + count;
      return next;
    });
  const addSpoils = (gained) =>
    setSpoils((prev) => {
      const next = { ...prev };
      for (const [k, count] of Object.entries(gained)) next[k] = (next[k] || 0) + count;
      return next;
    });

  // Upgrade Army: one unit of `name` becomes one `toKey`, spending one `need` collectible. Episode I has none of
  // Episode II's units; in Episode II five of them wait on a story battle (upgradeGate).
  const upgradeUnit = (name, toKey, need, n = 1) => {
    const army = armyOf();
    if (n < 1 || (army[name] || 0) < n || (spoils[need] || 0) < n || (army[toKey] || 0) + n > MAX_HELD) return;
    const gate = upgradeGate(toKey, isEp2);
    if ((!isEp2 && (UNIT_META[toKey] || {}).ep2) || (gate && !progress.has(gate))) return;
    setUpDelta((d) => ({ ...d, [name]: (d[name] || 0) - n, [toKey]: (d[toKey] || 0) + n }));
    setSpoils((s) => ({ ...s, [need]: (s[need] || 0) - n }));
    playSfx("upgrade", 0.5);
  };
  // A battle's collectibles — its fixed reward, or the `won` draw of a random one (rollReward).
  const grantMissionReward = (mapId, drawn) => {
    const reward = drawn || rewards[mapId];
    if (reward && reward.spoils) addSpoils(reward.spoils);
  };
  // RANDOM rewards (the record's q flag — Ep2's three "Raid 3" maps): GameScreen::createRewardsMenu draws `pick`
  // DISTINCT entries from the whole pool on every win. Returns the {units, spoils} actually won; a fixed reward as is.
  const rollReward = (mapId) => {
    const reward = rewards[mapId],
      drawn = drawReward(reward);
    if (drawn && drawn.drawn)
      console.info(
        `[ROS roll] Reward — map ${mapId}: drew ${drawn.drawn.join(" + ")} (${reward.pick} of ` +
          reward.pool.map((e) => e.unit || e.spoil).join(", ") +
          ")",
      );
    return drawn;
  };
  // The Merchant (strings 248/249/676, popup 61): n collectibles for MERCHANT_PRICE × n of another kind, or n
  // Militiamen for n each of MILITIA_PRICE; never past MAX_HELD. Medals can't be bought (only won from Major Victories).
  const merchantTrade = (from, wanted, n = 1) => {
    const cost = MERCHANT_PRICE * n;
    if (n < 1 || from === wanted || wanted === "Medal" || (spoils[from] || 0) < cost) return;
    if ((spoils[wanted] || 0) + n > MAX_HELD) return;
    setSpoils((s) => ({ ...s, [from]: (s[from] || 0) - cost, [wanted]: (s[wanted] || 0) + n }));
    playSfx("coins", 0.5);
  };
  const merchantRecruit = (n = 1) => {
    if (n < 1 || MILITIA_PRICE.some((c) => (spoils[c] || 0) < n) || (armyOf().militiamen || 0) + n > MAX_HELD) return;
    setSpoils((s) => {
      const next = { ...s };
      for (const c of MILITIA_PRICE) next[c] = (next[c] || 0) - n;
      return next;
    });
    setUpDelta((d) => ({ ...d, militiamen: (d.militiamen || 0) + n }));
    playSfx("coins", 0.5);
  };

  const markDone = (mapId) =>
    setProgress((prev) => {
      const next = new Set(prev);
      next.add(mapId);
      saveProgress(next, isEp2);
      return next;
    });
  const markMedalRaid = (mapId) => setMedalRaids((prev) => (prev.has(mapId) ? prev : new Set([...prev, mapId])));
  const replaceProgress = (next) => {
    setProgress(next);
    saveProgress(next, isEp2);
  };
  // ARMY TRANSFER between the episodes (⚙ Settings): this episode's army as a file for the other one, and a file from
  // the other one read in within data/save-transfer.js's limits. Returns what came across; throws on a wrong file.
  const exportArmy = () => makeTransfer({ ep2: isEp2, army: armyOf(), spoils });
  const importArmy = (data) => {
    const incoming = readTransfer(data, { ep2: isEp2 });
    const { stored, addSpoils: more } = applyTransfer(transfer, incoming);
    setTransfer(stored);
    if (Object.keys(more).length) addSpoils(more);
    return incoming;
  };
  // DEV: +20 of every upgrade collectible.
  const giveResources = () => addSpoils(Object.fromEntries(COLLECTIBLES.map((c) => [c.id, 20])));
  // Wipe this episode's save (the keys go, the state returns to a fresh campaign) — with the kept musters
  // (ui/ReignOfSwords.jsx).
  const resetSave = () => {
    const keys = [PROGRESS_KEY, DELTA_KEY, SPOILS_KEY, LOSS_KEY, MEDAL_RAIDS_KEY, TRANSFER_KEY, "ros-setup-v1"];
    for (const k of keys.map((k) => epKey(k, isEp2))) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    }
    setProgress(new Set());
    setUpDelta({});
    setSpoils({ ...STARTER_SPOILS });
    setMedalRaids(new Set());
    setTransfer({ units: {}, granted: {} });
  };

  return {
    progress,
    spoils,
    medalRaids,
    armyOf,
    addUnits,
    addSpoils,
    upgradeUnit,
    grantMissionReward,
    rollReward,
    merchantTrade,
    merchantRecruit,
    markDone,
    markMedalRaid,
    replaceProgress,
    exportArmy,
    importArmy,
    giveResources,
    resetSave,
  };
}
