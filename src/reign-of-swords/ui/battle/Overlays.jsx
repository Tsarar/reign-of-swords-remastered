import { tr } from "../../i18n/i18n.js";
import { base } from "../battle-ui.jsx";
import { HelpScreen } from "../shell/FieldManual.jsx";
import { subName } from "../../data/shell-data.js";
import { ReportBugLinks } from "../shell/ReportBug.jsx";

// The battle's popovers. Each is a card over the battlefield; clicking outside a dismissable one closes it.

// A popover shell: the dimmed backdrop (closes on click when `onClose` is given) and the card.
function Overlay({ className = "", cardClass = "", onClose, children }) {
  return (
    <div className={"ros-overlay" + (className ? " " + className : "")} onClick={onClose}>
      <div
        className={"ros-overlay-card" + (cardClass ? " " + cardClass : "")}
        onClick={onClose ? (e) => e.stopPropagation() : undefined}
      >
        {children}
      </div>
    </div>
  );
}

// A skirmish battle's briefing (campaign battles get the story cutscene instead).
export function Briefing({ mission, onMarch }) {
  return (
    <Overlay className="briefing" cardClass="ros-briefing">
      <p className="ros-brief-kingdom">{tr(mission.kingdom)}</p>
      <h2>{tr(mission.name)}</h2>
      {mission.subtitle && <p className="ros-brief-sub">{tr(mission.subtitle)}</p>}
      <p className="ros-brief-text">{mission.briefing}</p>
      <p className="ros-brief-obj">
        <b>{tr("Objective.")}</b> {tr(mission.objectiveText)}
      </p>
      <button className="btn btn-primary" onClick={onMarch}>
        {tr("March")} ▸
      </button>
    </Overlay>
  );
}

// 🎯 Objectives: the goal and the battle's standing (turn, capture points, morale, armies, the Medal).
export function ObjectivesCard({ state, medal, onClose }) {
  const mission = state.mission;
  const obj = state.objectives || { total: 0, held: 0, morale: false };
  return (
    <Overlay cardClass="ros-objectives" onClose={onClose}>
      <p className="ros-brief-kingdom">{mission ? mission.kingdom : ""}</p>
      <h2>{mission ? mission.name : tr("Objectives")}</h2>
      <p className="ros-brief-obj">
        <b>{tr("Objective.")}</b> {mission ? tr(mission.objectiveText) : ""}
      </p>
      <div className="ros-obj-stats">
        <span>
          {tr("Turn")} <b>{Math.min(state.turn, state.turnLimit)}</b> / {state.turnLimit}
        </span>
        {obj.total > 0 && (
          <span>
            {tr("Points held")} <b>{obj.held}</b> / {obj.total}
          </span>
        )}
        {obj.total > 0 && (
          <span className={obj.morale ? "ros-obj-good" : ""}>
            {tr("Morale")} {obj.morale ? "✓ " + tr("yours") : "— " + tr("contested")}
          </span>
        )}
        <span>
          {state.hotseat ? tr(state.hotseat.active.name) : tr("Your legion")} <b>{state.blue}</b> ·{" "}
          {state.hotseat ? tr(state.hotseat.waiting.name) : tr("Enemy")} <b>{state.red}</b>
        </span>
        {medal && (
          <span className={"ros-obj-medal" + (medal.ok ? " ros-obj-good" : "")}>
            <img src={base + "icons/medal.png"} alt="" draggable="false" />
            <span>
              {tr("Major Victory")} {medal.pct == null ? "✓" : <b>{medal.pct}% / 40%</b>}
              <small>
                {medal.pct == null
                  ? tr(
                      "This raid has no deploy budget, so destroying the whole enemy army is always a Major Victory — your losses don't matter.",
                    )
                  : tr(
                      "Destroy the whole enemy army while your surviving army's strength (deploy cost × health) is at least 40% of your deploy budget to win a Medal.",
                    )}
                {medal.pct != null && medal.hold ? " " + tr("Holding the objective: +25% strength.") : ""}
              </small>
            </span>
          </span>
        )}
      </div>
      <button className="btn btn-primary" onClick={onClose}>
        {tr("Return to Battle")} ▸
      </button>
    </Overlay>
  );
}

