// Episode II player skills (rules/abilities.js): the shared skill-row model, arming / disarming an aim, the aimed tap, and
// each cast — Build (once per battle), Repair (war engines +20 HP, structures one stage back), Quicksand (the 3-tile
// line on the tapped side), Conjure Sapper / Bodyguard (max 2 living minions), Detonate (x1.25 weapon damage to every
// adjacent unit), Absorb (the Bodyguard is sacrificed for a one-hit shield), Leashing (> 8 from the Conjurer dies as
// the side's turn ends), the Spirit Shroud rise and the Siren's sand-skull overlay.
import { describe, it, expect, beforeAll, vi } from "vitest";

import { loadEpisode, spawn, put, settle, moveTo, nextRound } from "./battle.js";

import { cleanBattle, findSpot, keepers, standable, N4, N8 } from "./abil-helpers.js";
import { structPre } from "../rules/terrain.js";

beforeAll(() => loadEpisode(2));

const fxNames = (g) => (g.fx || []).map((f) => f.name);
const floaterTexts = (g) => g.floaters.map((f) => f.text);

// A board with a caster of `type` on free ground satisfying `pred`, plus the keepers far away.
function withCaster(type, pred = () => true, mapId = 5428) {
  const g = cleanBattle(mapId);
  const at = findSpot(g, (x, y) => standable(g, x, y) && pred(g, x, y));
  if (!at) throw new Error("no spot for " + type);
  const u = spawn(g, type, "blue", ...at);
  const k = keepers(g, ...at);
  return { g, u, at, ...k };
}
// A tile next to `u` (4-neighbour) that is free, passable ground.
const freeN4 = (g, u) => N4.map(([dx, dy]) => [u.tx + dx, u.ty + dy]).find(([x, y]) => standable(g, x, y));
const freeN8 = (g, u) => N8.map(([dx, dy]) => [u.tx + dx, u.ty + dy]).filter(([x, y]) => standable(g, x, y));
const hasBuildableN4 = (g, x, y) => N4.some(([dx, dy]) => g._buildableTile(x + dx, y + dy));
// A sand line of 3 on the east side of (x, y), all layable.
const sandEast = (g, x, y) => [-1, 0, 1].every((d) => g._canLayQuicksand(x + 1, y + d) && !g.unitAt(x + 1, y + d));
const sandSouth = (g, x, y) => [-1, 0, 1].every((d) => g._canLayQuicksand(x + d, y + 1) && !g.unitAt(x + d, y + 1));
// A tile value that is a damaged stage of some structure (Repair can step it back).
function damagedStage() {
  for (let v = 0; v < 2000; v++) if (structPre(v) != null) return v;
  return null;
}

