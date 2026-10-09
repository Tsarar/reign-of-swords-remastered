# -*- coding: utf-8 -*-
"""
rosdat.py - reader for the Reign of Swords `reignofswords.dat` resource archives
(iOS Episode I 2008 and Episode II "Hexhammer" 2009).

Archive format (verified against ResourceManager::read in both binaries):
    u32 LE count
    count x { u32 LE id, u32 LE (type<<24 | offset), u32 LE length }
    data section (offset relative to its start); type 1 = zlib, 0 = raw

Well-known resources (same ids in both episodes):
    5004  string table          5009  dialogue screens
    5010  unit table            5017  dialogue portrait pool (Ep2)
    5100+ / 5300+ / 5500+ / 5700+   scenario records ("Mission" data)
    5200+ / 5400+ / 5600+ / 5800+   map grids   (map id = scenario id + 100)
"""
import struct, zlib, os

HERE = os.path.dirname(os.path.abspath(__file__))
# Your own copy of each episode's iOS data archive (reignofswords.dat — not included in this repository): set
# ROS_DAT_EP1 / ROS_DAT_EP2, or put the files at extracted-assets/ios-episode-<n>/_raw/ beside the repository.
DAT = {
    n: os.environ.get('ROS_DAT_EP%d' % n) or os.path.join(
        HERE, '..', '..', '..', 'extracted-assets', 'ios-episode-%d' % n, '_raw', 'reignofswords.dat')
    for n in (1, 2)
}


class Archive:
    def __init__(self, path):
        self.path = path
        d = self.d = open(path, 'rb').read()
        count = struct.unpack_from('<I', d, 0)[0]
        self.recs = {}
        p = 4
        for _ in range(count):
            rid, v1, ln = struct.unpack_from('<III', d, p)
            p += 12
            self.recs[rid] = (v1 >> 24, v1 & 0xFFFFFF, ln)
        self.base = p
        self._cache = {}

    def ids(self, lo, hi):
        return [i for i in sorted(self.recs) if lo <= i < hi]

    def __contains__(self, rid):
        return rid in self.recs

    def raw(self, rid):
        typ, off, ln = self.recs[rid]
        return self.d[self.base + off:self.base + off + ln], typ

    def res(self, rid):
        if rid not in self._cache:
            b, typ = self.raw(rid)
            if typ == 1:
                b = zlib.decompress(b)
            self._cache[rid] = b
        return self._cache[rid]

    # ---- string tables ---------------------------------------------------
    def strtab(self, rid):
        """Decode a string-table resource. Layout: u16 BE count, then count
        offsets (u16 BE, or u32 BE when the packed text exceeds 64 KB), then the
        packed text; entry i = text[off[i]:off[i+1]] (null-terminated)."""
        b = self.res(rid)
        n = struct.unpack_from('>H', b, 0)[0]
        for width, fmt in ((2, '>H'), (4, '>I')):
            offs = [struct.unpack_from(fmt, b, 2 + i * width)[0] for i in range(n)]
            ds = 2 + n * width
            ok = all(offs[i] <= offs[i + 1] for i in range(n - 1)) and offs[-1] <= len(b) - ds
            if ok:
                out = []
                for i in range(n):
                    e = offs[i + 1] if i + 1 < n else len(b) - ds
                    s = b[ds + offs[i]:ds + e]
                    out.append(s.split(b'\0')[0].decode('latin1'))
                return out
        raise ValueError('cannot decode string table %d' % rid)

    def strings(self):
        return self.strtab(5004)

    # ---- map grids -------------------------------------------------------
    def mapgrid(self, mid):
        b = self.res(mid)
        W, H = struct.unpack_from('>HH', b, 0)
        c = b[4:]
        rows = [[struct.unpack_from('>H', c, (y * W + x) * 2)[0] for x in range(W)] for y in range(H)]
        return W, H, rows


def open_episode(ep):
    return Archive(DAT[ep])


if __name__ == '__main__':
    import sys
    ep = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    a = open_episode(ep)
    print('records', len(a.recs))
    fams = {}
    for rid in sorted(a.recs):
        fams.setdefault(rid // 100 * 100, []).append(rid)
    for f, ids in fams.items():
        print('  %5d: %3d ids  %d..%d' % (f, len(ids), ids[0], ids[-1]))
    S = a.strings()
    print('strings', len(S))
    if len(sys.argv) > 2:
        q = sys.argv[2].lower()
        for i, s in enumerate(S):
            if q in s.lower():
                print(i, repr(s))
