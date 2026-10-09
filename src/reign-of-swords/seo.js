// Search metadata for the two Reign of Swords pages — same shape as story-game/seo.js (GAME_SEO), so the runtime
// <Seo> (GamePage) and the build step that writes a static index.html per page (vite.config.js) both pick it up.
// Worded for people searching for the ORIGINAL games: Punch Entertainment's "Mobile Battles: Reign of Swords"
// (iPhone, 2008) and "Reign of Swords Episode II" (2009). Facts come from the original builds' own about/credits.
import { SITE_URL } from "../site.js";

const PUNCH = { "@type": "Organization", name: "Punch Entertainment" };

export const ROS_SEO = {
  "reign-of-swords": {
    path: "/games/reign-of-swords",
    lang: "en",
    locale: "en_US",
    title: "Reign of Swords (Mobile Battles, iPhone 2008) — play online",
    description:
      "Mobile Battles: Reign of Swords by Punch Entertainment, the 2008 iPhone turn-based tactics game, rebuilt to play in the browser: the full campaign, Sir Varius, real units and maps.",
    heading: "Reign of Swords",
    blurb: {
      en: "Mobile Battles: Reign of Swords — Punch Entertainment's 2008 iPhone tactics game, rebuilt from the original game data so it plays in the browser.",
      ru: "Mobile Battles: Reign of Swords — тактическая игра Punch Entertainment для iPhone (2008), восстановленная по данным оригинала: играйте прямо в браузере.",
      uk: "Mobile Battles: Reign of Swords — тактична гра Punch Entertainment для iPhone (2008), відновлена з даних оригіналу: грайте просто в браузері.",
    },
    intro: [
      "Reign of Swords (Mobile Battles: Reign of Swords) is a turn-based fantasy tactics game released by Punch Entertainment for iPhone and iPod touch in 2008. You lead Sir Varius and the armies of the Empire of Carrone to win back the breakaway kingdoms — Bordavia, Merovin, Marsur, Sangsoleil, Aguilleon, Hunewold and Rukiev — over a 24-mission campaign of field battles, sieges and raids.",
      "This page is a faithful browser re-creation built from the original iOS game's own data and code: the real maps, unit stats, damage table, scripted missions and enemy AI. Knights, Pikemen, Swordsmen, Militiamen, Archers, Crossbowmen, Musketeers, Rangers, Horse Bowmen, Griffon Riders, Wizards, Catapults, Cannon and Trebuchets fight with the original type-counters. No download or install — it runs in any modern browser, on desktop or phone.",
    ],
    game: {
      name: "Mobile Battles: Reign of Swords",
      alternateName: ["Reign of Swords", "Mobile Battles Reign of Swords", "Clash of Kingdoms"],
      genre: ["Turn-based tactics", "Strategy", "Fantasy"],
      datePublished: "2008",
      gamePlatform: ["iOS", "iPhone", "Web browser"],
    },
  },
  "reign-of-swords-2": {
    path: "/games/reign-of-swords-2",
    lang: "en",
    locale: "en_US",
    title: "Reign of Swords Episode II (iPhone 2009) — play online",
    description:
      "Mobile Battles: Reign of Swords Episode II by Punch Entertainment (iPhone, 2009), rebuilt to play in the browser: the full campaign with new units, sieges and the desert kingdoms.",
    heading: "Reign of Swords II",
    blurb: {
      en: "Mobile Battles: Reign of Swords Episode II — Punch Entertainment's 2009 iPhone sequel, rebuilt from the original game data so it plays in the browser.",
      ru: "Mobile Battles: Reign of Swords Episode II — продолжение от Punch Entertainment для iPhone (2009), восстановленное по данным оригинала: играйте прямо в браузере.",
      uk: "Mobile Battles: Reign of Swords Episode II — продовження від Punch Entertainment для iPhone (2009), відновлене з даних оригіналу: грайте просто в браузері.",
    },
    intro: [
      "Reign of Swords Episode II (Mobile Battles: Reign of Swords Episode II) is the 2009 sequel to Punch Entertainment's iPhone tactics game. Sir Varius returns to defend the Empire of Carrone against Martin Landower, and the 33-mission campaign carries the war beyond the old kingdoms into the desert lands of Zayandi, Sabbi Amar and Abbisin.",
      "This browser re-creation is built from the original Episode II data and code. It adds the sequel's new units — Craftsmen who build and repair, Ballistae, Conjurers, Sappers, Bodyguards, Dune Sirens and Blood Gorgers — alongside the Episode I army, with destructible walls, gates and houses. No download or install — it runs in any modern browser.",
    ],
    game: {
      name: "Mobile Battles: Reign of Swords Episode II",
      alternateName: ["Reign of Swords Episode II", "Reign of Swords 2", "Reign of Swords II"],
      genre: ["Turn-based tactics", "Strategy", "Fantasy"],
      datePublished: "2009",
      gamePlatform: ["iOS", "iPhone", "Web browser"],
    },
  },
};

// schema.org JSON-LD: the page is ABOUT the original game (author/publisher = Punch Entertainment), playable here.
function rosJsonLd(s) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: SITE_URL + s.path,
    name: s.title,
    description: s.description,
    inLanguage: s.lang,
    about: {
      "@type": "VideoGame",
      name: s.game.name,
      alternateName: s.game.alternateName,
      genre: s.game.genre,
      gamePlatform: s.game.gamePlatform,
      datePublished: s.game.datePublished,
      author: PUNCH,
      publisher: PUNCH,
      playMode: "SinglePlayer",
      url: SITE_URL + s.path,
    },
  };
}
Object.values(ROS_SEO).forEach((s) => {
  s.jsonLd = () => rosJsonLd(s);
});