describe("the skill row (_abilitySkills)", () => {
  it("offers nothing to no unit, an enemy, an allied-army unit, a spent unit, or a unit without Ep2 skills", () => {
    const { g, u, red, blue } = withCaster("craftsmen");
    expect(g._abilitySkills(null)).toBeNull();
    expect(g._abilitySkills(red)).toBeNull();
    expect(g._abilitySkills(blue)).toBeNull(); // a plain Swordsman
    u.ally = true;
    expect(g._abilitySkills(u)).toBeNull();
    u.ally = false;
    u.acted = true;
    expect(g._abilitySkills(u)).toBeNull();
  });

  it("a Craftsman shows Build (1/1) and offers Repair only when a damaged war engine is beside it", () => {
    const { g, u } = withCaster(
      "craftsmen",
      (g, x, y) => !!freeN4(g, { tx: x, ty: y }) && !g._repairStructureFor({ tx: x, ty: y }),
    );
    let ids = g._abilitySkills(u).map((s) => s.id);
    expect(ids).toEqual(["build"]);
    const build = g._abilitySkills(u)[0];
    expect(build).toMatchObject({ count: "1/1", disabled: false, min: 1, max: 1 });
    const [ex, ey] = freeN4(g, u);
    const cat = spawn(g, "catapult", "blue", ex, ey, { hp: 100 });
    expect(g._abilitySkills(u).map((s) => s.id)).toEqual(["build"]); // whole engine: nothing to mend
    cat.hp = 60;
    ids = g._abilitySkills(u).map((s) => s.id);
    expect(ids).toEqual(["build", "repair"]);
    cat.team = "red"; // an enemy engine is not ours to repair
    expect(g._abilitySkills(u).map((s) => s.id)).toEqual(["build"]);
  });

  it("a Craftsman beside a damaged structure is offered Repair", () => {
    const v = damagedStage();
    expect(v).not.toBeNull();
    const { g, u } = withCaster("craftsmen", (g, x, y) => !!freeN4(g, { tx: x, ty: y }));
    const [sx, sy] = freeN4(g, u);
    g.tiles[sy * g.cols + sx] = v;
    expect(g._abilitySkills(u).map((s) => s.id)).toContain("repair");
  });

  it("Dune Sirens get Quicksand; a Sapper gets the untargeted Detonate", () => {
    const { g, u } = withCaster("dunesirens");
    expect(g._abilitySkills(u).map((s) => s.id)).toEqual(["quicksand"]);
    const sap = spawn(g, "sapper", "blue", ...freeN8(g, u)[0]);
    expect(g._abilitySkills(sap)).toEqual([expect.objectContaining({ id: "detonate", min: 0, max: 0 })]);
  });

  it("a Conjurer's two Conjure buttons count living minions and stay in the row, disabled, at the cap of 2", () => {
    const { g, u } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 3);
    let sk = g._abilitySkills(u);
    expect(sk.map((s) => s.id)).toEqual(["conjure_sapper", "conjure_bodyguard"]);
    expect(sk.every((s) => s.count === "0/2" && !s.disabled)).toBe(true);
    const [a, b] = freeN8(g, u);
    const k1 = spawn(g, "sapper", "blue", ...a, { _conjuredBy: u.id });
    spawn(g, "bodyguard", "blue", ...b, { _conjuredBy: u.id });
    sk = g._abilitySkills(u);
    expect(sk.every((s) => s.count === "2/2" && s.disabled)).toBe(true);
    expect(sk[0].desc).toMatch(/Limit reached/);
    g.select(u);
    expect(g._abilityArm("conjure_sapper")).toBe(false); // a maxed-out Conjure can't be armed
    k1.dead = true; // a fallen minion frees a slot
    sk = g._abilitySkills(u);
    expect(sk.every((s) => s.count === "1/2" && !s.disabled)).toBe(true);
  });

  it("a conjured Bodyguard offers Absorb only while its Conjurer lives and is not already shielded", () => {
    const { g, u } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 2);
    const [a] = freeN8(g, u);
    const bg = spawn(g, "bodyguard", "blue", ...a, { _conjuredBy: u.id });
    expect(g._abilitySkills(bg)).toEqual([expect.objectContaining({ id: "absorb", min: 0, max: 0 })]);
    u._absorb = true;
    expect(g._abilitySkills(bg)).toBeNull();
    u._absorb = false;
    u.dead = true;
    expect(g._abilitySkills(bg)).toBeNull();
    const plain = spawn(g, "bodyguard", "blue", ...freeN8(g, bg)[0]); // never conjured
    expect(g._abilitySkills(plain)).toBeNull();
  });
});

describe("arming a skill (_abilityArm)", () => {
  it("refuses with no selection, a spent unit, outside the player phase, mid-animation, or a skill not offered", () => {
    const { g, u } = withCaster("dunesirens");
    expect(g._abilityArm("quicksand")).toBe(false); // nothing selected
    g.select(u);
    expect(g._abilityArm("build")).toBe(false); // not this unit's skill
    g.anim = { type: "attack" };
    expect(g._abilityArm("quicksand")).toBe(false);
    g.anim = null;
    g.phase = "enemy";
    expect(g._abilityArm("quicksand")).toBe(false);
    g.phase = "player";
    u.acted = true;
    expect(g._abilityArm("quicksand")).toBe(false);
  });

  it("picking an aimed skill arms it; picking it again disarms it (the skill-row route via aimSkill)", () => {
    const { g, u } = withCaster("dunesirens");
    g.select(u);
    g.aimSkill("quicksand");
    expect(g.aimMode).toBe(true);
    expect(g._abilityAim).toBe("quicksand");
    expect(g._abilityArm("quicksand")).toBe(true);
    expect(g.aimMode).toBe(false);
    expect(g._abilityAim).toBeNull();
  });
});

