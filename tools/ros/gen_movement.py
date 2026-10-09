# -*- coding: utf-8 -*-
"""gen_movement.py - write public/games/<ep dir>/movement.json (the original's movement table) for both episodes.

    python gen_movement.py
"""
import os, struct, json
from rosdat import open_episode

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')


def parse(ep):
    buf = open_episode(ep).res(5010)
    u16 = lambda i: struct.unpack_from(">H", buf, i)[0]
    s16 = lambda i: (lambda v: v - 65536 if v >= 32768 else v)(u16(i))
    n = u16(0); o = 2
    for _ in range(n):
        ln = buf[o]; o += 1 + ln + 35
    w = u16(o); rows = u16(o + 2); o += 4 + rows * (4 + 2 * w)
    c = s16(o); o += 2; TT = []
    for _ in range(c):
        sub = s16(o); o += 2; TT.append([s16(o + 2 * k) for k in range(sub)]); o += 2 * sub
    tc = s16(o); o += 2; types = []
    for _ in range(tc):
        o += 4; N = s16(o); o += 2
        for _ in range(N):
            t = s16(o); o += 2; o += 2
            while s16(o) != -1: o += 2
            o += 2
            types.append(t)
    assert o == len(buf)
    return TT, types


for ep, dirn in ((1, 'reign-of-swords'), (2, 'reign-of-swords-2')):
    TT, types = parse(ep)
    rows = [r[1:6] for r in TT]                                # fly, skirmish/foot, formation, cavalry, war engine
    defs = [r[0] for r in TT]                                  # Map::getTileDefense: damage taken there, % (100 = open ground, 110 = water)
    heals = [max(0, r[6]) if len(r) > 6 else 0 for r in TT]    # HP healed at the start of the occupant's turn (houses, keeps)
    links = {str(i): r[10:] for i, r in enumerate(TT) if len(r) > 10}
    out = {
        'note': ('Episode %d movement, decoded from record 5010 (terrain-type table + TerrainInfo tilesets). '
                 'types[tileId] = Map::getTileType; rows[type] = the move cost per movement class '
                 '[fly, skirmish, formation, cavalry, engine] that Map::getMoveCost reads (0 -> 1, 100 = impassable); '
                 'links[type] = the only neighbouring types a ground unit may step between for that type '
                 '(Map::isMoveAllowed: terrain rows longer than 10 fields). '
                 'def[type] = the tile defence Map::getTileDefense returns (damage taken there, %%: 80 = 20%% cover, '
                 '110 = 10%% extra); heal[type] = HP healed on it each turn (field 6).') % ep,
        'types': types, 'rows': rows, 'links': links, 'def': defs, 'heal': heals,
    }
    p = os.path.join(ROOT, 'public', 'games', dirn, 'movement.json')
    json.dump(out, open(p, 'w', encoding='utf-8'), separators=(',', ':'))
    print(ep, 'tiles', len(types), 'types', len(rows), 'links', links, 'def', defs, 'heal', heals)
