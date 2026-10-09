/* ============================================================
   Reign of Swords — battle-HUD presentation constants & tiny helpers.
   Pure lookup tables + one inline icon component. No game state.
   ============================================================ */

import { tr } from "../i18n/i18n.js";

export const base = import.meta.env.BASE_URL + "games/reign-of-swords/";

// Small inline HUD icon (52px skill/status PNGs) — used in the selected-unit panel so skills read as icons, not emoji.
export const SkIco = ({ n }) => (
  <img className="ros-tool-ico" src={base + "hud/" + n + ".png"} alt="" draggable="false" />
);

// ONE shared aim-skill row for every unit that AIMS an ability at a tile — the wizard's spells, the cannon's
// Grapeshot, the catapult's Barrage. `skills` is the engine's aimSkills() list, `active` the currently-armed id.
// Picking a skill arms/aims it (or disarms it if already armed) via onPick(id). Each button reads icon · name · range.
export function AimSkills({ skills, active, onPick, base: b = base }) {
  if (!skills || !skills.length) return null;
  return (
    <div className="ros-shift ros-aim-skills">
      <span className="ros-aim-skills-label">{tr("Skills:")}</span>
      {skills.map((sk) => (
        <button
          key={sk.id}
          className={
            "btn-run ros-shift-btn ros-aim-skill" +
            (active === sk.id ? " on" : "") +
            (sk.disabled ? " ros-skill-maxed" : "")
          }
          disabled={!!sk.disabled}
          onClick={() => !sk.disabled && onPick(sk.id)}
          title={tr(sk.desc, sk.vars)}
        >
          <img className="ros-tool-ico" src={b + "hud/" + sk.icon + ".png"} alt="" draggable="false" /> {tr(sk.name)}
          {sk.count && (
            <span className="ros-skill-cnt" title={tr(sk.countTitle || "minions standing / cap")}>
              {sk.count}
              {sk.disabled ? " · " + tr(sk.countNote || "limit") : ""}
            </span>
          )}
          {sk.dmg && <span className="ros-skill-rng ros-skill-dmg">{tr("dmg") + " " + sk.dmg}</span>}
          <span className="ros-skill-rng">
            {tr("rng") + " " + (sk.min === sk.max ? sk.min : sk.min + "–" + sk.max)}
          </span>
        </button>
      ))}
    </div>
  );
}

export const GROUP_LABEL = { story: "Campaign", siege: "Raids", skirmish: "Battlefields", special: "Tutorials" };

// Ability description line → its skill icon (matched on the ability name that begins the string).
export const ABIL_ICO = {
  Charge: "skill_charge",
  "Fire Arrows": "skill_firearrows",
  "Move or Shoot": "skill_moveshoot",
  "Shoot and Move": "skill_shootmove",
  "Last Strike": "skill_last",
  "First Strike": "skill_first",
  "Pike Wall": "skill_pikewall",
  "Blast Area": "skill_blast",
  Barrage: "skill_blast",
  Siege: "skill_siege", // Low Arc / Arc: words only, no icon
  Grapeshot: "skill_grapeshot", // cannon point-blank scatter cone — the 005 action strip's rightmost glyph
  Cannonball: "atk_ranged", // cannon's single true shell at range — a single-shot glyph, not an area blast
  Fear: "skill_fear",
  "Spirit Shroud": "skill_shroud",
  "Greater Shapeshift": "skill_shapeshift",
  "Battle Standard": "skill_standard",
  Fireball: "skill_fireball",
  Prayer: "skill_prayer",
  "Prayer: Heal": "skill_prayer",
  "Prayer: Shield": "status_shield",
  "Prayer: Retribution": "status_bless",
  Formation: "skill_formation",
  Stealth: "skill_stealth",
  Ambush: "skill_ambush",
  // EPISODE II abilities (own icon art)
  Quicksand: "skill_quicksand",
  "Life Steal": "skill_lifesteal",
  Absorb: "skill_absorb",
  Detonate: "skill_detonate",
  "Siege Armor": "skill_siegearmor",
  "Piercing Bolt": "skill_pierce",
  "Build & Repair": "skill_build",
  Build: "skill_build",
  Repair: "skill_repair",
  Conjure: "skill_conjure",
};
export const abilIcon = (a) => {
  if (!a) return null;
  // the LONGEST matching name wins, so "Siege Armor …" gets its own icon rather than plain "Siege"'s
  let best = null;
  for (const k in ABIL_ICO) if (a.startsWith(k) && (!best || k.length > best.length)) best = k;
  return best ? ABIL_ICO[best] : null;
};

