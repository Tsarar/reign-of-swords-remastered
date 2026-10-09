# -*- coding: utf-8 -*-
"""
campaign.py - the genuine campaign structure of Reign of Swords I / II.

Everything here is derived from the iOS binaries + the 5004 string table:
  * Context::getKingdomName(i)  = strings[kingdomBase + i/4]         (skirmish index i)
  * Context::getMapName(i)      = strings[block(K+1) + 7 + i%4]      (skirmish names)
  * Context::deleteAllSaves     literal ranges: story 5400.., raids 5600.., skirmish 5204..,
                                tutorials 5800..
  * MenuScreen::selectKingdom   loops the kingdom hit-rects (8 in Ep1, 11 in Ep2) and gates
                                each kingdom on ONE prerequisite kingdom (switch table);
                                kingdom 0 (and kingdom 8 in Ep2) are always open.
  * per-kingdom string block (stride 11): +0 "Kingdom of X", +1..3 story, +4..6 raids,
                                          +7..10 skirmish

Resource ids: story = 5400 + 3K + i, raid = 5600 + 3K + i, skirmish = 5200 + 4K + i,
tutorial = 5800 + i.  Scenario record = map id - 100.
"""
UNIT_NAMES = ['Militiamen', 'Footmen', 'Halberdiers', 'Swordsmen', 'Cavalry', 'Pikemen',
              'Greatswordsmen', 'Knights', 'Hero', 'Griffon Riders', 'Archers', 'Rangers',
              'Crossbowmen', 'Musketeers', 'Horse Bowmen', 'Raiders', 'Shamans', 'Old Druids',
              'Old Wizards', 'Old Priests', 'Druids', 'Wizards', 'Priests', 'Catapults',
              'Trebuchet', 'Cannon', 'Great Eagles', 'Guardian Bear', 'Stag',
              # Episode II additions (unit table 5010 indices 29-35)
              'Craftsmen', 'Ballistae', 'Conjurer', 'Sapper', 'Bodyguard', 'Dune Sirens', 'Blood Gorgers']

# MenuScreen::selectKingdom prerequisite tables (kingdom index -> required completed kingdom)
PREREQ = {
    1: {1: 0, 2: 1, 3: 0, 4: 1, 5: 2, 6: 4, 7: 6},
    # iOS Ep2 binary gates Rukiev on Zayandi (8); per the user's decision the original kingdoms keep their
    # Ep1 rules (Rukiev <- Hunewold) and only the Eastern kingdoms use the new tree (Zayandi open at start).
    2: {1: 0, 2: 1, 3: 0, 4: 1, 5: 2, 6: 4, 7: 6, 8: 0, 9: 8, 10: 9},
}
ALWAYS_OPEN = {1: {0}, 2: {0, 8}}
N_KINGDOMS = {1: 8, 2: 11}   # rect loop bounds in selectKingdom (cmp #8 / cmp #0xb)


def unit_name(t):
    return UNIT_NAMES[t] if 0 <= t < len(UNIT_NAMES) else 'unit%d' % t


def structure(archive, ep):
    S = archive.strings()
    base = S.index('Kingdom of Carrone')
    kingdoms = []
    K = 0
    while base + 11 * K < len(S) and S[base + 11 * K].startswith('Kingdom of '):
        blk = base + 11 * K
        name = S[blk][len('Kingdom of '):]
        k = {'index': K, 'name': name, 'header': S[blk], 'built': K < N_KINGDOMS[ep],
             'prereq': PREREQ[ep].get(K), 'alwaysOpen': K in ALWAYS_OPEN[ep],
             'story': [], 'raids': [], 'skirmish': []}
        for i in range(3):
            mid = 5400 + 3 * K + i
            k['story'].append({'mapId': mid, 'name': S[blk + 1 + i], 'inDat': mid in archive})
        for i in range(3):
            mid = 5600 + 3 * K + i
            k['raids'].append({'mapId': mid, 'name': S[blk + 4 + i], 'inDat': mid in archive})
        for i in range(4):
            mid = 5200 + 4 * K + i
            k['skirmish'].append({'mapId': mid, 'name': S[blk + 7 + i], 'inDat': mid in archive})
        kingdoms.append(k)
        K += 1
    tut_base = S.index('Tutorial - Movement')
    tutorials = []
    for i in range(10):
        mid = 5800 + i
        if mid not in archive:
            break
        nm = S[tut_base + i] if S[tut_base + i] and not S[tut_base + i].startswith('Kingdom') else 'Tutorial %d' % (i + 1)
        tutorials.append({'mapId': mid, 'name': nm})
    return {'ep': ep, 'stringBase': base, 'kingdoms': kingdoms, 'tutorials': tutorials}


def map_index(struct_):
    """mapId -> {kind, kingdom, name}"""
    out = {}
    for k in struct_['kingdoms']:
        for kind in ('story', 'raids', 'skirmish'):
            for m in k[kind]:
                out[m['mapId']] = {'kind': kind, 'kingdom': k['name'], 'K': k['index'], 'name': m['name']}
    for t in struct_['tutorials']:
        out[t['mapId']] = {'kind': 'tutorial', 'kingdom': None, 'K': None, 'name': t['name']}
    return out


if __name__ == '__main__':
    import sys, json
    from rosdat import open_episode
    ep = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    st = structure(open_episode(ep), ep)
    for k in st['kingdoms']:
        print('K%-2d %-11s built=%s prereq=%s open=%s' % (k['index'], k['name'], k['built'], k['prereq'], k['alwaysOpen']))
        for kind in ('story', 'raids', 'skirmish'):
            print('     %-8s %s' % (kind, ', '.join('%d %s%s' % (m['mapId'], m['name'], '' if m['inDat'] else ' [NO DATA]') for m in k[kind])))
    print('tutorials', st['tutorials'])
