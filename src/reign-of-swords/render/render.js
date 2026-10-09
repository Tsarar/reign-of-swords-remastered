/* ============================================================
   Reign of Swords — battlefield rendering.
   The Game canvas draw pass: terrain, deploy overlay, units + HP, projectiles,
   particles/bolts/FX, move/attack intents, minimap, and the unit-colour logic
   they lean on. The Renderer is its own object (game.renderer): it READS the battle
   through this.game — state and the rules' queries (damage forecasts, reach, terrain) —
   and keeps only its own caches. Nothing in the battle depends on it.
   ============================================================ */
import { key, manhattan, rgbHue, hslToRgb, shownDamage, shownHp, healStep } from "../util/util.js";
import { tr } from "../i18n/i18n.js";

import { tileProp, tileCell, tileCellH, tileCategory } from "../rules/terrain.js";

import {
  UNIT_TYPES,
  FX_TYPES,
  TALL_TILES,
  BANNER_TINCTURE,
  TINCTURE_RGB,
  factionHeraldry,
  UNIT_KEY_PRIMARY,
  UNIT_KEY_SECONDARY,
  UNIT_RAMPS,
} from "../data/game-data.js";

// Walk-strip frame dimensions (android walk sheets: 4 frames of 64×72), used by _drawUnit's march animation.
const WALK_FRAMES = 4,
  WALK_W = 64,
  WALK_H = 72;
// Recoloured sprite canvases, shared by every battle of the session (the asset images are shared too — engine/engine.js).
const RECOLOR_CACHE = {};
const UNIT_REF_PX = 64; // unit-art pixels per tile (a footman stands 64 px tall)
const GRASS_TILE = 63; // the plain grass tile value — the ground drawn under every cell
const TERRAIN_OVERLAP = 2; // px each terrain cell is drawn oversized on every side, so no hairline seams show (_terrainGeometry)

export class Renderer {
  constructor(game) {
    this.game = game;
    this._cursorKind = ""; // the canvas cursor last set (_updateCursor)
    this._capRegions = null; // cached capture-area outlines (_objectiveRegions)
    this._objRegions = null;
  }

  render() {
    const g = this.game.ctx;
    g.setTransform(this.game.dpr, 0, 0, this.game.dpr, 0, 0);
    // off-map ground colour behind everything
    g.fillStyle = "#141821";
    g.fillRect(0, 0, this.game.view.w, this.game.view.h);
    g.save();
    g.translate(-Math.round(this.game.cam.x), -Math.round(this.game.cam.y));
    this._drawTerrain(g);
    this._drawObjectives(g);
    // Tutorials call the assembly area "the green square" in their dialogue; 5800 "Movement" pre-draws the
    // column and skips deploy, so mark the assembly zone green under the units in battle too, to match.
    // Only the MOVEMENT drill (5800) has a real assembly "green" to keep showing in battle. Don't fall back to
    // the deploy zone — a deployment tutorial's yellow blocks must disappear once the muster phase is over.
    if (
      this.game.mission &&
      this.game.mission.group === "special" &&
      this.game.phase !== "deploy" &&
      this.game.tutZone &&
      this.game.tutZone.size
    )
      this._drawTutorialZone(g);
    if (this.game.phase === "deploy") this._drawDeploy(g);
    this._drawOverlays(g);
    const list = this.game.units.filter((u) => !this.game.hsMusterHidden(u)).sort((a, b) => a.py - b.py);
    for (const u of list) this._drawUnit(g, u);
    this._drawTargetNumbers(g); // damage/charge forecast ON TOP of the sprites (never hidden behind one)
    for (const shot of this.game.projectiles) this._drawProjectile(g, shot);
    if (this.game.fx) for (const e of this.game.fx) this._drawFx(g, e);
    if (this.game.particles) for (const particle of this.game.particles) this._drawParticle(g, particle);
    if (this.game.bolts) for (const b of this.game.bolts) this.game._drawBolt(g, b);
    for (const floater of this.game.floaters) this._drawFloater(g, floater);
    this._drawStructureBars(g); // damaged buildings / walls: how much of the current stage is left
    this._drawFieldLabels(g); // field labels (Conjurer's minion count) sit ABOVE every sprite & effect
    g.restore();
    this._drawMinimap(g);
  }

  // LEASH TETHERS (Ep2 Conjure): select or hover a Conjurer or one of its minions and a purple dashed tether links the
  // Conjurer to each minion it controls, with the leash distance at the minion ("leash 5/8", red once past 8 — that
  // minion dies at the end of its side's turn, help 592). With several Conjurers on the field this is how you tell
  // whose minion is whose.
  _drawLeashTethers(g) {
    const hovered = this.game.hover ? this.game.unitAt(this.game.hover.tx, this.game.hover.ty) : null;
    const focusIds = new Set();
    for (const focus of [this.game.selected, hovered]) {
      if (!focus || focus.dead) continue;
      if (focus._conjuredBy != null) focusIds.add(focus._conjuredBy);
      else if (focus.T && focus.T.conjure) focusIds.add(focus.id);
    }
    if (!focusIds.size) return;
    const tile = this.game.tile,
      centerOf = (u) => [u.px + tile / 2, u.py + tile * 0.55];
    for (const id of focusIds) {
      const conjurer = this.game.units.find((o) => !o.dead && o.id === id);
      const kids = this.game.units.filter((o) => !o.dead && o._conjuredBy === id);
      if (!conjurer || !kids.length) continue;
      const [x0, y0] = centerOf(conjurer);
      g.save();
      g.lineWidth = 2.5;
      g.setLineDash([6, 5]);
      g.lineCap = "round";
      for (const k of kids) {
        const [x1, y1] = centerOf(k),
          dist = manhattan(k, conjurer),
          over = dist > 8;
        g.strokeStyle = over ? "rgba(235,80,80,0.9)" : "rgba(190,120,255,0.85)";
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = over ? "rgba(235,80,80,0.95)" : "rgba(190,120,255,0.95)";
        g.beginPath();
        g.arc(x1, y1, 4, 0, 6.29);
        g.fill();
        const txt = tr("leash") + " " + dist + "/8";
        g.font = "bold 10px system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "top";
        const textW = g.measureText(txt).width + 8,
          labelY = k.py + tile + 1;
        g.fillStyle = "rgba(20,10,30,0.8)";
        g.fillRect(x1 - textW / 2, labelY, textW, 13);
        g.fillStyle = over ? "#ff9b9b" : "#e2c8ff";
        g.fillText(txt, x1, labelY + 1);
        g.setLineDash([6, 5]);
      }
      g.setLineDash([]);
      g.strokeStyle = "rgba(190,120,255,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x0, y0, 7, 0, 6.29);
      g.stroke(); // the owner
      g.restore();
    }
  }

  // Labels that must read over EVERYTHING on the field — drawn last, after units, FX and floaters (a unit standing
  // above the Conjurer's "minions n/2" count would otherwise hide it).
  // A thin health bar over every DAMAGED structure (its stage HP out of 256), plus — while a unit that can shoot
  // structures hovers one in range — the bar of that target, intact ones included, so you can see what a shot does.
  // (A recreation read-out: the original shows only the tile art changing.)
  _drawStructureBars(g) {
    if (!this.game.structHp) return;
    const tile = this.game.tile,
      cells = [];
    for (const k of this.game.structHp.keys()) {
      const [x, y] = k.split(",").map(Number);
      const health = this.game.structureHealth(x, y);
      if (health != null) cells.push([x, y, health]);
    }
    const sel = this.game.selected,
      hover = this.game.hover;
    if (
      sel &&
      hover &&
      this.game.phase === "player" &&
      !sel.acted &&
      !this.game.structHp.has(key(hover.tx, hover.ty)) &&
      this.game.canHitStructure(sel, hover.tx, hover.ty)
    )
      cells.push([hover.tx, hover.ty, 1]);
    for (const [x, y, health] of cells) {
      const barW = tile * 0.62,
        barX = x * tile + (tile - barW) / 2,
        barY = y * tile + 2;
      g.fillStyle = "rgba(12,10,6,0.78)";
      g.fillRect(barX - 1, barY - 1, barW + 2, 6);
      g.fillStyle = health > 0.5 ? "#e0b050" : health > 0.2 ? "#e07a30" : "#d8452e";
      g.fillRect(barX, barY, Math.max(1, barW * health), 4);
    }
  }
  _drawFieldLabels(g) {
    if (!(
      this.game.aimMode &&
      this.game._abilityAim &&
      this.game.selected &&
      this.game._abilityAim.startsWith("conjure")
    ))
      return;
    const sel = this.game.selected,
      tile = this.game.tile;
    const kids = this.game.units.filter((o) => !o.dead && o._conjuredBy === sel.id).length;
    const txt = tr("minions") + " " + kids + "/2";
    g.font = "bold 12px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    const cx = sel.tx * tile + tile / 2,
      cy = sel.ty * tile - 6,
      textW = g.measureText(txt).width + 12;
    g.fillStyle = "rgba(10,20,14,0.88)";
    g.fillRect(cx - textW / 2, cy - 17, textW, 18);
    g.fillStyle = "#9df0b0";
    g.fillText(txt, cx, cy - 2);
  }

