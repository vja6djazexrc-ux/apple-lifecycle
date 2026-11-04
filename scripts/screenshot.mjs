// Renders the app in headless Chrome at several lifecycle moments and saves
// screenshots to ./shots — a quick visual regression check.
// Usage: node scripts/screenshot.mjs [url] [scenario,...]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const only = process.argv[3]?.split(',');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync('shots', { recursive: true });

const B = 5 * 365;
const scenarios = {
  seed: `jumpToDay(40)`,
  germ: `jumpToDay(112)`,
  seedling: `jumpToDay(230)`,
  juvenile: `jumpToDay(365*2.55)`,
  juvwinter: `jumpToDay(365*3.05)`,
  dormant: `jumpToDay(${B}+40)`,
  pink: `jumpToDay(${B}+M.phenology(app.cond,app.variety).pinkBud+3); update(); cameraPreset('branch')`,
  bloom: `jumpToDay(${B}+M.phenology(app.cond,app.variety).fullBloom)`,
  refblossom: `goReference('blossom')`,
  fruitlet: `jumpToDay(${B}+M.phenology(app.cond,app.variety).fullBloom+35)`,
  flowerclose: `jumpToDay(${B}+M.phenology(app.cond,app.variety).firstBloom+1.5); update(); select({kind:'flower', index: 60}); focusSelection()`,
  appleclose: `jumpToDay(${B}+M.phenology(app.cond,app.variety).harvest); update(); select({kind:'fruit', index: 3}); focusSelection()`,
  summer: `jumpToDay(${B}+200)`,
  refbranch: `goReference('branch')`,
  reftree: `goReference('tree')`,
  autumn: `setVariety('gala'); jumpToDay(${B}+305)`,
  winter: `jumpToDay(${B}+350)`,
};

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__apple, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
for (const [name, code] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(`(() => { const {app,M,cameraPreset,jumpToDay,goReference,setVariety,update,select,focusSelection} = window.__apple; ${code}; })()`);
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('shot', name);
}
const perf = await page.evaluate(async () => {
  const t0 = performance.now();
  let n = 0;
  await new Promise((res) => {
    const f = () => (++n < 60 ? requestAnimationFrame(f) : res());
    requestAnimationFrame(f);
  });
  return (performance.now() - t0) / 60;
});
console.log(`avg frame ${perf.toFixed(1)} ms`);
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
