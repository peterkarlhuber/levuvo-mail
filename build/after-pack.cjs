// electron-builder afterPack hook: the SQLite index module (better-sqlite3-multiple-ciphers)
// ships prebuilt binaries for every platform. Only the one for the target platform and
// architecture stays in the app; the others would be dead weight and fail the architecture
// check in scripts/verify-app-arch.mjs.
const fs = require('node:fs');
const path = require('node:path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function findUnpacked(dir, depth = 0) {
  if (depth > 4) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'app.asar.unpacked') return full;
    const found = findUnpacked(full, depth + 1);
    if (found) return found;
  }
  return null;
}

exports.default = async function afterPack(context) {
  const arch = ARCH[context.arch] || String(context.arch);
  const keep = `${context.electronPlatformName}-${arch}.node`;
  const unpacked = findUnpacked(context.appOutDir);
  if (!unpacked) throw new Error('afterPack: app.asar.unpacked not found');
  const dir = path.join(unpacked, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds');
  if (!fs.existsSync(dir)) throw new Error(`afterPack: ${dir} missing`);
  if (!fs.existsSync(path.join(dir, keep))) throw new Error(`afterPack: no SQLite binary for ${keep}`);
  for (const file of fs.readdirSync(dir)) if (file !== keep) fs.rmSync(path.join(dir, file), { force: true });
  console.log(`afterPack: kept SQLite binary ${keep}`);
};
