// One shard of the map runner (tools/ros/e2e-maps.mjs): plays its list of battles start to finish with the Battle Lab's
// simulator (engine/sim.js — the Autopilot on your side) and writes each result. A battle that throws, ends neither won
// nor lost, or logs a console error is recorded as a problem; the driver turns the results into the report.
//   ROS_E2E_EP        episode (1 or 2)
//   ROS_E2E_JOBS      a JSON file: [{ mapId, budget, army, strategy, seed }] — army "wizards" (sim.js suggestArmy) or
//                     "line" (lineArmy); budget 0 = the map brings its own forces
//   ROS_E2E_OUT       where this shard writes its results (JSON)
//   ROS_E2E_PROGRESS  a file this shard appends one line to per finished battle
//   ROS_E2E_REALISTIC_SIEGE  "1" = the ⚙ Realistic siege setting on (default: the original's shooter leash)
import { it } from "vitest";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

import { loadEpisode } from "../__tests__/battle.js";
import { simulateBattle, suggestArmy, lineArmy, armyCost } from "../engine/sim.js";
import { missionList } from "../engine/engine.js";
import { SANDBOX_ARMY, SANDBOX_ARMY_EP2 } from "../data/shell-data.js";

const EP = Number(process.env.ROS_E2E_EP || 1);
const JOBS = process.env.ROS_E2E_JOBS ? JSON.parse(readFileSync(process.env.ROS_E2E_JOBS, "utf8")) : [];
const OUT = process.env.ROS_E2E_OUT;
const PROGRESS = process.env.ROS_E2E_PROGRESS;
const REALISTIC_SIEGE = process.env.ROS_E2E_REALISTIC_SIEGE === "1";

it(`episode ${EP}: ${JOBS.length} battles`, async () => {
  await loadEpisode(EP);
  const roster = EP === 2 ? SANDBOX_ARMY_EP2 : SANDBOX_ARMY;
  const playable = new Set(missionList().map((m) => m.mapId)); // a level record the game never offers is skipped
  const results = [];
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) =>
    logged.push(
      args
        .map((a) => (a && a.stack) || String(a))
        .join(" ")
        .slice(0, 400),
    );
  try {
    for (const job of JOBS) {
      const budget = job.budget || 0;
      const army = !budget ? {} : job.army === "line" ? lineArmy(budget) : suggestArmy(budget);
      const started = Date.now();
      logged.length = 0;
      let row;
      if (!playable.has(job.mapId)) row = { result: "skipped" };
      else
        try {
          const r = await simulateBattle({
            mapId: job.mapId,
            army,
            roster,
            strategy: job.strategy,
            seed: job.seed,
            realisticSiege: REALISTIC_SIEGE,
            yieldMs: 0,
          });
          row = {
            result: r.result,
            major: r.major,
            reason: r.reason,
            turn: r.turn,
            spent: r.spent,
            kept: r.kept,
            mineLeft: r.mineLeft,
            foesLeft: r.foesLeft,
            alliesLeft: r.alliesLeft,
            start: r.timeline && r.timeline[0] ? r.timeline[0] : null,
          };
        } catch (e) {
          row = {
            result: "error",
            error: String((e && e.stack) || e)
              .split("\n")
              .slice(0, 3)
              .join(" | "),
          };
        }
      results.push({
        ...job,
        ep: EP,
        budget,
        armyPoints: budget ? armyCost(army) : 0,
        ...row,
        consoleErrors: logged.slice(0, 3),
        ms: Date.now() - started,
      });
      if (PROGRESS) appendFileSync(PROGRESS, `${job.mapId} ${job.strategy} ${job.seed} ${row.result}\n`);
      writeFileSync(OUT, JSON.stringify(results));
    }
  } finally {
    console.error = consoleError;
    writeFileSync(OUT, JSON.stringify(results));
  }
});
