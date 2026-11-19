#!/usr/bin/env node
// Signed release build with update feed.
//   macOS:   node scripts/release-signed.mjs mac
//   Windows: node scripts/release-signed.mjs win-x64 | win-arm64
//
// Required environment (never commit these values):
//   LEVUVO_UPDATE_URL            https URL where the release files will be uploaded
//   macOS:  CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application .p12) or CSC_NAME,
//           APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (notarization)
//   Windows: WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (Authenticode .pfx; locally CSC_LINK + CSC_KEY_PASSWORD
//           also work), LEVUVO_WIN_PUBLISHER (exact certificate subject CN)
//
// The bundled AI runtime (build/ai-runtime, npm run ai:runtime -- --arch <arch>) must already be
// built for the target; the script refuses to sign an installer without it. After the build it
// checks architectures, Electron fuses and (Windows) the publisher name the updater will compare.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pythonExe, pythonKey } from './build-ai-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const TARGETS = {
  mac: { platform: 'darwin', os: 'mac', arch: 'arm64' },
  'win-x64': { platform: 'win32', os: 'win', arch: 'x64' },
  'win-arm64': { platform: 'win32', os: 'win', arch: 'arm64' }
};

/** Problems with the AI runtime in `dir` for the given platform and architecture (empty = fine). */
export function aiRuntimeProblems(dir, platform, arch) {
  const manifest = join(dir, 'runtime.json');
  if (!existsSync(manifest)) return [`${manifest} missing: run npm run ai:runtime -- --arch ${arch} first`];
  let info;
  try {
    info = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return [`${manifest} is not valid JSON`];
  }
  const problems = [];
  const want = pythonKey(platform, arch, info.python);
  if (info.key !== want) problems.push(`AI runtime was built for ${info.key}, the target needs ${want}`);
  if (!existsSync(pythonExe(join(dir, 'python'), platform))) problems.push('AI runtime interpreter missing');
  return problems;
}

/** publisherName entries of an electron-updater app-update.yml (list or single value). */
export function publisherNames(yaml) {
  const lines = yaml.split(/\r?\n/);
  const i = lines.findIndex(l => /^publisherName:/.test(l));
  if (i === -1) return [];
  const unquote = v => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  const inline = lines[i].slice('publisherName:'.length).trim();
  if (inline) return [unquote(inline)];
  const out = [];
  for (const line of lines.slice(i + 1)) {
    const m = /^\s+-\s+(.*)$/.exec(line);
    if (!m) break;
    out.push(unquote(m[1]));
  }
  return out;
}

/**
 * electron-builder arguments. They are passed to `node cli.js` without a shell, so values with spaces
 * (a certificate CN like "Levuvo GmbH") stay one argument.
 */
export function builderArgs(target, env) {
  const feed = new URL(env.LEVUVO_UPDATE_URL);
  const args = ['--publish', 'never', '-c.publish.provider=generic', `-c.publish.url=${feed.toString()}`];
  if (target === 'mac')
    args.push(
      '--mac',
      'dmg',
      'zip',
      '--arm64',
      ...(env.CSC_NAME ? [`-c.mac.identity=${env.CSC_NAME}`] : []),
      '-c.mac.hardenedRuntime=true',
      '-c.mac.notarize=true',
      '-c.mac.entitlements=build/entitlements.mac.release.plist',
      '-c.mac.entitlementsInherit=build/entitlements.mac.release.plist'
    );
  else
    args.push(
      '--win',
      'nsis',
      target === 'win-arm64' ? '--arm64' : '--x64',
      // One update channel per architecture: both builds would otherwise write latest.yml and
      // one architecture would be offered the other one's installer.
      `-c.publish.channel=${target === 'win-arm64' ? 'latest-arm64' : 'latest-x64'}`,
      `-c.win.signtoolOptions.publisherName=${env.LEVUVO_WIN_PUBLISHER}`
    );
  return args;
}

function main() {
  const target = process.argv[2];
  const env = process.env;
  const fail = message => {
    console.error(`\n✗ ${message}\n`);
    process.exit(1);
  };
  const need = names => {
    const missing = names.filter(name => !env[name]);
    if (missing.length) fail(`Missing environment variables: ${missing.join(', ')}`);
  };
  const node = (script, args, what) => {
    const res = spawnSync(process.execPath, [join(root, script), ...args], { stdio: 'inherit', cwd: root });
    if (res.status !== 0) fail(`${what} failed.`);
  };

  const t = TARGETS[target];
  if (!t) fail('Specify a target: mac | win-x64 | win-arm64');
  need(['LEVUVO_UPDATE_URL']);
  let feed;
  try {
    feed = new URL(env.LEVUVO_UPDATE_URL);
  } catch {
    fail('LEVUVO_UPDATE_URL is not a valid URL.');
  }
  if (feed.protocol !== 'https:') fail('LEVUVO_UPDATE_URL must use https.');

  if (target === 'mac') {
    if (process.platform !== 'darwin') fail('macOS releases must be built on macOS.');
    if (!env.CSC_LINK && !env.CSC_NAME) fail('CSC_LINK (certificate) or CSC_NAME (keychain identity) missing.');
    need(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
  } else {
    if (process.platform !== 'win32') fail('Windows releases must be built on Windows (signing).');
    if (!env.WIN_CSC_LINK && !env.CSC_LINK) fail('WIN_CSC_LINK (Authenticode certificate) missing.');
    need(['LEVUVO_WIN_PUBLISHER']);
  }
  const runtime = aiRuntimeProblems(join(root, 'build', 'ai-runtime'), t.platform, t.arch);
  if (runtime.length) fail(`Bundled AI runtime: ${runtime.join('; ')}`);

  node('node_modules/vite/bin/vite.js', ['build', '--config', 'apps/web/vite.config.ts'], 'Frontend build');
  node('node_modules/electron-builder/cli.js', builderArgs(target, env), 'electron-builder');
  node('scripts/verify-app-arch.mjs', [t.os, t.arch], 'Architecture check');
  node('scripts/verify-fuses.mjs', [t.os, t.arch], 'Electron fuse check');
  if (t.os === 'win') {
    const dir = join(root, 'release', t.arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked');
    const file = join(dir, 'resources', 'app-update.yml');
    const names = existsSync(file) ? publisherNames(readFileSync(file, 'utf8')) : [];
    if (names.length !== 1 || names[0] !== env.LEVUVO_WIN_PUBLISHER)
      fail(
        `app-update.yml publisherName is ${JSON.stringify(names)}, expected "${env.LEVUVO_WIN_PUBLISHER}". ` +
          'Installed apps would reject every update.'
      );
  }
  console.log(`\n✓ Signed build finished. Upload all files from release/ (incl. latest*.yml) to ${feed}.\n`);
}

if (/release-signed\.mjs$/.test(process.argv[1] || '')) main();
