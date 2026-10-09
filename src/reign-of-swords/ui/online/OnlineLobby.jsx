import { useEffect, useMemo, useState } from "react";
import { tr } from "../../i18n/i18n.js";
import { useAuth } from "../../../auth/AuthContext.jsx";
import * as net from "../../online/net.js";

// ONLINE BATTLES — the lobby: open battles of this episode (join, with the password when it has one), the player's own
// unfinished ones (resume / close), a new one (map, gold, turn time, optional password), and the leaderboard.
// Signed out (or a build without Supabase): how to get in, and the hot-seat mode instead.
// The new battle's gold, Medals and first move offer the hot-seat setup's choices (ui/battle/HotseatSetup.jsx).
const TURN_TIMES = [60, 120, 180, 300];
// Where online battles are played when this build has no accounts (a copy of the game outside the website).
export const ONLINE_ON_WEB = {
  1: "https://dmytro-portfolio-website.vercel.app/games/reign-of-swords",
  2: "https://dmytro-portfolio-website.vercel.app/games/reign-of-swords-2",
};
const BUDGETS = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
const MIN_BUDGET = 100,
  MAX_BUDGET = 50000,
  MAX_MEDALS = 20;
const points = (text) => {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n >= MIN_BUDGET && n <= MAX_BUDGET ? n : null;
};
// "" = automatic (1 per 1000 gold); else a whole number of elite slots
const medals = (text) => {
  if (String(text).trim() === "") return { ok: true, value: null };
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= MAX_MEDALS ? { ok: true, value: n } : { ok: false, value: null };
};

