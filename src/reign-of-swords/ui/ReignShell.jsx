import { useState, useEffect, useRef } from "react";
import ReignOfSwords from "./ReignOfSwords.jsx";
import { preloadReign } from "../engine/engine.js";
import GameLoader from "../../components/GameLoader.jsx";
import { HeraldryShield, BANNER_HERALDRY, factionCrest } from "./HeraldryShield.jsx";
import "./reign.css";
import {
  base,
  SANDBOX_ARMY,
  SANDBOX_ARMY_EP2,
  TRAINING_ARMIES,
  heraldTitle,
  loadHeraldry,
  loadPlayerName,
  subName,
  unseenLines,
  unlocksOf,
} from "../data/shell-data.js";
import { progressBefore } from "../data/campaign-rules.js";
import { Cutscene } from "./shell/Cutscene.jsx";
import { UpgradeArmy } from "./shell/UpgradeArmy.jsx";
import { MerchantShop } from "./shell/MerchantShop.jsx";
import { RewardScreen } from "./shell/RewardScreen.jsx";
import { StoryCodex } from "./shell/StoryCodex.jsx";
import { HelpScreen } from "./shell/FieldManual.jsx";
import { Heraldry } from "./shell/Heraldry.jsx";
import { SettingsPanel } from "./shell/SettingsPanel.jsx";
import DevBar from "./shell/DevBar.jsx";
import MainMenu from "./shell/MainMenu.jsx";
import Credits from "./shell/Credits.jsx";
import WorldMap from "./shell/WorldMap.jsx";
import { MissionPreview, RaidPreview } from "./shell/Briefings.jsx";
import OnlineLobby from "./online/OnlineLobby.jsx";
import OnlineMatch from "./online/OnlineMatch.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useStoredFlag } from "./shell/useStoredFlag.js";
import { useUiSounds } from "./shell/useUiSounds.js";
import { useEpisodeData } from "./shell/useEpisodeData.js";
import { useCampaignSave } from "./shell/useCampaignSave.js";
import { tr, useGameLang } from "../i18n/i18n.js";
export { HeraldryShield, BANNER_HERALDRY, factionCrest }; // re-exported for ui/ReignOfSwords.jsx
export { loadHeraldry, loadPlayerName, subName }; // re-exported for ui/ReignOfSwords.jsx + back-compat

