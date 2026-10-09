# Reign of Swords — enemy AI reference (decompiled)

Reverse-engineering notes for the original game's battle AI, recovered from the Android
`classes.dex` (androguard DAD decompilation). Companion to `DATA_REFERENCE.md`.

**Source of truth:** `La/q.y()Z` (the per-unit AI decision), driven by `La/g.a()V` (the main
loop). Full dumps live in the analysis scratchpad as `ai_y.txt` / `ai_driver.txt`.

> Confidence tags below: **[dec]** = read directly from the bytecode; **[inf]** = inferred from
> context / cross-referenced with data; **[opaque]** = present but not fully reconstructable from
> the obfuscated form. A byte-exact port is **not** reliably recoverable — the machine leans on
> ~15 obfuscated per-unit fields and a dozen interlocking helpers (pathfinding, damage, ability
> selection). This doc captures the *decision rules*, which is what a fidelity pass would port.

---

## 1. Shape of the AI

The AI is a **per-unit state machine**, not a global planner. Each unit `La/q` carries an AI role
in the field `bj`. On the AI turn the main loop walks the acting team's units and calls
`u.y()` for each; `y()` runs the one `case bj:` for that unit, and either:

- **commits a move/attack** — sets `x.k` (the board cursor = chosen target tile) and `bs` (the
  move-order/path), transitions state via `b(newState, param)`, and returns `true`; or
- **passes** — returns `false` (`v4 = 0`), and the unit does nothing this tick.

Roles transition within a turn (e.g. *approach → position → attack*), so one unit can pass through
several `bj` states before it acts. This is why our single-pass scoring `aiStep` is a *consolidation*
of the machine, not a 1:1 translation.

### Field glossary (per-unit `La/q`)
| field | meaning | conf |
|---|---|---|
| `bj` | AI role / state (the `case`) | [dec] |
| `ac` | team id (0 = one side) | [dec] |
| `ad` | unit-type index (0..28; 8 Hero, 21 Wizard, 25 Cannon, 28 Bear…) | [dec] |
| `aC` | board position (`a.s`: `.a`=x, `.b`=y) | [dec] |
| `ak` | move range; `aj` | working move/attack range set by `b()` | [dec] |
| `ar` | HP, **0..256** (not 0..100) | [inf] |
| `at` | **AI value ≈ `((cost-50)·50/450)+50`** → 50 cheapest, 100 Hero | [inf] |
| `A`/`B` | candidate **attack-target** tiles (`A.b(i)`=x, `B.b(i)`=y, `A.a()`=count) | [inf] |
| `J[]`/`K` | candidate **move / stand-off** tiles | [inf] |
| `bO` | vector of every unit on the board | [dec] |
| `S` | "already committed / moved this turn" gate | [inf] |
| `L` | magic/spell object (`L.x` power·range, `L.a(u)` spell target tile, `L.f` flag) | [inf] |
| `be`/`bf` | negative-status counters (`>0` ⇒ skip as a target) | [inf] |
| `al` | locomotion class (1/2/3 ≈ foot/cavalry variants) | [inf] |
| `o`/`n` | best-target position / best score scratch | [dec] |

### Helper glossary
| call | meaning | conf |
|---|---|---|
| `h()` | primary target selection (nearest reachable foe); `h(0)` = weapon id | [inf] |
| `a.j.c(p,q)` / `c(u)` | distance between tiles / to a unit | [dec] |
| `x` | the board/sim (`La/n`) | [dec] |
| `x.c(x,y)` | unit occupying a tile | [dec] |
| `x.a(from,to,u,1,rng)` | path-reachability within a range | [inf] |
| `x.d(pos)` | terrain move-cost of a tile (`>=100` ⇒ impassable) | [inf] |
| `P()` | builds `A/B` (attack tiles) + `J/K` (move tiles) via pathfinding | [opaque] |
| `a(D,y)` / `I()` / `i(dir)` | damage of hitting `y` from tile `D` / current-facing damage / set facing | [opaque] |
| `b(state,param)` | transition AI state (with per-state side effects) | [dec] |