describe("the aimed tap (_abilityClick)", () => {
  it("is not consumed when nothing is armed", () => {
    const { g, u } = withCaster("craftsmen");
    expect(g._abilityClick(u.tx + 1, u.ty)).toBe(false);
    g.select(u);
    expect(g._abilityClick(u.tx + 1, u.ty)).toBe(false);
  });

  it("a tap off the map, or by a unit that has already acted, just drops the aim", () => {
    const { g, u } = withCaster("craftsmen", (g, x, y) => hasBuildableN4(g, x, y));
    g.select(u);
    g._abilityArm("build");
    expect(g._abilityClick(-1, -1)).toBe(true);
    expect(g.aimMode).toBe(false);
    expect(g.anim).toBeFalsy();
    g._abilityArm("build");
    u.acted = true;
    const [bx, by] = N4.map(([dx, dy]) => [u.tx + dx, u.ty + dy]).find(([x, y]) => g._buildableTile(x, y));
    expect(g._abilityClick(bx, by)).toBe(true);
    expect(g.anim).toBeFalsy();
    expect(u._built).toBeFalsy();
  });

  it("a tap that is no valid target explains itself and casts nothing", () => {
    const { g, u } = withCaster("craftsmen", (g, x, y) => hasBuildableN4(g, x, y));
    g.select(u);
    g._abilityArm("build");
    g.click({ tx: u.tx, ty: u.ty + 2 < g.rows ? u.ty + 2 : u.ty - 2 }); // two tiles away: Build reaches 1
    expect(g.notice.text).toBe("That is not a valid target for this skill.");
    expect(g.aimMode).toBe(false);
    expect(u._built).toBeFalsy();
    expect(u.acted).toBe(false);
  });
});

describe("Build (Craftsmen)", () => {
  it("raises a village on adjacent open ground, once per battle, and the Craftsman's action is spent", () => {
    const { g, u } = withCaster("craftsmen", (g, x, y) => hasBuildableN4(g, x, y));
    const [bx, by] = N4.map(([dx, dy]) => [u.tx + dx, u.ty + dy]).find(([x, y]) => g._buildableTile(x, y));
    g.structHp.set(bx + "," + by, 30); // worn ground: the new village still starts whole (deliberate deviation)
    g.select(u);
    expect(g._abilityArm("build")).toBe(true);
    g.click({ tx: bx, ty: by });
    expect(g.anim && g.anim.cast).toBe(true); // the cast animation plays first…
    settle(g);
    expect(u._built).toBe(true); // …then the village stands
    expect(u.acted).toBe(true);
    expect(g.builtVillages.has(bx + "," + by)).toBe(true);
    expect(g.terrainAt(bx, by).heal).toBeGreaterThan(0);
    expect(g.structHp.has(bx + "," + by)).toBe(false);
    expect(floaterTexts(g)).toContain("Village built");
    expect(fxNames(g)).toEqual(expect.arrayContaining(["sand_puff", "debris"]));
    u.acted = false;
    const b = g._abilitySkills(u).find((s) => s.id === "build");
    expect(b).toMatchObject({ disabled: true, count: "0/1" });
    expect(b.desc).toMatch(/Already used/);
    // even an armed aim (left over) can't build a second time
    g.select(u);
    g._abilityAim = "build";
    g.aimMode = true;
    const other = N4.map(([dx, dy]) => [u.tx + dx, u.ty + dy]).find(([x, y]) => g._buildableTile(x, y));
    if (other) {
      g.click({ tx: other[0], ty: other[1] });
      expect(g.builtVillages.has(other.join(","))).toBe(false);
      expect(g.notice.text).toBe("That is not a valid target for this skill.");
    }
  });
});

