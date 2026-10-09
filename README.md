# Reign of Swords Remastered

An unofficial fan remaster of the 2008/2009 Punch Entertainment games **Mobile Battles: Reign of Swords** (Episode I)
and **Reign of Swords Episode II**, rebuilt from the original game data to play in the browser.

The game here is the same as the one published on the author's website: the same code and the same data, copied
across by hand. The website adds online features around it that this repository leaves out.

## Play it on the website

- Episode I: <https://dmytro-portfolio-website.vercel.app/games/reign-of-swords>
- Episode II: <https://dmytro-portfolio-website.vercel.app/games/reign-of-swords-2>

Only on the website:

- **Online battles** against other players: open lobbies (optionally with a password), each player musters in
  secret, every move is shown live, and each turn has a clock.
- **Ratings and a leaderboard** for online battles, under a public name you choose.
- **An account** (GitHub or e-mail sign-in) and **cloud saves**: your campaign progress follows you to every device.
- **Offline play**: once opened online, the game keeps working without a connection.

Everything else — both campaigns, skirmishes, hot-seat, the Field Manual, Story & Assets and the Battle Lab — is the
same here and on the website.

## Run it locally

You need [Node.js](https://nodejs.org/) 20.19 or newer.

```bash
npm install
npm start
```

`npm start` opens the game at <http://localhost:5173>. Episode I opens by default; switch to Episode II with the
link above the game (or open <http://localhost:5173/#reign-of-swords-2>).

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Dev server, opens the browser |
| `npm run dev` | Dev server without opening the browser |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build |
| `npm test` | Unit tests (Vitest, jsdom) |
| `npm run lint` | ESLint over the game code |
| `npm run format` | Prettier over the game code |
| `npm run e2e:maps` | The map runner: whole battles played by the Autopilot (slow) |

## Layout

```
src/
  reign-of-swords/          the game — identical to the website's copy
    engine/ rules/ ai/        battle engine, game rules, the original AI
    render/ ui/               canvas rendering and the React screens
    data/ i18n/ online/       data loaders, RU/UK translations, online play (switched off here)
    __tests__/ e2e/           unit tests and the map runner
    docs/                     notes on the code
  components/GameLoader.*   the loading spinner the game uses
  auth/AuthContext.jsx      offline stand-in: nobody is signed in
  lib/supabase.js           offline stand-in: no backend, online battles are off
  site.js                   the origin the game's search metadata uses
  main.jsx, app.css         the page around the game (theme, buttons, Episode I / II switch)
public/games/
  reign-of-swords/          Episode I data, sprites, audio, UI art, MECHANICS.md, DATA-NOTES.md
  reign-of-swords-2/        Episode II data (shares Episode I's sprites and audio)
public/ros-atlas/           the interactive map and animation atlases (Story & Assets)
tools/ros/                  Python tools that extracted and audited the data from the original iOS game
```

Game rules, the decoded original code and every deliberate difference from the original game are documented in
[`public/games/reign-of-swords/MECHANICS.md`](public/games/reign-of-swords/MECHANICS.md) (the same file sits in the
Episode II folder).

## What does not work here

The website's own features need its backend, so in this repository:

- **There is no sign-in**: nobody is ever signed in.
- **Saves stay in your browser** (`localStorage`); there are no cloud saves.
- **Online battles are off**: the "Online Battles" menu says they are not available on this build. Hot-seat (two
  players on one device) still works.
- The site's header, other pages, search pages and offline mode are not included.

## Keeping in step with the website

Sync is manual. To bring this repository up to date, copy over from the website project:

- `src/reign-of-swords/` (everything except `node_modules/`)
- `public/games/reign-of-swords/` and `public/games/reign-of-swords-2/`
- `public/ros-atlas/` (the interactive map and animation atlases linked from Story & Assets)
- `tools/ros/` (without `bin/`; keep this repository's `rosdat.py` paths and the "Sir Varius" example in
  `export_levels.py`)
- `src/components/GameLoader.jsx` and `GameLoader.css`, if they changed

Leave out `src/reign-of-swords/docs/AI-HANDOFF.md` (the author's own working note; it is git-ignored here).

Then run `npm test` and `npm run lint`. The files under `src/auth/`, `src/lib/`, `src/site.js`, `src/main.jsx` and
`src/app.css` belong to this repository and are not copied.

## Data tools

The scripts in `tools/ros/` read the original game's files (the iOS `reignofswords.dat` archives and app binaries),
which are **not** included. Set `ROS_DAT_EP1` / `ROS_DAT_EP2` to your own copy of each episode's
`reignofswords.dat` (or place them at `extracted-assets/ios-episode-<n>/_raw/` beside this repository). The game itself
does not need them: everything it uses is already exported to `public/games/`.

## Disclaimer

This is a non-commercial fan project. It is not affiliated with, endorsed by or connected to Punch Entertainment.
Reign of Swords, its names, characters, art, music and sounds belong to their respective owners.