  // HORSE BOWMEN ride preview: the arrows the ride will loose (_strafePlan — every other tile, the nearest foe in range
  // not yet shot): a dashed line from the tile each is loosed on to its foe, labelled with that arrow's damage.
  _drawStrafePlan(g, u, path) {
    const tile = this.game.tile,
      plan = this.game._strafePlan(u, path);
    if (!plan.length) return;
    g.save();
    for (const shot of plan) {
      const cx = shot.tx * tile + tile / 2,
        cy = shot.ty * tile + tile / 2;
      const fx = shot.foe.tx * tile + tile / 2,
        fy = shot.foe.ty * tile + tile / 2;
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.strokeStyle = "rgba(255,120,90,0.9)";
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(fx, fy);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(255,120,90,0.95)";
      g.beginPath();
      g.arc(cx, cy, Math.max(3, tile * 0.08), 0, 6.29);
      g.fill();
      const from = Object.assign(Object.create(Object.getPrototypeOf(u)), u, { tx: shot.tx, ty: shot.ty });
      const damage = this.game.computeDamage(from, shot.foe),
        label = "🏹-" + shownDamage(shot.foe.hp, damage);
      g.font = `800 ${Math.max(10, tile * 0.26)}px system-ui`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 3.5;
      g.strokeStyle = "rgba(0,0,0,0.85)";
      g.strokeText(label, fx, shot.foe.ty * tile + tile * 0.16);
      g.fillStyle = damage >= shot.foe.hp ? "#ff6a5a" : "#ffe08a";
      g.fillText(label, fx, shot.foe.ty * tile + tile * 0.16);
    }
    g.restore();
  }
  // Damage / charge forecast over each target, drawn AFTER the units so a tall sprite standing on the target
  // tile never hides the number; the red target squares stay under the units.
  _drawTargetNumbers(g) {
    // movement preview arrow (+ its charge trample damage glyphs) — on TOP of the units so the gold charge
    // arrow's numbers aren't hidden behind the foot sprites they land on.
    if (
      this.game.phase === "player" &&
      this.game.mode === "select" &&
      !this.game.aimMode &&
      this.game.selected &&
      this.game.reach &&
      this.game.hover &&
      this.game.reach.stops.has(key(this.game.hover.tx, this.game.hover.ty))
    ) {
      const path = this.game.pathTo(this.game.reach, this.game.hover.tx, this.game.hover.ty);
      this._drawMoveArrow(g, path, this.game.selected);
      if (this.game.selected.T.mountedArcher && !this.game.selected.acted)
        this._drawStrafePlan(g, this.game.selected, path);
    }
    if (!(this.game.targets && this.game.targets.length && this.game.selected)) return;
    const tile = this.game.tile;
    // Extended intent (siege blast / cavalry trample / flank) for the target under the cursor; falls back to the sole target.
    const focus =
      (this.game.hover && this.game.targets.find((t) => t.tx === this.game.hover.tx && t.ty === this.game.hover.ty)) ||
      (this.game.targets.length === 1 ? this.game.targets[0] : null);
    if (focus) this._drawAttackIntent(g, this.game.selected, focus);
    const fontSize = Math.max(10, tile * 0.26);
    g.font = `800 ${fontSize}px system-ui`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const target of this.game.targets) {
      const damage = this.game.estimateDamage(this.game.selected, target),
        label = "-" + shownDamage(target.hp, damage);
      const cx = target.tx * tile + tile / 2,
        cy = target.ty * tile + tile * 0.16; // top of the cell, ABOVE the sprite's body
      // dark rounded pill behind the number so it reads clearly against the unit sprite it sits over
      const w = g.measureText(label).width + fontSize * 0.6,
        h = fontSize * 1.2;
      g.fillStyle = "rgba(15,18,24,0.82)";
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
        g.fill();
      } else g.fillRect(cx - w / 2, cy - h / 2, w, h);
      g.lineWidth = 3.5;
      g.strokeStyle = "rgba(0,0,0,0.9)";
      g.strokeText(label, cx, cy);
      g.fillStyle = damage >= target.hp ? "#ff6a5a" : "#ffe08a";
      g.fillText(label, cx, cy);
      // FEAR target (Griffon / Bear): the odds this unit keeps its nerve — Unit::attack's courage roll, exact. A failed
      // roll balks: no blow, turn spent. (A recreation read-out; the original gives no warning.)
      if (this.game._needsCourage(this.game.selected, target)) {
        const nerveChance = this.game._courageChance(this.game.selected),
          txt = nerveChance >= 1 ? tr("nerve sure") : tr("nerve") + " " + Math.round(nerveChance * 100) + "%";
        const nerveFont = Math.max(9, fontSize * 0.72),
          nerveY = cy + h * 0.5 + nerveFont * 0.75;
        g.font = `700 ${nerveFont}px system-ui`;
        const nerveW = g.measureText(txt).width + nerveFont * 0.6,
          nerveH = nerveFont * 1.25;
        g.fillStyle = "rgba(20,28,48,0.88)";
        if (g.roundRect) {
          g.beginPath();
          g.roundRect(cx - nerveW / 2, nerveY - nerveH / 2, nerveW, nerveH, nerveH / 2);
          g.fill();
        } else g.fillRect(cx - nerveW / 2, nerveY - nerveH / 2, nerveW, nerveH);
        g.fillStyle = nerveChance >= 1 ? "#9df0b0" : nerveChance >= 0.75 ? "#cfe0ff" : "#ffb08a";
        g.fillText(txt, cx, nerveY);
        g.font = `800 ${fontSize}px system-ui`;
      }
    }
    g.textBaseline = "alphabetic";
  }

  visibleRange() {
    const tilePx = this.game.tile;
    return {
      x0: Math.max(0, Math.floor(this.game.cam.x / tilePx)),
      y0: Math.max(0, Math.floor(this.game.cam.y / tilePx)),
      x1: Math.min(this.game.cols - 1, Math.floor((this.game.cam.x + this.game.view.w) / tilePx)),
      y1: Math.min(this.game.rows - 1, Math.floor((this.game.cam.y + this.game.view.h) / tilePx)),
    };
  }

  // Draw the battlefield with the REAL game tileset: each cell blits its tile
  // sprite (tile value 0..123) from the baked 124-tile strip. A grass base is
  // painted first so any tile transparency reads as ground, not black.
  _drawTerrain(g) {
    const geo = this._terrainGeometry(),
      { vis, tile } = geo;
    // Crisp tiles: with smoothing on, each atlas tile's edge samples its neighbour → thin seams between
    // cells. Nearest-neighbour for the tileset removes the bleed (sprites stay smoothed, restored below).
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    // One grass ground under the whole visible field — NOT per cell. Several tiles (trees, hills, keeps) carry a
    // TRANSPARENT top strip on purpose — a tree's canopy sits in the lower ~¾ of its 40px cell, sky above it — so
    // the grass shows through as ground where the sprite is clear. Painting it once keeps that read correct.
    g.fillStyle = "#5c8f3e";
    g.fillRect(vis.x0 * tile, vis.y0 * tile, (vis.x1 - vis.x0 + 1) * tile + 1, (vis.y1 - vis.y0 + 1) * tile + 1);
    if (geo.tileset) {
      this._drawGrassPass(g, geo);
      this._drawTilePass(g, geo);
    }
    this._drawQuicksand(g, vis);
    g.imageSmoothingEnabled = smooth;
  }

  // How the tileset maps onto the board this frame.
  // Every cell is blitted OVERLAP px oversized on each edge so neighbours overlap. The canvas is scaled by a
  // (often fractional) devicePixelRatio, so integer world tiles still land on fractional DEVICE pixels — with
  // nearest-neighbour that leaves 1px hairline seams between tiles (the "gaps", most visible on stone walls).
  // A 2px overlap of opaque edges swallows them; transparent tops still fall on grass, so nothing is hidden.
  // Episode II bakes 40×55 cells (native height): tall terrain (dunes, palms, walls) lives in the top of the
  // cell and RISES out of it. `srcH` is the source cell height; `tallMode` draws every tile tile*(srcH/40) tall,
  // bottom-anchored, so it overflows upward instead of being squished. Ep1 (srcH=40) uses TALL_TILES instead.
  _terrainGeometry() {
    const TILE_CELL = tileCell(), // source tile WIDTH in the baked tileset strip
      srcH = tileCellH(),
      tallMode = srcH > TILE_CELL;
    return {
      tileset: this.game.assets.tileset,
      tile: this.game.tile,
      vis: this.visibleRange(),
      TILE_CELL,
      srcH,
      tallMode,
      grassSrcY: tallMode ? srcH - TILE_CELL : 0, // grass content is the bottom 40px of a tall cell
      tallH: Math.round((this.game.tile * srcH) / TILE_CELL),
    };
  }

  // One tileset cell (source x, y, height) drawn on board cell (x, y), `drawH` tall and bottom-anchored, oversized by
  // OVERLAP on the sides (and the top for a standard-height cell — drawH = tile + OVERLAP).
  _blitTile(g, geo, srcX, srcY, srcH, x, y, drawH) {
    const { tile, tileset, TILE_CELL } = geo;
    g.drawImage(
      tileset,
      srcX,
      srcY,
      TILE_CELL,
      srcH,
      x * tile - TERRAIN_OVERLAP,
      y * tile + tile - drawH,
      tile + 2 * TERRAIN_OVERLAP,
      drawH + TERRAIN_OVERLAP,
    );
  }

  // PASS 1: a real GRASS TILE under every cell, so any transparent area (tree canopies, wall crenellations)
  // reads as ground texture rather than a flat green box.
  _drawGrassPass(g, geo) {
    const { vis, tile, TILE_CELL, grassSrcY } = geo;
    for (let y = vis.y0; y <= vis.y1; y++)
      for (let x = vis.x0; x <= vis.x1; x++)
        this._blitTile(g, geo, GRASS_TILE * TILE_CELL, grassSrcY, TILE_CELL, x, y, tile + TERRAIN_OVERLAP);
  }

  // PASS 2: each cell's own tile on top. Forest tiles are drawn ~1.3× tall, anchored to the cell's base, so the
  // canopy rises into the row above (proper tree height) instead of being squashed into one cell.
  _drawTilePass(g, geo) {
    const { vis, tile, TILE_CELL, srcH, tallMode, tallH } = geo;
    for (let y = vis.y0; y <= vis.y1; y++)
      for (let x = vis.x0; x <= vis.x1; x++) {
        const tileVal = this.game.tileAt(x, y);
        if (tileVal === GRASS_TILE) continue; // grass base already covers it
        const srcX = tileVal * TILE_CELL;
        if (tallMode)
          // Ep2 native-height tiles: draw full 40×55 cell, bottom-anchored → tall terrain rises out of the cell
          this._blitTile(g, geo, srcX, 0, srcH, x, y, tallH);
        else if (TALL_TILES.has(tileVal))
          // Ep1: trees, barricades & stone walls RISE — canopy / crenellations / spikes overflow upward
          this._blitTile(g, geo, srcX, 0, TILE_CELL, x, y, Math.round(tile * 1.3));
        else this._blitTile(g, geo, srcX, 0, TILE_CELL, x, y, tile + TERRAIN_OVERLAP);
      }
  }

  // PASS 3 (EPISODE II): quicksand — the game's own tile art (iOS resource 5064: a 4-frame 40×40 sand whirlpool
  // that Map::redrawTileInBuffer lays over every tile whose countdown is > 0, frame = tick/100). Drawn at tile
  // size, turning slowly; falls back to a plain sandy wash only if the strip failed to load.
  _drawQuicksand(g, vis) {
    if (!this.game.quicksand || !this.game.quicksand.size) return;
    const tile = this.game.tile,
      time = this.game.clock || 0,
      quicksandArt = this.game.assets.fx && this.game.assets.fx.quicksand;
    const frame = Math.floor(time / 0.4) % 4;
    for (const [k, left] of this.game.quicksand) {
      const [x, y] = k.split(",").map(Number);
      if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue;
      const cellLeft = x * tile,
        cellTop = y * tile;
      if (quicksandArt) {
        g.imageSmoothingEnabled = false;
        g.drawImage(quicksandArt, frame * 40, 0, 40, 40, cellLeft, cellTop, tile, tile);
      } else {
        g.fillStyle = "rgba(122,94,44," + (0.3 + 0.1 * (left / 4)) + ")";
        g.fillRect(cellLeft, cellTop, tile, tile);
      }
    }
  }

  _drawTutorialZone(g) {
    const tile = this.game.tile;
    const zone = this.game.tutZone; // the movement drill's "green" only — never the deploy zone (which clears after muster)
    if (!zone || !zone.size) return;
    // A clearly-visible, gently pulsing green guide (the 0.16-alpha version was invisible on grass). A tile a
    // unit is standing on reads as FILLED (solid + a check) so reaching one gives immediate feedback.
    const pulse = 0.3 + 0.12 * Math.sin((this.game.clock || 0) * 3);
    for (const k of zone) {
      const [x, y] = k.split(",").map(Number);
      const occupant = this.game.unitAt(x, y);
      const filled = occupant && occupant.team === "blue" && !occupant.dead;
      g.fillStyle = filled ? "rgba(76,186,74,0.62)" : `rgba(96,206,84,${pulse})`;
      g.fillRect(x * tile, y * tile, tile, tile);
      g.strokeStyle = filled ? "rgba(190,255,150,1)" : "rgba(150,240,120,0.95)";
      g.lineWidth = filled ? 2.5 : 2;
      g.strokeRect(x * tile + 1, y * tile + 1, tile - 2, tile - 2);
      if (filled) {
        // a check mark in the corner
        g.strokeStyle = "rgba(235,255,210,0.95)";
        g.lineWidth = Math.max(2, tile * 0.06);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x * tile + tile * 0.2, y * tile + tile * 0.5);
        g.lineTo(x * tile + tile * 0.42, y * tile + tile * 0.72);
        g.lineTo(x * tile + tile * 0.78, y * tile + tile * 0.28);
        g.stroke();
      }
    }
  }
  _drawDeploy(g) {
    const tile = this.game.tile;
    // Formation blocks: yellow normally, GREEN in the tutorials — the tutorial dialogue tells you to
    // "assemble the soldiers onto the green square", so the assembly zone is tinted green to match.
    const isDrill = this.game.mission && this.game.mission.group === "special";
    const fill = isDrill ? "rgba(96,196,84,0.22)" : "rgba(232,196,64,0.20)";
    const line = isDrill ? "rgba(130,224,110,0.8)" : "rgba(240,210,90,0.7)";
    for (const k of this.game.deployZone) {
      const [x, y] = k.split(",").map(Number);
      g.fillStyle = fill;
      g.fillRect(x * tile, y * tile, tile, tile);
      g.strokeStyle = line;
      g.lineWidth = 1.5;
      g.strokeRect(x * tile + 1.5, y * tile + 1.5, tile - 3, tile - 3);
    }
    // Hero picked up for repositioning — glow his tile
    if (this.game.pickHero) {
      const hero = this.game.units.find((u) => u.hero && u.team === "blue");
      if (hero) {
        const pulse = 0.5 + 0.5 * Math.sin((this.game.clock || 0) * 4);
        g.strokeStyle = `rgba(255,211,107,${0.6 + 0.4 * pulse})`;
        g.lineWidth = 3;
        g.strokeRect(hero.tx * tile + 2, hero.ty * tile + 2, tile - 4, tile - 4);
      }
    }
    // An issued unit picked up for repositioning — glow its tile (click an empty muster tile to move it, or
    // another issued unit to swap).
    if (this.game.pickUp && !this.game.pickUp.dead) {
      const pulse = 0.5 + 0.5 * Math.sin((this.game.clock || 0) * 4);
      g.strokeStyle = `rgba(120,200,255,${0.65 + 0.35 * pulse})`;
      g.lineWidth = 3;
      g.strokeRect(this.game.pickUp.tx * tile + 2, this.game.pickUp.ty * tile + 2, tile - 4, tile - 4);
    }
    const hover = this.game.hover;
    if (
      this.game.placing &&
      hover &&
      this.game.deployZone.has(key(hover.tx, hover.ty)) &&
      !this.game.unitAt(hover.tx, hover.ty) &&
      this.game.terrainAt(hover.tx, hover.ty).passable
    ) {
      const T = UNIT_TYPES[this.game.placing],
        dh = tile * (T.frameH / 88);
      const stand = this.game.assets.stands && this.game.assets.stands[this.game.placing];
      const gimg = stand || this.game.assets.sheets[this.game.placing].blue;
      const sw = stand ? stand.width : T.frameW,
        sh = stand ? stand.height : T.frameH;
      const dw = stand ? dh * (sw / sh) : tile * (T.frameW / 88);
      const ok = this.game.canAfford(this.game.placing);
      g.globalAlpha = ok ? 0.55 : 0.3;
      g.drawImage(gimg, 0, 0, sw, sh, hover.tx * tile + tile / 2 - dw / 2, hover.ty * tile + (tile - dh), dw, dh);
      g.globalAlpha = 1;
      g.strokeStyle = ok ? "#f0d25a" : "#e0503f";
      g.lineWidth = 2;
      g.strokeRect(hover.tx * tile + 1.5, hover.ty * tile + 1.5, tile - 3, tile - 3);
    }
  }

  _drawFx(g, e) {
    const T = FX_TYPES[e.name],
      img = this.game.assets.fx && this.game.assets.fx[e.name];
    if (!img || e.t < e.delay) return;
    const progress = (e.t - e.delay) / T.dur;
    if (progress < 0 || progress >= 1) return;
    // f0 lets an FX play a SUB-RANGE of its strip (e.g. only the fade-in half of the teleport orb, so it doesn't
    // vanish-and-reappear). The played columns are [f0 .. f0+frames-1].
    const framePos = progress * T.frames; // fractional frame position
    const frameIdx = Math.min(T.frames - 1, Math.floor(framePos));
    const frame = (T.f0 || 0) + frameIdx;
    const scale = (e.scale || 1) * (T.scale || 1) * (this.game.tile / 64);
    const dw = T.frameW * scale,
      dh = T.frameH * scale;
    g.save();
    g.translate(e.x, e.y);
    if (e.angle) g.rotate(e.angle);
    if (e.flip) g.scale(-1, 1);
    const baseA = progress > 0.8 ? (1 - progress) / 0.2 : 1;
    // A short strip (e.g. the teleport orb: 6 frames over 0.55s ≈ 11fps) looks choppy — for `smooth` FX, CROSS-FADE
    // the current sprite frame into the next by the fractional progress so the motion reads fluid (#14 "lacks frames").
    if (T.smooth && frameIdx < T.frames - 1) {
      const frac = framePos - frameIdx;
      g.globalAlpha = baseA * (1 - frac);
      g.drawImage(img, frame * T.frameW, 0, T.frameW, T.frameH, -dw / 2, -dh / 2, dw, dh);
      g.globalAlpha = baseA * frac;
      g.drawImage(img, (frame + 1) * T.frameW, 0, T.frameW, T.frameH, -dw / 2, -dh / 2, dw, dh);
    } else {
      g.globalAlpha = baseA;
      g.drawImage(img, frame * T.frameW, 0, T.frameW, T.frameH, -dw / 2, -dh / 2, dw, dh);
    }
    g.restore();
  }

  _drawObjectives(g) {
    const tile = this.game.tile,
      pulse = 0.5 + 0.5 * Math.sin((this.game.clock || 0) * 2);
    // CONSISTENT region colours — each battlefield overlay has ONE meaning:
    //   GOLD = deploy zone (place units) · BLUE = your move range · RED = attack targets
    //   GREEN = tutorial "assemble here" guide · PURPLE = a capture objective (below).
    // The objective is always purple so it never blends into the blue move-range or red target tiles. A capture AREA
    // (several touching tiles — e.g. Bordavia Raid 3's two keeps, 45 tiles) is drawn as ONE region: a faint steady
    // tint so the terrain stays readable, an outline round its outer edge that glows gently, and a single flag in its
    // middle showing who holds the area (most tiles occupied: blue = you, red = enemy, white = nobody). A lone
    // objective tile keeps its own flag (who stands on it / took it last). A mission that scores the record's capture
    // areas flies each area's flag on its first tile in its owner's colour (a "conquer" map opens all red).
    const OBJ_RGB = "178,120,240";
    const regions = this._objectiveRegions();
    const cells = regions.flatMap((r) => r.tiles);
    const set = new Set(cells.map((o) => o.tx + "," + o.ty));
    g.fillStyle = `rgba(${OBJ_RGB},0.14)`;
    for (const cell of cells) g.fillRect(cell.tx * tile, cell.ty * tile, tile, tile);
    // the outline: only the sides that face a non-objective tile
    const edge = (x1, y1, x2, y2) => {
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    };
    g.save();
    g.strokeStyle = `rgba(${OBJ_RGB},${0.6 + 0.3 * pulse})`;
    g.lineWidth = 2.5;
    g.lineCap = "square";
    g.beginPath();
    for (const cell of cells) {
      const x = cell.tx * tile,
        y = cell.ty * tile,
        open = (dx, dy) => !set.has(cell.tx + dx + "," + (cell.ty + dy));
      if (open(0, -1)) edge(x, y + 1, x + tile, y + 1);
      if (open(0, 1)) edge(x, y + tile - 1, x + tile, y + tile - 1);
      if (open(-1, 0)) edge(x + 1, y, x + 1, y + tile);
      if (open(1, 0)) edge(x + tile - 1, y, x + tile - 1, y + tile);
    }
    g.stroke();
    g.restore();
    for (const region of regions) {
      let owner;
      if (region.area) owner = region.area.owner;
      else if (region.tiles.length === 1) owner = this.game.objectiveOwner(region.tiles[0]);
      else {
        const tally = { blue: 0, red: 0 };
        for (const cell of region.tiles) {
          const u = this.game.unitAt(cell.tx, cell.ty);
          if (u && !u.dead) tally[u.team] = (tally[u.team] || 0) + 1;
        }
        owner = tally.blue > tally.red ? "blue" : tally.red > tally.blue ? "red" : null;
      }
      this._drawObjectiveFlag(g, region.flag.tx * tile, region.flag.ty * tile, this.game.paintOfTeam(owner)); // hot-seat: a side's own flag colour
    }
  }
  // The objective tiles grouped into areas — the record's own capture areas when it lists them (an area may be split
  // into pieces, like Bordavia Raid 3's inner keep), else connected tiles (4-neighbour) — each with the tile its flag
  // stands on: the one nearest the area's middle. Cached until the objective list changes.
  _objectiveRegions() {
    if (this.game.captureAreas && this.game.captureAreas.length) {
      if (!this._capRegions || this._capRegions.src !== this.game.captureAreas)
        this._capRegions = {
          src: this.game.captureAreas,
          list: this.game.captureAreas.map((a) => ({ tiles: a.tiles, flag: a.tiles[0], area: a })),
        };
      return this._capRegions.list;
    }
    const objs = this.game.objectives;
    if (this._objRegions && this._objRegions.src === objs && this._objRegions.n === objs.length)
      return this._objRegions.list;
    const groups = [],
      byArea = new Map(),
      byKey = new Map(objs.map((o) => [o.tx + "," + o.ty, o])),
      seen = new Set();
    for (const obj of objs) {
      if (obj.area == null) continue;
      if (!byArea.has(obj.area)) groups.push(byArea.set(obj.area, []).get(obj.area));
      byArea.get(obj.area).push(obj);
      seen.add(obj.tx + "," + obj.ty);
    }
    for (const obj of objs) {
      const startKey = obj.tx + "," + obj.ty;
      if (seen.has(startKey)) continue;
      const tiles = [],
        queue = [obj];
      seen.add(startKey);
      while (queue.length) {
        const cur = queue.shift();
        tiles.push(cur);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const k = cur.tx + dx + "," + (cur.ty + dy);
          if (byKey.has(k) && !seen.has(k) && byKey.get(k).area == null) {
            seen.add(k);
            queue.push(byKey.get(k));
          }
        }
      }
      groups.push(tiles);
    }
    const list = groups.map((tiles) => {
      const mx = tiles.reduce((s, t) => s + t.tx, 0) / tiles.length,
        meanY = tiles.reduce((s, t) => s + t.ty, 0) / tiles.length;
      let flag = tiles[0];
      for (const cell of tiles)
        if ((cell.tx - mx) ** 2 + (cell.ty - meanY) ** 2 < (flag.tx - mx) ** 2 + (flag.ty - meanY) ** 2) flag = cell;
      return { tiles, flag };
    });
    this._objRegions = { src: objs, n: objs.length, list };
    return list;
  }
  _drawObjectiveFlag(g, x, y, owner) {
    const tile = this.game.tile,
      flagImg = this.game.assets && this.game.assets.flags;
    if (flagImg && flagImg.width) {
      // the REAL objective flag (android units/066): 3 frames @64×88 — white=neutral, green=yours, red=enemy.
      // Map::redrawTileInBuffer draws it (tile tags 0x10000 / 0x4000 / 0x8000) a full tile wide, standing on the
      // tile's bottom edge and rising 15 px (on 40 px tiles) above it — before the unit on that tile.
      const frame = owner === "blue" ? 1 : owner === "red" ? 2 : 0,
        frameW = 64,
        frameH = 88;
      const dw = tile,
        dh = tile * (frameH / frameW),
        dx = x,
        dy = y + tile - dh;
      g.drawImage(flagImg, frame * frameW, 0, frameW, frameH, dx, dy, dw, dh);
    } else {
      const flag = owner === "blue" ? [120, 190, 255] : owner === "red" ? [255, 110, 100] : [240, 240, 240];
      const px = x + tile / 2,
        top = y + tile * 0.16,
        poleH = tile * 0.42;
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(px, top);
      g.lineTo(px, top + poleH);
      g.stroke();
      g.strokeStyle = "#fff";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(px, top);
      g.lineTo(px, top + poleH);
      g.stroke();
      g.fillStyle = `rgb(${flag[0]},${flag[1]},${flag[2]})`;
      g.beginPath();
      g.moveTo(px + 1, top);
      g.lineTo(px + tile * 0.26, top + tile * 0.09);
      g.lineTo(px + 1, top + tile * 0.18);
      g.closePath();
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.lineWidth = 1.5;
      g.fill();
      g.stroke();
    }
  }

  // The highlights drawn UNDER the units, in this order (later passes paint over earlier ones). The forecast numbers
  // and the movement arrow are drawn AFTER the units, in _drawTargetNumbers, so tall sprites can't bury them.
  _drawOverlays(g) {
    this._drawInspectThreat(g);
    this._drawMoveGrid(g);
    this._drawRangePreview(g);
    this._drawHealTargets(g);
    this._drawRetributionPreview(g);
    this._drawTargetTiles(g);
    this._drawAreaAim(g);
    this._drawGrapeAim(g);
    this._drawAbilityAim(g);
    this._drawLeashTethers(g); // which Conjurer a minion belongs to (under the units)
    this._drawSelectionBracket(g);
    this._updateCursor();
  }

  // Unit inspection: threat squares + a bracket on the inspected unit — orange for an enemy, the move grid's
  // YELLOW for one of your own spent units (tapped to read its stats), so the two never read as the same thing.
  _drawInspectThreat(g) {
    if (!this.game.inspect || (this.game.selected && !this.game.inspect.peek)) return;
    const tile = this.game.tile;
    const foe = this.game.inspect.unit.team === "red";
    g.fillStyle = foe ? "rgba(230,126,34,0.28)" : "rgba(242,196,48,0.26)";
    g.strokeStyle = foe ? "rgba(240,160,70,0.5)" : "rgba(255,232,140,0.55)";
    g.lineWidth = 1;
    for (const k of this.game.inspect.threat || []) {
      const [x, y] = k.split(",").map(Number);
      g.fillRect(x * tile, y * tile, tile, tile);
    }
    this._bracket(g, this.game.inspect.unit.tx, this.game.inspect.unit.ty, foe ? "#e67e22" : "#3884ff");
  }

  // The original's move grid is YELLOW (help 1404 "Yellow highlights indicate where the selected unit can move").
  _drawMoveGrid(g) {
    if (!(
      this.game.phase === "player" &&
      this.game.reach &&
      this.game.selected &&
      this.game.mode === "select" &&
      !this.game.aimMode
    ))
      return;
    const tile = this.game.tile;
    g.fillStyle = "rgba(242,196,48,0.40)";
    g.strokeStyle = "rgba(255,232,140,0.75)";
    g.lineWidth = 1;
    for (const k of this.game.reach.stops) {
      const [x, y] = k.split(",").map(Number);
      g.fillRect(x * tile, y * tile, tile, tile);
      g.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);
    }
  }

  // RANGE PREVIEW: a selected ranged unit outlines every tile it can shoot from where it stands (its minimum–maximum
  // range, Manhattan like the targeting), in red dashes over the move grid — so you can see what it covers before
  // you move it (Move-or-Shoot units can't fire after moving). Wizards show the armed spell's band.
  _drawRangePreview(g) {
    const sel = this.game.selected;
    if (
      this.game.phase !== "player" ||
      !sel ||
      sel.acted ||
      this.game.aimMode ||
      (this.game.inspect && this.game.inspect.peek)
    )
      return;
    const tile = this.game.tile;
    const spell = sel.T.canLightning && this.game._spellDisplay ? this.game._spellDisplay(sel) : null;
    const mx = spell ? spell.max : sel.T.range || 1,
      mn = spell ? spell.min : sel.T.minRange || 1;
    if (mx <= 1) return;
    g.save();
    g.setLineDash([5, 4]);
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(235,80,70,0.8)";
    g.fillStyle = "rgba(235,80,70,0.07)";
    for (let y = Math.max(0, sel.ty - mx); y <= Math.min(this.game.rows - 1, sel.ty + mx); y++)
      for (let x = Math.max(0, sel.tx - mx); x <= Math.min(this.game.cols - 1, sel.tx + mx); x++) {
        const dist = Math.abs(x - sel.tx) + Math.abs(y - sel.ty);
        if (dist < mn || dist > mx) continue;
        g.fillRect(x * tile, y * tile, tile, tile);
        g.strokeRect(x * tile + 1.5, y * tile + 1.5, tile - 3, tile - 3);
      }
    g.restore();
  }

  // PRIEST heal targets: highlight every wounded friendly — YOUR units AND allied armies (the Emperor's
  // men included) — within casting range, in green with the +HP it would restore, so it's clear who can be healed.
  _drawHealTargets(g) {
    const sel = this.game.selected;
    if (!(this.game.phase === "player" && sel && sel.T.heal && !sel.acted && !this.game.aimMode)) return;
    const tile = this.game.tile,
      range = sel.T.range || 1;
    g.font = `800 ${Math.max(11, tile * 0.3)}px system-ui`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const a of this.game.units) {
      if (a.dead || a.team !== "blue" || a.hp >= 100) continue; // a wounded priest may heal itself
      if (manhattan(sel, a) > range) continue;
      g.fillStyle = "rgba(70,210,120,0.34)";
      g.strokeStyle = "rgba(150,240,180,0.95)";
      g.lineWidth = 2.5;
      g.fillRect(a.tx * tile, a.ty * tile, tile, tile);
      g.strokeRect(a.tx * tile + 1.5, a.ty * tile + 1.5, tile - 3, tile - 3);
      const heal = healStep(a.hp).shown; // what the heal will read when it lands
      g.lineWidth = 4;
      g.strokeStyle = "rgba(0,0,0,0.85)";
      g.strokeText("+" + heal, a.tx * tile + tile / 2, a.ty * tile + tile * 0.3);
      g.fillStyle = "#8df2ac";
      g.fillText("+" + heal, a.tx * tile + tile / 2, a.ty * tile + tile * 0.3);
    }
    g.textBaseline = "alphabetic";
  }

  // RETRIBUTION preview: while the button is hovered, tint the 2-tile radius and ring the allies it would
  // guard, so you can see the reach before casting.
  _drawRetributionPreview(g) {
    const sel = this.game.selected;
    if (!(this.game._retribPreview && this.game.phase === "player" && sel && sel.T.prayer && !sel.acted)) return;
    const tile = this.game.tile;
    g.fillStyle = "rgba(120,90,220,0.12)";
    g.strokeStyle = "rgba(180,150,255,0.35)";
    g.lineWidth = 1;
    for (let y = 0; y < this.game.rows; y++)
      for (let x = 0; x < this.game.cols; x++) {
        if (Math.abs(x - sel.tx) + Math.abs(y - sel.ty) <= 2 && this.game.inBounds(x, y)) {
          g.fillRect(x * tile, y * tile, tile, tile);
          g.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);
        }
      }
    for (const a of this.game.units) {
      if (a.dead || a.team !== sel.team || manhattan(a, sel) > 2) continue;
      g.strokeStyle = "rgba(200,170,255,0.95)";
      g.lineWidth = 2.5;
      g.strokeRect(a.tx * tile + 1.5, a.ty * tile + 1.5, tile - 3, tile - 3);
    }
  }

  // The enemies the selected unit can strike, in red. The damage/charge preview NUMBERS + attack intent
  // (trample/flank) are drawn in _drawTargetNumbers, AFTER the units, so a tall unit sprite standing on the target
  // tile can't paint over the forecast.
  _drawTargetTiles(g) {
    if (!this.game.targets || !this.game.targets.length) return;
    const tile = this.game.tile;
    g.fillStyle = "rgba(248,81,73,0.5)";
    g.strokeStyle = "#ff6a60";
    g.lineWidth = 2.5;
    for (const target of this.game.targets) {
      g.fillRect(target.tx * tile, target.ty * tile, tile, tile);
      g.strokeRect(target.tx * tile + 1.5, target.ty * tile + 1.5, tile - 3, tile - 3);
    }
  }

  // The hovered tile as a stand-in target, so an aimed shot can preview its footprint on empty ground too.
  _hoverGround() {
    const tile = this.game.tile;
    return {
      tx: this.game.hover.tx,
      ty: this.game.hover.ty,
      px: this.game.hover.tx * tile,
      py: this.game.hover.ty * tile,
      T: {},
      hp: 100,
      dead: false,
    };
  }

  // #15 AIM preview: while aiming an area weapon, tint the whole cast range and preview the blast footprint
  // (shape + per-enemy damage) at the hovered tile — free pick, empty ground included.
  _drawAreaAim(g) {
    if (!this.game._aimingShot(this.game.selected)) return;
    const tile = this.game.tile,
      sel = this.game.selected,
      [mn, mx] = this.game._castRange(sel);
    g.fillStyle = "rgba(255,170,80,0.09)";
    g.strokeStyle = "rgba(255,170,80,0.28)";
    g.lineWidth = 1;
    for (let y = 0; y < this.game.rows; y++)
      for (let x = 0; x < this.game.cols; x++) {
        const dist = Math.abs(x - sel.tx) + Math.abs(y - sel.ty);
        if (dist >= mn && dist <= mx) {
          g.fillRect(x * tile, y * tile, tile, tile);
          g.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);
        }
      }
    if (this.game.hover) {
      const dist = manhattan(this.game.hover, sel);
      if (dist >= mn && dist <= mx) this._drawAttackIntent(g, sel, this._hoverGround());
    }
  }

  // GRAPESHOT AIM preview: the cannon is aiming — mark the 4 orthogonal firing directions, and on hover over one
  // preview the forward scatter cone (shape + per-enemy damage) via _drawAttackIntent, empty ground included.
  _drawGrapeAim(g) {
    if (!this.game._aimingGrape(this.game.selected)) return;
    const tile = this.game.tile,
      sel = this.game.selected;
    g.fillStyle = "rgba(255,170,80,0.12)";
    g.strokeStyle = "rgba(255,170,80,0.55)";
    g.lineWidth = 2;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cellX = sel.tx + dx,
        cellY = sel.ty + dy;
      if (!this.game.inBounds(cellX, cellY)) continue;
      g.fillRect(cellX * tile, cellY * tile, tile, tile);
      g.strokeRect(cellX * tile + 1, cellY * tile + 1, tile - 2, tile - 2);
    }
    if (this.game.hover && manhattan(this.game.hover, sel) === 1) this._drawAttackIntent(g, sel, this._hoverGround());
  }

  // EP2 ABILITY AIM preview: the tiles an armed Build / Repair / Conjure / Quicksand can be cast on (green), the
  // Quicksand line following the hovered side, and the Conjurer's minion count while Conjure is armed.
  _drawAbilityAim(g) {
    if (!(this.game.aimMode && this.game._abilityAim && this.game.selected && this.game._abilityCells)) return;
    const tile = this.game.tile;
    const cells = this.game._abilityCells(this.game.selected, this.game._abilityAim, this.game.hover);
    g.fillStyle = "rgba(120,220,140,0.30)";
    g.strokeStyle = "rgba(140,240,160,0.95)";
    g.lineWidth = 2;
    for (const cell of cells) {
      g.fillRect(cell.x * tile, cell.y * tile, tile, tile);
      g.strokeRect(cell.x * tile + 1.5, cell.y * tile + 1.5, tile - 3, tile - 3);
    }
  }

  // The bracket on the selected unit — or, with none selected, a faint one on the ready unit under the pointer.
  _drawSelectionBracket(g) {
    if (this.game.selected) this._bracket(g, this.game.selected.tx, this.game.selected.ty);
    else if (this.game.hover && this.game.phase === "player") {
      const u = this.game.unitAt(this.game.hover.tx, this.game.hover.ty);
      if (u && u.team === "blue" && !u.acted) this._bracket(g, u.tx, u.ty, "rgba(230,237,243,0.5)");
    }
  }

  // HOVER CURSOR: the browser mouse cursor IS the game's own action icon (android units/001) over the battlefield —
  // a BOOT over a reachable move tile, a SWORD over an attack target, and the gauntlet (f0) as the default grab cursor.
  _updateCursor() {
    const cursorKind = this._cursorFor();
    if (cursorKind === this._cursorKind) return;
    this._cursorKind = cursorKind;
    const b = (this.game.audio && this.game.audio.base) || "";
    this.game.canvas.style.cursor =
      cursorKind === "attack"
        ? `url("${b}hud/cursor_attack.png") 16 16, crosshair`
        : cursorKind === "move"
          ? `url("${b}hud/cursor_move.png") 16 16, pointer`
          : `url("${b}hud/cursor_default.png") 10 8, default`; // gauntlet — default grab cursor over the battlefield
  }

  // "attack" | "move" | "default". Computed in BOTH select and act mode — after a unit WALKS it's in act mode, and
  // hovering an enemy it can now strike must still show the SWORD (after moving, too). reach is null in
  // act mode, so canMove / canReachAttack fall away there and only a direct in-range target (isTarget) lights the sword.
  _cursorFor() {
    const hover = this.game.hover,
      sel = this.game.selected;
    if (
      this.game.phase !== "player" ||
      (this.game.mode !== "select" && this.game.mode !== "act") ||
      this.game.aimMode ||
      !sel ||
      !hover
    )
      return "default";
    const isTarget = this.game.targets && this.game.targets.some((t) => t.tx === hover.tx && t.ty === hover.ty);
    // a melee/cavalry unit that could advance to strike the hovered foe this turn also gets the SWORD cursor (#2)
    const foe = this.game.unitAt(hover.tx, hover.ty);
    const canReachAttack = !!(
      foe &&
      foe.team === "red" &&
      !foe.dead &&
      !sel.acted &&
      !sel.T.moveShoot &&
      !sel.T.shootMove &&
      this.game.reach &&
      this.game.bestApproach(sel, foe)
    );
    const canMove =
      this.game.reach && this.game.reach.stops.has(key(hover.tx, hover.ty)) && !this.game.unitAt(hover.tx, hover.ty);
    return isTarget || canReachAttack ? "attack" : canMove ? "move" : "default";
  }

  _bracket(g, tx, ty, color) {
    const tile = this.game.tile,
      x = tx * tile,
      y = ty * tile,
      arm = tile * 0.26;
    g.strokeStyle = color || "#ffd36b";
    g.lineWidth = 2.5;
    const corners = [
      [x + 1, y + 1, 1, 1],
      [x + tile - 1, y + 1, -1, 1],
      [x + 1, y + tile - 1, 1, -1],
      [x + tile - 1, y + tile - 1, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      g.beginPath();
      g.moveTo(cx, cy + sy * arm);
      g.lineTo(cx, cy);
      g.lineTo(cx + sx * arm, cy);
      g.stroke();
    }
  }

  // Directional movement arrow along the planned path. A straight 3+
  // run-up that a cavalry unit could use to CHARGE turns the arrow gold and flags the foot foe(s) it could
  // trample — the charge preview of the original.
  _drawMoveArrow(g, path, u) {
    if (!path || path.length < 2) return;
    const tile = this.game.tile,
      centerOf = (p) => [p.tx * tile + tile / 2, p.ty * tile + tile / 2];
    let charge = null;
    if (u && u.T.hasCharge && !u.slowed && path.length >= 3) {
      // any charger (incl. the Hero, kind "hero") — not just cavalry-kind. A straight run of 2+ tiles (moveUnit's
      // chargeDir test) whose NEXT tile still fits the movement (createChargeTargetList counts the lane, the foe's
      // tile included) — otherwise a strike at the end of it is an ordinary blow, so no gold line / charge numbers.
      const dx = Math.sign(path[1].tx - path[0].tx),
        dy = Math.sign(path[1].ty - path[0].ty);
      let straight = dx !== 0 || dy !== 0; // a consistent line — orthogonal OR diagonal
      for (let i = 2; i < path.length && straight; i++)
        if (Math.sign(path[i].tx - path[i - 1].tx) !== dx || Math.sign(path[i].ty - path[i - 1].ty) !== dy)
          straight = false;
      if (straight) {
        const end = path[path.length - 1];
        let spent = 0;
        for (let i = 1; i < path.length; i++)
          spent += this.game._chargeStep(u, path[i - 1].tx, path[i - 1].ty, path[i].tx, path[i].ty, { dx, dy });
        const ahead = this.game.inBounds(end.tx + dx, end.ty + dy)
          ? this.game._chargeStep(u, end.tx, end.ty, end.tx + dx, end.ty + dy, { dx, dy })
          : Infinity;
        if (spent + ahead <= this.game.moveOf(u)) charge = { dx, dy, spent: spent + ahead }; // spent: through the foe's tile
      }
    }
    const gold = !!charge;
    const line = () => {
      let [sx, sy] = centerOf(path[0]);
      g.beginPath();
      g.moveTo(sx, sy);
      for (let i = 1; i < path.length; i++) {
        const [x, y] = centerOf(path[i]);
        g.lineTo(x, y);
      }
      g.stroke();
    };
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = gold ? 6 : 5;
    line();
    g.strokeStyle = gold ? "rgba(255,206,84,0.95)" : "rgba(230,237,243,0.95)";
    g.lineWidth = gold ? 3.5 : 3;
    line();
    const a = centerOf(path[path.length - 2]),
      b = centerOf(path[path.length - 1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
      head = tile * 0.28;
    g.fillStyle = gold ? "rgba(255,206,84,0.98)" : "rgba(230,237,243,0.98)";
    g.beginPath();
    g.moveTo(b[0], b[1]);
    g.lineTo(b[0] - head * Math.cos(angle - 0.5), b[1] - head * Math.sin(angle - 0.5));
    g.lineTo(b[0] - head * Math.cos(angle + 0.5), b[1] - head * Math.sin(angle + 0.5));
    g.closePath();
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.fill();
    g.stroke();
    if (charge) {
      const end = path[path.length - 1];
      const firstHit = this.game.unitAt(end.tx + charge.dx, end.ty + charge.dy);
      if (firstHit && firstHit.team !== u.team && this.game._isFoot(firstHit)) {
        this._chargeGlyph(g, u, firstHit, true);
        // the ride-on (_chargeRun): only past a foot soldier the charge cuts down, while the movement lasts — and that
        // next blow is an ordinary one (the +30 is spent on the first hit)
        const secondHit = this.game.unitAt(end.tx + 2 * charge.dx, end.ty + 2 * charge.dy);
        if (
          secondHit &&
          secondHit.team !== u.team &&
          this.game._isFoot(secondHit) &&
          this.game.computeDamage(u, firstHit, { charge: true }) >= firstHit.hp &&
          charge.spent + this.game._chargeStep(u, firstHit.tx, firstHit.ty, secondHit.tx, secondHit.ty, charge) <=
            this.game.moveOf(u)
        )
          this._chargeGlyph(g, u, secondHit, false);
      }
    }
  }
  _chargeGlyph(g, u, target, charging) {
    const tile = this.game.tile,
      x = target.tx * tile,
      y = target.ty * tile;
    const damage = this.game.computeDamage(u, target, { charge: charging });
    g.fillStyle = "rgba(255,206,84,0.24)";
    g.fillRect(x, y, tile, tile);
    g.strokeStyle = "rgba(255,206,84,0.95)";
    g.lineWidth = 2.5;
    g.strokeRect(x + 2, y + 2, tile - 4, tile - 4);
    g.font = `800 ${Math.max(11, tile * 0.3)}px system-ui`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 4;
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText("⚡-" + shownDamage(target.hp, damage), x + tile / 2, y + tile * 0.34);
    g.fillStyle = damage >= target.hp ? "#ff5544" : "#ffce54";
    g.fillText("⚡-" + shownDamage(target.hp, damage), x + tile / 2, y + tile * 0.34);
    g.textBaseline = "alphabetic";
  }

  // Blast / trample / flank intent for the target the cursor is on — the unit is already in position (act mode)
  // or firing from where it stands. Siege friendly-fire tiles are shown in warning red with a ☠.
  // The extended attack preview for the target under the cursor: every tile the shot will hit (with each caught
  // unit's forecast), the may-deviate warning, and the charge's ride-on through the foot soldiers it cuts down.
  _drawAttackIntent(g, attacker, target) {
    // GRAPESHOT preview: the cannon's point-blank spray (a 3-wide row next to it + 1 tile further) — shown when
    // the cannon targets an adjacent enemy, so you see every tile it will rake before firing.
    if (attacker.T.grapeshot && manhattan(attacker, target) === 1) return this._intentGrapeshot(g, attacker, target);
    // BALLISTAE SHOCK: all 4 tiles around the engine (resolveDamage)
    if (attacker.T.weapon === 34 && manhattan(attacker, target) === 1) return this._intentShock(g, attacker, target);
    if (attacker.T.splash) this._intentBlast(g, attacker, target);
    else if (attacker.T.mayDeviate && !this.game._freeAim(attacker)) {
      // a single-target shot that may drift off target
      this._drawHitCell(g, target.tx, target.ty, false, 0.2, 0.7, 2);
      this._drawDeviateWarning(g, target.tx, target.ty, "⚠ " + tr("may deviate"));
    } else if (this.game._freeAim(attacker)) this._intentSingleShot(g, attacker, target);
    if (this.game._wouldCharge(attacker, target)) this._intentChargeRide(g, attacker, target);
  }

  // One tile the shot will hit: a soft orange fill and outline — a red tint with a DASHED red outline when the unit
  // standing there is on the attacker's own side (friendly fire). Friendly-fire cells read differently WITHOUT a
  // skull, so a caught own/allied unit is obvious at a glance but not marked with a death's-head.
  _drawHitCell(g, cellX, cellY, hitsAlly, fillA, strokeA, lineW) {
    const tile = this.game.tile;
    g.fillStyle = hitsAlly ? "rgba(235,70,55,0.28)" : `rgba(255,150,60,${fillA})`;
    g.fillRect(cellX * tile, cellY * tile, tile, tile);
    g.strokeStyle = hitsAlly ? "rgba(240,80,60,0.95)" : `rgba(255,170,80,${strokeA})`;
    g.lineWidth = lineW;
    if (hitsAlly) g.setLineDash([5, 3]);
    g.strokeRect(cellX * tile + 1, cellY * tile + 1, tile - 2, tile - 2);
    g.setLineDash([]);
  }
  // The damage forecast written on a hit tile ("-14"), reddish when it is a friendly-fire hit.
  _drawCellDamage(g, cellX, cellY, damage, hitsAlly) {
    const tile = this.game.tile,
      label = "-" + damage;
    g.font = `800 ${Math.max(10, tile * 0.26)}px system-ui`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 3.5;
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(label, cellX * tile + tile / 2, cellY * tile + tile * 0.62);
    g.fillStyle = hitsAlly ? "#ff7a68" : "#ffd08a";
    g.fillText(label, cellX * tile + tile / 2, cellY * tile + tile * 0.62);
    g.textBaseline = "alphabetic";
  }
  // "⚠ may deviate" above a tile — war engines can drift a tile off target.
  _drawDeviateWarning(g, tx, ty, label) {
    const tile = this.game.tile;
    g.font = `700 ${Math.max(9, tile * 0.19)}px system-ui`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(label, tx * tile + tile / 2, ty * tile - 2);
    g.fillStyle = "#ffcf8a";
    g.fillText(label, tx * tile + tile / 2, ty * tile - 2);
    g.textBaseline = "alphabetic";
  }

  // Grapeshot: the cone's tiles, each caught unit at full damage.
  _intentGrapeshot(g, attacker, target) {
    const seen = new Set();
    for (const cell of this.game._grapeshotCone(attacker, target.tx, target.ty)) {
      const cellX = cell.tx,
        cellY = cell.ty,
        cellKey = cellX + "," + cellY;
      if (seen.has(cellKey) || !this.game.inBounds(cellX, cellY)) continue;
      seen.add(cellKey);
      const e = this.game.unitAt(cellX, cellY),
        hitsAlly = !!(e && !e.dead && e.team === attacker.team);
      this._drawHitCell(g, cellX, cellY, hitsAlly, 0.24, 0.8, 2);
      if (e && !e.dead)
        this._drawCellDamage(
          g,
          cellX,
          cellY,
          shownDamage(e.hp, this.game.computeDamage(attacker, e, { weapon: 24 })),
          hitsAlly,
        );
    }
  }

  // Shock: the 4 tiles around the ballista.
  _intentShock(g, attacker, target) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cellX = attacker.tx + dx,
        cellY = attacker.ty + dy;
      if (!this.game.inBounds(cellX, cellY)) continue;
      const e = this.game.unitAt(cellX, cellY),
        hitsAlly = !!(e && !e.dead && e.team === attacker.team);
      this._drawHitCell(g, cellX, cellY, hitsAlly, 0.24, 0.8, 2);
      if (e && !e.dead)
        this._drawCellDamage(
          g,
          cellX,
          cellY,
          shownDamage(e.hp, this.game.hitForecast(attacker, e, target.tx, target.ty)),
          hitsAlly,
        );
    }
  }

  // siege Barrage / Blast Area / Fireball — area hit
  _intentBlast(g, attacker, target) {
    // friendly fire is REAL — the blast hits your own units too, so flag ally cells in red

    // Blast shape matches resolveDamage: Lightning is a 3×3 SQUARE; the Ice Field is a 2×2 block; the Wizard's
    // Fireball AND the catapult Rock/Pitch are a + CROSS (blastArea is always false now — all siege blasts cross).
    // (The cannon & trebuchet are single-target — not splash — so this branch never runs for them.)
    const lightning = attacker.T.canLightning && attacker.spell === "lightning";
    const ice = attacker.T.canLightning && attacker.spell === "ice";
    const square = !!attacker.T.blastArea;
    const cells =
      lightning || square
        ? [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ] // Lightning / siege: 3×3
        : ice
          ? [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ] // Ice Field: 2×2 block
          : [
              [0, 0],
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]; // Fireball: + cross
    for (const [dx, dy] of cells) {
      const cellX = target.tx + dx,
        cellY = target.ty + dy;
      if (!this.game.inBounds(cellX, cellY)) continue;
      const primary = dx === 0 && dy === 0,
        e = this.game.unitAt(cellX, cellY);
      const hitsAlly = !!(e && !e.dead && e.team === attacker.team);
      this._drawHitCell(g, cellX, cellY, hitsAlly, 0.2, 0.7, primary ? 2.5 : 1.5);
      // any occupied cell shows its damage at its real blast share (startAreaAttack): centre 100%, the cross Rock 50 / Pitch 40 / Fireball 60, Lightning 55, Ice 100
      if (e && !e.dead)
        this._drawCellDamage(
          g,
          cellX,
          cellY,
          shownDamage(e.hp, this.game.hitForecast(attacker, e, target.tx, target.ty)),
          hitsAlly,
        );
    }
    // war engines can drift off target — warn the shot may deviate a tile
    if (attacker.T.mayDeviate) this._drawDeviateWarning(g, target.tx, target.ty, "⚠ " + tr("may deviate"));
  }

  // SINGLE-SHOT SIEGE (Trebuchet boulder, Cannonball, Ballistae bolt): mark the tile the shot lands on — empty
  // ground included — and, for the Ballistae's Piercing Bolt, the two tiles behind it along the firing line that
  // the bolt punches through (_ballistaStep — the original's angle rule; only beyond range 1).
  _intentSingleShot(g, attacker, target) {
    const tile = this.game.tile;
    const cells = [[target.tx, target.ty, true]];
    const pierceStep = attacker.T.pierce ? this.game._ballistaStep(attacker, target.tx, target.ty) : null;
    if (pierceStep) {
      const { fx, fy } = pierceStep;
      for (let step = 1; step <= 2; step++) cells.push([target.tx + fx * step, target.ty + fy * step, false]);
    }
    for (const [cellX, cellY, primary] of cells) {
      if (!this.game.inBounds(cellX, cellY)) continue;
      const e = this.game.unitAt(cellX, cellY),
        hitsAlly = !!(e && !e.dead && e.team === attacker.team);
      this._drawHitCell(g, cellX, cellY, hitsAlly, 0.22, 0.8, primary ? 2.5 : 1.5);
      // Arc / Low Arc shots may drift a tile
      if (primary && attacker.T.mayDeviate && this.game._deviationPct(attacker, { tx: cellX, ty: cellY }) > 0)
        this._drawDeviateWarning(
          g,
          cellX,
          cellY,
          "⚠ " + tr("may deviate") + " " + this.game._deviationPct(attacker, { tx: cellX, ty: cellY }) + "%",
        );
      if (primary) {
        // a crosshair on the aim point
        const cx = cellX * tile + tile / 2,
          cy = cellY * tile + tile / 2,
          r = tile * 0.22;
        g.strokeStyle = "rgba(255,200,120,0.95)";
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(cx, cy, r, 0, 6.29);
        g.moveTo(cx - r * 1.5, cy);
        g.lineTo(cx + r * 1.5, cy);
        g.moveTo(cx, cy - r * 1.5);
        g.lineTo(cx, cy + r * 1.5);
        g.stroke();
      }
      // damage on each caught unit (the aimed tile's number only when this is the free-aim hover — a real target
      // already carries its forecast from _drawTargetNumbers)
      if (e && !e.dead && (!primary || !target.type))
        this._drawCellDamage(
          g,
          cellX,
          cellY,
          shownDamage(e.hp, this.game.hitForecast(attacker, e, target.tx, target.ty)),
          hitsAlly,
        );
    }
  }

  // the charge RIDES ON through the foot soldiers it cuts down (_chargeRun)
  _intentChargeRide(g, attacker, target) {
    const tile = this.game.tile;
    const foot = (e) => e.T.al === 1 || e.T.al === 2,
      chargeDir = attacker.chargeDir,
      moveBudget = this.game.moveOf(attacker);
    let spent =
      (attacker.chargeSpent || 0) +
      this.game._chargeStep(attacker, attacker.tx, attacker.ty, target.tx, target.ty, chargeDir);
    let alive = this.game.computeDamage(attacker, target, { charge: true }) < target.hp,
      cur = target;
    while (!alive && foot(cur)) {
      // predicted kill of a foot soldier → preview the next foe in the lane
      let x = cur.tx,
        y = cur.ty,
        next = null;
      for (;;) {
        const nx = x + chargeDir.dx,
          ny = y + chargeDir.dy;
        if (!this.game.inBounds(nx, ny)) break;
        spent += this.game._chargeStep(attacker, x, y, nx, ny, chargeDir);
        if (spent > moveBudget) break;
        const e = this.game.unitAt(nx, ny);
        if (e && e.team !== attacker.team) {
          next = e;
          break;
        }
        x = nx;
        y = ny;
      }
      if (!next) break;
      const cellX = next.tx * tile,
        cellY = next.ty * tile,
        damage = this.game.computeDamage(attacker, next, {}); // the +30 is spent on the first hit
      g.fillStyle = "rgba(255,206,84,0.24)";
      g.fillRect(cellX, cellY, tile, tile);
      g.strokeStyle = "rgba(255,206,84,0.95)";
      g.lineWidth = 2.5;
      g.strokeRect(cellX + 2, cellY + 2, tile - 4, tile - 4);
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(cur.tx * tile + tile / 2, cur.ty * tile + tile / 2);
      g.lineTo(cellX + tile / 2, cellY + tile / 2);
      g.stroke();
      g.setLineDash([]);
      g.font = `800 ${Math.max(10, tile * 0.28)}px system-ui`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(0,0,0,0.85)";
      g.strokeText("⚡-" + shownDamage(next.hp, damage), cellX + tile / 2, cellY + tile * 0.34);
      g.fillStyle = damage >= next.hp ? "#ff5544" : "#ffce54";
      g.fillText("⚡-" + shownDamage(next.hp, damage), cellX + tile / 2, cellY + tile * 0.34);
      g.textBaseline = "alphabetic";
      alive = damage < next.hp;
      cur = next;
    }
  }

  // The army colour a unit's heraldry is painted: your heraldry tint (blue default), each enemy faction its
  // strength colour, a lone enemy red.
  _armyColor(u) {
    // UNIT tint (footprint band): the colour the unit is actually painted — its palette-swap primary ramp (your own
    // army: your heraldry's symbol colour). Other groups without a swap wear their banner tincture; banner 0 falls
    // back to the group's strength colour.
    const ramps = this._unitRamps(u); // the colour its units are actually painted (primary ramp, top shade)
    if (Array.isArray(ramps)) {
      const rampColor = UNIT_RAMPS[ramps[0]][0];
      return `${rampColor >> 16},${(rampColor >> 8) & 255},${rampColor & 255}`;
    }
    const group = this.game._groupMeta(u);
    // REAL per-group field tincture (decoded from group attrs[1]) — universal for EVERY faction, banner or not.
    // This is the heraldic FIELD tint (distinct from the strength/HP colour): Carrone gules, Aguilleon or,
    // Horselords sable, the tribes or, etc. HP stays the ally/enemy strength colour (two-colour system). #Q1
    if (group && group.bgColor && TINCTURE_RGB[group.bgColor]) return TINCTURE_RGB[group.bgColor];
    if (group && group.banner != null && BANNER_TINCTURE[group.banner]) return BANNER_TINCTURE[group.banner];
    const heraldry = group && factionHeraldry(group.name);
    if (heraldry) return heraldry.field;
    return this.game._factionColor(u);
  }
  // The original's two unit colours for an AI group: [primary, secondary] tincture = its heraldry [symbolColor,
  // bgColor] (scenario attrs[0], attrs[1]); "none" = a 0xff group that keeps the unrecoloured art; null = no
  // heraldry record (legacy maps) → the hue fallback. The player's own army keeps its green (handled by the caller).
  _unitRamps(u) {
    const group = this.game._groupMeta(u);
    // your heraldry (setupTeamColors); `paint` = a hot-seat army's own colours, which stay put as the teams swap
    if (((u.paint || u.team) === "blue" && !u.ally) || (group && group.side === "player"))
      return this.game.playerRamps || null;
    if (!group) return null;
    if (group.noRecolor) return "none";
    return UNIT_RAMPS[group.symbolColor] && UNIT_RAMPS[group.bgColor] ? [group.symbolColor, group.bgColor] : null;
  }
  // Context::createUnitImages: swap the three primary key greens and three secondary key blues for the group's two
  // 3-shade ramps — an exact per-pixel palette swap (the unit art carries exactly these six keys), cached by `key`.
  _paletteSwapped(img, key, primary, secondary) {
    if (!img || !img.width) return img;
    const cache = RECOLOR_CACHE;
    if (cache[key]) return cache[key];
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx2d = canvas.getContext("2d");
    ctx2d.drawImage(img, 0, 0);
    let imageData;
    try {
      imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      cache[key] = img;
      return img;
    }
    const map = new Map(),
      ramp = UNIT_RAMPS[primary],
      S = UNIT_RAMPS[secondary];
    for (let k = 0; k < 3; k++) {
      map.set(UNIT_KEY_PRIMARY[k], ramp[k]);
      map.set(UNIT_KEY_SECONDARY[k], S[k]);
    }
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 12) continue;
      const swapTo = map.get((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      if (swapTo === undefined) continue;
      pixels[i] = swapTo >> 16;
      pixels[i + 1] = (swapTo >> 8) & 255;
      pixels[i + 2] = swapTo & 255;
    }
    ctx2d.putImageData(imageData, 0, 0);
    cache[key] = canvas;
    return canvas;
  }
  // Return `img` with only its TEAM-COLOUR tabard recoloured to `hueDeg`, cached by `key`. The base art is
  // blue+green; ONLY the blue team band (the tabard / cape / shield) is swapped to the army colour — green
  // trim, gold, skin, steel and leather keep their own colour. (Recolouring every saturated pixel turned
  // multi-coloured sprites like the Hero into a solid purple blob.)
  _recolored(img, key, hueDeg) {
    if (!img || !img.width) return img;
    const cache = RECOLOR_CACHE;
    if (cache[key]) return cache[key];
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx2d = canvas.getContext("2d");
    ctx2d.drawImage(img, 0, 0);
    let imageData;
    try {
      imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      cache[key] = img;
      return img;
    }
    const pixels = imageData.data,
      hue = (((hueDeg % 360) + 360) % 360) / 360;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 12) continue;
      const red = pixels[i],
        green = pixels[i + 1],
        blue = pixels[i + 2],
        mx = Math.max(red, green, blue),
        mn = Math.min(red, green, blue);
      if (mx === mn) continue;
      const light = (mx + mn) / 510,
        sat = light > 0.5 ? (mx - mn) / (510 - mx - mn) : (mx - mn) / (mx + mn);
      if (sat < 0.33) continue; // low saturation → skin / steel / leather: leave it
      const srcHue = rgbHue(red, green, blue); // ONLY the blue team band; green(~120)/gold(~48)/red/skin stay
      if (srcHue < 188 || srcHue > 272) continue;
      const [newR, newG, newB] = hslToRgb(hue, sat, light);
      pixels[i] = newR;
      pixels[i + 1] = newG;
      pixels[i + 2] = newB;
    }
    ctx2d.putImageData(imageData, 0, 0);
    cache[key] = canvas;
    return canvas;
  }
  // One unit: its shadow and army-colour footprint, the sprite (walk / stand / battle frame, recoloured to its army),
  // the hit flash, then the HP number and the badges. A slain unit simply leaves the field — no death animation
  // (it stays in the array a moment for casualty tallying, but isn't drawn).
  _drawUnit(g, u) {
    if (u._teleporting) return; // mid-blink: the wizard is on NEITHER cell (only the arcane shimmer shows)
    if (u.dead) return;
    const tile = this.game.tile;
    const { img, sx, sw, sh, dw, dh, moving, walkPair } = this._unitFrame(u);
    const cx = u.px + tile / 2,
      baseY = u.py + tile - dh;
    let shoveX = 0,
      shoveY = 0;
    if (u.shove) {
      const k = Math.max(0, u.shove.t / 0.2) * tile * 0.16;
      shoveX = u.shove.dx * k;
      shoveY = u.shove.dy * k;
    }
    let bobY = 0,
      swayX = 0;
    if (moving) {
      const prog = this.game.anim.seg + this.game.anim.t;
      // Units with a real walk cycle animate their own legs, so they need only a whisper of bob; the wizard (no
      // walk sheet) still glides, so it keeps the fuller hop that sells movement without a leg cycle.
      const bobAmp = walkPair ? 0.03 : 0.09;
      bobY = -Math.abs(Math.sin(prog * Math.PI * 3)) * tile * bobAmp;
      swayX = Math.sin(prog * Math.PI * 3) * tile * (walkPair ? 0.008 : 0.02);
    }
    g.save();
    g.translate(cx + shoveX, baseY + shoveY);
    this._drawUnitFootprint(g, u, dw, dh);
    g.globalAlpha = 1;
    if (u.acted && u.team === "blue" && !u.ally && this.game.phase === "player") g.globalAlpha = 0.55; // grey out only YOUR own units that have acted — never enemy/ally units
    g.translate(swayX, bobY);
    const flip = (u.face || ((u.paint || u.team) === "blue" ? 1 : -1)) < 0;
    if (flip) g.scale(-1, 1);
    g.drawImage(img, sx, 0, sw, sh, -dw / 2, 0, dw, dh);
    if (u.flash) {
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = `rgba(255,255,255,${u.flash * 3})`;
      g.fillRect(-dw / 2, 0, dw, dh);
      g.globalCompositeOperation = "source-over";
    }
    g.restore();
    this._drawHP(g, u);
    this._drawUnitBadges(g, u);
  }

  // Which image and source rectangle to draw for a unit now, and at what size. A moving unit plays its real 4-frame
  // WALK cycle (if it has one); idle draws the stand; attacking draws the battle strip. Wizards (no walk sheet) and
  // any unit mid-attack skip the walk branch. The result is already palette-swapped to the unit's army.
  _unitFrame(u) {
    const T = u.T,
      tile = this.game.tile;
    const frameH = T.frameH;
    // ONE PIXEL SCALE for every unit, feet on the ground line: the unit art is all drawn at the same scale, so
    // UNIT_REF_PX source pixels = one tile (a 64-px footman fills its cell). Taller art — a halberd raised over the
    // head, a pike, a rider — rises out of the cell as in the original, instead of the old fit-each-stand-to-the-
    // tile that shrank the Halberdiers (72 px with the halberd) and blew the Swordsmen (59 px) up to the same size.
    // The HERO is a bigger, imposing figure — drawn ~1.45 tiles tall so it stands out and overhangs its cell
    // (feet stay on the ground line, head rises above), like the original's oversized commander.
    const standImg = this.game.assets.stands ? this.game.assets.stands[u.type] : null;
    // (The Hero has no stand pose — it draws its battle atlas, whose 96-px frames it fills: 1.45 tiles per frame.)
    const px =
      u.type === "king"
        ? (tile * 1.45) / (standImg ? standImg.height : frameH)
        : standImg
          ? tile / UNIT_REF_PX
          : tile / frameH;
    const moving = !!(this.game.anim && this.game.anim.type === "move" && this.game.anim.u === u && !u.attacking);
    const walkPair = moving && this.game.assets.walks ? this.game.assets.walks[u.type] : null;
    let img, sx, sw, sh, dh, dw, mode;
    if (walkPair) {
      img = walkPair[u.paint || u.team];
      const prog = this.game.anim.seg + this.game.anim.t; // tiles travelled so far (continuous)
      // ONE stride (4 frames) per tile. The original steps its walk frame once per drawn frame (Unit::getFrameIndex
      // @0x6593e, counter & 3) under a 100 Hz timer, so its cadence was the device's frame rate, not a set value; two
      // strides a tile here ran the legs at 9–12 strides a second, a heavy Bear's lumber looking frantic.
      const walkFrame = Math.floor(prog * WALK_FRAMES) % WALK_FRAMES;
      sw = WALK_W;
      sh = WALK_H;
      sx = walkFrame * WALK_W;
      dh = WALK_H * px;
      dw = WALK_W * px;
      mode = "w" + (u.paint || u.team);
    } else if (!u.attacking && standImg) {
      img = standImg;
      sx = 0;
      sw = standImg.width;
      sh = standImg.height;
      dh = sh * px;
      dw = sw * px;
      mode = "s";
    } else {
      img = this.game.assets.sheets[u.type][u.paint || u.team];
      sw = T.frameW;
      sh = frameH;
      sx = (u.attacking ? u.anim : 0) * T.frameW;
      dh = frameH * px;
      dw = T.frameW * px;
      mode = "a" + (u.paint || u.team); // padding above the character just overhangs
    }
    // per-army PALETTE SWAP: recolour the heraldry to the army colour (like the original), not a flat wash.
    const ramps = this._unitRamps(u);
    if (Array.isArray(ramps))
      img = this._paletteSwapped(img, u.type + "|" + mode + "|" + ramps.join("/"), ramps[0], ramps[1]);
    else if (ramps !== "none") {
      const armyRgb = this._armyColor(u),
        armyRgbParts = armyRgb.split(",");
      img = this._recolored(
        img,
        u.type + "|" + mode + "|" + armyRgb,
        rgbHue(+armyRgbParts[0], +armyRgbParts[1], +armyRgbParts[2]),
      );
    }
    return { img, sx, sw, sh, dw, dh, moving, walkPair };
  }

  // The shadow and the army-colour band around the feet (the context is translated to the unit's top-centre).
  _drawUnitFootprint(g, u, dw, dh) {
    g.globalAlpha = 0.26;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(0, dh - 5, dw * 0.24, 4.5, 0, 0, 6.29);
    g.fill();
    const multiGroup =
      u.team === "red" && this.game.mission.enemyGroups && Object.keys(this.game.mission.enemyGroups).length > 1;
    const isAlly = u.team === "blue" && u.ally;
    const band = this._armyColor(u); // heraldry banner colour (player = their own tint; groups = banner tincture)
    // Multi-army maps (and allied AI armies): fatten + brighten the footprint so each independent group's
    // colour reads clearly around the feet. Your own single-colour force keeps the thin band.
    const fat = multiGroup || isAlly;
    const rx = dw * (fat ? 0.32 : 0.26),
      ry = fat ? 6 : 5;
    g.globalAlpha = fat ? 0.82 : 0.7;
    g.fillStyle = `rgb(${band})`;
    g.beginPath();
    g.ellipse(0, dh - 6, rx, ry, 0, 0, 6.29);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = fat ? "rgba(0,0,0,0.55)" : `rgb(${band})`;
    g.lineWidth = fat ? 2 : 1.5;
    g.beginPath();
    g.ellipse(0, dh - 6, rx, ry, 0, 0, 6.29);
    g.stroke();
    if (fat) {
      g.strokeStyle = `rgba(255,255,255,0.4)`;
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(0, dh - 7, rx, ry, 0, 0, 6.29);
      g.stroke();
    }
  }

  // The marks around a unit's tile: its one status badge (top-left), the Hero's ★ (top-centre) and the morale "+"
  // (bottom-left). No per-unit group pennant on ANY unit — the original doesn't fly one (confirmed absent in the
  // decompiled unit draw). Separate factions read apart only by their footprint-band colour + the faction name on
  // inspect.
  _drawUnitBadges(g, u) {
    const tile = this.game.tile;
    const badge = this.game.assets.statusIcons ? this._statusBadge(u) : -1;
    if (badge >= 0) {
      // STATUS BADGE (android units/067, 13 icons @52px — the game's own high-res effect icons)
      const ICON_PX = 52; // 067 frame is 52×52
      const size = tile * 0.32,
        smoothing = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = true; // smooth (high-quality) downscale of the 52px icon — nearest-neighbor looked degraded
      g.drawImage(
        this.game.assets.statusIcons,
        badge * ICON_PX,
        0,
        ICON_PX,
        ICON_PX,
        u.px + tile * 0.03,
        u.py + tile * 0.03,
        size,
        size,
      );
      g.imageSmoothingEnabled = smoothing;
    }
    if (u.hero) {
      const topY = u.py + tile * 0.02;
      g.fillStyle = "#ffd36b";
      g.font = `700 ${Math.max(11, tile * 0.26)}px system-ui`;
      g.textAlign = "center";
      g.textBaseline = "top";
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 3;
      g.strokeText("★", u.px + tile / 2, topY);
      g.fillText("★", u.px + tile / 2, topY);
    }
    if (this.game.hasMorale(u.team)) {
      // Morale "+" (help 677) at the BOTTOM-LEFT, clear of the top-edge flags (status left, pennant right) and
      // the centred HP number.
      g.fillStyle = "#ffca6b";
      g.font = `800 ${Math.max(10, tile * 0.22)}px system-ui`;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 3;
      const mx = u.px + tile * 0.05,
        plusY = u.py + tile - 3;
      g.strokeText("+", mx, plusY);
      g.fillText("+", mx, plusY);
    }
  }

  // The ONE status badge a unit shows (an index into the 067 icon strip), or -1 — by the original's priority
  // (Unit::getOneIcon @0x66c50): slowed › Retribution › Pike Wall › Shield › an enemy Spirit Shroud within 4 › an
  // allied Battle Standard within 4. The hero's aura is the LAST thing shown, so it never hides a wall or a prayer.
  _statusBadge(u) {
    if (u.slowed) return 5; // Ice Field (Wizard) — slowed (ice crystals)
    if (this.game._retributioned(u)) return 12; // guarded by a Priest's Retribution (sword)
    if (u.walled) return 0; // Pike Wall braced (spear bundle)
    if (this.game._shielded(u)) return 9; // Priest Shield (blue shield)
    const aura = this.game.ratingAura(u);
    if (aura < 0) return 8; // enemy Spirit Shroud −15 (down)
    if (aura > 0) return 10; // Battle Standard +15 (up)
    return -1;
  }

  // The game shows each unit's HP on a small "unit strength colour" bar — the colour is the ARMY's, so
  // separate factions read apart (help ALLIES). See _strengthColor().
  _strengthColor(u) {
    // HP number = the ally/enemy "unit strength colour" (per-group, from hpByGi). Player green, allies Blue/Cyan,
    // enemies Red/Orange/Yellow — so friend/foe and separate armies read apart at a glance.
    if (this.game.mission.hpByGi) {
      const color = this.game.mission.hpByGi[u.group || 0];
      if (color) return color;
    }
    if (u.team === "blue" && !u.ally) return "96,204,96"; // your army = green (fallback for legacy maps)
    return this.game._factionColor(u);
  }
  _drawHP(g, u) {
    // No background plate — just the HP number, in the army's strength colour with a dark outline so it stays
    // legible over any terrain and factions still read apart (blue = yours, red / band = enemy).
    const tile = this.game.tile,
      rx = u.px + tile - 2,
      y = u.py + tile - 2; // BOTTOM-RIGHT corner (morale "+" sits bottom-left)
    const rgb = this._strengthColor(u);
    g.font = `800 ${Math.max(11, tile * 0.26)}px "SFMono-Regular", Consolas, monospace`;
    g.textAlign = "right";
    g.textBaseline = "alphabetic";
    const txt = String(shownHp(u.hp)); // the screen's HP: floor(HP256·100/256)
    g.lineWidth = 3;
    g.strokeStyle = "rgba(12,10,8,0.9)";
    g.lineJoin = "round";
    g.strokeText(txt, rx, y); // dark outline for contrast
    g.fillStyle = `rgb(${rgb})`;
    g.fillText(txt, rx, y); // strength-colour number
  }

  // One shot in flight, at progress f = t / dur along the original's parabola (peak = arc). Each kind draws itself
  // centred on the origin of the translated context; the art is the projectile atlas `this.assets.proj`, with a
  // procedural fallback when a sprite failed to load.
  _drawProjectile(g, shot) {
    const flight = shot.t / shot.dur,
      arc = shot.arc || 0;
    const x = shot.x + (shot.tx - shot.x) * flight,
      y = shot.y + (shot.ty - shot.y) * flight - 4 * arc * flight * (1 - flight); // the original's parabola (peak = arc)
    // Heading ALONG the arc right now (its tangent): Unit::renderProjectile (iOS Ep2 @0x6fb34) takes the shot's
    // position now and a moment later and picks the direction frame from that slope, so an arrow or a ballista bolt
    // noses up as it climbs and tips down as it falls (only the thrown hammer and area stones tumble instead).
    const tang = Math.atan2(shot.ty - shot.y - 4 * arc * (1 - 2 * flight), shot.tx - shot.x);
    const art = this.game.assets.proj || {};
    g.save();
    g.translate(x, y);
    if (shot.kind === "stone") this._drawStoneShot(g, shot, flight, art);
    else if (shot.kind === "bolt") this._drawBoltShot(g, tang, art);
    else if (shot.kind === "hammer") this._drawHammerShot(g, shot, flight, art);
    else if (shot.kind === "ball" && shot.cannon && art.cannonball) this._drawCannonShot(g, shot, flight, art);
    else if (shot.kind === "ball") this._drawSpellShot(g, shot, flight, art);
    else if (shot.kind === "bullet") this._drawBulletShot(g, shot, art);
    else this._drawArrowShot(g, shot, tang);
    g.restore();
  }

  // Catapult / trebuchet STONE — the higher-res ANDROID sprite (z_019, 3 tumble frames @40px), cycled in flight.
  _drawStoneShot(g, shot, flight, art) {
    if (art.stone) {
      const size = Math.max(14, this.game.tile * 0.42),
        frame = Math.min(2, Math.floor(flight * 3));
      g.rotate((shot.spin || 0) + flight * 5);
      g.imageSmoothingEnabled = true;
      g.drawImage(art.stone, frame * 40, 0, 40, 40, -size / 2, -size / 2, size, size);
      return;
    }
    // procedural fallback: a lumpy grey boulder
    g.rotate((shot.spin || 0) + flight * 7);
    g.fillStyle = "#6f665c";
    g.strokeStyle = "#413b34";
    g.lineWidth = 1.4;
    const radius = 6,
      outline = [
        [1, 0.15],
        [0.55, 0.85],
        [-0.4, 0.7],
        [-1, 0.05],
        [-0.55, -0.75],
        [0.5, -0.9],
        [0.9, -0.35],
      ];
    g.beginPath();
    outline.forEach(([cx, cy], i) => {
      const px = cx * radius,
        py = cy * radius;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.beginPath();
    g.arc(-1.6, -1.8, 1.9, 0, 6.29);
    g.fill();
  }

  // BALLISTA bolt — an 18-frame direction atlas (36×36), measured from the art: frames 0–8 are the RISING
  // half-circle, sweeping left → up (f4) → right in 20° steps (screen heading −170°, −150° … −10°); frames 9–17 the
  // FALLING half, left → down (f13) → right (+170°, +150° … +10°). Pick the frame whose heading the shot is in.
  _drawBoltShot(g, tang, art) {
    if (art.bolt) {
      const heading = (tang * 180) / Math.PI; // screen heading, y down: −90 = up, +90 = down
      const frame =
        heading < 0
          ? Math.min(8, Math.max(0, Math.floor((heading + 180) / 20)))
          : 9 + Math.min(8, Math.max(0, Math.floor((180 - heading) / 20)));
      const size = Math.max(18, this.game.tile * 0.62);
      g.imageSmoothingEnabled = true;
      g.drawImage(art.bolt, frame * 36, 0, 36, 36, -size / 2, -size / 2, size, size);
      return;
    }
    // fallback: a simple teal quarrel
    g.rotate(tang);
    const length = Math.max(12, this.game.tile * 0.4);
    g.strokeStyle = "#3fd8d8";
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-length * 0.6, 0);
    g.lineTo(length * 0.5, 0);
    g.stroke();
  }

  // CRAFTSMEN thrown hammer — tumbles end-over-end. Two 4-frame sheets (22×22) played as one 8-frame spin,
  // cycling fast in flight; falls back to a small spinning wedge if the art is missing.
  _drawHammerShot(g, shot, flight, art) {
    if (art.hammerA && art.hammerB) {
      const spin = Math.floor(flight * 16) % 8; // ~2 full tumbles over the throw
      const img = spin < 4 ? art.hammerA : art.hammerB,
        frame = spin % 4;
      const size = Math.max(14, this.game.tile * 0.5);
      g.imageSmoothingEnabled = true;
      g.drawImage(img, frame * 22, 0, 22, 22, -size / 2, -size / 2, size, size);
      return;
    }
    g.rotate((shot.spin || 0) + flight * 18);
    g.fillStyle = "#8a8f98";
    g.fillRect(-2, -6, 4, 12);
    g.fillStyle = "#c9ccd2";
    g.fillRect(-6, -6, 12, 5);
  }

  // CANNON iron ball — the higher-res ANDROID sprite (z_020, 32×32), a slow tumble. (Only called with the sprite.)
  _drawCannonShot(g, shot, flight, art) {
    const size = Math.max(12, this.game.tile * 0.34);
    g.rotate((shot.spin || 0) + flight * 4);
    g.imageSmoothingEnabled = true;
    g.drawImage(art.cannonball, 0, 0, 32, 32, -size / 2, -size / 2, size, size);
  }

  // Wizard's flying spell — fireball = the higher-res ANDROID rotating fireball (z_018, 5 frames @64px);
  // ice / lightning = the iOS blue bolts (ui/007 / ui/008, 5 frames @28px). DELIBERATE DEVIATION — the Ice Field's
  // bolt: in the original the frost (5017 #7) appears on the target with nothing flying (state 5, no projectile).
  _drawSpellShot(g, shot, flight, art) {
    const spell = shot.spell || "fireball";
    const isFire = spell === "fireball";
    const mimg = isFire ? art.fireball : spell === "lightning" ? art.spellbolt2 : art.spellbolt;
    if (!mimg) {
      g.fillStyle = "#0d1117";
      g.beginPath();
      g.arc(0, 0, 4, 0, 6.29);
      g.fill();
      return;
    }
    const frameW = isFire ? 64 : 28,
      frames = 5;
    const frame = isFire ? Math.floor(shot.t * 22) % frames : Math.min(frames - 1, Math.floor(flight * frames));
    const size = Math.max(16, this.game.tile * (isFire ? 0.6 : 0.55));
    const glow = isFire
      ? "rgba(255,150,44,0.55)"
      : spell === "lightning"
        ? "rgba(210,235,255,0.6)"
        : "rgba(120,200,255,0.6)";
    g.globalAlpha = 0.6;
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, size * 0.26, 0, 6.29);
    g.fill();
    g.globalAlpha = 1;
    if (isFire) g.rotate((shot.spin || 0) + flight * 3);
    else g.rotate(shot.ang || 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(mimg, frame * frameW, 0, frameW, frameW, -size / 2, -size / 2, size, size);
  }

  // MUSKET ball — a lead pellet with a bright tracer streak behind it so the shot reads clearly (it flies fast).
  _drawBulletShot(g, shot, art) {
    const size = Math.max(11, this.game.tile * 0.3);
    g.rotate(shot.ang || 0);
    g.globalAlpha = 0.75;
    g.strokeStyle = "rgba(255,228,150,0.95)";
    g.lineWidth = Math.max(2, size * 0.22);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-size * 1.9, 0);
    g.lineTo(-size * 0.25, 0);
    g.stroke();
    g.globalAlpha = 1;
    g.lineCap = "butt";
    if (art.bullet) {
      g.imageSmoothingEnabled = true;
      g.drawImage(art.bullet, 0, 0, 32, 32, -size / 2, -size / 2, size, size);
    } else {
      g.fillStyle = "#f2d98c";
      g.beginPath();
      g.arc(0, 0, size * 0.34, 0, 6.29);
      g.fill();
    }
  }

  // Arrows fly the higher-res ANDROID in-flight sprite (z_014 green-nock / z_015 flaming, 48×48), oriented to
  // the shot so the head leads. Archers' Fire Arrows use the flaming strip; a faint ember trails behind it.
  _drawArrowShot(g, shot, tang) {
    const arrowArt = this.game.assets.arrows || {};
    const img = shot.fire ? arrowArt.fire : arrowArt.normal;
    g.rotate(tang);
    if (!img) {
      // fallback line if the sprite failed to load
      g.strokeStyle = shot.fire ? "#ff9a3c" : "#cdb488";
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-7, 0);
      g.lineTo(6, 0);
      g.stroke();
      return;
    }
    const size = Math.max(20, this.game.tile * 0.66);
    if (shot.fire) {
      // ember glow behind the flaming arrowhead
      g.globalAlpha = 0.55;
      g.fillStyle = "rgba(255,150,44,0.75)";
      g.beginPath();
      g.arc(size * 0.28, 0, 2.6, 0, 6.29);
      g.fill();
      g.globalAlpha = 1;
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, 48, 48, -size / 2, -size / 2, size, size); // z_014/015: head points +x → rotated to flight dir
  }

  _drawParticle(g, particle) {
    if (particle.t < 0) return;
    const k = particle.t / particle.life,
      fade = 1 - k;
    if (particle.ring) {
      // expanding shockwave ring
      const r = particle.rMax * (0.2 + 0.8 * k);
      g.globalAlpha = fade * 0.55;
      g.strokeStyle = "#efe2bf";
      g.lineWidth = Math.max(1, 3 * fade);
      g.beginPath();
      g.arc(particle.x, particle.y, r, 0, 6.2832);
      g.stroke();
      g.globalAlpha = 1;
      return;
    }
    if (particle.smoke) {
      // rising smoke puff
      g.globalAlpha = fade * 0.32;
      g.fillStyle = "#5b544c";
      g.beginPath();
      g.arc(particle.x, particle.y, particle.r * (1 + k * 1.4), 0, 6.2832);
      g.fill();
      g.globalAlpha = 1;
      return;
    }
    g.globalAlpha = fade;
    g.fillStyle = particle.color; // debris chunk
    g.beginPath();
    g.arc(particle.x, particle.y, particle.r * (0.6 + 0.4 * fade), 0, 6.2832);
    g.fill();
    g.globalAlpha = 1;
  }

  _drawFloater(g, floater) {
    const k = floater.t / floater.life;
    g.globalAlpha = 1 - k;
    g.font = `700 ${floater.crit ? 16 : 13}px system-ui, sans-serif`;
    g.textAlign = "center";
    const txt = typeof floater.text === "string" ? tr(floater.text) : floater.text; // word floaters ("Pike Wall!", "Deviated!") are translated
    const label = floater.heal ? txt : "-" + txt;
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.strokeText(label, floater.x, floater.y);
    g.fillStyle = floater.heal ? "#7be08a" : floater.crit ? "#ffca6b" : "#ffffff";
    g.fillText(label, floater.x, floater.y);
    g.globalAlpha = 1;
  }

  // Is anything the player must see inside the minimap's box (view space)? The cursor, or a living unit that is drawn
  // (a hidden foe doesn't count — fading for it would give it away) — its tile plus the sprite's height above.
  _underMinimap(boxX, boxY, boxW, boxH) {
    const game = this.game,
      tile = game.tile;
    const hits = (x0, y0, x1, y1) => x1 > boxX && x0 < boxX + boxW && y1 > boxY && y0 < boxY + boxH;
    const pt = game.hoverPx;
    if (pt && hits(pt.x, pt.y, pt.x + 1, pt.y + 1)) return true;
    for (const u of game.units) {
      if (u.dead || (u.team === "red" && game._isHidden(u))) continue;
      const x = u.px - game.cam.x,
        y = u.py - game.cam.y;
      if (hits(x, y - tile * 0.4, x + tile, y + tile)) return true;
    }
    return false;
  }
  // Small minimap so the player always knows where the camera is on a big map.
  _drawMinimap(g) {
    if (this.game.world.w <= this.game.view.w + 4 && this.game.world.h <= this.game.view.h + 4) return; // fits: no map needed
    const pad = 8,
      mapW = Math.min(150, this.game.cols * 5),
      cellPx = mapW / this.game.cols,
      mapH = this.game.rows * cellPx;
    const mapX = this.game.view.w - mapW - pad,
      mapY = pad;
    // A unit (or the cursor) under the minimap fades it almost out, so nothing on the field is hidden behind it;
    // it eases back once the corner is clear.
    const covered = this._underMinimap(mapX - 3, mapY - 3, mapW + 6, mapH + 6);
    const target = covered ? 0.15 : 0.9;
    this._mmAlpha = this._mmAlpha == null ? target : this._mmAlpha + (target - this._mmAlpha) * 0.25;
    g.save();
    g.globalAlpha = this._mmAlpha;
    g.fillStyle = "rgba(12,14,20,0.72)";
    g.fillRect(mapX - 3, mapY - 3, mapW + 6, mapH + 6);
    const MMCOL = {
      water: "#2b4a66",
      wall: "#8f8574",
      keep: "#c49e4a",
      village: "#a5643c",
      road: "#b79b62",
      forest: "#2e5c2e",
      hill: "#8a8278",
      grass: "#5c9044",
    };
    for (let y = 0; y < this.game.rows; y++)
      for (let x = 0; x < this.game.cols; x++) {
        const tileVal = this.game.tileAt(x, y),
          props = tileProp(tileVal);
        g.fillStyle =
          (props.passable ? MMCOL[tileCategory(tileVal)] : props.category === "water" ? "#24405c" : "#4a4640") ||
          "#5c9044";
        g.fillRect(mapX + x * cellPx, mapY + y * cellPx, Math.ceil(cellPx), Math.ceil(cellPx));
      }
    for (const u of this.game.units) {
      if (u.dead || this.game.hsMusterHidden(u)) continue;
      g.fillStyle = (u.paint || u.team) === "blue" ? "#5aa0ff" : "#ff5a4a";
      g.fillRect(mapX + u.tx * cellPx - 0.5, mapY + u.ty * cellPx - 0.5, Math.max(2, cellPx), Math.max(2, cellPx));
    }
    // viewport rectangle
    const viewX = mapX + (this.game.cam.x / this.game.world.w) * mapW,
      viewY = mapY + (this.game.cam.y / this.game.world.h) * mapH;
    const viewW = (this.game.view.w / this.game.world.w) * mapW,
      viewH = (this.game.view.h / this.game.world.h) * mapH;
    g.strokeStyle = "#ffd36b";
    g.lineWidth = 1.5;
    g.strokeRect(viewX, viewY, viewW, viewH);
    g.restore();
  }
}
