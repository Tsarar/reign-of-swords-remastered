import { tr } from "../../i18n/i18n.js";
import { base } from "../battle-ui.jsx";
import { HeraldryShield, factionCrest } from "../HeraldryShield.jsx";
import { loadHeraldry } from "../../data/shell-data.js";

// A one-line message from the engine (an action explained: "Conjured units will die if…").
export function NoticeToast({ notice }) {
  return (
    <div key={notice.id} className="ros-wave-toast ros-notice-toast">
      {tr(notice.text, notice.vars ? { ...notice.vars, u: notice.vars.u ? tr(notice.vars.u) : undefined } : undefined)}
    </div>
  );
}

// Reinforcements arrived (a scripted wave), yours or the enemy's.
export function WaveToast({ wave }) {
  return (
    <div className={"ros-wave-toast " + (wave.side === "blue" ? "blue" : "red")}>
      {wave.side === "blue"
        ? "⚔ " + tr("Reinforcements! {n} of your units have marched in.", { n: wave.count })
        : "⚑ " + tr("A column has ridden in — {n} enemy reinforcements!", { n: wave.count })}
    </div>
  );
}

// Whose turn it is: the army's coat of arms, its name, the turn and the turns left.
export function TurnBanner({ banner, fast }) {
  return (
    <div
      className={
        "ros-turn-banner " +
        (banner.side === "player" ? "you" : banner.side === "ally" ? "ally" : "foe") +
        (fast === 2 ? " super" : fast ? " fast" : "")
      }
      key={banner.id}
      style={
        banner.side === "ally" && banner.color
          ? {
              background: `linear-gradient(180deg, rgba(${banner.color},0.96), rgba(${banner.color},0.66))`,
              borderColor: `rgb(${banner.color})`,
              color: "#fff",
            }
          : undefined
      }
    >
      <BannerCrest banner={banner} />
      <span className="ros-turn-label">
        {(banner.name && tr(banner.name) + (banner.armySide ? " · " + tr(banner.armySide) : "")) ||
          tr(banner.side === "player" ? "Your Turn" : banner.side === "ally" ? "Allied Army" : "Enemy Turn")}
      </span>
      <span className="ros-turn-sub">
        {tr(banner.side === "player" ? "Your turn" : banner.side === "ally" ? "Allied turn" : "Enemy turn")} ·{" "}
        {tr("Turn {n}", { n: banner.turn })}
        {banner.turnLimit ? " — " + tr("Turns Left: {n}", { n: banner.turnsLeft }) : ""}
      </span>
    </div>
  );
}

function BannerCrest({ banner }) {
  // your OWN heraldry (the crest you designed), not a stock device
  if (banner.side === "player")
    return (
      <span className="ros-turn-crest-shield">
        <HeraldryShield heraldry={loadHeraldry()} frame={0} size={84} />
      </span>
    );
  // the army's coat of arms straight from the scenario team record (field, colours, device) with the frame its
  // banner byte selects — the original's own composition, no per-faction overrides
  if (banner.crestH)
    return (
      <span className="ros-turn-crest-shield">
        <HeraldryShield heraldry={banner.crestH} frame={banner.crestH.frame} size={84} />
      </span>
    );
  // a named faction whose scenario banner is the generic 0 but has a real coat of arms (Aguilleon)
  const crest = factionCrest(banner.name);
  if (crest)
    return (
      <span className="ros-turn-crest-shield">
        <HeraldryShield heraldry={crest} frame={crest.frame} size={84} />
      </span>
    );
  if (banner.crest)
    return (
      <span className="ros-turn-crest-shield">
        <span
          className="ros-tcs-field"
          style={{
            background: `rgb(${banner.color || "120,124,134"})`,
            WebkitMaskImage: `url(${base}heraldry/000.png)`,
            maskImage: `url(${base}heraldry/000.png)`,
          }}
        />
        <img className="ros-tcs-frame" src={base + "heraldry/frames/0.png"} alt="" draggable="false" />
        <img className="ros-tcs-sym" src={base + "crests/" + banner.crest + ".png"} alt="" draggable="false" />
      </span>
    );
  return <span className="ros-turn-crest">{banner.side === "ally" ? "🛡" : "⚑"}</span>;
}
