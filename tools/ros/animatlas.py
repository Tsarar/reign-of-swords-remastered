# -*- coding: utf-8 -*-
"""
animatlas.py - emit the data behind public/ros-atlas/anim.html (the ANIMATIONS atlas):

  * every strip of the in-battle animation list (resource 5017) of BOTH episodes, extracted to
    public/ros-atlas/anim/ep<N>/NN_fwW_fhH.png (via anim.py) with its frame size and the use read from
    Unit::changeState's cast dispatcher (@0x6bd80) and the projectile / hit states (see anim.py's legend);
  * the recreation's effect table (FX_TYPES in src/reign-of-swords/ros-data.js) - which strip the engine plays for
    what, with its frame layout and the note that names the source strip;
  * the unit attack strips the engine animates (UNIT_TYPES: sprite sheet, frame count, hit frame) and the walk cycles;
  * every multi-frame sheet of the raw extraction (MANIFEST.json) with what the recreation does with it - including the
    UNUSED ones (Android-only strips with no iOS counterpart, sheets with no confirmed use in either binary).

  python animatlas.py            -> public/ros-atlas/anim.json (+ the extracted strips)
"""
import os, re, json
from anim import entries

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'ros-atlas')

# 5017 index -> use (Episode II numbering; read from Unit::changeState @0x6bd80 and the shoot / hit states)
USE = {0: 'Greater Shapeshift bloom (druids)', 1: 'Wizard Teleport shimmer', 2: 'death skull', 3: 'Heal sparkle on the healed unit (state 18) and over a draining Blood Gorger (state 29)',
       4: 'Spirit Shroud spear-spirit, facing left', 5: 'Spirit Shroud spear-spirit, facing right', 6: 'Shield dome (Prayer, sound 22)',
       7: 'Ice Field (also renderOverlay)', 8: 'sword of light (the Retribution smite, state 14)', 9: 'Retribution angel (sound 10)', 10: 'unsummon flame (sacrifice / leash death, sound 54)',
       11: 'Conjure pentagram (sound 55)', 12: 'dust ring (a structure an area attack brings down; Build site, quicksand cells)', 13: 'Craftsmen splinters + rubble (Build / Repair, sound 53)',
       14: 'Quicksand sand skull (Dune Sirens cast, sound 22)', 15: 'Absorb flash (Conjurer)', 16: 'blade swoosh, left (army-screen preview only)', 17: 'blade swoosh, right (army-screen preview only)',
       18: 'thrust / charge streak (army-screen preview only)', 19: 'thrust / charge streak (army-screen preview only)', 20: 'thrown hammer (Craftsmen, sound 50)', 21: 'thrown hammer', 22: 'arrow', 23: 'fire arrow (ability 9)',
       24: 'musket bullet (sound 21)', 25: 'catapult rocks (Rocks, weapon 20)', 26: 'fireball', 27: 'grey rock (the Trebuchet Boulder, weapon 21)', 28: 'cannonball (Cannon, weapon 23)',
       29: 'piercing bolt (Ballistae)', 30: 'slash on a unit struck by a blade (also over a unit stepping into quicksand)', 31: 'slash (unused)', 32: 'blood burst (Spear / Pike / Druid Lance blow)', 33: 'blood burst (other facing)', 34: 'earth burst (catapult rocks)',
       35: 'explosion (Fireball)', 36: 'rock burst (Trebuchet Boulder)', 37: 'fire burst (Cannonball)', 38: 'bolt impact (Ballistae, sound 52)', 39: 'burning tiles (Map::renderBurning - never switched on)', 40: 'glow on the cells of an aimed Boulder / Cannonball (state 7)',
       41: 'burning unit overlay (Unit+0x80 is never set - never shown)', 42: 'Grapeshot muzzle blast', 43: 'Grapeshot muzzle blast', 44: 'Grapeshot muzzle blast', 45: 'Grapeshot muzzle blast', 46: 'white swirl - unused in both binaries', 47: 'lightning (Lightning Storm)',
       48: 'cannon muzzle sparks (never drawn)', 49: 'cannon muzzle sparks (never drawn)', 50: 'portrait frame', 51: 'unknown-unit icon'}


