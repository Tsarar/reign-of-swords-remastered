import { useEffect, useState } from "react";
import { levelTitle } from "../../data/game-data.js";

// The campaign shell's data, loaded from the EPISODE's own folder (so the Episode II route shows Episode II's
// campaign): the world map's kingdoms and missions, the in-battle dialogue table, the level list (for raids, previews
// and the dev jump menu) and each mission's real spoils. `camp` stays null until it has loaded; a missing optional
// file just leaves its default.
export function useEpisodeData(dataBase) {
  const [camp, setCamp] = useState(null); // campaign.json
  const [battleEvents, setBattleEvents] = useState(null); // battle_events.json — per-map in-battle dialogue
  const [levels, setLevels] = useState([]); // levels.json — every map (hidden ones left out)
  const [rewards, setRewards] = useState({}); // rewards.json — per-mission spoils, from the scenario records
  useEffect(() => {
    fetch(dataBase + "campaign.json")
      .then((r) => r.json())
      .then(setCamp)
      .catch(() => setCamp({ kingdoms: [] }));
    fetch(dataBase + "battle_events.json")
      .then((r) => r.json())
      .then(setBattleEvents)
      .catch(() => {});
    fetch(dataBase + "levels.json")
      .then((r) => r.json())
      .then((d) => setLevels((d.levels || []).filter((l) => !l.hidden).map((l) => ({ ...l, name: levelTitle(l) }))))
      .catch(() => {});
    fetch(dataBase + "rewards.json")
      .then((r) => r.json())
      .then(setRewards)
      .catch(() => {});
  }, [dataBase]);
  return { camp, battleEvents, levels, rewards };
}
