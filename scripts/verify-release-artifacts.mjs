import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const dir = resolve(process.cwd(), 'release');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const targets = [
  `Levuvo-Mail-${version}-arm64.dmg`,
  `Levuvo-Mail-Setup-${version}-arm64.exe`,
  `Levuvo-Mail-Setup-${version}-x64.exe`
];
let problems = [];
for (const file of targets) {
  const f = join(dir, file);
  if (!existsSync(f) || statSync(f).size < 10000) problems.push(`MISSING OR TOO SMALL: ${file}`);
  else console.log(`OK ${file} (${statSync(f).size} bytes)`);
}
const sums = join(dir, 'SHA256SUMS.txt');
if (existsSync(sums)) {
  const map = new Map(
    readFileSync(sums, 'utf8')
      .split(/\r?\n/)
      .map(line => /^([a-f0-9]{64})\s\s(.+)$/.exec(line))
      .filter(Boolean)
      .map(m => [m[2], m[1]])
  );
  for (const file of targets) {
    const f = join(dir, file);
    if (!existsSync(f)) continue;
    const hash = createHash('sha256').update(readFileSync(f)).digest('hex');
    if (map.get(file) !== hash) problems.push(`SHA256 MISSING OR WRONG: ${file}`);
  }
} else problems.push('SHA256SUMS.txt missing');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('3/3 verified artifacts present. Signing and real-OS tests must be checked separately.');
