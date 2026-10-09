import { useEffect, useState } from "react";
import { tr } from "../../i18n/i18n.js";
import { base, SkIco, AimSkills, abilIcon, SHIFT_NAME, ROLE, descFor } from "../battle-ui.jsx";
import { UnitChips, UnitSprite, SvgIcon } from "../shell/common.jsx";
import { UNIT_TYPES } from "../../data/game-data.js";

// The readout under the board: the selected unit (with its actions), an inspected unit, a terrain tile, or a prompt.
// On phones it is a fixed two-line strip; ⓘ opens the full card as a sheet OVER the board, so selecting a unit
// never shrinks the battlefield (reign.css). The sheet closes when the readout changes to another unit or tile, a
// skill is armed (you aim on the board) or the phase moves on.
export default function UnitCard({ state, ctrl }) {
  const [open, setOpen] = useState(false);
  const key = state.selected
    ? "s" + state.selected.id
    : state.inspect
      ? "i" + state.inspect.id
      : state.tileInfo
        ? "t" + state.tileInfo.name
        : "";
  useEffect(() => setOpen(false), [key, state.aimActive, state.phase]);
  return (
    <div className="ros-uc-slot">
      {open && <div className="ros-uc-scrim" onClick={() => setOpen(false)} />}
      <div
        className={
          "ros-unitcard" + (state.selected || state.inspect || state.tileInfo ? "" : " empty") + (open ? " open" : "")
        }
      >
        {key && (
          <button
            className="ros-uc-more"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={tr(open ? "Hide details" : "Show details")}
            aria-label={tr(open ? "Hide details" : "Show details")}
          >
            {open ? "✕" : "ⓘ"}
          </button>
        )}
        {state.selected ? (
          <SelectedUnit u={state.selected} state={state} ctrl={ctrl} />
        ) : state.inspect ? (
          <InspectedUnit u={state.inspect} />
        ) : state.tileInfo ? (
          <TerrainInfo tile={state.tileInfo} />
        ) : (
          <div className="ros-uc-empty">{emptyPrompt(state)}</div>
        )}
      </div>
    </div>
  );
}

// What the empty readout says: the march in progress, the march order waiting for a spot, or whose turn it is.
function emptyPrompt(state) {
  if (state.marching) return "⚑ " + tr("The column advances on your order…");
  if (state.orderMode === "march")
    return "⚑ " + tr("Tap a destination — your whole un-moved line marches there and engages any enemy in reach.");
  return tr(
    {
      player: "Select a unit — or tap terrain to read its effect",
      ally: "Your allies are advancing…",
      enemy: "Enemy warband is moving…",
      victory: "Victory — the field is yours.",
      defeat: "The battle is lost.",
    }[state.phase] || "",
  );
}

