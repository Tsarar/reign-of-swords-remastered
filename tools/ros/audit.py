# -*- coding: utf-8 -*-
"""
audit.py - decode every map of an episode straight from the .dat and print one row per
map: genuine structure (kingdom/name), size, factions + gold, groups, fixed spawns per
faction, deploy tiles, portals, objective areas, scripted dialogue, round triggers.
Optionally diffs against the recreation's public/games/<ep>/levels.json.

    python audit.py 2            # table for Episode II
    python audit.py 1 --diff     # Episode I + diff vs levels.json
    python audit.py 2 --json out.json
"""
import sys, json, os
from rosdat import open_episode
from scenario import parse, spawns, OPNAMES
from campaign import structure, map_index, unit_name

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LEVELS = {1: os.path.join(REPO, 'public/games/reign-of-swords/levels.json'),
          2: os.path.join(REPO, 'public/games/reign-of-swords-2/levels.json')}


def decode_map(a, ep, mid, midx):
    sid = mid - 100
    o = parse(a.res(sid), ep)
    W, H, rows = a.mapgrid(mid)
    sp = spawns(o)
    info = midx.get(mid, {'kind': '?', 'kingdom': None, 'name': '?'})
    # which faction is the player: faction byte b == 0 (human) - verify per map
    human = [i for i, f in enumerate(o['factions']) if f['b'] == 0]
    per_fac = {}
    for s in sp:
        per_fac.setdefault(s['faction'], []).append(s)
    heroes = [(s['x'], s['y'], s['faction']) for s in sp if s['type'] == 8]
    deploy_owner = {}
    for c in o['clips']:
        deploy_owner.setdefault(c['b'], []).append((c['x'], c['y']))
    dialogue = []
    for side in (0, 1):
        for act in o['actions'][side]:
            if act[0] == 1:
                dialogue.append(act[1])
    round_trigs = [t for side in (0, 1) for t in o['triggers'][side] if t[0] == 0]
    other_trigs = [t for side in (0, 1) for t in o['triggers'][side] if t[0] != 0]
    ops = {}
    for side in (0, 1):
        for act in o['actions'][side]:
            ops[OPNAMES.get(act[0], act[0])] = ops.get(OPNAMES.get(act[0], act[0]), 0) + 1
    return {
        'mapId': mid, 'sid': sid, 'kind': info['kind'], 'kingdom': info['kingdom'], 'name': info['name'],
        'W': W, 'H': H, 'turnLimit': o['turnLimit'], 'header': [o['i'], o['an'], o['o'], o['p'], o['q']],
        'factions': o['factions'], 'human': human, 'teams': o['teams'], 'templates': len(o['templates']),
        'spawnsByFaction': {k: len(v) for k, v in per_fac.items()},
        'spawns': sp, 'heroes': heroes,
        'deployByOwner': {k: len(v) for k, v in deploy_owner.items()}, 'deploy': o['clips'],
        'portals': o['portals'], 'areas': o['areas'], 'listD': o['listD'], 'listE': o['listE'],
        'escort': o.get('escort'), 'dialogueScreens': dialogue, 'roundTriggers': round_trigs,
        'otherTriggers': other_trigs, 'ops': ops, 'tiles': rows,
    }


def fac_str(m):
    return ' | '.join('%s%s:%d' % (f['name'], '*' if f['b'] == 0 else '', f['gold']) for f in m['factions'])


def team_str(m):
    return ', '.join('%s>F%d' % (t['name'], t['faction']) for t in m['teams'])


def main():
    ep = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    a = open_episode(ep)
    st = structure(a, ep)
    midx = map_index(st)
    mids = a.ids(5200, 5300) + a.ids(5400, 5500) + a.ids(5600, 5700) + a.ids(5800, 5900)
    rows = []
    for mid in mids:
        rows.append(decode_map(a, ep, mid, midx))
    if '--json' in sys.argv:
        out = sys.argv[sys.argv.index('--json') + 1]
        slim = [{k: v for k, v in r.items() if k != 'tiles'} for r in rows]
        json.dump(slim, open(out, 'w', encoding='utf-8'), indent=1)
        print('wrote', out)
    lv = {}
    if '--diff' in sys.argv and os.path.exists(LEVELS[ep]):
        lv = {l['mapId']: l for l in json.load(open(LEVELS[ep], encoding='utf-8'))['levels']}
    print('%5s %-8s %-10s %-24s %-6s %-4s %-34s %-16s %-10s %-6s %-5s %-4s %-4s %s' % (
        'map', 'kind', 'kingdom', 'name', 'size', 'turn', 'factions(*=human):gold', 'spawns/faction', 'deploy/own', 'hero', 'dlg', 'rtrg', 'port', 'areas'))
    for r in rows:
        extra = ''
        if lv:
            l = lv.get(r['mapId'])
            if l:
                extra = ' || repo: bud=%s en=%d al=%d pl=%d dz=%d hero=%s name=%r' % (
                    l.get('budget'), len(l.get('enemy', [])), len(l.get('allies', [])), len(l.get('player', [])),
                    len(l.get('deployZone', [])), l.get('hero'), l.get('name'))
        print('%5d %-8s %-10s %-24s %2dx%-3d %-4d %-34s %-16s %-10s %-6s %-5d %-4d %-4d %s%s' % (
            r['mapId'], r['kind'], (r['kingdom'] or '-')[:10], r['name'][:24], r['W'], r['H'], r['turnLimit'],
            fac_str(r)[:34], str(r['spawnsByFaction']), str(r['deployByOwner']),
            ('%d,%d' % r['heroes'][0][:2]) if r['heroes'] else '-', len(r['dialogueScreens']),
            len(r['roundTriggers']), len(r['portals']), ','.join(str(x['points']) for x in r['areas']) or '-', extra))


if __name__ == '__main__':
    main()