describe("Repair (Craftsmen)", () => {
  function engineSetup(hp) {
    const { g, u } = withCaster("craftsmen", (g, x, y) => !!freeN4(g, { tx: x, ty: y }));
    const [ex, ey] = freeN4(g, u);
    const cat = spawn(g, "catapult", "blue", ex, ey, { hp });
    return { g, u, cat };
  }
  it("mends an adjacent damaged war engine: the heal state, +51 of 256 (reads +20)", () => {
    const { g, u, cat } = engineSetup(50);
    g.select(u);
    expect(g._abilityArm("repair")).toBe(true);
    g.click({ tx: cat.tx, ty: cat.ty });
    settle(g);
    expect(cat.hp).toBe(70); // the heal state: +20 in whole HP
    expect(u.acted).toBe(true);
    expect(floaterTexts(g)).toContain("+20");
    expect(fxNames(g)).toContain("debris");
  });
  it("never past full health (90 → 100)", () => {
    const { g, u, cat } = engineSetup(90);
    g.select(u);
    g._abilityArm("repair");
    g.click({ tx: cat.tx, ty: cat.ty });
    settle(g);
    expect(cat.hp).toBe(100);
  });
  it("a tap on something that isn't a damaged engine or structure is refused", () => {
    const { g, u, cat } = engineSetup(50);
    g.select(u);
    g._abilityArm("repair");
    const empty = freeN4(g, u);
    g.click({ tx: empty[0], ty: empty[1] });
    expect(g.notice.text).toBe("That is not a valid target for this skill.");
    expect(cat.hp).toBe(50);
    expect(u.acted).toBe(false);
  });
  it("steps an adjacent damaged structure back one stage and adds 20 structure HP (Map::applyRepair)", () => {
    const v = damagedStage();
    const { g, u } = withCaster("craftsmen", (g, x, y) => !!freeN4(g, { tx: x, ty: y }));
    const [sx, sy] = freeN4(g, u);
    g.tiles[sy * g.cols + sx] = v;
    g.structHp.set(sx + "," + sy, 100);
    g.select(u);
    expect(g._abilityArm("repair")).toBe(true);
    g.click({ tx: sx, ty: sy });
    settle(g);
    expect(g.tiles[sy * g.cols + sx]).toBe(structPre(v));
    expect(g.structHp.get(sx + "," + sy)).toBe(120);
    expect(floaterTexts(g)).toContain("Repaired");
    expect(u.acted).toBe(true);
  });
});

describe("Quicksand (Dune Sirens)", () => {
  it("a tap east lays the 3-tile column on that side for 4 rounds; the cast hurts nobody and raises the sand skull", () => {
    const { g, u } = withCaster("dunesirens", sandEast);
    const foe = spawn(g, "footmen", "red", u.tx + 1, u.ty, { hp: 100 });
    g.select(u);
    g._abilityArm("quicksand");
    g.click({ tx: u.tx + 1, ty: u.ty });
    settle(g);
    for (const d of [-1, 0, 1]) expect(g._quicksandAt(u.tx + 1, u.ty + d)).toBe(4);
    expect(g._quicksandAt(u.tx - 1, u.ty)).toBe(0);
    expect(foe.hp).toBe(100);
    expect(u.acted).toBe(true);
    const skull = g.fx.find((f) => f.name === "sand_skull");
    expect(skull).toBeTruthy();
    expect(skull.flip).toBe(u.face < 0); // drawn over the caster herself
    expect(g.fx.filter((f) => f.name === "sand_puff").length).toBe(3);
  });

  it("a tap south lays the row below; a diagonal tap is refused (Unit::setAttackTarget: manhattan 1 only)", () => {
    const a = withCaster("dunesirens", sandSouth);
    a.g.select(a.u);
    a.g._abilityArm("quicksand");
    a.g.click({ tx: a.u.tx, ty: a.u.ty + 1 });
    settle(a.g);
    for (const d of [-1, 0, 1]) expect(a.g._quicksandAt(a.u.tx + d, a.u.ty + 1)).toBe(4);

    const b = withCaster("dunesirens", sandEast);
    b.g.select(b.u);
    b.g._abilityArm("quicksand");
    b.g.click({ tx: b.u.tx + 1, ty: b.u.ty + 1 }); // diagonal SE: not a target
    settle(b.g);
    for (const d of [-1, 0, 1]) expect(b.g._quicksandAt(b.u.tx + 1, b.u.ty + d)).toBe(0);
    expect(b.u.acted).toBeFalsy();
  });

  it("a tap on the Siren herself lays her default side, by her facing (Unit+0x14f)", () => {
    const a = withCaster("dunesirens", sandSouth);
    a.u.face = 1; // facing right → the row below
    a.g.select(a.u);
    a.g._abilityArm("quicksand");
    a.g.click({ tx: a.u.tx, ty: a.u.ty });
    settle(a.g);
    for (const d of [-1, 0, 1]) expect(a.g._quicksandAt(a.u.tx + d, a.u.ty + 1)).toBe(4);
    const b = withCaster("dunesirens");
    b.u.face = -1; // facing left → the row above
    expect(b.g._quicksandLine(b.u, b.u.tx, b.u.ty)).toEqual([
      [b.u.tx - 1, b.u.ty - 1],
      [b.u.tx, b.u.ty - 1],
      [b.u.tx + 1, b.u.ty - 1],
    ]);
  });

  it("only the sand tiles of the line turn; tiles already quicksand are not renewed", () => {
    const { g, u } = withCaster("dunesirens", sandEast);
    g.quicksand.set(u.tx + 1 + "," + (u.ty - 1), 2);
    g.select(u);
    g._abilityArm("quicksand");
    g.click({ tx: u.tx + 1, ty: u.ty });
    settle(g);
    expect(g._quicksandAt(u.tx + 1, u.ty - 1)).toBe(2);
    expect(g._quicksandAt(u.tx + 1, u.ty)).toBe(4);
  });

  it("with no sand on the tapped side nothing is cast and the Siren keeps her action", () => {
    const { g, u } = withCaster("dunesirens", (g, x, y) => [-1, 0, 1].every((d) => !g._canLayQuicksand(x + 1, y + d)));
    g.select(u);
    const before = g.quicksand ? g.quicksand.size : 0;
    expect(g._castQuicksand(u, u.tx + 1, u.ty)).toBe(false);
    expect(g.notice.text).toMatch(/No sand there/);
    g._abilityArm("quicksand");
    g.click({ tx: u.tx + 1, ty: u.ty });
    expect(g.quicksand ? g.quicksand.size : 0).toBe(before);
    expect(u.acted).toBe(false);
    expect(g.anim).toBeFalsy();
    // a tap two tiles away is no neighbour at all
    g._abilityArm("quicksand");
    g.click({ tx: u.tx + 2, ty: u.ty });
    expect(g.notice.text).toBe("That is not a valid target for this skill.");
  });
});

