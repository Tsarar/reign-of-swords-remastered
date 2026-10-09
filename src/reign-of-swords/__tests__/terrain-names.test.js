// Terrain names (rules/terrain tileName): the readout names a tile by its REAL terrain type (movement.json, the original's
// Map::getTileType), one name per rule set, both episodes — never the recreation's coarse per-tile category.
import { describe, it, expect } from "vitest";
import { loadEpisode, makeGame, startBattle } from "./battle.js";
import { tileName, tileProp } from "../rules/terrain.js";
import ru from "../i18n/ru.js";
import uk from "../i18n/uk.js";

describe("terrain names", () => {
  it("Episode II: forest floor, tall grass, hill slopes, rough ground, sand, boulders, portals each read as themselves", async () => {
    await loadEpisode(2);
    makeGame(5402);
    const names = {
      63: "Grass",
      64: "Tall grass",
      0: "Forest",
      65: "Forest", // the forest floor the trees stand on — it used to read "Grass"
      8: "Barricade", // the burnable spiked wooden barricades — they used to read "Hill"
      7: "Burnt barricade",
      4: "Burnt palisade",
      101: "Rocky ground", // the rocks beside the barricades and cliffs — it used to read "Road"
      62: "Wooden posts",
      59: "Wooden gate",
      118: "Road",
      68: "Bridge",
      67: "Deep water",
      72: "Shallow water",
      2: "Village",
      32: "Keep",
      133: "Sand",
      136: "Boulders",
      250: "Obelisk",
      180: "Grove",
      124: "Warp portal",
    };
    for (const [v, n] of Object.entries(names)) expect([v, tileName(Number(v))]).toEqual([v, n]);
    expect(tileName(99999)).toBe(null); // a tile id with no terrain type has no name (the readout falls back)
    // the 20% the readout shows for forest floor is the original's, and the name now agrees
    expect(Math.round(tileProp(65).defBonus * 100)).toBe(20);
  });

  it("every typed tile of both tilesets has a name, and every name is translated", async () => {
    for (const ep of [1, 2]) {
      await loadEpisode(ep);
      const g = makeGame(ep === 1 ? 5400 : 5402);
      const count = ep === 1 ? 124 : 260;
      for (let v = 0; v < count; v++) {
        const n = tileName(v);
        if (n == null) continue;
        expect(typeof n).toBe("string");
        expect([n, ru[n] != null, uk[n] != null]).toEqual([n, true, true]);
      }
      // the readout uses it
      startBattle(g, "auto");
      const spot = (() => {
        for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (!g.unitAt(x, y)) return [x, y];
      })();
      g.inspectTile(spot[0], spot[1]);
      expect(g.tileInfo.name).toBe(tileName(g.tileAt(spot[0], spot[1])));
    }
  });
});

describe("the terrain readout's real rules", () => {
  it("costs, passability and blocks come from the original's move table", async () => {
    await loadEpisode(2);
    const g = makeGame(5402);
    startBattle(g, "auto");
    // read a tile of each kind by planting it on an empty cell
    const spot = (() => {
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (!g.unitAt(x, y)) return [x, y];
    })();
    const read = (v) => {
      g.tiles[spot[1] * g.cols + spot[0]] = v;
      g.inspectTile(spot[0], spot[1]);
      return g.tileInfo;
    };
    expect(read(8)).toMatchObject({
      name: "Barricade",
      passable: true,
      def: 30,
      blocksMounted: false,
      blocksEngine: true,
      costs: { skirmish: 4, formation: 4, cavalry: 8, engine: null },
    });
    expect(read(67)).toMatchObject({ name: "Deep water", passable: false });
    expect(read(72)).toMatchObject({ name: "Shallow water", def: -20, passable: true });
    expect(read(181)).toMatchObject({ name: "Fountain", heal: 10 });
  });
});

describe("the ground under a unit (its card's 'Standing on' line)", () => {
  it("names the tile and gives the share of a blow the unit takes there, its Formation allies included", async () => {
    await loadEpisode(2);
    const g = makeGame(5428);
    startBattle(g);
    const u = g.units.find((x) => !x.dead && x.team === "blue" && !x.ally);
    let covered = null;
    for (let y = 0; y < g.rows && !covered; y++)
      for (let x = 0; x < g.cols && !covered; x++) {
        const t = g._tileInfoAt(x, y);
        if (t.passable && t.def > 0 && !g.unitAt(x, y)) covered = { x, y, t };
      }
    u.tx = covered.x;
    u.ty = covered.y;
    const ground = g._groundView(u);
    expect(ground.name).toBe(covered.t.name);
    expect(ground.takes).toBe(Math.round(Math.max(0.05, 1 - covered.t.def / 100 - 0.1 * ground.formation) * 100));
    expect(ground.takes).toBeLessThan(100);
    expect(g._selectedView(u).ground).toEqual(ground);
  });
});
