import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const errors = [];
if (process.platform !== 'win32')
  errors.push('Der Windows-Installer muss für dieses Projekt auf Windows erstellt werden.');
if (!['x64', 'arm64'].includes(process.arch)) errors.push(`Nicht unterstützte Hostarchitektur: ${process.arch}`);
if (!existsSync(path.resolve('apps/desktop/assets/levuvo.ico'))) errors.push('Windows-App-Icon fehlt.');
if (pkg.build?.appId !== 'at.levuvo.mail') errors.push('App-ID stimmt nicht überein.');
if (pkg.build?.nsis?.oneClick !== false || pkg.build?.nsis?.perMachine !== false)
  errors.push('NSIS muss interaktiv und pro Benutzer installieren.');
if (errors.length) {
  for (const e of errors) console.error('FEHLER:', e);
  process.exitCode = 1;
} else console.log(`Windows-Build bereit: ${process.arch}, Node ${process.version}, NSIS, App-ID ${pkg.build.appId}.`);
