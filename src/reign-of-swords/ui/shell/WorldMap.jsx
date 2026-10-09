import { tr } from "../../i18n/i18n.js";
import { KINGDOM_POS, KINGDOM_POS_EP2, TUTORIALS, TUTORIALS_EP2 } from "../../data/shell-data.js";
import { kingdomUnlocked, missionUnlocked, kingdomRaids, raidGate, raidUnlocked } from "../../data/campaign-rules.js";
import { SvgIcon, ResIcon } from "./common.jsx";

// The campaign world map: a marker per kingdom (locked 🔒, in progress ⚔ / ⚑, complete ♛) and, for the open kingdom,
// its war-plans panel — the training battles (first kingdom only), the story battles in order and the optional raids.
export default function WorldMap({
  camp,
  isEp2,
  dataBase,
  progress,
  medalRaids,
  levels,
  openKingdom,
  onOpenKingdom,
  onCloseKingdom,
  onTutorial,
  onMission,
  onRaid,
}) {
  return (
    <div className="ros-worldmap" style={{ backgroundImage: `url(${dataBase}worldmap.jpg)` }}>
      {camp.kingdoms.map((kingdom, kingdomIdx) => {
        const unlocked = kingdomUnlocked(camp, kingdomIdx, progress);
        const done = kingdom.missions.filter((m) => progress.has(m.mapId)).length;
        const complete = done === kingdom.missions.length;
        const raids = unlocked ? kingdomRaids(levels, kingdom) : [];
        const raidsWon = raids.filter((r) => progress.has(r.mapId)).length;
        const raidMedals = raids.filter((r) => medalRaids && medalRaids.has(r.mapId)).length;
        const pos = (isEp2 ? KINGDOM_POS_EP2 : KINGDOM_POS)[kingdom.id] || { top: "50%", left: "50%" };
        return (
          <button
            key={kingdom.id}
            className={"ros-kmark" + (unlocked ? "" : " locked") + (complete ? " complete" : "")}
            data-k={kingdom.id}
            style={pos}
            disabled={!unlocked}
            onClick={() => unlocked && onOpenKingdom(kingdomIdx)}
          >
            <span className="ros-kmark-dot">{!unlocked ? "🔒" : complete ? "♛" : done > 0 ? "⚔" : "⚑"}</span>
            <span className="ros-kmark-label">
              {tr(kingdom.name.replace("Kingdom of ", ""))}
              {unlocked ? (
                <i>
                  {" "}
                  {done}/{kingdom.missions.length}
                </i>
              ) : null}
            </span>
            {raids.length > 0 && (
              // one pip per raid: hollow = not yet won, filled = won, gold = won with a Major Victory (a Medal)
              <span
                className="ros-kmark-raids"
                title={
                  tr("Raids won: {w}/{n}", { w: raidsWon, n: raids.length }) +
                  (raidMedals ? " · " + tr("with a Medal: {m}", { m: raidMedals }) : "")
                }
              >
                {raids.map((r) => (
                  <i
                    key={r.mapId}
                    className={
                      medalRaids && medalRaids.has(r.mapId) ? "medal" : progress.has(r.mapId) ? "won" : undefined
                    }
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
      {openKingdom != null && (
        <KingdomPanel
          camp={camp}
          ki={openKingdom}
          isEp2={isEp2}
          progress={progress}
          medalRaids={medalRaids}
          levels={levels}
          onClose={onCloseKingdom}
          onTutorial={onTutorial}
          onMission={onMission}
          onRaid={onRaid}
        />
      )}
    </div>
  );
}

function KingdomPanel({
  camp,
  ki: kingdomIdx,
  isEp2,
  progress,
  medalRaids,
  levels,
  onClose,
  onTutorial,
  onMission,
  onRaid,
}) {
  const kingdom = camp.kingdoms[kingdomIdx];
  const raids = kingdomRaids(levels, kingdom);
  return (
    <div className="ros-kpanel-back" onClick={onClose}>
      <div className="ros-kpanel" onClick={(e) => e.stopPropagation()}>
        <div className="ros-kpanel-head">
          <b>
            {tr(kingdom.name)}
            {kingdom.legacy ? <small style={{ opacity: 0.7, fontWeight: 400 }}> · {tr("Episode I")}</small> : null}
          </b>
          <button className="ros-kpanel-x" onClick={onClose}>
            ✕
          </button>
        </div>
        {kingdomIdx === 0 && (
          <>
            <p className="ros-kpanel-sub">{tr("Training — optional battles to learn the game.")}</p>
            {(isEp2 ? TUTORIALS_EP2 : TUTORIALS).map((tut) => {
              const tdone = progress.has(tut.mapId);
              return (
                <button
                  key={tut.mapId}
                  className={"ros-kmission ros-ktut" + (tdone ? " done" : "")}
                  onClick={() => onTutorial(tut.mapId)}
                  title={tr("Tutorial battle: {t} — learn the game with a full practice army", { t: tr(tut.title) })}
                >
                  <span className="ros-km-badge">
                    <SvgIcon name="book" />
                  </span>
                  <span className="ros-km-title">
                    {tr("Tutorial")} — {tr(tut.title)}
                  </span>
                  {tdone && <span className="ros-km-done">✓</span>}
                </button>
              );
            })}
          </>
        )}
        <p className="ros-kpanel-sub">{tr("War Plans — choose a battle.")}</p>
        {kingdom.missions.map((mission, missionIdx) => {
          const unlocked = missionUnlocked(camp, kingdomIdx, missionIdx, progress),
            done = progress.has(mission.mapId);
          return (
            <button
              key={mission.mapId}
              disabled={!unlocked}
              className={"ros-kmission" + (done ? " done" : "") + (unlocked ? "" : " locked")}
              onClick={() => unlocked && onMission(kingdomIdx, missionIdx)}
            >
              <span className="ros-km-badge">{done ? "✓" : unlocked ? missionIdx + 1 : <SvgIcon name="lock" />}</span>
              <span className="ros-km-title">{tr(mission.title)}</span>
            </button>
          );
        })}
        {raids.length > 0 && (
          // RAIDS: optional side-battles, fought with your own army for extra spoils; each opens with a story battle.
          <>
            <p className="ros-kpanel-sub">{tr("Raids — optional battles for extra spoils.")}</p>
            {raids.map((raid, raidIdx) => {
              const raidDone = progress.has(raid.mapId);
              const runlocked = raidDone || raidUnlocked(camp, kingdomIdx, raidIdx, progress);
              const gate = raidGate(camp, kingdomIdx, raidIdx);
              return (
                <button
                  key={raid.mapId}
                  disabled={!runlocked}
                  className={"ros-kmission ros-kraid" + (raidDone ? " done" : "") + (runlocked ? "" : " locked")}
                  onClick={() => runlocked && onRaid(raid.mapId)}
                  title={
                    runlocked
                      ? tr("Optional raid — fought with your own army for spoils: {n}", { n: raid.name })
                      : tr("Win {m} to unlock {n}", { m: gate ? tr(gate.title) : "", n: raid.name })
                  }
                >
                  <span className="ros-km-badge">{raidDone ? "✓" : runlocked ? "⚔" : <SvgIcon name="lock" />}</span>
                  <span className="ros-km-title">{tr(raid.name)}</span>
                  {medalRaids && medalRaids.has(raid.mapId) && (
                    <span className="ros-km-medal" title={tr("Won with a Major Victory — a Medal earned here")}>
                      <ResIcon id="Medal" size={22} />
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
