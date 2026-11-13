import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const errors = [];
if (process.platform !== 'win32') errors.push('For this project the Windows installer must be built on Windows.');
if (!['x64', 'arm64'].includes(process.arch)) errors.push(`Unsupported host architecture: ${process.arch}`);
if (!existsSync(path.resolve('apps/desktop/assets/levuvo.ico'))) errors.push('Windows app icon missing.');
if (pkg.build?.appId !== 'at.levuvo.mail') errors.push('App ID does not match.');
if (pkg.build?.nsis?.oneClick !== false || pkg.build?.nsis?.perMachine !== false)
  errors.push('NSIS must install interactively and per user.');
if (errors.length) {
  for (const e of errors) console.error('ERROR:', e);
  process.exitCode = 1;
} else console.log(`Windows build ready: ${process.arch}, Node ${process.version}, NSIS, app ID ${pkg.build.appId}.`);
