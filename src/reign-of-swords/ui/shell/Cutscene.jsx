import { useState, useEffect, useRef } from "react";
import { base, LINE_FACE, subName } from "../../data/shell-data.js";
import { tr } from "../../i18n/i18n.js";

// ---- Cutscene player: portrait + name plate + typed dialogue ----
// `pbase` = the episode's data dir that holds its dialogue busts (Ep2 ships its own faces 052-087 there — resolving
// them against Ep1's dir left every Ep2 briefing / victory / defeat portrait broken).
export function Cutscene({ lines, title, onDone, pbase = base }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState("");
  const full = subName(tr((lines[i] && lines[i].text) || ""));
  const timer = useRef(null);
  useEffect(() => {
    setShown("");
    let typed = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      typed += 2;
      setShown(full.slice(0, typed));
      if (typed >= full.length) clearInterval(timer.current);
    }, 16);
    return () => clearInterval(timer.current);
  }, [i, full]);
  const advance = () => {
    if (shown.length < full.length) {
      clearInterval(timer.current);
      setShown(full);
      return;
    }
    if (i < lines.length - 1) setI(i + 1);
    else onDone();
  };
  const line = lines[i] || {};
  const side = line.side === "foe" ? "right" : "left"; // data-driven side (foe speaks from the right)
  return (
    <div className="ros-cutscene" onClick={advance}>
      <div className={"ros-cut-stage ros-cut-" + side}>
        {(() => {
          // A line with no bust (narration) keeps Ep1's old soldier stand-in only where that image exists (Ep1's dir).
          const src = LINE_FACE(line, pbase) || (pbase === base ? base + "portraits/face008.png" : null);
          return src ? (
            <img
              key={src}
              className="ros-cut-portrait"
              src={src}
              alt=""
              draggable="false"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
          ) : null;
        })()}
        <div className="ros-cut-box">
          {/* No speaker name (the game never showed one) — only the chapter/kingdom title for context. */}
          {title ? <div className="ros-cut-name ros-cut-chapter">{tr(title)}</div> : null}
          <p className="ros-cut-text">
            {shown}
            <span className="ros-cut-caret">▌</span>
          </p>
          <div className="ros-cut-foot">
            <span className="ros-cut-count">
              {i + 1} / {lines.length}
            </span>
            <div className="ros-cut-btns">
              <button
                className="btn-run"
                onClick={(e) => {
                  e.stopPropagation();
                  onDone();
                }}
              >
                {tr("Skip")} ⏭
              </button>
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  advance();
                }}
              >
                {i < lines.length - 1 || shown.length < full.length ? tr("Next") + " ▸" : tr("Continue") + " ▸"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
