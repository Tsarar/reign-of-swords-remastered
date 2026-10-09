import { UNIT_META } from "../../data/shell-data.js";
import { tr } from "../../i18n/i18n.js";
import { UnitSprite, SvgIcon, ResIcon } from "./common.jsx";

// ---- Spoils screen shown after a victory: the REAL units + collectibles that battle awarded ----
export function RewardScreen({ reward, onDone }) {
  const units = Object.entries(reward.units || {}).filter(([, n]) => n > 0);
  const spoils = Object.entries(reward.spoils || {}).filter(([, n]) => n > 0);
  return (
    <div className="ros-cutscene ros-reward-screen" onClick={onDone}>
      <div className="ros-reward" onClick={(e) => e.stopPropagation()}>
        <div className="ros-reward-head">
          <SvgIcon name="star" /> {tr("Spoils of Victory")}
        </div>
        {reward.name ? <div className="ros-reward-sub">{tr(reward.name)}</div> : null}
        {units.length > 0 && (
          <div className="ros-reward-grp">
            <div className="ros-reward-label">{tr("Troops joined your army")}</div>
            <div className="ros-reward-items">
              {units.map(([k, n]) => (
                <span key={k} className="ros-reward-item ros-reward-unit">
                  {UNIT_META[k] ? <UnitSprite unit={k} size={30} framed={false} /> : null}
                  <b>+{n}</b> {tr((UNIT_META[k] || {}).name || k)}
                </span>
              ))}
            </div>
          </div>
        )}
        {spoils.length > 0 && (
          <div className="ros-reward-grp">
            <div className="ros-reward-label">
              {tr("Collectibles won")} <i>({tr("spend on upgrades")})</i>
            </div>
            <div className="ros-reward-items">
              {spoils.map(([k, n]) => (
                <span key={k} className="ros-reward-item">
                  <ResIcon id={k} size={22} /> <b>+{n}</b> {tr(k)}
                </span>
              ))}
            </div>
          </div>
        )}
        {(reward.unlocked || []).map((k) => (
          // Episode II: this battle opened a new unit's upgrade (the original's strings 800–804)
          <div key={k} className="ros-reward-grp ros-reward-unlock">
            {UNIT_META[k] ? <UnitSprite unit={k} size={30} framed={false} /> : null}
            <span>
              {tr(
                "Congratulations! The ability to upgrade units to {u} has been unlocked. Visit the Upgrade Army screen to check possible upgrades.",
                { u: tr((UNIT_META[k] || {}).name || k) },
              )}
            </span>
          </div>
        ))}
        <button className="btn btn-primary" onClick={onDone}>
          {tr("Continue")} ▸
        </button>
      </div>
    </div>
  );
}
