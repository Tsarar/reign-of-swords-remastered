# -*- coding: utf-8 -*-
"""
rosbin.py - Mach-O (32-bit ARM, thin) loader + annotated disassembler for the
Reign of Swords iOS binaries (Episode I v1.2 and Episode II 1.0.11).

Both binaries are unencrypted (cryptid 0) and ship with their full symbol
tables, so every function can be located by its (mangled) C++ name.

Usage:
    python rosbin.py <ros-binary> <symbol-substring> [...]   # disassemble
    python rosbin.py <ros-binary> --all out.asm              # full dump
    python rosbin.py <ros-binary> --list [substring]         # list functions

Annotations: call targets (direct + via import stubs), pc-relative literal
loads (value, symbol, C string), thumb/arm mode per function.
"""
import struct, sys, bisect
from capstone import Cs, CS_ARCH_ARM, CS_MODE_ARM, CS_MODE_THUMB
from capstone.arm import ARM_OP_IMM, ARM_OP_MEM, ARM_REG_PC


class MachO:
    def __init__(self, path):
        self.path = path
        d = self.d = open(path, 'rb').read()
        magic = struct.unpack_from('<I', d, 0)[0]
        assert magic == 0xfeedface, 'expected thin 32-bit LE Mach-O, got %08x' % magic
        ncmds = struct.unpack_from('<I', d, 16)[0]
        o = 28
        self.sects = []  # (segname, sectname, addr, size, fileoff, reserved1, reserved2)
        self.symoff = self.nsyms = self.stroff = self.strsize = 0
        self.indoff = self.nind = 0
        for _ in range(ncmds):
            cmd, sz = struct.unpack_from('<II', d, o)
            if cmd == 1:  # LC_SEGMENT
                nsects = struct.unpack_from('<I', d, o + 48)[0]
                so = o + 56
                for _ in range(nsects):
                    sn = d[so:so + 16].split(b'\0')[0].decode()
                    sg = d[so + 16:so + 32].split(b'\0')[0].decode()
                    addr, size, off = struct.unpack_from('<3I', d, so + 32)
                    r1, r2 = struct.unpack_from('<II', d, so + 56)
                    self.sects.append((sg, sn, addr, size, off, r1, r2))
                    so += 68
            elif cmd == 2:  # LC_SYMTAB
                self.symoff, self.nsyms, self.stroff, self.strsize = struct.unpack_from('<4I', d, o + 8)
            elif cmd == 0xb:  # LC_DYSYMTAB
                self.indoff, self.nind = struct.unpack_from('<II', d, o + 56)
            o += sz
        strtab = d[self.stroff:self.stroff + self.strsize]
        self.syms = []  # (name, type, sect, desc, value)
        for i in range(self.nsyms):
            n_strx, n_type, n_sect, n_desc, n_value = struct.unpack_from('<IBBHI', d, self.symoff + i * 12)
            name = strtab[n_strx:strtab.find(b'\0', n_strx)].decode('latin1') if n_strx else ''
            self.syms.append((name, n_type, n_sect, n_desc, n_value))
        self.text_idx = [i for i, s in enumerate(self.sects) if s[1] == '__text'][0] + 1
        self.funcs = {}  # addr -> (name, thumb)
        self.byname = {}
        for name, t, sect, desc, val in self.syms:
            if not name or not val:
                continue
            if (t & 0x0e) == 0x0e and sect == self.text_idx:
                thumb = 1 if (desc & 0x0008) else (val & 1)
                a = val & ~1
                self.funcs.setdefault(a, (name, thumb))
                self.byname.setdefault(name, (a, thumb))
        self.faddrs = sorted(self.funcs)
        self.addrsym = {}
        for name, t, sect, desc, val in self.syms:
            if name and val and (t & 0x0e) == 0x0e:
                self.addrsym.setdefault(val & ~1, name)
        # import stubs -> indirect symbol names
        self.stubs = {}
        for sg, sn, addr, size, off, r1, r2 in self.sects:
            if 'stub' in sn and r2:
                for k in range(size // r2):
                    idx = struct.unpack_from('<I', d, self.indoff + (r1 + k) * 4)[0]
                    if idx < self.nsyms:
                        self.stubs[addr + k * r2] = self.syms[idx][0]
        self.md_arm = Cs(CS_ARCH_ARM, CS_MODE_ARM)
        self.md_arm.detail = True
        self.md_thumb = Cs(CS_ARCH_ARM, CS_MODE_THUMB)
        self.md_thumb.detail = True

    def a2o(self, a):
        for sg, sn, addr, size, off, r1, r2 in self.sects:
            if off and addr <= a < addr + size:
                return off + (a - addr)
        return None

    def u32(self, a):
        o = self.a2o(a)
        return struct.unpack_from('<I', self.d, o)[0] if o is not None else None

    def s16(self, a):
        o = self.a2o(a)
        return struct.unpack_from('<h', self.d, o)[0] if o is not None else None

    def cstr(self, a, maxlen=200):
        o = self.a2o(a)
        if o is None:
            return None
        e = self.d.find(b'\0', o, o + maxlen)
        if e < 0:
            return None
        s = self.d[o:e]
        if not s or any(c < 9 or (13 < c < 32) or c > 126 for c in s):
            return None
        return s.decode('latin1')

    def func_end(self, a):
        i = bisect.bisect_right(self.faddrs, a)
        return self.faddrs[i] if i < len(self.faddrs) else a + 0x1000

    def find(self, sub):
        if sub in self.byname:
            return sub
        c = [n for n in self.byname if sub in n]
        if not c:
            return None
        return sorted(c, key=len)[0]

    def target_name(self, t):
        t2 = t & ~1
        if t2 in self.stubs:
            return self.stubs[t2]
        if t2 in self.funcs:
            return self.funcs[t2][0]
        return self.addrsym.get(t2)

    def annotate_value(self, v):
        parts = ['=%d/0x%x' % (v, v)]
        nm = self.addrsym.get(v & ~1)
        if nm:
            parts.append(nm)
        s = self.cstr(v)
        if s:
            parts.append('"%s"' % s)
        return ' '.join(parts)

    def disasm(self, name, out=None, maxlen=None):
        w = out.write if out else sys.stdout.write
        nm = self.find(name)
        if nm is None:
            w('NOT FOUND %s\n' % name)
            return
        addr, thumb = self.byname[nm]
        end = self.func_end(addr)
        if maxlen:
            end = min(end, addr + maxlen)
        o = self.a2o(addr)
        code = self.d[o:o + (end - addr)]
        md = self.md_thumb if thumb else self.md_arm
        w('### %s @%08x %s\n' % (nm, addr, 'T' if thumb else 'A'))
        for ins in md.disasm(code, addr):
            ann = []
            if ins.mnemonic.startswith(('bl', 'b', 'cb')) or ins.mnemonic == 'bx':
                for op in ins.operands:
                    if op.type == ARM_OP_IMM:
                        t = self.target_name(op.imm)
                        if t:
                            ann.append('-> ' + t)
            for op in ins.operands:
                if op.type == ARM_OP_MEM and op.mem.base == ARM_REG_PC and ins.mnemonic.startswith('ldr'):
                    base = ((ins.address + 4) & ~3) if thumb else ins.address + 8
                    la = base + op.mem.disp
                    v = self.u32(la)
                    if v is not None:
                        ann.append('[lit@%x] %s' % (la, self.annotate_value(v)))
                elif op.type == ARM_OP_IMM and op.imm > 0x1000 and not ins.mnemonic.startswith('b'):
                    s = self.cstr(op.imm)
                    if s:
                        ann.append('"%s"' % s)
            tail = ('    ; ' + ' '.join(ann)) if ann else ''
            w('%08x %-8s %s%s\n' % (ins.address, ins.mnemonic, ins.op_str, tail))
        w('\n')

    def dump_all(self, out):
        with open(out, 'w', encoding='latin1') as f:
            for a in self.faddrs:
                self.disasm(self.funcs[a][0], f)


if __name__ == '__main__':
    m = MachO(sys.argv[1])
    args = sys.argv[2:]
    if not args or args[0] == '--list':
        sub = args[1].lower() if len(args) > 1 else ''
        for a in m.faddrs:
            if sub in m.funcs[a][0].lower():
                print('%08x %s' % (a, m.funcs[a][0]))
    elif args[0] == '--all':
        m.dump_all(args[1])
    else:
        for n in args:
            m.disasm(n)
