#!/usr/bin/env node
/* ============================================================
   Reign of Swords — MAP RUNNER: every map of both episodes played start to finish, as an end-to-end test and a
   difficulty rating.

     npm run e2e:maps                                   campaign + raids + battlefields, both episodes
     npm run e2e:maps -- --groups story,siege           only the campaign and the raids
     npm run e2e:maps -- --ep 2 --maps 5417,5600        a few maps of one episode
     npm run e2e:maps -- --seeds 5 --strategies attack,safe --armies line --jobs 12
     npm run e2e:maps -- --realistic-siege               with the ⚙ Realistic siege setting on (default: original)

   Each battle is the Battle Lab's simulator (engine/sim.js): the Autopilot plays your side against the real AI, over
   several dice seeds and Autopilot strategies, with two armies built from the map's own budget — "wizards" (the
   Battle Lab's suggestion: every elite slot a Wizard, a Priest, then Pikemen / Crossbowmen / Swordsmen) and "line"
   (no elite unit: a Priest, Knights, Pikemen, Crossbowmen, Archers, Swordsmen). A map without a budget brings its
   own forces and is played once per strategy and seed. The battles are split over parallel vitest processes
   (vitest.e2e.config.js → src/reign-of-swords/e2e/maps.e2e.js).

   END-TO-END CHECK — a battle that throws, never ends (neither won nor lost) or logs a console error is a PROBLEM:
   they are listed first in the report and the run exits with code 1.

   DIFFICULTY — per map and army, from its best Autopilot strategy (the approach a player would pick):
     rating = 10 × (0.65 × (1 − win rate) + 0.25 × (1 − army kept in wins) + 0.10 × (share of the turn limit used))
   0 = always won, nothing lost, at once · 10 = never won. A map's rating is the mean of its two armies'. Easy < 2 ≤ Normal < 4 ≤ Hard < 6 ≤ Very hard < 8 ≤ Brutal.
   The Autopilot plays worse than a careful player, so read the ratings as relative (map against map), and a map's
   absolute numbers as an upper bound on how hard it is.

   Output: reports/ros-e2e/<date-time>/report.md (+ report.json with every battle, shard logs) and a summary here.
   ============================================================ */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EP_DIR = { 1: "public/games/reign-of-swords", 2: "public/games/reign-of-swords-2" };
const GROUP_NAME = { story: "Campaign", siege: "Raid", skirmish: "Battlefield", special: "Tutorial" };
const EP_NAME = { 1: "Episode I", 2: "Episode II" };

// ---------------------------------------------------------------- options
function options(argv) {
  const opt = {
    ep: [1, 2],
    groups: ["story", "siege", "skirmish"],
    strategies: ["attack", "advance", "safe"],
    armies: ["wizards", "line"],
    seeds: 3,
    maps: null,
    jobs: Math.max(1, Math.min(16, cpus().length - 2)),
    out: null,
    realisticSiege: false,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--realistic-siege") {
      opt.realisticSiege = true;
      continue;
    }
    const [flag, inline] = argv[i].split("=");
    const value = inline != null ? inline : argv[++i];
    const list = () => String(value).split(",").filter(Boolean);
    if (flag === "--ep") opt.ep = list().map(Number);
    else if (flag === "--groups") opt.groups = value === "all" ? Object.keys(GROUP_NAME) : list();
    else if (flag === "--strategies") opt.strategies = list();
    else if (flag === "--armies") opt.armies = list();
    else if (flag === "--seeds") opt.seeds = Number(value);
    else if (flag === "--maps") opt.maps = new Set(list().map(Number));
    else if (flag === "--jobs") opt.jobs = Number(value);
    else if (flag === "--out") opt.out = value;
    else if (flag === "--help" || flag === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else throw new Error("unknown option " + flag);
  }
  return opt;
}

// ---------------------------------------------------------------- the maps
function levelsOf(ep) {
  const data = JSON.parse(readFileSync(join(ROOT, EP_DIR[ep], "levels.json"), "utf8"));
  return data.levels || data;
}

