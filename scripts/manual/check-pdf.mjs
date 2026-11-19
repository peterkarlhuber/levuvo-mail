// Checks the built manual PDFs: tagged (PDF/UA), a title with the product name, fonts embedded,
// a sensible page count. Needs poppler-utils (pdfinfo, pdffonts).
//   node scripts/manual/check-pdf.mjs dist/manual
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2] || 'dist/manual';
const files = readdirSync(dir).filter(f => f.endsWith('.pdf'));
const problems = [];
if (files.length < 2) problems.push(`expected a German and an English PDF in ${dir}, found ${files.length}`);
for (const f of files) {
  const path = join(dir, f);
  const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  const field = name => new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(info)?.[1]?.trim() ?? '';
  if (field('Tagged') !== 'yes') problems.push(`${f}: not tagged`);
  if (!field('Title').startsWith('Levuvo Mail')) problems.push(`${f}: title "${field('Title')}"`);
  const pages = Number(field('Pages'));
  if (!(pages >= 15 && pages <= 80)) problems.push(`${f}: ${pages} pages`);
  const fonts = execFileSync('pdffonts', [path], { encoding: 'utf8' }).split('\n').slice(2).filter(Boolean);
  for (const line of fonts)
    if (!/\byes\s+yes\s+(yes|no)\s+\d+/.test(line)) problems.push(`${f}: font not embedded: ${line}`);
  if (!fonts.some(l => /Inter/.test(l))) problems.push(`${f}: Inter is not used (font missing?)`);
  console.log(`${f}: ${pages} pages, tagged, ${fonts.length} fonts`);
}
if (problems.length) {
  console.error('✗ Manual PDF check failed:\n' + problems.map(p => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('✓ Manual PDFs are tagged, titled and have their fonts embedded.');
