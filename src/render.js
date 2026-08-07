import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from './config.js';

// Renders template/story.html with the given analysis + background into
// work/story.png (1080x1920). Returns the PNG path.
export async function renderStory({ arabicText, category, background }) {
  fs.mkdirSync(config.workDir, { recursive: true });

  const data = {
    arabicText,
    category: category || 'other',
    bgFile: background?.kind === 'photo' ? path.basename(background.path) : null,
    portraitFiles: background?.kind === 'portraits' ? background.paths.map((p) => path.basename(p)) : [],
    flagFiles: background?.kind === 'flags' ? background.paths.map((p) => path.basename(p)) : [],
  };

  const template = fs.readFileSync(config.templatePath, 'utf8');
  const html = template.replace(
    '__DATA__',
    JSON.stringify(data).replaceAll('<', '\\u003c'),
  );
  const htmlPath = path.join(config.workDir, 'story.html');
  fs.writeFileSync(htmlPath, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const pngPath = path.join(config.workDir, 'story.png');
    await page.screenshot({ path: pngPath });
    return pngPath;
  } finally {
    await browser.close();
  }
}
