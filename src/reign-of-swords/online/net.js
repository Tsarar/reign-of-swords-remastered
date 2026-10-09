/* ============================================================
   Reign of Swords — the online battles' network side (Supabase; schema in supabase/schema.sql).
   Lobbies and the turn hand-over go through the database functions (they check whose turn it is, the clock and the
   lobby password); live moves go over the match's private Realtime channel "match:<id>", which only its two players
   may join. Every call needs a signed-in player.
   ============================================================ */

import { getSupabase } from "../../lib/supabase.js";

const MATCH_COLUMNS =
  "id, name, has_password, episode, map_id, budget, guest_budget, host_medals, guest_medals, first_pick, turn_seconds, " +
  "host_id, guest_id, host_name, guest_name, status, " +
  "seed, first_id, host_ready, guest_ready, turn_owner, turn_no, turn_deadline, winner_id, end_reason, rating_delta, " +
  "created_at, updated_at";
export const GAME_OF_EPISODE = { 1: "reign-of-swords", 2: "reign-of-swords-2" };

const ok = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const db = async () => {
  const sb = await getSupabase();
  if (!sb) throw new Error("Online battles are not available on this build.");
  return sb;
};

// Open lobbies of this episode (the last day's), and the player's own unfinished matches.
export async function listLobbies(episode, me) {
  const sb = await db();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [open, mine] = await Promise.all([
    sb
      .from("matches")
      .select(MATCH_COLUMNS)
      .eq("status", "waiting")
      .eq("episode", episode)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(ok),
    sb
      .from("matches")
      .select(MATCH_COLUMNS)
      .in("status", ["waiting", "deploying", "playing"])
      .eq("episode", episode)
      .or(`host_id.eq.${me},guest_id.eq.${me}`)
      .order("updated_at", { ascending: false })
      .limit(20)
      .then(ok),
  ]);
  return { open: open.filter((m) => m.host_id !== me), mine };
}
export async function getMatch(id) {
  return (await db())
    .from("matches")
    .select(MATCH_COLUMNS + ", state")
    .eq("id", id)
    .single()
    .then(ok);
}
// budgets: [host, guest] gold; medals: [host, guest] elite slots (null = 1 per 1000 gold); first: "coin" | "host" | "guest"
export async function createMatch({ name, password, episode, mapId, budgets, medals, first, turnSeconds }) {
  return (await db())
    .rpc("create_match", {
      p_name: name,
      p_password: password || "",
      p_episode: episode,
      p_map_id: mapId,
      p_budget: budgets[0],
      p_guest_budget: budgets[1],
      p_host_medals: medals ? medals[0] : null,
      p_guest_medals: medals ? medals[1] : null,
      p_first: first || "coin",
      p_turn_seconds: turnSeconds,
    })
    .then(ok);
}
export const joinMatch = async (id, password) =>
  (await db()).rpc("join_match", { p_match: id, p_password: password || "" }).then(ok);
export const cancelMatch = async (id) => (await db()).rpc("cancel_match", { p_match: id }).then(ok);
export const submitDeploy = async (id, army) =>
  (await db()).rpc("submit_deploy", { p_match: id, p_units: army }).then(ok);
export const matchDeploys = async (id) => (await db()).rpc("match_deploys", { p_match: id }).then(ok);
export const submitTurn = async (id, turnNo, state, log) =>
  (await db()).rpc("submit_turn", { p_match: id, p_turn_no: turnNo, p_state: state, p_log: log || [] }).then(ok);
export const reportDefeat = async (id, forfeit = false) =>
  (await db()).rpc("report_defeat", { p_match: id, p_forfeit: forfeit }).then(ok);
export const claimTimeout = async (id) => (await db()).rpc("claim_timeout", { p_match: id }).then(ok);
export async function leaderboard(game) {
  return (await db())
    .from("leaderboard")
    .select("place, display_name, rating, wins, losses")
    .eq("game", game)
    .order("place")
    .then(ok);
}

// Follow one match: its row (the lobby filling, the turn hand-over, the end) and the live moves of its channel.
// Returns { send(cmd), close() }.
// onPresence(ids): the players whose page is on this match right now (Realtime presence; it drops a closed tab at
// once and a lost connection within about half a minute).
export async function followMatch(id, { me, onRow, onCommand, onStatus, onPresence }) {
  const sb = await db();
  const rows = sb
    .channel("match-row:" + id)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "matches", filter: "id=eq." + id },
      (p) => onRow && onRow(p.new),
    )
    .subscribe();
  const live = sb.channel("match:" + id, {
    config: { private: true, broadcast: { self: false, ack: false }, presence: { key: me || "" } },
  });
  live
    .on("broadcast", { event: "cmd" }, ({ payload }) => onCommand && onCommand(payload))
    .on("presence", { event: "sync" }, () => onPresence && onPresence(Object.keys(live.presenceState())))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") live.track({ at: new Date().toISOString() }).catch(() => {});
      if (onStatus) onStatus(status);
    });
  return {
    send: (cmd) => live.send({ type: "broadcast", event: "cmd", payload: cmd }),
    close: () => {
      sb.removeChannel(rows);
      sb.removeChannel(live);
    },
  };
}
// Lobby list updates (a new lobby, one filling or closing) for the lobby screen.
export async function followLobbies(onChange) {
  const sb = await db();
  const ch = sb
    .channel("lobbies")
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => onChange())
    .subscribe();
  return () => sb.removeChannel(ch);
}
