import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseDir = resolve(process.cwd(), 'release');
const archArg = process.argv.indexOf('--arch');
const signed = process.argv.includes('--signed');
const onlyArch = archArg >= 0 ? process.argv[archArg + 1] : null;
const commit =
  process.env.GITHUB_SHA ||
  (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })();
const builtAt = new Date().toISOString();
if (onlyArch !== null && !['arm64', 'x64'].includes(onlyArch)) {
  console.error('Only --arch arm64 or --arch x64 allowed');
  process.exit(1);
}
if (!existsSync(releaseDir)) {
  console.error('release/ missing – build the installers first');
  process.exit(1);
}
const files = readdirSync(releaseDir)
  .filter(name => /^Levuvo-Mail-(?:Setup-)?\d+\.\d+\.\d+-(?:arm64|x64)\.(?:exe|dmg|zip)$/.test(name))
  .filter(name => name.includes(`-${pkg.version}-`))
  .filter(name => !onlyArch || name.includes(`-${onlyArch}.`))
  .sort();
if (!files.length) {
  console.error('No matching installer files found for version ' + pkg.version);
  process.exit(1);
}
const artifacts = [];
for (const file of files) {
  const fp = join(releaseDir, file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(fp)) hash.update(chunk);
  const architecture = file.includes('-arm64.') ? 'arm64' : 'x64';
  const platform = file.endsWith('.exe') ? 'windows' : 'macos';
  artifacts.push({
    file,
    platform,
    architecture,
    bytes: statSync(fp).size,
    sha256: hash.digest('hex'),
    signedForDistribution: signed,
    signingStatus: signed
      ? 'signed (verify the signature separately, see build log)'
      : 'unsigned – internal test build, not for distribution',
    notarized: false
  });
}
const sums = artifacts.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n';
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), sums);
writeFileSync(
  join(releaseDir, 'release-manifest.json'),
  JSON.stringify({ product: 'Levuvo Mail', version: pkg.version, commit, builtAt, artifacts }, null, 2) + '\n'
);
console.log('Release manifests generated:');
for (const item of artifacts)
  console.log(`- ${item.file} (${item.platform}/${item.architecture}, SHA-256 ${item.sha256})`);
