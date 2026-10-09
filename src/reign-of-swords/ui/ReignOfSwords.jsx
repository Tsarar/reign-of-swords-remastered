import { useEffect, useRef, useState } from "react";
import { base } from "./battle-ui.jsx";
import "./reign.css";
import { tr, useGameLang } from "../i18n/i18n.js";
import { useStoredFlag } from "./shell/useStoredFlag.js";
import { useBattleEngine } from "./battle/useBattleEngine.js";
import { useFlash } from "./battle/useFlash.js";
import TopBar from "./battle/TopBar.jsx";
import { NoticeToast, WaveToast, TurnBanner } from "./battle/Toasts.jsx";
import {
  Briefing,
  ObjectivesCard,
  ManualModal,
  DebugCard,
  ConfirmEndTurn,
  ConfirmSkip,
  ConfirmUnspent,
  ConfirmSetup,
  ResultCard,
  DialogueBeat,
  HandoverCard,
} from "./battle/Overlays.jsx";
import { DeployPanel, DeployHelp } from "./battle/DeployPanel.jsx";
import ControlRow from "./battle/ControlRow.jsx";
import UnitCard from "./battle/UnitCard.jsx";
import HotseatSetup from "./battle/HotseatSetup.jsx";

// The battle screen. The engine draws the board on the canvas and sends its state (`s`) here; this component
// renders everything around the board — the top bar, the toasts, the popovers, the deploy muster or the controls and
// the unit card — and calls the engine's controller for every action.
//   campaignMapId — a campaign / raid / admin battle on that map (the shell shows the story; `onEnd` gets the result)
//                   — absent: a skirmish with its own battle picker and briefing
//   medals        — show the Major-Victory Medal UI (raids, where a Medal is really paid)
//   autoplay      — a Battle Lab run to watch: { army, strategy, seed, turnLimit } — mustered and played by the 🤖 Autopilot
export default function ReignOfSwords({
  campaignMapId = null,
  onEnd = null,
  onExit = null,
  sfxMuted = false,
  musicMuted = false,
  onSettings = null,
  army = null,
  godArmy = false,
  assetBase = null,
  medals = false,
  autoplay = null,
  hotseat = false,
  online = null, // an online battle (ui/online/OnlineMatch.jsx): its engine settings
  onEngine = null,
  onlineHud = null, // the online match's bar (turn, clock, forfeit), drawn over the battle
}) {
  useGameLang(); // re-render the battle chrome when the language changes
  const campaign = campaignMapId != null;
  const portraitBase = assetBase || base; // Episode II serves its own dialogue portraits from its data folder

  const [briefing, setBriefing] = useState(!campaign && !online); // a skirmish opens on its briefing (online: the muster)
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmFight, setConfirmFight] = useState(false); // "You have not fully utilized your deployment points..."
  const [setupAsk, setSetupAsk] = useState(null); // the kept muster of this map, offered again ("Previous Setup Found")
  const [showObjectives, setShowObjectives] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [debugSnap, setDbg] = useState(null); // the 🐞 snapshot dialog: { text, copied }
  const [eventMsg, setEventMsg] = useState(null); // the mid-battle conversation being read
  const [eventIdx, setEventIdx] = useState(0);
  const [hintsOff, dismissHintsToggle] = useStoredFlag("ros-hints-off");
  // fast-forward the whole battle: 0 off, 1 fast, 2 super fast — the button steps through them (kept on this device)
  const [fastFwd, setFastFwd] = useState(() => {
    try {
      const stored = localStorage.getItem("ros-fastenemy");
      return stored === "2" ? 2 : stored === "1" ? 1 : 0;
    } catch (e) {
      return 0;
    }
  });
  const toggleFast = () =>
    setFastFwd((cur) => {
      const next = (cur + 1) % 3;
      try {
        localStorage.setItem("ros-fastenemy", String(next));
      } catch (e) {}
      return next;
    });

  // REPEAT THE LAST SETUP (GameScreen::saveRaidSetup / loadRaidSetup): one kept muster per map and episode, saved when
  // the battle starts and offered at the next muster of that map (engine/deploy.js deploySetup / applySetup).
  const setupKey = assetBase ? "ros-setup-v1-ep2" : "ros-setup-v1";
  const setupsOn = !hotseat && !online && !autoplay && !godArmy;
  const keptSetups = () => {
    try {
      return JSON.parse(localStorage.getItem(setupKey)) || {};
    } catch (e) {
      return {};
    }
  };
  // the setup this map's muster will offer, or null (never on Combat Training part 2, as isSetupAvailable)
  const setupFor = (id) => {
    if (!setupsOn || id == null || id === 5805) return null;
    const kept = keptSetups()[id];
    return kept && kept.units && kept.units.length ? kept : null;
  };

  const { hostRef, ctrlRef, state, ready, error, missions } = useBattleEngine({
    campaignMapId,
    assetBase,
    army,
    godArmy,
    sfxMuted,
    musicMuted,
    fastFwd,
    autoplay,
    hotseat,
    online,
    onEngine,
    musterHold: (id) => !!setupFor(id), // the muster's opening script waits while the question is up
  });
  const ctrl = ctrlRef.current;

  // A new conversation from the engine starts at its first line.
  const battleEventId = state.battleEvent && state.battleEvent.id;
  useEffect(() => {
    if (battleEventId) {
      setEventMsg(state.battleEvent);
      setEventIdx(0);
    }
    // Keyed on the id: every engine snapshot re-sends the same conversation object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleEventId]);
  const waveToast = useFlash(state.wave, 3200);
  const noticeToast = useFlash(state.notice, 3200);
  const turnToast = useFlash(state.turnBanner, [1700, 425, 142][fastFwd]); // = the engine's TURN_BANNER_HOLD at ×1 / ×4 / ×12

  const medal = medals ? state.medal : null; // the Medal UI only where a Major Victory really pays one
  const mission = state.mission;
  const over = state.phase === "victory" || state.phase === "defeat";
  // While any popover is up the field is frozen, so taps can't move or select units behind it.
  const handover = !online && state.hotseat && state.hotseat.handover; // hot-seat: the device is being passed (online: never)
  const modalOpen =
    briefing ||
    showObjectives ||
    showHelp ||
    confirmEnd ||
    confirmFight ||
    !!setupAsk ||
    over ||
    (!!eventMsg && !briefing) ||
    !!handover;
  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.setInputLocked(modalOpen);
  }, [modalOpen, ready, ctrlRef]);

  const chooseMission = (i) => {
    if (ctrl) ctrl.selectMission(i);
    setBriefing(true);
  };
  const mapId = mission ? mission.mapId : null;
  const askedRef = useRef(null); // the map whose muster has already been offered its setup
  const musterHeld = !!state.musterHeld;
  useEffect(() => {
    if (state.phase !== "deploy") {
      askedRef.current = null;
      return;
    }
    // Asked once the briefing and any line on screen are gone — state.battleEvent too: a line that came with this
    // snapshot (the drill's greeting) is not in eventMsg yet. Never two popups at once.
    if (mapId == null || briefing || eventMsg || state.battleEvent || setupAsk) return;
    if (askedRef.current !== mapId) {
      askedRef.current = mapId;
      const kept = setupFor(mapId);
      if (kept) {
        setSetupAsk(kept);
        return;
      }
    }
    // answered, or nothing to ask: the muster's held opening (camera, the enemy's arrival, its lines) plays now
    if (musterHeld && ctrlRef.current && ctrlRef.current.releaseMuster) ctrlRef.current.releaseMuster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, mapId, briefing, eventMsg, state.battleEvent, setupAsk, musterHeld]);

  const fight = () => {
    if (!ctrl) return;
    if (setupsOn && mapId != null && ctrl.game) {
      const setup = ctrl.game.deploySetup();
      if (setup.units.length) {
        const all = keptSetups();
        all[mapId] = setup;
        try {
          localStorage.setItem(setupKey, JSON.stringify(all));
        } catch (e) {}
      }
    }
    ctrl.startBattle();
  };
  // 100 or more points left unspent: the original asks first (GameScreen::onSendRaidClicked, menu 5).
  const tryFight = () => {
    const d = state.deploy;
    if (d && !godArmy && d.budget - d.spent > 99) setConfirmFight(true);
    else fight();
  };
  const tryEndTurn = () => {
    if (state.unmoved > 0) setConfirmEnd(true);
    else if (ctrl) ctrl.endTurn();
  };
  const restart = () => {
    if (!campaign) setBriefing(true);
    ctrl && ctrl.reset();
    if (campaign) ctrl && ctrl.openBattle();
  };
  const copyDebug = () => {
    if (!ctrl || !ctrl.debugDump) return;
    const text = JSON.stringify(ctrl.debugDump());
    setDbg({ text, copied: false });
    try {
      navigator.clipboard.writeText(text).then(
        () => setDbg({ text, copied: true }),
        () => {},
      );
    } catch (e) {}
  };
  const advanceDialogue = () => {
    const lines = eventMsg.lines || [];
    if (eventIdx < lines.length - 1) {
      setEventIdx(eventIdx + 1);
      ctrl && ctrl.focusEventLine && ctrl.focusEventLine(eventIdx + 1); // op2 CAMERA: pan to the next line's focus
    } else {
      setEventMsg(null);
      ctrl && ctrl.eventClosed && ctrl.eventClosed();
    }
  };

  return (
    <div className="ros ros-battle">
      <span className="ros-corner c1" />
      <span className="ros-corner c2" />
      <span className="ros-corner c3" />
      <span className="ros-corner c4" />
      {mission && mission.name ? <span className="ros-frame-name">{tr(mission.name)}</span> : null}
      <TopBar
        state={state}
        campaign={campaign}
        missions={missions}
        onChooseMission={chooseMission}
        onDebug={copyDebug}
        onNextSong={() => ctrl && ctrl.nextTrack && ctrl.nextTrack()}
        onSettings={onSettings}
        onExit={onExit}
        medal={medal}
        hotseat={hotseat}
      />
      {onlineHud}
      {noticeToast && <NoticeToast notice={noticeToast} />}
      {waveToast && <WaveToast wave={waveToast} />}

      <div className={"ros-stage" + (ready ? "" : " ros-stage-loading")} ref={hostRef}>
        <canvas className="ros-canvas" />
        {state.aimMode && (
          // Floating over the battlefield (not in the toolbar row) so it never wraps the controls to a 2nd line.
          <button
            className="ros-aim-cancel"
            onClick={() => ctrl && ctrl.cancelAim()}
            title={tr("Stop aiming and go back to moving / picking a unit.")}
          >
            ✕ {tr("Cancel aim")}
          </button>
        )}
        {turnToast && <TurnBanner banner={turnToast} fast={fastFwd} />}
        {!ready && !error && <div className="ros-loading">{tr("Gathering the armies…")}</div>}
        {error && (
          <div className="ros-loading">
            {tr("Couldn't load the battle:")} {error}
          </div>
        )}
        {/* the live "what to do now" tip, on the battlefield itself; hidden under popovers, dismissable for good */}
        {ready && !modalOpen && !hintsOff && state.hint && (
          <div className="ros-hint ros-hint-live ros-hint-map">
            <span className="ros-hint-icon">💡</span>
            <span className="ros-hint-text">{tr(state.hint)}</span>
            <button
              className="ros-hint-x"
              onClick={() => !hintsOff && dismissHintsToggle()}
              title={tr("Hide tips")}
              aria-label={tr("Hide tips")}
            >
              ✕
            </button>
          </div>
        )}

        {ready && briefing && mission && hotseat && state.hotseat && (
          // hot-seat: the match settings instead of the single-player briefing
          <HotseatSetup
            key={mission.index}
            mission={mission}
            missions={missions}
            hotseat={state.hotseat}
            onChooseMission={chooseMission}
            onBack={onExit}
            onStart={(opts) => {
              if (!ctrl) return;
              ctrl.setHotseatOptions(opts);
              ctrl.reset();
              setBriefing(false);
              ctrl.openBattle();
            }}
          />
        )}
        {ready && briefing && mission && !(hotseat && state.hotseat) && (
          <Briefing
            mission={mission}
            onMarch={() => {
              setBriefing(false);
              ctrl && ctrl.openBattle();
            }}
          />
        )}
        {showObjectives && <ObjectivesCard state={state} medal={medal} onClose={() => setShowObjectives(false)} />}
        {showHelp && <ManualModal ep2={!!assetBase} onClose={() => setShowHelp(false)} />}
        {debugSnap && (
          <DebugCard
            text={debugSnap.text}
            copied={debugSnap.copied}
            onCopy={() => {
              try {
                navigator.clipboard.writeText(debugSnap.text).then(() => setDbg({ ...debugSnap, copied: true }));
              } catch (e) {}
            }}
            onClose={() => setDbg(null)}
          />
        )}
        {confirmEnd && (
          <ConfirmEndTurn
            unmoved={state.unmoved}
            onEnd={() => {
              setConfirmEnd(false);
              ctrl && ctrl.endTurn();
            }}
            onCancel={() => setConfirmEnd(false)}
          />
        )}
        {confirmFight && (
          <ConfirmUnspent
            onFight={() => {
              setConfirmFight(false);
              fight();
            }}
            onBack={() => setConfirmFight(false)}
          />
        )}
        {setupAsk && !confirmFight && (
          <ConfirmSetup
            onRepeat={() => {
              const kept = setupAsk;
              setSetupAsk(null);
              if (ctrl && ctrl.game) ctrl.game.applySetup(kept);
            }}
            onSkip={() => setSetupAsk(null)}
          />
        )}
        {state.confirmSkip && (
          <ConfirmSkip
            name={state.confirmSkip.name}
            heal={state.confirmSkip.heal}
            onBack={() => ctrl && ctrl.cancelSkip()}
            onSkip={() => ctrl && ctrl.confirmSkip()}
          />
        )}
        {over && (
          <ResultCard
            state={state}
            medal={medal}
            campaign={campaign}
            hasNext={!!mission && mission.index < missions.length - 1}
            onContinue={() =>
              onEnd &&
              onEnd(
                state.phase,
                ctrl ? ctrl.casualtyReport() : {},
                !!(medal && state.major),
                ctrl ? ctrl.shownLines() : [],
              )
            }
            onRetry={() => {
              if (campaign) {
                ctrl && ctrl.reset();
                ctrl && ctrl.openBattle();
              } else {
                setBriefing(true);
                ctrl && ctrl.reset();
              }
            }}
            onNext={() => chooseMission(mission.index + 1)}
          />
        )}
        {handover && !briefing && !over && (
          <HandoverCard handover={handover} onReady={() => ctrl && ctrl.hotseatContinue()} />
        )}
        {eventMsg && !briefing && (
          <DialogueBeat
            lines={eventMsg.lines || []}
            index={eventIdx}
            portraitBase={portraitBase}
            onAdvance={advanceDialogue}
          />
        )}
      </div>

      {state.phase === "deploy" ? (
        <>
          <DeployPanel
            deploy={state.deploy}
            mission={mission}
            onPick={(type) => ctrl && ctrl.setPlacing(type)}
            onFight={tryFight}
          />
          <DeployHelp deploy={state.deploy} drill={!!mission && mission.group === "special"} />
        </>
      ) : (
        <>
          <div className="ros-panel">
            <ControlRow
              state={state}
              ctrl={ctrl}
              fastFwd={fastFwd}
              onEndTurn={tryEndTurn}
              onToggleFast={toggleFast}
              onObjectives={() => setShowObjectives(true)}
              onManual={() => setShowHelp(true)}
              onRestart={restart}
              onExit={onExit}
            />
            <UnitCard state={state} ctrl={ctrl} />
          </div>
          <p className="ros-hint ros-hint-foot">
            <b>{tr("Turn-based tactics.")}</b>{" "}
            {tr(
              "Tap a unit → its move range lights up (yellow); tap a tile to move. Enemies in reach glow red and show the damage you'd deal — tap one to strike. Drag the battlefield (or arrow keys / screen edges) to scroll — these are the original maps, larger than the screen. Hold the green objective areas for a morale ▲ boost; stand on a keep to heal; cavalry charging down a straight lane rides on through the foot soldiers it cuts down.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
