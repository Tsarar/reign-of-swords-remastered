/* ============================================================
   Reign of Swords — the AI as its own object (game.ai).
   One AiController per battle runs every AI-controlled side (the enemy and allied armies). It is assembled from
   three files by concern, like Game: ai.js (per-unit decisions), aimove.js (path-finding and movement choice, the
   original's movers) and grouplogic.js (armies acting as groups). It READS and ACTS ON the battle through
   this.game — the rules' queries (reach, damage, terrain) and the battle's actions (moveUnit, doAttack) — and the
   battle calls in only at a few points: aiStep / autopilotStep (the loop), _glSetMode / _glHit (scripts, combat) and
   _garrisonCheckRelease (portal warps).
   ============================================================ */
import { mixInto } from "../util/mixin.js";
import { AiMethods } from "./ai.js";
import { AiMoveMethods } from "./aimove.js";
import { GroupMethods } from "./grouplogic.js";
import { AutopilotMethods } from "./autopilot.js";

export class AiController {
  constructor(game) {
    this.game = game;
  }
}
mixInto(
  AiController,
  {
    AiMethods, // ai/ai.js — per-unit AI decisions
    AiMoveMethods, // ai/aimove.js — AI path-finding and movement choice
    GroupMethods, // ai/grouplogic.js — armies acting as groups
    AutopilotMethods, // ai/autopilot.js — your own army played by the AI (Battle Lab)
  },
  "AiController",
);
