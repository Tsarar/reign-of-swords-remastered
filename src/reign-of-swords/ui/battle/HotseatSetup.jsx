import { useEffect, useState } from "react";
import { tr } from "../../i18n/i18n.js";

// Hot-seat match settings (engine/hotseat.js), shown before every muster on the chosen map: the two players' names,
// the points each side musters with (the map's own gold, one amount for both, or — Custom — each player's own points
// and Medals, the elite slots) and who moves first (a coin toss, a player, or the map's own turn order). The last
// choices are remembered on this device.
const STORE = "ros-hotseat-v1";
const BUDGETS = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
const MIN_BUDGET = 100,
  MAX_BUDGET = 50000,
  MAX_MEDALS = 20;

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    return saved && typeof saved === "object" ? saved : {};
  } catch (e) {
    return {};
  }
}
const pair = (value, fallback) =>
  Array.isArray(value) && value.length === 2 ? value.map(String) : [fallback, fallback];
const points = (text) => {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n >= MIN_BUDGET && n <= MAX_BUDGET ? n : null;
};
// "" = automatic (1 per 1000 points); else a whole number of elite slots
const medals = (text) => {
  if (String(text).trim() === "") return { ok: true, value: null };
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= MAX_MEDALS ? { ok: true, value: n } : { ok: false, value: null };
};

