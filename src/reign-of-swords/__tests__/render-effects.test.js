// Renderer — what flies and flashes over the field: sprite-strip effects (every FX_TYPES entry), projectiles of every
// kind (sprite and procedural fallback), debris/smoke/shockwave particles and the damage / word floaters.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { loadEpisode, makeGame, startBattle, spawn, only, put, step } from "./battle.js";
import { rig, ops, texts, drewImage, clear, fakeAssets, img } from "./render-helpers.js";
import { FX_TYPES } from "../data/game-data.js";
import { setGameLang } from "../i18n/i18n.js";

beforeAll(() => loadEpisode(2));
afterEach(() => setGameLang("en"));

let shared = null;
function game() {
  if (!shared) {
    shared = makeGame(5428);
    startBattle(shared);
  }
  shared.assets = fakeAssets();
  return shared;
}

describe("sprite-strip effects (_drawFx)", () => {
  for (const [name, T] of Object.entries(FX_TYPES))
    it(`${name}: plays frame ${T.f0 || 0}+⌊p·${T.frames}⌋ of its strip, centred and scaled on the spot`, () => {
      const g = game();
      const ctx = rig(g, { assets: g.assets });
      const e = { name, x: 120, y: 80, t: 0.05 + T.dur * 0.5, delay: 0.05, scale: 2 };
      g.renderer._drawFx(ctx, e);
      const fi = Math.min(T.frames - 1, Math.floor(0.5 * T.frames));
      const draws = drewImage(ctx, g.assets.fx[name]);
      const s = 2 * (T.scale || 1) * (g.tile / 64);
      expect(draws[0].args.slice(1, 5)).toEqual([((T.f0 || 0) + fi) * T.frameW, 0, T.frameW, T.frameH]);
      expect(draws[0].args[7]).toBeCloseTo(T.frameW * s);
      expect(ops(ctx, "translate")[0].args).toEqual([120, 80]);
      // a `smooth` strip cross-fades into the next frame by the fractional progress
      if (T.smooth && fi < T.frames - 1) {
        const frac = 0.5 * T.frames - fi;
        expect(draws).toHaveLength(2);
        expect(draws[1].args[1]).toBe(((T.f0 || 0) + fi + 1) * T.frameW);
        expect(draws[0].alpha).toBeCloseTo(1 - frac);
        expect(draws[1].alpha).toBeCloseTo(frac);
      } else expect(draws).toHaveLength(1);
    });

  it("waits out its delay, stops once played, and needs its strip", () => {
    const g = game();
    const ctx = rig(g, { assets: fakeAssets({ fxWithout: ["impact"] }) });
    g.renderer._drawFx(ctx, { name: "slash", x: 0, y: 0, t: 0.1, delay: 0.2 });
    g.renderer._drawFx(ctx, { name: "slash", x: 0, y: 0, t: FX_TYPES.slash.dur, delay: 0 });
    g.renderer._drawFx(ctx, { name: "impact", x: 0, y: 0, t: 0.1, delay: 0 });
    expect(ctx.log).toHaveLength(0);
    g.assets = {}; // no fx bag at all
    g.renderer._drawFx(ctx, { name: "slash", x: 0, y: 0, t: 0.1, delay: 0 });
    expect(ctx.log).toHaveLength(0);
  });

  it("rotates to its angle, mirrors when flipped, and fades over the last fifth", () => {
    const g = game();
    const ctx = rig(g, { assets: g.assets });
    const T = FX_TYPES.grapeshot;
    g.renderer._drawFx(ctx, { name: "grapeshot", x: 0, y: 0, t: T.dur * 0.9, delay: 0, angle: 1.25, flip: true });
    expect(ops(ctx, "rotate")[0].args).toEqual([1.25]);
    expect(ops(ctx, "scale")[0].args).toEqual([-1, 1]);
    expect(ops(ctx, "drawImage")[0].alpha).toBeCloseTo(0.5);
    // the last frame of a smooth strip has nothing to fade into: one draw
    clear(ctx);
    const A = FX_TYPES.arcane_in;
    g.renderer._drawFx(ctx, { name: "arcane_in", x: 0, y: 0, t: A.dur * 0.99, delay: 0 });
    expect(ops(ctx, "drawImage")).toHaveLength(1);
    expect(ops(ctx, "drawImage")[0].args[1]).toBe((A.f0 + A.frames - 1) * A.frameW);
    expect(ops(ctx, "rotate")).toHaveLength(0);
  });

  it("an effect the engine spawns (spawnFx) is drawn by the frame", () => {
    const g = game();
    g.fx = [];
    const ctx = rig(g, { assets: g.assets });
    g.spawnFx("sigil", 30, 40, { delay: 0 });
    g.fx[0].t = 0.1;
    g.renderer.render();
    expect(drewImage(ctx, g.assets.fx.sigil)).toHaveLength(1);
    g.fx = [];
  });
});