// ---- the pieces both unit cards share ----
function UnitHead({ u, role }) {
  return (
    <div className="ros-uc-head">
      <span className="ros-uc-icon">
        {UNIT_TYPES[u.type] ? <UnitSprite unit={u.type} size={28} framed={false} /> : null}
      </span>
      <span className="ros-uc-name">
        {tr(u.name)}
        {u.hero ? " ★" : ""}
      </span>
      <span className={"ros-uc-role role-" + u.kind}>{role}</span>
    </div>
  );
}
// The original's unit readout is HP + deploy cost (its "relative power", strings 488/489) + weapon / armour +
// abilities — NOT an ATK/DEF stat block (the game shows none; record byte 7, a "defence rating", is never read).
// ATK here is the display damage vs light armour from the real weapon × armour table.
function UnitStats({ u }) {
  return (
    <div className="ros-uc-stats">
      <span className="ros-hpbar">
        <i style={{ width: u.hp + "%" }} />
      </span>
      <span className="ros-uc-stat">
        {tr("HP")}
        <b>{u.hp}</b>
      </span>
      <span className="ros-uc-stat">
        {tr("MOV")}
        <b>{u.move}</b>
      </span>
      {u.atk != null ? (
        <span
          className="ros-uc-stat"
          title={tr("Attack — display damage vs light armour, from the real weapon×armour table")}
        >
          {tr("ATK")}
          <b>{u.atk}</b>
        </span>
      ) : null}
      <span className="ros-uc-stat">
        {tr("RNG")}
        <b>{u.range}</b>
      </span>
    </div>
  );
}
// Weapon and armour, as the original's View Unit screen shows them: EVERY weapon slot (a bow and its sidearm, a
// cannon's Grapeshot and Cannonball, a Wizard's Blade) with its own reach, then each one's description.
const weaponBand = (w) => (w.max > 1 ? " (" + tr("rng") + ` ${w.min}–${w.max})` : "");
function UnitKit({ u }) {
  const weapons =
    u.weapons && u.weapons.length
      ? u.weapons
      : u.weapon
        ? [{ name: u.weapon, desc: u.weaponDesc, min: u.minRange, max: u.range }]
        : [];
  if (!weapons.length && !u.armour) return null;
  return (
    <>
      <div className="ros-uc-kit">
        {weapons.map((w) => (
          <span key={w.name} className="ros-uc-weapon">
            <SvgIcon name="sword" /> {tr(w.name)}
            {weaponBand(w)}
          </span>
        ))}
        {u.armour && (
          <span>
            <SvgIcon name="shield" /> {tr(u.armour)}
          </span>
        )}
      </div>
      {weapons.some((w) => w.desc) && (
        <div className="ros-uc-wdesc">{weapons.map((w) => (w.desc ? <p key={w.name}>{tr(w.desc)}</p> : null))}</div>
      )}
    </>
  );
}
function StatusList({ statuses }) {
  if (!statuses || !statuses.length) return null;
  return (
    <div className="ros-uc-status">
      {statuses.map((st) => (
        <div key={st.name} className="ros-uc-status-row" title={tr(st.desc, st.vars)}>
          <img className="ros-uc-status-ic" src={base + "hud/" + st.icon + ".png"} alt="" draggable="false" />
          <span>
            <b>{tr(st.name)}</b> — {tr(st.desc, st.vars)}
          </span>
        </div>
      ))}
    </div>
  );
}
function FormationLine({ u, noneText }) {
  if (!u.formation) return null;
  return (
    <div className="ros-charge">
      <SkIco n="skill_formation" /> {tr("Formation:")}{" "}
      <b>{tr("{p}% damage reduction", { p: u.formationAllies * 10 })}</b>
      {u.formationAllies
        ? " — " + tr("adjacent formation allies: {n} (10% each, max 40%; siege ignores it)", { n: u.formationAllies })
        : " — " + tr(noneText)}
    </div>
  );
}

// The tile the unit stands on and what it does to it: the share of each blow it takes there (terrain cover, plus its
// Formation allies), healing at the start of its turn, quicksand, and whether a Stealth / Ambush unit can hide there.
function GroundLine({ g }) {
  if (!g) return null;
  const notes = [
    g.heal > 0 && tr("heals {n} HP at the start of its turn", { n: g.heal }),
    g.quicksand && tr("quicksand · {n} round(s) left", { n: g.quicksand.turns }),
    g.canHide === true && tr("it can hide here"),
    g.canHide === false && tr("too open to hide"),
  ].filter(Boolean);
  return (
    <div
      className="ros-charge ros-ground"
      title={tr("Boulders and cannonballs ignore half of the cover; Formation does not help against them.")}
    >
      🗺️ {tr("Standing on")} <b>{tr(g.name)}</b> — {tr("takes {p}% damage", { p: g.takes })}
      {g.def || g.formation
        ? " (" +
          [
            g.def && tr("terrain {d}%", { d: (g.def > 0 ? "−" : "+") + Math.abs(g.def) }),
            g.formation && tr("Formation −{d}%", { d: 10 * g.formation }),
          ]
            .filter(Boolean)
            .join(", ") +
          ")"
        : ""}
      {notes.length ? " · " + notes.join(" · ") : ""}
    </div>
  );
}

