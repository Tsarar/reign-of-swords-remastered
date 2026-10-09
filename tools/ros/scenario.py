# -*- coding: utf-8 -*-
"""
scenario.py - parser for the Reign of Swords scenario ("Mission") records.

Grammar read directly from the iOS binaries (tools/ros/bin/ros_ep1, ros_ep2):
  Mission::Mission(Context*, GameScreen*, int id, Map*, int)  @ep1 0x52ade / @ep2 0x62026
    header:  short i, short turnLimit, short an, short n, n x short, short p, short q(bool)
    Mission::loadFactions   byte n; per: name(byte len), byte, short, int, int, short
    Mission::loadTeams      byte n; per: name(byte len), 6 x byte (0xff -> 0 on the last 3)
    Mission::loadUnits / restoreUnits   short n; per: byte type, byte group, name(byte len)
    [Mission::loadTriggers, Mission::loadActions] for side 0, then side 1
        triggers: short n; per: short tag + TAG_SIZE[tag] shorts (unknown tag -> 1 short)
        actions:  short n; per: short op + ACTION_SIZES[op] shorts
    Mission::loadMarkers    sections, each: short count + entries (see MARKERS below)

All multi-byte values are big-endian (mlib_DataInput::readShort/readInt). readByte is
unsigned; readShort is sign-extended.

Terminology: what the binary calls a *faction* is the side that owns a gold budget
(the Android decompile and the recreation call it a "team"); what the binary calls a
*team* is a named army group with heraldry (recreation: "group").
"""
import struct

ACTION_SIZES = {1: [5, 2, 3, 4, 2, 3, 2, 3, 2, 2, 2, 3],   # __ZN7Mission12ACTION_SIZESE
                2: [7, 2, 3, 4, 2, 3, 2, 3, 2, 2, 2, 3]}
TAG_SIZE = {1: {0: 3, 6: 3, 7: 2, 8: 3, 9: 3},
            2: {0: 5, 6: 6, 7: 2, 8: 3, 9: 3, 10: 2, 11: 2}}

OPNAMES = {0: 'SPAWN', 1: 'SCREEN', 2: 'CAMERA', 3: 'MOVE', 4: 'HIDE', 5: 'ATTACK',
           6: 'SHOW', 7: 'TAG', 8: 'REMOVE', 9: 'COUNTER', 10: 'SETFLAG', 11: 'AIMODE'}


class Reader:
    def __init__(self, buf):
        self.b = buf
        self.p = 0

    def rem(self):
        return len(self.b) - self.p

    def u8(self):
        v = self.b[self.p]
        self.p += 1
        return v

    def s16(self):
        v = struct.unpack_from('>h', self.b, self.p)[0]
        self.p += 2
        return v

    def s32(self):
        v = struct.unpack_from('>i', self.b, self.p)[0]
        self.p += 4
        return v

    def name(self):
        n = self.u8()
        s = self.b[self.p:self.p + n]
        self.p += n
        return s.decode('latin1')


