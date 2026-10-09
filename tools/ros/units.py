# -*- coding: utf-8 -*-
"""
units.py - decode the unit table (resource 5010) of either episode and audit the recreation's
combat-data.js against it.

5010 layout (big-endian, verified by consuming the record exactly):
  short n; n x { byte len, name, 15 bytes B[0..14], 3 x (shorts until -1), 6 bytes upgrade slots }
  short width, short rows;  rows x { 4 bytes hdr[minRange, maxRange, ability1, ability2], width x short }
  ... then the terrain data (parsed elsewhere).
B[0] move, B[2] armour, B[3] weapon, B[4] second weapon, B[5]/B[6] ability ids, B[8] rating tier,
lists[0][0] deploy cost. Weapon row hdr[2]/hdr[3] = abilities the weapon itself grants.

    python units.py 2          # table + audit vs src/reign-of-swords/data/combat-data.js
"""
import sys, os, re, json
from rosdat import open_episode

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
IDX2ENGINE = ['militiamen', 'footmen', 'halberdiers', 'swordsmen', 'cavalry', 'pikemen', 'greatswordsmen',
              'knights', 'king', 'griffon', 'archers', 'rangers', 'crossbowmen', 'musketeers', 'horsebowmen',
              'raiders', 'shamans', 'olddruids', 'oldwizards', 'oldpriests', 'druids', 'wizards', 'priests', 'catapult',
              'trebuchet', 'cannon', 'greateagle', 'bear', 'stag', 'craftsmen', 'ballistae', 'conjurer',
              'sapper', 'bodyguard', 'dunesirens', 'bloodgorgers']
RATING = {0: 45, 1: 60, 2: 75, 3: 90, 4: 100, 5: 115}
ENGINE_DROPS = {'ballistae': {3}}     # Shock's Blast Area tag is not shown: Shock is a single point-blank hit in play


class R:
    def __init__(s, b): s.b = b; s.p = 0
    def d(s): v = s.b[s.p]; s.p += 1; return v
    def f(s):
        v = (s.d() << 8) | s.d()
        return v - 65536 if v >= 32768 else v


def decode(ep):
    a = open_episode(ep)
    r = R(a.res(5010))
    n = r.f()
    units = []
    for i in range(n):
        nl = r.d(); name = ''.join(chr(r.d()) for _ in range(nl))
        B = [r.d() for _ in range(15)]           # 15 bytes: B[12..14] are -1 padding
        lists = []
        for _ in range(3):
            L = []
            while True:
                x = r.f()
                if x == -1: break
                L.append(x)
            lists.append(L)
        upg = [r.d() for _ in range(6)]
        units.append({'idx': i, 'name': name, 'key': IDX2ENGINE[i] if i < len(IDX2ENGINE) else 'unit%d' % i,
                      'move': B[0], 'b1': B[1], 'armour': B[2], 'weapon': B[3], 'weapon2': B[4],
                      'abil': [x for x in (B[5], B[6]) if x], 'b7': B[7], 'rating': B[8], 'B': B,
                      'cost': lists[0][0] if lists[0] else None, 'lists': lists, 'upg': upg})
    w = r.f(); rows = r.f()
    weapons = {}
    for wi in range(rows):
        hdr = [r.d() for _ in range(4)]
        data = [r.f() for _ in range(w)]
        weapons[wi + 1] = {'min': hdr[0] or 1, 'max': hdr[1], 'abil': [x for x in hdr[2:4] if x], 'dmg': data}
    S = a.strings()
    return units, weapons, S


def unit_abilities(u, weapons):
    ab = set(u['abil'])
    for wpn in (u['weapon'], u['weapon2']):
        if wpn and wpn in weapons: ab |= set(weapons[wpn]['abil'])
    return sorted(ab)


def load_combat_js():
    src = open(os.path.join(REPO, 'src/reign-of-swords/data/combat-data.js'), encoding='utf-8').read()
    body = src[src.index('export const UNIT_COMBAT = {'):]
    out = {}
    for m in re.finditer(r'^\s*(\w+): \{([^}]*)\}', body, re.M):
        key, fields = m.group(1), m.group(2)
        d = {}
        for f in re.finditer(r'(\w+):(\[[^\]]*\]|true|false|-?\d+)', fields):
            v = f.group(2)
            d[f.group(1)] = json.loads(v) if v[0] in '[-0123456789' else (v == 'true')
        out[key] = d
    return out


def main(ep):
    units, weapons, S = decode(ep)
    abase = S.index('First Strike') - 1          # ability index i -> string[abase + i]
    def aname(i): return S[abase + i] if 0 < abase + i < len(S) else '?%d' % i
    js = load_combat_js()
    print('%-14s %-16s mv arm w1  w2  rat cost abilities' % ('key', 'name'))
    problems = []
    for u in units:
        ab = unit_abilities(u, weapons)
        print('%-14s %-16s %2d %3d %3d %3d %3d %5s %s' % (u['key'], u['name'], u['move'], u['armour'], u['weapon'], u['weapon2'], u['rating'], u['cost'],
              ', '.join('%d %s' % (x, aname(x)) for x in ab)))
        c = js.get(u['key'])
        if not c: continue
        for fld, val in (('move', u['move']), ('armour', u['armour']), ('weapon', u['weapon']), ('weapon2', u['weapon2']), ('rating', u['rating'])):
            if fld in c and c[fld] != val: problems.append((u['key'], fld, c[fld], val))
        if 'abilities' in c and sorted(c['abilities']) != [x for x in ab if x not in ENGINE_DROPS.get(u['key'], ())]: problems.append((u['key'], 'abilities', sorted(c['abilities']), ab))
        wr = weapons.get(u['weapon']); wr2 = weapons.get(u['weapon2'])
        rows_ = [x for x in (wr, wr2) if x]
        ranged = [x for x in rows_ if x['max'] > 1] or rows_      # compare on the RANGED weapon; a melee sidearm never widens the band
        rmin = min([x['min'] for x in ranged] or [1]); rmax = max([x['max'] for x in ranged] or [1])
        if u['key'] == 'cannon': ranged = rows_; rmin, rmax = 1, 1    # engine models the cannon as Grapeshot r1 + Cannonball band via weapon2
        if any(x['max'] == 1 for x in rows_) and c.get('rmin') == 1: rmin = 1        # engine convention: a melee sidearm makes the band start at 1
        if c.get('rmin') not in (None, rmin) or c.get('rmax') not in (None, rmax): problems.append((u['key'], 'range', (c.get('rmin'), c.get('rmax')), (rmin, rmax)))
    print('\nweapon ranges/abilities:')
    for wi, wpn in weapons.items():
        print('  %2d r%d-%d abil=%s' % (wi, wpn['min'], wpn['max'], [aname(x) for x in wpn['abil']]))
    print('\nMISMATCHES vs combat-data.js (%d):' % len(problems))
    for p in problems: print('  ', p)
    js_only = [k for k in js if k not in [u['key'] for u in units]]
    if js_only: print('engine-only keys:', js_only)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 2)