describe("Conjure (Conjurer)", () => {
  it("summons a Sapper on a free neighbouring tile (diagonals count); the minion waits a turn and is tied to its Conjurer", () => {
    const { g, u } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 2);
    const [cx, cy] = freeN8(g, u).find(([x, y]) => x !== u.tx && y !== u.ty) || freeN8(g, u)[0];
    g.select(u);
    expect(g._abilityArm("conjure_sapper")).toBe(true);
    g.click({ tx: cx, ty: cy });
    settle(g);
    const kid = g.unitAt(cx, cy);
    expect(kid.type).toBe("sapper");
    expect(kid.team).toBe("blue");
    expect(kid._conjuredBy).toBe(u.id);
    expect(kid.group).toBe(u.group);
    expect(kid.acted).toBe(true); // a fresh minion acts next turn
    expect(u.acted).toBe(true);
    expect(fxNames(g)).toContain("sigil");
    u.acted = false;
    expect(g._abilitySkills(u)[0].count).toBe("1/2");
  });

  it("summons a Bodyguard; an occupied or distant tile is refused", () => {
    const { g, u } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 3);
    const [a, b] = freeN8(g, u);
    const blocker = spawn(g, "footmen", "blue", ...a);
    g.select(u);
    g._abilityArm("conjure_bodyguard");
    g.click({ tx: a[0], ty: a[1] }); // occupied
    expect(g.notice.text).toBe("That is not a valid target for this skill.");
    expect(g.unitAt(...a)).toBe(blocker);
    g._abilityArm("conjure_bodyguard");
    g.click({ tx: b[0], ty: b[1] });
    settle(g);
    expect(g.unitAt(...b).type).toBe("bodyguard");
    expect(g.unitAt(...b)._conjuredBy).toBe(u.id);
  });

  it("an unknown minion type conjures nothing", () => {
    const { g, u } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 1);
    const n = g.units.length;
    g._castConjure(u, "no-such-unit", ...freeN8(g, u)[0]);
    expect(g.anim).toBeFalsy();
    expect(g.units.length).toBe(n);
  });
});

describe("Detonate (Sapper)", () => {
  it("fires at once (no aim): weapon damage x1.25 to every adjacent unit, friend and foe; the Sapper is spent", () => {
    const { g, u: sap } = withCaster(
      "sapper",
      (g, x, y) => N4.every(([dx, dy]) => standable(g, x + dx, y + dy)) && standable(g, x + 2, y),
    );
    const friend = spawn(g, "footmen", "blue", sap.tx - 1, sap.ty, { hp: 100 });
    const foe = spawn(g, "footmen", "red", sap.tx + 1, sap.ty, { hp: 100 });
    const far = spawn(g, "footmen", "red", sap.tx + 2, sap.ty + 1 < g.rows ? sap.ty + 1 : sap.ty - 1, { hp: 100 });
    const exp = (e) => Math.max(1, Math.round((g.computeDamage(sap, e) * 320) / 256)); // applyWeaponDamage at 125%, in whole HP
    const eF = exp(friend),
      eE = exp(foe);
    g.select(sap);
    expect(g._abilityArm("detonate")).toBe(true);
    expect(g.aimMode).toBe(false); // nothing to aim
    settle(g);
    expect(sap.dead).toBe(true);
    expect(sap.hp).toBe(0);
    expect(100 - friend.hp).toBe(eF);
    expect(100 - foe.hp).toBe(eE);
    expect(far.hp).toBe(100);
  });
});

