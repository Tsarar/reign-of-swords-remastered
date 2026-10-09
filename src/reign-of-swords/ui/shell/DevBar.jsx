// The developer bar above the game (English only — it's a tool, not part of the game): jump into any battle, set
// campaign progress, field the "god army", grant collectibles, wipe the save, mute music / effects. Collapsed it is
// a small "🛠 Dev ▸" pill.
const GROUPS = { story: "Campaign", siege: "Raids", skirmish: "Battlefields", special: "Tutorials" };

export default function DevBar({
  open,
  onOpen,
  onClose,
  inBattle,
  levels,
  camp,
  onJump,
  onSetProgress,
  godArmy,
  onToggleGodArmy,
  onGiveResources,
  onHardReset,
  musicMuted,
  onToggleMusic,
  sfxMuted,
  onToggleSfx,
}) {
  const where = inBattle ? " ros-admin-battle" : "";
  if (!open)
    return (
      <div className={"ros-admin-collapsed" + where}>
        <button
          className="btn-run ros-dev-show"
          onClick={onOpen}
          title="Show developer tools (jump to battle, set progress, god army, reset, sound)"
        >
          🛠 Dev ▸
        </button>
      </div>
    );
  return (
    <div className={"ros-admin" + where}>
      <span className="ros-admin-tag">🛠 Dev</span>
      <select
        className="ros-admin-sel"
        defaultValue=""
        onChange={(e) => {
          onJump(e.target.value);
          e.target.value = "";
        }}
        aria-label="Jump to any battle"
      >
        <option value="">Jump to any battle…</option>
        {Object.entries(GROUPS).map(([grp, label]) => {
          const inGrp = levels.filter((l) => l.group === grp);
          if (!inGrp.length) return null;
          return (
            <optgroup key={grp} label={label}>
              {inGrp.map((l) => (
                <option key={l.mapId} value={l.mapId}>
                  {l.kingdom ? l.kingdom + " · " : ""}
                  {l.name} ({l.cols}×{l.rows})
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <select
        className="ros-admin-sel"
        defaultValue=""
        onChange={(e) => {
          onSetProgress(e.target.value);
          e.target.value = "";
        }}
        aria-label="Set campaign progress to a level"
        title="Set real campaign progress: the chosen mission becomes the next to play (all earlier ones counted done, army & rewards accumulated)"
      >
        <option value="">Set progress to…</option>
        {camp.kingdoms.map((kd) => (
          <optgroup key={kd.id} label={kd.name.replace("Kingdom of ", "")}>
            {kd.missions.map((mis, mi) => (
              <option key={mis.mapId} value={mis.mapId}>
                {mi + 1}. {mis.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        className={"btn-run ros-admin-god" + (godArmy ? " on" : "")}
        onClick={onToggleGodArmy}
        title="DEV: field a full max army (30 of every unit, all elites) in campaign battles so you can steam-roll any fight. Toggle off to play with your real army."
      >
        {godArmy ? "⚡ God army ON" : "⚡ God army"}
      </button>
      <button
        className="btn-run"
        onClick={onGiveResources}
        title="DEV: grant +20 of every upgrade collectible (Armor/Weapons/Beasts/Spirit/Lore/Medal) to test the Upgrade Army screen"
      >
        🎁 Give resources
      </button>
      <button
        className="btn-run ros-admin-reset"
        onClick={onHardReset}
        title="Wipe ALL progress, army, spoils & settings — start fresh"
      >
        ↺ Hard reset
      </button>
      <button
        className="btn-run ros-sound-btn"
        onClick={onToggleMusic}
        title={musicMuted ? "Music off — click to enable" : "Music on — click to mute"}
      >
        {musicMuted ? "🔕 Music off" : "🎵 Music"}
      </button>
      <button
        className="btn-run ros-sound-btn"
        onClick={onToggleSfx}
        title={sfxMuted ? "Effects off — click to enable" : "Effects on — click to mute"}
      >
        {sfxMuted ? "🔇 Effects off" : "🔊 Effects"}
      </button>
      <button
        className="btn-run ros-dev-hide"
        onClick={onClose}
        title="Hide developer tools"
        aria-label="Hide developer tools"
      >
        ✕
      </button>
    </div>
  );
}
