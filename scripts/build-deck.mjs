// Builds the self-contained pitch deck: docs/deck/deck.template.html with every
// {{IMG:name}} and {{FONT:name}} placeholder replaced by a data: URI.
//
// Everything is inlined because the deck is meant to be opened from a file://
// path, mailed around, or published as an artifact — all three of which have no
// working relative path back to deck-preview/, and the artifact CSP blocks
// external requests outright (a font CDN would fail silently and drop the whole
// deck to a system fallback). Screenshots are downscaled and re-encoded as JPEG
// with `sips` (macOS, no dependency to install) so the finished file stays
// around a megabyte instead of five; the woff2 files are already latin-only
// subsets and go in as-is.
//
// Screenshots come from two generators, and both output directories are
// git-ignored like every other Playwright artifact in this repo:
//   node scripts/preview-deck.mjs        -> deck-preview/   (extension in-page)
//   node scripts/preview-onboarding.mjs  -> demo-preview/   (onboarding wizard)
//
// Which is why docs/deck/index.html IS committed, unlike most build output: it
// is the thing people open, and from a clean clone it could not be rebuilt
// without first running both generators (i.e. without Chromium).
//
// Usage: node scripts/build-deck.mjs
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'docs/deck/deck.template.html');
const OUT = join(ROOT, 'docs/deck/index.html');

const SOURCES = {
  '10-news-original': 'deck-preview',
  '11-news-persona-a': 'deck-preview',
  '12-news-persona-b': 'deck-preview',
  '20-product-original': 'deck-preview',
  '21-product-persona-a': 'deck-preview',
  '01-step1-connect': 'demo-preview',
  '02-step2-verify': 'demo-preview'
};

// Latin-subset woff2, fetched once from Google Fonts (both families are open
// licensed: Newsreader and IBM Plex are SIL OFL 1.1).
const FONTS = ['newsreader', 'plex-sans', 'plex-mono'];

const MAX_EDGE = 1000;
const QUALITY = 78;

const tmp = await mkdtemp(join(tmpdir(), 'ensight-deck-build-'));
let html = await readFile(TEMPLATE, 'utf8');
let bytes = 0;
let fontBytes = 0;

for (const name of FONTS) {
  const data = await readFile(join(ROOT, 'docs/deck/fonts', `${name}.woff2`));
  fontBytes += data.length;
  const token = `{{FONT:${name}}}`;
  if (!html.includes(token)) throw new Error(`template has no ${token}`);
  html = html.replaceAll(token, `data:font/woff2;base64,${data.toString('base64')}`);
}

try {
  for (const [name, dir] of Object.entries(SOURCES)) {
    const src = join(ROOT, dir, `${name}.png`);
    const jpg = join(tmp, `${name}.jpg`);
    execFileSync('sips', ['-Z', String(MAX_EDGE), '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(QUALITY), src, '--out', jpg], { stdio: 'ignore' });
    const data = await readFile(jpg);
    bytes += data.length;
    const token = `{{IMG:${name}}}`;
    if (!html.includes(token)) throw new Error(`template has no ${token}`);
    html = html.replaceAll(token, `data:image/jpeg;base64,${data.toString('base64')}`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const leftover = html.match(/\{\{(IMG|FONT):[^}]+\}\}/g);
if (leftover) throw new Error(`unresolved placeholders: ${[...new Set(leftover)].join(', ')}`);

await writeFile(OUT, html);
console.log(OUT);
console.log(`  ${Object.keys(SOURCES).length} images, ${(bytes / 1024).toFixed(0)} KB of JPEG`);
console.log(`  ${FONTS.length} fonts, ${(fontBytes / 1024).toFixed(0)} KB of woff2`);
console.log(`  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB total`);
