// Combat rules (rules/combat.js) — the damage model and its modifiers, pinned to the decoded formula:
//   damage = base[weapon][armour] (+30 charge / brace, ×2 fire vs flammable) · (rating + auras + flank)/100 · cover ·
//            attacker HP/100, then ×retribution, ×½ shielded vs ranged, ×0.8 siege armour vs melee; min 1.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEpisode, spawn, settle } from "./battle.js";
import { blank, openArea, findTile } from "./rules-kit.js";
import { WEAPON_DMG } from "../data/combat-data.js";
import { wholeHp } from "../util/util.js";
import { UNIT_TYPES } from "../data/game-data.js";

beforeAll(() => loadEpisode(2));

// The Vanguard (5410) has an 8×5 block of open ground at (9,8).
function arena() {
  const g = blank(5410);
  g.objectives = [];
  const a = openArea(g, 8, 5);
  return { g, x: a.x, y: a.y };
}
const B = (w, type) => WEAPON_DMG[w][UNIT_TYPES[type].armour];
// Unit::calculateAttackDamage's integer chain on the 256 HP scale, in HP: base, the tile cover %, the rating, the
// attacker's HP, then `post` on the 256-scale result (the Shield's /2, Siege Armour's ×8/10).
const chain = (base, cover, rating, hp = 100, post = (d) => d) => {
  const skill = (Math.trunc((rating * 256) / 100) * Math.round((hp * 256) / 100)) >> 8;
  let d = (Math.trunc((cover * 256) / 100) * Math.trunc((base * 256) / 100)) >> 8;
  d = (d * skill) >> 8;
  return wholeHp(Math.max(0, post(d))); // in whole HP (DELIBERATE DEVIATION)
};

