import { tr, GAME_LANGS, setGameLang, useGameLang } from "../../i18n/i18n.js";
import { useVolume, setVolume } from "../../util/volume.js";
import { useGameOptions, setGameOption } from "../../util/options.js";
import { TRANSFER_LIMITS } from "../../data/save-transfer.js";
import { useState } from "react";

// ARMY TRANSFER (ours — the originals are separate apps): export this episode's army and collectibles to a file, import
// the other episode's within data/save-transfer.js's limits. `transfer` = { ep2, onExport, onImport }.
function ArmyTransfer({ transfer }) {
  const [status, setStatus] = useState(null);
  const other = transfer.ep2 ? "Episode I" : "Episode II";
  const exportFile = () => {
    const data = transfer.onExport();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "reign-of-swords-episode-" + data.episode + "-army.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus({ ok: true, text: tr("Army saved to a file — import it in {ep}'s Settings.", { ep: tr(other) }) });
  };
  const importFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // the same file may be picked again
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      setStatus({ ok: false, text: tr("This file could not be read.") });
      return;
    }
    try {
      const got = transfer.onImport(data);
      const count = (m) => Object.values(m).reduce((a, n) => a + n, 0);
      const notes = [
        tr("Brought in {u} units and {s} collectibles.", { u: count(got.units), s: count(got.spoils) }),
        got.converted ? tr("Episode II's own units arrived as the units they are upgraded from.") : "",
        got.capped ? tr("The rest stayed behind: only the limit comes across.") : "",
      ];
      setStatus({ ok: true, text: notes.filter(Boolean).join(" ") });
    } catch (err) {
      setStatus({ ok: false, text: tr(err.message) });
    }
  };
  const L = TRANSFER_LIMITS;
  return (
    <div className="ros-settings-group">
      <div className="ros-settings-label">{tr("Army transfer")}</div>
      <div className="ros-settings-row">
        <button className="btn-run ros-settings-opt" onClick={exportFile}>
          {"⤓ " + tr("Export army")}
        </button>
        <label className="btn-run ros-settings-opt ros-settings-file" htmlFor="ros-army-import">
          {"⤒ " + tr("Import from {ep}", { ep: tr(other) })}
        </label>
        <input id="ros-army-import" type="file" accept=".json,application/json" hidden onChange={importFile} />
      </div>
      <p className="ros-settings-note">
        {tr(
          "Carry part of your army to the other episode: export it here, then import the file in the other episode's Settings. Up to {pu} of each unit and {u} in all come across, and up to {ps} of each collectible ({m} Medal). Episode II's own units reach Episode I as the unit they are upgraded from. Battles won stay behind; importing again replaces the last import.",
          { pu: L.perUnit, u: L.units, ps: L.perSpoil, m: L.medals },
        )}
      </p>
      {status && (
        <p className={"ros-settings-note ros-transfer-status" + (status.ok ? "" : " bad")} role="status">
          {status.text}
        </p>
      )}
    </div>
  );
}

// ---- ⚙ Settings: the game's own language (separate from the site's EN / RU / UA switch), sound and gameplay ----
export function SettingsPanel({ onClose, musicMuted, sfxMuted, onToggleMusic, onToggleSfx, transfer = null }) {
  const lang = useGameLang();
  const volume = useVolume();
  const options = useGameOptions();
  const slider = (k, label) => (
    <label className="ros-vol-row" htmlFor={"ros-vol-" + k}>
      <span className="ros-vol-name">{tr(label)}</span>
      <input
        id={"ros-vol-" + k}
        type="range"
        min="0"
        max="100"
        step="5"
        value={volume[k]}
        onChange={(e) => setVolume({ [k]: +e.target.value })}
      />
      <span className="ros-vol-val">{volume[k]}%</span>
    </label>
  );
  return (
    <div className="ros-overlay ros-overlay-fixed ros-overlay-top" onClick={onClose}>
      <div className="ros-overlay-card ros-settings-card" onClick={(e) => e.stopPropagation()}>
        <h2>⚙ {tr("Settings")}</h2>
        {/* the groups scroll between the title and Close, which stay on screen however short it is */}
        <div className="ros-settings-body">
          <div className="ros-settings-group">
            <div className="ros-settings-label">{tr("Language")}</div>
            <div className="ros-settings-row" role="group" aria-label={tr("Language")}>
              {GAME_LANGS.map((l) => (
                <button
                  key={l.code}
                  className={"btn-run ros-settings-opt" + (lang === l.code ? " on" : "")}
                  aria-pressed={lang === l.code}
                  title={l.code === "en" ? tr("Original — recommended") : undefined}
                  onClick={() => setGameLang(l.code)}
                >
                  {l.label}
                  {l.code === "en" ? " ★" : ""}
                </button>
              ))}
            </div>
            <p className="ros-settings-note">
              {tr("Menus, battle controls, unit texts, the Field Manual and the story.")}
            </p>
          </div>
          <div className="ros-settings-group">
            <div className="ros-settings-label">{tr("Sound")}</div>
            <div className="ros-settings-row">
              <button
                className={"btn-run ros-settings-opt" + (musicMuted ? "" : " on")}
                aria-pressed={!musicMuted}
                onClick={onToggleMusic}
              >
                {musicMuted ? "🔕 " + tr("Music off") : "🎵 " + tr("Music on")}
              </button>
              <button
                className={"btn-run ros-settings-opt" + (sfxMuted ? "" : " on")}
                aria-pressed={!sfxMuted}
                onClick={onToggleSfx}
              >
                {sfxMuted ? "🔇 " + tr("Effects off") : "🔊 " + tr("Effects on")}
              </button>
            </div>
            <div className="ros-vol">
              {slider("master", "Master volume")}
              {slider("sfx", "Effects volume")}
              {slider("music", "Music volume")}
            </div>
          </div>
          <div className="ros-settings-group">
            <div className="ros-settings-label">{tr("Gameplay")}</div>
            <div className="ros-settings-row">
              <button
                className={"btn-run ros-settings-opt" + (options.realisticSiege ? " on" : "")}
                aria-pressed={options.realisticSiege}
                onClick={() => setGameOption({ realisticSiege: !options.realisticSiege })}
              >
                {"🏰 " + tr(options.realisticSiege ? "Realistic siege: on" : "Realistic siege: off")}
              </button>
            </div>
            <p className="ros-settings-note">
              {tr(
                "Off — the original: an AI army's archers, musketeers and war engines only shoot at foes near the point their group is marching to. On: they shoot anything in range, so garrisons fire from their walls. Applies from the next battle.",
              )}
            </p>
          </div>
          {transfer && <ArmyTransfer transfer={transfer} />}
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
