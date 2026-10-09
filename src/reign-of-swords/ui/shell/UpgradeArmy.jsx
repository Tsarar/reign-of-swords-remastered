import { useState, useRef } from "react";

import { UNIT_TYPES } from "../../engine/engine.js";

import { DEPLOY_ELITE } from "../../data/missions.js";

import { HeraldryShield } from "../HeraldryShield.jsx";

import {
  base,
  COLLECTIBLES,
  UNIT_META,
  ORDER,
  ARMY_GROUPS,
  SPECIAL_ORDER,
  EP2_ORDER,
  UNFIELDED_ORDER,
  UPGRADE_FROM,
  RES_ICON,
  loadHeraldry,
  upgradeOffered,
  upgradeGate,
  MAX_HELD,
} from "../../data/shell-data.js";

import { tr } from "../../i18n/i18n.js";

import { UnitSprite, UnitChips, SvgIcon, ResIcon } from "./common.jsx";

// One stat chip in the upgrade card
export function Stat({ icon, label, val, title }) {
  return (
    <span className="ros-stat" title={title}>
      {icon ? <SvgIcon name={icon} /> : null}
      <span className="ros-stat-tx">
        <i>{label}</i>
        <b>{val}</b>
      </span>
    </span>
  );
}

// The camp / Army screen — modelled on the original: a resource-icon bar + your crest, then a GRID of unit tiles
// (green = owned, grey = not yet), and a detail/upgrade panel for the selected unit.
// The army / camp panel. Renders standalone (its own screen) OR `embedded` — a side panel that
// sits next to the campaign world map, the way the original game shows your camp beside the map.
export function UpgradeArmy({
  army,
  spoils,
  onUpgrade,
  onBack,
  embedded,
  onMerchant,
  onHeraldry,
  heraldTier = 0,
  ep2: isEp2 = false,
  progress, // the story battles won (a Set of map ids): Episode II's new units open with them
  missionTitle = () => "", // map id → that battle's title, for the locked-upgrade hint
}) {
  const [selKey, setSel] = useState(() => ORDER.find((k) => (army[k] || 0) > 0) || ORDER[0]);
  // Stacked (phone) layout: the unit's card sits below the long grid — bring it into view when a tile is tapped.
  const detailRef = useRef(null);
  const pick = (key) => {
    setSel(key);
    const el = detailRef.current;
    if (el && el.scrollIntoView && window.matchMedia && window.matchMedia("(max-width: 900px)").matches)
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30); // after the card re-renders
  };
  // Episode II: the fieldable new units (Craftsmen/Ballistae/Conjurer/Dune Sirens/Blood Gorgers) join the roster
  // grid; the conjured ones (Sapper/Bodyguard) join the "not recruitable" reference shelf.
  const rosterOrder = isEp2 ? [...ORDER, ...EP2_ORDER.filter((k) => !(UNIT_META[k] || {}).conjured)] : ORDER;
  const refOrder = isEp2
    ? [...SPECIAL_ORDER, ...UNFIELDED_ORDER, ...EP2_ORDER.filter((k) => (UNIT_META[k] || {}).conjured)]
    : [...SPECIAL_ORDER, ...UNFIELDED_ORDER];
  const heraldry = loadHeraldry(); // always a valid {field, chief, device} so the crest can preview the full coat of arms
  const u = UNIT_META[selKey],
    T = UNIT_TYPES[selKey] || {},
    have = army[selKey] || 0,
    upgrades = (u.upgrades || []).filter((e) => upgradeOffered(e, isEp2)),
    upgradeFrom = UPGRADE_FROM[selKey];
  const resbar = (
    <div className="ros-resbar">
      {COLLECTIBLES.map((c) => (
        <span
          key={c.id}
          className={"ros-res" + ((spoils[c.id] || 0) > 0 ? " has" : "")}
          title={tr(c.id) + " — " + tr("Spoils of War")}
        >
          {RES_ICON[c.id] ? (
            <img className="ros-res-img" src={base + "icons/" + RES_ICON[c.id] + ".png"} alt={c.id} draggable="false" />
          ) : (
            <b className="ros-res-emoji">{c.icon}</b>
          )}
          <i className="ros-res-count">{spoils[c.id] || 0}</i>
        </span>
      ))}
      {onHeraldry ? (
        <button
          type="button"
          className="ros-res-crest ros-res-crest-btn"
          onClick={onHeraldry}
          title={tr("Your coat of arms — click to design your heraldry")}
        >
          <HeraldryShield heraldry={heraldry} tier={heraldTier} size={44} />
        </button>
      ) : (
        <span className="ros-res-crest" title={tr("Your heraldry — set it in the Heraldry screen")}>
          <HeraldryShield heraldry={heraldry} tier={heraldTier} size={44} />
        </span>
      )}
    </div>
  );
  const grid = (
    <>
      <div className="ros-army-grid">
        {ARMY_GROUPS.flatMap((g) => g.units)
          .filter((k) => rosterOrder.includes(k))
          .map((key) => {
            const held = army[key] || 0;
            return (
              <button
                key={key}
                className={"ros-army-tile" + (held > 0 ? " has" : " none") + (selKey === key ? " sel" : "")}
                onClick={() => pick(key)}
                title={tr(UNIT_META[key].name) + " ×" + held}
              >
                <UnitSprite unit={key} />
                <span className="ros-tile-count">{held}</span>
              </button>
            );
          })}
      </div>
      {/* One combined reference shelf: the Druid's nature-spirit forms (and, on Ep2, the Conjurer's summons) —
          they appear in the campaign but aren't recruitable. The Hero is a regular army unit (grid above). */}
      <div className="ros-army-special-head">
        <SvgIcon name="star" /> {tr("Summoned units & Nature Spirits")}{" "}
        <i>— {tr("appear in the campaign, not recruitable")}</i>
      </div>
      <div className="ros-army-grid">
        {refOrder.map((key) => {
          const unfielded = UNFIELDED_ORDER.includes(key);
          return (
            <button
              key={key}
              className={
                "ros-army-tile ros-special" + (unfielded ? " ros-unfielded" : "") + (selKey === key ? " sel" : "")
              }
              onClick={() => pick(key)}
            >
              <UnitSprite unit={key} />
            </button>
          );
        })}
      </div>
    </>
  );
  const roleElite = !!DEPLOY_ELITE[selKey],
    roleText = tr(u.role); // the original's elite list (UnitSelector::placeCurrent)
  const detail = (
    <div className="ros-army-detail" ref={detailRef}>
      {/* Unit preview: large sprite + identity */}
      <div className="ros-army-preview">
        <div className="ros-army-portrait">
          <UnitSprite unit={selKey} size={58} framed={false} />
        </div>
        <div className="ros-army-id">
          <div className="ros-army-line1">
            <b>{tr(u.name)}</b>
            {!u.special && <span className={"ros-army-count" + (have > 0 ? " has" : "")}>×{have}</span>}
            {roleElite ? (
              <img
                className="ros-elite-img"
                src={base + "icons/medal.png"}
                alt={tr("Elite")}
                title={tr("Elite — limited by your deployment budget (1 per 1000 points)")}
                draggable="false"
              />
            ) : null}
          </div>
          <div className="ros-army-role">{roleText}</div>
          {u.cost ? (
            <span
              className="ros-army-cost"
              title={tr("Deployment Cost — the game's own relative-power indicator, not an ATK/DEF stat.")}
            >
              <SvgIcon name="cost" /> {tr("{n} pts", { n: u.cost })}
            </span>
          ) : u.special ? (
            <span className="ros-army-cost ros-cost-ref">{tr("Reference only")}</span>
          ) : null}
        </div>
      </div>
      <div className="ros-stats">
        <Stat
          icon="mov"
          label={tr("MOV")}
          val={T.move}
          title={tr("Movement points per turn — the unit's speed across the field")}
        />
        <Stat
          icon="sword"
          label={tr("ATK")}
          val={T.atk}
          title={tr("Attack power (the game's 0–100 display rating, from the real weapon×armour table)")}
        />
        <Stat
          icon="shield"
          label={tr("DEF")}
          val={Math.round((T.def || 0) * 100) + "%"}
          title={tr("Damage reduction from this unit's armour")}
        />
        {T.range > 1 ? (
          <Stat
            icon="rng"
            label={tr("RNG")}
            val={T.range}
            title={tr("Attacks from {a}–{b} tiles", { a: T.minRange, b: T.range })}
          />
        ) : (
          <span className="ros-stat ros-stat-tag" title={tr("Melee only — strikes adjacent tiles")}>
            <SvgIcon name="sword" />
            <i>{tr("Melee")}</i>
          </span>
        )}
      </div>
      <div className="ros-army-kit">
        {T.weaponName ? (
          <>
            {/* every weapon slot with its own reach, as the original's View Unit screen lists them */}
            {(T.weaponSlots || []).map((w) => (
              <span key={w.name} className="ros-kit-part">
                <SvgIcon name="sword" /> {tr(w.name)}
                {w.max > 1 ? " (" + tr("rng") + ` ${w.min}–${w.max})` : ""}
              </span>
            ))}
            <span className="ros-kit-part">
              <SvgIcon name="shield" /> {tr(T.armourName)}
            </span>
          </>
        ) : (
          tr(u.kit)
        )}
      </div>
      {(T.weaponSlots || []).map((w) =>
        w.desc ? (
          <p key={w.name} className="ros-army-weapon">
            {tr(w.desc)}
          </p>
        ) : null,
      )}
      {/* ONE combined row: unit-type emblem · attack type · abilities (icons where the game has one, words otherwise) */}
      <UnitChips unitKey={selKey} base={base} />
      <p className="ros-army-note">{tr(u.note)}</p>
      {upgradeFrom ? (
        <div className="ros-army-src">
          {tr("Upgrade from {u} — spend", { u: tr(UNIT_META[upgradeFrom.from].name) })}{" "}
          <ResIcon id={upgradeFrom.need} size={22} /> {tr(upgradeFrom.need)}
          {upgradeGate(selKey, isEp2) && !(progress && progress.has(upgradeGate(selKey, isEp2))) ? (
            <span className="ros-army-gate">
              {" · "}
              <SvgIcon name="lock" /> {tr("opens after {m}", { m: tr(missionTitle(upgradeGate(selKey, isEp2))) })}
            </span>
          ) : null}
        </div>
      ) : selKey === "militiamen" ? (
        <div className="ros-army-src">{tr("Recruit at the Merchant")}</div>
      ) : null}
      {upgrades.length ? (
        <div className="ros-up-row">
          {upgrades.map((e) => {
            const gate = upgradeGate(e.to, isEp2),
              locked = !!gate && !(progress && progress.has(gate));
            const full = (army[e.to] || 0) >= MAX_HELD;
            const can = have > 0 && !locked && !full && (spoils[e.need] || 0) > 0;
            return (
              <button
                key={e.to}
                className="ros-up-btn"
                disabled={!can}
                // DELIBERATE DEVIATION (MECHANICS.md §13, user decision): one tap upgrades one unit — tap three times for
                // three. The original asks for the number first ("Confirm the number of units to upgrade.", popup 62).
                onClick={() => onUpgrade(selKey, e.to, e.need, 1)}
                title={
                  have === 0
                    ? tr("You have no {u} to upgrade", { u: tr(u.name) })
                    : locked
                      ? tr("Win {m} to unlock this upgrade", { m: tr(missionTitle(gate)) })
                      : full
                        ? tr("There is a maximum of 500 for units and collectibles.")
                        : (spoils[e.need] || 0) <= 0
                          ? tr("Needs 1 {c} collectible", { c: tr(e.need) })
                          : tr("Upgrade 1 {a} → 1 {b} (spends 1 {c})", {
                              a: tr(u.name),
                              b: tr(UNIT_META[e.to].name),
                              c: tr(e.need),
                            })
                }
              >
                <span className="ros-up-sprite">
                  <UnitSprite unit={e.to} size={40} framed={false} />
                </span>
                <span className="ros-up-body">
                  <span className="ros-up-name">{tr(UNIT_META[e.to].name)}</span>
                  <span className="ros-up-role">{tr(UNIT_META[e.to].role)}</span>
                </span>
                <span className={"ros-up-cost" + (can ? "" : " short")}>
                  {locked ? <SvgIcon name="lock" /> : null}
                  <ResIcon id={e.need} size={22} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return (
      <aside className="ros-camp-panel">
        <div className="ros-camp-panel-head">
          <h3>
            <SvgIcon name="sword" /> {tr("Your Army & Spoils")}
          </h3>
          <span className="ros-camp-panel-hint">{tr("Tap a unit, spend collectibles to upgrade.")}</span>
        </div>
        {resbar}
        {grid}
        {detail}
        {onMerchant && (
          <div className="ros-camp-panel-foot">
            <button
              className="btn-run ros-merchant-btn"
              onClick={onMerchant}
              title={tr("Trade excess collectibles for a different one, or for a Militiaman")}
            >
              <SvgIcon name="trade" /> {tr("The Merchant")}
            </button>
          </div>
        )}
      </aside>
    );
  }

  return (
    <div className="ros-screen ros-upgrade">
      <div className="ros-screen-head">
        <h2>{tr("Upgrade Army")}</h2>
        <button className="btn-run" onClick={onBack}>
          ◂ {tr("Main Menu")}
        </button>
      </div>
      <p className="ros-screen-sub">
        {tr(
          "Your army and the Spoils of War you've won. Tap a unit to inspect it and spend collectibles to upgrade it into a stronger type. Green tiles are units you own; grey are ones you can still earn.",
        )}
      </p>
      {resbar}
      {grid}
      {detail}
    </div>
  );
}
