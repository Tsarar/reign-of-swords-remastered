// The manual QA checklist of 2026-10-07 (the last five commits: 478ca3d, 23ac16a, 970d633, 0da867b, 0847eca and the
// healer's skip prompt), one test per numbered case, played through the engine on an Episode II field.
// Case 40 (hot-seat conquering) is covered by hotseat.test.js.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadEpisode, makeGame, startBattle, spawn } from "./battle.js";
import { openArea } from "./rules-kit.js";
import { recCtx, texts } from "./render-helpers.js";
import { UNIT_TYPES, FX_TYPES } from "../data/game-data.js";
import { ALL_TYPES, SANDBOX_ARMY, ABILITY_INFO } from "../data/shell-data.js";
import { ARMOUR_NAME } from "../data/combat-data.js";
import { wholeHp, shownHp } from "../util/util.js";
import { structTrans } from "../rules/terrain.js";

beforeAll(() => loadEpisode(2));

// ---------------------------------------------------------------- harness
function field() {
  const g = makeGame(5410);
  startBattle(g);
  g.units = [];
  g.prayerMarks = [];
  g.quicksand = new Map();
  vi.spyOn(g.ai, "aiStep").mockImplementation(() => {}); // no other AI moves while a case plays out
  vi.spyOn(g, "_deviationPct").mockReturnValue(0); // war-engine shots land where aimed
  return g;
}
const mk = (g, type, team, x, y, extra = {}) => spawn(g, type, team, x, y, { acted: false, moved: false, ...extra });
// record every effect, sound and floating number while `fn` and the animations it starts play out
function play(g, fn, frames = 2000) {
  const fx = [],
    sounds = [],
    floats = [],
    seen = new Set();
  const fxSpy = vi.spyOn(g, "spawnFx").mockImplementation(function (name, x, y, opts = {}) {
    fx.push({ name, x, y, delay: opts.delay || 0, t: g._clock || 0 });
    return Object.getPrototypeOf(g).spawnFx.call(g, name, x, y, opts);
  });
  const realPlay = g.audio.play.bind(g.audio);
  const sndSpy = vi.spyOn(g.audio, "play").mockImplementation((name, ...rest) => {
    sounds.push(name);
    return realPlay(name, ...rest);
  });
  const grab = () => {
    for (const f of g.floaters)
      if (!seen.has(f)) {
        seen.add(f);
        const on = g.units.find((u) => Math.abs(u.px + g.tile / 2 - f.x) < 2 && Math.abs(u.py - f.y) <= g.tile);
        floats.push({ on, text: String(f.text), t: g._clock || 0 });
      }
  };
  g._clock = 0;
  fn();
  grab();
  for (let i = 0; i < frames; i++) {
    if (g.pendingSkip) g.confirmSkip();
    g.update(1 / 60);
    g._clock += 1 / 60;
    grab();
    if (i > 30 && !g.anim && !g.projectiles.length && !(g._delayed && g._delayed.length)) break;
  }
  fxSpy.mockRestore();
  sndSpy.mockRestore();
  const fxNames = fx.map((e) => e.name);
  const marks = fxNames.filter((n) => n === "slash" || n === "impact" || n === "holysword");
  const on = (u) => floats.filter((f) => f.on === u).map((f) => f.text);
  return { fx, fxNames, marks, sounds, floats, on };
}
// the player's unit strikes; an enemy unit strikes (on the enemy's turn)
const playerHits = (g, a, d) => play(g, () => ((g.phase = "player"), g.doAttack(a, d)));
const enemyHits = (g, a, d) => play(g, () => ((g.phase = "enemy"), g.ai.doAttackAI(a, d, () => {})));
// a blue Priest's Retribution, cast for real on the player's turn
function retribution(g, x = 6, y = 6) {
  g.phase = "player";
  const pr = mk(g, "priests", "blue", x, y);
  g.selected = pr;
  g.mode = "act";
  play(g, () => g.invokeRetribution());
  g.selected = null;
  g.mode = "select";
  return pr;
}
const SMITE = 10; // 25 of 256, in whole HP

