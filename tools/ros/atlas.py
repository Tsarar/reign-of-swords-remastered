# -*- coding: utf-8 -*-
"""
atlas.py - emit the data behind public/ros-atlas/index.html: every map of an episode decoded
straight from the .dat (tiles, factions, teams, spawns classified initial / wave / conditional,
deploy tiles, objective areas, portals, escort, triggers, full script with dialogue text).

    python atlas.py 1
    python atlas.py 2
-> public/ros-atlas/ep<N>.json   (viewer: http://localhost:5173/ros-atlas/index.html)
"""
import sys, os, json
from rosdat import open_episode
from scenario import parse, spawns, OPNAMES
from campaign import structure, map_index, unit_name
from dialogue import Screens
from export_levels import chain, subst, unit_tiles

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TAGS = {0: 'ROUND', 1: 'DEPLOY-START', 2: 'BATTLE-START', 4: 'VICTORY', 5: 'DEFEAT', 6: 'TILE-REACHED',
        7: 'UNIT-LOST', 8: 'COUNTER', 9: 'TAG9', 10: 'TAG10', 11: 'TAG11'}


def main(ep):
    a = open_episode(ep)
    st = structure(a, ep)
    midx = map_index(st)
    scr = Screens(a, ep)
    S = a.strings()
    mids = a.ids(5200, 5300) + a.ids(5400, 5500) + a.ids(5600, 5700) + a.ids(5800, 5900)
    maps = []
    for mid in sorted(mids):
        o = parse(a.res(mid - 100), ep)
        W, H, rows = a.mapgrid(mid)
        info = midx.get(mid, {'kind': 'tutorial', 'kingdom': None, 'name': 'Map %d' % mid})
        if ep == 2 and mid == 5400:      # slot 5400 = the Ep2 prologue; 5800 is a copy with junk unit templates
            info = dict(info, name='Prologue (Ep2 opening)')
        if ep == 2 and mid == 5800:
            info = {'kind': 'tutorial', 'kingdom': None, 'name': 'Prologue copy (junk templates, unused)'}
        pteam = o['factions'][0]['b'] if o['factions'] else 0
        acts = o['actions']
        initial, round_of = set(), {}
        for tg in o['triggers'][0]:
            if tg[0] in (1, 2):
                initial |= set(chain(acts[0], tg[1]))
        for tg in o['triggers'][0]:
            if tg[0] == 0 and tg[1] >= 0:
                for i in chain(acts[0], tg[-1]):
                    round_of.setdefault(i, tg[1])
        sp = []
        for s in spawns(o):
            if s['side'] == 0:
                cls = 'initial' if s['idx'] in initial else ('wave' if s['idx'] in round_of else 'cond')
            else:
                cls = 'side1'
            sp.append({'x': s['x'], 'y': s['y'], 'unit': unit_name(s['type']), 'type': s['type'], 'team': s['group'],
                       'cls': cls, 'round': round_of.get(s['idx']) if s['side'] == 0 else None, 'idx': s['idx'], 'side': s['side']})
        ids = unit_tiles(o, [s for s in spawns(o) if s['side'] == 0])
        teams = []
        for gi, t in enumerate(o['teams']):
            side = 'player' if gi == pteam else ('ally' if t['faction'] == 0 else 'enemy')
            teams.append({'name': t['name'], 'faction': t['faction'], 'side': side, 'heraldry': [0 if v == 255 else v for v in t['raw'][1:6]]})

        def desc(act):
            op = act[0]
            d = {'op': OPNAMES.get(op, str(op)), 'args': act[1:-1], 'next': act[-1]}
            if op == 0:
                t = o['templates'][act[3]] if 0 <= act[3] < len(o['templates']) else {'type': -1, 'group': -1}
                d['unit'] = unit_name(t['type']); d['team'] = t['group']
            if op == 1:
                d['lines'] = [{'spk': spk, 'side': sd, 'text': subst(tx)} for spk, sd, tx in scr.lines(act[1])]
            if op in (3, 8, 11) and act[1 if op != 3 else 3] in ids:
                d['unitTile'] = list(ids[act[1 if op != 3 else 3]][:2])
            return d

        def trig(t):
            return {'tag': t[0], 'name': TAGS.get(t[0], 'TAG%d' % t[0]), 'args': t[1:]}
        maps.append({
            'mapId': mid, 'kind': info['kind'], 'kingdom': info['kingdom'], 'name': info['name'], 'W': W, 'H': H,
            'tiles': [v for r in rows for v in r], 'turnLimit': o['turnLimit'],
            'header': {'i': o['i'], 'an': o['an'], 'o': o['o'], 'p': o['p'], 'q': o['q']},
            'factions': [{'name': f['name'], 'team': f['b'], 'gold': f['gold'], 'color': f['x'],
                          'objective': S[f['ab']] if 0 <= f['ab'] < len(S) else ''} for f in o['factions']],
            'teams': teams, 'playerTeam': pteam, 'spawns': sp,
            'deploy': [{'x': c['x'], 'y': c['y'], 'team': c['b'], 'form': c['a']} for c in o['clips']],
            'areas': [{'points': ar['points'], 'tiles': [[t['x'], t['y']] for t in ar['tiles']]} for ar in o['areas']],
            'portals': [{'flag': p['flag'], 'src': p['src'], 'dst': p['dst'], 'mask': p['mask']} for p in o['portals']],
            'listD': [[c['a'], c['b'], c['x'], c['y']] for c in o['listD']],
            'listE': [[c['a'], c['b'], c['x'], c['y']] for c in o['listE']],
            'escort': o.get('escort'),
            'triggers': [[trig(t) for t in o['triggers'][0]], [trig(t) for t in o['triggers'][1]]],
            'actions': [[desc(x) for x in acts[0]], [desc(x) for x in acts[1]]],
        })
    if ep == 2:
        for t in st['tutorials']:
            if t['mapId'] == 5800:
                t['name'] = 'Prologue copy (junk templates, unused)'
    out = {'ep': ep, 'dir': 'reign-of-swords' if ep == 1 else 'reign-of-swords-2', 'cellH': 40 if ep == 1 else 55,
           'kingdoms': st['kingdoms'], 'tutorials': st['tutorials'], 'maps': maps}
    os.makedirs(os.path.join(REPO, 'public', 'ros-atlas'), exist_ok=True)
    p = os.path.join(REPO, 'public', 'ros-atlas', 'ep%d.json' % ep)
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', p, len(maps), 'maps', os.path.getsize(p) // 1024, 'KB')


if __name__ == '__main__':
    main(int(sys.argv[1]))