---

## 2. The roles (`case bj:`)

`case 1/7/8/11/12/14/default` → `return false` (idle / handled elsewhere; **14 = "retreat", the
fall-back state a unit is *put into*, not decided here**).

### `case 2` — Caster / Druid  *(shapeshift + spell)*  [dec+inf]
If it has a target: temporarily become a **Bear** (`ad=28`, `bK.elementAt(28)`) and test whether it
can reach and melee something (`E()` + walk `A/B`, `e(y)` valid foe, `a(D,y)>0`). If a bear-melee
works it takes it. Otherwise it **picks a spell form by range & power** (`L.x`):
- target far (`c > 5`, spell tile `> 4` away) and enough mana (`ak >= L.x`): `aZ = 26` (Lightning,
  `L.x > 8`) else `28`; a special `L.x==4` case sets `aZ = 20`;
- close in: `aZ = 27`.
Then commits if the spell's tile is path-reachable (`x.d(2,…) <= 4`).
→ **Our AI:** always shifts to Bear; no per-situation form/spell choice.

### `case 3` — Healer  [dec]
Over every friendly unit within heal range (`c <= ak+1`, or `1` once committed), score
**`(256 - ar) · at`** = *missing-HP × value*; keep the max, but only if the healer can actually path
adjacent (`x.a(…, ak+3)`). Commits: move adjacent (or stay) and heal.
→ **Our AI:** identical formula (`(100-hp)·aiValue`). **Faithful.**

### `case 4` — Melee brute  *(attack the strongest)*  [dec]
Over reachable **attack tiles** `A/B`, the occupant `x.c(A[i],B[i])`: if a clean foe (`!aO`,`!aP`,
`be<=0`,`bf<=0`), score **`at · ar`** = *value × HP*; keep max in `o`. **Only commit if
`n >= 25600`** (= value 100 × HP 256 ⇒ a target worth engaging); otherwise pass.
→ **Our AI:** same `value×hp` metric, but **no engage threshold** — it will commit to any foe in
reach. Adding the "don't trade into a trivial target" gate is the main gap here.

### `case 5` — Siege / area  [dec]
Over reachable tiles, **sum** `ar·at` of the foes the blast would cover; commit the shot if the sum
`>= 25600`. (Maximise total enemy value inside the AoE.)
→ **Our AI:** scores blast coverage (`+500` per foe) and *subtracts* friendly-fire — same spirit,
different units; no summed-value threshold.

### `case 6` — Skirmisher / support cohesion  *(rally ↔ retreat)*  [dec+inf]
> **NB — this is NOT the melee advance.** Case 6 is a *cohesion / holding* state for skirmish and
> support units with rally abilities. Its move loop maximises *(allies within 2)* then *(closeness to
> the target)* — which, because "allies within 2" is a loose radius, pulls edge units **inward toward
> their own formation's centre**, never toward the enemy (verified live: a clustered warband under this
> rule jitters in place at its start distance; a line drifts weakly, then oscillates — it does not
> march). The general line-infantry advance is `x()` (below), reached via the driver's `ay=4` path.

