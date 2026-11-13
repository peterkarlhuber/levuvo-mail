#!/usr/bin/env node
// Signed release build with update feed.
//   macOS:   node scripts/release-signed.mjs mac
//   Windows: node scripts/release-signed.mjs win-x64 | win-arm64
//
// Required environment (never commit these values):
//   LEVUVO_UPDATE_URL            https URL where the release files will be uploaded
//   macOS:  CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application .p12) or CSC_NAME,
//           APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (notarization)
//   Windows: CSC_LINK + CSC_KEY_PASSWORD (code signing certificate .pfx), or
//           WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD; LEVUVO_WIN_PUBLISHER (exact certificate subject CN)
import { spawnSync } from 'node:child_process';

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

if (!['mac', 'win-x64', 'win-arm64'].includes(target)) fail('Specify a target: mac | win-x64 | win-arm64');
need(['LEVUVO_UPDATE_URL']);
let feed;
try {
  feed = new URL(env.LEVUVO_UPDATE_URL);
} catch {
  fail('LEVUVO_UPDATE_URL is not a valid URL.');
}
if (feed.protocol !== 'https:') fail('LEVUVO_UPDATE_URL must use https.');

const args = [
  'electron-builder',
  '--publish',
  'never',
  '-c.publish.provider=generic',
  `-c.publish.url=${feed.toString()}`
];

if (target === 'mac') {
  if (process.platform !== 'darwin') fail('macOS releases must be built on macOS.');
  if (!env.CSC_LINK && !env.CSC_NAME) fail('CSC_LINK (certificate) or CSC_NAME (keychain identity) missing.');
  need(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
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
} else {
  if (process.platform !== 'win32') fail('Windows releases must be built on Windows (signing).');
  if (!env.CSC_LINK && !env.WIN_CSC_LINK) fail('CSC_LINK or WIN_CSC_LINK (signing certificate) missing.');
  need(['LEVUVO_WIN_PUBLISHER']);
  args.push(
    '--win',
    'nsis',
    target === 'win-arm64' ? '--arm64' : '--x64',
    // One update channel per architecture: both builds would otherwise write latest.yml and
    // one architecture would be offered the other one's installer.
    `-c.publish.channel=${target === 'win-arm64' ? 'latest-arm64' : 'latest-x64'}`,
    `-c.win.signtoolOptions.publisherName=${env.LEVUVO_WIN_PUBLISHER}`
  );
}

const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (build.status !== 0) fail('Frontend build failed.');
const run = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (run.status !== 0) fail('electron-builder failed.');
console.log(`\n✓ Signed build finished. Upload all files from release/ (incl. latest*.yml) to ${feed}.\n`);