// The whole game page, one per episode (`assetBase` = Episode II's data folder; absent = Episode I). It is a small
// state machine over `screen`:
//   menu ─ campaign (world map + camp) ─ cutscene ─ battle ─ cutscene ─ reward ─ campaign
//        ├ skirmish (battle with its own map picker)   ├ raidbattle (an optional raid)
//        ├ help (Field Manual)                          ├ merchant / heraldry (camp screens)
//        └ adminbattle (dev jump & training battles)
// The save lives in useCampaignSave; the data in useEpisodeData; the screens in ./shell.
export default function ReignShell({ assetBase = null }) {
  const dataBase = assetBase || base; // the episode's data folder (Episode II reuses Episode I's art: `base`)
  const isEp2 = !!assetBase;
  useGameLang(); // re-render everything when the game language changes (⚙ Settings)
  // While the game is on the page, mark the body: on a phone the site's header (name + menu) is hidden so the game
  // gets the whole screen (styles/phone.css, body.ros-playing). The page's "← Games" link stays as the way out.
  useEffect(() => {
    document.body.classList.add("ros-playing");
    return () => document.body.classList.remove("ros-playing");
  }, []);
  // Warm the battle caches (sprites, effects, tileset, sounds) in the background once the menu is up, so the first
  // battle opens without a loading pause.
  useEffect(() => {
    const preload = () => preloadReign({ base: dataBase, spriteBase: base });
    const id =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(preload, { timeout: 2500 })
        : setTimeout(preload, 800);
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [dataBase]);

  const { camp, battleEvents, levels, rewards } = useEpisodeData(dataBase);
  const [sfxMuted, toggleSfx, resetSfx] = useStoredFlag("ros-muted"); // effects ("ros-muted" kept for old saves)
  const [musicMuted, toggleMusic, resetMusic] = useStoredFlag("ros-muted-music");
  const [godArmy, toggleGodArmy] = useStoredFlag("ros-godarmy"); // DEV: field a full max army in campaign battles
  const playSfx = useUiSounds(sfxMuted);
  const save = useCampaignSave({ isEp2, rewards, playSfx });
  const { progress } = save;

  // Episode I has one camp-at-night splash; Episode II picks one of its two splash images on each visit, as the
  // original rotates its title art.
  const [menuBg] = useState(() =>
    isEp2 ? dataBase + (Math.random() < 0.5 ? "menu-bg-0.png" : "menu-bg-2.png") : dataBase + "menu-bg.png",
  );
  const [screen, setScreen] = useState("menu");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false); // About: the original game's credits
  const [onlineMatch, setOnlineMatch] = useState(null); // the online battle open (its match id)
  const auth = useAuth();
  const [battleSel, setSel] = useState({ ki: 0, mi: 0 }); // the story mission being fought (kingdom, mission index)
  const [cut, setCut] = useState({ lines: [], title: "", after: null, n: 0 }); // the cutscene playing (n: one per play)
  const [reward, setReward] = useState(null); // the "spoils earned" screen after a win
  const [kingdomOpen, setKingdomOpen] = useState(null); // the kingdom whose war plans are open on the world map
  const [preview, setPreview] = useState(null); // { ki, mi } of a story mission's brief
  const [raidPreview, setRaidPreview] = useState(null); // mapId of a raid's brief
  const [raidMapId, setRaidMapId] = useState(null); // the raid being fought
  const [adminMapId, setAdminMapId] = useState(null); // the dev-jump / training battle
  const [adminGod, setAdminGod] = useState(true); // dev jumps field the god army; training battles deliberately don't
  const [labWatch, setLabWatch] = useState(null); // a Battle Lab run being watched: { mapId, army, strategy, seed, turnLimit, n }
  const [devHidden, setDevHidden] = useState(true); // the dev bar starts collapsed on every visit…
  const [devBattleShown, setDevBattleShown] = useState(false); // …and, inside a battle, hidden unless asked for
  const returnRef = useRef("menu"); // where an admin / skirmish battle returns to
  const tutorialRef = useRef(false); // the admin battle is a training battle (a win marks it done)
  const campRef = useRef("menu"); // where the camp screens (merchant / heraldry) return to

  const playCutscene = (lines, title, after) => {
    if (!lines || !lines.length) {
      after && after();
      return;
    }
    setCut((prev) => ({ lines, title, after, n: prev.n + 1 })); // a new play starts at its first line, even back to back
    setScreen("cutscene");
  };
  const levelOf = (mapId) => (levels || []).find((l) => l.mapId === mapId) || {};
  const hasAny = (r) => r && ((r.units && Object.keys(r.units).length) || (r.spoils && Object.keys(r.spoils).length));
  // the title of a story battle by its map id (the locked-upgrade hints name the battle that opens them)
  const missionTitle = (mapId) => {
    for (const kingdom of (camp && camp.kingdoms) || [])
      for (const mission of kingdom.missions) if (mission.mapId === mapId) return mission.title || "";
    return "";
  };
  const showReward = (rewardShown, name) => {
    setReward({ ...rewardShown, name });
    setScreen("reward");
    playSfx("coins", 0.55);
  };

  // ---- story missions ----
  // Clicking a mission opens its brief; "Start Mission" plays the story cutscene and drops into the battle.
  const startMission = (kingdomIdx, missionIdx) => {
    setKingdomOpen(null);
    setPreview({ ki: kingdomIdx, mi: missionIdx });
  };
  // EPISODE II's own opening (user decision): entering the campaign plays Episode I's (its first chapters replay
  // Episode I), and this one plays before the first battle of the Eastern Kingdoms — any mission of a kingdom new to
  // Episode II while none of theirs is won yet.
  const episodeOpening = (kingdom) =>
    !kingdom.legacy &&
    camp.episodePrologue &&
    !camp.kingdoms.some((k) => !k.legacy && k.missions.some((m) => progress.has(m.mapId)))
      ? camp.episodePrologue
      : [];
  const beginMission = () => {
    if (!preview) return;
    const { ki: kingdomIdx, mi: missionIdx } = preview;
    setPreview(null);
    setSel({ ki: kingdomIdx, mi: missionIdx });
    const kingdom = camp.kingdoms[kingdomIdx],
      mission = kingdom.missions[missionIdx];
    const brief = missionIdx === 0 && kingdom.emperorBrief ? kingdom.emperorBrief : [];
    const toBattle = () => playCutscene([...brief, ...(mission.intro || [])], kingdom.name, () => setScreen("battle"));
    playCutscene(episodeOpening(kingdom), tr("The Reign of Swords"), toBattle);
  };
  const onBattleEnd = (result, casualties, major, shown = []) => {
    const kingdom = camp.kingdoms[battleSel.ki],
      mission = kingdom.missions[battleSel.mi];
    // lines the battle already showed (its ending conversation…) are not repeated by the result cutscene
    const unseen = (lines) => unseenLines(lines, shown);
    if (result !== "victory") {
      playCutscene(unseen(mission.defeat), tr("Defeat"), () => setScreen("campaign")); // a defeat is a retry; nothing is lost
      return;
    }
    // DELIBERATE DEVIATION (user-approved): a story mission rewards only its FIRST win. (The original computes the
    // first-win flag — Context+0x258+mission — and hands it to createRewardsMenu, which ignores it.) Raids stay the
    // every-win source (onRaidEnd). The unit reward comes through `progress` (armyOf), so it was already once-only.
    const firstWin = !progress.has(mission.mapId);
    save.markDone(mission.mapId);
    if (firstWin) save.grantMissionReward(mission.mapId);
    const earned = firstWin ? rewards[mission.mapId] || null : null;
    // Episode II: the first win of the battle that opens a new unit's upgrade says so (MenuScreen::onActivate, 800–804)
    const unlocked = firstWin ? unlocksOf(mission.mapId, isEp2) : [];
    playCutscene(unseen(mission.victory), tr("Victory"), () => {
      if (hasAny(earned) || unlocked.length) showReward({ ...earned, unlocked }, mission.title || kingdom.name);
      else setScreen("campaign");
    });
  };

  // ---- raids ----
  // Optional side-battles, fought with your real army, REPLAYABLE: their spoils AND units pay out on EVERY win (the
  // first win's units come through `progress`; later ones are added to the army). A MAJOR VICTORY (the enemy wiped
  // out while 40% of your deploy budget survives, GameScreen::checkOutcome) also pays one Medal — createRewardsMenu
  // adds it in every mode but the story campaign, so raids are the Medal source.
  const startRaid = (mapId) => {
    setKingdomOpen(null);
    setRaidPreview(mapId);
  };
  const beginRaid = () => {
    const mid = raidPreview;
    setRaidPreview(null);
    returnRef.current = "campaign";
    setRaidMapId(mid);
    setScreen("raidbattle");
  };
  const onRaidEnd = (result, casualties, major) => {
    const mid = raidMapId;
    if (result !== "victory") return setScreen("campaign");
    const repeat = progress.has(mid),
      drawn = save.rollReward(mid), // a random-reward raid draws anew on each win
      random = !!(rewards[mid] && rewards[mid].random),
      units = drawn && drawn.units;
    save.markDone(mid);
    save.grantMissionReward(mid, drawn);
    // a fixed reward's units reach the army through `progress` on the first win (armyOf); a drawn one never does
    if ((repeat || random) && units && Object.keys(units).length) save.addUnits(units);
    if (major) {
      save.addSpoils({ Medal: 1 });
      save.markMedalRaid(mid);
    }
    const earned = major
      ? {
          ...(drawn || {}),
          units: (drawn && drawn.units) || {},
          spoils: { ...((drawn && drawn.spoils) || {}), Medal: (((drawn && drawn.spoils) || {}).Medal || 0) + 1 },
        }
      : drawn;
    if (hasAny(earned)) showReward(earned, levelOf(mid).name || "Raid");
    else setScreen("campaign");
  };

  // ---- menus, dev tools ----
  const openCampaign = () => {
    if (progress.size === 0 && camp && camp.prologue)
      playCutscene(camp.prologue, tr("The Reign of Swords"), () => setScreen("campaign"));
    else setScreen("campaign");
  };
  const openTutorial = (mapId) => {
    returnRef.current = "campaign";
    tutorialRef.current = true;
    setLabWatch(null);
    setAdminGod(false);
    setKingdomOpen(null);
    setAdminMapId(mapId);
    setScreen("adminbattle");
  };
  const devJump = (mapId) => {
    if (mapId == null || mapId === "") return;
    if (screen !== "adminbattle") returnRef.current = screen;
    tutorialRef.current = false;
    setLabWatch(null);
    setAdminGod(true);
    setAdminMapId(Number(mapId));
    setScreen("adminbattle");
  };
  // Battle Lab "Watch": that run's battle on screen — same army, strategy and dice — with the Autopilot playing.
  const watchLabRun = (run) => {
    if (screen !== "adminbattle") returnRef.current = screen;
    tutorialRef.current = false;
    setAdminGod(false);
    setLabWatch((prev) => ({ ...run, n: ((prev && prev.n) || 0) + 1 }));
    setAdminMapId(run.mapId);
    setScreen("adminbattle");
  };
  const devSetProgress = (mapId) => {
    if (mapId == null || mapId === "" || !camp) return;
    save.replaceProgress(progressBefore(camp, levels, Number(mapId)));
    setKingdomOpen(null);
    setScreen("campaign");
  };
  const hardReset = () => {
    save.resetSave();
    for (const k of ["ros-muted", "ros-muted-music"]) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    }
    resetSfx();
    resetMusic();
    setKingdomOpen(null);
    setScreen("menu");
  };
  const openCamp = (tab) => {
    campRef.current = "campaign";
    setScreen(tab);
  };

  if (!camp)
    return (
      <div className="ros ros-shell">
        <GameLoader label={tr("Gathering the chronicle…")} />
      </div>
    );

  // Inside a battle the Story & Assets panel and the dev bar step aside so the battlefield fits one screen.
  const inBattle = screen === "battle" || screen === "adminbattle" || screen === "onlinematch";
  const sandbox = isEp2 ? SANDBOX_ARMY_EP2 : SANDBOX_ARMY;
  const battleProps = { sfxMuted, musicMuted, onSettings: () => setSettingsOpen(true), assetBase };
  const story = screen === "battle" ? camp.kingdoms[battleSel.ki].missions[battleSel.mi] : null;
  const previewMission = preview && camp.kingdoms[preview.ki].missions[preview.mi];

  return (
    <div className="ros ros-shell">
      {/* Story & Assets sits above the game; it hides with the dev bar (the 🛠 Dev pill) and inside a battle. */}
      {!devHidden && !inBattle && (
        <StoryCodex
          camp={camp}
          events={battleEvents}
          pbase={dataBase}
          levels={levels}
          rewards={rewards}
          onWatch={watchLabRun}
        />
      )}
      <DevBar
        open={inBattle ? devBattleShown : !devHidden}
        onOpen={() => (inBattle ? setDevBattleShown(true) : setDevHidden((h) => !h))}
        onClose={() => (inBattle ? setDevBattleShown(false) : setDevHidden((h) => !h))}
        inBattle={inBattle}
        levels={levels}
        camp={camp}
        onJump={devJump}
        onSetProgress={devSetProgress}
        godArmy={godArmy}
        onToggleGodArmy={toggleGodArmy}
        onGiveResources={save.giveResources}
        onHardReset={hardReset}
        musicMuted={musicMuted}
        onToggleMusic={toggleMusic}
        sfxMuted={sfxMuted}
        onToggleSfx={toggleSfx}
      />

      {screen === "menu" && (
        <MainMenu
          isEp2={isEp2}
          dataBase={dataBase}
          menuBg={menuBg}
          onCampaign={openCampaign}
          onSkirmish={() => {
            returnRef.current = "menu";
            setScreen("skirmish");
          }}
          onHelp={() => setScreen("help")}
          onOnline={() => setScreen("online")}
          onSettings={() => setSettingsOpen(true)}
          onAbout={() => setAboutOpen(true)}
        />
      )}
      {aboutOpen && <Credits dataBase={dataBase} onClose={() => setAboutOpen(false)} />}

      {screen === "campaign" && (
        <div className="ros-worldwrap ros-campaign">
          <div className="ros-screen-head ros-world-head">
            <h2>{tr(isEp2 ? "The Eastern Kingdoms" : "March of the Empire")}</h2>
            <button className="btn-run" onClick={() => setScreen("menu")}>
              ◂ {tr("Main Menu")}
            </button>
          </div>
          <div className="ros-campaign-cols">
            <div className="ros-worldmap-col">
              <WorldMap
                camp={camp}
                isEp2={isEp2}
                dataBase={dataBase}
                progress={progress}
                medalRaids={save.medalRaids}
                levels={levels}
                openKingdom={kingdomOpen}
                onOpenKingdom={setKingdomOpen}
                onCloseKingdom={() => setKingdomOpen(null)}
                onTutorial={openTutorial}
                onMission={startMission}
                onRaid={startRaid}
              />
            </div>
            <UpgradeArmy
              embedded
              army={save.armyOf()}
              spoils={save.spoils}
              onUpgrade={save.upgradeUnit}
              ep2={isEp2}
              progress={progress}
              missionTitle={missionTitle}
              heraldTier={heraldTitle(progress.size).border}
              onMerchant={() => openCamp("merchant")}
              onHeraldry={() => openCamp("heraldry")}
            />
          </div>
          {previewMission && (
            <MissionPreview
              title={previewMission.title}
              level={levelOf(previewMission.mapId)}
              onStart={beginMission}
              onBack={() => setPreview(null)}
            />
          )}
          {raidPreview != null && (
            <RaidPreview
              level={levelOf(raidPreview)}
              reward={rewards[raidPreview]}
              cleared={progress.has(raidPreview)}
              onBegin={beginRaid}
              onBack={() => setRaidPreview(null)}
            />
          )}
        </div>
      )}

      {screen === "cutscene" && (
        <Cutscene
          key={cut.n}
          lines={cut.lines}
          title={cut.title}
          pbase={dataBase}
          onDone={() => {
            const a = cut.after;
            a && a();
          }}
        />
      )}
      {screen === "reward" && reward && (
        <RewardScreen
          reward={reward}
          onDone={() => {
            setReward(null);
            setScreen("campaign");
          }}
        />
      )}

      {screen === "battle" && (
        <ReignOfSwords
          key={"c" + story.mapId + (godArmy ? "g" : "")}
          campaignMapId={story.mapId}
          onEnd={onBattleEnd}
          onExit={() => setScreen("campaign")}
          army={godArmy ? sandbox : save.armyOf()}
          godArmy={godArmy}
          {...battleProps}
        />
      )}

      {screen === "adminbattle" && (
        <ReignOfSwords
          key={"a" + adminMapId + (labWatch ? "w" + labWatch.n : "")}
          campaignMapId={adminMapId}
          autoplay={labWatch && labWatch.mapId === adminMapId ? labWatch : null}
          onEnd={(result) => {
            if (tutorialRef.current && result === "victory") save.markDone(adminMapId);
            tutorialRef.current = false;
            setScreen(returnRef.current);
          }}
          onExit={() => {
            tutorialRef.current = false;
            setScreen(returnRef.current);
          }}
          army={TRAINING_ARMIES[adminMapId] || sandbox}
          godArmy={TRAINING_ARMIES[adminMapId] ? false : adminGod}
          {...battleProps}
        />
      )}

      {screen === "raidbattle" && raidMapId != null && (
        <ReignOfSwords
          key={"r" + raidMapId + (godArmy ? "g" : "")}
          campaignMapId={raidMapId}
          onEnd={onRaidEnd}
          medals
          onExit={() => setScreen("campaign")}
          army={godArmy ? sandbox : save.armyOf()}
          godArmy={godArmy}
          {...battleProps}
        />
      )}

      {screen === "skirmish" && (
        <div className="ros-skirmish-wrap">
          <ReignOfSwords army={sandbox} onExit={() => setScreen("menu")} {...battleProps} />
        </div>
      )}
      {screen === "hotseat" && (
        // two players on one device, on the skirmish (head-to-head) maps — engine/hotseat.js
        <div className="ros-skirmish-wrap">
          <ReignOfSwords key="hotseat" army={sandbox} hotseat onExit={() => setScreen("menu")} {...battleProps} />
        </div>
      )}

      {screen === "merchant" && (
        <MerchantShop
          spoils={save.spoils}
          militia={save.armyOf().militiamen || 0}
          onTrade={save.merchantTrade}
          onRecruit={save.merchantRecruit}
          onBack={() => setScreen(campRef.current)}
        />
      )}
      {screen === "heraldry" && <Heraldry progress={progress} onBack={() => setScreen(campRef.current)} />}
      {screen === "help" && <HelpScreen onBack={() => setScreen("menu")} ep2={isEp2} />}

      {screen === "online" && (
        // Online Battles: lobbies with a password, live turn-based battles against another player, the leaderboard
        <OnlineLobby
          episode={isEp2 ? 2 : 1}
          levels={levels}
          onPlay={(id) => {
            setOnlineMatch(id);
            setScreen("onlinematch");
          }}
          onHotseat={() => setScreen("hotseat")}
          onBack={() => setScreen("menu")}
        />
      )}
      {screen === "onlinematch" && onlineMatch && auth && auth.user && (
        <OnlineMatch
          key={onlineMatch}
          matchId={onlineMatch}
          userId={auth.user.id}
          army={sandbox}
          battleProps={battleProps}
          onExit={() => setScreen("online")}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          musicMuted={musicMuted}
          sfxMuted={sfxMuted}
          onToggleMusic={toggleMusic}
          onToggleSfx={toggleSfx}
          transfer={inBattle ? null : { ep2: isEp2, onExport: save.exportArmy, onImport: save.importArmy }}
        />
      )}
    </div>
  );
}