// ---------------------------------------------------------------- 0847eca  hit marks, shots, impacts, sounds
describe("0847eca — hit marks, shots, impacts and sounds", () => {
  const markOf = (type, extra) => {
    const g = field();
    const a = mk(g, type, "blue", 4, 4, extra),
      d = mk(g, "footmen", "red", 5, 4);
    vi.spyOn(g, "_countersAfter").mockReturnValue(false); // the blow alone
    return playerHits(g, a, d).marks;
  };

  it("1. a swordsman's blow leaves ONE slash, the spear counter ONE blood burst", () => {
    const g = field();
    const a = mk(g, "swordsmen", "blue", 4, 4),
      d = mk(g, "militiamen", "red", 5, 4);
    expect(playerHits(g, a, d).marks).toEqual(["slash", "impact"]);
  });

  it("2. Pikemen, Druids and a spear draw blood", () => {
    for (const t of ["pikemen", "druids", "militiamen", "footmen"]) expect(markOf(t)).toEqual(["impact"]);
  });

  it("3. Knights, a Priest's staff, a Wizard up close and the Hero slash — never the sword of light", () => {
    for (const t of ["knights", "priests", "wizards", "king"]) expect(markOf(t)).toEqual(["slash"]);
  });

  it("4. the Bite and the Mallet leave no mark and play their own clips (47 / 49)", () => {
    for (const [t, clip] of [
      ["bloodgorgers", "melee_bite"],
      ["craftsmen", "melee_mallet"],
    ]) {
      const g = field();
      const a = mk(g, t, "blue", 4, 4),
        d = mk(g, "footmen", "red", 5, 4);
      vi.spyOn(g, "_countersAfter").mockReturnValue(false);
      vi.spyOn(g, "_preStrike").mockReturnValue(false); // the Gorger's Last Strike would let the footman swing first
      const r = playerHits(g, a, d);
      expect(r.marks).toEqual([]);
      expect(r.sounds).toContain(clip);
    }
  });

  it("5. a wounded Blood Gorger sparkles as it drains, with its +N", () => {
    const g = field();
    const bg = mk(g, "bloodgorgers", "blue", 4, 4, { hp: 50 }),
      d = mk(g, "footmen", "red", 5, 4);
    const r = play(g, () => g.resolveDamage(bg, d, {}));
    expect(r.fxNames).toContain("spark");
    expect(r.on(bg).some((t) => /^\+\d+$/.test(t))).toBe(true);
  });

  it("6–7. Fire Arrows: the plain arrow at footmen and the Cannon, the flaming one at a flammable engine or a building", () => {
    const g = field();
    const a = mk(g, "archers", "blue", 2, 4),
      foot = mk(g, "footmen", "red", 6, 4),
      cat = mk(g, "catapult", "red", 6, 6),
      treb = mk(g, "trebuchet", "red", 5, 7),
      bal = mk(g, "ballistae", "red", 4, 8),
      can = mk(g, "cannon", "red", 6, 2);
    const fireAt = (t) => (g.fireProjectile(a, t), g.projectiles.at(-1).fire);
    expect(fireAt(foot)).toBe(false);
    expect(fireAt(can)).toBe(false); // the Cannon is not Flammable (abilities 3, 7, 26)
    expect([fireAt(cat), fireAt(treb), fireAt(bal)]).toEqual([true, true, true]);
    expect(fireAt({ px: 6 * g.tile, py: 9 * g.tile, tx: 6, ty: 9 })).toBe(true);
  });

  it("8. the Trebuchet throws the grey stone, lands in the rock burst, crashes with sound 32", () => {
    const g = field();
    const treb = mk(g, "trebuchet", "blue", 2, 6),
      t = mk(g, "footmen", "red", 8, 6);
    const r = play(g, () => g.fireProjectile(treb, t));
    expect(r.fxNames).toEqual(["rockblast"]);
    expect(UNIT_TYPES.trebuchet.projectile).toBe("stone");
    expect(g._impactSound(treb, "stone", true, false)).toBe("boulder_hit");
    expect(r.sounds).toContain("catapult"); // the launch, shared with the Catapult (33)
  });

  it("9. Catapult rocks: the earth burst on the target and its four neighbours, the rock crash (25)", () => {
    const g = field();
    const cat = mk(g, "catapult", "blue", 2, 6),
      t = mk(g, "footmen", "red", 7, 6);
    const r = play(g, () => g.fireProjectile(cat, t));
    expect(r.fxNames.filter((n) => n === "dust")).toHaveLength(5);
    expect(r.fxNames).not.toContain("rockblast");
    expect(g._impactSound(cat, "stone", true, false)).toBe("rock_hit");
  });

  it("10. the Cannon at range: its boom, the fire burst, the burst's clip (13)", () => {
    const g = field();
    const can = mk(g, "cannon", "blue", 2, 6),
      t = mk(g, "footmen", "red", 7, 6);
    const r = play(g, () => g.fireProjectile(can, t));
    expect(r.fxNames).toContain("fire");
    expect(r.fxNames).not.toContain("blast");
    expect(r.sounds).toContain("cannon");
    expect(g.projectiles.length ? g.projectiles[0].impactSnd : g._impactSound(can, "ball", false, true)).toBe(
      "explosion",
    );
  });

  it("11. the musket: a muzzle flash, and the ball lands without a clip", () => {
    const g = field();
    const mu = mk(g, "musketeers", "blue", 2, 6),
      t = mk(g, "footmen", "red", 5, 6);
    const r = play(g, () => g.fireProjectile(mu, t));
    expect(r.fxNames).toContain("flash");
    expect(r.sounds).toContain("gun");
    expect(g._impactSound(mu, "bullet", false, false)).toBeNull();
  });

  it("12. a heal sparkles on the ALLY only, reads +20 and chimes", () => {
    const g = field();
    const p = mk(g, "priests", "blue", 4, 4),
      ally = mk(g, "footmen", "blue", 5, 4, { hp: 40 });
    g.phase = "player";
    const r = play(g, () => g.healUnit(p, ally));
    expect(r.fxNames).toEqual(["spark"]);
    expect(r.fx[0].x).toBe(ally.px + g.tile / 2);
    expect(r.on(ally)).toEqual(["+20"]);
    expect(r.sounds).toContain("heal");
  });

  it("13. the Siren's Quicksand cast plays 22 and 57; a unit stepping in shows the slash and reads 5", () => {
    const g = field();
    const s = mk(g, "dunesirens", "blue", 4, 4);
    vi.spyOn(g, "_canLayQuicksand").mockReturnValue(true);
    g.phase = "player";
    const cast = play(g, () => g._castQuicksand(s, 5, 4));
    expect(cast.sounds).toEqual(expect.arrayContaining(["cast", "quicksand"]));
    expect(cast.fxNames).toContain("sand_skull");
    const g2 = field();
    const f = mk(g2, "footmen", "blue", 3, 6);
    g2.quicksand = new Map([["4,6", 3]]);
    g2.phase = "player";
    g2.select(f);
    const step = play(g2, () => g2.click({ tx: 4, ty: 6 }));
    expect(step.fxNames).toContain("slash");
    expect(step.on(f)).toEqual(["5"]);
    expect(shownHp(f.hp)).toBe(95);
  });

  // a structure one blow from its last stage, on an empty cell
  function ruin(g, x, y) {
    let id = 0;
    while (!(structTrans(id) != null && structTrans(structTrans(id)) == null)) id++;
    g.tiles[y * g.cols + x] = id;
    g.structHp.set(x + "," + y, -1); // any blow now brings it down
  }

  it("14. a Catapult shot or a Lightning Storm that razes a house raises the dust ring there", () => {
    const g = field();
    const cat = mk(g, "catapult", "blue", 2, 6);
    ruin(g, 7, 6);
    const r = play(g, () => g.damageStructure(cat, 7, 6));
    expect(g.razed.has("7,6")).toBe(true);
    expect(r.fxNames).toContain("sand_puff");
    const w = mk(g, "wizards", "blue", 2, 9);
    ruin(g, 8, 9);
    const r2 = play(g, () => g._areaStructureHit(w, 8, 9, 1, 26));
    expect(r2.fxNames).toContain("sand_puff");
  });

  it("15. a single Archer shot that razes it raises none", () => {
    const g = field();
    const a = mk(g, "archers", "blue", 2, 6);
    ruin(g, 6, 6);
    const r = play(g, () => g._structureBlow(a, 6, 6, 1, 16));
    expect(g.razed.has("6,6")).toBe(true);
    expect(r.fxNames).not.toContain("sand_puff");
  });

  it("16. kept on purpose: blood on shot victims, the Ice Field bolt and cast sparkle, the Fireball's flames", () => {
    const g = field();
    const a = mk(g, "archers", "blue", 2, 4),
      d = mk(g, "footmen", "red", 6, 4);
    expect(play(g, () => g.resolveDamage(a, d, {})).marks).toEqual(["impact"]);
    const w = mk(g, "wizards", "blue", 2, 8, { spell: "ice" }),
      t = mk(g, "footmen", "red", 6, 8);
    const ice = play(g, () => g.fireProjectile(w, t));
    expect(ice.fxNames).toContain("cast");
    expect(g.projectiles.length ? g.projectiles[0].spell : "ice").toBe("ice");
    w.spell = "fireball";
    expect(play(g, () => g.fireProjectile(w, t)).fxNames).toEqual(expect.arrayContaining(["blast", "fire"]));
  });

  it("17. the animations atlas labels the strips by their use", () => {
    const atlas = JSON.parse(readFileSync(join(process.cwd(), "public/ros-atlas/anim.json"), "utf8"));
    const use = (k) => atlas.strips.ep2[k].use;
    expect(use(8)).toMatch(/sword of light/);
    expect(use(40)).toMatch(/aimed Boulder \/ Cannonball/);
    expect(use(27)).toMatch(/Trebuchet/);
    const raw = (z) => atlas.raw.find((r) => r.path.startsWith("android/effects/" + z));
    expect([raw("z_003").used, raw("z_021").used, raw("z_022").used, raw("z_027").used]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

// ---------------------------------------------------------------- 0da867b  whole-number HP, Retribution's animations
describe("0da867b — whole-number HP and Retribution's angel and sword of light", () => {
  it("18. a heal from 50 HP: +20, the badge reads 70 (whole HP — the original's 256 scale would show 69)", () => {
    const g = field();
    const p = mk(g, "priests", "blue", 4, 4),
      ally = mk(g, "footmen", "blue", 5, 4, { hp: 50 });
    g.phase = "player";
    const r = play(g, () => g.healUnit(p, ally));
    expect(r.on(ally)).toEqual(["+20"]);
    const ctx = recCtx();
    g.renderer._drawHP(ctx, ally);
    expect(texts(ctx)).toContain("70");
  });

  it("19. HP badges stay whole after quicksand, an Ice Field and a blast; a living unit never reads 0", () => {
    const g = field();
    const f = mk(g, "footmen", "blue", 4, 4);
    g.quicksand = new Map([["4,4", 2]]);
    vi.spyOn(g, "_quicksandImmune").mockReturnValue(false);
    g._quicksandEnter(f);
    const w = mk(g, "wizards", "red", 9, 4, { spell: "ice" });
    play(g, () => g.resolveDamage(w, f, {}));
    const cat = mk(g, "catapult", "red", 4, 10);
    play(g, () => g.resolveDamage(cat, f, { siege: true }));
    const ctx = recCtx();
    g.renderer._drawHP(ctx, f);
    expect(texts(ctx).some((s) => /^\d+$/.test(String(s)))).toBe(true);
    expect(texts(ctx).some((s) => String(s).includes("."))).toBe(false);
    expect(Number.isInteger(f.hp)).toBe(true);
    expect(shownHp(0.4)).toBe(1);
  });

  it("20. the player's Retribution: the angel, five tiles across, centred a tile above the Priest, 0.75 s, the chime", () => {
    const g = field();
    const pr = mk(g, "priests", "blue", 6, 6);
    g.phase = "player";
    g.selected = pr;
    g.mode = "act";
    const r = play(g, () => g.invokeRetribution());
    const angel = r.fx.find((e) => e.name === "angel");
    expect([angel.x, angel.y]).toEqual([pr.px + g.tile / 2, pr.py - g.tile / 2]);
    expect(FX_TYPES.angel.frameW * FX_TYPES.angel.scale).toBe(5 * 64);
    expect(FX_TYPES.angel.dur).toBe(0.75);
    expect(r.sounds).toContain("heal");
  });

  it("21. an enemy Priest's Retribution shows the same angel", () => {
    const g = field();
    const pr = mk(g, "priests", "red", 10, 6);
    mk(g, "footmen", "red", 10, 5);
    mk(g, "footmen", "red", 10, 7);
    const foes = [mk(g, "footmen", "blue", 7, 6), mk(g, "swordsmen", "blue", 7, 5)];
    g.phase = "enemy";
    const r = play(g, () => g.ai._priestPray(pr, foes, () => {}));
    expect(g._retributioned(g.unitAt(10, 5))).toBe(true);
    expect(r.fxNames).toContain("angel");
    expect(r.sounds).toContain("heal");
  });

  it("22. a smite plays out: the blow, the sword of light 0.2 s into state 14, the 10 at 0.75 s, then the counter", () => {
    const g = field();
    retribution(g);
    const gu = mk(g, "footmen", "blue", 7, 6),
      en = mk(g, "footmen", "red", 8, 6);
    const r = enemyHits(g, en, gu);
    const sword = r.fx.find((e) => e.name === "holysword");
    expect(sword.delay).toBeCloseTo(0.2, 5);
    const blow = r.floats.find((f) => f.on === gu),
      smite = r.floats.find((f) => f.on === en && f.text === "10"),
      counter = r.floats.filter((f) => f.on === en)[1];
    expect(blow.t).toBeLessThanOrEqual(sword.t);
    expect(smite.t - sword.t).toBeGreaterThanOrEqual(0.74);
    expect(counter.t).toBeGreaterThan(smite.t);
  });
});

// ---------------------------------------------------------------- 970d633  Retribution is a smite
describe("970d633 — Retribution is a smite", () => {
  it("23. the striker loses 25/256 (about 10 HP), armour ignored, and lives", () => {
    const g = field();
    retribution(g);
    const gu = mk(g, "footmen", "blue", 7, 6),
      en = mk(g, "knights", "red", 8, 6); // heavy armour: the smite ignores it
    vi.spyOn(g, "_countersAfter").mockReturnValue(false);
    enemyHits(g, en, gu);
    expect(en.dead).toBe(false);
    expect(en.hp).toBeCloseTo(100 - SMITE, 9);
  });

  it("24. a shot never draws the smite — bow, musket, hammer — only a melee blow does", () => {
    for (const [type, x] of [
      ["archers", 10],
      ["musketeers", 10],
      ["craftsmen", 9], // the Hammer Throw
    ]) {
      const g = field();
      retribution(g);
      const gu = mk(g, "footmen", "blue", 7, 6),
        sh = mk(g, type, "red", x, 6);
      const r = enemyHits(g, sh, gu);
      expect(gu.hp).toBeLessThan(100); // the shot landed
      expect(r.fxNames).not.toContain("holysword");
      expect(sh.hp).toBe(100);
    }
  });

  it("25. a melee blow on a guarded Hero: the Hero lands first, then the blow, then the smite — and no counter", () => {
    const g = field();
    retribution(g);
    const hero = mk(g, "king", "blue", 7, 6),
      en = mk(g, "knights", "red", 8, 6); // a plain blow (no charge lane)
    const r = enemyHits(g, en, hero);
    const onEn = r.on(en);
    expect(en.dead).toBe(false);
    expect(onEn).toHaveLength(2);
    expect(onEn[0]).not.toBe("10"); // the Hero's first strike
    expect(onEn[1]).toBe("10"); // the smite after the rider's blow, and no counter after it
    expect(r.on(hero).some((t) => /^\d+$/.test(t))).toBe(true); // the rider's blow landed
  });

  it("25b. a guarded Horse Bowman struck in melee: the smite, then a bare counter for 0 (its bow can't reach)", () => {
    const g = field();
    retribution(g);
    const hb = mk(g, "horsebowmen", "blue", 7, 6),
      en = mk(g, "footmen", "red", 8, 6);
    const r = enemyHits(g, en, hb);
    expect(r.on(en)).toEqual(["10", "0"]);
    expect(en.hp).toBeCloseTo(100 - SMITE, 9);
    expect(g.projectiles).toHaveLength(0);
  });

  it("26. a charge stopped by a guarded unit: 20 on the rider, then that unit counters; if it fell: 10", () => {
    // a rider beside its foe on open ground, its lane pointing at it
    const charge = (guarded, targetHp = 100) => {
      const g = field();
      const a = openArea(g, 6, 3);
      if (guarded) retribution(g, a.x, a.y);
      const gu = mk(g, "swordsmen", "blue", a.x + 1, a.y + 1, { hp: targetHp }),
        kn = mk(g, "knights", "red", a.x + 2, a.y + 1, { chargeDir: { dx: -1, dy: 0 }, chargeSpent: 0 });
      expect(g._wouldCharge(kn, gu)).toBe(true);
      return { gu, kn, r: enemyHits(g, kn, gu) };
    };
    let { gu, kn, r } = charge(true);
    expect(gu.dead).toBe(false);
    expect(r.on(kn)[0]).toBe("20"); // 25 for the guarded unit it hit + 25 while it stands
    expect(r.on(kn)).toHaveLength(2); // the smite, then the counter
    ({ gu, kn, r } = charge(true, 5));
    expect(gu.dead).toBe(true);
    expect(r.on(kn)).toEqual(["10"]);
    expect(kn.hp).toBeCloseTo(100 - SMITE, 9);
    ({ gu, kn, r } = charge(false)); // and an unguarded charge meets no counter at all
    expect(gu.dead).toBe(false);
    expect(r.on(kn)).toEqual([]);
    expect(kn.hp).toBe(100);
  });

  it("27. a Catapult, a Fireball or a Lightning Storm on guarded units: no smite", () => {
    for (const [type, extra, x] of [
      ["catapult", {}, 12],
      ["wizards", { spell: "fireball" }, 11],
      ["wizards", { spell: "lightning" }, 11],
    ]) {
      const g = field();
      retribution(g);
      const gu = mk(g, "footmen", "blue", 7, 6),
        en = mk(g, type, "red", x, 6, extra);
      const r = enemyHits(g, en, gu);
      expect(r.fxNames).not.toContain("holysword");
      expect(en.hp).toBe(100);
    }
  });

  it("28. it works for whichever side cast it, and lapses when the caster's side starts its turn", () => {
    const g = field();
    g.phase = "enemy";
    const epr = mk(g, "priests", "red", 6, 6);
    g._prayerMark("retribution", epr);
    const gu = mk(g, "footmen", "red", 7, 6),
      sw = mk(g, "swordsmen", "blue", 8, 6);
    const r = playerHits(g, sw, gu);
    expect(r.on(sw)[0]).toBe("10");
    g.startEnemyPhase();
    expect(g.prayerMarks.filter((m) => m.team === "red")).toEqual([]);
  });

  it("29. a slain Priest takes its guard with it", () => {
    const g = field();
    const pr = retribution(g);
    const gu = mk(g, "footmen", "blue", 7, 6),
      en = mk(g, "footmen", "red", 8, 6);
    pr.hp = 0;
    pr.dead = true;
    const r = enemyHits(g, en, gu);
    expect(r.fxNames).not.toContain("holysword");
    expect(r.on(en)).not.toContain("10");
  });

  it("30. a Conjurer's Absorb soaks the smite: Absorbed, no damage", () => {
    const g = field();
    retribution(g);
    const gu = mk(g, "footmen", "blue", 7, 6),
      cj = mk(g, "conjurer", "red", 8, 6, { _absorb: true });
    vi.spyOn(g, "_countersAfter").mockReturnValue(false);
    const r = enemyHits(g, cj, gu);
    expect(r.on(cj)).toEqual(["Absorbed"]);
    expect(cj.hp).toBe(100);
    expect(cj._absorb).toBe(false);
  });

  it("31. the God army and the Battle Lab offer the Hero", () => {
    expect(ALL_TYPES).toContain("king");
    expect(SANDBOX_ARMY.king).toBe(30);
  });
});

// ---------------------------------------------------------------- 23ac16a  the deep audit
describe("23ac16a — the deep audit", () => {
  it("32. damage may be 0 (a Piercing Bolt on Feathered Hide); the quicksand read-out is the rounded-up 5", () => {
    const g = field();
    const b = mk(g, "ballistae", "red", 2, 4),
      gr = mk(g, "griffon", "blue", 6, 4);
    expect(g.computeDamage(b, gr, { weapon: 28 })).toBe(0);
  });

  it("33. the Lightning Storm's bolts walk the 3×3 in a fixed stride: five different cells", () => {
    for (let roll = 0; roll < 9; roll++) {
      const g = field();
      const w = mk(g, "wizards", "blue", 2, 6, { spell: "lightning" }),
        t = mk(g, "footmen", "red", 6, 6);
      vi.spyOn(g, "rng").mockReturnValue(roll / 9 + 0.01);
      const rolled = vi.spyOn(g, "_roll");
      g._resolveLightning(w, t, {});
      const cells = rolled.mock.calls.find((c) => c[1] && c[1].what === "lightning")[1].cells;
      expect(new Set(cells.map(String)).size).toBe(5);
      if (roll === 0)
        expect(cells.map(([x, y]) => [x - 6, y - 6])).toEqual([
          [0, 0],
          [0, -1],
          [-1, 0],
          [-1, 1],
          [1, 1],
        ]);
    }
  });

  it("34. fire ×2 follows the weapon: the Longbow doubles on a Catapult, the Short Sword does not", () => {
    const g = field();
    const far = mk(g, "archers", "blue", 2, 6),
      near = mk(g, "archers", "blue", 5, 7),
      cat = mk(g, "catapult", "red", 5, 6);
    const plain = { ...cat, T: { ...cat.T, flammable: false } };
    const bow = g.computeDamage(far, cat) / g.computeDamage(far, plain);
    expect(bow).toBeGreaterThan(1.9);
    expect(g.computeDamage(near, cat)).toBe(g.computeDamage(near, plain));
  });

  it("35. a unit ending its turn near two enemy Shamans wakes only one", () => {
    const g = field();
    const u = mk(g, "footmen", "blue", 5, 5);
    const s1 = mk(g, "shamans", "red", 7, 5),
      s2 = mk(g, "shamans", "red", 5, 7);
    g._shroudEndTurn(u);
    expect([!!s1._shroudOn, !!s2._shroudOn]).toEqual([true, false]);
  });

  it("36. a Shield halves a shot from range — and lapses when its Priest falls", () => {
    const g = field();
    const pr = mk(g, "priests", "blue", 5, 6),
      ally = mk(g, "footmen", "blue", 7, 6),
      ar = mk(g, "archers", "red", 11, 6);
    const full = g.computeDamage(ar, ally),
      full256 = g._damage256(ar, ally);
    g._prayerMark("shield", pr);
    expect(g.computeDamage(ar, ally)).toBe(wholeHp(Math.trunc(full256 / 2)));
    pr.hp = 0;
    pr.dead = true;
    expect(g.computeDamage(ar, ally)).toBe(full);
  });

  it("37. a Priest that walked keeps its prayers with nobody to heal", () => {
    const g = field();
    const p = mk(g, "priests", "blue", 5, 5, { moved: true });
    g.enterAct(p);
    expect(g.mode).toBe("act");
    expect(g.selected).toBe(p);
  });

  it("38. threat squares: Wizards 13, the Cannon 10, a bow from where it stands", () => {
    const g = field();
    const w = mk(g, "wizards", "red", 2, 6),
      c = mk(g, "cannon", "red", 2, 9),
      a = mk(g, "archers", "red", 20, 6);
    const has = (u, dx, dy) => g.threatOf(u).has(`${u.tx + dx},${u.ty + dy}`);
    expect([has(w, 13, 0), has(w, 14, 0)]).toEqual([true, false]);
    expect([has(c, 10, 0), has(c, 11, 0)]).toEqual([true, false]);
    expect([has(a, -6, 0), has(a, -7, 0)]).toEqual([true, false]);
  });

  it("39. a shot that drifts off the board hits nobody", () => {
    const g = field();
    g._deviationPct.mockReturnValue(100);
    const cat = mk(g, "catapult", "red", 6, 5),
      t = mk(g, "footmen", "blue", 0, 5);
    vi.spyOn(g, "rng").mockReturnValue(1 / 8 + 0.01);
    const landed = g._deviatedTarget({ u: cat, target: t });
    expect(landed._phantom).toBe(true);
    expect(g.inBounds(landed.tx, landed.ty)).toBe(false);
  });

  it("41. View Unit: a description under each weapon; the Sapper's Knives, the Bodyguard's Armblades", () => {
    expect(UNIT_TYPES.footmen.weaponDesc).toBeTruthy();
    expect(UNIT_TYPES.sapper.weaponName).toBe("Knives");
    expect(UNIT_TYPES.bodyguard.weaponName).toBe("Armblades");
  });

  it("42. a Hero near another Hero's Battle Standard: +15 courage", () => {
    const g = field();
    const h = mk(g, "king", "blue", 5, 5);
    const alone = g._courage(h);
    mk(g, "king", "blue", 7, 5);
    expect(g._courage(h)).toBe(alone + 15);
  });
});

// ---------------------------------------------------------------- 478ca3d  flyers, AI order, armour names
describe("478ca3d — flyers, the AI's order and the armour names", () => {
  it("43. a Piercing Bolt or Shock does nothing to Feathered Hide", () => {
    const g = field();
    const b = mk(g, "ballistae", "red", 2, 4);
    for (const t of ["griffon", "greateagle"]) {
      const f = mk(g, t, "blue", 3, 4);
      expect([g.computeDamage(b, f, { weapon: 28 }), g.computeDamage(b, f, { weapon: 34 })]).toEqual([0, 0]);
      f.dead = true;
    }
  });

  it("44. Trebuchets and Cannons can't aim at Griffons or Great Eagles; the Grapeshot still hits them", () => {
    const g = field();
    const treb = mk(g, "trebuchet", "blue", 2, 6),
      can = mk(g, "cannon", "blue", 2, 10),
      gr = mk(g, "griffon", "red", 8, 6),
      ea = mk(g, "greateagle", "red", 6, 10);
    expect(g.targetsFrom(treb, treb.tx, treb.ty)).not.toContain(gr);
    expect(g.targetsFrom(can, can.tx, can.ty)).not.toContain(ea);
    const near = mk(g, "griffon", "red", 3, 10);
    play(g, () => g.resolveDamage(can, near, {}));
    expect(near.hp).toBeLessThan(100);
  });

  it("45. Griffons, Great Eagles and Dune Sirens fly over an enemy line but never stop on it", () => {
    const g = field();
    const gr = mk(g, "griffon", "blue", 4, 5),
      sw = mk(g, "swordsmen", "blue", 4, 8);
    for (let y = 0; y < g.rows; y++) if (!g.unitAt(6, y)) mk(g, "footmen", "red", 6, y);
    const reach = g.computeReach(gr);
    expect(reach.stops.has("8,5")).toBe(true);
    expect(reach.stops.has("6,5")).toBe(false);
    expect([...g.computeReach(sw).stops].some((k) => Number(k.split(",")[0]) > 6)).toBe(false);
    expect(g._passesOverFoes(mk(g, "greateagle", "blue", 3, 3))).toBe(true);
    expect(g._passesOverFoes(mk(g, "dunesirens", "blue", 3, 2))).toBe(true);
  });

  it("46. the AI moves war engines, then shooters, then the rest — Griffons last", () => {
    const g = field();
    mk(g, "footmen", "blue", 8, 5);
    const gr = mk(g, "griffon", "red", 9, 4),
      sw = mk(g, "swordsmen", "red", 9, 5),
      ar = mk(g, "archers", "red", 11, 5),
      cat = mk(g, "catapult", "red", 13, 5);
    const pick = (pool) => g.ai._aiRemainingAttacker(pool);
    expect([pick([gr, sw, ar, cat]), pick([gr, sw, ar]), pick([gr, sw]), pick([gr])]).toEqual([cat, ar, sw, gr]);
  });

  it("47. the original armour names; the Fear text: +15 for the objective holder, no '+15 while acting'", () => {
    expect(ARMOUR_NAME).toEqual(expect.arrayContaining(["Shield", "Minor Ward", "Feathered Hide", "Wood", "Stone"]));
    const fear = ABILITY_INFO[14].d;
    expect(fear).toMatch(/\+15 while its side holds the objective/);
    expect(fear).not.toMatch(/while acting/);
  });
});

// ---------------------------------------------------------------- the healer's skip prompt
describe("the healer's skip prompt", () => {
  it("48. a Priest that could heal asks before ending its turn; with nobody to heal it just ends", () => {
    const g = field();
    const p = mk(g, "priests", "blue", 9, 9),
      hurt = mk(g, "footmen", "blue", 10, 9, { hp: 40 });
    g.phase = "player";
    g.selected = p;
    g.mode = "act";
    g.click({ tx: 0, ty: 2 });
    expect(g.pendingSkip).toBe(p);
    expect(g.pendingSkipKind).toBe("heal");
    g.cancelSkip();
    expect(g.mode).toBe("act");
    hurt.hp = 100;
    g.click({ tx: 0, ty: 2 });
    expect(g.pendingSkip).toBeNull();
    expect(p.acted).toBe(true);
  });
});
