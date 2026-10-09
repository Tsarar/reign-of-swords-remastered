# -*- coding: utf-8 -*-
"""
export_levels.py - build the recreation's data files for one episode straight from the
.dat archive (schema = the one src/reign-of-swords/ros-missions.js consumes).

    python export_levels.py 2 <outdir>

Writes: levels.json, waves.json, battle_events.json, scripts_ai.json, group_heraldry.json,
campaign.json (Ep2 only), scripts.json (full decoded script per map, for the atlas / future
trigger support).

Rules (all verified against the binaries / data, see AUDIT notes):
  * faction 0 is the human side; factions[0].b = the player's team (group) index;
    factions[0].gold = deploy budget; factions[i].ab = objective string id.
  * teams (groups) act in ascending index (turn cycle); side = player / ally (same faction
    as the player) / enemy.
  * op0 SPAWN at battle start (tag 2 entry chain) = fixed forces; SPAWNs reached from a
    round trigger (tag 0) = reinforcement waves; anything reached from tile/kill/counter
    triggers is exported to scripts.json only (the engine has no such triggers yet).
  * unit ids in MOVE/REMOVE/AIMODE/escort/kill triggers = the SPAWN action's template index.
  * deploy zone = deploy tiles (marker section A) whose team byte == player team.
  * team heraldry bytes = [symbolColour, fieldColour, device, bgType, banner]; 0xff -> 0;
    heraldry asset = device + 9.
"""
import sys, os, json, re
from rosdat import open_episode
from scenario import parse, spawns, OPNAMES
from campaign import structure, map_index, unit_name, PREREQ, ALWAYS_OPEN, N_KINGDOMS
from dialogue import Screens
import speakers as SPK

IDX2ENGINE = ['militiamen', 'footmen', 'halberdiers', 'swordsmen', 'cavalry', 'pikemen', 'greatswordsmen',
              'knights', 'king', 'griffon', 'archers', 'rangers', 'crossbowmen', 'musketeers', 'horsebowmen',
              'raiders', 'shamans', 'druids', 'wizards', 'priests', 'druids', 'wizards', 'priests', 'catapult',
              'trebuchet', 'cannon', 'greateagle', 'bear', 'stag', 'craftsmen', 'ballistae', 'conjurer',
              'sapper', 'bodyguard', 'dunesirens', 'bloodgorgers']
PALETTE = {0: 'vert', 1: 'azure', 2: 'or', 3: 'gules', 4: 'purpure', 5: 'sable', 6: 'tenne', 7: 'rose', 8: 'argent', 9: 'cyan'}   # ros_ep2 @0x91d54: ten 3-shade ramps
KIND2GROUP = {'story': 'story', 'raids': 'siege', 'skirmish': 'skirmish', 'tutorial': 'special'}
KINGDOM_ID = {'Sabbi Amar': 'sabbi-amar'}

# Episode II dialogue busts (resource 5017 frame index = screen field 2) -> display role label
EP2_NAMES = {52: 'War Advisor', 54: 'War Advisor', 59: 'Field Officer', 60: 'Field Officer', 61: 'Field Officer',
             63: 'Field Officer', 80: 'Field Officer', 81: 'Field Officer', 82: 'Field Officer',
             83: 'Dark Sorcerer', 84: 'Dark Sorcerer', 85: 'Dark Sorcerer', 86: 'Desert Chieftain'}
RESULT_RE = re.compile(r'^(You have (captured|taken|conquered|defended|destroyed|lost)\b|Your opponent has '
                       r'(captured|taken|conquered|destroyed)\b|Your conquest of .* has failed|Your army has been destroyed'
                       r'|Our detachment has been destroyed)', re.I)


def key(t):
    return IDX2ENGINE[t] if 0 <= t < len(IDX2ENGINE) else 'militiamen'


def subst(t):
    # GameScreen::substituteText (iOS Ep2 @0x1c59c): PlayerName -> the player's name, PlayerStyle -> Context::getRankTitle
    # (rank 0 = "Sir" offline — the rank is only raised by the online profile), FamilyName -> the family name picked for an
    # online account (none offline: dropped). The default name is Varius (string 627/686 "Until you create an account, you
    # will play as the noble Sir Varius."); the game swaps the player's own name in at display time (subName).
    # "PlayerStyle PlayerName" keeps the title ("Sir Varius"); a PlayerStyle standing ALONE as a form of address
    # ("It is an honor to serve in your army, PlayerStyle.") reads "Commander" (user decision; the original shows "Sir").
    # (Ep2's "The Ambush" line spells it "Playername" — matched regardless of case so the typo still takes the name.)
    t = re.sub(r'(?i)PlayerName', 'PlayerName', t)
    t = re.sub(r'PlayerStyle(?= PlayerName)', 'Sir', t).replace('PlayerStyle', 'Commander').replace('PlayerName', 'Varius')
    t = t.replace(' FamilyName', '').replace('FamilyName', '')
    return ' '.join(t.split()).strip()


