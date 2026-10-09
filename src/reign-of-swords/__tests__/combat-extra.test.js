// Combat rules not reached by the battle tests (rules/combat.js): Ep2 Quicksand / Build tile picks / Detonate / Shock /
// the Piercing Bolt / Leashing, a charge that rides on into a pikeman's first strike, the wizard's spells in the
// forecast and the spell toggle, the Druid's shapeshift, the Priest's Shield and Retribution, the heal's end of turn,
// the casualty report, a damaged structure's read-out and the Lightning bolt streak.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put, settle, openLane, nextRound } from "./battle.js";
import { recCtx, ops } from "./render-helpers.js";
import { moveType } from "../rules/terrain.js";

beforeAll(() => loadEpisode(2));

const battle = (id = 5428) => {
  const g = makeGame(id);
  startBattle(g);
  return g;
};

describe("Episode II ground", () => {
  it("quicksand can't be laid where the ground won't take it", () => {
    const g = battle();
    vi.spyOn(g, "_canLayQuicksand").mockReturnValue(false);
    expect(g._layQuicksand(3, 3)).toBe(false);
    g.quicksand = null;
    expect(g._layQuicksand(3, 3)).toBe(false);
    expect(g.quicksand instanceof Map).toBe(true);
  });

  it("a unit caught in quicksand with 5 HP or less goes under", () => {
    const g = battle();
    const u = spawn(g, "footmen", "blue", 4, 4, { hp: 4 });
    g.quicksand = new Map([["4,4", 3]]);
    vi.spyOn(g, "_quicksandImmune").mockReturnValue(false);
    g._quicksandEnter(u);
    expect(u.dead).toBe(true);
    expect(u.hp).toBe(0);
  });

  it("the village tile a Craftsman builds depends on the tileset range of the ground", () => {
    const g = battle();
    expect(g._villageTileFor(179 + 10)).toBe(249); // desert range, within the buildable band
    expect(g._villageTileFor(179 + 2)).toBe(185);
    expect(g._villageTileFor(247 + 2)).toBe(249);
    expect(g._villageTileFor(247 + 9)).toBe(3);
    expect(g._villageTileFor(5)).toBe(3);
  });
});

describe("the Sapper, the Ballistae and the Conjurer", () => {
  it("Detonate plays as a cast and blows the sapper up when it ends", () => {
    const g = battle();
    const s = spawn(g, "sapper", "red", 6, 6);
    const det = vi.spyOn(g, "_detonate").mockImplementation(() => {});
    const done = vi.fn();
    g._sapperStrike(s, done);
    expect(s.attackedTurn).toBe(true);
    expect(g.anim).toMatchObject({ u: s, cast: true });
    g.anim.done();
    expect(det).toHaveBeenCalledWith(s);
    expect(done).toHaveBeenCalled();
  });

  it("Shock: the Ballistae's point-blank shot hits all four tiles around it, friend or foe", () => {
    const g = battle();
    const b = spawn(g, "ballistae", "blue", 6, 6);
    const n = spawn(g, "militiamen", "red", 6, 5),
      e = spawn(g, "militiamen", "red", 7, 6),
      own = spawn(g, "militiamen", "blue", 5, 6),
      diag = spawn(g, "militiamen", "red", 7, 7);
    only(g, b, n, e, own, diag, ...g.units.filter((u) => u.hero));
    g.resolveDamage(b, n, {});
    expect(n.hp).toBeLessThan(100);
    expect(e.hp).toBeLessThan(100);
    expect(own.hp).toBeLessThan(100);
    expect(diag.hp).toBe(100);
    // at the map's edge the off-map side is skipped
    const c = spawn(g, "ballistae", "blue", 0, 0);
    const f = spawn(g, "militiamen", "red", 1, 0);
    expect(() => g._resolveShock(c, {})).not.toThrow();
    expect(f.hp).toBeLessThan(100);
  });

  it("the Piercing Bolt flies on through the two tiles behind its target", () => {
    const g = battle();
    const b = spawn(g, "ballistae", "blue", 2, 8);
    const t = spawn(g, "militiamen", "red", 6, 8),
      b1 = spawn(g, "militiamen", "red", 7, 8),
      b2 = spawn(g, "militiamen", "red", 8, 8);
    g._resolvePierce(b, t, {}, 28);
    expect(b1.hp).toBeLessThan(100);
    expect(b2.hp).toBeLessThan(100);
    expect(b1.hp).toBeLessThan(b2.hp); // 65% then 40%
  });

  it("a fallen Conjurer's minions wink out at once (one sound for all)", () => {
    const g = battle();
    const c = spawn(g, "conjurer", "red", 5, 5);
    const m1 = spawn(g, "sapper", "red", 5, 6, { _conjuredBy: c.id }),
      m2 = spawn(g, "bodyguard", "red", 6, 5, { _conjuredBy: c.id }),
      other = spawn(g, "sapper", "red", 9, 9);
    const play = vi.spyOn(g.audio, "play");
    g._killConjuredChildren(c);
    expect([m1.dead, m2.dead, !!other.dead]).toEqual([true, true, false]);
    expect(play.mock.calls.filter(([s]) => s === "unsummon").length).toBe(1);
    play.mockClear();
    g._killConjuredChildren(spawn(g, "conjurer", "red", 1, 1)); // none of its own
    expect(play).not.toHaveBeenCalled();
  });
});

