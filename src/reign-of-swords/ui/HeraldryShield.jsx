/* ============================================================
   Reign of Swords — heraldry.
   The coat-of-arms shield: heraldic tincture ramps + the game's own extracted
   heraldry art (fields 000-008, symbol charges 009-065) + metallic rank FRAMES,
   composited with a palette-swap filter. Field → frame → symbol z-order.
   ============================================================ */

import { useId } from "react";
import { base } from "./battle-ui.jsx";

// COLOURS ARE THE GAME'S OWN PALETTE, verbatim: the decompiled `com.blacksheep.kingoflands.a.k` table stores each
// tincture as a 3-shade RAMP [light, mid, dark], and the recolour is a palette SWAP — the field art's three blue
// shades (`j` = #0015ff/#000bc6/#00008c) and a symbol's three green shades (`i`) are remapped onto that ramp. So a
// tincture isn't one hex; it's the ramp. `hex` (the light/body shade) is only the picker-swatch colour. Note Argent's
// ramp is white→periwinkle→#7a8bd6 (a blue), which is why a "silver" field reads bluish, exactly as the original.
export const TINCTURES = [
  {
    id: "gules",
    name: "Gules",
    hex: "#ff0a11",
    ramp: [
      [255, 10, 17],
      [185, 20, 24],
      [115, 31, 31],
    ],
  }, // k[3]
  {
    id: "azure",
    name: "Azure",
    hex: "#2e54a6",
    ramp: [
      [46, 84, 166],
      [38, 69, 136],
      [29, 53, 105],
    ],
  }, // k[1]
  {
    id: "or",
    name: "Or",
    hex: "#ffff54",
    ramp: [
      [255, 255, 84],
      [190, 190, 63],
      [125, 125, 41],
    ],
  }, // k[2]
  {
    id: "argent",
    name: "Argent",
    hex: "#fcfcfc",
    ramp: [
      [252, 252, 252],
      [187, 196, 233],
      [122, 139, 214],
    ],
  }, // k[8]
  {
    id: "vert",
    name: "Vert",
    hex: "#33b544",
    ramp: [
      [51, 181, 68],
      [47, 135, 58],
      [42, 89, 47],
    ],
  }, // k[0]
  {
    id: "sable",
    name: "Sable",
    hex: "#4a4848",
    ramp: [
      [74, 72, 72],
      [58, 57, 57],
      [41, 41, 41],
    ],
  }, // k[5]
  {
    id: "purpure",
    name: "Purpure",
    hex: "#9b48cf",
    ramp: [
      [155, 72, 207],
      [124, 58, 165],
      [92, 43, 122],
    ],
  }, // k[4]
  {
    id: "tenne",
    name: "Tenné",
    hex: "#ff7d26",
    ramp: [
      [255, 125, 38],
      [211, 100, 27],
      [166, 75, 15],
    ],
  }, // k[6]
  // The iOS binary's tincture table (ros_ep2 @0x91d54) has TEN ramps: k[7] rose and k[9] cyan were missing here, so a
  // team wearing them fell back to azure/or. Only scenario teams use them (Caladrin Defenders cyan charge, the Wizard's
  // Palace Guard cyan field); the player's picker keeps its eight.
  {
    id: "rose",
    name: "Rose",
    hex: "#d485b8",
    ramp: [
      [212, 133, 184],
      [207, 107, 172],
      [201, 81, 159],
    ],
    npc: true,
  }, // k[7]
  {
    id: "cyan",
    name: "Cyan",
    hex: "#a3faff",
    ramp: [
      [163, 250, 255],
      [95, 193, 199],
      [26, 135, 143],
    ],
    npc: true,
  }, // k[9]
];
// Symbols 068-074 are the game's seven PRE-COLOURED crests (iOS 6360-6366: red fire, willow, black eagle, gold horse,
// gold fleur-de-lis, red three-swords, gold scythe). They are drawn as-is — never palette-swapped.
export const PRECOLOURED_FROM = 68;
// The four REAL heraldry axes (Android screen La/a/h): Background Type, Background Colour, Symbol Type, Symbol
// Colour — from the game's OWN extracted art (public/.../heraldry/000..072.png). Blue pieces 000-008 are the nine
// BACKGROUND fields; the green pieces are the recolourable SYMBOL charges. Each layer is palette-swapped (duotone).
export const BG_TYPES = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // heraldry/000..008 — the background fields
// Symbol charges (heraldry/009..065). 013-017 are field patterns, not charges, so they're skipped.
export const SYMBOLS = [
  9, 10, 11, 12, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65,
];
export const pad3 = (n) => String(n).padStart(3, "0");
export const HERALD_ASSET = (i) => base + "heraldry/" + pad3(i) + ".png";
// The REAL metallic shield FRAMES (game res 6400, extracted misc/007-015) — the rank border rises with the
// player's title. Every frame shares an identical 69×105 shield OPENING (the field art drops in at native size);
// only the offset (ox,oy) within the frame's own canvas differs. Drawn OVER the tinted field, with the symbol charge
// on top of the frame (highest z-index, so it's never covered). tiers 0..5 map to title (Squire→Warden).
// The frames are palette-swapped like the rest of the crest (Context::renderHeraldry, iOS Ep1 @0x10e74; the Android
// port's drawHeraldry): their key GREENS take the symbol colour's ramp (the Emperor's gems, the banneret's banner) and
// their key BLUES the field colour's (the drapes — Carrone's is red). tools/ros/frame_layers.py splits each keyed
// frame into N_base (keys cleared) + N_sym (`sym`, the greens) + N_bg (`bg`, the blues) for the same filters.
export const FRAMES = [
  { i: 0, cw: 87, ch: 123, ox: 9, oy: 9 }, // Squire — plain
  { i: 1, cw: 153, ch: 156, ox: 42, oy: 42 }, // Knight — crossed swords
  { i: 2, cw: 153, ch: 189, ox: 42, oy: 45, sym: true, bg: true }, // Knight Banneret — swords + banner
  { i: 3, cw: 163, ch: 172, ox: 47, oy: 33, bg: true }, // Baron — flanking spears + drape
  { i: 4, cw: 157, ch: 190, ox: 44, oy: 55 }, // Marshal — winged helm
  { i: 5, cw: 163, ch: 194, ox: 47, oy: 59 }, // Warden — winged laurel crest
  { i: 6, cw: 163, ch: 190, ox: 47, oy: 55, sym: true }, // The Emperor — GOLD crowned cartouche (misc/015), gems
  // The two frames of the original nine the tier list never used (iOS 6401-6409 = android misc/007-015 in order):
  { i: 7, cw: 163, ch: 194, ox: 47, oy: 55, bg: true }, // iOS frame 4 — helm + drape (misc/011)
  { i: 8, cw: 163, ch: 193, ox: 47, oy: 58, sym: true }, // iOS frame 7 — winged helm + laurel (misc/014), gems
];
// A scenario team's heraldry BANNER byte is the frame index of the original's nine frames; map it onto FRAMES above
// (whose order follows the player rank tiers): iOS 0..8 → 0,1,2,3,7,4,5,8,6.
export const BANNER_TO_FRAME = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 7, 5: 4, 6: 5, 7: 8, 8: 6 };
// A faction's full crest, keyed by the REAL heraldry banner index (scenario group attrs[4]) — user-confirmed
// from the game: Rebel gold fleur on blue with crossed swords; Carrone gold eagle on red with banner+swords;
// Duke Pellus gold axe on blue in the silver ornate frame; the Emperor white eagle on purple in the gold crown
// frame. bgColor/symbolColor are TINCTURE ids, symbol is a heraldry-charge index, frame is a FRAMES index.
export const BANNER_HERALDRY = {
  1: { bgColor: "azure", bgType: 0, symbol: 66, symbolColor: "or", frame: 1 }, // Rebel Army — fleur, crossed swords
  2: { bgColor: "gules", bgType: 0, symbol: 35, symbolColor: "or", frame: 2 }, // Carrone Army — eagle, banner+swords
  7: { bgColor: "azure", bgType: 0, symbol: 63, symbolColor: "or", frame: 5 }, // Duke Pellus — axe, silver ornate
  8: { bgColor: "purpure", bgType: 0, symbol: 35, symbolColor: "argent", frame: 6 }, // The Emperor — eagle, gold crown
};
// A faction's full crest keyed by GROUP NAME (case-insensitive substring), for factions whose scenario banner
// index is the generic 0 (no BANNER_HERALDRY entry) but that DO have a real coat of arms in the original. Aguilleon
// Gate = a sable (black) eagle on an Or (gold) field, plain frame — user-confirmed from the game art (image 9). #17
export const FACTION_CREST = {
  aguilleon: { bgColor: "or", bgType: 0, symbol: 35, symbolColor: "sable", frame: 0 },
};
export function factionCrest(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  for (const k in FACTION_CREST) if (key.includes(k)) return FACTION_CREST[k];
  return null;
}
export const FRAME_ASSET = (i) => base + "heraldry/frames/" + i + ".png";
const FRAME_LAYER = (i, layer) => base + "heraldry/frames/" + i + "_" + layer + ".png";
export const FRAME_OPEN_W = 69,
  FRAME_OPEN_H = 105; // the shield opening every frame is built around (native field size)

