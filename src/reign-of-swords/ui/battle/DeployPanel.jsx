import { tr } from "../../i18n/i18n.js";
import { base, UNIT_CATEGORY, CATEGORY_ORDER } from "../battle-ui.jsx";

// The muster (deployment phase): points and elite medals left, Fight, the mission goal and the roster by category.
// Tap a unit type, then a yellow tile on the board to place it (engine/deploy.js).
export function DeployPanel({ deploy, mission, onPick, onFight }) {
  return (
    <div className="ros-panel ros-deploy">
      <div className="ros-deploy-head">
        <span className="ros-deploy-title">{tr("Deploy your legion")}</span>
        <span className="ros-deploy-points">
          {tr("Points")} <b>{deploy ? deploy.budget - deploy.spent : 0}</b>
          <i> / {deploy ? deploy.budget : 0}</i>
        </span>
        {deploy && deploy.eliteMax > 0 && (
          <span
            className="ros-deploy-medals"
            title={tr("Elite units (marked with a medal) are limited to 1 per 1000 points of your budget")}
          >
            <img className="ros-deploy-medal-ico" src={base + "icons/medal.png"} alt={tr("Medals")} draggable="false" />
            <b>{Math.max(0, deploy.eliteMax - (deploy.eliteUsed || 0))}</b>
            <i> / {tr("{n} left", { n: deploy.eliteMax })}</i>
          </span>
        )}
        <div className="ros-deploy-btns">
          <button className="btn btn-primary" disabled={!deploy || deploy.placed === 0} onClick={onFight}>
            {tr("Fight")} ▸
          </button>
        </div>
      </div>
      {mission && mission.objectiveText && (
        <div className="ros-deploy-goal">
          🎯 <b>{tr("Goal:")}</b> {tr(mission.objectiveText)}
        </div>
      )}
      <div className="ros-roster">
        {deploy &&
          CATEGORY_ORDER.map((cat) => {
            const units = deploy.roster.filter((r) => (UNIT_CATEGORY[r.type] || "Infantry") === cat);
            if (cat === "Cavalry") units.reverse(); // cavalry reads best cheap→heavy (Raiders → Cavalry → Knights → Horse Bowmen)
            if (!units.length) return null;
            return (
              <div key={cat} className="ros-rost-group">
                <div className="ros-rost-cat">{tr(cat)}</div>
                <div className="ros-rost-cards">
                  {units.map((r) => (
                    <button
                      key={r.type}
                      className={"ros-rost" + (deploy.placing === r.type ? " sel" : "") + (r.affordable ? "" : " off")}
                      onClick={() => onPick(r.type)}
                    >
                      <img
                        className="ros-rost-icon"
                        src={base + "sprites/stand/" + r.type + ".png"}
                        alt=""
                        draggable="false"
                      />
                      <span className="ros-rost-name">
                        {tr(r.name)}
                        {r.elite ? (
                          <img
                            className="ros-rost-elite"
                            src={base + "icons/medal.png"}
                            alt={tr("Elite")}
                            title={tr("Elite — limited by your deployment budget (1 per 1000 points)")}
                            draggable="false"
                          />
                        ) : null}
                        {r.left != null ? <b className="ros-rost-left"> ×{r.left}</b> : null}
                      </span>
                      <span className="ros-rost-cost">{r.cost}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// The help under the muster: the deployment drill's steps on the training map, else the short how-to.
export function DeployHelp({ deploy, drill }) {
  if (drill)
    return (
      <div className="ros-hint ros-tut-tips">
        <b>📜 {tr("Captain's drill — deployment.")}</b>
        <ul>
          <li>{tr("Choose a unit type from the tray above, then tap a yellow formation block to place it.")}</li>
          <li>
            {tr(
              "Mind your points — each unit costs points; watch the Points counter. Place a unit on top of another to replace it and refund the old one.",
            )}
          </li>
          <li>{tr("Units can only go on yellow squares they could move to. Tap a placed unit to remove it.")}</li>
          <li>{tr("When your force is assembled, press Fight — that completes the drill.")}</li>
        </ul>
      </div>
    );
  return (
    <p className="ros-hint">
      <b>{tr("Deployment.")}</b>{" "}
      {tr(
        "Click a unit above, then place it in the yellow formation blocks. Click a placed unit to remove it and refund its cost. Click your Hero (★) to pick him up, then a yellow tile to reposition him.",
      )}{" "}
      <img className="ros-rost-elite" src={base + "icons/medal.png"} alt="" draggable="false" /> <b>{tr("Elite")}</b>:{" "}
      {tr("max {n}.", { n: deploy ? deploy.eliteMax : 1 })}{" "}
      {tr("Drag the map (or arrow keys) to scroll — watch the mini-map, top-right. When ready, press Fight.")}
    </p>
  );
}
