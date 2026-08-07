// Full pipeline test minus posting: real headline → Sonnet 5 → portrait
// resolution → render. Usage: node test/e2e-test.js "BREAKING: ..." [name]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { analyzePost } from '../src/analyze.js';
import { pickBackground } from '../src/image.js';
import { renderStory } from '../src/render.js';

const headline = process.argv[2];
const name = process.argv[3] || 'e2e';
if (!headline) {
  console.error('usage: node test/e2e-test.js "BREAKING: ..." [outputName]');
  process.exit(1);
}

const analysis = await analyzePost(headline);
if (analysis.refused) {
  console.log('REFUSED by safety classifiers — item would be skipped');
  process.exit(0);
}
console.log(JSON.stringify({
  arabic: analysis.arabic_text,
  people: analysis.people,
  entities: analysis.entities?.map((e) => e.wikimedia_query),
  countries: analysis.countries,
  category: analysis.category,
  person_photo_unsafe: analysis.person_photo_unsafe,
}, null, 2));

const background = await pickBackground(analysis);
const png = await renderStory({
  arabicText: analysis.arabic_text,
  category: analysis.category,
  background,
});
fs.mkdirSync(config.outDir, { recursive: true });
const out = path.join(config.outDir, `${name}.png`);
fs.copyFileSync(png, out);
console.log(`rendered: ${out} (background: ${background.kind})`);