def ep1_index_to_ep2(i):
    """Ep1 strips = Ep2 strips minus 6 from #16 on and minus 9 from #34 on (round 7b strip trace)."""
    if i >= 25:
        return i + 9
    if i >= 16:
        return i + 6
    return i


def strips(ep):
    d = os.path.join(OUT, 'anim', 'ep%d' % ep)
    os.makedirs(d, exist_ok=True)
    out = []
    for e in entries(ep, 5017):
        fn = '%02d_fw%d_fh%d.png' % (e['idx'], e['fw'], e['fh'])
        open(os.path.join(d, fn), 'wb').write(e['png'])
        k = e['idx'] if ep == 2 else ep1_index_to_ep2(e['idx'])
        portrait = e['idx'] >= (52 if ep == 2 else 37)
        out.append({'idx': e['idx'], 'file': 'anim/ep%d/%s' % (ep, fn), 'fw': e['fw'], 'fh': e['fh'], 'w': e['w'], 'h': e['h'],
                    'use': 'dialogue portrait' if portrait else USE.get(k, ''), 'ep2idx': None if portrait else k})
    return out


GAME_DATA = os.path.join(ROOT, 'src', 'reign-of-swords', 'data', 'game-data.js')


def fx_table():
    src = open(GAME_DATA, encoding='utf-8').read()
    i = src.index('export const FX_TYPES = {'); j = src.index('\n};', i)
    out, above = [], []
    for line in src[i:j].split('\n'):
        c = re.match(r'\s*//\s?(.*)$', line)
        if c:  # a comment block above an entry is its note when the entry has none of its own
            above.append(c.group(1).strip())
            continue
        m = re.match(r'\s*([a-z_0-9]+):\s*\{([^}]*)\}\s*,?\s*(?://\s*(.*))?$', line)
        if not m:
            above = []
            continue
        name, body, note = m.group(1), m.group(2), (m.group(3) or '').strip() or ' '.join(above)
        above = []
        f = dict(re.findall(r'(\w+):\s*([^,]+)', body))
        srcname = f.get('src', '"%s"' % name).strip('"')
        out.append({'name': name, 'file': 'games/reign-of-swords/fx/%s.png' % srcname, 'frames': int(f.get('frames', 1)), 'f0': int(f.get('f0', 0)),
                    'fw': int(f['frameW']), 'fh': int(f['frameH']), 'dur': float(f.get('dur', 0.5)), 'note': note})
    return out


def unit_table():
    src = open(GAME_DATA, encoding='utf-8').read()
    out = []
    for m in re.finditer(r'^  ([a-z]+): \{\s*name: "([^"]+)",\s*sprite: "([^"]+)",\s*frames: (\d+),\s*frameW: (\d+),\s*frameH: (\d+),\s*hitFrame: (\d+)', src, re.M):
        out.append({'key': m.group(1), 'name': m.group(2), 'file': 'games/reign-of-swords/sprites/%s.png' % m.group(3), 'frames': int(m.group(4)),
                    'fw': int(m.group(5)), 'fh': int(m.group(6)), 'hit': int(m.group(7))})
    return out


# Android effect sheets z_000..z_030 -> what the recreation does with them (from FX_TYPES / render/render notes). None = no
# confirmed use in either binary and not used by the recreation.
ANDROID_FX = {0: 'Greater Shapeshift bloom -> fx nature', 1: 'Wizard Teleport shimmer -> fx arcane_out / arcane_in', 2: 'death skull -> fx skull',
              3: 'heal sparkle (= 5017 #3) -> fx spark', 4: 'Spirit Shroud spear-spirit (same art as 5017 #4/#5; the engine plays the iOS strip)', 5: 'dark dome - Android-only, no iOS counterpart, unused',
              6: 'Ice Shard frost dome (= iOS terrain/002) -> fx ice', 7: 'Ice Field crystal burst -> fx icefield / icespike', 8: 'small frost ring - Android-only, unused',
              9: 'holy sword -> fx holysword', 10: 'small angel - Android-only, unused', 11: 'Retribution angel -> fx angel', 12: 'caster sparkle (= iOS ui/005) -> fx cast',
              13: None, 14: 'arrow in flight (green nock) -> projectile', 15: 'flaming arrow in flight -> projectile', 16: None, 17: None,
              18: 'rotating fireball -> projectile', 19: 'tumbling stone (catapult / trebuchet) -> projectile', 20: 'iron cannonball -> projectile',
              21: 'slash on a unit struck by a blade (= 5017 #30) -> fx slash', 22: 'blood burst (= 5017 #32) -> fx impact',
              23: 'earth burst (= 5017 #34) -> fx dust / plume', 24: 'explosion (= 5017 #35) -> fx blast', 25: 'rock burst (= 5017 #36) -> fx rockblast', 26: 'fire burst (= 5017 #37) -> fx fire',
              27: 'aim glow (= 5017 #40) - unused (the recreation draws its own aim markers)', 28: 'Grapeshot muzzle blast -> fx grapeshot', 29: None, 30: 'Lightning Storm bolt -> fx bolt'}