describe("Absorb (Bodyguard)", () => {
  it("sacrifices the Bodyguard; its Conjurer then ignores all damage from the next hit only", () => {
    const { g, u: ctr } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 2);
    const [a] = freeN8(g, ctr);
    const bg = spawn(g, "bodyguard", "blue", ...a, { _conjuredBy: ctr.id });
    g.select(bg);
    expect(g._abilityArm("absorb")).toBe(true);
    settle(g);
    expect(bg.dead).toBe(true);
    expect(bg.hp).toBe(0);
    expect(ctr._absorb).toBe(true);
    expect(floaterTexts(g)).toContain("Absorb");
    expect(fxNames(g)).toEqual(expect.arrayContaining(["unsummon", "absorb_flash"]));
    const foe = spawn(g, "footmen", "red", ...freeN8(g, ctr)[0]);
    ctr.hp = 100;
    g._applyHit(ctr, foe, 30, false, false);
    expect(ctr.hp).toBe(100); // absorbed
    expect(ctr._absorb).toBe(false); // …and spent
    g._applyHit(ctr, foe, 30, false, false);
    expect(ctr.hp).toBeLessThan(100);
  });

  it("with its Conjurer gone the sacrifice does nothing", () => {
    const { g, u: ctr } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 1);
    const bg = spawn(g, "bodyguard", "blue", ...freeN8(g, ctr)[0], { _conjuredBy: ctr.id });
    ctr.dead = true;
    g._castAbsorb(bg);
    expect(g.anim).toBeFalsy();
    expect(bg.dead).toBeFalsy();
  });
});

describe("the cast staging (_castAnim)", () => {
  it("turns the caster toward its target and spends it when the animation ends — even without a finishUnit hook", () => {
    const { g, u } = withCaster("craftsmen", (g, x, y) => hasBuildableN4(g, x, y));
    u.face = 1;
    let applied = false;
    g.finishUnit = undefined; // the bare mixin path: just emit
    g._castAnim(u, { tx: u.tx - 3, ty: u.ty }, () => (applied = true));
    expect(u.face).toBe(-1);
    expect(u.attacking).toBe(true);
    g.anim.done();
    expect(applied).toBe(true);
    expect(u.acted).toBe(true);
  });
  it("an untargeted cast aims at the caster's own tile; a target straight above or below keeps the facing", () => {
    const { g, u } = withCaster("sapper");
    u.face = -1;
    g._castAnim(u, { tx: u.tx, ty: u.ty + 1 }, () => {});
    expect(u.face).toBe(-1);
    g.anim = null;
    g._castAnim(u, null, () => {});
    u.face = 0; // no facing yet: looks right
    g.anim = null;
    g._castAnim(u, { tx: u.tx, ty: u.ty + 1 }, () => {});
    expect(u.face).toBe(1);
    g.anim = null;
    g._castAnim(u, null, () => {});
    expect(g.anim.target).toMatchObject({ tx: u.tx, ty: u.ty });
  });
});