export default function HotseatSetup({ mission, missions, hotseat, onChooseMission, onStart, onBack }) {
  const [saved] = useState(loadSaved);
  const [names, setNames] = useState(Array.isArray(saved.names) ? saved.names.slice(0, 2) : ["", ""]);
  // "map" (each side's own gold), one of BUDGETS (the same for both) or "custom" (each player's points + Medals)
  const [budgetMode, setBudgetMode] = useState(
    saved.budgetMode === "custom" || BUDGETS.includes(Number(saved.budgetMode)) ? String(saved.budgetMode) : "map",
  );
  const [customs, setCustoms] = useState(pair(saved.customs, "3000"));
  const [medalsIn, setMedalsIn] = useState(pair(saved.medals, ""));
  const [first, setFirst] = useState(["coin", "0", "1", "map"].includes(saved.first) ? saved.first : "coin");
  // remembered as they change, so picking another map (which rebuilds this card) keeps them
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ names, budgetMode, customs, medals: medalsIn, first }));
    } catch (e) {}
  }, [names, budgetMode, customs, medalsIn, first]);

  const custom = budgetMode === "custom";
  const pts = customs.map(points),
    med = medalsIn.map(medals);
  const valid = !custom || (pts.every((p) => p != null) && med.every((m) => m.ok));
  const maps = (missions || []).filter((m) => m.group === "skirmish");
  const sides = hotseat.players;
  const shown = (i) => (names[i] || "").trim() || tr(`Player ${i + 1}`);
  const [b1, b2] = hotseat.mapBudgets;
  const set = (list, setList, i, value) => setList(list.map((v, k) => (k === i ? value : v)));
  const start = () => {
    if (!valid) return;
    const coin = first === "coin";
    onStart({
      names: names.map((n) => (n || "").trim()),
      budget: budgetMode === "map" || custom ? null : Number(budgetMode),
      budgets: custom ? pts : null,
      elites: custom ? med.map((m) => m.value) : null,
      first: coin ? (Math.random() < 0.5 ? 0 : 1) : first === "map" ? null : Number(first),
      coin,
    });
  };
  return (
    <div className="ros-overlay ros-overlay-fixed ros-overlay-top briefing ros-hs-overlay">
      <div className="ros-overlay-card ros-briefing ros-hs-setup">
        <div className="ros-hs-col ros-hs-intro">
          <p className="ros-brief-kingdom">{tr("Hot-seat — 2 players, one device")}</p>
          <h2>{tr(mission.name)}</h2>
          {maps.length > 1 && (
            <label className="ros-hs-row">
              <span>{tr("Battlefield")}</span>
              <select
                id="ros-hs-map"
                value={mission.index}
                onChange={(e) => onChooseMission && onChooseMission(Number(e.target.value))}
              >
                {maps.map((m) => (
                  <option key={m.index} value={m.index}>
                    {tr(m.name)} · {m.cols}×{m.rows}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="ros-brief-obj">
            <b>{tr("Objective.")}</b> {tr(mission.objectiveText)}
          </p>
          <p className="ros-hs-note">
            {tr(
              "Each player deploys any units within their points; each Medal is one elite unit (by default one per 1000 points). The other army stays hidden while you deploy.",
            )}
          </p>
        </div>
        <div className="ros-hs-col ros-hs-form">
          <label className="ros-hs-row">
            <span>{tr("Budget")}</span>
            <select id="ros-hs-budget" value={budgetMode} onChange={(e) => setBudgetMode(e.target.value)}>
              <option value="map">
                {b1 === b2 ? tr("Map: {b} each", { b: b1 }) : tr("Map: {a} / {b}", { a: b1, b: b2 })}
              </option>
              {BUDGETS.map((b) => (
                <option key={b} value={String(b)}>
                  {tr("{b} each", { b })}
                </option>
              ))}
              <option value="custom">{tr("Custom — per player…")}</option>
            </select>
          </label>
          <div className="ros-hs-players">
            {[0, 1].map((i) => (
              <div key={i} className={"ros-hs-player " + sides[i].paint}>
                <label className="ros-hs-name">
                  <span className="ros-hs-side">{tr(sides[i].side)}</span>
                  <input
                    id={"ros-hs-name-" + i}
                    type="text"
                    maxLength={20}
                    placeholder={tr(`Player ${i + 1}`)}
                    value={names[i] || ""}
                    onChange={(e) => set(names, setNames, i, e.target.value)}
                  />
                </label>
                {custom && (
                  <div className="ros-hs-own">
                    <label className={pts[i] == null ? "bad" : ""}>
                      <span>{tr("Points")}</span>
                      <input
                        id={"ros-hs-points-" + i}
                        type="number"
                        inputMode="numeric"
                        min={MIN_BUDGET}
                        max={MAX_BUDGET}
                        step={50}
                        value={customs[i]}
                        onChange={(e) => set(customs, setCustoms, i, e.target.value)}
                        aria-invalid={pts[i] == null}
                      />
                    </label>
                    <label className={med[i].ok ? "" : "bad"}>
                      <span>{tr("Medals")}</span>
                      <input
                        id={"ros-hs-medals-" + i}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_MEDALS}
                        step={1}
                        placeholder={pts[i] != null ? String(Math.floor(pts[i] / 1000)) : tr("auto")}
                        value={medalsIn[i]}
                        onChange={(e) => set(medalsIn, setMedalsIn, i, e.target.value)}
                        aria-invalid={!med[i].ok}
                        title={tr("Elite units this player may field — leave empty for one per 1000 points")}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
          <label className="ros-hs-row">
            <span>{tr("First move")}</span>
            <select id="ros-hs-first" value={first} onChange={(e) => setFirst(e.target.value)}>
              <option value="coin">🪙 {tr("Coin toss")}</option>
              <option value="0">{shown(0)}</option>
              <option value="1">{shown(1)}</option>
              <option value="map">{tr("Map order — {s} first", { s: tr(sides[hotseat.mapFirst].side) })}</option>
            </select>
          </label>
          {!valid && (
            <p className="ros-hs-note ros-hs-warn">
              {tr("Points: {a}–{b}. Medals: 0–{m}, or empty for automatic.", {
                a: MIN_BUDGET,
                b: MAX_BUDGET,
                m: MAX_MEDALS,
              })}
            </p>
          )}
          <div className="ros-over-btns">
            {onBack && (
              <button className="btn-run" onClick={onBack}>
                ◂ {tr("Back")}
              </button>
            )}
            <button className="btn btn-primary" onClick={start} disabled={!valid}>
              {tr("Start deployment")} ▸
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