describe("computeDamage", () => {
  it("a lance hits a militiaman for its table value; a charge and a brace each add 30 to the base", () => {
    const { g, x, y } = arena();
    const k = spawn(g, "knights", "blue", x, y + 2);
    const m = spawn(g, "militiamen", "red", x + 1, y + 2);
    const b = B(15, "militiamen"),
      rf = k.T.rf;
    expect(g.computeDamage(k, m)).toBe(chain(b, 100, rf));
    expect(g.computeDamage(k, m, { charge: true })).toBe(chain(b + 30, 100, rf));
    expect(g.computeDamage(k, m, { brace: true })).toBe(chain(b + 30, 100, rf));
    expect(g.computeDamage(k, m)).toBe(wholeHp(g._damage256(k, m))); // whole HP from the 256-scale chain
    // attacker strength scales the blow
    k.hp = 50;
    expect(g.computeDamage(k, m)).toBe(chain(b, 100, rf, 50));
  });

  it("fire doubles the base against a flammable target — the WEAPON's fire (Fire Arrows, Fireball), not the unit's", () => {
    const { g, x, y } = arena();
    const ar = spawn(g, "archers", "blue", x, y);
    const cat = spawn(g, "catapult", "red", x + 3, y);
    const foot = spawn(g, "footmen", "red", x, y + 3);
    expect(g.computeDamage(ar, cat)).toBe(chain(2 * B(16, "catapult"), 100, ar.T.rf));
    expect(g.computeDamage(ar, foot)).toBe(chain(B(16, "footmen"), 100, ar.T.rf));
    const wiz = spawn(g, "wizards", "blue", x + 6, y);
    expect(g.computeDamage(wiz, cat)).toBe(chain(2 * B(25, "catapult"), 100, wiz.T.rf));
    // Unit::isFireWeapon reads the weapon used: an Archer's Short Sword at the catapult's side is no fire
    const stab = spawn(g, "archers", "blue", x + 3, y + 1);
    expect(g.computeDamage(stab, cat)).toBe(chain(B(8, "catapult"), 100, stab.T.rf));
  });

  it("Boulder and Cannonball cannot touch a flier (0); a Cannon may not even target one, but its Grapeshot spray still hurts it", () => {
    const { g, x, y } = arena();
    const tre = spawn(g, "trebuchet", "red", x, y);
    const gr = spawn(g, "griffon", "blue", x + 5, y);
    expect(g.computeDamage(tre, gr)).toBe(0);
    expect(g._weaponUselessVs(tre, gr, 5)).toBe(true);
    const can = spawn(g, "cannon", "red", x + 2, y + 2);
    const eagle = spawn(g, "greateagle", "blue", x + 6, y + 2);
    expect(g.computeDamage(can, eagle)).toBe(0);
    const g2 = spawn(g, "griffon", "blue", x + 3, y + 2);
    expect(g._weaponUselessVs(can, g2, 1)).toBe(true); // isViableTarget: no Trebuchet / Cannon target is a flier
    expect(g.computeDamage(can, g2)).toBeGreaterThan(0); // …a flier caught in the Grapeshot cone is still hit
  });

  it("the Ballistae's Piercing Bolt and Shock do nothing to Feathered Hide (the table's 0 is no damage)", () => {
    const { g, x, y } = arena();
    const bal = spawn(g, "ballistae", "red", x, y);
    const gr = spawn(g, "griffon", "blue", x + 4, y);
    const eagle = spawn(g, "greateagle", "blue", x + 1, y);
    expect(g.computeDamage(bal, gr)).toBe(0); // Piercing Bolt at range 4
    expect(g.computeDamage(bal, eagle)).toBe(0); // Shock point-blank
    const foot = spawn(g, "footmen", "blue", x, y + 4);
    expect(g.computeDamage(bal, foot)).toBeGreaterThan(0);
  });

  it("flank: +30 rating per ally directly opposite the blow, +15 per ally on a side", () => {
    const { g, x, y } = arena();
    const a = spawn(g, "militiamen", "blue", x + 2, y + 2);
    const d = spawn(g, "militiamen", "red", x + 3, y + 2);
    expect(g._flankBonus(a, d)).toBe(0);
    spawn(g, "militiamen", "blue", x + 4, y + 2); // opposite
    expect(g._flankBonus(a, d)).toBe(30);
    spawn(g, "militiamen", "blue", x + 3, y + 1); // side
    expect(g._flankBonus(a, d)).toBe(45);
    spawn(g, "militiamen", "red", x + 3, y + 3); // a foe beside it adds nothing
    expect(g._flankBonus(a, d)).toBe(45);
    expect(g.computeDamage(a, d)).toBe(chain(B(3, "militiamen"), 100, a.T.rf + 45));
    // north-south blow: the ally to the east is now on a side
    const g2 = arena().g;
    const a2 = spawn(g2, "militiamen", "blue", x + 3, y + 1);
    const d2 = spawn(g2, "militiamen", "red", x + 3, y + 2);
    spawn(g2, "militiamen", "blue", x + 4, y + 2);
    spawn(g2, "militiamen", "blue", x + 3, y + 3);
    expect(g2._flankBonus(a2, d2)).toBe(45);
  });

  it("a formation defender sheds 10% per adjacent formation ally — but not against siege shot", () => {
    const { g, x, y } = arena();
    const a = spawn(g, "swordsmen", "blue", x + 1, y + 2);
    const d = spawn(g, "footmen", "red", x + 2, y + 2);
    spawn(g, "footmen", "red", x + 2, y + 1);
    spawn(g, "pikemen", "red", x + 2, y + 3);
    spawn(g, "militiamen", "red", x + 3, y + 2); // not formation
    expect(g.formationAllies(d)).toBe(2);
    expect(g.computeDamage(a, d)).toBe(chain(B(5, "footmen"), 100 - 20, a.T.rf));
    const tre = spawn(g, "trebuchet", "blue", x + 7, y + 2);
    expect(g.computeDamage(tre, d)).toBe(chain(B(21, "footmen"), 100, tre.T.rf));
  });

  it("Boulder half-ignores cover (≤80 let through → +half the rest); other weapons take it whole", () => {
    const { g } = arena();
    const t = findTile(g, (x, y) => Math.abs(g.terrainAt(x, y).defBonus - 0.2) < 1e-9);
    const d = spawn(g, "footmen", "red", t[0], t[1]);
    const tre = spawn(g, "trebuchet", "blue", t[0], t[1] + 5 < g.rows ? t[1] + 5 : t[1] - 5);
    expect(g.computeDamage(tre, d)).toBe(chain(B(21, "footmen"), 80 + 10, tre.T.rf));
    const ar = spawn(g, "crossbowmen", "blue", t[0], t[1] + 3 < g.rows ? t[1] + 3 : t[1] - 3);
    expect(g.computeDamage(ar, d)).toBe(chain(B(17, "footmen"), 80, ar.T.rf));
  });

  it("a blow can do nothing: no floor on the cover, no minimum damage", () => {
    const { g, x, y } = arena();
    const a = spawn(g, "militiamen", "blue", x + 1, y + 2);
    const d = spawn(g, "footmen", "red", x + 2, y + 2);
    g.terrainAt = () => ({ defBonus: 0.9 });
    expect(g.computeDamage(a, d)).toBe(chain(B(3, "footmen"), 10, a.T.rf));
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [1, 0],
    ])
      spawn(g, "footmen", "red", x + 2 + dx, y + 2 + dy);
    expect(g.computeDamage(a, d)).toBe(0); // 10 − 3·10 cover: nothing gets through
    g.terrainAt = () => ({ defBonus: 0 });
    a.hp = 0.4; // a dying militiaman
    expect(g.computeDamage(a, d)).toBe(0); // a dying militiaman's poke rounds down to nothing
  });

  it("a Shield halves ranged fire only; Siege Armor takes 20% off melee", () => {
    const { g, x, y } = arena();
    const a = spawn(g, "swordsmen", "blue", x + 1, y + 2);
    const d = spawn(g, "footmen", "red", x + 2, y + 2);
    const pr = spawn(g, "priests", "red", x + 4, y + 2);
    g._prayerMark("shield", pr);
    expect(g._shielded(d)).toBe(true);
    expect(g._shielded(pr)).toBe(true); // the priest itself
    expect(g.computeDamage(a, d)).toBe(chain(B(5, "footmen"), 100, a.T.rf)); // melee: no shield
    const ar = spawn(g, "crossbowmen", "blue", x + 2, y + 5 < g.rows ? y + 4 : y);
    const dist = Math.abs(ar.ty - d.ty);
    expect(dist).toBeGreaterThan(1);
    expect(g.computeDamage(ar, d)).toBe(chain(B(17, "footmen"), 100, ar.T.rf, 100, (dmg) => Math.trunc(dmg / 2)));
    pr.tx = x + 7; // the mark is the cast TILE: the priest walking off doesn't lift it
    expect(g._shielded(d)).toBe(true);
    const off = spawn(g, "footmen", "red", x + 7, y + 2); // Manhattan 3 from the mark
    expect(g._shielded(off)).toBe(false);
    // Siege Armor
    const bal = spawn(g, "ballistae", "red", x + 6, y + 4);
    const sw = spawn(g, "swordsmen", "blue", x + 5, y + 4);
    expect(g._siegeArmored(bal)).toBe(true);
    expect(g.computeDamage(sw, bal)).toBe(
      chain(B(5, "ballistae"), 100, sw.T.rf, 100, (dmg) => Math.trunc((dmg * 8) / 10)),
    );
    const cat = spawn(g, "catapult", "red", x + 7, y + 2);
    expect(g._siegeArmored(cat)).toBe(true); // Chebyshev 2 of a friendly Ballistae
    cat.tx = x;
    cat.ty = y;
    expect(g._siegeArmored(cat)).toBe(false);
    expect(g._siegeArmored(d)).toBe(false); // not a war engine
  });
});