describe("a charge riding on", () => {
  it("meets a pikeman behind the fallen first foe: his first strike lands on the rider", () => {
    const g = battle(5410);
    const k = spawn(g, "knights", "blue", 0, 0);
    const lane = openLane(g, k, 4);
    put(g, k, lane.x, lane.y);
    const first = spawn(g, "militiamen", "red", lane.x + 1, lane.y, { dead: true });
    const pike = spawn(g, "pikemen", "red", lane.x + 2, lane.y);
    const hit = vi.spyOn(g, "resolveDamage");
    g._chargeRun(k, first, { dx: 1, dy: 0 });
    expect(hit.mock.calls.some(([a, d]) => a === pike && d === k)).toBe(true);
    expect(g.floaters.some((f) => f.text === "First Strike!")).toBe(true);
  });
});

describe("the wizard", () => {
  it("the forecast of a Lightning bolt and an Ice Field is their share of the blow", () => {
    const g = battle();
    const w = spawn(g, "wizards", "blue", 4, 4);
    const e = spawn(g, "footmen", "red", 4, 7);
    w.spell = "lightning";
    const full = g.computeDamage(w, e, {});
    expect(g.hitForecast(w, e, e.tx, e.ty, {})).toBeLessThan(full + 1);
    w.spell = "ice";
    expect(g.hitForecast(w, e, e.tx, e.ty, {})).toBeGreaterThanOrEqual(0);
    expect(g._spellDisplay(w).name).toBe("Ice Field");
  });

  it("the spell toggle cycles Fireball → Lightning → Ice → Fireball; with nobody selected it does nothing", () => {
    const g = battle();
    const w = spawn(g, "wizards", "blue", 4, 4);
    g.select(w);
    w.spell = undefined;
    g.toggleSpell();
    expect(w.spell).toBe("lightning");
    g.toggleSpell();
    expect(w.spell).toBe("ice");
    g.toggleSpell();
    expect(w.spell).toBe("fireball");
    g.deselect();
    expect(() => g.toggleSpell()).not.toThrow();
  });

  it("a non-wizard area weapon's band is its own min / max range", () => {
    const g = battle();
    const u = spawn(g, "archers", "blue", 4, 4);
    vi.spyOn(g, "_freeAim").mockReturnValue(false);
    expect(g._castRange(u)).toEqual([u.T.minRange || 1, u.T.range]);
  });
});