def parse(buf, ep):
    r = Reader(buf)
    o = {'ep': ep}
    o['i'] = r.s16()
    o['turnLimit'] = r.s16()
    o['an'] = r.s16()
    n = r.s16()
    o['o'] = [r.s16() for _ in range(n)]
    o['p'] = r.s16()
    o['q'] = r.s16()
    # factions (gold-owning sides)
    F = []
    for _ in range(r.u8()):
        nm = r.name()
        F.append({'name': nm, 'b': r.u8(), 'gold': r.s16(), 'x': r.s32(), 'aa': r.s32(), 'ab': r.s16()})
    o['factions'] = F
    # teams (named groups w/ heraldry)
    T = []
    for _ in range(r.u8()):
        nm = r.name()
        v = [r.u8() for _ in range(6)]
        T.append({'name': nm, 'faction': v[0], 'a1': v[1], 'a2': v[2],
                  'attrs': [0 if x == 0xff else x for x in v[3:6]], 'raw': v})
    o['teams'] = T
    # unit templates
    TP = []
    for _ in range(r.s16()):
        t = r.u8()
        g = r.u8()
        TP.append({'type': t, 'group': g, 'name': r.name()})
    o['templates'] = TP
    # triggers + actions x2
    ts = TAG_SIZE[ep]
    asz = ACTION_SIZES[ep]

    def triggers():
        out = []
        for _ in range(r.s16()):
            tag = r.s16()
            out.append([tag] + [r.s16() for _ in range(ts.get(tag, 1))])
        return out

    def actions():
        out = []
        for _ in range(r.s16()):
            op = r.s16()
            k = asz[op] if 0 <= op < len(asz) else 0
            out.append([op] + [r.s16() for _ in range(k)])
        return out

    o['triggers'] = [triggers(), None]
    o['actions'] = [actions(), None]
    o['triggers'][1] = triggers()
    o['actions'][1] = actions()
    # markers
    def bbss():
        return {'a': r.u8(), 'b': r.u8(), 'x': r.s16(), 'y': r.s16()}
    o['clips'] = [bbss() for _ in range(r.s16())]           # A: deploy-tile highlights
    if ep == 2:                                             # B: warp portals
        P = []
        for _ in range(r.s16()):
            flag = r.s16()
            sx, sy, dx, dy = r.s16(), r.s16(), r.s16(), r.s16()
            m = r.u8()
            P.append({'flag': flag, 'src': [sx, sy], 'dst': [dx, dy], 'mask': [r.u8() for _ in range(m)]})
        o['portals'] = P
    else:
        o['portals'] = []
    C = []
    o['areasFlag'] = r.s16()                                # C: objective areas: short flag; if >0: short n;
    if o['areasFlag'] > 0:                                  #    n x (short points, short cnt, cnt x bbss)
        for _ in range(r.s16()):
            pts = r.s16()
            C.append({'points': pts, 'tiles': [bbss() for _ in range(r.s16())]})
    o['areas'] = C
    o['listD'] = [bbss() for _ in range(r.s16())]           # D
    o['listE'] = [bbss() for _ in range(r.s16())]           # E
    if ep == 2:                                             # F: escort operation
        nops = r.s16()
        esc = None
        if nops > 0:
            markers = [bbss() for _ in range(r.s16())]
            units = [r.s16() for _ in range(r.s16())]
            esc = {'ops': nops, 'markers': markers, 'units': units}
        o['escort'] = esc
    o['_rem'] = r.rem()
    o['_len'] = len(buf)
    return o


def spawns(o):
    """op0 SPAWN actions -> list of dicts {side, x, y, tid, type, group, faction, facing, extra}."""
    out = []
    for side in (0, 1):
        for idx, a in enumerate(o['actions'][side]):
            if a[0] != 0:
                continue
            x, y, tid, facing = a[1], a[2], a[3], a[4]
            extra = a[5:-1]
            t = o['templates'][tid] if 0 <= tid < len(o['templates']) else {'type': -1, 'group': -1}
            g = t['group']
            fac = o['teams'][g]['faction'] if 0 <= g < len(o['teams']) else -1
            out.append({'side': side, 'idx': idx, 'x': x, 'y': y, 'tid': tid, 'type': t['type'],
                        'group': g, 'faction': fac, 'facing': facing, 'extra': extra, 'next': a[-1]})
    return out


if __name__ == '__main__':
    import sys
    from rosdat import open_episode
    ep = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    a = open_episode(ep)
    ids = a.ids(5100, 5200) + a.ids(5300, 5400) + a.ids(5500, 5600) + a.ids(5700, 5800)
    bad = 0
    for sid in ids:
        try:
            o = parse(a.res(sid), ep)
            if o['_rem'] != 0:
                bad += 1
                print('REM', sid, o['_rem'], '/', o['_len'])
        except Exception as e:
            bad += 1
            print('ERR', sid, e)
    print('episode', ep, 'scenarios', len(ids), 'bad', bad)