// ---- your selected unit: its stats and everything it can do ----
function SelectedUnit({ u, state, ctrl }) {
  return (
    <>
      <UnitHead u={u} role={tr(ROLE[u.kind] || u.kind)} />
      <UnitStats u={u} />
      <UnitKit u={u} />
      {/* the camp card's skill-chip row (class · range / melee · each ability), hover for name and description */}
      <UnitChips unitKey={u.type} base={base} />
      <StatusList statuses={u.statuses} />
      {u.charge ? (
        <div className={"ros-charge " + (u.charge === "ready" ? "on" : "")}>
          <SkIco n="skill_charge" />{" "}
          {u.charge === "ready"
            ? tr(
                "CHARGE READY — strike the foe ahead: +30, no counter-attack, and ride on through any foot soldier you cut down!",
              )
            : u.charge === "short"
              ? tr(
                  "No charge — the gallop used up the movement: the whole lane, the foe's tile included, must fit within its {n} movement. A strike now is an ordinary blow.",
                  { n: u.chargeMove },
                )
              : tr(
                  "Charge: gallop 2+ tiles in a straight line, then strike the next tile — the lane, the foe's tile included, must fit within its movement.",
                )}
        </div>
      ) : u.ability && !u.retribution ? (
        <div className="ros-charge">
          {abilIcon(u.ability) ? <SkIco n={abilIcon(u.ability)} /> : "✦"} {tr(u.ability)}
        </div>
      ) : descFor(u) ? (
        <div className="ros-charge">{tr(descFor(u))}</div>
      ) : null}
      {u.shapeshift && (
        <div className="ros-shift">
          <span>
            <SkIco n="skill_shapeshift" /> {tr("Shapeshift:")}
          </span>
          {u.shapeshift.map((f) => (
            <button
              key={f}
              className="btn-run ros-shift-btn"
              disabled={!!u.shapeshiftBlocked}
              title={u.shapeshiftBlocked ? tr("Can't shapeshift over water or cliffs") : undefined}
              onClick={() => ctrl && ctrl.shapeshift(f)}
            >
              {UNIT_TYPES[f] ? <UnitSprite unit={f} size={24} framed={false} /> : null}
              {tr(SHIFT_NAME[f] || f)}
            </button>
          ))}
        </div>
      )}
      {/* ONE shared skill row for every aimed ability — wizard spells, cannon Grapeshot, catapult Barrage, the Ep2
          skills. Pick one to arm it; tap the battlefield to fire (✕ Cancel aim floats over the field). */}
      <AimSkills
        skills={state.aimSkills}
        active={state.aimActive}
        onPick={(id) => ctrl && ctrl.aimSkill(id)}
        base={base}
      />
      {u.retribution && <PrayerRow ctrl={ctrl} />}
      <FormationLine u={u} noneText="stand beside formation allies for +10% each (max 40%)" />
      <GroundLine g={u.ground} />
    </>
  );
}

// A Priest's prayers: Heal is a tap on a wounded ally; Shield and Retribution are buttons.
function PrayerRow({ ctrl }) {
  return (
    <div className="ros-shift ros-prayer">
      <span>
        <SkIco n="skill_prayer" /> {tr("Prayer:")}
      </span>
      <span className="ros-skill-item">
        <span className="ros-heal-cross">✚</span> <b>{tr("Heal")}</b> — {tr("tap an adjacent wounded ally for +20 HP")}
      </span>
      <button
        className="btn-run ros-shift-btn"
        onClick={() => ctrl && ctrl.invokeShield()}
        title={tr("Shield allies within 2 tiles (yourself included) from ranged fire until your next turn")}
      >
        <SkIco n="status_shield" /> <b>{tr("Shield")}</b> — {tr("allies within 2 tiles take HALF ranged damage")}
      </button>
      <button
        className="btn-run ros-shift-btn"
        onClick={() => ctrl && ctrl.invokeRetribution()}
        onMouseEnter={() => ctrl && ctrl.setRetribPreview(true)}
        onMouseLeave={() => ctrl && ctrl.setRetribPreview(false)}
        title={tr(
          "Until your next turn, an enemy that strikes an ally within 2 tiles in melee is smitten before the counter",
        )}
      >
        <SkIco n="status_bless" /> <b>{tr("Retribution")}</b> —{" "}
        {tr("an enemy striking an ally within 2 tiles in melee is smitten")}
      </button>
    </div>
  );
}

// ---- any other unit (an enemy, an ally, one of yours that has acted) ----
function InspectedUnit({ u }) {
  const whose = u.foe
    ? u.faction || tr("Enemy")
    : u.ally
      ? (u.faction || tr("Allied army")) + " · " + tr("ally")
      : tr(u.acted ? "Your unit · spent" : "Your unit");
  return (
    <>
      <UnitHead
        u={u}
        role={
          <>
            {u.faction && <i className="ros-faction-dot" style={{ background: u.factionColor }} />}
            {whose} · {tr(ROLE[u.kind] || u.kind)}
          </>
        }
      />
      <UnitStats u={u} />
      <UnitKit u={u} />
      {/* the same skill-chip row as your own units' card: class · range / melee · each ability (hover = what it does) */}
      <UnitChips unitKey={u.type} base={base} />
      <StatusList statuses={u.statuses} />
      <div className="ros-charge">
        {u.ability ? (
          <>
            {abilIcon(u.ability) ? <SkIco n={abilIcon(u.ability)} /> : "✦"} {tr(u.ability)}
          </>
        ) : u.charge ? (
          <>
            <SkIco n="skill_charge" />{" "}
            {tr(
              "Charge: gallop 2+ tiles in a straight line, then strike the next tile — the lane, the foe's tile included, must fit within its movement.",
            )}
          </>
        ) : (
          tr(
            descFor(u) ||
              (u.foe
                ? "Orange squares show where this foe can move & strike."
                : "Yellow squares show where this unit can move & strike."),
          )
        )}
      </div>
      <FormationLine u={u} noneText="none adjacent yet (+10% per adjacent formation ally, max 40%)" />
      <GroundLine g={u.ground} />
    </>
  );
}

