import { useEffect, useRef, useState } from "react";
import { mountReign } from "../../engine/engine.js";
import { autoDeploy, seedBattle } from "../../engine/sim.js";
import { base } from "../battle-ui.jsx";

// The state the engine starts from before its first snapshot arrives.
const INITIAL_STATE = {
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

// Mounts the battle engine on the stage element and keeps it in step with React:
//  • `s` is the engine's latest state snapshot (engine/engine.js _emit), `ctrlRef.current` its controller;
//  • a campaign battle (`campaignMapId`) opens that map at once, a skirmish opens on the first battlefield map;
//  • the canvas is re-fitted whenever the stage box changes size (phone layout swaps, rotation);
//  • mute and fast-forward follow the props / flags given here.
// `assetBase` lets Episode II drive the same engine off its own data folder; sprites and audio always come from
// Episode I's folder (`base`), a shared library.
export function useBattleEngine({
  campaignMapId,
  assetBase,
  army,
  godArmy,
  sfxMuted,
  musicMuted,
  fastFwd,
  autoplay,
  hotseat = false,
  online = null, // an online battle's engine settings (engine/online.js setOnline: me, seed, first, names, budget, mapId…)
  onEngine = null, // called once with the controller when the battle is up (the online match drives the engine)
  musterHold = null, // (mapId) => true when the screen asks "Previous Setup Found" first: the muster's opening waits
}) {
  const hostRef = useRef(null);
  const ctrlRef = useRef(null);
  const [state, setState] = useState(INITIAL_STATE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [missions, setMissions] = useState([]);

  useEffect(() => {
    let ctrl,
      cancelled = false;
    (async () => {
      try {
        ctrl = await mountReign(hostRef.current, {
          base: assetBase || base,
          spriteBase: base,
          onState: setState,
          sfxMuted,
          musicMuted,
          army,
          godArmy,
        });
        if (cancelled) {
          ctrl.destroy();
          return;
        }
        ctrlRef.current = ctrl;
        if (musterHold && ctrl.setMusterHold) ctrl.setMusterHold(musterHold); // before any openBattle below
        setMissions(ctrl.missions || []);
        if (online) {
          // ONLINE: the same hot-seat battle on two devices — set before the map is built, then straight to the muster
          ctrl.game.setOnline(online);
          const mission = (ctrl.missions || []).find((x) => x.mapId === online.mapId);
          if (mission) ctrl.selectMission(mission.index);
          ctrl.openBattle();
        } else if (campaignMapId != null) {
          const mission = (ctrl.missions || []).find((x) => x.mapId === campaignMapId);
          if (mission) ctrl.selectMission(mission.index);
          // A Battle Lab run being watched: the same turn limit and dice as the lab's run (engine/sim.js simulateBattle
          // does these in this order), and the Autopilot at the controls.
          if (autoplay) {
            if (autoplay.turnLimit) ctrl.game.mission = { ...ctrl.game.mission, turnLimit: autoplay.turnLimit };
            seedBattle(ctrl.game, autoplay.seed);
          }
          ctrl.openBattle(); // the shell already showed the story cutscene: open the battle now
          if (autoplay) ctrl.setAutopilot(autoplay.strategy);
        } else {
          // Skirmish screen: open on the first BATTLEFIELD map, not the campaign's scripted opening mission (hot-seat:
          // two players on one device — set before the map is built, engine/hotseat.js)
          if (hotseat) ctrl.setHotseat(true);
          const skirmish = (ctrl.missions || []).find((x) => x.group === "skirmish");
          if (skirmish) ctrl.selectMission(skirmish.index);
        }
        setReady(true);
        if (onEngine) onEngine(ctrl);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (ctrl) ctrl.destroy();
    };
    // Mount once: the shell gives each battle its own component, and mute / fast-forward follow the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit the canvas whenever the STAGE box changes size — the window "resize" event misses layout-only changes
  // (the phone layout swapping the muster for the controls, rotation). The stage has min-height 0 and the canvas
  // never exceeds it, so this can't feed back into a loop.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frameReq = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameReq);
      frameReq = requestAnimationFrame(() => {
        const ctrl = ctrlRef.current;
        if (ctrl && ctrl.game) ctrl.game.resize();
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameReq);
    };
  }, []);

  // Music and Effects mute independently (owned by the shell); fast-forward.
  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.setSfxMuted(sfxMuted);
  }, [sfxMuted]);
  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.setMusicMuted(musicMuted);
  }, [musicMuted]);
  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.setFastForward(fastFwd);
  }, [fastFwd, ready]);

  // Battle Lab "Watch": once the muster is open and its opening lines are read, muster the run's army and start.
  const musteredRef = useRef(false);
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!autoplay || musteredRef.current || !ctrl || !ready || state.phase !== "deploy" || state.battleEvent) return;
    const game = ctrl.game;
    if (game._sc && game._sc.queue && game._sc.queue.length) return;
    musteredRef.current = true;
    autoDeploy(game, autoplay.army);
    ctrl.startBattle();
  }, [autoplay, ready, state.phase, state.battleEvent]);

  return { hostRef, ctrlRef, state, ready, error, missions };
}
