# -*- coding: utf-8 -*-
"""
dialogue.py - decode the dialogue/screen table (resource 5009) and print a scenario's
script (spawns, screens with text, camera pans, moves, triggers) in execution order.

Screen record = big-endian u16 fields. f[0]==1 -> dialogue line; f[2] speaker/portrait id;
f[3] side (0 = player side, else foe); f[7] string id into 5004.
Chaining: Ep1 f[15] = next screen; Ep2 f[12] = number of 4-short transition blocks starting
at f[13], target screen at block+2.

    python dialogue.py 2 5400          # script of map 5400 (Episode II)
"""
import struct, sys
from rosdat import open_episode
from scenario import parse, OPNAMES
from campaign import unit_name


class Screens:
    def __init__(self, archive, ep):
        self.ep = ep
        self.S = archive.strings()
        b = archive.res(5009)
        n = struct.unpack_from('>H', b, 0)[0]
        offs = [struct.unpack_from('>H', b, 2 + i * 2)[0] for i in range(n)]
        ds = 2 + n * 2
        self.recs = []
        for i in range(n):
            e = offs[i + 1] if i + 1 < n else len(b) - ds
            raw = b[ds + offs[i]:ds + e]
            self.recs.append([struct.unpack_from('>H', raw, k * 2)[0] for k in range(len(raw) // 2)])

    def field(self, sc, k):
        r = self.recs[sc] if 0 <= sc < len(self.recs) else []
        return r[k] if k < len(r) else 0

    def is_dialogue(self, sc):
        return self.field(sc, 0) == 1 and 0 < self.field(sc, 7) < len(self.S)

    def next_of(self, sc, seen):
        if self.ep == 1:
            nx = self.field(sc, 15)
            return nx if nx not in (0, 0xffff) and nx not in seen else None
        for t in range(self.field(sc, 12)):
            tgt = self.field(sc, 13 + t * 4 + 2)
            if tgt not in (0, 0xffff) and tgt not in seen:
                return tgt
        return None

    def chain(self, sc, limit=40):
        out, seen = [], set()
        while sc is not None and 0 <= sc < len(self.recs) and sc not in seen and len(out) < limit:
            seen.add(sc)
            out.append(sc)
            sc = self.next_of(sc, seen)
        return out

    def lines(self, sc):
        """[(speaker, side, text)] for the conversation starting at screen sc."""
        res = []
        for s in self.chain(sc):
            if self.field(s, 0) == 1:
                sid = self.field(s, 7)
                if 0 < sid < len(self.S) and self.S[sid].strip():
                    res.append((self.field(s, 2), self.field(s, 3), self.S[sid]))
        return res


def describe_action(a, o, scr):
    op = a[0]
    nm = OPNAMES.get(op, str(op))
    if op == 0:
        t = o['templates'][a[3]] if 0 <= a[3] < len(o['templates']) else {'type': -1, 'group': -1}
        g = o['teams'][t['group']]['name'] if 0 <= t['group'] < len(o['teams']) else '?'
        return '%s (%d,%d) %s [%s] facing=%d%s -> %d' % (nm, a[1], a[2], unit_name(t['type']), g, a[4],
                                                       (' extra=%s' % a[5:-1]) if len(a) > 6 else '', a[-1])
    if op == 1:
        ls = scr.lines(a[1])
        txt = ' | '.join('%s%d: %s' % ('' if sd == 0 else 'FOE ', spk, tx) for spk, sd, tx in ls)
        return '%s #%d -> %d :: %s' % (nm, a[1], a[-1], txt if txt else '(system screen)')
    return '%s %s -> %d' % (nm, a[1:-1], a[-1])


def print_script(ep, mid):
    a = open_episode(ep)
    scr = Screens(a, ep)
    o = parse(a.res(mid - 100), ep)
    W, H, _ = a.mapgrid(mid)
    print('== ep%d map %d  %dx%d turnLimit=%d' % (ep, mid, W, H, o['turnLimit']))
    print('factions:', [(f['name'], f['b'], f['gold']) for f in o['factions']])
    print('teams:', [(i, t['name'], 'F%d' % t['faction'], t['raw'][1:]) for i, t in enumerate(o['teams'])])
    for side in (0, 1):
        print('-- side', side, 'triggers:', o['triggers'][side])
        for i, act in enumerate(o['actions'][side]):
            print('  [%2d] %s' % (i, describe_action(act, o, scr)))
    print('deploy tiles by team:', {t: sum(1 for c in o['clips'] if c['b'] == t) for t in range(len(o['teams']))})
    print('areas:', [(x['points'], len(x['tiles'])) for x in o['areas']], 'portals:', o['portals'], 'escort:', o.get('escort'))


if __name__ == '__main__':
    print_script(int(sys.argv[1]), int(sys.argv[2]))