// 📖 The original game's own manual (help.json), the same screen as the main menu's Field Manual. It opens over the
// whole screen, not just the board — on a phone the board is too small to read a manual in.
export function ManualModal({ ep2: isEp2, onClose }) {
  return (
    <Overlay className="ros-overlay-fixed ros-overlay-top" cardClass="ros-help-modal" onClose={onClose}>
      <HelpScreen onBack={onClose} ep2={isEp2} backLabel={"◂ " + tr("Back to battle")} />
    </Overlay>
  );
}

// 🐞 The bug-report snapshot (engine/debug.js), copied to the clipboard — shown too, in case the clipboard is blocked.
export function DebugCard({ text, copied, onCopy, onClose }) {
  return (
    <Overlay cardClass="ros-dbg-card" onClose={onClose}>
      <h2>🐞 {tr("Debug snapshot")}</h2>
      <p>
        {copied
          ? tr("Copied to the clipboard — paste it into a bug report with a few words about what looks wrong:")
          : tr("Copy this text and paste it into a bug report with a few words about what looks wrong:")}{" "}
        <ReportBugLinks />
      </p>
      <textarea className="ros-dbg-text" readOnly value={text} onFocus={(e) => e.target.select()} />
      <div className="ros-over-btns">
        <button className="btn btn-primary" onClick={onCopy}>
          {tr("Copy")}
        </button>
        <button className="btn-run" onClick={onClose}>
          {tr("Close")}
        </button>
      </div>
    </Overlay>
  );
}

// "End Turn?" while some of your units haven't acted.
export function ConfirmEndTurn({ unmoved, onEnd, onCancel }) {
  return (
    <Overlay onClose={onCancel}>
      <h2>{tr("End Turn?")}</h2>
      <p>
        {tr("Units that have not yet moved or attacked: {n}. Are you sure you wish to end your turn?", {
          n: unmoved,
        })}
      </p>
      <div className="ros-over-btns">
        <button className="btn btn-primary" onClick={onEnd}>
          {tr("End Turn")} ▸
        </button>
        <button className="btn-run" onClick={onCancel}>
          {tr("Keep Playing")}
        </button>
      </div>
    </Overlay>
  );
}

// "Complete" with 100 or more deployment points left (the original's warning - GameScreen::onSendRaidClicked).
export function ConfirmUnspent({ onFight, onBack }) {
  return (
    <Overlay onClose={onBack}>
      <p>
        {tr(
          "You have not fully utilized your deployment points. Victory will certainly be more challenging. Continue?",
        )}
      </p>
      <div className="ros-over-btns">
        <button className="btn btn-primary" onClick={onFight}>
          {tr("Yes")}
        </button>
        <button className="btn-run" onClick={onBack}>
          {tr("No")}
        </button>
      </div>
    </Overlay>
  );
}

// The muster of a map fought before offers to set the last army down again (GameScreen::loadRaidSetup).
export function ConfirmSetup({ onRepeat, onSkip }) {
  return (
    <Overlay onClose={onSkip}>
      <h2>{tr("Previous Setup Found")}</h2>
      <p>{tr("Do you want to repeat the last battle setup for this map?")}</p>
      <div className="ros-over-btns">
        <button className="btn btn-primary" onClick={onRepeat}>
          {tr("Yes")}
        </button>
        <button className="btn-run" onClick={onSkip}>
          {tr("No")}
        </button>
      </div>
    </Overlay>
  );
}

// A unit is about to end its turn with an enemy still in reach — or a healer with a wounded ally in reach (`heal`).
export function ConfirmSkip({ name, heal, onBack, onSkip }) {
  return (
    <Overlay onClose={onBack}>
      <h2>{heal ? tr("{u} can still heal", { u: tr(name) }) : tr("{u} can still attack", { u: tr(name) })}</h2>
      <p>
        {heal
          ? tr("A wounded ally is in reach. End this unit's turn without healing?")
          : tr("There's an enemy in range. End this unit's turn without striking?")}
      </p>
      <div className="ros-over-btns">
        <button className="btn btn-primary" onClick={onBack}>
          ◂ {tr("Back")}
        </button>
        <button className="btn-run" onClick={onSkip}>
          {heal ? tr("End without healing") : tr("End without attacking")}
        </button>
      </div>
    </Overlay>
  );
}

