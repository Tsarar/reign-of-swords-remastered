# -*- coding: utf-8 -*-
"""
rosrange.py - disassemble an arbitrary Thumb address range of an iOS binary (for the static helper functions that
carry no symbol and are therefore skipped by `rosbin.py --all`).

    python rosrange.py bin/ros_ep2 7c6e2 7d6f2 [out.asm]
"""
import sys
from capstone.arm import ARM_OP_IMM, ARM_OP_MEM, ARM_REG_PC
from rosbin import MachO


def dump(m, start, end, w):
    m.md_thumb.skipdata = True
    o = m.a2o(start)
    code = m.d[o:o + (end - start)]
    w('### range %08x-%08x T\n' % (start, end))
    for ins in m.md_thumb.disasm(code, start):
        if ins.id == 0:
            w('%08x .data    %s\n' % (ins.address, ins.op_str)); continue
        ann = []
        if ins.mnemonic.startswith(('bl', 'b', 'cb')) or ins.mnemonic == 'bx':
            for op in ins.operands:
                if op.type == ARM_OP_IMM:
                    t = m.target_name(op.imm)
                    if t:
                        ann.append('-> ' + t)
        for op in ins.operands:
            if op.type == ARM_OP_MEM and op.mem.base == ARM_REG_PC and ins.mnemonic.startswith('ldr'):
                la = ((ins.address + 4) & ~3) + op.mem.disp
                v = m.u32(la)
                if v is not None:
                    ann.append('[lit@%x] %s' % (la, m.annotate_value(v)))
        tail = ('    ; ' + ' '.join(ann)) if ann else ''
        w('%08x %-8s %s%s\n' % (ins.address, ins.mnemonic, ins.op_str, tail))
    w('\n')


if __name__ == '__main__':
    m = MachO(sys.argv[1])
    a, b = int(sys.argv[2], 16), int(sys.argv[3], 16)
    if len(sys.argv) > 4:
        with open(sys.argv[4], 'w', encoding='utf-8') as f:
            dump(m, a, b, f.write)
    else:
        dump(m, a, b, sys.stdout.write)
