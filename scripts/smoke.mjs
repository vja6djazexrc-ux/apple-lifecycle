import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__apple, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
// jump to harvest, frame tree, find an unoccluded apple and click it
const pos = await page.evaluate(async () => {
  const { app, M, jumpToDay, cameraPreset, tree, camera, update } = window.__apple;
  jumpToDay(5 * 365 + M.phenology(app.cond, app.variety).harvest - 5);
  update();
  cameraPreset('tree');
  await new Promise((r) => setTimeout(r, 1800));
  const THREE_V = tree.fruitWorldPosition(0).constructor;
  for (let i = 0; i < tree.fruitInfo.length; i++) {
    if (!tree.fruitInfo[i]) continue;
    const p = tree.fruitWorldPosition(i).project(camera);
    const x = ((p.x + 1) / 2) * innerWidth, y = ((1 - p.y) / 2) * innerHeight;
    if (x > 420 && x < 1150 && y > 120 && y < 800) return { i, x, y };
  }
});
let selected = null;
for (const dx of [0, 3, -3]) {
  await page.mouse.click(pos.x + dx, pos.y);
  await new Promise((r) => setTimeout(r, 300));
  selected = await page.evaluate(() => window.__apple.app.selected);
  if (selected) break;
}
const insp = await page.evaluate(() => ({ hidden: document.getElementById('inspector').hidden, title: document.getElementById('insp-title').textContent, rows: document.getElementById('insp-rows').textContent.slice(0, 120) }));
// pick it
await page.click('#insp-pick');
await new Promise((r) => setTimeout(r, 300));
const basket = await page.evaluate(() => window.__apple.app.basket.length);
// table view + tabs
await page.click('#table-toggle');
await page.click('[data-tab="climate"]');
const rows = await page.evaluate(() => document.querySelectorAll('#table-wrap tr').length);
// conditions slider: drought
await page.evaluate(() => { const i = document.getElementById('cond-water'); i.value = 40; i.dispatchEvent(new Event('input')); });
await new Promise((r) => setTimeout(r, 500));
const diam = await page.evaluate(() => window.__apple.app.state.fruit.diam.toFixed(1));
// share link
const hash = await page.evaluate(() => { document.getElementById('share-btn').click(); return new Promise((r) => setTimeout(() => r(location.hash), 300)); });
// playback
await page.evaluate(() => { const { jumpToDay } = window.__apple; jumpToDay(0); document.getElementById('play').click(); });
await new Promise((r) => setTimeout(r, 2000));
const u = await page.evaluate(() => window.__apple.app.u.toFixed(1));
console.log(JSON.stringify({ clickedTarget: pos, selected, insp, basket, tableRows: rows, droughtDiam: diam, hash, uAfter2sPlay: u, errors }, null, 1));
await browser.close();
