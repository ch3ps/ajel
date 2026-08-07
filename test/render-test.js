// Visual pipeline test that skips the Claude call: feeds a hand-written
// analysis through the real background-selection + render steps.
// Usage: node test/render-test.js [pact|oil|css]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { pickBackground } from '../src/image.js';
import { renderStory } from '../src/render.js';

const scenarios = {
  // US stocks → the office resolves to whoever currently chairs the Fed
  stocks: {
    arabic_text: 'تراجع الأسهم الأمريكية بعد إشارات من الاحتياطي الفيدرالي بإبقاء الفائدة مرتفعة لفترة أطول',
    people: [{ type: 'office', value: 'Chair of the Federal Reserve' }],
    entities: [{ name: 'NYSE', wikimedia_query: 'stock exchange trading floor' }],
    countries: ['US'],
    category: 'markets',
    person_photo_unsafe: false,
  },
  // two countries → two faces, split down the middle
  usuk: {
    arabic_text: 'واشنطن ولندن توقّعان اتفاقاً تجارياً جديداً يشمل خفض الرسوم الجمركية',
    people: [
      { type: 'office', value: 'President of the United States' },
      { type: 'office', value: 'Prime Minister of the United Kingdom' },
    ],
    entities: [],
    countries: ['US', 'GB'],
    category: 'politics',
    person_photo_unsafe: false,
  },
  pact: {
    arabic_text: 'تركيا والسعودية وباكستان توقّع اتفاقية دفاع مشترك',
    entities: [{ name: 'Recep Tayyip Erdoğan', wikimedia_query: 'Recep Tayyip Erdogan official portrait' }],
    countries: ['TR', 'SA', 'PK'],
    category: 'geopolitics',
    sensitive: false,
  },
  oil: {
    arabic_text: 'ارتفاع سعر خام برنت بنسبة 5% بعد التوترات في مضيق هرمز',
    entities: [{ name: 'Oil tanker', wikimedia_query: 'oil tanker sea' }],
    countries: [],
    category: 'markets',
    sensitive: false,
  },
  flag: {
    // sensitive story: entity photos are skipped, flag tier kicks in
    arabic_text: 'اليابان تعلن أن كوريا الشمالية أطلقت ما يُحتمل أن يكون صاروخاً باليستياً باتجاه بحر اليابان، وسط حالة تأهب في المنطقة',
    entities: [{ name: 'Kim Jong Un', wikimedia_query: 'Kim Jong Un official portrait' }],
    countries: ['KP', 'JP'],
    category: 'military',
    sensitive: true,
  },
  css: {
    arabic_text: 'صندوق النقد الدولي يحذر من تباطؤ النمو العالمي خلال العام المقبل',
    entities: [],
    countries: [],
    category: 'economy',
    sensitive: false,
  },
};

const name = process.argv[2] || 'pact';
const analysis = scenarios[name];
if (!analysis) {
  console.error(`unknown scenario: ${name} (use ${Object.keys(scenarios).join('|')})`);
  process.exit(1);
}

const background = await pickBackground(analysis);
const png = await renderStory({
  arabicText: analysis.arabic_text,
  category: analysis.category,
  background,
});
fs.mkdirSync(config.outDir, { recursive: true });
const out = path.join(config.outDir, `test-${name}.png`);
fs.copyFileSync(png, out);
console.log(`rendered: ${out} (background: ${background.kind})`);
