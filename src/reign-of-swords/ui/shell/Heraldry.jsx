import { useState, useEffect, useRef } from "react";
import { HeraldryShield, TINCTURES, BG_TYPES, SYMBOLS } from "../HeraldryShield.jsx";
import { heraldTitle, loadHeraldry, NAME_KEY, loadPlayerName } from "../../data/shell-data.js";
import { tr } from "../../i18n/i18n.js";

// paletteTint + HeraldryShield now live in ui/HeraldryShield.jsx (imported at the top).
export function Heraldry({ progress, onBack }) {
  const [heraldry, setH] = useState(loadHeraldry);
  const [name, setName] = useState(loadPlayerName);
  const tier = heraldTitle(progress ? progress.size : 0);
  const set = (patch) => {
    const nx = { ...heraldry, ...patch };
    setH(nx);
    try {
      localStorage.setItem("ros-heraldry-v1", JSON.stringify(nx));
    } catch (e) {}
  };
  const saveName = (value) => {
    const trimmed = value.slice(0, 20);
    setName(trimmed);
    try {
      localStorage.setItem(NAME_KEY, trimmed);
    } catch (e) {}
  };
  // Fit the whole editor in one screen: size the (last) symbol picker to fill exactly to the viewport bottom, so
  // it scrolls internally instead of pushing the page taller. Robust to any chrome height / screen size.
  const gridRef = useRef(null);
  useEffect(() => {
    const fit = () => {
      const el = gridRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      el.style.maxHeight = Math.max(96, window.innerHeight - top - 20) + "px";
    };
    fit();
    const fitSoon = setTimeout(fit, 80),
      fitLater = setTimeout(fit, 350);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(fitSoon);
      clearTimeout(fitLater);
      window.removeEventListener("resize", fit);
    };
  }, []);
  return (
    <div className="ros-screen ros-heraldry">
      <div className="ros-screen-head">
        <h2>{tr("Heraldry")}</h2>
        <button className="btn-run" onClick={onBack}>
          ◂ {tr("Main Menu")}
        </button>
      </div>
      <p className="ros-screen-sub">
        {tr("Customise your Background and Symbol (colour + type). Rank {r} ({n} won) sets the border.", {
          r: tr(tier.title),
          n: progress ? progress.size : 0,
        })}
      </p>
      <div className="ros-herald-body">
        <div className="ros-herald-preview">
          <HeraldryShield heraldry={heraldry} tier={tier.border} size={168} />
          <div className="ros-herald-title">{tr(tier.title)}</div>
        </div>
        <div className="ros-herald-controls">
          <div className="ros-herald-group">
            <label>{tr("Your Name")}</label>
            <input
              className="ros-herald-name"
              type="text"
              value={name}
              maxLength={20}
              placeholder="Varius"
              onChange={(e) => saveName(e.target.value)}
              aria-label={tr("Your name — how the campaign addresses you (canonically Sir Varius)")}
            />
          </div>
          <div className="ros-herald-group">
            <label>{tr("Background Colour")}</label>
            <div className="ros-herald-swatches">
              {TINCTURES.map((t) => (
                <button
                  key={t.id}
                  className={"ros-swatch" + (heraldry.bgColor === t.id ? " on" : "")}
                  style={{ background: t.hex }}
                  title={t.name}
                  onClick={() => set({ bgColor: t.id })}
                />
              ))}
            </div>
          </div>
          <div className="ros-herald-group">
            <label>{tr("Background Type")}</label>
            <div className="ros-herald-types">
              {BG_TYPES.map((b) => (
                <button
                  key={b}
                  className={"ros-bgtype" + (heraldry.bgType === b ? " on" : "")}
                  onClick={() => set({ bgType: b })}
                >
                  <HeraldryShield
                    heraldry={{ ...heraldry, bgType: b, symbol: null }}
                    tier={0}
                    size={26}
                    framed={false}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="ros-herald-group">
            <label>{tr("Symbol Colour")}</label>
            <div className="ros-herald-swatches">
              {TINCTURES.map((t) => (
                <button
                  key={t.id}
                  className={"ros-swatch" + (heraldry.symbolColor === t.id ? " on" : "")}
                  style={{ background: t.hex }}
                  title={t.name}
                  onClick={() => set({ symbolColor: t.id })}
                />
              ))}
            </div>
          </div>
          <div className="ros-herald-group ros-herald-symgroup">
            <label>{tr("Symbol Type")}</label>
            <div className="ros-herald-devices" ref={gridRef}>
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  className={"ros-device" + (heraldry.symbol === s ? " on" : "")}
                  onClick={() => set({ symbol: s })}
                  title={tr("Symbol") + " " + s}
                >
                  <HeraldryShield heraldry={{ ...heraldry, symbol: s }} tier={0} size={30} framed={false} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
