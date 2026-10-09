import { useState, useEffect } from "react";
import BattleLab from "./BattleLab.jsx";
import { UNIT_TYPES } from "../../engine/engine.js";
import { zipAndDownload } from "../../util/zip-assets.js";
import { ASSET_PATHS, base, LINE_FACE, subName } from "../../data/shell-data.js";
import { tr } from "../../i18n/i18n.js";
import { UnitSprite, ResIcon } from "./common.jsx";
import { kingdomRaids } from "../../data/campaign-rules.js";
import { MechanicsDoc } from "./MechanicsDoc.jsx";

// ---- Story & Assets: the campaign flow + downloadable recovered data/art ----
export function DialogueThread({ title, lines, battle, pbase = base }) {
  if (!lines || !lines.length) return null;
  return (
    <div className={"ros-flow-thread" + (battle ? " battle" : "")}>
      <div className="ros-flow-th">
        {title}
        <i>{lines.length}</i>
      </div>
      {lines.map((l, i) => (
        <div key={i} className={"ros-flow-line" + (l.side === "foe" ? " foe" : "")}>
          {LINE_FACE(l, pbase) ? (
            <img className="ros-flow-face" src={LINE_FACE(l, pbase)} alt="" draggable="false" />
          ) : (
            <span className="ros-flow-face ros-flow-narr" aria-hidden="true">
              📜
            </span>
          )}
          <div className="ros-flow-say">
            {/* The original game showed no speaker name over dialogue — just the portrait + text. Keep only the
                battle turn marker so the in-battle thread still reads as a timeline. */}
            {battle && l.round ? (
              <b className="ros-flow-rndwrap">
                <em className="ros-flow-rnd">
                  turn {l.round}
                  {l.reinforce ? " · reinforcements" : ""}
                </em>
              </b>
            ) : null}
            <span>{subName(tr(l.text))}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- ⚔ Enemies & rewards: every story mission and raid — who you fight and what a win pays ----
// Enemies come from the battle data: the scenario script's spawn commands for the enemy armies (the opening force
// plus every reinforcement it can call in), or — for a map with no script — its opening army plus waves.json.
// Rewards are rewards.json (units joining your army + collectibles). A story mission pays only its first win;
// a raid pays every win.
const unitLabel = (k) => tr((UNIT_TYPES[k] || {}).name || k);

function enemiesOf(level, waves) {
  const side = {};
  for (const group of level.groupOrder || []) side[group.gi] = group.side;
  const start = {},
    later = {};
  const add = (tally, type) => {
    tally[type] = (tally[type] || 0) + 1;
  };
  const actions = level.script && level.script.actions;
  if (actions && actions.length) {
    const initial = new Set(level.script.initial || []);
    actions.forEach((a, i) => {
      if (a.op === 0 && a.key && side[a.gi] === "enemy") add(initial.has(i) ? start : later, a.key);
    });
  } else {
    for (const e of level.enemy || []) add(start, e[0]);
    for (const wave of waves[String(level.mapId)] || [])
      for (const u of wave.units) {
        const unitSide = u[3] != null && side[u[3]] ? side[u[3]] : wave.side === "red" ? "enemy" : "ally";
        if (unitSide === "enemy") add(later, u[0]);
      }
  }
  return { start, later };
}

// One unit type as a chip: its standing sprite with the count, the name on hover.
function MtUnitChips({ counts }) {
  const list = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!list.length) return <span className="ros-mt-none">—</span>;
  return (
    <span className="ros-mt-chips">
      {list.map(([k, n]) => (
        <span key={k} className="ros-mt-chip" title={n + "× " + unitLabel(k)}>
          <UnitSprite unit={k} size={34} framed={false} />
          <b>{n}</b>
        </span>
      ))}
    </span>
  );
}

function MissionTable({ camp, levels, rewards, dataDir }) {
  const [waves, setWaves] = useState(null);
  useEffect(() => {
    fetch(dataDir + "waves.json")
      .then((r) => r.json())
      .then(setWaves)
      .catch(() => setWaves({}));
  }, [dataDir]);
  if (!waves || !levels || !levels.length) return <p className="ros-mt-load">{tr("Loading…")}</p>;
  const byId = {};
  for (const level of levels) byId[level.mapId] = level;
  const groups = camp.kingdoms
    .map((kingdom) => {
      const kingdomName = kingdom.name.replace("Kingdom of ", "");
      const rows = [];
      kingdom.missions.forEach((mission, missionIdx) => {
        if (byId[mission.mapId])
          rows.push({
            kind: "story",
            title: mission.title || byId[mission.mapId].name,
            n: missionIdx + 1,
            lv: byId[mission.mapId],
          });
      });
      levels
        .filter((l) => l.group === "siege" && l.kingdom === kingdomName)
        .sort((a, b) => a.mapId - b.mapId)
        .forEach((l) => rows.push({ kind: "raid", title: l.name, lv: l }));
      return { kn: kingdomName, rows };
    })
    .filter((g) => g.rows.length);
  return (
    <div className="ros-mt">
      {groups.map((g) => (
        <section key={g.kn} className="ros-mt-kd">
          <h4>{tr(g.kn)}</h4>
          {g.rows.map((row) => {
            const { start, later } = enemiesOf(row.lv, waves);
            const reward = rewards[row.lv.mapId] || {};
            const spoils = Object.entries(reward.spoils || {});
            const hasReward = Object.keys(reward.units || {}).length || spoils.length;
            return (
              <div key={row.lv.mapId} className={"ros-mt-row" + (row.kind === "raid" ? " raid" : "")}>
                <div className="ros-mt-name">
                  <span className={"ros-mt-tag" + (row.kind === "raid" ? " raid" : "")}>
                    {row.kind === "raid" ? "⚔ " + tr("Raid") : tr("Mission") + " " + row.n}
                  </span>
                  <b>{tr(row.title)}</b>
                  <small>
                    {row.kind === "raid" ? tr("Raid — pays every win") : tr("pays the first win")} · map {row.lv.mapId}
                  </small>
                </div>
                <div className="ros-mt-cell">
                  <i>{tr("Enemies at the start")}</i>
                  <MtUnitChips counts={start} />
                </div>
                <div className="ros-mt-cell">
                  <i>{tr("Reinforcements")}</i>
                  <MtUnitChips counts={later} />
                </div>
                <div className="ros-mt-cell ros-mt-reward">
                  <i>{tr("Reward")}</i>
                  {hasReward ? (
                    <span className="ros-mt-chips">
                      {Object.keys(reward.units || {}).length ? <MtUnitChips counts={reward.units} /> : null}
                      {spoils.map(([id, n]) => (
                        <span key={id} className="ros-mt-chip spoil" title={n + "× " + tr(id)}>
                          <ResIcon id={id} size={26} title={tr(id)} />
                          <b>{n}</b>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="ros-mt-none">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function StoryCodex({ camp, events, pbase = base, levels = null, rewards = null, onWatch = null }) {
  const [panelOpen, setPanelOpen] = useState(false); // whole panel collapsed by default (sits atop the page)
  const [open, setOpen] = useState(0); // which kingdom is expanded
  const [download, setDl] = useState(null);
  const battleOf = (m) => (events && events[String(m.mapId)]) || null;
  // a kingdom's raids (levels.json "siege" group): their lines are the in-battle events + the level's own
  // victory / defeat lines — the original gives raids no briefing dialogue
  const raidsOf = (kd) => (levels ? kingdomRaids(levels, kd) : []);
  const raidLines = (r) =>
    (battleOf(r) ? battleOf(r).length : 0) +
    (r.victoryLines ? r.victoryLines.length : 0) +
    (r.defeatLines ? r.defeatLines.length : 0);
  const countLines = (kd) =>
    (kd.emperorBrief ? kd.emperorBrief.length : 0) +
    kd.missions.reduce(
      (s, m) =>
        s +
        (m.intro ? m.intro.length : 0) +
        (m.victory ? m.victory.length : 0) +
        (m.defeat ? m.defeat.length : 0) +
        (battleOf(m) ? battleOf(m).length : 0),
      0,
    ) +
    raidsOf(kd).reduce((s, r) => s + raidLines(r), 0);
  const doZip = async () => {
    setDl({ done: 0, total: 0 });
    // Download EVERYTHING: the manifest lists every file under the game folder — the processed assets the
    // game loads AND the full raw `extracted/` reverse-engineering dump (original android + iOS sprites,
    // portraits, heraldry, terrain, audio, MANIFEST.json) plus DATA-NOTES.md. Falls back to the curated
    // list only if the manifest can't be fetched.
    let paths = ASSET_PATHS;
    try {
      const manifest = await fetch(base + "download-manifest.json").then((r) => r.json());
      if (manifest && Array.isArray(manifest.files) && manifest.files.length) paths = manifest.files;
    } catch (e) {
      /* fall back to ASSET_PATHS */
    }
    setDl({ done: 0, total: paths.length });
    const res = await zipAndDownload(base, paths, "reign-of-swords-assets.zip", (done, total) =>
      setDl({ done, total }),
    );
    setDl({ finished: true, ok: res.ok, failed: res.failed.length });
    setTimeout(() => setDl(null), 6000);
  };
  return (
    <div className={"ros-codex-panel" + (panelOpen ? " open" : "")}>
      <button className="ros-codex-bar" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
        <span className="ros-codex-ic">📖</span>
        <b>{tr("Story & Assets")}</b>
        <span className="ros-codex-teaser">
          {tr("The full campaign flow & the recovered game data / art to download")}
        </span>
        <span className="ros-codex-caret">{panelOpen ? "▾" : "▸"}</span>
      </button>
      {!panelOpen ? null : (
        <div className="ros-codex-inner">
          <p className="ros-screen-sub">
            Every kingdom, mission and line of the recovered dialogue — plus the{" "}
            <b>complete reverse-engineering dump</b>: the processed assets the game loads AND the full raw{" "}
            <code>extracted/</code>
            set (original android + iOS sprites, portraits, heraldry, terrain, audio, <code>MANIFEST.json</code>), with
            <b> DATA-NOTES.md</b> explaining how every value was decoded. One .zip, ~16&nbsp;MB.
          </p>

          <div className="ros-dl-row">
            <a className="ros-dl-btn" href={base + "MECHANICS.md"} download>
              📚 <span>Mechanics &amp; decompilation reference (MD)</span>
            </a>
            <a className="ros-dl-btn" href={base + "DATA-NOTES.md"} download>
              📝 <span>Data &amp; RE notes (MD)</span>
            </a>
            <a className="ros-dl-btn" href={base + "campaign.json"} download>
              📜 <span>Story script (JSON)</span>
            </a>
            <a className="ros-dl-btn" href={base + "levels.json"} download>
              ⚔ <span>Battle data (JSON)</span>
            </a>
            <a className="ros-dl-btn" href={base + "extracted/MANIFEST.json"} download>
              🗂 <span>Extraction manifest</span>
            </a>
            <a
              className="ros-dl-btn"
              href={"/ros-atlas/index.html#" + (pbase.includes("-2") ? "5424" : "5400")}
              target="_blank"
              rel="noreferrer"
              title="Every battlefield decoded from the original data: tiles, armies, deploy tiles, objective areas, portals, triggers and dialogue"
            >
              🗺 <span>Map atlas (interactive)</span>
            </a>
            <a
              className="ros-dl-btn"
              href="/ros-atlas/anim.html"
              target="_blank"
              rel="noreferrer"
              title="Every strip of the original's in-battle animation list (resource 5017) for both episodes, the engine's effect table and the unit attack sheets — playing live, each with its source"
            >
              🎞 <span>Animations atlas (interactive)</span>
            </a>
            <button className="ros-dl-btn ros-dl-zip" onClick={doZip} disabled={!!download && !download.finished}>
              📦{" "}
              <span>
                {download
                  ? download.finished
                    ? `Done — ${download.ok} files${download.failed ? ` (${download.failed} missed)` : ""}`
                    : download.total
                      ? `Packing ${download.done}/${download.total}…`
                      : "Reading manifest…"
                  : "Download EVERYTHING (.zip)"}
              </span>
            </button>
          </div>

          <details className="ros-mech-wrap">
            <summary className="ros-mech-sum">
              <b>📚 Mechanics &amp; decompilation reference</b>
              <span>how every rule works and which original function it came from</span>
            </summary>
            <MechanicsDoc />
          </details>

          <details className="ros-mech-wrap">
            <summary className="ros-mech-sum">
              <b>⚔ {tr("Enemies & rewards")}</b>
              <span>{tr("every mission and raid — the enemy army, its reinforcements, and what a win pays")}</span>
            </summary>
            <MissionTable camp={camp} levels={levels} rewards={rewards || {}} dataDir={pbase} />
          </details>

          <details className="ros-mech-wrap">
            <summary className="ros-mech-sum">
              <b>🧪 Battle Lab</b>
              <span>
                play any battle many times with the AI at your side's controls — compare armies and strategies, then
                watch a run
              </span>
            </summary>
            <BattleLab levels={levels} dataBase={pbase} isEp2={pbase.includes("-2")} onWatch={onWatch} />
          </details>

          <p className="ros-mech-flowtitle">
            <b>Campaign flow</b> — every kingdom, mission and line of the recovered dialogue
          </p>
          <div className="ros-flow">
            {camp.prologue && camp.prologue.length ? (
              <div className="ros-flow-kingdom">
                <button className="ros-flow-khead" onClick={() => setOpen(open === "p" ? null : "p")}>
                  <span className="ros-flow-knum">☰</span>
                  <b>Prologue</b>
                  <i>The Emperor's charge · {camp.prologue.length} lines</i>
                  <span className="ros-flow-caret">{open === "p" ? "▾" : "▸"}</span>
                </button>
                {open === "p" && (
                  <div className="ros-flow-body">
                    <DialogueThread title="Prologue" lines={camp.prologue} pbase={pbase} />
                  </div>
                )}
              </div>
            ) : null}
            {camp.kingdoms.map((kd, ki) => (
              <div key={kd.id} className="ros-flow-kingdom">
                <button className="ros-flow-khead" onClick={() => setOpen(open === ki ? null : ki)}>
                  <span className="ros-flow-knum">{ki + 1}</span>
                  <b>{kd.name.replace("Kingdom of ", "")}</b>
                  <i>
                    {kd.missions.length} missions
                    {raidsOf(kd).length
                      ? ` · ${raidsOf(kd).length} raid${raidsOf(kd).length > 1 ? "s" : ""}`
                      : ""} · {countLines(kd)} lines
                  </i>
                  <span className="ros-flow-caret">{open === ki ? "▾" : "▸"}</span>
                </button>
                {open === ki && (
                  <div className="ros-flow-body">
                    {kd.emperorBrief && kd.emperorBrief.length ? (
                      <DialogueThread title="War council" lines={kd.emperorBrief} pbase={pbase} />
                    ) : null}
                    {kd.missions.map((m, mi) => (
                      <div key={m.mapId} className="ros-flow-mission">
                        <div className="ros-flow-mh">
                          <span className="ros-flow-mnum">
                            {ki + 1}.{mi + 1}
                          </span>
                          <b>{m.title}</b>
                          <code>map {m.mapId}</code>
                        </div>
                        <DialogueThread title="Briefing" lines={m.intro} pbase={pbase} />
                        <DialogueThread title="In battle" lines={battleOf(m)} battle pbase={pbase} />
                        <DialogueThread title="Victory" lines={m.victory} pbase={pbase} />
                        <DialogueThread title="Defeat" lines={m.defeat} pbase={pbase} />
                      </div>
                    ))}
                    {raidsOf(kd).map((r, ri) => (
                      <div key={r.mapId} className="ros-flow-mission ros-flow-raid">
                        <div className="ros-flow-mh">
                          <span className="ros-flow-mnum">⚔{ri + 1}</span>
                          <b>{tr(r.name)}</b>
                          <code>raid · map {r.mapId}</code>
                        </div>
                        <DialogueThread title="In battle" lines={battleOf(r)} battle pbase={pbase} />
                        <DialogueThread title="Victory" lines={r.victoryLines} pbase={pbase} />
                        <DialogueThread title="Defeat" lines={r.defeatLines} pbase={pbase} />
                        {raidLines(r) ? null : (
                          <p className="ros-flow-nolines">
                            No dialogue in the original
                            {r.objectiveText ? <> — objective: {subName(tr(r.objectiveText))}</> : null}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