// The defeat card's line, by why the battle was lost (engine `defeatReason`).
const DEFEAT_TEXT = {
  wiped: "Your whole army has fallen. Regroup and try again.",
  script: "Your commanders have called the retreat. Regroup and try again.",
  escort:
    "Too many of the units you were escorting have fallen — too few are left to reach safety. Regroup and try again.",
  turns: "The turn limit passed before you could prevail. Regroup and try again.",
  "": "The battle is lost. Regroup and try again.",
};

// Victory / defeat. A campaign battle continues to the shell (or retries a defeat); a skirmish offers the next
// battle or a retry. On a raid, the Medal won or missed.
// Hot-seat: the device goes to the next player — their muster or their turn starts when they say so.
export function HandoverCard({ handover, onReady }) {
  return (
    <div className="ros-overlay ros-overlay-fixed ros-overlay-top ros-handover">
      <div className={"ros-overlay-card ros-handover-card " + handover.paint}>
        <h2>
          {handover.kind === "deploy"
            ? tr("{n}: deploy your army", { n: tr(handover.name) })
            : handover.opening
              ? tr("To battle! {n} moves first", { n: tr(handover.name) })
              : tr("{n}: your turn", { n: tr(handover.name) })}
        </h2>
        {handover.opening && handover.coin && (
          <p className="ros-hs-coin">🪙 {tr("The coin toss gives the first move to {n}.", { n: tr(handover.name) })}</p>
        )}
        <p>
          {tr("Pass the device to {n} ({s}).", { n: tr(handover.name), s: tr(handover.side) })}{" "}
          {handover.kind === "deploy"
            ? tr("Place your units in your own yellow blocks, then press Fight.")
            : tr("Press Ready when you have it.")}
        </p>
        <div className="ros-over-btns">
          <button className="btn btn-primary" onClick={onReady}>
            {tr("Ready")} ▸
          </button>
        </div>
      </div>
    </div>
  );
}

