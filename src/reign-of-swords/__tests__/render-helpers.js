// Helpers for the renderer tests (render/render.js): a RECORDING 2D context that logs every draw call together with the
// style in force when it was made, and fake image assets shaped like the ones the game loads (objects with a width and
// height — the renderer only reads those and hands them to drawImage).
import { UNIT_TYPES } from "../data/game-data.js";

const STYLE_KEYS = {
  fillStyle: "#000000",
  strokeStyle: "#000000",
  globalAlpha: 1,
  font: "10px sans-serif",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  textAlign: "start",
  textBaseline: "alphabetic",
  imageSmoothingEnabled: true,
  globalCompositeOperation: "source-over",
};

// A canvas 2D context that records. `omit` lists methods the context should NOT have (e.g. "roundRect", to drive the
// renderer's fallback for browsers without it).
export function recCtx({ omit = [] } = {}) {
  const log = [];
  const state = { ...STYLE_KEYS };
  const stack = [];
  let dash = [];
  const own = {
    save() {
      stack.push({ ...state, __dash: dash });
    },
    restore() {
      const s = stack.pop();
      if (s) {
        dash = s.__dash;
        delete s.__dash;
        Object.assign(state, s);
      }
    },
    setLineDash(d) {
      dash = d.slice();
    },
    getLineDash() {
      return dash.slice();
    },
    measureText(t) {
      return { width: String(t).length * 7 };
    },
  };
  const proxy = new Proxy(own, {
    get(t, k) {
      if (typeof k === "symbol" || k === "then" || k === "toJSON") return undefined;
      if (k === "log") return log;
      if (k === "state") return state;
      if (k in state) return state[k];
      if (omit.includes(k)) return undefined;
      return (...args) => {
        log.push({
          op: k,
          args,
          fill: state.fillStyle,
          stroke: state.strokeStyle,
          alpha: state.globalAlpha,
          font: state.font,
          lineWidth: state.lineWidth,
          comp: state.globalCompositeOperation,
          dash: dash.slice(),
        });
        return own[k] ? own[k](...args) : undefined;
      };
    },
    set(t, k, v) {
      state[k] = v;
      return true;
    },
  });
  return proxy;
}

export const ops = (ctx, op) => ctx.log.filter((e) => e.op === op);
export const texts = (ctx) => ops(ctx, "fillText").map((e) => e.args[0]);
export const textCall = (ctx, s) => ops(ctx, "fillText").find((e) => e.args[0] === s);
export const hasText = (ctx, re) => texts(ctx).some((t) => (re instanceof RegExp ? re.test(String(t)) : t === re));
// every fill/stroke made in the given colour
export const filledWith = (ctx, color, op = "fillRect") => ops(ctx, op).filter((e) => e.fill === color);
export const strokedWith = (ctx, color, op = "stroke") => ops(ctx, op).filter((e) => e.stroke === color);
// drawImage calls whose source is `img`
export const drewImage = (ctx, img) => ops(ctx, "drawImage").filter((e) => e.args[0] === img);
export const clear = (ctx) => (ctx.log.length = 0);

export const img = (width, height, name = "img") => ({ width, height, name });

// Lazily-built maps (`fx.anything`, `sheets.anyType`) so every unit / effect has art.
function lazy(make) {
  const cache = {};
  return new Proxy(cache, {
    get(t, k) {
      if (typeof k !== "string") return undefined;
      if (!(k in t)) t[k] = make(k);
      return t[k];
    },
    has: () => true,
  });
}

// The asset bag the game hands Game (ui/ReignOfSwords.jsx), with fake images. `without` drops whole entries
// (e.g. ["tileset", "flags"]); `fxWithout` / `projWithout` drop single strips.
export function fakeAssets({
  without = [],
  fxWithout = [],
  proj = null,
  arrows = null,
  stands = true,
  walks = true,
} = {}) {
  const a = {
    tileset: img(260 * 40, 55, "tileset"),
    fx: lazy((k) => (fxWithout.includes(k) ? undefined : img(2000, 200, "fx:" + k))),
    sheets: lazy((k) => ({ blue: img(400, 96, "sheet:" + k + ":blue"), red: img(400, 96, "sheet:" + k + ":red") })),
    stands: stands ? lazy((k) => (k === "king" || !UNIT_TYPES[k] ? undefined : img(64, 72, "stand:" + k))) : undefined,
    walks: walks
      ? lazy((k) => ({ blue: img(256, 72, "walk:" + k + ":blue"), red: img(256, 72, "walk:" + k + ":red") }))
      : undefined,
    statusIcons: img(13 * 52, 52, "status"),
    flags: img(192, 88, "flags"),
    proj: proj || {
      stone: img(120, 40, "stone"),
      cannonball: img(32, 32, "cannonball"),
      bolt: img(18 * 36, 36, "bolt"),
      hammerA: img(88, 22, "hammerA"),
      hammerB: img(88, 22, "hammerB"),
      fireball: img(320, 64, "fireball"),
      spellbolt: img(140, 28, "spellbolt"),
      spellbolt2: img(140, 28, "spellbolt2"),
      bullet: img(32, 32, "bullet"),
    },
    arrows: arrows || { normal: img(48, 48, "arrow"), fire: img(48, 48, "firearrow") },
  };
  for (const k of without) delete a[k];
  return a;
}

// Give a test game a recording context + fake art. Returns the context.
export function rig(g, opts = {}) {
  const ctx = recCtx(opts.ctx);
  g.ctx = ctx;
  g.assets = opts.assets || fakeAssets(opts);
  return ctx;
}