describe("projectiles (_drawProjectile)", () => {
  const P = (o) => ({ x: 0, y: 0, tx: 100, ty: 0, t: 0.5, dur: 1, arc: 0, spin: 0, ...o });

  it("flies the parabola: position along the line, lifted by 4·arc·f(1−f)", () => {
    const g = game();
    const ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "arrow", arc: 20, t: 0.25 }));
    expect(ops(ctx, "translate")[0].args).toEqual([25, 0 - 4 * 20 * 0.25 * 0.75]);
    // heading along the arc: climbing at the start of a lob
    expect(ops(ctx, "rotate")[0].args[0]).toBeLessThan(0);
  });

  it("stone: the 3-frame tumble strip, or a procedural boulder", () => {
    const g = game();
    let ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "stone", t: 0.9 }));
    expect(drewImage(ctx, g.assets.proj.stone)[0].args[1]).toBe(2 * 40);
    ctx = rig(g, { without: ["proj"] });
    g.renderer._drawProjectile(ctx, P({ kind: "stone", spin: undefined }));
    expect(ops(ctx, "fill").map((e) => e.fill)).toEqual(["#6f665c", "rgba(255,255,255,0.16)"]);
    expect(ops(ctx, "lineTo")).toHaveLength(6);
  });

  it("ballista bolt: picks the direction frame from the heading (up = 4, flat right = 17, down = 13)", () => {
    const g = game();
    const frame = (o) => {
      const ctx = rig(g, { assets: g.assets });
      g.renderer._drawProjectile(ctx, P({ kind: "bolt", ...o }));
      return drewImage(ctx, g.assets.proj.bolt)[0].args[1] / 36;
    };
    expect(frame({ x: 0, y: 100, tx: 0, ty: 0 })).toBe(4);
    expect(frame({})).toBe(17);
    expect(frame({ x: 0, y: 0, tx: 0, ty: 100 })).toBe(13);
    expect(frame({ x: 100, y: 0, tx: 0, ty: 0 })).toBe(9); // flat left (+180°)
    const ctx = rig(g, { proj: {} });
    g.renderer._drawProjectile(ctx, P({ kind: "bolt" }));
    expect(ops(ctx, "stroke")[0].stroke).toBe("#3fd8d8");
  });

  it("thrown hammer: two 4-frame sheets played as one 8-frame spin, or a spinning wedge", () => {
    const g = game();
    let ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "hammer", t: 0.1 })); // spin 1 → sheet A frame 1
    g.renderer._drawProjectile(ctx, P({ kind: "hammer", t: 0.3 })); // spin 4 → sheet B frame 0
    expect(drewImage(ctx, g.assets.proj.hammerA)[0].args[1]).toBe(22);
    expect(drewImage(ctx, g.assets.proj.hammerB)[0].args[1]).toBe(0);
    ctx = rig(g, { proj: { hammerA: img(88, 22) } }); // half the art → the wedge
    g.renderer._drawProjectile(ctx, P({ kind: "hammer", spin: undefined }));
    expect(ops(ctx, "fillRect").map((e) => e.fill)).toEqual(["#8a8f98", "#c9ccd2"]);
  });

  it("cannon ball: the iron-ball sprite", () => {
    const g = game();
    const ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "ball", cannon: true, spin: undefined }));
    expect(drewImage(ctx, g.assets.proj.cannonball)).toHaveLength(1);
  });

  it("wizard spells: rotating fireball, lightning and ice bolts, each with its glow", () => {
    const g = game();
    const ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "ball", t: 0.1, spin: undefined })); // spell defaults to fireball
    g.renderer._drawProjectile(ctx, P({ kind: "ball", spell: "lightning", t: 0.5 }));
    g.renderer._drawProjectile(ctx, P({ kind: "ball", spell: "ice", t: 0.5, ang: 0.3 }));
    const fb = drewImage(ctx, g.assets.proj.fireball)[0];
    expect(fb.args.slice(1, 5)).toEqual([(Math.floor(0.1 * 22) % 5) * 64, 0, 64, 64]);
    expect(drewImage(ctx, g.assets.proj.spellbolt2)[0].args[1]).toBe(2 * 28);
    expect(drewImage(ctx, g.assets.proj.spellbolt)).toHaveLength(1);
    expect(ops(ctx, "fill").map((e) => e.fill)).toEqual([
      "rgba(255,150,44,0.55)",
      "rgba(210,235,255,0.6)",
      "rgba(120,200,255,0.6)",
    ]);
    expect(ops(ctx, "rotate").at(-1).args).toEqual([0.3]);
  });

  it("a spell with no art is a small dark orb (and a cannon ball with no art falls back to it)", () => {
    const g = game();
    const ctx = rig(g, { proj: {} });
    g.renderer._drawProjectile(ctx, P({ kind: "ball", spell: "ice" }));
    g.renderer._drawProjectile(ctx, P({ kind: "ball", cannon: true }));
    expect(ops(ctx, "fill").map((e) => e.fill)).toEqual(["#0d1117", "#0d1117"]);
  });

  it("musket ball: a tracer streak behind the pellet sprite, or a bright pellet", () => {
    const g = game();
    let ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "bullet" }));
    expect(ops(ctx, "stroke")[0].stroke).toBe("rgba(255,228,150,0.95)");
    expect(drewImage(ctx, g.assets.proj.bullet)).toHaveLength(1);
    ctx = rig(g, { proj: {} });
    g.renderer._drawProjectile(ctx, P({ kind: "bullet", ang: 1 }));
    expect(ops(ctx, "fill")[0].fill).toBe("#f2d98c");
  });

  it("arrows: the in-flight sprite (fire arrows with an ember), or a plain line", () => {
    const g = game();
    let ctx = rig(g, { assets: g.assets });
    g.renderer._drawProjectile(ctx, P({ kind: "arrow" }));
    g.renderer._drawProjectile(ctx, P({ kind: "arrow", fire: true }));
    expect(drewImage(ctx, g.assets.arrows.normal)).toHaveLength(1);
    expect(drewImage(ctx, g.assets.arrows.fire)).toHaveLength(1);
    expect(ops(ctx, "fill")[0].fill).toBe("rgba(255,150,44,0.75)");
    ctx = rig(g, { without: ["arrows"] });
    g.renderer._drawProjectile(ctx, P({ kind: "arrow" }));
    g.renderer._drawProjectile(ctx, P({ kind: "arrow", fire: true }));
    expect(ops(ctx, "stroke").map((e) => e.stroke)).toEqual(["#cdb488", "#ff9a3c"]);
  });

  it("a real archer's shot is drawn in flight by the frame", () => {
    const g = makeGame(5428);
    startBattle(g);
    const a = spawn(g, "archers", "blue", 2, 2, { acted: false });
    const m = spawn(g, "militiamen", "red", 2, 5);
    const keep = spawn(g, "militiamen", "red", 12, 12);
    const mine = spawn(g, "militiamen", "blue", 14, 14);
    only(g, a, m, keep, mine);
    put(g, a, 2, 2);
    put(g, m, 2, 5);
    const ctx = rig(g);
    g.select(a);
    g.click({ tx: m.tx, ty: m.ty });
    for (let i = 0; i < 200 && !g.projectiles.length; i++) step(g);
    expect(g.projectiles.length).toBeGreaterThan(0);
    clear(ctx);
    g.renderer.render();
    expect(drewImage(ctx, g.assets.arrows.normal).length + drewImage(ctx, g.assets.arrows.fire).length).toBe(1);
  });
});

