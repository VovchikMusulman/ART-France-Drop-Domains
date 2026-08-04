const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  fs.mkdirSync('build', { recursive: true });
  const svgPath = path.resolve('public/app-icon.svg');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.goto(`file:///${svgPath.replace(/\\/g, '/')}`);
  await page.screenshot({ path: 'build/icon.png', omitBackground: false });
  console.log('ok', fs.statSync('build/icon.png').size);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