describe("the Druid's shapeshift", () => {
  it("becomes the chosen beast (remembering its own form) and is re-selected as it; no change mid-action or for a wrong form", () => {
    const g = battle(5410);
    const d = spawn(g, "druids", "blue", 5, 5);
    const form = d.T.shapeshiftForms[0];
    g.select(d);
    g.anim = { type: "x" };
    g.shapeshiftSelected(form);
    expect(d.type).toBe("druids");
    g.anim = null;
    g.shapeshiftSelected("dragon");
    expect(d.type).toBe("druids");
    g.shapeshiftSelected(form);
    expect(d.type).toBe(form);
    expect(d._druidType).toBe("druids");
    expect(d.shifted).toBe(true);
    expect(g.selected).toBe(d);
  });
});

describe("a shifted druid keeps its form (Unit::onTick's shift; only Undo reads the form it left)", () => {
  const shifted = (form = "greateagle") => {
    const g = battle(5410);
    const d = spawn(g, "druids", "blue", 5, 5);
    g.select(d);
    g.shapeshiftSelected(form);
    return { g, d };
  };

  it("stays the beast after it acts and through the next turn", () => {
    const { g, d } = shifted();
    g.finishUnit(d);
    expect(d.type).toBe("greateagle");
    nextRound(g);
    expect(d.type).toBe("greateagle");
    expect(d.shifted).toBe(true);
  });

  it("a beast may shapeshift again on a later turn — back to the Druid or into one of the other two", () => {
    const { g, d } = shifted("bear");
    expect(d.T.shapeshiftForms).toEqual(["druids", "stag", "greateagle"]);
    g.turn += 1; // a later turn
    g.shapeshiftSelected("stag");
    expect(d.type).toBe("stag");
    g.turn += 1;
    g.shapeshiftSelected("druids");
    expect(d.type).toBe("druids");
    expect(d.shifted).toBe(false);
    expect(d.T.shapeshiftForms).toEqual(["stag", "greateagle", "bear"]);
  });

  it("one shift a turn (Unit+0x27c): no second shift — Undo clears it, so forms can be tried in turn", () => {
    const { g, d } = shifted("greateagle");
    g.shapeshiftSelected("bear");
    expect(d.type).toBe("greateagle"); // an Eagle that flew can't strike as a Bear
    expect(g._selectedView(d).shapeshift).toBeNull(); // the card offers no Shapeshift until Undo or the next turn
    g.undoMove();
    expect(d.type).toBe("druids");
    g.select(d);
    g.shapeshiftSelected("bear");
    expect(d.type).toBe("bear");
  });

  it("not over water or cliffs: the forms are greyed out and nothing shifts, player or AI (getMoveCost(2) > 4)", () => {
    const { g, d } = shifted("greateagle");
    g.turn += 1; // a later turn: the Eagle could shift again — but it hovers over water
    let water = 0;
    while (moveType(water) !== 19) water++; // a tile of terrain type 19 (water)
    g.tiles[d.ty * g.cols + d.tx] = water;
    expect(g._selectedView(d).shapeshiftBlocked).toBe(true);
    g.select(d);
    g.shapeshiftSelected("druids");
    expect(d.type).toBe("greateagle");
    expect(g._shapeshift(d, "bear")).toBe(false); // the AI shifts through the same call
    g.tiles[d.ty * g.cols + d.tx] = 0; // back over land
    expect(g._selectedView(d).shapeshiftBlocked).toBe(false);
    g.shapeshiftSelected("druids");
    expect(d.type).toBe("druids");
  });

  it("Undo right after takes the shift back, also after a move (undoPreviousAction)", () => {
    const { g, d } = shifted("stag");
    expect(g.canUndo()).toBe(true); // a shift alone can be undone
    g.undoMove();
    expect(d.type).toBe("druids");
    g.select(d);
    g.shapeshiftSelected("stag");
    g.moveUnit(
      d,
      [
        { tx: 5, ty: 5 },
        { tx: 6, ty: 5 },
      ],
      () => {},
      false,
    );
    settle(g);
    g.undoMove();
    expect([d.tx, d.ty, d.type]).toEqual([5, 5, "druids"]);
  });

  it("the AI druid re-picks once a turn: back to the Druid at a foot group's pace, Stag / Eagle to keep up", () => {
    const g = battle(5410);
    const d = spawn(g, "druids", "red", 2, 2);
    const foe = spawn(g, "footmen", "blue", 15, 15);
    only(g, d, foe);
    const at = (group) => vi.spyOn(g.ai, "_glPoint").mockReturnValue({ tx: 3, ty: 3, group });
    at(null).mockReturnValue(null);
    g.ai._aiPickDruidForm(d, [foe]); // no group, nothing near → the Great Eagle
    expect(d.type).toBe("greateagle");
    expect(d._shiftTurn).toBe(g.turn);
    g.turn += 1;
    at({ minMove: 4, allFree: false });
    g.ai._aiPickDruidForm(d, [foe]); // as fast as a foot group's pace (4) → back to the Druid
    expect(d.type).toBe("druids");
    g.turn += 1;
    at({ minMove: 6, allFree: false });
    g.ai._aiPickDruidForm(d, [foe]); // slower than the pace (≤ 8) → the Stag
    expect(d.type).toBe("stag");
    g.turn += 1;
    put(g, foe, 4, 4); // a foe within 5: no change before the move — the Bear waits for the moved flag
    expect(g.ai._aiPickDruidForm(d, [foe])).toBe(false);
    expect(d.type).toBe("stag");
    expect(g.ai._aiPickDruidForm(d, [foe], true)).toBe(true); // the driver's second offer, after the move
    expect(d.type).toBe("bear");
  });

  // GameScreen::aiUpdate takes state 2 back off the tried list when the unit moves (mlib_Vector::removeElement), so a
  // druid that hasn't shifted is offered it again once it stands at the end of its move.
  const carryOut = (g, d, spot, foes, target = null) => {
    const reach = g.computeReach(d);
    const turn = {
      reach,
      stops: [],
      enemies: foes,
      order: null,
      ranged: false,
      splash: false,
      wizMove: false,
      foeTeam: "blue",
    };
    g.ai._aiCarryOut(d, { bestSpot: spot, bestTgt: target, bestScore: -Infinity, bestRanged: false }, turn);
    settle(g);
  };
  const druidBoard = (foeAt) => {
    const g = battle(5410);
    const d = spawn(g, "druids", "red", 2, 2);
    const foe = spawn(g, "footmen", "blue", ...foeAt);
    only(g, d, foe);
    for (const [x, y] of [[2, 2], [2, 3], [2, 4], foeAt]) g.tiles[y * g.cols + x] = 0; // open grass
    return { g, d, foe };
  };

  it("an AI druid that moved with a foe within 5 turns Guardian Bear where it stops", () => {
    const { g, d, foe } = druidBoard([2, 8]);
    carryOut(g, d, { tx: 2, ty: 4 }, [foe]);
    expect([d.tx, d.ty, d.type]).toEqual([2, 4, "bear"]);
    expect(d.acted).toBe(true);
    expect(foe.hp).toBe(100); // nothing in reach from there: the Bear only takes its form
  });

  it("…and the new Bear strikes a foe next to it, from where it stands", () => {
    const { g, d, foe } = druidBoard([2, 5]);
    carryOut(g, d, { tx: 2, ty: 4 }, [foe]);
    expect(d.type).toBe("bear");
    expect(foe.hp).toBeLessThan(100);
  });

  it("a druid moving in to strike shifts on arrival and strikes as the Bear (the attack path re-offers state 2)", () => {
    const { g, d, foe } = druidBoard([2, 5]);
    const struckAs = [];
    const strike = g.ai.doAttackAI.bind(g.ai);
    g.ai.doAttackAI = (a, b, ...rest) => (struckAs.push(a.type), strike(a, b, ...rest));
    carryOut(g, d, { tx: 2, ty: 4 }, [foe], foe);
    expect(struckAs).toEqual(["bear"]);
    expect(foe.hp).toBeLessThan(100);
  });

  it("a Priest that followed its group heals an adjacent wounded ally after the move (state 3, moved)", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "red", 2, 2);
    const hurt = spawn(g, "footmen", "red", 3, 4, { hp: 40 });
    const foe = spawn(g, "footmen", "blue", 2, 14);
    only(g, p, hurt, foe);
    for (const [x, y] of [
      [2, 2],
      [2, 3],
      [2, 4],
      [3, 4],
    ])
      g.tiles[y * g.cols + x] = 0;
    carryOut(g, p, { tx: 2, ty: 4 }, [foe]);
    expect([p.tx, p.ty]).toEqual([2, 4]);
    expect(hurt.hp).toBeGreaterThan(40);
    expect(p.acted).toBe(true);
  });

  it("Craftsmen that moved in to strike mend an adjacent damaged war engine instead (Ep2 state 27 re-offered)", () => {
    const g = battle(5410);
    const c = spawn(g, "craftsmen", "red", 2, 2);
    const engine = spawn(g, "ballistae", "red", 3, 4, { hp: 50 });
    const foe = spawn(g, "footmen", "blue", 2, 5);
    only(g, c, engine, foe);
    for (const [x, y] of [
      [2, 2],
      [2, 3],
      [2, 4],
      [3, 4],
      [2, 5],
    ])
      g.tiles[y * g.cols + x] = 0;
    carryOut(g, c, { tx: 2, ty: 4 }, [foe], foe);
    expect(engine.hp).toBeGreaterThan(50);
    expect(foe.hp).toBe(100);
  });

  it("one shift a turn: a druid that already shifted keeps its form after the move", () => {
    const { g, d, foe } = druidBoard([2, 8]);
    d._shiftTurn = g.turn;
    carryOut(g, d, { tx: 2, ty: 4 }, [foe]);
    expect(d.type).toBe("druids");
  });
});

