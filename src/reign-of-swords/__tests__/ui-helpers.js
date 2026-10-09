// Shared helpers for the battle-screen UI tests (ui-*.test.jsx). The test file mocks ../engine.js's mountReign with
// a fake controller (every action a vi.fn) that captures the component's `onState` callback, so a test can push any
// engine state snapshot and assert what the battle screen shows / which controller action a click calls.
import { vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";

// The battle screen's own initial state (ui/ReignOfSwords.jsx useState) — every push starts from it.
export const BASE_STATE = {
  phase: "player",
  turn: 1,
  turnLimit: 24,
  blue: 0,
  red: 0,
  canEnd: false,
  selected: null,
  mode: "select",
  canOrder: false,
  orderMode: null,
  marching: false,
  mission: null,
  objectives: { total: 0, held: 0, morale: false },
};

export const MISSIONS = [
  { index: 0, mapId: 100, name: "The Opening", group: "story", cols: 20, rows: 15 },
  { index: 1, mapId: 200, name: "Green Field", group: "skirmish", cols: 30, rows: 22 },
  { index: 2, mapId: 300, name: "Drill Yard", group: "special", cols: 12, rows: 10 },
];

// A mission record as the engine's state carries it (`s.mission`).
export const mission = (over = {}) => ({
  index: 1,
  mapId: 200,
  name: "Green Field",
  kingdom: "Bordavia",
  subtitle: "A test of arms",
  briefing: "The enemy waits beyond the river.",
  objectiveText: "Destroy the enemy army.",
  group: "skirmish",
  ...over,
});

const ACTIONS = [
  "endTurn",
  "undoMove",
  "holdUnit",
  "nextUnit",
  "beginMarch",
  "cancelAim",
  "aimSkill",
  "setRetribPreview",
  "shapeshift",
  "invokeRetribution",
  "invokeShield",
  "confirmSkip",
  "cancelSkip",
  "reset",
  "setPlacing",
  "startBattle",
  "openBattle",
  "setMusterHold",
  "releaseMuster",
  "eventClosed",
  "focusEventLine",
  "setFastForward",
  "setInputLocked",
  "selectMission",
  "setSfxMuted",
  "setMusicMuted",
  "nextTrack",
  "destroy",
];
export function makeCtrl(missions = MISSIONS) {
  const c = { missions, game: { resize: vi.fn() } };
  for (const f of ACTIONS) c[f] = vi.fn();
  c.debugDump = vi.fn(() => ({ turn: 3, units: 7 }));
  c.casualtyReport = vi.fn(() => ({ lost: { militiamen: 2 } }));
  c.shownLines = vi.fn(() => ["line-a"]);
  return c;
}

// Render the battle screen against the mocked mountReign and wait until the engine "mounted".
// Returns { ctrl, opts, push, ...renderResult }; push(state) sends an engine state snapshot (merged over BASE_STATE).
export async function mountBattle(mountReign, Component, props = {}, { missions = MISSIONS, ctrl } = {}) {
  const c = ctrl || makeCtrl(missions);
  const h = { ctrl: c };
  mountReign.mockImplementation(async (host, opts) => {
    h.host = host;
    h.opts = opts;
    return c;
  });
  const r = render(createElement(Component, props));
  await waitFor(() => {
    if (r.container.querySelector(".ros-loading")) throw new Error("still loading");
  });
  // let the effects that follow the mount (engine settings, input lock) settle before a test reads them
  await act(async () => {
    await new Promise((res) => setTimeout(res, 0));
  });
  h.push = (st) =>
    act(() => {
      h.opts.onState({ ...BASE_STATE, ...st });
    });
  return { ...r, ...h };
}
