import { useEffect, useRef, useState } from "react";
import { tr } from "../../i18n/i18n.js";
import { base } from "../battle-ui.jsx";

// The battle's buttons (one scrolling row on phones, a two-column grid in landscape — reign.css). Every action goes
// through the engine's controller `ctrl`; the rest are the screen's own (objectives, manual, restart, quit).
// When the row scrolls sideways (phone portrait) its clipped edges fade and show a ‹ / › arrow, so it's clear there are
// more buttons; tapping an arrow scrolls the row by most of its width.
export default function ControlRow({
  state,
  ctrl,
  fastFwd,
  onEndTurn,
  onToggleFast,
  onObjectives,
  onManual,
  onRestart,
  onExit,
}) {
  const rowRef = useRef(null);
  const [more, setMore] = useState(""); // "", "l", "r" or "lr": which edges hide buttons
  const measure = () => {
    const el = rowRef.current;
    if (!el) return;
    const l = el.scrollLeft > 2;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((l ? "l" : "") + (r ? "r" : ""));
  };
  useEffect(measure); // labels change width (Fast: on, Pick spot…) — re-measure after every render
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      if (ro) ro.disconnect();
    };
  }, []);
  const nudge = (dir) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };
  return (
    <div className={"ros-ctl-wrap" + (more ? " more-" + more : "")}>
      {more.includes("l") && (
        <button className="ros-ctl-more l" onClick={() => nudge(-1)} aria-label={tr("More buttons")} tabIndex={-1}>
          ‹
        </button>
      )}
      <div className="ros-controls" ref={rowRef}>
        <button className="btn btn-primary" disabled={!state.canEnd} onClick={onEndTurn}>
          <img className="ros-tool-ico" src={base + "hud/act_confirm.png"} alt="" draggable="false" /> {tr("End Turn")}
        </button>
        <button
          className="btn-run"
          disabled={!state.canUndo}
          onClick={() => ctrl && ctrl.undoMove()}
          title={tr("Roll back your last move (before attacking)")}
        >
          <img className="ros-tool-ico" src={base + "hud/act_undo.png"} alt="" draggable="false" /> {tr("Undo")}
        </button>
        <button
          className="btn-run"
          disabled={!state.canHold}
          onClick={() => ctrl && ctrl.holdUnit()}
          title={tr("End the selected unit's turn where it stands, without attacking")}
        >
          <img className="ros-tool-ico" src={base + "hud/act_confirm.png"} alt="" draggable="false" /> {tr("Hold")}
        </button>
        <button
          className="btn-run"
          disabled={state.phase !== "player" || state.unmoved === 0}
          onClick={() => ctrl && ctrl.nextUnit()}
          title={tr("Jump to your next unit that hasn't acted")}
        >
          <img className="ros-tool-ico" src={base + "hud/act_next.png"} alt="" draggable="false" /> {tr("Next")}
        </button>
        <button
          className={"btn-run ros-order" + (state.orderMode === "march" ? " on" : "")}
          disabled={!state.canOrder && state.orderMode !== "march"}
          onClick={() => ctrl && ctrl.beginMarch()}
          title={tr(
            "Formation Order: march your whole un-moved line toward a point — each unit that ends in reach of an enemy also attacks.",
          )}
        >
          {state.orderMode === "march" ? "⚑ " + tr("Pick spot…") : "⚑ " + tr("Formation")}
        </button>
        <button
          className={"btn-run" + (fastFwd ? " on" : "") + (fastFwd === 2 ? " super" : "")}
          onClick={onToggleFast}
          title={tr(
            "Fast-forward: play the whole battle — your units' actions as well as the enemy and allied turns — at high speed. Click again for super fast, a third time to turn it off.",
          )}
        >
          {fastFwd === 2 ? (
            // super fast keeps the "Fast: on" width: its label sits over an invisible copy of that one
            <span className="ros-fast-lbl">
              <span>{"⏩⏩ " + tr("Fast")}</span>
              <span className="ros-fast-ghost" aria-hidden="true">
                {"⏩ " + tr("Fast: on")}
              </span>
            </span>
          ) : fastFwd ? (
            "⏩ " + tr("Fast: on")
          ) : (
            "⏩ " + tr("Fast")
          )}
        </button>
        <button className="btn-run" onClick={onObjectives} title={tr("Mission objectives & battle status")}>
          🎯 {tr("Objectives")}
        </button>
        <button className="btn-run" onClick={onManual} title={tr("Field Manual — the original game's own help")}>
          📖 {tr("Manual")}
        </button>
        <button
          className="btn-run ros-ctl-sep"
          onClick={onRestart}
          title={tr("Restart this battle from the beginning")}
        >
          ↺ {tr("Restart")}
        </button>
        {onExit && (
          <button
            className="btn-run ros-ctl-quit"
            onClick={() => onExit()}
            title={tr("Leave the battle and return to the menu")}
          >
            ⏻ {tr("Quit")}
          </button>
        )}
      </div>
      {more.includes("r") && (
        <button className="ros-ctl-more r" onClick={() => nudge(1)} aria-label={tr("More buttons")} tabIndex={-1}>
          ›
        </button>
      )}
    </div>
  );
}