def chain(actions, start):
    """Follow `next` links from action index start; returns the visited action indices."""
    out, seen = [], set()
    i = start
    while 0 <= i < len(actions) and i not in seen:
        seen.add(i)
        out.append(i)
        i = actions[i][-1]
    return out


def spawn_ids(o):
    """action index -> unit id. A scripted unit id is the SPAWN action's template index (op0 arg 3):
    verified on 5406 (MOVE 19 = the Hero), 5407 (MOVE 16 = the Hero), 5400 (kill triggers 10-15 = the
    first ambush squad, holds 24/27 = the two crossbowmen) and 5428 (escort 0,1,10,11 = the Craftsmen)."""
    return {i: a[3] for i, a in enumerate(o['actions'][0]) if a[0] == 0}


def unit_tiles(o, sp):
    """unit id -> (x, y, team) for side-0 spawns."""
    ids = spawn_ids(o)
    return {ids[s['idx']]: (s['x'], s['y'], s['group']) for s in sp if s['side'] == 0 and s['idx'] in ids}


# Episode I mission titles by kingdom header, in campaign order (for the Episode II re-runs of those battles).
def _ep1_titles():
    try:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'games', 'reign-of-swords', 'campaign.json')
        c = json.load(open(p, encoding='utf-8'))
        return {k['name']: [m['title'] for m in k['missions']] for k in c['kingdoms']}
    except Exception:
        return {}
EP1_TITLES = _ep1_titles()


def leaves_battle(scr, sc):
    """The screen's forward transition is menu command 2 (leave the battle). Transition blocks start at field 13 (field
    12 = count), 4 shorts each (…, command, target, …); the first is the forward one (a second, when present, is "back")."""
    return scr.field(sc, 12) > 0 and scr.field(sc, 14) == 2


