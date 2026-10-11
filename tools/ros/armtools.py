#!/usr/bin/env python3
"""ARM (Thumb) helpers for the original iOS binaries, which keep their C++ symbols — the way most rules in this
codebase were read. Needs `pip install capstone` and the binaries in tools/ros/bin/ (ros_ep1, ros_ep2: the Mach-O
executables out of the episodes' IPAs; git-ignored, never published).

    python tools/ros/armtools.py fn     2 determineBestAttack charge   functions whose name holds any word: start-end name
    python tools/ros/armtools.py dis    2 7a672 7ac98                  disassemble a range (calls annotated with names)
    python tools/ros/armtools.py writes 2 b4                           every strb to [reg, #0xb4] (a Unit byte field)
    python tools/ros/armtools.py calls  2 74204                        every call to 0x74204 with the r1 it is given
    python tools/ros/armtools.py switch 2 7e910                        the case table after a `blx ___switch32` at 0x7e910

Episode 1 = 1, Episode 2 = 2. Addresses are hex without 0x. A literal pool can hide code from a linear disassembly:
disassemble the function's own range (from `fn`) rather than the whole text section.
"""
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rosbin import MachO  # noqa: E402


def load(ep):
    from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB

    m = MachO(os.path.join(HERE, "bin", "ros_ep" + ep))
    _seg, _sect, base, size, fileoff = [s for s in m.sects if s[1] == "__text"][0][:5]
    md = Cs(CS_ARCH_ARM, CS_MODE_THUMB)
    md.skipdata = True
    funcs = sorted((ad & ~1, nm[0]) for ad, nm in m.funcs.items())
    return m, md, base, size, fileoff, funcs


def ranges(funcs, base, size):
    for i, (ad, nm) in enumerate(funcs):
        hi = funcs[i + 1][0] if i + 1 < len(funcs) else base + size
        if ad >= base and hi - ad <= 0x8000:
            yield ad, hi, nm


def main(cmd, ep, *args):
    m, md, base, size, fo, funcs = load(ep)
    names = dict(funcs)
    code = lambda lo, hi: md.disasm(m.d[fo + lo - base : fo + hi - base], lo)
    if cmd == "fn":
        for lo, hi, nm in ranges(funcs, base, size):
            if any(w.lower() in nm.lower() for w in args):
                print("%08x-%08x %s" % (lo, hi, nm))
    elif cmd == "dis":
        lo, hi = int(args[0], 16), int(args[1], 16)
        for x in code(lo, hi):
            note = ""
            if x.mnemonic in ("bl", "blx") and x.op_str.startswith("#"):
                note = "  -> " + names.get(int(x.op_str[1:], 16) & ~1, "?")
            print("%08x %-7s %s%s" % (x.address, x.mnemonic, x.op_str, note))
    elif cmd == "writes":
        off = int(args[0], 16)
        for lo, hi, nm in ranges(funcs, base, size):
            regs = {}
            for x in code(lo, hi):
                mv = re.match(r"(r\d+), #(0x[0-9a-f]+|\d+)$", x.op_str)
                if x.mnemonic in ("movs", "mov") and mv:
                    regs[mv.group(1)] = int(mv.group(2), 0)
                    continue
                sh = re.match(r"(r\d+), (r\d+), #(\d+)$", x.op_str)
                if x.mnemonic == "lsls" and sh and sh.group(2) in regs:
                    regs[sh.group(1)] = regs[sh.group(2)] << int(sh.group(3))
                    continue
                if x.mnemonic.startswith("strb"):
                    imm = re.match(r"(r\d+), \[(r\d+), #(0x[0-9a-f]+|\d+)\]", x.op_str)
                    reg = re.match(r"(r\d+), \[(r\d+), (r\d+)\]", x.op_str)
                    if (imm and int(imm.group(3), 0) == off) or (reg and regs.get(reg.group(3)) == off):
                        print("%08x %s  %s %s" % (x.address, nm, x.mnemonic, x.op_str))
    elif cmd == "calls":
        target = int(args[0], 16)
        for lo, hi, nm in ranges(funcs, base, size):
            r1 = None
            for x in code(lo, hi):
                mv = re.match(r"r1, #(0x[0-9a-f]+|\d+)$", x.op_str)
                if x.mnemonic in ("movs", "mov") and mv:
                    r1 = int(mv.group(1), 0)
                if x.mnemonic in ("bl", "blx") and x.op_str.startswith("#"):
                    if int(x.op_str[1:], 16) == target:
                        print("%08x %s r1=%s" % (x.address, nm, r1))
                    r1 = None
    elif cmd == "switch":
        # Apple's ___switch32: a word count N, then N + 1 offsets relative to the table (case index = r0)
        table = (int(args[0], 16) + 4 + 3) & ~3
        word = lambda ad: struct.unpack("<i", m.d[fo + ad - base : fo + ad - base + 4])[0]
        n = word(table)
        for i in range(n + 1):
            print(i, hex(table + word(table + 4 + 4 * i)))
    else:
        print(__doc__)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
    else:
        main(sys.argv[1], sys.argv[2], *sys.argv[3:])
