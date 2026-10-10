import { tr } from "../../i18n/i18n.js";

// The title screen: the episode's logo over its splash art, and the main entries (About = the original's credits).
export default function MainMenu({
  isEp2,
  dataBase,
  menuBg,
  onCampaign,
  onSkirmish,
  onHelp,
  onOnline,
  onSettings,
  onAbout,
}) {
  return (
    <div
      className={"ros-menu ros-menu-art" + (isEp2 ? " ros-menu-ep2" : "")}
      style={{ backgroundImage: `url(${menuBg})` }}
    >
      <img
        className="ros-menu-logo"
        src={dataBase + "menu-logo.png"}
        alt={isEp2 ? "Reign of Swords — Episode II" : "Reign of Swords"}
      />
      {!isEp2 && <p className="ros-menu-sub">{tr("The Battles of the Carrone Empire")}</p>}
      <div className="ros-menu-btns">
        <button className="btn btn-primary ros-menu-main" onClick={onCampaign}>
          {tr("Campaign")}
        </button>
        <button className="btn" onClick={onSkirmish}>
          {tr("Skirmish Battles")}
        </button>
        <button className="btn" onClick={onHelp}>
          📖 {tr("Field Manual")}
        </button>
        <button className="btn ros-menu-mp" onClick={onOnline}>
          {tr("Online Battles")}
        </button>
        <button className="btn" onClick={onSettings}>
          ⚙ {tr("Settings")}
        </button>
        <button className="btn" onClick={onAbout}>
          {tr("About")}
        </button>
      </div>
      <p className="ros-menu-foot">
        {tr("An unofficial fan remaster of the 2008 Punch Entertainment game, rebuilt from its original data.")}
      </p>
    </div>
  );
}
