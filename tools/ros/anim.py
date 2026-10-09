# -*- coding: utf-8 -*-
"""
anim.py - decode an animation-list resource of either episode (DataLoader::loadAnimationList) and optionally
extract every strip as a PNG.

Format (big-endian, verified on Ep2 5017 = the battle strips + dialogue portraits, 88 entries):
  u16 count; count x u32 length; then count x { u16 frameW, u16 frameH, png[length-4] }

Known lists: 5017 = in-battle strips (0..51 effects/projectiles, 52..87 portraits), 5006 = menu art.
Index -> use for 5017 (read from Unit::changeState's cast dispatcher @0x6bd80 and the state machine):
   0 green bloom (shapeshift)      1 wizard teleport      2 fear skull         3 sparkles (heal / life steal)
   4/5 Spirit Shroud spear-spirit (L/R)   6 Shield dome   7 Ice Field   8 holy sword   9 Retribution angel
  10 purple unsummon flame        11 Conjure pentagram   12 dust ring (Build / quicksand cells)
  13 Craftsmen splinters+rubble   14 Quicksand sand skull (Siren cast)   15 Absorb flash
  16/17 blade swoosh L/R  18/19 thrust streak  20/21 thrown hammer  22/23 arrows (plain/fire)  24 bullet
  25/27 rocks  26 fireball  28 cannonball  29 piercing bolt  30/31 slash  32/33 blood burst  34 earth spikes
  35 explosion  36 rock burst  37 fire burst  38 bolt impact  39 burning tiles  40 aim glow  41 burning unit
  42-45 grapeshot blast  46 white swirl  47 lightning  48/49 cannon sparks  50 portrait  51 unknown-unit icon

    python anim.py 2                # table
    python anim.py 2 5017 outdir    # extract NN_fwW_fhH.png
"""
import sys, os, struct
from rosdat import open_episode


def entries(ep, rid=5017):
    b = open_episode(ep).res(rid)
    n = struct.unpack('>H', b[:2])[0]
    lens = struct.unpack('>%dI' % n, b[2:2 + 4 * n])
    p = 2 + 4 * n
    out = []
    for k in range(n):
        fw, fh = struct.unpack('>HH', b[p:p + 4])
        png = b[p + 4:p + lens[k]]
        w, h = struct.unpack('>II', png[16:24]) if png[:8] == b'\x89PNG\r\n\x1a\n' else (0, 0)
        out.append({'idx': k, 'fw': fw, 'fh': fh, 'w': w, 'h': h, 'frames': (w // fw) if fw else 0, 'png': png})
        p += lens[k]
    return out


def main():
    ep = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    rid = int(sys.argv[2]) if len(sys.argv) > 2 else 5017
    outdir = sys.argv[3] if len(sys.argv) > 3 else None
    for e in entries(ep, rid):
        print('#%2d %5dx%-4d fw=%3d fh=%3d frames=%d' % (e['idx'], e['w'], e['h'], e['fw'], e['fh'], e['frames']))
        if outdir:
            os.makedirs(outdir, exist_ok=True)
            open(os.path.join(outdir, '%02d_fw%d_fh%d.png' % (e['idx'], e['fw'], e['fh'])), 'wb').write(e['png'])


if __name__ == '__main__':
    main()