// ---- a terrain tile: its name, cover, healing and the original's move cost per kind of unit ----
function TerrainInfo({ tile }) {
  return (
    <>
      <div className="ros-uc-head">
        <span className="ros-uc-icon">🗺️</span>
        <span className="ros-uc-name">{tr(tile.name)}</span>
        <span className="ros-uc-role">{tr(tile.passable ? "Terrain" : "Impassable")}</span>
      </div>
      <div className="ros-uc-stats">
        {tile.passable && !tile.costs && (
          <span className="ros-uc-stat">
            {tr("MOVE")}
            <b>{tile.move}</b>
          </span>
        )}
        <span className="ros-uc-stat">
          {tr("DEF")}
          <b>{(tile.def < 0 ? "−" + -tile.def : "+" + tile.def) + "%"}</b>
        </span>
        {tile.heal > 0 && (
          <span className="ros-uc-stat">
            {tr("HEAL")}
            <b>+{tile.heal}</b>
          </span>
        )}
        {!tile.passable && (
          <span className="ros-uc-stat">
            —<b>{tr("blocked")}</b>
          </span>
        )}
      </div>
      {tile.costs && tile.passable && (
        <div className="ros-tile-costs">
          {tr("Move cost:")}{" "}
          {[
            ["Skirmishers", tile.costs.skirmish],
            ["Formations", tile.costs.formation],
            ["Cavalry", tile.costs.cavalry],
            ["War engines", tile.costs.engine],
          ].map(([k, c], i) => (
            <span key={k} className={c == null ? "no" : ""}>
              {i ? " · " : ""}
              {tr(k)} <b>{c == null ? "✕" : c}</b>
            </span>
          ))}
        </div>
      )}
      {tile.quicksand && (
        <div className="ros-struct-line ros-qs-line">
          <span>
            <img className="ros-tool-ico" src={base + "hud/skill_quicksand.png"} alt="" draggable="false" />{" "}
            <b>{tr("Quicksand")}</b> · {tr("{n} round(s) left", { n: tile.quicksand.turns })}
          </span>
          <small>
            {tr(
              "A unit that steps in must stop here and takes 5 damage; one already standing in it can walk out. Griffon Riders, Great Eagles and Dune Sirens are immune. Nothing can be built on it.",
            )}
          </small>
        </div>
      )}
      {tile.structure && <StructureLine structure={tile.structure} />}
      <div className="ros-charge">{terrainNote(tile)}</div>
    </>
  );
}

function StructureLine({ structure }) {
  return (
    <div className="ros-struct-line">
      <span>
        {tr(structure.material + " structure")} · <b>{tr(structure.stage)}</b>
      </span>
      {structure.stage !== "Destroyed" && (
        <span className="ros-struct-hp" title={tr("Structure health before the next damage stage")}>
          <em>
            <i style={{ width: structure.hp + "%" }} />
          </em>{" "}
          {structure.hp}%
        </span>
      )}
      <small>
        {structure.stage === "Destroyed"
          ? tr("Craftsmen can rebuild it one stage at a time.")
          : structure.stage === "Intact"
            ? tr("The first damaging hit (siege, fire arrows, magic, bolts) knocks it down a stage.")
            : tr("Stages left until it is destroyed: {n}.", { n: structure.stagesLeft })}
      </small>
    </div>
  );
}

function terrainNote(tile) {
  if (!tile.passable) return tr("No unit may cross this terrain.");
  return (
    [
      tile.heal > 0 && tr("Restores {n} HP to a unit that starts its turn here.", { n: tile.heal }),
      tile.blocksMounted
        ? tr("Foot only — cavalry & war engines cannot enter.")
        : tile.blocksEngine && tr("War engines cannot enter."),
      !tile.heal &&
        (tile.def > 0
          ? tr("Defensive terrain — units here take less damage.")
          : tile.def < 0 && tr("Exposed — units here take more damage.")),
    ]
      .filter(Boolean)
      .join(" ") || tr("Open ground.")
  );
}
