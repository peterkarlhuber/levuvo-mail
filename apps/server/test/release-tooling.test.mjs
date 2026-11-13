import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectArchitectures } from '../../../scripts/verify-app-arch.mjs';

function pe(machine) {
  const b = Buffer.alloc(256);
  b.writeUInt16LE(0x5a4d, 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  b.writeUInt16LE(machine, 0x84);
  return b;
}
test('PE/Mach-O architecture detection distinguishes x64, arm64 and ia32', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  try {
    const f = (name, buf) => {
      writeFileSync(join(dir, name), buf);
      return join(dir, name);
    };
    assert.deepEqual(detectArchitectures(f('a.exe', pe(0x8664))), ['x64']);
    assert.deepEqual(detectArchitectures(f('b.exe', pe(0xaa64))), ['arm64']);
    assert.deepEqual(detectArchitectures(f('c.exe', pe(0x14c))), ['ia32']);
    const m = Buffer.alloc(32);
    m.writeUInt32LE(0xfeedfacf, 0);
    m.writeUInt32LE(0x0100000c, 4);
    assert.deepEqual(detectArchitectures(f('d', m)), ['arm64']);
    assert.deepEqual(detectArchitectures(f('e.txt', Buffer.from('hello world, no binary'))), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