describe("aim preview (_abilityCells)", () => {
  it("Build: the 4 neighbours that are buildable ground", () => {
    const { g, u } = withCaster("craftsmen", (g, x, y) => hasBuildableN4(g, x, y));
    const cells = g._abilityCells(u, "build");
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(Math.abs(c.x - u.tx) + Math.abs(c.y - u.ty)).toBe(1);
      expect(g._buildableTile(c.x, c.y)).toBe(true);
    }
    const all = N4.filter(([dx, dy]) => g._buildableTile(u.tx + dx, u.ty + dy)).length;
    expect(cells.length).toBe(all);
  });

  it("Repair: the damaged friendly engine and the damaged structure beside the Craftsman", () => {
    const v = damagedStage();
    const { g, u } = withCaster(
      "craftsmen",
      (g, x, y) => N4.filter(([dx, dy]) => standable(g, x + dx, y + dy)).length >= 3,
    );
    const [[ex, ey], [sx, sy], [hx, hy]] = N4.map(([dx, dy]) => [u.tx + dx, u.ty + dy]).filter(([x, y]) =>
      standable(g, x, y),
    );
    spawn(g, "catapult", "blue", ex, ey, { hp: 40 });
    spawn(g, "catapult", "blue", hx, hy, { hp: 100 }); // whole: not a target
    g.tiles[sy * g.cols + sx] = v;
    const cells = g._abilityCells(u, "repair").map((c) => c.x + "," + c.y);
    expect(cells).toEqual(expect.arrayContaining([ex + "," + ey, sx + "," + sy]));
    expect(cells).not.toContain(hx + "," + hy);
  });

  it("Conjure: every free passable tile of the 8 around, never an occupied one", () => {
    const { g, u } = withCaster("conjurer", (g, x, y) => freeN8(g, { tx: x, ty: y }).length >= 3);
    const free = freeN8(g, u);
    spawn(g, "footmen", "blue", ...free[0]);
    for (const id of ["conjure_sapper", "conjure_bodyguard"]) {
      const cells = g._abilityCells(u, id).map((c) => [c.x, c.y]);
      expect(cells).toEqual(free.slice(1));
    }
  });

  it("Quicksand: one line — the hovered side's; a diagonal or far hover keeps the last line; armed = the default side", () => {
    const { g, u } = withCaster("dunesirens", (g, x, y) => sandEast(g, x, y) && sandSouth(g, x, y));
    const east = g._abilityCells(u, "quicksand", { tx: u.tx + 1, ty: u.ty }).map((c) => [c.x, c.y]);
    expect(east).toEqual([
      [u.tx + 1, u.ty - 1],
      [u.tx + 1, u.ty],
      [u.tx + 1, u.ty + 1],
    ]);
    const south = g._abilityCells(u, "quicksand", { tx: u.tx, ty: u.ty + 1 }).map((c) => [c.x, c.y]);
    expect(south).toEqual([
      [u.tx - 1, u.ty + 1],
      [u.tx, u.ty + 1],
      [u.tx + 1, u.ty + 1],
    ]);
    // a diagonal or far hover is no target: the last line (south) stays
    expect(g._abilityCells(u, "quicksand", { tx: u.tx + 1, ty: u.ty + 1 }).map((c) => [c.x, c.y])).toEqual(south);
    expect(g._abilityCells(u, "quicksand", { tx: u.tx + 4, ty: u.ty }).map((c) => [c.x, c.y])).toEqual(south);
    // a cell of the line that is already quicksand is not previewed (it can't be laid again)
    g.quicksand.set(u.tx + 1 + "," + u.ty, 3);
    expect(g._abilityCells(u, "quicksand", { tx: u.tx + 1, ty: u.ty }).length).toBe(2);
    g.quicksand.delete(u.tx + 1 + "," + u.ty);
    // armed afresh: the default side (facing right → the row below), never the 8 neighbours
    u.face = 1;
    g.select(u);
    g._abilityArm("quicksand");
    expect(g._abilityCells(u, "quicksand", null).map((c) => [c.x, c.y])).toEqual(south);
  });

  it("an unknown skill previews nothing; tiles off the map are never listed", () => {
    const { g, u } = withCaster("conjurer");
    expect(g._abilityCells(u, "nonsense")).toEqual([]);
    put(g, u, 0, 0);
    for (const c of g._abilityCells(u, "conjure_sapper")) expect(g.inBounds(c.x, c.y)).toBe(true);
    for (const c of g._abilityCells(u, "build")) expect(g.inBounds(c.x, c.y)).toBe(true);
  });
});

