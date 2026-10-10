# Reign of Swords — developer guide

A browser re-creation of Punch Entertainment's *Mobile Battles: Reign of Swords* (iPhone, 2008) and *Episode II*
(2009): turn-based grid tactics on the original maps, with the original rules. It is plain JavaScript on a
`<canvas>`, with a React shell around it. It runs at `/games/reign-of-swords` (Episode I) and
`/games/reign-of-swords-2` (Episode II).

**The one rule of this codebase: fidelity.** The maps, units, scripts and rules come from the original games' data
files and from their decompiled code. A comment such as `Unit::getSkill (iOS Ep2 @0x6adb0)` says *where in the
original binary* a rule was read from. When you change a rule, keep or update that citation. When the original is
silent and the code has to guess, say so in the comment. `docs/` holds the deeper reverse-engineering notes.

**Every deliberate difference from the original is listed** in §13 *Deviations from the original* of
`public/games/reign-of-swords/MECHANICS.md` (shown in-game under *Story & Assets*; the Episode II copy is the same
file) and marked `DELIBERATE DEVIATION` in the code. A new one goes on that list — anything not on it must match the
binaries.

---

## Quick start

```bash
npm run dev          # the site, with the game at http://localhost:5173/games/reign-of-swords
npm test             # the game's test suite (vitest + jsdom, ~1 min)
npm run coverage     # the same, with a line-coverage report
npm run format       # Prettier over the game's code (print width 120)
npm run lint         # ESLint (eslint.config.js): undefined names, unused imports, React hook rules
npm run e2e:maps     # every map played to the end by the Autopilot: problems + a difficulty rating per map
```

In development the live engine is `window.__reign` in the browser console. The **🛠 Dev** bar above the game can
jump to any battle, set campaign progress, field a "god army" and reset saves.

---

## Where things live