describe("particles (_drawParticle)", () => {
  it("a shockwave ring grows and fades", () => {
    const g = game();
    const ctx = rig(g);
    g.renderer._drawParticle(ctx, { ring: true, t: 0.5, life: 1, x: 10, y: 20, rMax: 40 });
    const arc = ops(ctx, "arc")[0];
    expect(arc.args.slice(0, 3)).toEqual([10, 20, 40 * (0.2 + 0.8 * 0.5)]);
    expect(ops(ctx, "stroke")[0]).toMatchObject({ stroke: "#efe2bf", alpha: 0.5 * 0.55 });
    expect(ctx.state.globalAlpha).toBe(1);
  });
  it("a smoke puff swells as it rises", () => {
    const g = game();
    const ctx = rig(g);
    g.renderer._drawParticle(ctx, { smoke: true, t: 0.5, life: 1, x: 0, y: 0, r: 10 });
    expect(ops(ctx, "arc")[0].args[2]).toBeCloseTo(10 * 1.7);
    expect(ops(ctx, "fill")[0].fill).toBe("#5b544c");
  });
  it("a debris chunk shrinks in its own colour; one not yet born is not drawn", () => {
    const g = game();
    const ctx = rig(g);
    g.renderer._drawParticle(ctx, { t: -0.1, life: 1, x: 0, y: 0, r: 5, color: "#123456" });
    expect(ctx.log).toHaveLength(0);
    g.renderer._drawParticle(ctx, { t: 0.25, life: 1, x: 0, y: 0, r: 5, color: "#123456" });
    expect(ops(ctx, "fill")[0]).toMatchObject({ fill: "#123456", alpha: 0.75 });
    expect(ops(ctx, "arc")[0].args[2]).toBeCloseTo(5 * (0.6 + 0.4 * 0.75));
  });
});