// Hot-seat result: who won, and a rematch.
function HotseatResult({ state, onRetry }) {
  const winner = state.hotseat.winner;
  const byTime = state.turn > state.turnLimit;
  return (
    <div className="ros-overlay victory">
      <div className="ros-overlay-card">
        <h2>🏆 {tr("{n} wins!", { n: tr(winner.name) })}</h2>
        <p>
          {byTime
            ? tr("The turn limit is reached — {s} holds the stronger army.", { s: tr(winner.side) })
            : tr("{s} has destroyed the opposing army.", { s: tr(winner.side) })}
        </p>
        <p className="ros-hs-left">
          {state.hotseat.players
            .map((p) => tr("{n} ({s}): {k} units left", { n: tr(p.name), s: tr(p.side), k: p.left }))
            .join(" · ")}
        </p>
        <div className="ros-over-btns">
          <button className="btn btn-primary" onClick={onRetry}>
            ↺ {tr("Rematch")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResultCard({ state, medal, campaign, hasNext, onContinue, onRetry, onNext }) {
  if (state.hotseat && state.hotseat.winner) return <HotseatResult state={state} onRetry={onRetry} />;
  const mission = state.mission;
  const won = state.phase === "victory";
  const turnWin = won && state.turn > state.turnLimit && mission && mission.group === "skirmish";
  // A win with the enemy still on the field — an escape map's getaway, or The Squire's Siege, where even falling to the
  // last man ends the training as won: GameScreen::checkOutcome's "nobody of yours left" outcome plays the map's own
  // closing sequence, and only a wiped-out enemy (outcome 3) is a Major Victory — no field to hold, no Medal to miss.
  const offField = won && !turnWin && state.red > 0;
  const escaped = offField && !!(state.escape && state.escape.escaped > 0);
  return (
    <div className={"ros-overlay " + state.phase}>
      <div className="ros-overlay-card">
        <h2>{won ? "⚔️ " + tr(medal && state.major ? "Major Victory!" : "Victory!") : "🩸 " + tr("Defeat")}</h2>
        <p>
          {won
            ? turnWin
              ? tr("The turn limit is reached — your army holds the stronger position, so {m} is yours.", {
                  m: mission.name,
                })
              : escaped
                ? tr("You broke through — {m} is won.", { m: mission ? mission.name : tr("the battle") })
                : offField
                  ? tr("The battle is over — {m} is won.", { m: mission ? mission.name : tr("the battle") })
                  : tr("The field is yours — {m} is won. Your Hero stands triumphant.", {
                      m: mission ? mission.name : tr("the battle"),
                    })
            : tr(DEFEAT_TEXT[state.defeatReason || (state.turn > state.turnLimit ? "turns" : "")] || DEFEAT_TEXT[""])}
        </p>
        {won &&
          medal &&
          (state.major ? (
            <MedalWon medal={medal} />
          ) : (
            <MedalMissed medal={medal} enemyLeft={state.red > 0} offField={offField} escaped={escaped} />
          ))}
        <div className="ros-over-btns">
          {campaign ? (
            <>
              <button className="btn btn-primary" onClick={onContinue}>
                {tr("Continue")} ▸
              </button>
              {!won && (
                <button className="btn-run" onClick={onRetry}>
                  ↺ {tr("Retry")}
                </button>
              )}
            </>
          ) : (
            <>
              {won && hasNext && (
                <button className="btn btn-primary" onClick={onNext}>
                  {tr("Next Battle")} ▸
                </button>
              )}
              <button className="btn-run" onClick={onRetry}>
                ↺ {tr("Retry")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MedalWon({ medal }) {
  return (
    <div className="ros-medal-won">
      <img className="ros-medal-big" src={base + "icons/medal.png"} alt={tr("Medal")} draggable="false" />
      <div>
        <b>+1 {tr("Medal")}</b>
        <span>
          {medal.pct == null
            ? tr("Major Victory — the enemy army is destroyed. With no deploy budget, every such win counts.")
            : tr("Major Victory — the enemy is destroyed and your surviving army is worth {p} of your deploy budget.", {
                p: medal.pct + "%",
              })}
        </span>
      </div>
    </div>
  );
}

function MedalMissed({ medal, enemyLeft, offField, escaped }) {
  if (offField)
    return (
      <div className="ros-medal-miss">
        <img src={base + "icons/medal.png"} alt="" draggable="false" />
        <span>
          {escaped
            ? tr("Getting away wins the raid but no Medal — only destroying the whole enemy army is a Major Victory.")
            : tr("This win brings no Medal — only destroying the whole enemy army is a Major Victory.")}
        </span>
      </div>
    );
  return (
    <div className="ros-medal-miss">
      <img src={base + "icons/medal.png"} alt="" draggable="false" />
      <span>
        {tr(
          "No Medal this time — a Major Victory destroys the whole enemy army with surviving strength of at least 40% of your deploy budget.",
        )}
        {enemyLeft
          ? " " + tr("The enemy army was not destroyed.")
          : medal.pct != null
            ? " " + tr("Yours: {p}%.", { p: medal.pct })
            : ""}
      </span>
    </div>
  );
}

// Mid-battle dialogue (the map script's conversations), presented like the story cutscenes: a portrait, the speaker
// and one line at a time. It sits inside the stage, so it overlays the battlefield and is clipped to it. Enemy
// speakers stand on the right, your side on the left. Episode II has no stand-in bust, so a line without a face there
// shows no portrait.
export function DialogueBeat({ lines, index, portraitBase, onAdvance }) {
  const line = lines[Math.min(index, lines.length - 1)] || {};
  const last = index >= lines.length - 1;
  const side = line.side === "foe" ? "right" : "left";
  return (
    <div className="ros-event-cut" onClick={onAdvance}>
      <div className={"ros-cut-stage ros-cut-" + side}>
        {(line.face || portraitBase === base) && (
          <img
            key={line.face || "face008"}
            className="ros-cut-portrait"
            src={portraitBase + "portraits/" + (line.face || "face008") + ".png"}
            alt=""
            draggable="false"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        )}
        <div className="ros-cut-box">
          <div className={"ros-cut-name" + (line.side === "foe" ? " foe" : "")}>{tr(line.speaker)}</div>
          <p className="ros-cut-text">{subName(tr(line.text))}</p>
          <div className="ros-cut-foot">
            <span className="ros-cut-count">
              {index + 1} / {lines.length}
            </span>
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                onAdvance();
              }}
            >
              {last ? tr("Continue") + " ▸" : tr("Next") + " ▸"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
