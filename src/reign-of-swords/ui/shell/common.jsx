// Shared pieces of the campaign shell: the unit sprite, the skill chips, the inline SVG glyphs and the collectible icons.
import { UNIT_TYPES } from "../../engine/engine.js";
import {
  base,
  AV,
  STAND_UNITS,
  IDLE_FRAME,
  COLLECTIBLES,
  unitSkills,
  HUD_RANGE_BADGE,
  HUD_CLASS_TITLE,
  HUD_CLASS_DESC,
  hudClass,
  ABILITY_ICON,
  SKILL_SKIP,
  RES_ICON,
} from "../../data/shell-data.js";
import { tr } from "../../i18n/i18n.js";

export function UnitSprite({ unit, size = 62, framed = true }) {
  const wrapCls = framed ? "ros-unit-frame" : "ros-unit-bare";
  const wrapStyle = framed ? undefined : { width: size, height: size };
  if (STAND_UNITS.has(unit)) {
    return (
      <span className={wrapCls} style={wrapStyle}>
        <img
          className="ros-unit-stand"
          src={`${base}sprites/stand/${unit}.png${AV}`}
          alt=""
          draggable="false"
          style={{ maxHeight: `min(${size}px, 100%)`, maxWidth: `min(${size + 6}px, 100%)` }}
        />
      </span>
    );
  }
  // strip-based render (a single idle frame of the battle animation) for mounted/siege units
  const T = UNIT_TYPES[unit] || {};
  const frames = T.frames || 4,
    frameW = T.frameW || 88,
    frameH = T.frameH || 88;
  const idle = Math.min(frames - 1, IDLE_FRAME[unit] || 0);
  const height = Math.round(size * (frameH / 88)),
    width = Math.round(height * (frameW / frameH));
  const posX = frames > 1 ? (idle / (frames - 1)) * 100 : 0;
  return (
    <span className={wrapCls} style={wrapStyle}>
      <span
        className="ros-unit-sprite"
        style={{
          // at most its own size, shrunk (keeping its shape) to fit a smaller frame — a tall Hero would lose his head
          height: `min(${height}px, 100%)`,
          maxWidth: "100%",
          aspectRatio: `${width} / ${height}`,
          backgroundImage: `url(${base}sprites/${T.sprite || unit}.png${AV})`,
          backgroundSize: `${frames * 100}% 100%`,
          backgroundPosition: `${posX}% top`,
        }}
      />
    </span>
  );
}

// ONE combined row: unit-type emblem · attack type (range badge for ranged, the word "Melee" for melee) · then every
// ability — the game's own icon where one exists (hover = name + description), otherwise the word pill as before.
export function UnitChips({ unitKey, base }) {
  const T = UNIT_TYPES[unitKey] || {};
  if (!T.kind) return null;
  const ranged = !!HUD_RANGE_BADGE[unitKey] || T.kind === "siege" || (T.range > 1 && T.projectile);
  const rangeBadge = HUD_RANGE_BADGE[unitKey];
  const unitClass = hudClass(unitKey, T);
  const icon = (n, title, key) => (
    <span key={key || n} className="ros-skill ros-skill-ic" title={title}>
      <img className="ros-skill-img" src={base + "hud/" + n + ".png"} alt={title} draggable="false" />
    </span>
  );
  const word = (txt, title, key) => (
    <span key={key || txt} className="ros-skill" title={title || txt}>
      <SvgIcon name="star" className="ros-ability-star" /> {txt}
    </span>
  );
  const chips = [
    icon(
      unitClass,
      tr(HUD_CLASS_TITLE[unitClass]) + (HUD_CLASS_DESC[unitClass] ? " — " + tr(HUD_CLASS_DESC[unitClass]) : ""),
      "cls",
    ),
  ];
  if (ranged && rangeBadge)
    chips.push(icon("range_" + rangeBadge, tr("Shooting range — {r} tiles", { r: rangeBadge }), "rng"));
  else if (!ranged) chips.push(icon("skill_melee", tr("Melee — strikes an adjacent enemy"), "melee"));
  for (const skill of unitSkills(unitKey)) {
    if (SKILL_SKIP.has(skill.n)) continue;
    const iconId = skill.icon || ABILITY_ICON[skill.n];
    chips.push(
      iconId
        ? icon(iconId, tr(skill.n) + (skill.d ? " — " + tr(skill.d) : ""), skill.n)
        : word(tr(skill.n), tr(skill.d || skill.n), skill.n),
    );
  }
  return <div className="ros-army-skills ros-chips">{chips}</div>;
}

