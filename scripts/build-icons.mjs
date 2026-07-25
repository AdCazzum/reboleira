// Rasterizza src/ui/icons/mark.svg nei PNG che il manifest dichiara.
//
// Chrome non accetta SVG per `icons` / `action.default_icon`: vuole bitmap, e
// le vuole nelle quattro misure canoniche. Il vettore resta la fonte di
// verità e i PNG sono output generato — committato, però, così `npm run
// build` non dipende da Chromium.
//
// Ogni misura è renderizzata DAL VETTORE alla sua dimensione nativa, non
// ricampionata dal 128: un downsample 128->16 spalmerebbe l'anello (2 px a
// quella misura) su una macchia grigia illeggibile, che è esattamente il modo
// in cui le icone d'estensione vengono di solito rovinate.
//
// Playwright invece di sharp/resvg perché è già una devDependency (e2e) e
// perché rasterizza con lo stesso motore che poi disegnerà l'icona nella
// toolbar: ciò che si vede qui è ciò che spedisci.
//
// Uso: node scripts/build-icons.mjs   (oppure: npm run icons)
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const iconsDir = join(root, 'src', 'ui', 'icons');
const SIZES = [16, 32, 48, 128];

const svg = await readFile(join(iconsDir, 'mark.svg'), 'utf8');

// Il browser lo scala a tutta viewport, quindi width/height nel sorgente non
// devono vincolarlo: restano nel file solo perché mark.svg vada bene anche
// aperto da solo.
const page_html = `<!doctype html>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: 100vw; height: 100vh; }
</style>
${svg}`;

const browser = await chromium.launch();
const written = [];
let failure = null;
try {
  for (const size of SIZES) {
    // Una pagina per misura: il viewport è ciò che determina la risoluzione di
    // rendering del vettore, e cambiarlo a caldo non ridisegna sempre l'SVG.
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1
    });
    await page.setContent(page_html);
    const file = join(iconsDir, `icon-${size}.png`);
    // omitBackground: senza, lo sfondo bianco di default finirebbe nel PNG e
    // l'icona apparirebbe come un francobollo bianco sui temi scuri.
    await writeFile(file, await page.screenshot({ omitBackground: true }));
    await page.close();
    written.push(file);
  }
} catch (e) {
  failure = e;
} finally {
  // try/finally come in scripts/preview-onboarding.mjs: un errore a metà ciclo
  // lascerebbe altrimenti un Chromium orfano.
  await browser.close();
}

for (const f of written) console.log(`  ${f}`);
if (failure) {
  console.error(`\nRasterizzazione fallita: ${failure}`);
  process.exit(1);
}
console.log(`\n${written.length} icone scritte da mark.svg.`);