// Deployment roster grouping — the muster screen sorts your legion by role so the list is scannable.
export const UNIT_CATEGORY = {
  militiamen: "Levy",
  footmen: "Levy",
  swordsmen: "Infantry",
  greatswordsmen: "Infantry",
  pikemen: "Infantry",
  halberdiers: "Infantry",
  archers: "Missile",
  crossbowmen: "Missile",
  musketeers: "Missile",
  rangers: "Missile",
  cavalry: "Cavalry",
  knights: "Cavalry",
  raiders: "Cavalry",
  horsebowmen: "Cavalry",
  catapult: "Siege",
  trebuchet: "Siege",
  cannon: "Siege",
  shamans: "Casters",
  druids: "Casters",
  wizards: "Casters",
  priests: "Casters",
  griffon: "Flying",
  // Episode II units the player can muster (once upgraded into them)
  craftsmen: "Infantry",
  bloodgorgers: "Infantry",
  ballistae: "Siege",
  conjurer: "Casters",
  dunesirens: "Casters",
};
export const CATEGORY_ORDER = ["Levy", "Infantry", "Missile", "Cavalry", "Siege", "Casters", "Flying"];

// The Shapeshift buttons show each form's own standing sprite (UnitCard) beside its name.
export const SHIFT_NAME = {
  druids: "Druid",
  stag: "Stag",
  greateagle: "Great Eagle",
  bear: "Guardian Bear",
};
export const ROLE = {
  melee: "Infantry",
  spear: "Anti-cavalry",
  axe: "Armour-breaker",
  ranged: "Ranged",
  cavalry: "Cavalry",
  siege: "Siege",
  hero: "Hero",
};
// Combat tip per unit KIND. These describe the unit's REAL mechanic from the data model — the actual bonuses in
// computeDamage are Charge (+30), Pike-Wall brace (+30), Formation cover, fire ×2 and range. Damage itself is
// weapon-vs-ARMOUR (WEAPON_DMG); there is NO weapon-vs-weapon triangle (footmen even carry a Spear).
export const MATCHUP = {
  spear: "Spearmen — a Pike Wall braces for +30 damage against a charging mount.",
  melee: "Line infantry — cheap and sturdy; hold the line and box the enemy in.",
  axe: "Heavy two-handed blade — among the hardest-hitting melee weapons.",
  cavalry: "Charge — +30 on a foe at least 3 tiles away down a straight lane, and no counter-attack.",
  ranged: "Strikes from range — the target can't strike back.",
  siege: "Long-range shot that ignores formation cover.",
  hero: "The Hero — his Battle Standard rallies allies within 4 tiles (+15 attack and courage), and he strikes first.",
};
// The beast/flyer types share the "cavalry" KIND (fast movement) but aren't horses — they get their own blurb (a Great
// Eagle flies and has NO charge; a Stag gores like a charge; a Bear brings Fear).
export const TYPE_DESC = {
  greateagle: "A swift flyer — soars over any terrain and strikes with its talons.",
  stag: "A fleet charger — its charge rides on through the foot soldiers it cuts down.",
  bear: "A mighty beast — Fear grips adjacent foes so they dare not strike.",
  griffon: "A flying charger — Fear grips adjacent foes; its charge rides on through the foot soldiers it cuts down.",
};
export const descFor = (u) => u && (TYPE_DESC[u.type] || MATCHUP[u.kind]);
