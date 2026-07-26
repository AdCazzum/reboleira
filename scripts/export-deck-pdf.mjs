// Exports docs/deck/index.html to a PDF, one slide per page.
//
// 1280x720 px = 13.333in x 7.5in at 96dpi, the widescreen slide size Keynote
// and PowerPoint use, so the file drops into a normal deck workflow. The page
// box is asked for here AND declared in the deck's @media print block, so
// Cmd+P from a browser produces the same thing as this script.
//
// printBackground is on: the four dark slides are the deck's spine, and
// without it they would come out as white pages with white text.
//
// The fonts are already data URIs inside the HTML, so Chromium embeds them and
// the text stays selectable and searchable — this is not a stack of images.
//
// Usage: node scripts/export-deck-pdf.mjs [out.pdf]
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DECK = join(ROOT, 'docs/deck/index.html');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'docs/deck/reboleira-deck.pdf'));

const WIDTH = 1280;
const HEIGHT = 720;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const problems = [];
page.on('pageerror', e => problems.push(String(e)));
page.on('console', m => m.type() === 'error' && problems.push(m.text()));

try {
  await page.goto(pathToFileURL(DECK).href, { waitUntil: 'load' });
  // The faces are font-display:block; printing before they resolve would set
  // the whole deck in the fallback stack without failing anything.
  await page.evaluate(() => document.fonts.ready);
  const slides = await page.locator('.slide').count();

  // The slides clip their overflow, which is what keeps one slide on one page —
  // and also what makes too-tall content disappear in silence instead of
  // spilling somewhere visible. So measure every slide against the page box
  // under print rules BEFORE exporting, and say which ones are over.
  await page.emulateMedia({ media: 'print' });
  const troppoAlte = await page.evaluate((h) => {
    return [...document.querySelectorAll('.slide')].map((slide, i) => {
      const stile = getComputedStyle(slide);
      const serve = slide.firstElementChild.getBoundingClientRect().height
        + parseFloat(stile.paddingTop) + parseFloat(stile.paddingBottom);
      return serve > h ? { slide: i + 1, serve: Math.round(serve) } : null;
    }).filter(Boolean);
  }, HEIGHT);
  for (const { slide, serve } of troppoAlte) {
    problems.push(`slide ${slide}: serve ${serve}px in un box da ${HEIGHT}px — contenuto tagliato`);
  }
  await page.emulateMedia({ media: null });

  await page.pdf({
    path: OUT,
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });

  // A slide whose content outgrows the page box does not fail — it silently
  // spills onto a second page, and the deck quietly stops being one-slide-one-
  // page. Counting the page objects in the output is the only honest check.
  const pdf = await readFile(OUT, 'latin1');
  const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (pages !== slides) {
    problems.push(`impaginazione: ${pages} pagine per ${slides} slide — qualche slide sfora il page box`);
  }

  // The check that actually matters, and the one whose absence shipped a
  // broken deck: a font that the page renders happily can still fail to make
  // it into the PDF — Chromium simply drops variable fonts when printing, and
  // every reader then substitutes something with the wrong metrics. Nothing
  // warns; the export succeeds and the file is ruined.
  const embedded = [...new Set([...pdf.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-,_]+)/g)]
    .map(m => m[1].replace(/^[A-Z]{6}\+/, '')))];
  const mancanti = ['Newsreader', 'IBMPlexSans', 'IBMPlexMono']
    .filter(f => !embedded.some(e => e.replace(/[\s-]/g, '').startsWith(f)));

  console.log(`${OUT}\n  ${pages} pagine per ${slides} slide, ${WIDTH}x${HEIGHT}px`);
  console.log(`  font incorporati: ${embedded.join(', ') || 'nessuno'}`);
  if (mancanti.length > 0) {
    problems.push(`font non incorporati: ${mancanti.join(', ')} — il PDF userà sostituti`);
  }
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problema/i:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
