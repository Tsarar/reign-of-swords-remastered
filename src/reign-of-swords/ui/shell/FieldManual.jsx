// The Field Manual: the original game's help pages (help.json) and the unit upgrade tree.
import { useState, useEffect } from "react";
import GameLoader from "../../../components/GameLoader.jsx";
import { UNIT_TYPES } from "../../engine/engine.js";
import {
  base,
  UNIT_META,
  SPECIAL_ORDER,
  EP2_ORDER,
  ABILITY_ICON,
  unitsWithAbility,
  unitsWithArmour,
  unitsWithMovement,
  MOVEMENT_KEY,
  HELP_ABILITY_KEY,
  abilityTitle,
  ARMOUR_TITLES,
  MOVEMENT_TITLES,
  EP2_ABILITY_HELP,
  ABILITY_NOTE,
  HELP_TAB_ICON,
  TREE_COL,
  TREE_ROW,
  NEED_COLOR,
} from "../../data/shell-data.js";
import { tr, useGameLang } from "../../i18n/i18n.js";
import { UnitSprite, SvgIcon } from "./common.jsx";

export function UpgradeTree({ ep2: isEp2 = false }) {
  const COLW = 208,
    HALF = 82,
    ROWH = 58,
    PADX = 18,
    PADY = 24;
  // Nodes/edges are filtered by episode: the Ep2 upgrade targets (craftsmen/ballistae/conjurer/dune sirens/
  // blood gorgers) and the edges leading to them appear only on the Ep2 route. Column heights are computed from
  // the visible nodes so the layout grows to fit Ep2's extra branches.
  const nodes = Object.keys(TREE_COL).filter((u) => isEp2 || !(UNIT_META[u] || {}).ep2);
  const maxCol = Math.max(...nodes.map((u) => TREE_COL[u]));
  const COL_ROWS = {};
  nodes.forEach((u) => {
    const col = TREE_COL[u];
    COL_ROWS[col] = Math.max(COL_ROWS[col] || 0, TREE_ROW[u] + 1);
  });
  const MAXR = Math.max(...Object.values(COL_ROWS));
  const colX = (c) => PADX + HALF + c * COLW;
  const startY = (c) => PADY + ((MAXR - (COL_ROWS[c] || 0)) / 2) * ROWH + ROWH / 2;
  const posOf = (u) => ({ x: colX(TREE_COL[u]), y: startY(TREE_COL[u]) + TREE_ROW[u] * ROWH });
  const width = PADX * 2 + HALF * 2 + maxCol * COLW,
    height = PADY * 2 + MAXR * ROWH;
  const shown = new Set(nodes);
  const edges = [];
  nodes.forEach((u) => {
    const upgrades = (UNIT_META[u] || {}).upgrades;
    if (upgrades)
      upgrades.forEach((e) => {
        if (shown.has(e.to) && (isEp2 || !e.ep2)) edges.push({ from: u, to: e.to, need: e.need });
      });
  });
  return (
    <div className="ros-tree-wrap">
      <p className="ros-tree-intro">
        {tr(
          "Only Militiamen are recruited (at the Merchant). Every other unit is earned by spending a battle collectible on one you already own — each arrow is one upgrade, coloured by what it costs.",
        )}
      </p>
      <div className="ros-tree-legend">
        {Object.entries(NEED_COLOR).map(([k, c]) => (
          <span key={k} className="ros-tree-leg">
            <i style={{ background: c }} />
            {tr(k)}
          </span>
        ))}
      </div>
      <svg
        className="ros-tree-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={tr("Unit upgrade tree")}
      >
        {edges.map((e, i) => {
          const a = posOf(e.from),
            b = posOf(e.to);
          const x1 = a.x + HALF - 4,
            x2 = b.x - HALF + 4,
            cx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${x2} ${b.y}`}
              fill="none"
              stroke={NEED_COLOR[e.need] || "#999"}
              strokeWidth="2.5"
              opacity="0.9"
            />
          );
        })}
        {nodes.map((u) => {
          const { x, y } = posOf(u);
          const root = u === "militiamen";
          const leaf = !(UNIT_META[u] || {}).upgrades;
          return (
            <g key={u}>
              <rect
                x={x - HALF}
                y={y - 23}
                width={HALF * 2}
                height={46}
                rx={8}
                className={"ros-tree-card" + (root ? " root" : leaf ? " leaf" : "")}
              />
              <image
                className="ros-tree-img"
                href={base + "sprites/stand/" + ((UNIT_TYPES[u] || {}).sprite || u) + ".png"}
                x={x - HALF + 6}
                y={y - 21}
                width={42}
                height={42}
                preserveAspectRatio="xMidYMax meet"
              />
              <text x={x - HALF + 54} y={y - 3} className="ros-tree-nm">
                {tr(UNIT_META[u].name)}
              </text>
              <text x={x - HALF + 54} y={y + 12} className="ros-tree-rl">
                {root ? tr("Recruit") : tr(UNIT_META[u].role)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="ros-tree-special">
        <div className="ros-army-special-head">
          <SvgIcon name="star" /> {tr("Summoned units & Nature Spirits")}{" "}
          <i>— {tr("appear in the campaign, not recruitable")}</i>
        </div>
        <div className="ros-tree-special-row">
          {/* Episode II adds the Conjurer's summons (Sapper / Bodyguard) to this shelf, as the camp panel does. */}
          {[...SPECIAL_ORDER, ...(isEp2 ? EP2_ORDER.filter((k) => (UNIT_META[k] || {}).conjured) : [])].map((u) => (
            <span key={u} className="ros-tree-sp">
              <UnitSprite unit={u} size={28} framed={false} /> <b>{tr(UNIT_META[u].name)}</b>
              <i>{tr(UNIT_META[u].role)}</i>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HelpScreen({ onBack, ep2: isEp2 = false, backLabel = null }) {
  useGameLang();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("play");
  useEffect(() => {
    fetch(base + "help.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({}));
  }, []);
  if (!data)
    return (
      <div className="ros-screen ros-help">
        <GameLoader label={tr("Opening the field manual…")} />
      </div>
    );
  const asItems = (arr) => (arr || []).map((t) => (typeof t === "string" ? { text: t } : t));
  const titled = (arr, titles) =>
    (arr || []).map((t, i) => ({ title: tr(titles[i]), text: typeof t === "string" ? t : t.text }));
  // Episode II adds its own abilities (verbatim from the 5004 help strings), tagged with the units that carry
  // them — shown only on the Ep2 route, appended after the Ep1 ability list.
  const ep2Abilities = isEp2 ? EP2_ABILITY_HELP : [];
  const TABS = [
    { id: "play", label: tr("How to Play"), items: data.manual || [] },
    { id: "abilities", label: tr("Abilities"), items: asItems(data.abilities) },
    { id: "armour", label: tr("Armour"), items: titled(data.armour, ARMOUR_TITLES) },
    {
      id: "move",
      label: tr("Movement"),
      items: [
        ...titled(data.movement, MOVEMENT_TITLES),
        {
          title: tr("Standard March"),
          text: "Ordinary foot soldiers with no special movement type — they cross terrain at the normal rate.",
        },
      ],
    },
    { id: "upgrades", label: tr("Upgrades"), items: [1] }, // rendered as the branching tree, not a text list
    { id: "online", label: tr("Online (original)"), items: data.online || [] },
  ].filter((t) => t.items.length);
  const cur = TABS.find((t) => t.id === tab) || TABS[0];
  // Abilities tab: pair each verbatim entry with the ability it describes, drop exact-text duplicates, and
  // float the ones no fielded unit carries to the bottom so the useful ones read first.
  const abilityRows =
    cur.id !== "abilities"
      ? null
      : (() => {
          const seen = new Set(),
            rows = [];
          cur.items.forEach((item, i) => {
            if (seen.has(item.text)) return;
            seen.add(item.text);
            const key = HELP_ABILITY_KEY[i];
            rows.push({
              text: item.text,
              title: abilityTitle(key),
              units: key != null ? unitsWithAbility(key, isEp2) : [],
            });
          });
          // Episode II abilities, appended and tagged with the units that carry them.
          ep2Abilities.forEach((a) =>
            rows.push({ text: a.text, title: a.title, units: unitsWithAbility(a.trait, true) }),
          );
          return rows.sort((a, b) => (b.units.length > 0) - (a.units.length > 0));
        })();
  return (
    <div className="ros-screen ros-help">
      <div className="ros-screen-head">
        <h2>{tr("Field Manual")}</h2>
        <button className="btn-run" onClick={onBack}>
          {backLabel || "◂ " + tr("Main Menu")}
        </button>
      </div>
      <p className="ros-screen-sub">
        {tr(
          'The original 2008 game\'s own help text (recovered verbatim), with each ability tagged by the units that carry it. (Phone references — "tap", "hold down" — are the source\'s wording.)',
        )}
      </p>
      <div className="ros-help-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"ros-help-tab" + (cur.id === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ros-help-list">
        {cur.id === "upgrades" ? (
          <UpgradeTree ep2={isEp2} />
        ) : (
          <>
            {cur.id === "online" ? (
              <p className="ros-help-note">
                ⚠{" "}
                {tr(
                  "These describe the original's online / account features — not part of this single-player recreation, kept here for completeness.",
                )}
              </p>
            ) : null}
            {cur.id === "abilities"
              ? abilityRows.map((r, i) => (
                  <div
                    key={i}
                    className={"ros-help-item ros-help-ability" + (r.units.length ? "" : " ros-help-orphan")}
                  >
                    {r.title ? (
                      <div className="ros-help-title">
                        {ABILITY_ICON[r.title] ? (
                          <img
                            className="ros-tool-ico"
                            src={base + "hud/" + ABILITY_ICON[r.title] + ".png"}
                            alt=""
                            draggable="false"
                          />
                        ) : (
                          <SvgIcon name="star" className="ros-ability-star" />
                        )}{" "}
                        {tr(r.title)}
                      </div>
                    ) : null}
                    <p className="ros-help-text">{tr(r.text)}</p>
                    {ABILITY_NOTE[r.title] ? <p className="ros-help-rec">{tr(ABILITY_NOTE[r.title])}</p> : null}
                    {r.units.length ? (
                      <div className="ros-help-units">
                        {r.units.map((u) => (
                          <span key={u} className="ros-help-unit">
                            <UnitSprite unit={u} size={18} framed={false} /> {tr(UNIT_META[u].name)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="ros-help-none">{tr("Not carried by any unit you field in this recreation.")}</div>
                    )}
                  </div>
                ))
              : cur.items.map((item, i) => {
                  // Armour & Movement entries are tagged with the units that wear / move that way, like Abilities.
                  const units =
                    cur.id === "armour"
                      ? unitsWithArmour(i, isEp2)
                      : cur.id === "move"
                        ? unitsWithMovement(MOVEMENT_KEY[i], isEp2)
                        : [];
                  const tagged = cur.id === "armour" || cur.id === "move";
                  return (
                    <div key={i} className="ros-help-item ros-help-ability">
                      {item.title ? (
                        <div className="ros-help-title">
                          {HELP_TAB_ICON[cur.id] ? (
                            <SvgIcon name={HELP_TAB_ICON[cur.id]} className="ros-ability-star" />
                          ) : null}
                          {tr(item.title)}
                        </div>
                      ) : null}
                      <p className="ros-help-text">{tr(item.text)}</p>
                      {units.length ? (
                        <div className="ros-help-units">
                          {units.map((u) => (
                            <span key={u} className="ros-help-unit">
                              <UnitSprite unit={u} size={18} framed={false} /> {tr(UNIT_META[u].name)}
                            </span>
                          ))}
                        </div>
                      ) : tagged ? (
                        <div className="ros-help-none">{tr("Not worn by any unit you field in this recreation.")}</div>
                      ) : null}
                    </div>
                  );
                })}
          </>
        )}
      </div>
    </div>
  );
}