describe("floaters (_drawFloater)", () => {
  it("damage reads '-N' in white, a crit larger in gold, a heal '+'-less in green — all fading out", () => {
    const g = game();
    const ctx = rig(g);
    g.renderer._drawFloater(ctx, { x: 1, y: 2, t: 0.25, life: 1, text: 12 });
    g.renderer._drawFloater(ctx, { x: 1, y: 2, t: 0, life: 1, text: 30, crit: true });
    g.renderer._drawFloater(ctx, { x: 1, y: 2, t: 0, life: 1, text: "+20", heal: true });
    const f = ops(ctx, "fillText");
    expect(f.map((e) => e.args[0])).toEqual(["-12", "-30", "+20"]);
    expect(f.map((e) => e.fill)).toEqual(["#ffffff", "#ffca6b", "#7be08a"]);
    expect(f[0].alpha).toBe(0.75);
    expect(f[1].font).toMatch(/16px/);
    expect(f[0].font).toMatch(/13px/);
    expect(ctx.state.globalAlpha).toBe(1);
  });
  it("word floaters are translated into the game language", () => {
    const g = game();
    const ctx = rig(g);
    setGameLang("uk");
    g.renderer._drawFloater(ctx, { x: 0, y: 0, t: 0, life: 1, text: "Deviated!", heal: true });
    expect(texts(ctx)).toEqual(["Відхилення!"]);
  });
});