export default function OnlineLobby({ episode, levels, onPlay, onHotseat, onBack }) {
  const auth = useAuth();
  const userId = auth && auth.user ? auth.user.id : null;
  const [tab, setTab] = useState("lobbies");
  const [lists, setLists] = useState({ open: [], mine: [] });
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const maps = useMemo(
    () =>
      (levels || [])
        .filter((l) => l.group === "skirmish" && !l.hidden && (l.groupOrder || []).some((g) => g.side === "enemy"))
        .map((l) => {
          const order = l.groupOrder || [];
          const p1 = order.find((g) => g.side === "player"),
            p2 = order.find((g) => g.side === "enemy");
          return {
            id: l.mapId,
            name: l.name,
            budgets: [l.budget || 3000, l.enemyBudget || l.budget || 3000], // host = the map's West side
            hostFirst: !p1 || !p2 || p1.gi <= p2.gi, // the map's own turn order
          };
        }),
    [levels],
  );
  const mapName = (id) => (maps.find((m) => m.id === id) || {}).name || "#" + id;
  // budgetMode: "map" (each side's own gold), one of BUDGETS (the same for both) or "custom" (each side's gold + Medals)
  const [form, setForm] = useState({
    name: "",
    password: "",
    mapId: null,
    budgetMode: "map",
    customs: ["3000", "3000"],
    medals: ["", ""],
    first: "coin", // coin | host | guest | map
    turnSeconds: 120,
  });
  const map = maps.find((m) => m.id === form.mapId) || maps[0];
  const custom = form.budgetMode === "custom";
  const pts = form.customs.map(points),
    med = form.medals.map(medals);
  const valid = !!map && (!custom || (pts.every((p) => p != null) && med.every((m) => m.ok)));
  const setPair = (key, i, value) => setForm({ ...form, [key]: form[key].map((v, k) => (k === i ? value : v)) });

  const refresh = () =>
    userId && net.listLobbies(episode, userId).then(setLists, (e) => setError(e.message || String(e)));
  useEffect(() => {
    if (!userId) return undefined;
    refresh();
    let stop = null;
    net.followLobbies(refresh).then(
      (s) => (stop = s),
      () => {},
    );
    const poll = setInterval(refresh, 15000); // a fallback if the live updates are not delivered
    return () => {
      clearInterval(poll);
      if (stop) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, episode]);
  useEffect(() => {
    if (tab === "board") net.leaderboard(net.GAME_OF_EPISODE[episode]).then(setBoard, (e) => setError(e.message));
  }, [tab, episode]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(tr(e.message || String(e)));
    }
    setBusy(false);
  };
  const create = (e) => {
    e.preventDefault();
    if (!valid) return;
    const budgets = custom
      ? pts
      : form.budgetMode === "map"
        ? map.budgets
        : [Number(form.budgetMode), Number(form.budgetMode)];
    run(async () => {
      const id = await net.createMatch({
        name: form.name.trim() || tr("{name}'s battle", { name: (auth.profile && auth.profile.display_name) || "" }),
        password: form.password,
        episode,
        mapId: map.id,
        budgets,
        medals: custom ? med.map((m) => m.value) : null,
        first: form.first === "map" ? (map.hostFirst ? "host" : "guest") : form.first,
        turnSeconds: form.turnSeconds,
      });
      onPlay(id);
    });
  };
  const join = (m) =>
    run(async () => {
      const password = m.has_password ? window.prompt(tr("Password for this battle:")) : "";
      if (m.has_password && password == null) return;
      await net.joinMatch(m.id, password);
      onPlay(m.id);
    });

  if (!auth || !auth.enabled || !userId)
    return (
      <div className="ros-online">
        <div className="ros-screen-head">
          <h2>⚔ {tr("Online Battles")}</h2>
          <button className="btn-run" onClick={onBack}>
            ◂ {tr("Main Menu")}
          </button>
        </div>
        <p className="ros-online-note">
          {auth && auth.enabled ? (
            tr(
              "Sign in (top of the page) to battle other players online — every move is shown live, with a clock for each turn.",
            )
          ) : (
            <>
              {tr("Online battles are not available on this build — play them on the website, in your browser:")}{" "}
              <a
                className="ros-online-web"
                href={ONLINE_ON_WEB[episode === 2 ? 2 : 1]}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tr("Play online on the website")}
              </a>
            </>
          )}
        </p>
        <button className="btn btn-primary" onClick={onHotseat}>
          ⚔ {tr("Hot-seat — 2 players")}
        </button>
      </div>
    );

  const fmtTime = (s) => (s % 60 ? s + " s" : s / 60 + " min");
  const status = (m) =>
    m.status === "waiting"
      ? tr("waiting for an opponent")
      : m.status === "deploying"
        ? tr("deploying")
        : m.turn_owner === userId
          ? tr("your turn")
          : tr("their turn");
  // a battle's terms: gold (host / guest when they differ), Medals when set, who moves first when not a coin toss
  const terms = (m) => {
    const g = m.guest_budget || m.budget;
    const out = [(g === m.budget ? m.budget : m.budget + " / " + g) + " " + tr("gold")];
    if (m.host_medals != null || m.guest_medals != null) {
      const s = (v) => (v == null ? tr("auto") : v);
      out.push(
        tr("Medals") +
          " " +
          (m.host_medals === m.guest_medals ? s(m.host_medals) : s(m.host_medals) + " / " + s(m.guest_medals)),
      );
    }
    if (m.first_pick === "host") out.push(tr("host moves first"));
    if (m.first_pick === "guest") out.push(tr("guest moves first"));
    return out.join(" · ");
  };
  return (
    <div className="ros-online">
      <div className="ros-screen-head">
        <h2>⚔ {tr("Online Battles")}</h2>
        <button className="btn-run" onClick={onBack}>
          ◂ {tr("Main Menu")}
        </button>
      </div>
      <div className="ros-online-tabbar">
        <div className="ros-online-tabs" role="tablist">
          {[
            ["lobbies", tr("Battles")],
            ["board", tr("Leaderboard")],
          ].map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={"btn-run" + (tab === k ? " on" : "")}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn-run" onClick={onHotseat}>
          ⚔ {tr("Hot-seat — 2 players")}
        </button>
      </div>
      {error && <p className="ros-online-err">{error}</p>}

      {tab === "lobbies" && (
        <div className="ros-online-cols">
          <section className="ros-online-panel">
            <h3>{tr("Open battles")}</h3>
            {lists.mine.length > 0 && (
              <ul className="ros-online-list">
                {lists.mine.map((m) => (
                  <li key={m.id} className="mine">
                    <div>
                      <b>{m.name}</b> {m.has_password ? "🔒" : ""}
                      <small>
                        {mapName(m.map_id)} · {terms(m)} · {fmtTime(m.turn_seconds)} · {status(m)}
                      </small>
                    </div>
                    <button className="btn-run" onClick={() => onPlay(m.id)}>
                      {m.status === "waiting" ? tr("Open") : tr("Resume")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {lists.open.length ? (
              <ul className="ros-online-list">
                {lists.open.map((m) => (
                  <li key={m.id}>
                    <div>
                      <b>{m.name}</b> {m.has_password ? "🔒" : ""}
                      <small>
                        {m.host_name} · {mapName(m.map_id)} · {terms(m)} · {fmtTime(m.turn_seconds)}
                      </small>
                    </div>
                    <button className="btn-run" disabled={busy} onClick={() => join(m)}>
                      {tr("Join")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ros-online-note">
                {tr("No open battles right now — create one and share its name with a friend.")}
              </p>
            )}
          </section>
          <section className="ros-online-panel">
            <h3>{tr("New battle")}</h3>
            <form className="ros-online-form" onSubmit={create}>
              <label htmlFor="ros-ol-name">{tr("Name")}</label>
              <input
                id="ros-ol-name"
                maxLength={40}
                value={form.name}
                placeholder={tr("{name}'s battle", { name: (auth.profile && auth.profile.display_name) || "" })}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <label htmlFor="ros-ol-pass">{tr("Password (optional)")}</label>
              <input
                id="ros-ol-pass"
                type="password"
                autoComplete="new-password"
                maxLength={40}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <label htmlFor="ros-ol-map">{tr("Battlefield")}</label>
              <select
                id="ros-ol-map"
                value={map ? map.id : ""}
                onChange={(e) => setForm({ ...form, mapId: Number(e.target.value) })}
              >
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {tr(m.name)}
                  </option>
                ))}
              </select>
              <label htmlFor="ros-ol-budget">{tr("Budget")}</label>
              <select
                id="ros-ol-budget"
                value={form.budgetMode}
                onChange={(e) => setForm({ ...form, budgetMode: e.target.value })}
              >
                <option value="map">
                  {map && map.budgets[0] !== map.budgets[1]
                    ? tr("Map: {a} / {b}", { a: map.budgets[0], b: map.budgets[1] })
                    : tr("Map: {b} each", { b: map ? map.budgets[0] : 3000 })}
                </option>
                {BUDGETS.map((b) => (
                  <option key={b} value={String(b)}>
                    {tr("{b} each", { b })}
                  </option>
                ))}
                <option value="custom">{tr("Custom — per player…")}</option>
              </select>
              {custom && (
                <div className="ros-online-custom">
                  {[tr("You"), tr("Opponent")].map((who, i) => (
                    <div key={i} className="ros-online-side">
                      <b>{who}</b>
                      <label className={pts[i] == null ? "bad" : ""}>
                        <span>{tr("Points")}</span>
                        <input
                          id={"ros-ol-points-" + i}
                          type="number"
                          inputMode="numeric"
                          min={MIN_BUDGET}
                          max={MAX_BUDGET}
                          step={50}
                          value={form.customs[i]}
                          onChange={(e) => setPair("customs", i, e.target.value)}
                          aria-invalid={pts[i] == null}
                        />
                      </label>
                      <label className={med[i].ok ? "" : "bad"}>
                        <span>{tr("Medals")}</span>
                        <input
                          id={"ros-ol-medals-" + i}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_MEDALS}
                          step={1}
                          placeholder={pts[i] != null ? String(Math.floor(pts[i] / 1000)) : tr("auto")}
                          value={form.medals[i]}
                          onChange={(e) => setPair("medals", i, e.target.value)}
                          aria-invalid={!med[i].ok}
                          title={tr("Elite units this player may field — leave empty for one per 1000 points")}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {custom && !valid && (
                <p className="ros-online-err">
                  {tr("Points: {a}–{b}. Medals: 0–{m}, or empty for automatic.", {
                    a: MIN_BUDGET,
                    b: MAX_BUDGET,
                    m: MAX_MEDALS,
                  })}
                </p>
              )}
              <label htmlFor="ros-ol-first">{tr("First move")}</label>
              <select
                id="ros-ol-first"
                value={form.first}
                onChange={(e) => setForm({ ...form, first: e.target.value })}
              >
                <option value="coin">🪙 {tr("Coin toss")}</option>
                <option value="host">{tr("You")}</option>
                <option value="guest">{tr("Opponent")}</option>
                <option value="map">
                  {map && !map.hostFirst ? tr("Map order — opponent first") : tr("Map order — you first")}
                </option>
              </select>
              <label htmlFor="ros-ol-time">{tr("Time per turn")}</label>
              <select
                id="ros-ol-time"
                value={form.turnSeconds}
                onChange={(e) => setForm({ ...form, turnSeconds: Number(e.target.value) })}
              >
                {TURN_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {fmtTime(t)}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" type="submit" disabled={busy || !valid}>
                {tr("Create battle")}
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "board" && (
        <section className="ros-online-panel">
          {!board ? (
            <p className="ros-online-note">{tr("Loading…")}</p>
          ) : board.length ? (
            <table className="ros-online-board">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{tr("Player")}</th>
                  <th>{tr("Rating")}</th>
                  <th>{tr("Wins")}</th>
                  <th>{tr("Losses")}</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr
                    key={r.place}
                    className={auth.profile && r.display_name === auth.profile.display_name ? "me" : ""}
                  >
                    <td>{r.place}</td>
                    <td>{r.display_name}</td>
                    <td>{r.rating}</td>
                    <td>{r.wins}</td>
                    <td>{r.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ros-online-note">{tr("No rated battles yet — be the first.")}</p>
          )}
        </section>
      )}
    </div>
  );
}