describe("rating aura, capture holder, courage", () => {
  it("Unit::getSkill: ONE +15 rally (a Battle Standard, or an ACTIVE friendly Shroud), ONE −15 enemy Shroud, +15 objective", () => {
    const { g, x, y } = arena();
    const u = spawn(g, "footmen", "blue", x, y);
    expect(g.ratingAura(u)).toBe(0);
    const king = spawn(g, "king", "blue", x + 4, y);
    expect(g.ratingAura(u)).toBe(15);
    expect(g.ratingAura(king)).toBe(0); // the Hero never rallies itself (nor is rallied by a Standard)
    king.tx = x + 5;
    expect(g.ratingAura(u)).toBe(0);
    const sh = spawn(g, "shamans", "blue", x, y + 2);
    expect(g.ratingAura(u)).toBe(0); // a friendly Shroud counts only while ACTIVE (Unit+0x45)
    sh._shroudOn = true;
    expect(g.ratingAura(u)).toBe(15);
    expect(g.ratingAura(sh)).toBe(15); // an active Shroud rallies the Shaman itself
    king.tx = x + 4;
    expect(g.ratingAura(u)).toBe(15); // Standard + Shroud: still one +15 — they don't stack
    expect(g._courage(u)).toBe(g._courage(spawn(g, "footmen", "blue", x + 1, y + 6)) + 15);
    spawn(g, "shamans", "red", x + 2, y + 2);
    expect(g.ratingAura(u)).toBe(0); // +15 −15
    const st = g._statusesOf(u).map((s) => s.name);
    expect(st).toContain("Rallied +15"); // both shown
    expect(st).toContain("Shrouded −15");
    g.objectives = [{ tx: x, ty: y }];
    expect(g._captureHolder()).toBe("blue");
    expect(g.ratingAura(u)).toBe(15);
  });

  it("a defender never charges or rides on: the Hero kills its attacker in defence and stays put (bug report)", () => {
    const { g, x, y } = arena();
    const hero = spawn(g, "king", "blue", x + 1, y);
    const foe = spawn(g, "militiamen", "red", x + 2, y);
    foe.hp = 5;
    hero.chargeDir = { dx: 1, dy: 0 }; // the straight gallop it rode on its own turn
    hero.chargeSpent = 0;
    expect(g._wouldCharge(hero, foe)).toBe(true);
    g.phase = "enemy";
    // its first strike in defence (and the counter path too) must not be a charge
    const fs = vi.spyOn(g, "_firstStrikeOf").mockReturnValue({ brace: false, label: "First Strike!", floatOn: hero });
    g.ai.doAttackAI(foe, hero, () => {});
    settle(g);
    fs.mockRestore();
    expect(foe.dead).toBe(true);
    expect([hero.tx, hero.ty]).toEqual([x + 1, y]); // no ride-on into the dead attacker's tile
  });

  it("the capture holder has strictly the most units on the capture tiles", () => {
    const { g, x, y } = arena();
    expect(g._captureHolder()).toBe(null);
    g.objectives = [
      { tx: x, ty: y },
      { tx: x + 1, ty: y },
      { tx: x + 2, ty: y },
    ];
    expect(g._captureHolder()).toBe(null); // empty
    spawn(g, "footmen", "blue", x, y);
    spawn(g, "footmen", "red", x + 1, y);
    expect(g._captureHolder()).toBe(null); // a tie
    spawn(g, "footmen", "red", x + 2, y);
    expect(g._captureHolder()).toBe("red");
  });

  it("Unit::getCourage has no Hero exclusion: another Hero's Standard steadies a Hero (getSkill still skips it)", () => {
    const { g, x, y } = arena();
    const k = spawn(g, "king", "blue", x, y);
    expect(g._courage(k)).toBe(125); // its own Standard never counts
    spawn(g, "king", "blue", x + 2, y);
    expect(g._courage(k)).toBe(140);
    expect(g.ratingAura(k)).toBe(0);
  });

  it("courage: the tier table, ±15 auras (once each), +15 holding the objective; the pass chance on the 256 scale", () => {
    const { g, x, y } = arena();
    const m = spawn(g, "militiamen", "blue", x, y); // tier 1
    const k = spawn(g, "king", "blue", x + 7, y + 4); // tier 5, out of range
    expect(g._courage(m)).toBe(50);
    expect(g._courage(k)).toBe(125);
    const noTier = spawn(g, "footmen", "blue", x, y + 4, {
      T: { ...UNIT_TYPES.footmen, courage: undefined, rating: 9 },
    });
    expect(g._courage(noTier)).toBe(65); // the switch default
    spawn(g, "shamans", "blue", x + 1, y);
    spawn(g, "king", "blue", x, y + 1);
    expect(g._courage(m)).toBe(65); // steadied once, not twice
    spawn(g, "shamans", "red", x + 2, y + 1);
    expect(g._courage(m)).toBe(50);
    g.objectives = [{ tx: x, ty: y }];
    expect(g._courage(m)).toBe(65);
    expect(g._courageChance(k)).toBe(1);
    expect(g._courageChance(m)).toBeCloseTo(Math.ceil(((Math.floor((65 * 256) / 100) + 1) * 1000) / 256) / 1000, 6);
    g._courage = () => -10;
    expect(g._courageChance(m)).toBe(0);
  });

  it("only a Fear defender calls for courage, and a Fear unit or a Fearless one never balks", () => {
    const { g, x, y } = arena();
    const a = spawn(g, "militiamen", "blue", x, y);
    const gr = spawn(g, "griffon", "red", x + 1, y);
    const f = spawn(g, "footmen", "red", x, y + 1);
    expect(g._needsCourage(a, gr)).toBe(true);
    expect(g._needsCourage(a, f)).toBe(false);
    expect(g._needsCourage(a, null)).toBe(false);
    const bear = spawn(g, "bear", "blue", x + 2, y);
    expect(g._needsCourage(bear, gr)).toBe(false);
    expect(g._fearCheck(bear, gr, () => {})).toBe(false);
    a.T = { ...a.T, fearless: true };
    expect(g._fearCheck(a, gr, () => {})).toBe(false);
  });

  it("a failed roll balks: the 'balk' animation runs and the turn is spent; a passed one shows 'Courage!'", () => {
    const { g, x, y } = arena();
    const a = spawn(g, "militiamen", "blue", x, y);
    const gr = spawn(g, "griffon", "red", x + 1, y);
    const rolls = [];
    g._roll = (t, d) => rolls.push(d);
    g.rng = () => 0.999; // roll 255 → fails courage 50 (needs ≤ 128) — the battle's own seeded dice
    let balked = 0;
    expect(g._fearCheck(a, gr, () => balked++)).toBe(true);
    expect(g.anim.type).toBe("balk");
    expect(rolls.at(-1)).toMatchObject({ what: "courage", roll: 255, need: 128, pass: false });
    g.anim.done();
    expect(balked).toBe(1);
    g.anim = null;
    g.rng = () => 0; // roll 0 → passes
    const n = g.floaters.length;
    expect(g._fearCheck(a, gr, () => {})).toBe(false);
    expect(g.floaters.slice(n).map((f) => f.text)).toContain("Courage!");
  });
});