describe("the Priest's prayers", () => {
  it("Shield: a cast that marks the priest shielding and ends its turn", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "blue", 5, 5);
    g.select(p);
    g.invokeShield();
    expect(g._prayed(p, "shield")).toBe(true);
    expect(g._shielded(p)).toBe(true);
    expect(g.anim.cast).toBe(true);
    settle(g);
    expect(p.acted).toBe(true);
    g.invokeShield(); // spent: nothing
  });

  it("Retribution marks the priest's TILE: its side within 2 of it is guarded — until the priest falls", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "blue", 5, 5);
    const near = spawn(g, "footmen", "blue", 6, 6),
      far = spawn(g, "footmen", "blue", 9, 9);
    g.select(p);
    g.invokeRetribution();
    expect([p, near, far].map((u) => g._retributioned(u))).toEqual([true, true, false]);
    settle(g);
    expect(p.acted).toBe(true);
    g.invokeRetribution(); // spent: nothing
    expect(g.prayerMarks.length).toBe(1);
    put(g, far, 5, 7); // whoever stands within 2 of the mark now
    expect(g._retributioned(far)).toBe(true);
    p.dead = true; // the unit-died event deletes a slain priest's marks
    expect([g._retributioned(near), g._retributioned(far)]).toEqual([false, false]);
  });

  it("Retribution smites a striker on its own turn (~10 HP, armour ignored) before the counter; a Fireball doesn't", () => {
    const g = makeGame(5410, { god: false });
    startBattle(g);
    const p = spawn(g, "priests", "red", 5, 5);
    const guard = spawn(g, "footmen", "red", 6, 5);
    const sw = spawn(g, "swordsmen", "blue", 7, 5);
    const wiz = spawn(g, "wizards", "blue", 6, 9);
    only(g, p, guard, sw, wiz);
    g._prayerMark("retribution", p);
    g.phase = "player";
    expect(g._retributionStrikes(wiz, guard)).toBe(false); // a Fireball is an area attack
    const smite = vi.spyOn(g, "_retributionSmite");
    const counter = vi.spyOn(g, "_countersAfter");
    g.doAttack(sw, guard);
    settle(g);
    expect(smite).toHaveBeenCalledTimes(1);
    expect(smite.mock.calls[0][0]).toBe(sw);
    expect(counter.mock.results[0].value).toBe(true); // the guarded unit still counters after the smite
    expect(sw.dead).toBe(false);
    // the smite: 25 of 256, or 25 per guarded unit a charge cut through (+25 while the smiter stands)
    const g2 = makeGame(5410, { god: false });
    startBattle(g2);
    const v = spawn(g2, "knights", "blue", 3, 3),
      a = spawn(g2, "footmen", "red", 4, 3);
    g2._retributionSmite(v, a);
    expect(v.hp).toBe(90); // 25 of 256 = 10 whole HP
    expect(g2.floaters.some((f) => f.text === 10)).toBe(true);
    v.hp = 100;
    v._retribCount = 2;
    g2._retributionSmite(v, a);
    expect(v.hp).toBe(71); // 75 of 256 = 29 whole HP
    v.hp = 100;
    v._retribCount = 2;
    a.dead = true;
    g2._retributionSmite(v, a);
    expect(v.hp).toBe(80); // 50 of 256 = 20 whole HP
    // whose turn: the guarded side's own counter is not a strike of its turn; the marks lapse at its next turn
    const g3 = makeGame(5410, { god: false });
    startBattle(g3);
    const p3 = spawn(g3, "priests", "blue", 5, 5);
    const guard3 = spawn(g3, "swordsmen", "blue", 6, 5);
    const foe = spawn(g3, "footmen", "red", 7, 5);
    only(g3, p3, guard3, foe);
    g3._prayerMark("retribution", p3);
    g3.phase = "enemy";
    expect(g3._retributionStrikes(foe, guard3)).toBe(true);
    g3.phase = "player";
    expect(g3._retributionStrikes(guard3, foe)).toBe(false); // the foe is not guarded
    g3._clearPrayerMarks((m) => m.team === "blue");
    expect(g3._retributioned(guard3)).toBe(false);
  });

  it("after a smite the target counters by state 14's end: from next to it, and only if the striker had the initiative", () => {
    const g = makeGame(5410, { god: false });
    startBattle(g);
    const hero = spawn(g, "king", "red", 5, 5),
      foot = spawn(g, "footmen", "red", 5, 7),
      wall = spawn(g, "pikemen", "red", 12, 5, { walled: true });
    const ar = spawn(g, "archers", "blue", 9, 5),
      ar2 = spawn(g, "archers", "blue", 5, 10),
      sw = spawn(g, "swordsmen", "blue", 5, 8);
    only(g, hero, foot, wall, ar, ar2, sw);
    expect(g._countersAfter(ar, hero, false)).toBe(false); // an ordinary shot from range: no counter
    ar._smittenBy = hero;
    expect(g._countersAfter(ar, hero, false)).toBe(false); // smitten: the Hero lands first on an archer — no answer at range
    ar._smittenBy = wall;
    expect(g._countersAfter(ar, wall, false)).toBe(false); // nor does a braced Pike Wall
    ar2._smittenBy = foot;
    expect(g._countersAfter(ar2, foot, false)).toBe(false); // a footman out of reach does not
    sw._smittenBy = foot;
    expect(g._countersAfter(sw, foot, false)).toBe(true); // next to it, the striker first: the counter
    sw._smittenBy = foot;
    expect(g._countersAfter(sw, foot, true)).toBe(false); // after a first strike in defence: no counter
    sw._smittenBy = foot;
    sw._smiteAfterCharge = true;
    expect(g._countersAfter(sw, foot, true)).toBe(true); // the smite at a charge's end runs state 14's end
  });

  it("isFirstStrike as a plain order", () => {
    const g = makeGame(5410, { god: false });
    startBattle(g);
    const [pk, cav, hero, foot, gs, can, gr] = [
      "pikemen",
      "cavalry",
      "king",
      "footmen",
      "greatswordsmen",
      "cannon",
      "griffon",
    ].map((t, i) => spawn(g, t, "red", 2 + i, 2));
    expect(g._landsFirst(pk, cav)).toBe(true);
    expect(g._landsFirst(cav, pk)).toBe(false);
    expect(g._landsFirst(hero, pk)).toBe(true); // the Hero is never pre-empted by pikes
    expect(g._landsFirst(pk, gr)).toBe(true);
    expect(g._landsFirst(foot, hero)).toBe(false); // First Strike
    expect(g._landsFirst(hero, foot)).toBe(true);
    expect(g._landsFirst(gs, foot)).toBe(false); // Last Strike
    expect(g._landsFirst(gs, can)).toBe(true); // … but first on a Cannon
    expect(g._landsFirst(foot, gs)).toBe(true);
  });

  it("a heal ends the priest's turn once it lands", () => {
    const g = battle(5410);
    const p = spawn(g, "priests", "blue", 5, 5);
    const hurt = spawn(g, "footmen", "blue", 5, 6, { hp: 50 });
    g.healUnit(p, hurt);
    settle(g);
    expect(hurt.hp).toBe(70); // the heal state: +20 …
    expect(g.floaters.some((f) => f.text === "+20")).toBe(true); // … which reads +20
  });
});