TERRAIN_USE = {'ios-episode-1/terrain/002': 'Ice Shard frost dome -> fx ice', 'ios-episode-1/terrain/003': 'Ice Field crystals -> fx icefield',
               'ios-episode-2/terrain/001': 'Ice Shard frost dome (Ep2 copy)', 'ios-episode-2/terrain/002': 'Ice Field crystals (Ep2 copy)',
               'android/terrain/001': None, 'android/terrain/002': None, 'android/terrain/003': None, 'android/terrain/004': None, 'android/terrain/005': None,
               'ios-episode-1/terrain/001': None, 'ios-episode-2/terrain/000': None}


def raw_sheets():
    """Every multi-frame sheet of the raw extraction (MANIFEST.json) with what the recreation does with it."""
    man = json.load(open(os.path.join(ROOT, 'public', 'games', 'reign-of-swords', 'extracted', 'MANIFEST.json'), encoding='utf-8'))
    out = []
    for it in man:
        fr = it.get('frames') or 0
        if fr < 2 or it['category'] not in ('effects', 'terrain', 'units'):
            continue
        key = it['path'].rsplit('_', 1)[0]
        game, cat = it['game'], it['category']
        idx = int(re.search(r'(\d{3})_', it['path']).group(1))
        use = ''
        if game == 'android' and cat == 'effects':
            use = ANDROID_FX.get(idx)
        elif cat == 'terrain':
            use = TERRAIN_USE.get(key, None)
        elif game == 'android' and cat == 'units':
            if idx == 6: use = 'roster atlas - one upright frame per unit -> the idle poses (sprites/stand)'
            elif fr == 4 and it['frameW'] == 64 and it['h'] == 72: use = '4-frame walk cycle -> sprites/walk (played while the unit moves)'
            elif idx < 6: use = None
            else: use = 'attack strip -> sprites/<unit>.png (re-cut to the engine frame)'
        elif game == 'ios-episode-2' and cat == 'units':
            use = 'the 5017 strips / UI of Episode II (shown above)'
        elif game == 'ios-episode-1' and cat == 'units':
            use = 'low-res roster twin of android/units/006' if idx == 17 else 'the 5017 strips of Episode I (shown above)'
        out.append({'path': it['path'], 'file': 'games/reign-of-swords/extracted/' + it['path'], 'game': game, 'cat': cat, 'idx': idx, 'w': it['w'], 'h': it['h'],
                    'frames': fr, 'fw': it['frameW'], 'fh': it['h'], 'use': use or 'no confirmed use in either binary - not used by the recreation', 'used': bool(use) and 'unused' not in use})
    return out


def walk_table():
    d = os.path.join(ROOT, 'public', 'games', 'reign-of-swords', 'sprites', 'walk')
    return [{'key': f[:-4], 'file': 'games/reign-of-swords/sprites/walk/' + f, 'frames': 4, 'fw': 64, 'fh': 72} for f in sorted(os.listdir(d)) if f.endswith('.png')]


if __name__ == '__main__':
    data = {'strips': {'ep2': strips(2), 'ep1': strips(1)}, 'fx': fx_table(), 'units': unit_table(), 'walks': walk_table(), 'raw': raw_sheets()}
    p = os.path.join(OUT, 'anim.json')
    json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', p, 'strips', len(data['strips']['ep2']), '+', len(data['strips']['ep1']), 'fx', len(data['fx']), 'units', len(data['units']), 'walks', len(data['walks']), 'raw', len(data['raw']), 'unused', sum(1 for r in data['raw'] if not r['used']))