// Small inline-SVG glyphs (currentColor, scalable) used across the camp panel & merchant instead of
// flat emoji: movement, range, melee, armour, deploy-cost banner, and a heraldic star for abilities.
export function SvgIcon({ name, className }) {
  const PATHS = {
    mov: (
      <path
        d="M3 5l7 7-7 7M12 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    rng: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </g>
    ),
    sword: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 3l-8.5 8.5" />
        <path d="M4 15l3 3" />
        <path d="M5.5 13.5l-2 4.5 4.5-2" />
        <path d="M11.5 11.5l1 1" />
      </g>
    ),
    shield: (
      <path
        d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10.9C7.4 20.1 4 16.5 4 11.5v-6l8-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    ),
    cost: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3v18" />
        <path d="M6 4h12l-3 3.5L18 11H6" />
      </g>
    ),
    star: (
      <path
        d="M12 2.6l2.85 5.9 6.45.72-4.8 4.38 1.32 6.4L12 17.6 6.18 20l1.32-6.4-4.8-4.38 6.45-.72z"
        fill="currentColor"
      />
    ),
    trade: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />
      </g>
    ),
    up: <path d="M12 4l7 8h-4v8H9v-8H5z" fill="currentColor" />,
    book: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M12 6.5C10 5 7 4.6 4.5 5.2V18c2.5-.6 5.5-.2 7.5 1.3 2-1.5 5-1.9 7.5-1.3V5.2C17 4.6 14 5 12 6.5z" />
        <path d="M12 6.5V19" />
      </g>
    ),
    lock: (
      // lifted a unit: the body outweighs the shackle, so the box-centred glyph read as sitting low in its badge
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" transform="translate(0 -1)">
        <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </g>
    ),
  };
  // The sword is the original's own icon (hud/orders.png frame 6, sliced to hud/sword.png), not a drawn glyph.
  if (name === "sword")
    return (
      <img
        className={"ros-svg ros-svg-img" + (className ? " " + className : "")}
        src={base + "hud/sword.png"}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
    );
  return (
    <svg
      className={"ros-svg" + (className ? " " + className : "")}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

// A collectible shown as the game's OWN native icon (public/icons), emoji only as a last resort.
export function ResIcon({ id, size = 20, title }) {
  const key = RES_ICON[id];
  if (key)
    return (
      <img
        className="ros-ico"
        src={base + "icons/" + key + ".png"}
        alt={id}
        title={title || id}
        width={size}
        height={size}
        draggable="false"
      />
    );
  const collectible = COLLECTIBLES.find((x) => x.id === id);
  return (
    <span className="ros-ico-emoji" title={title || id}>
      {(collectible && collectible.icon) || "•"}
    </span>
  );
}

// The number to upgrade or buy (the original's Upgrade / Confirm Purchase popups): − n + and, ours, Max.
export function CountPicker({ value, max, onChange }) {
  return (
    <span className="ros-count">
      <button
        type="button"
        className="ros-count-btn"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        aria-label={tr("Fewer")}
      >
        −
      </button>
      <b className="ros-count-n">{value}</b>
      <button
        type="button"
        className="ros-count-btn"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={tr("More")}
      >
        +
      </button>
      {max > 2 ? (
        <button
          type="button"
          className="ros-count-btn ros-count-max"
          disabled={value >= max}
          onClick={() => onChange(max)}
        >
          {tr("Max")}
        </button>
      ) : null}
    </span>
  );
}
