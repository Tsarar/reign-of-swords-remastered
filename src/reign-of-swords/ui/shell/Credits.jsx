import { useEffect, useState } from "react";
import { tr } from "../../i18n/i18n.js";

// ABOUT — the original game's own credits screen (main menu → About): the people of Punch Entertainment who made
// this episode, read from its string table by tools/ros/credits.py (credits.json). Names stay as the game lists them.
export default function Credits({ dataBase, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(dataBase + "credits.json")
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch(() => live && setData({ sections: [] }));
    return () => {
      live = false;
    };
  }, [dataBase]);
  return (
    <div className="ros-overlay ros-overlay-fixed ros-overlay-top" onClick={onClose}>
      <div className="ros-overlay-card ros-settings-card ros-credits" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("About")}</h2>
        <div className="ros-settings-body">
          {data && (
            <>
              <p className="ros-credits-game">
                <b>{data.game}</b> {data.version}
                <br />
                {data.copyright}
              </p>
              <p className="ros-settings-note">
                {tr(
                  "The original game's credits, as its About screen lists them. This remaster is an unofficial fan project.",
                )}
              </p>
              {data.sections.map((s) => (
                <div className="ros-credits-sec" key={s.title}>
                  <div className="ros-settings-label">{s.title}</div>
                  {s.names.map((n) => (
                    <div key={n}>{n}</div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="ros-over-btns">
          <button className="btn btn-primary" onClick={onClose}>
            {tr("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
