import { tr } from "../../i18n/i18n.js";

// Where to report a bug — the same in the game, on the website and in the reign-of-swords-remastered repository.
export const BUG_REPORT = {
  github: "https://github.com/Tsarar/reign-of-swords-remastered/issues",
  linkedin: "https://bit.ly/dmytro-linkedin",
};

export function ReportBugLinks() {
  return (
    <span className="ros-bug-links">
      <a href={BUG_REPORT.github} target="_blank" rel="noopener noreferrer">
        {tr("GitHub Issues")}
      </a>
      {" · "}
      <a href={BUG_REPORT.linkedin} target="_blank" rel="noopener noreferrer">
        LinkedIn
      </a>
    </span>
  );
}

// The Settings section: where to report a bug, and what makes a report useful.
export function ReportBugGroup() {
  return (
    <div className="ros-settings-group ros-bug">
      <div className="ros-settings-label">{tr("Report a bug")}</div>
      <p className="ros-settings-note">
        {tr("Found something wrong? Report it here:")} <ReportBugLinks />
      </p>
      <ul className="ros-settings-note ros-bug-list">
        <li>
          {tr(
            "the 🐞 snapshot — in a battle, press 🐞 in the top bar; it copies the battle's units, turn, recent AI moves and dice rolls",
          )}
        </li>
        <li>{tr("screenshots")}</li>
        <li>{tr("what you did, what happened and what you expected")}</li>
        <li>
          {tr(
            "if it is about faithfulness to the original game: what you remember of it, a video, or a reference to the code",
          )}
        </li>
      </ul>
    </div>
  );
}
