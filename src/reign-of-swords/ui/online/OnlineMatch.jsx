import { useEffect, useMemo, useRef, useState } from "react";
import ReignOfSwords from "../ReignOfSwords.jsx";
import { tr } from "../../i18n/i18n.js";
import * as net from "../../online/net.js";

// One online battle: follows the match (its row and its live channel) and drives the engine's online side
// (engine/online.js) — muster, the opponent's live moves, the stored turn, the turn clock, the result.
const GRACE_S = 12; // the server accepts a turn up to 10 s late; a timeout can be claimed a little after that

export default function OnlineMatch({ matchId, userId, army, battleProps, onExit }) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [oppHere, setOppHere] = useState(null); // is the opponent's page on this match (null = not known yet)
  const rowRef = useRef(null);
  const gameRef = useRef(null);
  const linkRef = useRef(null);
  const reported = useRef(false);
  const beginning = useRef(false);
  const queued = useRef([]); // live moves that arrive before the engine is up
  const pendingSync = useRef(null); // the opponent's stored turn, applied once the live replay has caught up

  const me = row ? (row.host_id === userId ? 0 : 1) : 0;
  const myTurn = !!row && row.status === "playing" && row.turn_owner === userId;

  // The battle opens once both armies are in; a reload mid-battle resumes from the stored turn.
  const begin = async (r) => {
    const game = gameRef.current;
    if (!game || !game.online || game.online.begun || beginning.current || r.status === "waiting") return;
    if (r.status !== "playing" && r.status !== "finished") return;
    beginning.current = true;
    try {
      const deploys = await net.matchDeploys(r.id);
      game.onlineBegin(deploys || {});
      const full = await net.getMatch(r.id);
      if (full.state && full.turn_no > 1) {
        const mover = full.turn_owner === full.host_id ? 1 : 0; // the side whose turn was stored last
        game.onlineSync(full.state, mover);
      }
    } catch (e) {
      setError(e.message || String(e));
    }
    beginning.current = false;
  };
  const onRow = (r) => {
    rowRef.current = { ...(rowRef.current || {}), ...r };
    setRow(rowRef.current);
    const game = gameRef.current;
    if (!game || !game.online) return;
    if (!game.online.begun) return begin(rowRef.current);
    // the opponent's turn is stored: line up with it once the live replay has played it out (a no-op if it matches)
    if (r.status === "playing" && r.turn_owner === userId && r.state)
      pendingSync.current = { state: r.state, at: Date.now() };
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await net.getMatch(matchId);
        if (!alive) return;
        rowRef.current = r;
        setRow(r);
        linkRef.current = await net.followMatch(matchId, {
          me: userId,
          onPresence: (ids) => {
            const opp = r.host_id === userId ? rowRef.current && rowRef.current.guest_id : r.host_id;
            if (alive && opp) setOppHere(ids.includes(opp));
          },
          onRow: (n) => alive && onRow(n),
          onCommand: (cmd) => {
            if (gameRef.current) gameRef.current.onlineReceive(cmd);
            else queued.current.push(cmd);
          },
        });
      } catch (e) {
        if (alive) setError(e.message || String(e));
      }
    })();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(tick);
      if (linkRef.current) linkRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // The engine's online settings, fixed once the lobby is full (seed and first mover come from the join).
  const online = useMemo(() => {
    if (!row || !row.seed || row.status === "waiting" || row.status === "cancelled") return null;
    return {
      me,
      seed: Number(row.seed),
      first: row.first_id === row.host_id ? 0 : 1,
      names: [row.host_name || "Host", row.guest_name || "Guest"],
      budgets: [row.budget, row.guest_budget || row.budget],
      elites: [row.host_medals, row.guest_medals], // null = 1 per 1000 gold
      mapId: row.map_id,
      send: (cmd) => linkRef.current && linkRef.current.send(cmd),
      onDeploy: (army) => net.submitDeploy(matchId, army).catch((e) => setError(e.message)),
      onTurnEnd: async (snap) => {
        // the live replay can reach this point before the database has handed this turn over: wait for it (≤ 15 s)
        for (let i = 0; i < 60 && rowRef.current && rowRef.current.turn_owner !== userId; i++)
          await new Promise((res) => setTimeout(res, 250));
        net.submitTurn(matchId, rowRef.current.turn_no, snap, []).catch((e) => setError(e.message));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row && row.seed, row && row.status === "waiting"]);

  const onEngine = (ctrl) => {
    gameRef.current = ctrl.game;
    for (const cmd of queued.current.splice(0)) ctrl.game.onlineReceive(cmd);
    if (rowRef.current) begin(rowRef.current);
  };

  // Every second: the clock (my time up → my turn ends itself), and the result (the loser reports it).
  useEffect(() => {
    const game = gameRef.current;
    const r = rowRef.current;
    if (!game || !r || !game.online) return;
    const sync = pendingSync.current;
    if (sync && (game.onlineMyTurn() || Date.now() - sync.at > 8000)) {
      pendingSync.current = null;
      game.onlineSync(sync.state, me === 0 ? 1 : 0);
    }
    const over = game.phase === "victory" || game.phase === "defeat";
    if (over && !reported.current && r.status === "playing") {
      const winner = game.phase === "victory" ? game.hs.active : 1 - game.hs.active;
      if (winner !== me) {
        reported.current = true;
        net.reportDefeat(matchId).catch((e) => setError(e.message));
      }
    }
    const left = r.turn_deadline ? (new Date(r.turn_deadline).getTime() - now) / 1000 : null;
    if (left != null && left <= 0 && !over) {
      if (r.status === "playing" && r.turn_owner === userId) game.endTurn();
      else if (r.status === "deploying" && !game.online.deployed && game.canStartBattle()) game.startBattle();
    }
  }, [now, me, matchId, userId]);

  const leftS = row && row.turn_deadline ? Math.ceil((new Date(row.turn_deadline).getTime() - now) / 1000) : null;
  const iDeployed = row && (me === 0 ? row.host_ready : row.guest_ready);
  const theyDeployed = row && (me === 0 ? row.guest_ready : row.host_ready);
  const canClaim =
    row &&
    leftS != null &&
    leftS < -GRACE_S &&
    ((row.status === "playing" && row.turn_owner !== userId) ||
      (row.status === "deploying" && iDeployed && !theyDeployed));
  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };
  const clock = (s) => (s == null ? "" : s <= 0 ? "0:00" : Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"));
  const opponent = row ? (me === 0 ? row.guest_name : row.host_name) : "";

  let text = "";
  if (!row) text = tr("Connecting…");
  else if (row.status === "waiting") text = tr("Waiting for an opponent to join…");
  else if (row.status === "cancelled") text = tr("This lobby was closed.");
  else if (row.status === "deploying")
    text = iDeployed ? tr("Waiting for {name} to deploy…", { name: opponent }) : tr("Deploy your army");
  else if (row.status === "playing") text = myTurn ? tr("Your turn") : tr("{name}'s turn", { name: opponent });
  else if (row.status === "finished") {
    const won = row.winner_id === userId;
    const why = row.end_reason === "timeout" ? tr("on time") : row.end_reason === "forfeit" ? tr("by forfeit") : "";
    text =
      (won ? tr("Victory") : tr("Defeat")) +
      (why ? " " + why : "") +
      (row.rating_delta != null ? " · " + (won ? "+" : "−") + row.rating_delta + " " + tr("rating") : "");
  }

  const hud = (
    <div className={"ros-online-bar" + (myTurn ? " mine" : "")} role="status">
      <span className="ros-online-text">{text}</span>
      {row && (row.status === "playing" || row.status === "deploying") && leftS != null && (
        <span className={"ros-online-clock" + (leftS <= 15 ? " low" : "")}>⏱ {clock(leftS)}</span>
      )}
      {oppHere === false && row && (row.status === "playing" || row.status === "deploying") && !canClaim && (
        <span className="ros-online-away">
          ⚠{" "}
          {tr("{name} has left the battle — if they don't return before their clock runs out, you can claim victory.", {
            name: opponent,
          })}
        </span>
      )}
      {canClaim && (
        <button className="btn-run" disabled={busy} onClick={() => act(() => net.claimTimeout(matchId))}>
          {tr("Claim victory")}
        </button>
      )}
      {row && (row.status === "playing" || row.status === "deploying") && (
        <button
          className="btn-run"
          disabled={busy}
          onClick={() =>
            window.confirm(tr("Give up this battle? It counts as a loss.")) &&
            act(() => net.reportDefeat(matchId, true))
          }
        >
          {tr("Forfeit")}
        </button>
      )}
      {error && <span className="ros-online-err">{error}</span>}
    </div>
  );

  if (!online)
    return (
      <div className="ros-online-wait">
        {hud}
        {row && row.status === "waiting" && row.host_id === userId && (
          <button className="btn-run" onClick={() => net.cancelMatch(matchId).then(onExit, (e) => setError(e.message))}>
            {tr("Close the lobby")}
          </button>
        )}
        <button className="btn-run" onClick={onExit}>
          ◂ {tr("Back")}
        </button>
      </div>
    );
  return (
    <div className="ros-skirmish-wrap">
      <ReignOfSwords
        key={"online-" + matchId}
        {...battleProps}
        army={army}
        online={online}
        onEngine={onEngine}
        onlineHud={hud}
        onExit={onExit}
      />
    </div>
  );
}