def export(ep, outdir):
    a = open_episode(ep)
    st = structure(a, ep)
    midx = map_index(st)
    scr = Screens(a, ep)
    S = a.strings()
    mids = a.ids(5200, 5300) + a.ids(5400, 5500) + a.ids(5600, 5700) + a.ids(5800, 5900)
    levels, waves, events, scripts_ai, heraldry, scripts, rewards = [], {}, {}, {}, {}, {}, {}
    cb = S.index('Medal - Major Victory')              # the 7-collectible enum: Medal, Armor, Weapons, Beasts, Spirit, Lore, Flight
    COLLECTIBLES = [S[cb + k].split(' - ')[0] for k in range(7)]
    used_busts = set()
    for bid, mid in enumerate(sorted(mids, key=lambda m: (m // 100 != 54, m // 100 != 56, m // 100 != 52, m))):
        o = parse(a.res(mid - 100), ep)
        if ep == 2 and mid == 5400:
            # PROLOGUE ARMIES: record 5300's unit templates are placeholders — the "Carrone Army" is Craftsmen, Blood
            # Gorgers, Conjurers, Dune Sirens and Ballistae, and both ambush waves are Ep2-new units too (its twin 5800 is
            # all Blood Gorgers). Record 5324 (Zayandi Shores) opens with the SAME dialogue (screen 313) and the SAME
            # script shape: player block (acts 2-11), two 6-unit ambush waves (13-18, 24-29), a final 6-unit squad. The
            # player formations line up (5300's Knights at (3,5) sit where 5324's Knights stand at (2,5)), so each
            # placeholder slot takes the unit of its matching 5324 slot. The Hero, the Knights and the final
            # militia/footmen/crossbow squad (tpl 22-27) are already genuine and stay as they are.
            # type ids: 0 militia, 1 footmen, 3 swordsmen, 4 cavalry, 5 pikemen, 7 knights, 10 archers, 12 crossbowmen
            PROLOGUE_TYPES = {0: 4, 1: 7, 2: 4, 5: 5, 6: 5, 7: 10, 8: 3, 9: 0,          # player: cavalry / knights / cavalry, pikemen x2, archers, swordsmen, militia
                              10: 10, 11: 0, 12: 0, 13: 0, 14: 0, 15: 10,               # 1st ambush: archers, militia x4, archers
                              16: 12, 17: 1, 18: 1, 19: 1, 20: 1, 21: 12}               # 2nd ambush: crossbowmen, footmen x4, crossbowmen
            for ti, ty in PROLOGUE_TYPES.items():
                o['templates'][ti]['type'] = ty
        if ep == 2 and mid == 5803:
            # EP1 CARRONE 1 POSITIONS: the Ep2 archive's copy of Carrone 1 (record 5703) carries the same 29-action script
            # but every spawn and marker drifted a row/column (an unfinished edit). Gameplay footage of the original
            # shows Ep1's layout, so take the coordinates and marker table from the Ep1 record 5300.
            o1 = parse(open_episode(1).res(5300), 1)
            for i, act in enumerate(o['actions'][0]):
                if act[0] == 0:
                    act[1], act[2] = o1['actions'][0][i][1], o1['actions'][0][i][2]
            o['clips'] = o1['clips']
            # ...and its REWARD: this copy sits in the tutorial range with an empty reward list (p = 0, like every
            # tutorial record), so it paid nothing; the mission it copies (Ep1 Carrone 1) grants Knights, Cavalry,
            # Crossbowmen, a Catapult, 2 Pikemen and 2 Footmen. Same mission, same spoils (user decision: Ep2 as Ep1).
            o['o'], o['p'], o['q'] = list(o1['o']), o1['p'], o1['q']
            # ...and its ARMY COLOURS: the copy's Rebel Army bytes are swapped (azure/argent, device 8) against Ep1's
            # argent/azure fleur-de-lis — the same arms the Rebel Army flies in Carrone 2 and 3. The user recalls the
            # original's Carrone 1 rebels looking like Carrone 3's, so take the group bytes from Ep1 too.
            for t, t1 in zip(o['teams'], o1['teams']):
                if t['name'] == t1['name']: t['raw'] = list(t1['raw'])
        W, H, rows = a.mapgrid(mid)
        info = midx.get(mid, {'kind': 'tutorial', 'kingdom': None, 'name': 'Map %d' % mid})
        ptFac = 0
        pteam = o['factions'][0]['b'] if o['factions'] else 0
        teams = o['teams']
        side_of = {}
        for gi, t in enumerate(teams):
            side_of[gi] = 'player' if gi == pteam else ('ally' if t['faction'] == ptFac else 'enemy')
        # ---- reachability classes
        acts = o['actions']
        # Only side 0 is the campaign perspective (Mission::getActionSequence indexes the scalar
        # trigger table by Mission+0x90, the play-side; side 1 is the raid 'defend' perspective).
        # Entry tags: 1 = deploy-stage sequence (GameScreen::isLoadingMap), 2 = battle start
        # (GameScreen::activateGameState). Both spawn the fixed forces.
        SIDES = (0,)
        initial = set()
        start_fallback = False
        for side in SIDES:
            for tg in o['triggers'][side]:
                if tg[0] in (1, 2):
                    initial |= {(side, i) for i in chain(acts[side], tg[1])}
        if not initial and acts[0]:
            initial = {(0, i) for i in chain(acts[0], 0)}      # placeholder raids: no entry tag at all
            start_fallback = True
        round_of = {}
        trig_group = {}
        for side in SIDES:
            for tg in o['triggers'][side]:
                if tg[0] == 0 and tg[1] >= 0:
                    for i in chain(acts[side], tg[-1]):
                        round_of.setdefault((side, i), tg[1])
                        trig_group.setdefault((side, i), tg[2])
        all_sp = [s for s in spawns(o) if s['side'] in SIDES]
        fixed = [s for s in all_sp if (s['side'], s['idx']) in initial]
        wave_sp = [s for s in all_sp if (s['side'], s['idx']) in round_of and (s['side'], s['idx']) not in initial]
        cond_sp = [s for s in all_sp if (s['side'], s['idx']) not in initial and (s['side'], s['idx']) not in round_of]
        # ---- level entry
        enemy, allies, player = [], [], []
        enemyGroups, allyGroups = {}, {}
        hero = None
        for s in fixed:
            sd = side_of.get(s['group'], 'enemy')
            k = key(s['type'])
            if sd == 'enemy':
                if s['group'] not in enemyGroups:
                    enemyGroups[s['group']] = len(enemyGroups)
                enemy.append([k, s['x'], s['y'], enemyGroups[s['group']], s['group']])
            elif sd == 'ally':
                if s['group'] not in allyGroups:
                    allyGroups[s['group']] = len(allyGroups)
                allies.append([k, s['x'], s['y'], allyGroups[s['group']], s['group']])
            else:
                player.append([k, s['x'], s['y'], 0, s['group']])
                if s['type'] == 8:
                    hero = [s['x'], s['y']]
        def gdesc(gi):
            t = teams[gi]
            return {'name': t['name'], 'src': t['faction'], 'banner': t['raw'][5] if t['raw'][5] != 255 else 0, 'team': t['faction']}
        deploy = [[c['x'], c['y']] for c in o['clips'] if c['b'] == pteam]
        objText = S[o['factions'][0]['ab']] if o['factions'] and 0 <= o['factions'][0]['ab'] < len(S) else ''
        capture = any(w in objText.lower() for w in ('capture', 'hold', 'enter'))
        objectives = [[t['x'], t['y']] for ar in o['areas'] for t in ar['tiles']] if capture else []
        groupOrder = [{'gi': gi, 'name': t['name'], 'banner': (t['raw'][5] if t['raw'][5] != 255 else 0),
                       'team': t['faction'], 'side': side_of[gi]} for gi, t in enumerate(teams)]
        lv = {
            'bid': bid, 'group': KIND2GROUP[info['kind']], 'mapId': mid, 'cols': W, 'rows': H,
            'tiles': [v for row in rows for v in row], 'name': info['name'], 'kingdom': info['kingdom'],
            'subtitle': '', 'objectiveText': objText, 'enemy': enemy, 'budget': o['factions'][0]['gold'],
            'deployZone': deploy, 'hero': hero, 'turnLimit': o['turnLimit'], 'objectives': objectives,
            'player': player, 'playerBudget': o['factions'][0]['gold'],
            'enemyFirst': bool(groupOrder) and groupOrder[0]['side'] == 'enemy',
            'enemyGroups': {str(v): gdesc(g) for g, v in enemyGroups.items()},
            'allies': allies, 'allyGroups': {str(v): gdesc(g) for g, v in allyGroups.items()},
            'groupOrder': groupOrder, 'playerGroup': pteam,
            'startFallback': start_fallback,
            'areas': [{'points': ar['points'], 'tiles': [[t['x'], t['y']] for t in ar['tiles']]} for ar in o['areas']],
            # scenario marker table (Mission::loadMarkers section A): [x, y, group, team]. createUnitAt gives a unit
            # spawned on a marker that team's GroupLogic group `group` (the original's per-map AI clusters).
            'markers': [[c['x'], c['y'], c['a'], c['b']] for c in o['clips']],
            'factions': [{'name': f['name'], 'team': f['b'], 'gold': f['gold'], 'objective': S[f['ab']] if 0 <= f['ab'] < len(S) else ''} for f in o['factions']],
        }
        if ep == 2:
            P = []
            for p in o['portals']:
                sx, sy = p['src']; dx, dy = p['dst']
                if 0 <= sx < W and 0 <= sy < H and 0 <= dx < W and 0 <= dy < H and (sx, sy) != (dx, dy):
                    # 5th field = the teams (scenario group indices) allowed through (Mission::canUsePortal); [] = everyone
                    P.append([sx, sy, dx, dy, list(p['mask'])])
            lv['portals'] = P or None
        # loadMarkers section D (Ep1 Mission+0x4c, Ep2 +0x7c): the siege points — every army's concentration layer
        # weighs +20 on each (Map::updatePointConcentration); Ep2's allied engines also bombard them (AI state 15).
        if o['listD']:
            lv['siegePoints'] = [[c['x'], c['y']] for c in o['listD']]
        lv['enemyBudget'] = max([f['gold'] for f in o['factions'][1:]] or [0])
        lv['missionType'] = o['i']          # header field: 0 destroy, 1 hold one area, 2 hold areas by points, 3 escape / escort
        # placeholder slots: copies of other maps with no start trigger ("X Raid 3", "Server 4") - never real content
        lv['hidden'] = bool(info['kind'] in ('raids', 'skirmish') and ((start_fallback and re.search(r'Raid 3$', info['name'])) or info['name'].startswith('Server ')))
        # victory / defeat sequences (entry tags 4 / 5): the lines the original shows on the result screen
        GENERIC = {'Victory! Collect the spoils of war.', 'Defeat! Our forces return in shame.'}
        def seq_lines(tag):
            out = []
            for tg in o['triggers'][0]:
                if tg[0] != tag:
                    continue
                for i in chain(acts[0], tg[1]):
                    act = acts[0][i]
                    if act[0] != 1:
                        continue
                    for spk, sd, text in scr.lines(act[1]):
                        text = subst(text)
                        if not text or RESULT_RE.match(text) or text in GENERIC:
                            continue
                        out.append(SPK.line(ep, spk, sd, text))
            return out
        lv['victoryLines'] = seq_lines(4)
        lv['defeatLines'] = seq_lines(5)
        if ep == 2 and mid == 5400:
            # NOT a Zayandi mission: MenuScreen::onMenuEvent (@0x5cd42) loads story map 5400 + 3*kingdom + slot, so
            # Zayandi (kingdom 8) plays 5424/5425/5426 and record 5400 is only ever reached as Carrone's slot 1. It
            # holds an older copy of Zayandi Shores (same opening screen 313, round-timed waves, placeholder unit
            # templates); the genuine opener is 5424. Kept in the data for the atlas, out of the campaign and lists.
            lv['name'] = 'Prologue (unused copy of Zayandi Shores)'; lv['kingdom'] = 'Zayandi'; lv['hidden'] = True
        if ep == 2 and mid == 5805:
            # No title string exists for this drill (the tutorial names end at 299 "Combat Training"), so the generic
            # fallback said "Tutorial 6". Its lines continue 5804's training day (the siege practice, then "that's
            # enough training for today"), so it is shown as that drill's second part.
            lv['name'] = 'Combat Training — Part 2'
        if ep == 2 and mid == 5803:          # the archive's own copy of Ep1 Carrone 1 (same 13 lines) fills the Carrone slot the prologue took
            lv['name'] = 'Carrone 1'; lv['kingdom'] = 'Carrone'; lv['group'] = 'story'
        if ep == 2 and mid == 5800:          # same script as 5400 but every template is type 35/25 - an unfinished copy, keep it out
            lv['hidden'] = True; lv['name'] = 'Prologue (unused copy)'
        # ---- runtime script for the engine (engine/script.js): side-0 actions + the trigger tables, with the
        # indices already applied by the legacy paths (fixed forces / round waves / round dialogue) marked.
        sids = spawn_ids(o)
        victory_seq = {t[-1] for t in o['triggers'][0] if t[0] == 4}
        sc_actions = []
        for i, act in enumerate(acts[0]):
            op = act[0]
            d = {'op': op, 'a': act[1:-1], 'next': act[-1]}
            if op == 0:
                t = o['templates'][act[3]] if 0 <= act[3] < len(o['templates']) else {'type': -1, 'group': -1}
                d.update({'key': key(t['type']), 'gi': t['group'], 'x': act[1], 'y': act[2], 'sid': sids.get(i)})
            if op == 1:
                ls = []
                for spk, sd, text in scr.lines(act[1]):
                    text = subst(text)
                    if not text or RESULT_RE.match(text):
                        continue
                    tgrp = trig_group.get((0, i), -1)
                    tname = teams[tgrp]['name'] if (tgrp is not None and 0 <= tgrp < len(teams) and tgrp != pteam) else None
                    ls.append(SPK.line(ep, spk, sd, text, tname))
                d['lines'] = ls
                # A conversation whose chain ends on the result screen — "Spoils of War" (victory) or "Units Lost"
                # (defeat) — ENDS the battle once read (Marsur 3: the garrison yields when its commander falls).
                end = scr.chain(act[1])[-1]
                if not scr.is_dialogue(end):
                    title = S[scr.field(end, 2)] if 0 < scr.field(end, 2) < len(S) else ''
                    if title == 'Spoils of War':
                        d['end'] = 'victory'
                    elif title == 'Units Lost':
                        d['end'] = 'defeat'
                elif info['kind'] != 'tutorial' and i not in victory_seq and leaves_battle(scr, end):
                    # ...and one whose last screen LEAVES the battle (menu command 2 — GameScreen::onMenuEvent deletes the
                    # save and quits to the menu) is a loss: Sangsoleil 1's "we must turn back", The High Pass's third war
                    # engine, the Emperor falling in Carrone 3, Stokeshire / the Hero falling in Sangsoleil 3.
                    d['end'] = 'defeat'
            sc_actions.append(d)
        # where the DEFEAT sequence (tag 5) leads: GameScreen::checkOutcome reports a side with nobody left on the field
        # as lost (0) and plays this sequence — but on the escape maps it is the "we've escaped" line and leads to the
        # Spoils of War, so a field emptied by escaping (or a last death after enough got away) is a win there.
        t5 = [t[-1] for t in o['triggers'][0] if t[0] == 5]
        if t5 and 0 <= t5[0] < len(sc_actions) and sc_actions[t5[0]].get('end') == 'victory':
            lv['wipedWins'] = True
        lv['script'] = {
            'actions': sc_actions,
            'triggers': [{'tag': t[0], 'a': t[1:]} for t in o['triggers'][0] if t[0] in (0, 1, 2, 6, 7, 8, 9, 11)],
            'initial': sorted(i for (sd, i) in initial if sd == 0),
            'rounds': sorted(i for (sd, i) in round_of if sd == 0),
            'goals': ([[t['x'], t['y']] for ar in o['areas'] for t in ar['tiles']] if o['i'] == 3 else []),
            'escort': ({'markers': [[m['x'], m['y']] for m in o['escort']['markers']], 'units': o['escort']['units'],
                        'required': next((t[1] for t in o['triggers'][0] if t[0] == 11), len(o['escort']['units'])),
                        'doneCmd': next((t[2] for t in o['triggers'][0] if t[0] == 11), -1)} if o.get('escort') else None),
        }
        lv['ep'] = ep
        # REWARDS: GameScreen::createRewardsMenu walks the header list o[0..p): token < 100 = a unit of that 5010
        # type joins your army, token >= 100 = collectible (token - 100) into the spoils; q = draw randomly.
        toks = o['o'][:o['p']] if 0 < o['p'] <= len(o['o']) else ([] if o['p'] == 0 else o['o'])   # p = 0: no reward (tutorials)
        ru, rs = {}, {}
        for t in toks:
            if t >= 100:
                nm = COLLECTIBLES[t - 100] if 0 <= t - 100 < len(COLLECTIBLES) else 'Item%d' % (t - 100)
                rs[nm] = rs.get(nm, 0) + 1
            elif t >= 0:
                k2 = key(t); ru[k2] = ru.get(k2, 0) + 1
        if o['q'] and 0 < o['p'] <= len(o['o']):
            # q = RANDOM reward: createRewardsMenu draws p DISTINCT entries from the WHOLE list (getRandom % list size,
            # re-drawing a used index) on every win — the shell rolls them (ReignShell rollReward), so ship the pool.
            pool = [({'spoil': COLLECTIBLES[t - 100] if 0 <= t - 100 < len(COLLECTIBLES) else 'Item%d' % (t - 100)}
                     if t >= 100 else {'unit': key(t)}) for t in o['o'] if t >= 0]
            rewards[str(mid)] = {'units': {}, 'spoils': {}, 'random': True, 'pick': o['p'], 'pool': pool}
        elif ru or rs:
            rewards[str(mid)] = {'units': ru, 'spoils': rs}
        levels.append(lv)
        # ---- waves (round-triggered spawns)
        # wave PHASE follows the trigger's team: group -1 (any/current) or a player-side team -> the top of the
        # round (player phase 'blue'); an enemy team -> that army's phase ('red'). The spawned units' own team
        # comes from their group (engine/turnflow _fireWaves), not from the phase.
        wv = {}
        for s in wave_sp:
            r = round_of[(s['side'], s['idx'])]
            tg_grp = trig_group.get((s['side'], s['idx']), -1)
            phase = 'red' if (tg_grp is not None and tg_grp >= 0 and side_of.get(tg_grp) == 'enemy') else 'blue'
            wv.setdefault((r, phase), []).append([key(s['type']), s['x'], s['y'], s['group']])
        if wv:
            waves[str(mid)] = [{'round': r, 'side': sd, 'units': u} for (r, sd), u in sorted(wv.items())]
        # ---- dialogue events (screens at battle start = round 1, or at their trigger round)
        ev = []
        for side in SIDES:
            cam = None
            for i, act in enumerate(acts[side]):
                if act[0] == 2:
                    cam = [act[1], act[2]]
                if act[0] != 1:
                    continue
                is_init = (side, i) in initial
                if is_init:
                    rnd = 1
                elif (side, i) in round_of:
                    rnd = round_of[(side, i)]
                else:
                    continue
                tgrp = trig_group.get((side, i), -1)
                tname = teams[tgrp]['name'] if (tgrp is not None and 0 <= tgrp < len(teams) and tgrp != pteam) else None
                for spk, sd, text in scr.lines(act[1]):
                    text = subst(text)
                    if not text or RESULT_RE.match(text):
                        continue
                    used_busts.add(spk)
                    e = dict(SPK.line(ep, spk, sd, text, tname), round=rnd, reinforce=bool(wv) and rnd > 1)
                    if is_init:
                        e['init'] = True          # part of the battle-start chain: the script runner plays it in sequence
                    if cam:
                        e['cam'] = cam
                    ev.append(e)
        seen = set(); ded = []
        for e in ev:
            if e['text'] not in seen:
                seen.add(e['text']); ded.append(e)
        if ded:
            events[str(mid)] = sorted(ded, key=lambda e: e['round'])
        # ---- AI scripts: holds (op11 arg 1) and scripted moves (op3 [+ op8 remove])
        tiles_by_id = unit_tiles(o, all_sp)
        holds, moves = [], []
        for side in SIDES:
            for i, act in enumerate(acts[side]):
                if act[0] == 11 and act[2] == 1 and act[1] in tiles_by_id:
                    holds.append(list(tiles_by_id[act[1]][:2]))
                if act[0] == 3 and act[3] in tiles_by_id:
                    x, y, _ = tiles_by_id[act[3]]
                    nxt = acts[side][act[-1]] if 0 <= act[-1] < len(acts[side]) else None
                    rnd = 0 if (side, i) in initial else round_of.get((side, i), 0)
                    moves.append({'from': [x, y], 'to': [act[1], act[2]], 'round': rnd, 'flee': bool(nxt and nxt[0] == 8 and nxt[1] == act[3])})
        sa = {}
        if holds: sa['holdTiles'] = holds
        if moves: sa['moves'] = moves
        if sa: scripts_ai[str(mid)] = sa
        # ---- heraldry
        hm = {}
        for gi, t in enumerate(teams):
            raw = t['raw'][1:6]
            r = [0 if v == 255 else v for v in raw]
            # device 0xff = no charge (stored as 0); device 0 is a REAL charge (asset 009, the griffin). Test the RAW
            # byte, not the 255->0-mapped one, or device 0 is lost (Bordavia 3's Valamir Army griffin was dropped).
            hm[str(gi)] = {'name': t['name'], 'team': t['faction'], 'symbolColor': PALETTE.get(r[0], 'argent'),
                           'bgColor': PALETTE.get(r[1], 'argent'), 'symbol': (raw[2] + 9) if raw[2] != 255 else 0, 'bgType': r[3], 'banner': r[4]}
            # Mission::setupTeamColors only calls Context::createUnitImages for a group whose first colour byte isn't
            # 0xff — such a group fights in the unrecoloured green+blue art (Ep1 5802 "Enemy Units", Ep2 "Natives").
            if raw[0] == 255: hm[str(gi)]['noRecolor'] = True
        heraldry[str(mid)] = hm
        # ---- full script (for the atlas / future engine triggers)
        def desc(act):
            op = act[0]
            d = {'op': OPNAMES.get(op, str(op)), 'args': act[1:-1], 'next': act[-1]}
            if op == 0:
                t = o['templates'][act[3]] if 0 <= act[3] < len(o['templates']) else {'type': -1, 'group': -1}
                d['unit'] = unit_name(t['type']); d['team'] = t['group']; d['x'] = act[1]; d['y'] = act[2]
            if op == 1:
                d['lines'] = [{'spk': spk, 'side': sd, 'text': subst(tx)} for spk, sd, tx in scr.lines(act[1])]
            return d
        scripts[str(mid)] = {
            'triggers': o['triggers'], 'actions': [[desc(x) for x in acts[0]], [desc(x) for x in acts[1]]],
            'initial': sorted([i for (s, i) in initial if s == 0]), 'roundOf': {'%d:%d' % k: v for k, v in round_of.items()},
            'conditionalSpawns': [[key(s['type']), s['x'], s['y'], s['group'], s['side'], s['idx']] for s in cond_sp],
            'escort': o.get('escort'), 'header': {'i': o['i'], 'an': o['an'], 'o': o['o'], 'p': o['p'], 'q': o['q']},
        }
    os.makedirs(outdir, exist_ok=True)
    def dump(name, obj, pretty=False):
        with open(os.path.join(outdir, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1 if pretty else None, separators=None if pretty else (',', ':'))
    if ep == 2:
        # MOVEMENT DRILL ON LOAN: Episode II ships no movement tutorial (its 5800 slot is the prologue map), so the
        # Ep2 route borrows Episode I's "Tutorial - Movement" (map 5800, exported first) as map 5806. `alias` keeps
        # the Ep1 tutorial rules (TUTORIAL_FORCES / win-on-the-green) and `events` carries its dialogue along.
        ep1dir = os.path.join(outdir, '..', 'reign-of-swords')
        try:
            l1 = [l for l in json.load(open(os.path.join(ep1dir, 'levels.json'), encoding='utf-8'))['levels'] if l['mapId'] == 5800][0]
            e1 = json.load(open(os.path.join(ep1dir, 'battle_events.json'), encoding='utf-8')).get('5800')
            drill = dict(l1, mapId=5806, alias=5800, bid=len(levels), events=e1, ep=1, name='Tutorial - Movement')
            # Its lines carry Episode I's own realistic busts (face001/003/010) — the art style both episodes now use
            # (speakers.EP2_REALISTIC), so they are kept; the images are copied into the Ep2 portraits dir below.
            EP2_FACE = {}
            def reface(o):
                if isinstance(o, dict): return {k: (EP2_FACE.get(v, v) if k == 'face' else reface(v)) for k, v in o.items()}
                if isinstance(o, list): return [reface(v) for v in o]
                return o
            drill = reface(drill)
            levels.append(drill)
        except (OSError, IndexError) as e:
            print('WARNING: Ep1 movement drill not copied:', e)
    if ep == 2:
        # Episode I realistic portraits the Ep2 dialogue now uses (speakers.EP2_REALISTIC + the loaned movement drill):
        # copy any the Ep2 portraits dir lacks from the Ep1 dir, so the data never points at a missing image.
        import shutil
        used = set(re.findall(r'"(face\d{3})"', json.dumps([levels, events], ensure_ascii=False)))
        ep1p, ep2p = os.path.join(outdir, '..', 'reign-of-swords', 'portraits'), os.path.join(outdir, 'portraits')
        os.makedirs(ep2p, exist_ok=True)
        for f in sorted(used):
            dst = os.path.join(ep2p, f + '.png')
            if not os.path.exists(dst) and os.path.exists(os.path.join(ep1p, f + '.png')):
                shutil.copyfile(os.path.join(ep1p, f + '.png'), dst)
    if ep == 2:   # Episode I titles for Episode II's re-runs of chapters 1-8 (also applied to campaign.json below)
        for k in st['kingdoms']:
            if not k['built'] or k['index'] >= 8:
                continue
            mids = [m['mapId'] for m in k['story']]
            if k['name'] == 'Carrone':
                mids = [5803] + [x for x in mids if x != 5400]
            t1 = EP1_TITLES.get(k['header'], [])
            for i, mid in enumerate(mids):
                for l in levels:
                    if l['mapId'] == mid and i < len(t1):
                        l['name'] = t1[i]
    dump('levels.json', {'levels': levels})
    dump('waves.json', waves, True)
    dump('battle_events.json', events)
    dump('scripts_ai.json', scripts_ai, True)
    dump('group_heraldry.json', heraldry, True)
    dump('scripts.json', scripts)
    dump('rewards.json', rewards, True)
    # ---- campaign.json (genuine structure; story text left empty on purpose)
    kingdoms = []
    for k in st['kingdoms']:
        if not k['built']:
            continue
        kid = KINGDOM_ID.get(k['name'], k['name'].lower())
        pre = k['prereq']
        byid = {l['mapId']: l for l in levels}
        def mission(mid, title):
            l = byid.get(mid, {})
            return {'mapId': mid, 'title': title, 'intro': [], 'victory': l.get('victoryLines', []), 'defeat': l.get('defeatLines', [])}
        missions = [mission(m['mapId'], m['name']) for m in k['story']]
        if ep == 2 and k['name'] == 'Carrone':
            missions = [mission(5803, 'Carrone 1')] + [m for m in missions if m['mapId'] != 5400]   # slot 5400 is the prologue; 5803 is the archive's Carrone 1
        # Episode II's chapters 1-8 replay Episode I's battles but its string table only names them "Marsur 3" etc.;
        # give them the Episode I titles, matched by kingdom and position (user decision).
        if ep == 2 and k['index'] < 8:
            t1 = EP1_TITLES.get(k['header'], [])
            for i, m in enumerate(missions):
                if i < len(t1):
                    m['title'] = t1[i]
        kingdoms.append({'id': kid, 'name': k['header'], 'order': k['index'], 'emperorBrief': [],
                         'legacy': bool(ep == 2 and k['index'] < 8),   # Episode I kingdoms kept in the Ep2 archive; not on the Ep2 world map
                         'missions': missions,
                         'unlockAfter': [] if k['alwaysOpen'] or pre is None else [st['kingdoms'][pre]['name']]})
    # EPISODE II's OPENINGS (user decision on when each plays): the Emperor's card ("His Imperial Majesty / Julien
    # Sebatini / Emperor of Carrone", the same three strings that head Episode I's) is followed in the table by the
    # Archwizard's card, Episode II's own intro, and then the archive's copy of Episode I's ("Much of the known
    # world...", up to Merovin's briefing). `prologue` = that Episode I intro, played on entering the campaign (its
    # first chapters replay Episode I); `episodePrologue` = Episode II's own, played before the first Eastern Kingdoms
    # battle. Both spoken by the Emperor on his Episode I bust (pool frame 56 = Ep1 face005, pixel for pixel).
    prologue, episode_prologue = [], []
    if ep == 2:
        emperor = lambda i: {'speaker': 'Emperor Sebatini', 'text': subst(S[i]), 'side': 'you', 'face': 'face056'}
        own = S.index('Council of Archwizards') + 1
        old = next(i for i, t in enumerate(S) if t.startswith('Much of the known world'))
        merovin = next(i for i in range(old, len(S)) if S[i].startswith('The Kingdom of Merovin'))
        episode_prologue = [emperor(i) for i in range(own, old)]
        prologue = [emperor(i) for i in range(old, merovin)]
    dump('campaign.json', {'title': 'Reign of Swords', 'subtitle': 'Episode II' if ep == 2 else '', 'prologue': prologue,
                           'episodePrologue': episode_prologue, 'kingdoms': kingdoms}, True)
    print('wrote', outdir, ': levels', len(levels), 'waves', len(waves), 'events', len(events), 'ai', len(scripts_ai), 'busts', sorted(used_busts))
    return levels


if __name__ == '__main__':
    export(int(sys.argv[1]), sys.argv[2])