| Folder / file | What it holds |
|---|---|
| `ui/ReignShell.jsx` | **Entry point.** The whole game page, as a small state machine over `screen` (menu → campaign → cutscene → battle → reward …). It wires the pieces in `ui/shell/` together. |
| `ui/shell/` | The shell's parts. Hooks: `useCampaignSave` (the save: progress, army, spoils, upgrades, merchant), `useEpisodeData` (loading the episode's JSON), `useStoredFlag` / `useUiSounds` (settings, menu sounds). Screens: `MainMenu`, `WorldMap` (with each kingdom's war plans), `Briefings` (mission / raid briefs, the Online notice), `Cutscene`, `UpgradeArmy` (the camp / army panel), `MerchantShop`, `RewardScreen`, `StoryCodex` (Story & Assets, with `MechanicsDoc`), `FieldManual` (help pages, upgrade tree), `Heraldry`, `SettingsPanel`, `DevBar`. Shared atoms (unit sprite, skill chips, icons) are in `common.jsx`. |
| `ui/ReignOfSwords.jsx` | The **battle screen**: lays out the pieces in `ui/battle/` around the board and holds the popover state (briefing, objectives, manual, dialogue). |
| `ui/battle/` | The battle screen's parts: `useBattleEngine` (mounts the engine, gives back its state `s` and controller), `useFlash` (timed toasts), `TopBar`, `Toasts`, `Overlays` (briefing, objectives, manual, debug, confirms, result, dialogue), `DeployPanel`, `ControlRow`, `UnitCard` (selected / inspected unit, terrain info). |
| `ui/battle-ui.jsx`, `ui/HeraldryShield.jsx` | Battle HUD helpers (unit categories, labels, the sprite path) and the coat-of-arms renderer. |
| `ui/reign.css`, `ui/styles/` | The game's styles, one file per area (battle, skin, heraldry, deploy, shell, world map, army, codex, banners, medals) with the phone layouts last (`mobile.css`, `phone.css`). `reign.css` imports them in cascade order — later files override earlier ones, so keep that order. |
| `engine/engine.js` | The `Game` class (battle state + setup), `mountReign()` (creates a Game on a container and returns the controller the UI calls), `_emit()` (the state snapshot sent to React). |
| `engine/*.js` | The rest of the battle engine, one concern per file: `loop` (per-frame update), `grid` (tiles, movement, reach, targets), `input` (taps, selection, moving units), `turnflow` (turns, phases, win/lose), `deploy` (muster and battle start), `script` (the scenario script runner), `audio`, `debug` (bug-report snapshots). |
| `rules/*.js` | Game rules: `combat` (damage, counters, charges, projectiles, spells), `abilities` (Episode II skills: Build, Repair, Quicksand, Conjure, Detonate), `terrain` (what each map tile is and costs). |
| `ai/*.js` | The computer players: `ai` (per-unit decisions), `aimove` (path-finding and movement choice), `grouplogic` (armies acting as groups: hold / advance / formation). |
| `render/render.js` | Drawing the battlefield on the canvas: terrain, units, overlays, previews, effects, minimap. |
| `data/campaign-rules.js` | Which kingdoms, battles and raids are open (pure functions over the save). |
| `data/*.js` | Tables: `game-data` (unit roster, effects, colours), `combat-data` (the original's unit table and weapon × armour damage table, transcribed from the game data: check any edit with `tools/ros/units.py`), `missions` (turns `levels.json` records into playable missions), `shell-data` (campaign, rewards and Field Manual data for the UI). |
| `i18n/` | Interface and story translations (Russian, Ukrainian). The `tr()` function, keyed by the English text. |
| `util/` | Small helpers: geometry, volume settings, the asset ZIP download. |
| `seo.js` | Page metadata; also read by `vite.config.js` to pre-render the game pages. |
| `__tests__/` | The test suite and its helpers (see *Testing*). |
| `docs/` | Reverse-engineering notes: AI behaviour, data formats, Episode II abilities, the original research log. |

Outside this folder:

| Path | What |
|---|---|
| `public/games/reign-of-swords/`, `…-2/` | The game data per episode (`levels.json`, `campaign.json`, `movement.json`, `structures.json`, `waves.json`, `help.json`, …) and the art and sound. Episode II reuses Episode I's sprites and audio; only its data, tileset and portraits are its own. `MECHANICS.md` there is the rule-by-rule reference shown in-game under *Story & Assets*. |
| `tools/ros/*.py` | The Python tools that **generate** that data from the original `.dat` archives (`export_levels.py`, `gen_movement.py`, `units.py`…) and that read the original iOS binaries (`rosbin.py`, `rosrange.py`). If a data file looks wrong, fix the tool and regenerate; don't hand-edit the JSON. |

---

## How a battle runs

1. **Mount.** `ReignOfSwords.jsx` calls `mountReign(container, options)`. The engine loads the episode's JSON
   (`data/missions.js` `buildMissions()` turns each map record into a mission). It creates a `Game` and returns a
   **controller**: an object of plain functions (`ctrl.endTurn()`, `ctrl.holdUnit()`, `ctrl.aimSkill(id)`,
   `ctrl.startBattle()`, …). The UI only ever talks to the engine through the controller.
2. **State goes out.** Whenever something changes, the engine calls `this._emit()`. That builds a plain snapshot
   (phase, turn, unit counts, the selected unit's card, the deploy roster, the dialogue to show…) and passes it to
   the UI's `onState`. React re-renders from that snapshot. The canvas itself is drawn by the engine, not by React.
3. **Deployment** (`engine/deploy.js`). The player places units on the yellow zone within a point budget, then
   `startBattle()`. Tutorials and preset maps skip this.
4. **Turns** (`engine/turnflow.js`). The player's turn, then each allied and enemy **group** in the original
   order. Player actions come from taps (`engine/input.js` `click()`): select, move (`moveUnit`), attack
   (`rules/combat.js` `doAttack`), cast or use a skill. The AI's turn feeds one unit at a time through
   `game.ai.aiStep` (`ai/ai.js`), which decides and then uses the *same* move and attack functions the player does.
5. **Every frame** (`engine/loop.js` `update(dt)`) advances animations, projectiles, effects, the camera and the AI
   clock. Then `game.renderer` (`render/render.js`) draws the board.
6. **The scenario script** (`game.scenario`, `engine/script.js`) runs the map's own triggers: dialogue,
   reinforcements, win switches, retreats.
7. **The end.** `_terminal()` in `turnflow.js` applies the original's win/lose check. The phase becomes `victory`
   or `defeat`, the UI shows the result, and `ReignShell` records progress and rewards.

### The `Game` object

`Game` (`engine/engine.js`) is **the battle**: its state, the rules and the turn flow. It is one class assembled
from several files — `engine/` (grid, turn flow, input, deploy, the frame loop, debug) and `rules/` (combat,
abilities) — whose methods the `MIXINS` list copies onto `Game.prototype`, so they all run with `this` = the live
battle and can call one another. A method name defined in two files stops the game from loading with
"Game.x is defined twice", so you can't shadow one by accident. To find where a method lives, search for its
definition, e.g. `  computeReach(`.

Three parts are **their own objects**, each holding the battle as `this.game`:

| | | |
|---|---|---|
| `game.renderer` | `Renderer`, `render/render.js` | Draws the board. Only reads the battle (state + the rules' forecasts); keeps its own caches. |
| `game.ai` | `AiController`, `ai/controller.js` (+ `ai.js`, `aimove.js`, `grouplogic.js`) | Plays the AI-controlled sides through the same actions the player uses. The battle calls in at `aiStep`, `_glSetMode`, `_glHit`, `_garrisonCheckRelease`. |
| `game.scenario` | `ScenarioRunner`, `engine/script.js` | Runs the map's scenario script (state in `game._sc`). Called at setup (`init`, `runInitial`), from the loop (`onDeath`, `flush`, `onTileReached`) and the turn flow. |

So what each part needs from the battle is visible as `this.game.…`, and the battle's own code calls them by name
(`this.ai.…`, `this.scenario.…`). In tests: `g.ai._aiPickAttack(…)`, `g.renderer._drawOverlays(ctx)`.

- Battle state lives on the instance: `this.units` (each unit: `type`, `team` `"blue"`/`"red"`, `ally`, `tx`/`ty`
  tile, `hp` 0–100, `T` = its unit type's stats from `data/game-data.js`, plus per-turn flags such as `acted`),
  `this.tiles`, `this.phase`, `this.turn`, `this.mission`.
- Methods starting with `_` are internal. The ones the controller exposes are the public surface.
- Animation is asynchronous: an attack or move sets `this.anim` and finishes from the frame loop, then calls a
  `done` callback. Tests use `settle(g)` to run frames until everything has finished.

---

## Testing

Tests live in `__tests__/` and run on real game data (the JSON in `public/`). The helpers in `__tests__/battle.js`
build battles directly:

```js
await loadEpisode(2);                       // load an episode's data once (beforeAll)
const g = makeGame(5402);                   // a battle on map 5402
startBattle(g, "auto");                     // deploy an automatic army and start
const u = spawn(g, "knights", "blue", 4, 5); // put units where you need them
g.doAttack(u, foe); settle(g);              // act, then run frames until it all resolves
```

- `rules-kit.js` gives a blank board on open ground, for rule tests.
- **Golden replays** (`ai.test.js`, `episode1.test.js`) record whole AI turns as snapshots. When you *intentionally*
  change AI or combat behaviour, check the diff and refresh them with `npx vitest run -u`.
- `fuzz.js` and the `sweep-*` tests play random battles on every map, looking for crashes and broken invariants.
  `ROS_LONG=1 npm test` runs the long sweep.
- Coverage is close to 100% of lines. New code should come with a test.
- **Map runner** (`npm run e2e:maps`, tools/ros/e2e-maps.mjs): every campaign map, raid and battlefield of both
  episodes played start to finish by the Battle Lab's simulator, the Autopilot on your side with two armies built from
  the map's budget, over three strategies and three seeds, split over parallel vitest processes
  (`vitest.e2e.config.js` → `e2e/maps.e2e.js`). A battle that throws, never ends or logs a console error is a problem
  (exit code 1). Each map also gets a difficulty rating, 0–10, from its best strategy's win rate, army kept and turns.
  The report goes to `reports/ros-e2e/<date>/report.md`. Options: `--ep 2`, `--groups story,siege`, `--maps 5417,5600`,
  `--seeds 5`, `--strategies attack,safe`, `--armies line`, `--jobs 12`, `--realistic-siege` (the ⚙ setting on; the
  default plays the original); `--help` prints them all.

---

## Debugging a reported problem

- The **🐞** button in the battle bar copies a JSON snapshot: map, turn, every unit, the recent move/attack log and
  the dice rolls. In the dev console, `__reign.debugLoad(json)` rebuilds that position after you jump to the same
  map.
- Every dice roll (war-engine deviation, Fear courage checks…) is printed to the console as `[ROS roll] …`.

---

## Common tasks

| I want to… | Look at |
|---|---|
| change a unit's stats or weapons | `data/combat-data.js` holds the original's values; run `python tools/ros/units.py 1` and `… 2` afterwards, which audit it against the original unit table and must report no mismatches. Roster and display data are in `data/game-data.js` |
| change a combat rule | `rules/combat.js` (`computeDamage`, `resolveDamage`, counters, `_firstStrikeOf`, charges) |
| change what the AI does | `ai/ai.js` (`aiStep` and the `_ai*` steps), `ai/aimove.js` (where it moves), `ai/grouplogic.js` (groups) |
| change a map's script, waves or dialogue | regenerate with `tools/ros/export_levels.py`; the runner is `engine/script.js` |
| add or change interface text | write it in English inside `tr("…")`, then add the translation to `i18n/ru.js` and `i18n/uk.js` |
| change the battle layout | `ui/ReignOfSwords.jsx`, the piece in `ui/battle/` + `ui/styles/*.css` (phone layouts: `ui/styles/mobile.css` and `phone.css`) |
| add a sound | `engine/audio.js` (`SOUND_FILES`, `MUSIC_TRACKS`); files go in `public/games/reign-of-swords/audio/` |

---

## Conventions

- **ESLint** must stay clean (`npm run lint`). A missing import only fails when its screen renders, so the linter
  is the cheap guard. Where a hook's dependency list is deliberately short, say why next to the `eslint-disable` line.
- **Prettier** formats the code (`npm run format`, width 120). Files keep their existing line endings (some are
  CRLF, some LF); don't convert them.
- **Names say what a value is** (`dist`, `bestScore`, `moveBudget`, `occupant`), not `d`, `bs`, `mv`, `o`. The
  short names that stay are conventions, used the same way everywhere:
  - `u` a unit, `e` an enemy unit, `sel` the selected unit, `T` a unit's type stats (`u.T`), `a`/`b` in a sort or
    reduce; `gi` a scenario group index, `sid` a scenario unit id;
  - `tx, ty` tile coordinates, `px, py` pixel coordinates, `x, y` / `dx, dy` / `nx, ny` coordinates, steps and a
    neighbour inside a loop, `i, j, k` loop counters;
  - in drawing code: `g` the canvas 2D context, `cx, cy` a centre, `w, h` a size, `sx, sy, sw, sh` / `dw, dh` the
    source / destination rectangle of a `drawImage`, `r` a radius;
  - one-expression lambdas (`(o) => !o.dead`).
- **Distances** go through `manhattan(a, b)` from `util/util.js` (the game measures by tiles, 4-directional);
  `FAR` is the starting value of a nearest-so-far search. The AI's priorities are the named `SCORE` bands in
  `ai/ai.js`; its decision chain passes one `turn` object (`_aiFightOrAdvance` → `_aiPickAttack` / `_aiPickMove` /
  `_aiCarryOut`).
- **Comments explain *why*,** and cite the original where a rule comes from. The names in those citations
  (`Unit::endTurn`, `GameScreen::checkOutcome`) are the original game's own functions. Search `docs/` and
  `public/games/reign-of-swords/MECHANICS.md` for them.
- Saves are in `localStorage` under `ros-*` keys: `ros-campaign-v1` (+ `-ep2`), `ros-army-v3`, `ros-spoils-v3`,
  `ros-heraldry-v1`, `ros-name-v1`, plus settings. Bump the version suffix if a save format changes.

## Original game credits

Reign of Swords and Reign of Swords Episode II were made at Punch Entertainment by these people, as the games'
own About screens list them (also in the game: Main Menu → About).

**Episode I** (© 2008 Punch Entertainment)

- Creative Director: Steve Nix
- Designers: Steve Nix, Nick Harrison
- Assistant Designer: Kevin Messer
- Lead Engineers: Kyle Poole, Thuy Pham
- Engineers: Duong Nguyen, Quang Nguyen, Minh Dinh, Naoki Ogishi
- Lead Artist: Forrest Schehl
- Artists: Scott Watanabe, Durwin Au, Kevin Messer, Van Anh Le
- QA: Edwin Chu, Minh Le, Thuy Au, Thuy Nguyen, Thu Cam, Nga Nguyen, Frank Kim, Andrew Banegas
- Game Audio: Clean Cuts Music and Sound Design
- Special Thanks: Tobin Lent, Martin Geiger, Mike Williams, Son Bui, Spencer Chi, Darin Roland

**Episode II** (© 2009 Punch Entertainment)

- Original Game Design: Steve Nix
- Game Designers: Nick Harrison, Kevin Messer
- Art Director: Forrest Schehl
- Lead Artist: Durwin Au
- Artists: Kevin Messer, Ha Cam, Nick Harrison
- Engineering Manager: Quang Nguyen
- Lead Engineer: Thuy Pham
- Engineers: Christopher Dabney, Cuong Tran, Duong Nguyen, Hung Chu, Thanh Tran
- QA Manager: Edwin Chu
- QA Leads: Chien Tran, Andrew Banegas, Frank Kim
- QA: Thuy Nguyen, Nga Nguyen, Luyen Bui, Trang Tran, Huyen Nguyen
- Game Audio: Clean Cuts Music and Sound Design
- Special Thanks: Tobin Lent, Martin Geiger, Hung Lai, Brian Tan

## Disclaimer

This is a non-commercial fan project. It is not affiliated with, endorsed by or connected to Punch Entertainment.
Reign of Swords, its names, characters, art, music and sounds belong to their respective owners.

If you hold rights to Reign of Swords and want any of this material removed, open an
[issue](https://github.com/Tsarar/reign-of-swords-remastered/issues) or message me on
[LinkedIn](https://bit.ly/dmytro-linkedin), and it will be taken down.

Built with AI: the code, the decoding of the original games' data and binaries, and the documentation were written
together with Claude, Anthropic's AI model.