describe("read-outs", () => {
  it("the casualty report counts your fallen units by type — not the Hero, not reinforcements", () => {
    const g = battle(5410);
    for (const u of g.units) u.dead = false;
    spawn(g, "footmen", "blue", 1, 1, { dead: true });
    spawn(g, "footmen", "blue", 2, 1, { dead: true });
    spawn(g, "archers", "blue", 3, 1, { dead: true, wave: true });
    spawn(g, "king", "blue", 4, 1, { dead: true, hero: true });
    spawn(g, "footmen", "red", 5, 1, { dead: true });
    expect(g.casualtyReport()).toEqual({ footmen: 2 });
  });

  it("a structure's card: material, stage and health; plain ground has none", () => {
    const g = battle(5410);
    let s = null;
    for (let y = 0; y < g.rows && !s; y++) for (let x = 0; x < g.cols && !s; x++) if (g.isStructure(x, y)) s = [x, y];
    if (!s) return;
    const info = g._structureInfo(...s);
    expect(["Stone", "Wood"]).toContain(info.material);
    expect(info.stage).toBe("Intact");
    expect(info.hp).toBe(100);
    expect(info.stagesLeft).toBeGreaterThan(0);
    g.structHp.set(s[0] + "," + s[1], 100);
    expect(g._structureInfo(...s).hp).toBeLessThan(100);
  });

  it("a Lightning bolt is a jagged streak from high above down onto the tile, fading out", () => {
    const g = battle();
    g.bolts = null;
    g._spawnBolt(100, 200);
    const b = g.bolts[0];
    expect(b.segs[0][1]).toBeLessThan(200);
    expect(b.segs[b.segs.length - 1]).toEqual([100, 200]);
    const ctx = recCtx();
    g._drawBolt(ctx, b);
    expect(ops(ctx, "stroke").length).toBe(2);
    b.t = b.life * 0.9;
    g._drawBolt(ctx, b);
    expect(ctx.log.some((e) => e.op === "stroke" && e.alpha < 0.5)).toBe(true);
  });
});
