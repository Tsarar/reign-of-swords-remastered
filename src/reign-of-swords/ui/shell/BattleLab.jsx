import { useMemo, useRef, useState } from "react";
import { DEPLOY_COST, UNIT_TYPES } from "../../data/game-data.js";
import { DEPLOY_ELITE } from "../../data/missions.js";
import { ALL_TYPES, EP2_ORDER, SANDBOX_ARMY, SANDBOX_ARMY_EP2 } from "../../data/shell-data.js";
import { loadLevels } from "../../engine/engine.js";
import { simulateBattle, armyCost, suggestArmy } from "../../engine/sim.js";
import { AUTOPILOT_STRATEGIES } from "../../ai/autopilot.js";
import { UnitSprite } from "./common.jsx";

// BATTLE LAB (Story & Assets; not in the original): pick any battle of this episode, an army within its deploy rules
// and the Autopilot strategies to compare, and the lab plays each strategy over several dice seeds with no screen
// (engine/sim.js) — the AI plays your side, so read the results as a lower bound for a careful player. Every run can
// be watched: "Watch" opens that very battle (same army, strategy and seed) with the Autopilot at the controls.
const GROUPS = { story: "Campaign", siege: "Raids", skirmish: "Battlefields", special: "Tutorials" };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export default function BattleLab({ levels, dataBase, isEp2, onWatch }) {
  const maps = useMemo(() => (levels || []).filter((l) => GROUPS[l.group]), [levels]);
  const [mapId, setMapId] = useState(() => (maps.find((l) => l.budget > 0) || maps[0] || {}).mapId);
  const level = maps.find((l) => l.mapId === mapId) || null;
  const budget = level ? level.budget || 0 : 0;
  const [army, setArmy] = useState(() => suggestArmy(budget || 3000));
  const [strategies, setStrategies] = useState(Object.keys(AUTOPILOT_STRATEGIES));
  const [seeds, setSeeds] = useState(3);
  const [turnLimit, setTurnLimit] = useState("");
  const [runs, setRuns] = useState([]);
  const [progress, setProgress] = useState(null);
  const [openStrategy, setOpenStrategy] = useState(null);
  const abortRef = useRef(null);

  const types = (isEp2 ? [...ALL_TYPES, ...EP2_ORDER] : ALL_TYPES).filter((t) => (DEPLOY_COST[t] || 0) > 0);
  const cost = armyCost(army);
  const elites = Object.entries(army).reduce((s, [t, n]) => s + (DEPLOY_ELITE[t] ? n : 0), 0);
  const eliteCap = Math.floor(budget / 1000);
  const preset = level && !budget;
  const setCount = (t, n) => setArmy((a) => ({ ...a, [t]: Math.max(0, Math.min(30, n)) }));
  const pickMap = (id) => {
    setMapId(id);
    const l = maps.find((x) => x.mapId === id);
    if (l && l.budget) setArmy(suggestArmy(l.budget));
    setRuns([]);
  };

  const run = async () => {
    if (!level || progress) return;
    const signal = { aborted: false };
    abortRef.current = signal;
    const plan = [];
    for (const strategy of strategies) for (let s = 1; s <= seeds; s++) plan.push({ strategy, seed: s });
    setRuns([]);
    setProgress({ done: 0, total: plan.length });
    try {
      await loadLevels(dataBase); // the battles of THIS episode
      const done = [];
      for (const job of plan) {
        if (signal.aborted) break;
        const result = await simulateBattle({
          mapId,
          army,
          roster: isEp2 ? SANDBOX_ARMY_EP2 : SANDBOX_ARMY,
          strategy: job.strategy,
          seed: job.seed,
          turnLimit: Number(turnLimit) || null,
          signal,
        });
        if (signal.aborted) break;
        done.push({ ...result, army: { ...army }, turnLimitSet: Number(turnLimit) || null });
        setRuns(done.slice());
        setProgress({ done: done.length, total: plan.length });
      }
    } catch (e) {
      setProgress({ error: e.message || String(e) });
      return;
    }
    setProgress(null);
  };
  const stop = () => {
    if (abortRef.current) abortRef.current.aborted = true;
    setProgress(null);
  };

  const byStrategy = strategies
    .map((k) => {
      const list = runs.filter((r) => r.strategy === k);
      const wins = list.filter((r) => r.result === "victory");
      const avg = (f) => (list.length ? Math.round(list.reduce((s, r) => s + f(r), 0) / list.length) : 0);
      return {
        k,
        list,
        wins: wins.length,
        majors: wins.filter((r) => r.major).length,
        turn: avg((r) => r.turn),
        kept: avg((r) => r.kept),
        foes: avg((r) => r.foesLeft),
      };
    })
    .filter((row) => row.list.length)
    .sort((a, b) => b.wins - a.wins || b.kept - a.kept || a.foes - b.foes);

  return (
    <div className="ros-lab">
      <p className="ros-lab-intro">
        Pick a battle, an army and the strategies to compare. The lab plays every strategy over several dice seeds with
        the AI commanding your side — a plain player, so a careful one should do better. Each run can be watched on the
        battlefield with the same seed.
      </p>
      <div className="ros-lab-row">
        <label>
          <span>Battle</span>
          <select id="ros-lab-map" value={mapId || ""} onChange={(e) => pickMap(Number(e.target.value))}>
            {Object.entries(GROUPS).map(([g, label]) => {
              const inGroup = maps.filter((l) => l.group === g);
              return inGroup.length ? (
                <optgroup key={g} label={label}>
                  {inGroup.map((l) => (
                    <option key={l.mapId} value={l.mapId}>
                      {(l.kingdom ? l.kingdom + " · " : "") + l.name} {l.budget ? `(${l.budget} pts)` : "(preset army)"}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label>
          <span>Seeds</span>
          <input
            id="ros-lab-seeds"
            type="number"
            min="1"
            max="20"
            value={seeds}
            onChange={(e) => setSeeds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          <span>Turn limit</span>
          <input
            id="ros-lab-turns"
            type="number"
            min="1"
            max="99"
            placeholder={level ? String(level.turnLimit || "") : ""}
            value={turnLimit}
            onChange={(e) => setTurnLimit(e.target.value)}
          />
        </label>
      </div>
      {level && level.objectiveText && <p className="ros-lab-obj">🎯 {level.objectiveText}</p>}

      {preset ? (
        <p className="ros-lab-note">This battle has no deployment: it is fought with the map's own preset army.</p>
      ) : (
        <div className="ros-lab-army">
          <div className="ros-lab-armyhead">
            <b>Army</b>
            <span className={cost > budget ? "over" : ""}>
              {cost} / {budget} pts
            </span>
            <span className={elites > eliteCap ? "over" : ""}>
              elites {elites} / {eliteCap}
            </span>
            <button className="btn-run" onClick={() => setArmy(suggestArmy(budget))}>
              Suggest a mix
            </button>
            <button className="btn-run" onClick={() => setArmy({})}>
              Clear
            </button>
          </div>
          {(cost > budget || elites > eliteCap) && (
            <p className="ros-lab-note over">
              Over the muster limits — the lab places units in order and skips what does not fit (1 elite per 1000 pts:
              Wizards, Griffon Riders, Cannons, Ballistae, Conjurers, Kings).
            </p>
          )}
          <div className="ros-lab-units">
            {types.map((t) => (
              <div key={t} className={"ros-lab-unit" + (army[t] ? " has" : "")}>
                <UnitSprite unit={t} size={30} framed={false} />
                <span className="ros-lab-uname">
                  {UNIT_TYPES[t] ? UNIT_TYPES[t].name : t}
                  <small>
                    {DEPLOY_COST[t]} pts{DEPLOY_ELITE[t] ? " · elite" : ""}
                  </small>
                </span>
                <span className="ros-lab-count">
                  <button aria-label={"Fewer " + t} onClick={() => setCount(t, (army[t] || 0) - 1)}>
                    −
                  </button>
                  <b>{army[t] || 0}</b>
                  <button aria-label={"More " + t} onClick={() => setCount(t, (army[t] || 0) + 1)}>
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ros-lab-strats">
        {Object.entries(AUTOPILOT_STRATEGIES).map(([k, info]) => (
          <label key={k} title={info.help}>
            <input
              id={"ros-lab-s-" + k}
              type="checkbox"
              checked={strategies.includes(k)}
              onChange={(e) => setStrategies((s) => (e.target.checked ? [...s, k] : s.filter((x) => x !== k)))}
            />{" "}
            <b>{info.label}</b>
            <small>{info.help}</small>
          </label>
        ))}
      </div>

      <div className="ros-lab-run">
        {progress && !progress.error ? (
          <>
            <button className="btn-run" onClick={stop}>
              ■ Stop
            </button>
            <span>
              Playing battle {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </span>
          </>
        ) : (
          <button className="btn btn-primary" disabled={!level || !strategies.length} onClick={run}>
            ▶ Run {strategies.length * seeds} battles
          </button>
        )}
        {progress && progress.error && <span className="ros-lab-note over">Failed: {progress.error}</span>}
      </div>

      {byStrategy.length > 0 && (
        <div className="ros-lab-results">
          <div className="ros-lab-res ros-lab-reshead">
            <span>Strategy</span>
            <span>Wins</span>
            <span>Avg. turns</span>
            <span>Army kept</span>
            <span>Foes left</span>
          </div>
          {byStrategy.map((row) => (
            <div key={row.k} className="ros-lab-group">
              <button
                className="ros-lab-res"
                aria-expanded={openStrategy === row.k}
                onClick={() => setOpenStrategy(openStrategy === row.k ? null : row.k)}
              >
                <span>
                  {openStrategy === row.k ? "▾" : "▸"} <b>{AUTOPILOT_STRATEGIES[row.k].label}</b>
                </span>
                <span className={row.wins ? "win" : "loss"}>
                  {row.wins}/{row.list.length} ({pct(row.wins, row.list.length)}%)
                  {row.majors ? ` · ${row.majors} major` : ""}
                </span>
                <span>{row.turn}</span>
                <span>{row.kept}%</span>
                <span>{row.foes}</span>
              </button>
              {openStrategy === row.k &&
                row.list.map((r) => (
                  <div key={r.seed} className="ros-lab-runrow">
                    <span>seed {r.seed}</span>
                    <span className={r.result === "victory" ? "win" : "loss"}>
                      {r.result === "victory"
                        ? r.major
                          ? "Major victory"
                          : "Victory"
                        : r.reason === "turns"
                          ? "Out of time"
                          : "Defeat"}{" "}
                      · turn {r.turn}
                    </span>
                    <span>
                      kept {r.kept}% · {r.mineLeft} units · {r.foesLeft} foes left
                      {r.alliesLeft ? ` · ${r.alliesLeft} allies` : ""}
                    </span>
                    <span className="ros-lab-dmg">
                      hurt most by{" "}
                      {Object.entries(r.damage)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([k, v]) => `${k} ${Math.round(v)}`)
                        .join(", ") || "—"}
                    </span>
                    <span className="ros-lab-timeline" title="Your units / foes at the start of each of your turns">
                      {r.timeline.map((t) => `${t.mine}:${t.foes}`).join(" ")}
                    </span>
                    <button
                      className="btn-run"
                      onClick={() =>
                        onWatch &&
                        onWatch({
                          mapId: r.mapId,
                          army: r.army,
                          strategy: r.strategy,
                          seed: r.seed,
                          turnLimit: r.turnLimitSet,
                        })
                      }
                    >
                      ▶ Watch
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