describe("Leashing (help 592)", () => {
  function leashBoard() {
    const { g, u: ctr, blue, red } = withCaster("conjurer", (g, x, y) => x + 9 < g.cols && findLine(g, x, y) != null);
    return { g, ctr, blue, red };
  }
  // free tiles 8 and 9 to the east of (x, y) on the same row
  function findLine(g, x, y) {
    return standable(g, x + 8, y) && standable(g, x + 9, y) ? true : null;
  }
  it("at turn's end a minion farther than 8 (Manhattan) from its living Conjurer dies; one at exactly 8 stays", () => {
    const { g, ctr } = leashBoard();
    const near = spawn(g, "sapper", "blue", ctr.tx + 8, ctr.ty, { _conjuredBy: ctr.id });
    const far = spawn(g, "bodyguard", "blue", ctr.tx + 9, ctr.ty, { _conjuredBy: ctr.id });
    g._leashCheck("blue");
    expect(near.dead).toBeFalsy();
    expect(far.dead).toBe(true);
    expect(far.hp).toBe(0);
    expect(floaterTexts(g)).toContain("Leash broken");
    expect(fxNames(g)).toContain("unsummon");
  });
  it("only the ending side's minions are checked, and only while their Conjurer lives", () => {
    const { g, ctr } = leashBoard();
    const far = spawn(g, "sapper", "blue", ctr.tx + 9, ctr.ty, { _conjuredBy: ctr.id });
    g._leashCheck("red");
    expect(far.dead).toBeFalsy();
    ctr.dead = true;
    g._leashCheck("blue");
    expect(far.dead).toBeFalsy();
  });
  it("is run as the player's turn ends", () => {
    const { g, ctr } = leashBoard();
    const far = spawn(g, "sapper", "blue", ctr.tx + 9, ctr.ty, { _conjuredBy: ctr.id });
    nextRound(g);
    expect(far.dead).toBe(true);
  });
  it("walking a minion out of range warns at once (_leashHint); inside range, or an enemy minion, no warning", () => {
    const { g, ctr } = leashBoard();
    const sap = spawn(g, "sapper", "blue", ctr.tx + 8, ctr.ty, { _conjuredBy: ctr.id });
    g._leashHint(sap);
    expect(g.notice).toBeFalsy();
    g._leashHint(null);
    put(g, sap, ctr.tx + 9, ctr.ty);
    sap.team = "red";
    g._leashHint(sap);
    expect(g.notice).toBeFalsy();
    sap.team = "blue";
    put(g, sap, ctr.tx + 8, ctr.ty);
    moveTo(g, sap, ctr.tx + 9, ctr.ty);
    expect([sap.tx, sap.ty]).toEqual([ctr.tx + 9, ctr.ty]);
    expect(g.notice.text).toMatch(/leashing range \(8\)/);
  });
});

describe("Spirit Shroud — Unit::endTurn's curse pass", () => {
  it("plays once when a Shaman and an enemy meet within 4 at a turn's end; never for allies; again after contact is lost", () => {
    const { g, u: sh } = withCaster("shamans", (g, x, y) => standable(g, x + 1, y) && standable(g, x + 3, y));
    const play = vi.spyOn(g.audio, "play");
    g.fx = [];
    const ally = spawn(g, "footmen", "blue", sh.tx + 1, sh.ty);
    g._shroudEndTurn(sh); // only an ally near: nothing (the old turn-start "rise" was not the original's)
    g._shroudEndTurn(ally);
    expect(fxNames(g)).not.toContain("spirit");
    expect(sh._shroudOn).toBeFalsy();
    const foe = spawn(g, "footmen", "red", sh.tx + 3, sh.ty);
    sh.face = -1;
    g._shroudEndTurn(foe); // the ENEMY ends its turn within 4 of the Shaman → the Shaman curses
    let sp = g.fx.filter((f) => f.name === "spirit");
    expect(sp.length).toBe(1);
    expect(sp[0].flip).toBe(true);
    expect(play).toHaveBeenCalledWith("shroud", 0.45);
    expect(sh._shroudOn).toBe(true);
    g._shroudEndTurn(sh); // once per contact (Unit+0x45)
    g._shroudEndTurn(foe);
    expect(g.fx.filter((f) => f.name === "spirit").length).toBe(1);
    foe.dead = true;
    g._shroudEndTurn(sh); // the Shaman ends a turn with no enemy within 4: the flag drops
    expect(sh._shroudOn).toBe(false);
    foe.dead = false;
    g._shroudEndTurn(sh); // contact again: plays again
    expect(g.fx.filter((f) => f.name === "spirit").length).toBe(2);
    g._shroudEndTurn(null);
    sh.dead = true;
    g._shroudEndTurn(sh);
    expect(g.fx.filter((f) => f.name === "spirit").length).toBe(2);
  });

  it("runs once per unit per turn: when it is done (the loop watch) or for the idle ones at its side's turn end", () => {
    const { g, u: sh } = withCaster("shamans", (g, x, y) => standable(g, x + 1, y));
    const spy = vi.spyOn(g, "_shroudEndTurn");
    sh.chargeDir = { dx: 1, dy: 0 };
    sh.acted = true;
    g._endTurnWatch();
    g._endTurnWatch();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sh.chargeDir).toBe(null); // a charge never outlives its unit's turn
    sh.acted = false;
    g._endTurnWatch(); // a new turn re-arms it
    g._endTurnBrace([sh]); // idle at its side's turn end
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