describe("statuses on the inspect card", () => {
  it("lists quicksand (held / immune), slowed, rally / shroud, objective, shield, absorb, retribution and brace", () => {
    const { g, x, y } = arena();
    const u = spawn(g, "pikemen", "blue", x, y);
    expect(g._statusesOf(u)).toEqual([]);
    g.quicksand.set(x + "," + y, 3);
    u.slowed = true;
    g._prayerMark("shield", u);
    u._absorb = true;
    g._prayerMark("retribution", u);
    u.walled = true;
    spawn(g, "king", "blue", x + 1, y);
    g.objectives = [{ tx: x + 1, ty: y }];
    const names = g._statusesOf(u).map((s) => s.name);
    expect(names).toEqual([
      "In quicksand",
      "Slowed",
      "Rallied +15",
      "Holding the objective +15",
      "Shielded",
      "Shield (Prayer)",
      "Absorb",
      "Retribution",
      "Braced",
    ]);
    expect(g._statusesOf(u)[0].vars).toEqual({ n: 3 });
    const s = spawn(g, "dunesirens", "red", x + 3, y + 3);
    g.quicksand.set(x + 3 + "," + (y + 3), 2);
    spawn(g, "shamans", "blue", x + 4, y + 3);
    expect(g._statusesOf(s).map((t) => t.name)).toEqual(["Immune to quicksand", "Shrouded −15"]);
  });
});