// ---------------------------------------------------------------- one shard = one vitest process
function runShard(shard, dir, realisticSiege) {
  const jobsFile = join(dir, `shard-${shard.id}.jobs.json`),
    outFile = join(dir, `shard-${shard.id}.json`),
    progressFile = join(dir, `shard-${shard.id}.progress`),
    logFile = join(dir, `shard-${shard.id}.log`);
  writeFileSync(jobsFile, JSON.stringify(shard.jobs));
  writeFileSync(progressFile, "");
  const vitest = join(ROOT, "node_modules", "vitest", "vitest.mjs");
  return {
    progressFile,
    outFile,
    done: new Promise((resolve) => {
      const child = spawn(process.execPath, [vitest, "run", "--config", "vitest.e2e.config.js"], {
        cwd: ROOT,
        env: {
          ...process.env,
          ROS_E2E_EP: String(shard.ep),
          ROS_E2E_JOBS: jobsFile,
          ROS_E2E_OUT: outFile,
          ROS_E2E_PROGRESS: progressFile,
          ROS_E2E_REALISTIC_SIEGE: realisticSiege ? "1" : "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      child.stdout.on("data", (d) => (log += d));
      child.stderr.on("data", (d) => (log += d));
      child.on("close", (code) => {
        writeFileSync(logFile, log);
        resolve(code);
      });
    }),
  };
}

const countLines = (file) => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

// ---------------------------------------------------------------- the rating
const label = (r) => (r < 2 ? "Easy" : r < 4 ? "Normal" : r < 6 ? "Hard" : r < 8 ? "Very hard" : "Brutal");
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// One army on one map: each strategy's win rate, army kept and turns; the best strategy gives the rating.
function rateArmy(map, runs) {
  const finished = runs.filter((r) => r.result === "victory" || r.result === "defeat");
  const byStrategy = {};
  for (const r of finished) (byStrategy[r.strategy] = byStrategy[r.strategy] || []).push(r);
  const perStrategy = Object.entries(byStrategy).map(([strategy, rs]) => {
    const wins = rs.filter((r) => r.result === "victory");
    const winRate = wins.length / rs.length;
    // army kept: the points left (a map with its own forces: the share of units left)
    const kept = wins.length
      ? mean(
          wins.map((r) =>
            map.budget ? r.kept : (100 * r.mineLeft) / Math.max(1, (r.start && r.start.mine) || r.mineLeft),
          ),
        )
      : 0;
    const turnShare = wins.length ? mean(wins.map((r) => Math.min(1, r.turn / (map.turnLimit || 30)))) : 1;
    const rating = 10 * (0.65 * (1 - winRate) + 0.25 * (1 - Math.min(100, kept) / 100) + 0.1 * turnShare);
    const turns = wins.length ? mean(wins.map((r) => r.turn)) : null;
    return { strategy, runs: rs.length, wins: wins.length, winRate, kept, turns, rating };
  });
  perStrategy.sort((x, y) => x.rating - y.rating);
  return { best: perStrategy[0] || null, perStrategy };
}

function rate(map, runs) {
  const armies = {};
  for (const r of runs) (armies[r.army] = armies[r.army] || []).push(r);
  const byArmy = {};
  for (const [army, rs] of Object.entries(armies)) {
    const rated = rateArmy(map, rs);
    if (rated.best) byArmy[army] = rated;
  }
  const ratings = Object.values(byArmy).map((x) => x.best.rating);
  const rating = ratings.length ? Math.round(mean(ratings) * 10) / 10 : null;
  const finished = runs.filter((r) => r.result === "victory" || r.result === "defeat");
  const reasons = {};
  for (const r of finished) if (r.result === "defeat") reasons[r.reason || "?"] = (reasons[r.reason || "?"] || 0) + 1;
  return {
    ...map,
    battles: runs.length,
    wins: finished.filter((r) => r.result === "victory").length,
    finished: finished.length,
    byArmy,
    rating,
    label: rating != null ? label(rating) : "—",
    reasons,
  };
}

// ---------------------------------------------------------------- the report
function problemsOf(results) {
  const out = [];
  for (const r of results) {
    if (r.result === "error") out.push({ r, what: "error", detail: r.error });
    else if (r.result === "unfinished") out.push({ r, what: "never ended", detail: `still turn ${r.turn}` });
    if (r.consoleErrors && r.consoleErrors.length) out.push({ r, what: "console error", detail: r.consoleErrors[0] });
  }
  return out;
}

function markdown(opt, rated, problems, results, seconds) {
  const lines = [];
  lines.push(`# Reign of Swords — map runner report`, "");
  lines.push(
    `${new Date().toLocaleString("sv-SE").slice(0, 16)} · ${results.length} battles in ${Math.round(seconds)} s · ` +
      `${opt.groups.map((g) => GROUP_NAME[g] || g).join(", ")} · armies ${opt.armies.join(", ")} · strategies ${opt.strategies.join(", ")} · ${opt.seeds} seeds · ` +
      `Realistic siege ${opt.realisticSiege ? "ON" : "off (original)"}`,
    "",
  );
  lines.push(
    "The Autopilot plays your side (an army built from each map's budget, or the map's own forces) against the real AI. " +
      "It plays worse than a careful player: compare maps with each other, and read a rating as an upper bound.",
    "",
  );
  lines.push(`## Problems (${problems.length})`, "");
  if (!problems.length) lines.push("None — every battle ran to a win or a loss without an error.", "");
  else {
    lines.push("| Episode | Map | Army | Strategy | Seed | Problem | Detail |", "|---|---|---|---|---|---|---|");
    for (const p of problems)
      lines.push(
        `| ${p.r.ep} | ${p.r.mapId} ${p.r.name || ""} | ${p.r.army} | ${p.r.strategy} | ${p.r.seed} | ${p.what} | ${String(
          p.detail || "",
        )
          .replace(/\|/g, "/")
          .slice(0, 200)} |`,
      );
    lines.push("");
  }
  for (const ep of opt.ep) {
    const maps = rated.filter((m) => m.ep === ep && m.rating != null).sort((a, b) => b.rating - a.rating);
    if (!maps.length) continue;
    lines.push(`## ${EP_NAME[ep]} — hardest first`, "");
    lines.push(
      "| # | Map | Kind | Rating | | Wizards army | Line army | Won (all) | Losses by |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    const cell = (x, m) =>
      !x
        ? "—"
        : `${x.best.rating.toFixed(1)} · ${x.best.strategy} ${x.best.wins}/${x.best.runs}` +
          (x.best.wins
            ? ` · kept ${Math.round(x.best.kept)}% · ${x.best.turns.toFixed(0)}/${m.turnLimit || 30} turns`
            : "");
    maps.forEach((m, i) => {
      const losses = Object.entries(m.reasons)
        .map(([k, n]) => `${k} ×${n}`)
        .join(", ");
      const own = m.byArmy.own;
      const kind = `${GROUP_NAME[m.group] || m.group}${m.budget ? ` (${m.budget} pts)` : " (own forces)"}`;
      const first = own ? cell(own, m) : cell(m.byArmy.wizards, m),
        second = own ? "(same forces)" : cell(m.byArmy.line, m);
      lines.push(
        `| ${i + 1} | ${m.mapId} ${m.name} | ${kind} | ${m.rating.toFixed(1)} | ${m.label} | ${first} | ${second} | ${m.wins}/${m.finished} | ${losses || "—"} |`,
      );
    });
    const byGroup = {};
    for (const m of maps) (byGroup[m.group] = byGroup[m.group] || []).push(m.rating);
    lines.push(
      "",
      "Average rating: " +
        Object.entries(byGroup)
          .map(([g, rs]) => `${GROUP_NAME[g] || g} ${mean(rs).toFixed(1)}`)
          .join(" · "),
      "",
    );
  }
  const skipped = results.filter((r) => r.result === "skipped");
  if (skipped.length)
    lines.push(
      `Skipped (level records the game never offers): ${[...new Set(skipped.map((r) => `${r.ep}:${r.mapId}`))].join(", ")}`,
      "",
    );
  return lines.join("\n");
}

// ---------------------------------------------------------------- main
async function main() {
  const opt = options(process.argv);
  const now = new Date(),
    two = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const dir = opt.out ? join(ROOT, opt.out) : join(ROOT, "reports", "ros-e2e", stamp);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(ROOT, "node_modules", "vitest"))) throw new Error("vitest is not installed — run npm install");

  // the maps and the battle list
  const maps = [];
  for (const ep of opt.ep)
    for (const l of levelsOf(ep))
      if (opt.groups.includes(l.group) && (!opt.maps || opt.maps.has(l.mapId)))
        maps.push({
          ep,
          mapId: l.mapId,
          name: l.name,
          group: l.group,
          kingdom: l.kingdom,
          budget: l.budget || 0,
          turnLimit: l.turnLimit || 0,
        });
  const jobsByEp = {};
  for (const m of maps)
    for (const army of m.budget ? opt.armies : ["own"])
      for (const strategy of opt.strategies)
        for (let seed = 1; seed <= opt.seeds; seed++)
          (jobsByEp[m.ep] = jobsByEp[m.ep] || []).push({ mapId: m.mapId, budget: m.budget, army, strategy, seed });
  const total = Object.values(jobsByEp).reduce((s, j) => s + j.length, 0);
  if (!total) throw new Error("no maps match the options");

  // shards: each episode gets a share of the processes by its battle count; battles dealt round-robin
  const shards = [];
  for (const [ep, jobs] of Object.entries(jobsByEp)) {
    const n = Math.max(1, Math.round((opt.jobs * jobs.length) / total));
    const parts = Array.from({ length: Math.min(n, jobs.length) }, () => []);
    jobs.forEach((j, i) => parts[i % parts.length].push(j));
    for (const part of parts) shards.push({ id: shards.length, ep: Number(ep), jobs: part });
  }
  console.log(`Map runner: ${maps.length} maps, ${total} battles over ${shards.length} processes → ${dir}`);
  const t0 = Date.now();
  const running = shards.map((s) => runShard(s, dir, opt.realisticSiege));
  const timer = setInterval(() => {
    const done = running.reduce((s, r) => s + countLines(r.progressFile), 0);
    const secs = (Date.now() - t0) / 1000;
    const eta = done ? Math.round((secs / done) * (total - done)) : null;
    process.stdout.write(
      `\r  ${done}/${total} battles · ${Math.round(secs)} s${eta != null ? ` · ~${eta} s left` : ""}   `,
    );
  }, 2000);
  const codes = await Promise.all(running.map((r) => r.done));
  clearInterval(timer);
  const seconds = (Date.now() - t0) / 1000;
  process.stdout.write("\n");

  // gather
  const results = [];
  running.forEach((r, i) => {
    try {
      results.push(...JSON.parse(readFileSync(r.outFile, "utf8")));
    } catch {
      results.push({
        ep: shards[i].ep,
        mapId: 0,
        strategy: "-",
        seed: 0,
        result: "error",
        error: `shard ${i} wrote no results (exit ${codes[i]}) — see shard-${i}.log`,
      });
    }
  });
  const byMap = new Map(maps.map((m) => [m.ep + ":" + m.mapId, { map: m, runs: [] }]));
  for (const r of results) {
    const entry = byMap.get(r.ep + ":" + r.mapId);
    if (entry) {
      r.name = entry.map.name;
      entry.runs.push(r);
    }
  }
  const rated = [...byMap.values()].map(({ map, runs }) => rate(map, runs));
  const problems = problemsOf(results);
  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify(
      {
        options: { ...opt, maps: opt.maps ? [...opt.maps] : null },
        seconds,
        maps: rated,
        problems: problems.map((p) => ({ ...p.r, problem: p.what, detail: p.detail })),
        battles: results,
      },
      null,
      1,
    ),
  );
  const md = markdown(opt, rated, problems, results, seconds);
  writeFileSync(join(dir, "report.md"), md);

  // summary here
  for (const ep of opt.ep) {
    const top = rated.filter((m) => m.ep === ep && m.rating != null).sort((a, b) => b.rating - a.rating);
    if (!top.length) continue;
    console.log(`\n${EP_NAME[ep]} — hardest first (rating 0–10):`);
    for (const m of top)
      console.log(
        `  ${m.rating.toFixed(1).padStart(4)} ${m.label.padEnd(9)} ${String(m.mapId).padEnd(5)} ${m.name}  [${GROUP_NAME[m.group] || m.group}, won ${m.wins}/${m.finished}]`,
      );
  }
  console.log(
    `\n${problems.length ? `PROBLEMS: ${problems.length} (see the report)` : "No problems: every battle ran to an end without an error."}`,
  );
  console.log(`Report: ${join(dir, "report.md")}`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