// The ORIGINAL recolour (decompiled `com.blacksheep.kingoflands.a`): a 3-shade PALETTE SWAP. The field art is drawn
// in three blue shades (`j` = #0015ff body / #000bc6 mid / #00008c division) and a symbol in three greens (`i` =
// #00d40b / #00a606 / #007800); each source shade is remapped to the matching shade of the chosen tincture RAMP
// (the game's `k[]`). We grab the field's blue channel (or a symbol's green) as intensity, then map it across the
// ramp with the source shades at their real positions — so the pattern keeps its three tones in the new colour.
export function paletteTint(uniqueId, ramp, chan) {
  const grab =
    chan === "b" ? "0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 1 0" : "0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0";
  const S = chan === "b" ? [0.549, 0.776, 1.0] : [0.471, 0.651, 0.831]; // dark / mid / light source intensities (j blue, i green)
  const [srcDark, srcMid, srcLight] = S;
  const channelAt = (dark, mid, light, pos) => {
    // source intensity p → tincture channel (0..1)
    if (pos <= 0) return 0;
    if (pos <= srcDark) return dark * (pos / srcDark); // anti-aliased edge below the darkest shade → fade to black
    if (pos <= srcMid) return dark + (mid - dark) * ((pos - srcDark) / (srcMid - srcDark));
    if (pos <= srcLight) return mid + (light - mid) * ((pos - srcMid) / (srcLight - srcMid));
    return light;
  };
  const STEPS = 12;
  const table = (ci) =>
    Array.from({ length: STEPS }, (_, m) =>
      channelAt(ramp[2][ci] / 255, ramp[1][ci] / 255, ramp[0][ci] / 255, m / (STEPS - 1)).toFixed(3),
    ).join(" ");
  return (
    <filter id={uniqueId} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={grab} />
      <feComponentTransfer>
        <feFuncR type="table" tableValues={table(0)} />
        <feFuncG type="table" tableValues={table(1)} />
        <feFuncB type="table" tableValues={table(2)} />
      </feComponentTransfer>
    </filter>
  );
}
// framed=true composites the real metallic rank FRAME around the tinted field (the coat of arms as the game shows
// it); framed=false renders just the field (+symbol) at native aspect — used for the small picker swatches. In
// BOTH, layer order is field → frame → symbol, so the charge sits on the highest z-index and is never covered.
export function HeraldryShield({ heraldry, tier = 0, size = 200, framed = true, frame }) {
  const uniqueId = useId().replace(/:/g, "");
  const bgTincture = TINCTURES.find((t) => t.id === heraldry.bgColor) || TINCTURES[1];
  const symT = TINCTURES.find((t) => t.id === heraldry.symbolColor) || TINCTURES[2];
  const bgIdx = typeof heraldry.bgType === "number" ? heraldry.bgType : 0;
  // symbol 0 = NO charge (the scenario's device byte 0xff; export_levels.py stores it as 0). Asset 000 is the plain
  // FIELD shape, not a charge — drawing it as the symbol layer painted a solid symbol-coloured shield over the field
  // (Bordavia's Valamir Vanguard showed a flat blue shield instead of its plain gules arms).
  const symIdx = typeof heraldry.symbol === "number" && heraldry.symbol > 0 ? heraldry.symbol : null;
  // Small crests (pickers, the resource-bar badge) stay compact on the PLAIN frame; the ornate rank frames only
  // read well at the larger preview size, so clamp them below a threshold. `frame` forces a specific frame index
  // (faction crests at small size, e.g. the turn banner); otherwise the rank tier clamps small crests to plain.
  const frameIdx =
    typeof frame === "number"
      ? Math.max(0, Math.min(FRAMES.length - 1, frame))
      : Math.max(0, Math.min(FRAMES.length - 1, size < 72 ? 0 : typeof tier === "number" ? tier : 0));
  const defs = (
    <defs>
      {paletteTint("bt" + uniqueId, bgTincture.ramp, "b")}{" "}
      {/* field: the game's real 3-shade palette swap onto the tincture ramp */}
      {paletteTint("st" + uniqueId, symT.ramp, "g")} {/* symbol: same swap on the green charge art */}
    </defs>
  );
  if (!framed) {
    const width = size,
      height = size * (FRAME_OPEN_H / FRAME_OPEN_W); // native 69×105 shield aspect
    return (
      <svg
        viewBox={`0 0 ${FRAME_OPEN_W} ${FRAME_OPEN_H}`}
        width={width}
        height={height}
        className="ros-shield"
        role="img"
        aria-label="Your heraldry"
      >
        {defs}
        <image
          href={HERALD_ASSET(bgIdx)}
          x="0"
          y="0"
          width={FRAME_OPEN_W}
          height={FRAME_OPEN_H}
          filter={`url(#bt${uniqueId})`}
        />
        {symIdx != null && (
          <image
            href={HERALD_ASSET(symIdx)}
            x="0"
            y="0"
            width={FRAME_OPEN_W}
            height={FRAME_OPEN_H}
            filter={symIdx >= PRECOLOURED_FROM ? undefined : `url(#st${uniqueId})`}
          />
        )}
      </svg>
    );
  }
  const frameDef = FRAMES[frameIdx];
  const width = size,
    height = size * (frameDef.ch / frameDef.cw); // fit the whole frame to width = size
  return (
    <svg
      viewBox={`0 0 ${frameDef.cw} ${frameDef.ch}`}
      width={width}
      height={height}
      className="ros-shield"
      role="img"
      aria-label="Your heraldry"
    >
      {defs}
      <image
        href={HERALD_ASSET(bgIdx)}
        x={frameDef.ox}
        y={frameDef.oy}
        width={FRAME_OPEN_W}
        height={FRAME_OPEN_H}
        filter={`url(#bt${uniqueId})`}
      />
      <image
        href={frameDef.sym || frameDef.bg ? FRAME_LAYER(frameDef.i, "base") : FRAME_ASSET(frameDef.i)}
        x="0"
        y="0"
        width={frameDef.cw}
        height={frameDef.ch}
      />
      {frameDef.bg && (
        <image
          href={FRAME_LAYER(frameDef.i, "bg")}
          x="0"
          y="0"
          width={frameDef.cw}
          height={frameDef.ch}
          filter={`url(#bt${uniqueId})`}
        />
      )}
      {frameDef.sym && (
        <image
          href={FRAME_LAYER(frameDef.i, "sym")}
          x="0"
          y="0"
          width={frameDef.cw}
          height={frameDef.ch}
          filter={`url(#st${uniqueId})`}
        />
      )}
      {symIdx != null && (
        <image
          href={HERALD_ASSET(symIdx)}
          x={frameDef.ox}
          y={frameDef.oy}
          width={FRAME_OPEN_W}
          height={FRAME_OPEN_H}
          filter={symIdx >= PRECOLOURED_FROM ? undefined : `url(#st${uniqueId})`}
        />
      )}
    </svg>
  );
}