describe("first strike, last strike and the Pike Wall (Unit::isFirstStrike)", () => {
  it("Pikemen: a braced wall strikes first on any attacker but the Hero; unbraced only on class-3 mounts", () => {
    const { g, x, y } = arena();
    const p = spawn(g, "pikemen", "red", x + 1, y);
    const f = spawn(g, "footmen", "blue", x, y);
    const kn = spawn(g, "knights", "blue", x + 2, y);
    const gr = spawn(g, "griffon", "blue", x + 1, y + 1);
    const king = spawn(g, "king", "blue", x + 1, y + 2);
    expect(g._firstStrikeOf(f, p)).toBeNull();
    expect(g._firstStrikeOf(kn, p)).toMatchObject({ brace: false, label: "First Strike!", floatOn: p });
    expect(g._firstStrikeOf(gr, p)).toBeNull(); // the binary's clause tests the defender for type 9: no Griffon case
    p.walled = true;
    expect(g._firstStrikeOf(gr, p)).toMatchObject({ label: "Pike Wall!" });
    expect(g._firstStrikeOf(f, p)).toMatchObject({ brace: false, label: "Pike Wall!" });
    expect(g._firstStrikeOf(king, p)).toBeNull();
  });

  it("a braced pikeman lowers its wall when ITS blow lands on a foe on foot, not on a mounted one (Unit::onTick)", () => {
    const { g, x, y } = arena();
    const p = spawn(g, "pikemen", "red", x + 1, y, { walled: true });
    const kn = spawn(g, "knights", "blue", x, y);
    const gr = spawn(g, "griffon", "blue", x + 1, y + 1);
    const king = spawn(g, "king", "blue", x + 2, y);
    const f = spawn(g, "footmen", "blue", x + 1, y - 1);
    g._applyHit(kn, p, 5);
    g._applyHit(gr, p, 5);
    g._applyHit(king, p, 5);
    expect(p.walled).toBe(true); // struck class 3 / a Griffon: the wall stands
    g._applyHit(p, f, 5);
    expect(p.walled).toBe(true); // being struck does not lower it
    g._applyHit(f, p, 5);
    expect(p.walled).toBe(false); // striking a unit on foot does
  });

  it("the braced wall's +30 against a charging mount or war engine is an Episode I rule (mission.ep === 2 turns it off)", () => {
    const { g, x, y } = arena();
    const p = spawn(g, "pikemen", "red", x + 1, y, { walled: true });
    const kn = spawn(g, "knights", "blue", x, y);
    const cat = spawn(g, "catapult", "blue", x + 2, y);
    g.mission = { ...g.mission, ep: 1 };
    expect(g._firstStrikeOf(kn, p).brace).toBe(true);
    expect(g._firstStrikeOf(cat, p).brace).toBe(true);
    g.mission = { ...g.mission, ep: 2 };
    expect(g._firstStrikeOf(kn, p).brace).toBe(false);
  });

  it("First Strike (the Hero) and Last Strike (Greatswordsmen / Blood Gorgers); a defender that can't melee never strikes first", () => {
    const { g, x, y } = arena();
    const king = spawn(g, "king", "red", x + 1, y);
    const f = spawn(g, "footmen", "blue", x, y);
    expect(g._firstStrikeOf(f, king)).toMatchObject({ label: "First Strike!", floatOn: king });
    const king2 = spawn(g, "king", "blue", x + 2, y);
    expect(g._firstStrikeOf(king2, king)).toBeNull();
    const gs = spawn(g, "greatswordsmen", "blue", x, y + 1);
    const m = spawn(g, "militiamen", "red", x + 1, y + 1);
    expect(g._firstStrikeOf(gs, m)).toMatchObject({ label: "Last Strike", floatOn: gs });
    const bg = spawn(g, "bloodgorgers", "red", x, y + 2);
    expect(g._firstStrikeOf(gs, bg)).toBeNull();
    const can = spawn(g, "cannon", "red", x + 1, y + 3);
    const bal = spawn(g, "ballistae", "red", x + 3, y + 3);
    expect(g._firstStrikeOf(gs, can)).toBeNull();
    expect(g._firstStrikeOf(gs, bal)).toBeNull();
    const hb = spawn(g, "horsebowmen", "red", x + 4, y + 1); // min range 2
    expect(g._firstStrikeOf(f, hb)).toBeNull();
  });
});

