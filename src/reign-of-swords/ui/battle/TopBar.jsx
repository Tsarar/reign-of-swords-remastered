import { tr } from "../../i18n/i18n.js";
import { base, GROUP_LABEL } from "../battle-ui.jsx";

const PHASE_LABEL = {
  deploy: "Deployment",
  player: "Your turn",
  ally: "Allied turn",
  enemy: "Enemy turn",
  victory: "Victory",
  defeat: "Defeat",
};

// The battle's top bar: the mission bar — the kingdom (or, in a skirmish, the battle picker) on the left, the
// 🐞 ♪ Next song ⚙ ◂ Menu buttons grouped on the right — above the HUD (unit counts, phase, turn, capture objective,
// escape counter, Medal standing).
export default function TopBar({
  state,
  campaign,
  missions,
  onChooseMission,
  onDebug,
  onNextSong,
  onSettings,
  onExit,
  medal,
  hotseat = false,
}) {
  const mission = state.mission;
  const hs = state.hotseat; // two players on one device: whose muster / turn it is
  const up = hs && (hs.handover || hs.active); // while the device is being passed, name the player taking it
  const phaseLabel =
    hs && state.phase === "player" && !(hs.handover && hs.handover.kind === "deploy")
      ? tr("{n}'s turn", { n: tr(up.name) })
      : hs && state.phase === "deploy"
        ? tr("{n} deploys", { n: tr(up.name) })
        : tr(PHASE_LABEL[state.phase]);
  const obj = state.objectives || { total: 0, held: 0, morale: false };
  const over = state.phase === "victory" || state.phase === "defeat";
  const buttons = (
    <>
      <button
        className="btn-run ros-menu-btn"
        onClick={onDebug}
        aria-label={tr("Debug")}
        title={
          tr("Debug") +
          " — " +
          tr("Copy a snapshot of this battle (units, turn, recent AI moves) to send with a bug report")
        }
      >
        🐞
      </button>
      <button
        className="btn-run ros-menu-btn ros-song-btn"
        onClick={onNextSong}
        aria-label={tr("Next song")}
        title={tr("Next song")}
      >
        <span className="ros-song-note" aria-hidden="true">
          {"♪︎"}
        </span>
        <span className="ros-song-txt">{tr("Next song")}</span>
        <span className="ros-song-skip" aria-hidden="true">
          ▸
        </span>
      </button>
      {onSettings && (
        <button
          className="btn-run ros-menu-btn"
          onClick={onSettings}
          title={tr("Settings")}
          aria-label={tr("Settings")}
        >
          ⚙
        </button>
      )}
    </>
  );
  return (
    <div className={"ros-topbar" + (campaign ? "" : " ros-topbar-skirmish")}>
      <div className="ros-mission-bar">
        <span className="ros-kingdom">
          {campaign ? (mission ? mission.kingdom : "") : hotseat ? tr("Hot-seat") : tr("Skirmish")}
        </span>
        {!campaign && (
          <label className="ros-mission-select">
            <span className="ros-ms-caret">⚔</span>
            <select
              value={mission ? mission.index : 0}
              onChange={(e) => onChooseMission(Number(e.target.value))}
              aria-label={tr("Choose battle")}
            >
              {(hotseat ? ["skirmish"] : ["story", "siege", "skirmish", "special"]).map((grp) => {
                const inGrp = missions.filter((mm) => mm.group === grp);
                if (!inGrp.length) return null;
                return (
                  <optgroup key={grp} label={tr(GROUP_LABEL[grp] || grp)}>
                    {inGrp.map((mm) => (
                      <option key={mm.index} value={mm.index}>
                        {mm.name} · {mm.cols}×{mm.rows}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
        )}
        {/* the buttons stay together on the right, in a campaign battle and a skirmish alike */}
        <span className="ros-menu-btns-top">
          {buttons}
          {(campaign || onExit) && (
            <button
              className="btn-run ros-menu-btn"
              onClick={() => onExit && onExit()}
              aria-label={tr("Menu")}
              title={tr("Menu")}
            >
              ◂ <span className="ros-menu-word">{tr("Menu")}</span>
            </button>
          )}
        </span>
      </div>
      <div className="ros-hud">
        <div className="ros-side ros-blue">
          <span className="ros-badge">{hs ? tr(hs.active.name) : tr("Your legion")}</span>
          <span className="ros-count">{state.blue}</span>
        </div>
        <div className="ros-vs">
          <span className={"ros-phase " + state.phase}>{phaseLabel}</span>
          <span className="ros-turn">
            {tr("Turn {n} / {max}", { n: Math.min(state.turn, state.turnLimit), max: state.turnLimit })}
          </span>
          {obj.total > 0 && (
            <span className="ros-obj">
              ⚑ {obj.held}/{obj.total}
              {obj.morale ? <b className="ros-morale"> ▲ {tr("morale")}</b> : null}
            </span>
          )}
          {state.escape && (
            <span
              className={"ros-escape" + (state.escape.lost >= state.escape.maxLost ? " ros-escape-warn" : "")}
              title={tr("Escaped units are safe. Lose more than {m} and the battle is lost.", {
                m: state.escape.maxLost,
              })}
            >
              {state.escape.goal ? tr("Escaped {n}", { n: state.escape.escaped }) + " · " : ""}
              {tr("Lost {n} / {m}", { n: state.escape.lost, m: state.escape.maxLost })}
            </span>
          )}
          {medal && !over && <MedalTrack medal={medal} />}
        </div>
        <div className="ros-side ros-red">
          <span className="ros-count">{state.red}</span>
          <span className="ros-badge">{hs ? tr(hs.waiting.name) : tr("Enemy")}</span>
        </div>
      </div>
    </div>
  );
}

// Raid HUD: the live Major-Victory standing — your army's strength (deploy cost x health, x1.25 holding the objective)
// as a share of the deploy budget, against the 40% a Medal needs (GameScreen::checkOutcome outcome 3).
function MedalTrack({ medal }) {
  // No deploy budget (a preset army, e.g. Carrone Raid): the 40% bar is 40% of 0, so any wipe-out is Major — say so
  // instead of drawing a bar that never moves.
  if (medal.pct == null) {
    return (
      <span
        className="ros-medal-track ok"
        title={tr(
          "This raid has no deploy budget, so destroying the whole enemy army is always a Major Victory — your losses don't matter.",
        )}
      >
        <img src={base + "icons/medal.png"} alt={tr("Medal")} draggable="false" />
        <b className="ros-mdl-any">{tr("Wipe them out")}</b>
      </span>
    );
  }
  const tip =
    tr(
      "Major Victory: destroy the whole enemy army while your surviving army's strength (deploy cost × health) is at least 40% of your deploy budget to win a Medal.",
    ) +
    " " +
    tr("Strength {s} / {b} (need {n}).", { s: medal.strength, b: medal.budget, n: medal.need }) +
    (medal.hold ? " " + tr("Holding the objective: +25% strength.") : "");
  return (
    <span className={"ros-medal-track" + (medal.ok ? " ok" : " low")} title={tip}>
      <img src={base + "icons/medal.png"} alt={tr("Medal")} draggable="false" />
      <span className="ros-mdl-bar">
        <i style={{ width: Math.min(100, medal.pct) + "%" }} />
        <em style={{ left: "40%" }} />
      </span>
      <b>{medal.pct + "%"}</b>
    </span>
  );
}
