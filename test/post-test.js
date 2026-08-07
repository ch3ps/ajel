// Live posting test: renders a card and publishes it to the Snapchat PUBLIC
// PROFILE (savedStory) rather than the personal friends story.
// Usage: node test/post-test.js
import { pickBackground } from '../src/image.js';
import { renderStory } from '../src/render.js';
import { hostImage } from '../src/media.js';
import { postStory } from '../src/post.js';

const analysis = {
  arabic_text: 'تركيا والسعودية وباكستان توقّع اتفاقية دفاع مشترك',
  people: [
    { type: 'office', value: 'President of Turkey' },
    { type: 'office', value: 'Crown Prince of Saudi Arabia' },
  ],
  entities: [{ name: 'signing ceremony', wikimedia_query: 'military cooperation agreement signing ceremony' }],
  countries: ['TR', 'SA', 'PK'],
  category: 'geopolitics',
  person_photo_unsafe: false,
};

const background = await pickBackground(analysis);
const png = await renderStory({
  arabicText: analysis.arabic_text,
  category: analysis.category,
  background,
});
console.log('rendered:', png, `(background: ${background.kind})`);

const url = await hostImage(png, `ajel-test-${Date.now()}.png`);
console.log('hosted:', url.split('?')[0], '(+SAS token)');

const result = await postStory(url);
console.log('result:', JSON.stringify(result, null, 2));