describe("charge geometry", () => {
  it("a diagonal step costs its terrain twice; an impassable one is infinite", () => {
    const { g, x, y } = arena();
    const c = spawn(g, "cavalry", "blue", x, y);
    expect(g._chargeStep(c, x, y, x + 1, y, { dx: 1, dy: 0 })).toBe(1);
    expect(g._chargeStep(c, x, y, x + 1, y + 1, { dx: 1, dy: 1 })).toBe(2);
    expect(g._chargeStep(c, x, y, -1, y, { dx: -1, dy: 0 })).toBe(Infinity);
  });

  it("_wouldCharge: only along the charge lane, at a live enemy, while the lane fits the movement", () => {
    const { g, x, y } = arena();
    const c = spawn(g, "cavalry", "blue", x + 2, y + 2);
    const e = spawn(g, "militiamen", "red", x + 3, y + 2);
    const side = spawn(g, "militiamen", "red", x + 2, y + 3);
    const friend = spawn(g, "militiamen", "blue", x + 1, y + 2);
    expect(g._wouldCharge(c, e)).toBe(false); // no gallop yet
    expect(g._chargeState(c)).toBe("idle");
    c.chargeDir = { dx: 1, dy: 0 };
    c.chargeSpent = 2;
    expect(g._wouldCharge(c, e)).toBe(true);
    expect(g._chargeState(c)).toBe("ready");
    expect(g._wouldCharge(c, side)).toBe(false);
    c.chargeDir = { dx: -1, dy: 0 };
    expect(g._wouldCharge(c, friend)).toBe(false);
    c.chargeDir = { dx: 1, dy: 0 };
    c.chargeSpent = 8;
    expect(g._wouldCharge(c, e)).toBe(false);
    expect(g._chargeState(c)).toBe("short");
    c.chargeSpent = 2;
    c.slowed = true;
    expect(g._wouldCharge(c, e)).toBe(false);
    expect(g._chargeState(c)).toBe("idle");
    c.slowed = false;
    e._phantom = true;
    expect(g._wouldCharge(c, e)).toBe(false);
    put2(c, 0, y + 2);
    c.chargeDir = { dx: -1, dy: 0 };
    expect(g._chargeState(c)).toBe("short"); // the tile ahead is off the map
  });

  it("_chargeReaches: a straight (or diagonal) run of 2+ tiles with the foe next along it, within the movement", () => {
    const { g, x, y } = arena();
    const c = spawn(g, "cavalry", "blue", x, y + 2);
    const e = spawn(g, "militiamen", "red", x + 3, y + 2);
    expect(g._chargeReaches(c, x + 2, y + 2, e)).toBe(true);
    expect(g._chargeReaches(c, x + 1, y + 2, e)).toBe(false); // one-tile run (foe not next either)
    expect(g._chargeReaches(c, x, y + 2, e)).toBe(false); // no run
    expect(g._chargeReaches(c, x + 2, y + 3, e)).toBe(false); // not straight
    const c2 = spawn(g, "cavalry", "blue", x + 4, y);
    const d = spawn(g, "militiamen", "red", x + 7, y + 3);
    expect(g._chargeReaches(c2, x + 6, y + 2, d)).toBe(true); // a diagonal lane: 2 + 2 + 2 ≤ 8
    c2.T = { ...c2.T, move: 4 };
    expect(g._chargeReaches(c2, x + 6, y + 2, d)).toBe(false); // 2+2+2 > 4
    expect(g._chargeReaches(spawn(g, "footmen", "blue", x, y), x + 2, y, e)).toBe(false); // no Charge
    const k = spawn(g, "knights", "blue", x, y + 4, { slowed: true });
    expect(g._chargeReaches(k, x + 2, y + 4, e)).toBe(false);
  });
});

function put2(u, x, y) {
  u.tx = x;
  u.ty = y;
}