With a target in range: count nearby allies (`c<=2`, unblocked) `v5`, threatening foes `v3`, and
foes it can strike `v2`. If **outnumbered** (`v5 < 2` fails, or `v2<=1 && v3<=1`) it holds; else if
`v2<=0 || v2+1<=v3` it **switches to retreat (`b(14)`)**, otherwise rallies (`b(6)`). When not yet
committed and not a caster, it moves to the tile maximising *(allies within 2)* then *(closeness to
the target)*, and its move-tile list `P()` never includes the unit's own (occupied) tile, so it must
step to a neighbour — a cohesion shuffle, not an advance.
→ **Our AI:** we do **not** use case 6 for the melee approach (that's `x()`); the cohesion state is
approximated by the influence map (`support`/`threat`) + a wounded-retreat rule.

### `x()` — Movement executor / **the real melee approach**  [dec]
The driver arms movement (`b(1,0)` → `aj = ak` full range + `P()`) and calls `x()` for any unit with
**no foe in attack-reach** (`A() == null` → driver `ay=4`). `x()` is the unified positioning method
(it also holds the ranged stand-off band for `g(7)|g(8)`, the `ad==14` retreat, and objective-seeking
over `p.v[]` areas), but its **default** for a plain unit with a target is dead simple:
- destination `v6_6` = nearest **objective** tile if the map has any, else the nearest enemy's tile
  `h().aC`;
- then over the reachable tiles `J[]`, **move to the one MINIMISING distance to `v6_6`** (`c(J[i],
  v6_6) < best`) — a greedy **advance-to-contact**, as far as movement allows, every turn.

There is **no cohesion/ally term and no distance gate** — spacing emerges only because occupied tiles
aren't candidates in `J[]`. This is why the original army marches straight at the nearest enemy.

**Distance is by TRAVEL, not straight line.** `x()` reaches its destination with the terrain-aware
pathfinder `x.a` (move-cost flood-fill), so both "which enemy is nearest" and "which tile is closest to
it" are measured in walkable cost, *not* manhattan — an enemy behind a band of rough/forest is farther
than a manhattan-nearer one across open ground. (`a.j.c` itself is manhattan, but it's the reachability
of `x.a` over multiple turns that decides where the army actually flows.) On Carrone 1 the isolated
crossbow+catapult sit in a rough-terrain pocket (manhattan-nearest to the attackers) while the main body
/ pikemen are across an open lane: the original marches at the pikemen, and a manhattan metric wrongly
picks the crossbow.
→ **Our AI:** **faithful** — `aiStep` builds a per-unit terrain-cost flood-fill `pathField` and (a) picks
the nearest enemy by cheapest walk to its adjacency, (b) scores the melee approach by `-pathNear` (travel
cost from the candidate tile to the target). Verified live on the real Carrone 1 deploy: the warband
marches down the open lane at the pikemen (`avgX` 1.8→11.8, dist-to-pikeman 11→2.7) instead of slogging
into the rough toward the manhattan-nearer crossbow; no stacking, engages on contact.

### `case 9` — Ranged stand-off  *(kite)*  [dec]
If not committed and the target is within 9: among candidate tiles at **distance 5 or 6** from the
target (`c == 5 || c == 6`), prefer the one with **no foe between it and the target** (ally/clear
screening) and the largest distance in that band; move there, `b(9)`.
→ **Our AI:** ranged units just add `+dist·30` (prefer max range). Close for range-2 archers, off
for range-7 casters, and it ignores the *screening* rule.

### `case 10` — Attack executor  *(best weapon / ability / facing)*  [dec+opaque]
The low-level "how to hit" state. For a cannon (`h(0)==24`) it tries four facings `{4,8,1,2}` and
keeps the one with max `I()` (computed damage). It then layers **special abilities**: `g(19)|g(22)`
→ `a(25)`; `g(25)` at distance 3–8 → `a(20)` (Fire Arrows); `g(22)` → `a(26)`/`a(27)`. Commits the
chosen weapon+facing (`b(10, weapon)`).
→ **Our AI:** attacks with the unit's single weapon; Fire-Arrows ×2-vs-flammable is modelled in
combat but the AI doesn't *choose* it, and there's no facing optimisation.

### `case 13` — Attack evaluation  [dec]
Not a mover: over the attack tiles, `y = aL[i]` (the foe), if `e(y)` valid compute `a(D,y)` and
record the best (`w=target`, `v=aM[i]`). Always returns `false` — it *stages* the best attack for a
following state.
→ **Our AI:** folded into the single scoring loop.

### `case 15` — Objective-seeker  [dec+inf]
For the objective-holding side: over objective areas (`p.A`, count `p.z`) whose terrain is passable
(`x.d < 100`) and not already own-held, within `[j(), i()]` (min/max reach), **prefer an area with a
foot/cavalry foe (`al ∈ {1,2,3}`) within 6**; move onto it and switch to attack (`b(10)`).
→ **Our AI:** seeks the **nearest** unheld capture point (no "near a foot/cavalry foe" preference).

### Role assignment
Each unit's `bj` is seeded at construction and reassigned during the turn; the type→role mapping is
**[opaque]** (spread across the driver), but behaviourally: casters→2, healers→3, melee→4, siege→5/10,
skirmish/formation→6, ranged→9, objective units→15. **A unit with no foe in attack-reach goes `ay=4`
→ `b(1,0)` + `x()`** — that is the melee march, not case 6. Our `aiStep` reproduces this by branching
on the unit's abilities (`T.heal`, `T.shapeshiftForms`, `T.splash`, `T.range>1`, else melee-advance).

---

## 3. Fidelity scorecard (our AI vs original)

| Behaviour | Match |
|---|---|
| **Approach the NEAREST enemy (`h()`), siege deprioritises flyers** | ✅ **ported 2026-09-16** (was: advance on the strongest) |
| Attack the STRONGEST enemy *in reach* = value × HP | ✅ **tightened 2026-09-17** — now PURE `value×HP`. Removed the authored terrain-defence bias, support/threat safe-ground bias, and pre-striker suicide-avoidance; the original does none of those, so a melee unit now trades into a braced pike wall / First-Striker (that's *why* pikemen counter cavalry). |
| Healer = missing-HP × value, reachable | ✅ same |
| Siege = maximise TOTAL enemy value×HP in the cross-blast | ✅ **tightened 2026-09-17** — was "count foes − friendly-fire dodge"; now sums `value×HP` of enemies in the manhattan-≤1 cross like case 5, with NO friendly-fire dodge (the original doesn't avoid it). |
| Retreat positioning (case 14) | ✅ **ported 2026-09-17** — flee the farthest-moving tile while keeping the band (foe ≤4 → get >5 away; foe far → stay <6). Replaced the influence-map fallback. (The *trigger* — hp<38 & threatened — is still our approximation; the original's is the case-6 skirmisher outnumbered test.) |
| **Objective near a foot/cavalry foe preferred** | ✅ **ported 2026-09-16** (was: nearest only); scoring now pure travel-distance, no influence map |
| Ranged stand-off (case 9) | ✅ **ported 2026-09-17** — stand at distance 5–6 (capped at range) on a CLEAR line (no foe nearer the tile than the target), prefer the largest distance in the band. Verified: an archer settled at distance 5 and shot, never closing. |
| Kite gated on `g(7)||g(8)` (harassers) | ✅ **ported 2026-09-17** — `T.harasser = has 7 or 8`; only harassers kite. **CORRECTION 2026-09-17:** every ranged *weapon* carries 7 or 8 (Longbow/Crossbow/Musket bV=7; **Short Bow bV=8**; siege bV=7), so ALL ranged units are harassers and DO kite — Horse Bowmen included. Its abilities are `[8]` (Shoot-and-Move, from the Short Bow) — the earlier `[]` was an extraction miss of weapon-granted abilities; a first attempt wrongly made it "advance aggressively." It kites (verified live 5421). |
| **Shoot-and-Move(8) = one move + one shot** | ⚠️ **DELIBERATE DEVIATION 2026-09-18 (user fairness call).** The ORIGINAL is a multi-target STRAFING RUN: `d()` gates attacks on `(!S) || !weaponHas7 || g(8)` (a moved unit may still attack iff it lacks Move-or-Shoot or has Shoot-and-Move) and the driver loops `ay=7 (find next in-range foe) → ay=8 (reposition+shoot)` until nothing is in range, so a Short-Bow rider hops between shots hitting every foe it can reach in one turn. The **player cannot** do this (moves once, then shoots), so it was asymmetric. Per user request, `_strafeRun` now does a SINGLE move to the best shooting tile + ONE shot — matching what the player can do. To restore full fidelity, revert `_strafeRun` to the shoot→reposition loop. The player side now AUTO-fires after a shoot-move gallop (`afterMove` in the tap handler). |
| **Charge units avoid PIKEMEN when staging** | ✅ **ported 2026-09-17** — `x()` g15 values pikemen at 25 (`if (v4_65.ad==5) v5_39=25`), so a staging charge lines up on footmen/archers, not into a pike wall. (In-reach, case 4 still attacks the strongest — a charge unit *will* hit a pikeman it can already reach, taking the wall; the avoidance shapes the approach only.) |
| Influence map (support/threat) drives positioning | ✅ **removed from scoring 2026-09-17** — the original has no influence map; all positioning is now distance-based per `x()`. (`infThreat/infSupport` remain only for the approximate retreat trigger.) |
| Don't commit to a low-value target (`n>=25600`) | ❌ role-specific gate (a "brute" role); read literally it means "only attack a full-HP max-value target," which would fire almost never — clearly not the general-melee path, so not ported (general melee attacks any in-reach foe). |
| Druid picks form/spell by range & power | ❌ always Bear (re-creation druids have no ranged cast form) |
| Attack picks best weapon/ability/facing | ❌ single weapon; Fire-Arrows ×2-vs-flammable is auto in combat, not an AI pick |
| **Melee advance = `x()`: move to the reachable tile nearest the target (`h()`/objective)** | ✅ **ported 2026-09-16** — greedy advance-to-contact (verified: from the real Carrone deploy the warband closes 9→~2 over ~3 turns, no stacking, then engages). **Correction:** an earlier pass wrongly attributed the advance to case 6's *allies-within-2* rule; that rule is a cohesion shuffle that pulls edge units inward and does **not** march — the real advance is `x()`. |
| **4-DIRECTIONAL movement** (orthogonal only) | ✅ **ported 2026-09-16** — `P()` expands exactly 4 neighbours (`cg=[-1,1,0,0]`, `ch=[0,0,-1,1]`) and `a.j.c` is manhattan, so units never step diagonally. Was 8-dir (diagonal steps) → wrong reachable set every turn. Fixed in `computeReach` + `pathField`. |
| **Manhattan (orthogonal) combat adjacency** | ✅ **ported 2026-09-16** — range is manhattan `a.j.c`, so melee range 1 = ORTHOGONAL neighbour only (a diagonal foe is distance 2, out of reach). Replaced `cheb`/king-move adjacency in melee range, counters, Pike Wall break, Retribution, charge/trample. (Lightning Storm stays a true 3×3 — `La/q.k` builds all 9 offsets.) |
| **Charge units STAGE, don't close** (`x()` g15) | ✅ **ported 2026-09-16** — a unit with Charge lines up at manhattan 6-7 from a high-value ground foe along a clear straight lane, then gallops the full run-up next turn (verified: the Carrone knight staged at a dist-7 lane, then charged straight into contact). Was: dribbled to contact, never building a run-up. |
| **A charge may run a DIAGONAL lane** (movement is otherwise 4-dir) | ✅ **ported 2026-09-17** — `x()`'s g15 lane test accepts `dx==0 || dy==0 || \|dx\|==\|dy\|`, so a charge can gallop a straight diagonal even though normal movement / melee are orthogonal-only. `computeReach` adds the four diagonal straight rays for Charge units; the charge STRIKE has diagonal reach (chebyshev-1) while normal melee stays manhattan-1 — so a diagonal charge lands the +30 AND draws no counter/pike-wall (the foe at manhattan-2 can't answer). Verified: a knight galloped (2,2)→(5,5) and hit a foe at (6,6) for base+30, taking 0 counter. |

**Verdict (after the 2026-09-16 fidelity pass):** the *core* decision — **approach the nearest foe,
strike the strongest one in reach, kite as ranged, contest objectives ground troops are near** — now
matches the decompiled rules (verified live: a melee unit chose the near-weak foe over the far-strong
one; full enemy turn error-free, warband closes on the nearest blues). Residual **`❌`** items are
either mechanic-limited (druid cast form), auto-handled elsewhere (fire arrows), or of uncertain
calibration (the `25600` engage threshold). A byte-exact port stays out of reach (opaque fields +
`P()`/`h()` helpers), but behaviour is now faithful on every rule that is cleanly recoverable.
