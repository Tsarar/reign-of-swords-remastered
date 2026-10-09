import { tr } from "../../i18n/i18n.js";
import { UNIT_META } from "../../data/shell-data.js";
import { UnitSprite, ResIcon } from "./common.jsx";

// The mission type by the record's header type, in the original's own words (the Objective screen's "Mission Type:"
// strings): 0 eliminate the enemy, 1 capture (hold the areas), 2 conquer (take the enemy's areas), 3 escape.
const MISSION_TYPE = { 0: "Eliminate", 1: "Capture", 2: "Conquer", 3: "Escape" };
const missionType = (level) => tr(MISSION_TYPE[level.missionType || 0] || "Eliminate");

// The pre-battle brief of a story mission (the game's own Objective screen): mission type, turn limit, objective.
export function MissionPreview({ title, level, onStart, onBack }) {
  return (
    <div className="ros-overlay ros-overlay-fixed" onClick={onBack}>
      <div className="ros-overlay-card ros-mission-preview" onClick={(e) => e.stopPropagation()}>
        <p className="ros-brief-kingdom">{tr("Objective")}</p>
        <h2>{tr(title)}</h2>
        <div className="ros-preview-info">
          <div>
            <span>{tr("Mission Type")}</span>
            <b>{missionType(level)}</b>
          </div>
          <div>
            <span>{tr("Turn Limit")}</span>
            <b>{level.turnLimit || 30}</b>
          </div>
        </div>
        <p className="ros-brief-obj">
          <b>{tr("Objective.")}</b> {tr(level.objectiveText || "Destroy the opponent's army.")}
        </p>
        <div className="ros-preview-btns">
          <button className="btn btn-primary" onClick={onStart}>
            {tr("Start Mission")} ▸
          </button>
          <button className="btn-run" onClick={onBack}>
            ◂ {tr("Back")}
          </button>
        </div>
      </div>
    </div>
  );
}

// A raid's brief, shown before you commit: mission info, the spoils on victory (fixed, or the random pool) and the
// Major Victory Medal condition.
export function RaidPreview({ level, reward, cleared, onBegin, onBack }) {
  const spoilsList = reward
    ? [
        ...(reward.units ? Object.entries(reward.units).map(([k, v]) => `${v}× ${k}`) : []),
        ...(reward.spoils ? Object.entries(reward.spoils).map(([k, v]) => `${v}× ${k}`) : []),
      ]
    : [];
  return (
    <div className="ros-overlay ros-overlay-fixed" onClick={onBack}>
      <div className="ros-overlay-card ros-mission-preview" onClick={(e) => e.stopPropagation()}>
        <p className="ros-brief-kingdom">
          {tr("Raid")}
          {cleared ? " · " + tr("cleared") : ""}
        </p>
        <h2>{level.name || tr("Raid")}</h2>
        <div className="ros-preview-info">
          <div>
            <span>{tr("Mission Type")}</span>
            <b>{missionType(level)}</b>
          </div>
          <div>
            <span>{tr("Turn Limit")}</span>
            <b>{level.turnLimit || 30}</b>
          </div>
          <div>
            <span>{tr("Enemy Force")}</span>
            <b>{tr("{n} units", { n: (level.enemy || []).length })}</b>
          </div>
        </div>
        <p className="ros-brief-obj">
          <b>{tr("Objective.")}</b> {tr(level.objectiveText || "Destroy the opponent's army.")}
        </p>
        <div className="ros-preview-spoils">
          <div className="ros-reward-label">{tr("Spoils on victory")}</div>
          <div className="ros-reward-items">
            {reward &&
              reward.units &&
              Object.entries(reward.units)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <span key={"u" + k} className="ros-reward-item ros-reward-unit">
                    <UnitSprite unit={k} size={26} framed={false} />
                    <b>+{n}</b> {tr((UNIT_META[k] || {}).name || k)}
                  </span>
                ))}
            {reward &&
              reward.spoils &&
              Object.entries(reward.spoils)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <span key={"s" + k} className="ros-reward-item">
                    <ResIcon id={k} size={22} /> <b>+{n}</b> {tr(k)}
                  </span>
                ))}
            {reward && reward.random && reward.pool && (
              <>
                <span className="ros-reward-item ros-reward-none">
                  {tr("{n} of these, drawn at random on each win:", { n: reward.pick })}
                </span>
                {reward.pool.map((e, i) =>
                  e.unit ? (
                    <span key={"p" + i} className="ros-reward-item ros-reward-unit">
                      <UnitSprite unit={e.unit} size={26} framed={false} />
                      {tr((UNIT_META[e.unit] || {}).name || e.unit)}
                    </span>
                  ) : (
                    <span key={"p" + i} className="ros-reward-item">
                      <ResIcon id={e.spoil} size={22} /> {tr(e.spoil)}
                    </span>
                  ),
                )}
              </>
            )}
            {!spoilsList.length && !(reward && reward.random) && (
              <span className="ros-reward-item ros-reward-none">{tr("Spoils of war on victory.")}</span>
            )}
          </div>
          <div className="ros-preview-medal">
            <ResIcon id="Medal" size={30} />
            <div>
              <b>{tr("Major Victory: +1 Medal")}</b>
              <span>
                {(level.playerBudget || 0) > 0
                  ? tr(
                      "Destroy the whole enemy army while your surviving army's strength (cost × health) stays at {n} or more — 40% of your {b} deploy points.",
                      { n: Math.round(level.playerBudget * 0.4), b: level.playerBudget },
                    )
                  : tr("Destroy the whole enemy army — with no deploy budget, every such win is a Major Victory.")}
              </span>
            </div>
          </div>
          <i className="ros-preview-note">
            {tr("Fought with your own army — raids can be replayed for their spoils and Medals.")}
          </i>
        </div>
        <div className="ros-preview-btns">
          <button className="btn btn-primary" onClick={onBegin}>
            {tr("Begin Raid")} ▸
          </button>
          <button className="btn-run" onClick={onBack}>
            ◂ {tr("Back")}
          </button>
        </div>
      </div>
    </div>
  );
}

// "Online Battles": the original's servers are long gone, so this explains that — and offers the same head-to-head
// battle for two players on one device (hot-seat) instead of matchmaking.
export function OnlineNotice({ text, onClose, onHotseat }) {
  return (
    <div className="ros-overlay ros-overlay-fixed ros-overlay-top" onClick={onClose}>
      <div className="ros-overlay-card ros-mp-card" onClick={(e) => e.stopPropagation()}>
        <h2>⚔ {tr("Online Battles")}</h2>
        <p>{tr(text || "Online Battles are fought against other players on the game server.")}</p>
        <p className="ros-mp-note">
          <b>{tr("Offline demo.")}</b>{" "}
          {tr(
            "The original's live matchmaking servers are long gone — play head-to-head on one device instead: two players take turns on the same screen.",
          )}
        </p>
        <div className="ros-over-btns">
          {onHotseat && (
            <button className="btn btn-primary" onClick={onHotseat}>
              ⚔ {tr("Hot-seat — 2 players")}
            </button>
          )}
          <button className="btn-run" onClick={onClose}>
            {tr("Back")}
          </button>
        </div>
      </div>
    </div>
  );
}
