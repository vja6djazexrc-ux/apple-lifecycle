import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as M from './model.js';
import { AppleTree } from './scene/tree.js';
import { Environment } from './scene/environment.js';
import { Seedling } from './scene/seedling.js';
import { Bees } from './scene/bees.js';
import { VIS, windUniforms, sightUniforms } from './scene/shared.js';
import { ChartGroup, doyLabel, MONTHS, sparkline } from './ui/charts.js';

const $ = (id) => document.getElementById(id);
const { smoothstep, clamp, lerp } = M;
const SERIES = { mine: '#3987e5', base: '#898781' };
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const B = M.BEARING_YEAR * M.YEAR;

// ------------------------------------------------------------------ renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1200);
camera.position.set(0.32, 0.12, 0.32);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.1;
controls.maxDistance = 80;
controls.zoomToCursor = true;
controls.autoRotateSpeed = 0.6;
controls.target.set(0.04, -0.05, 0.04);

const env = new Environment(scene, renderer);
const tree = new AppleTree(11);
scene.add(tree.group);
const seedling = new Seedling();
scene.add(seedling.group);
const bees = new Bees(scene);
const SPURS = tree.spurs.length;

// camera-facing rings marking the hovered / selected object
function makeHalo(color, opacity) {
  const m = new THREE.Mesh(new THREE.RingGeometry(1, 1.1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  m.visible = false;
  m.renderOrder = 10;
  scene.add(m);
  return m;
}
const hoverHalo = makeHalo(0xffffff, 0.7);
const selHalo = makeHalo(0x86b6ef, 0.95);

// ------------------------------------------------------------------ state
const app = {
  u: 0,
  playing: false,
  speed: 1,
  cond: { ...M.DEFAULT_CONDITIONS },
  variety: 'gala',
  state: null,
  dirty: true,
  chartsDirty: true,
  stripDirty: true,
  tab: 'fruit',
  table: false,
  selected: null,
  hovered: null,
  follow: false,
  focusPoint: null,
  basket: [],
  opts: { autocam: true, wind: true, shadows: true, bees: true, rotate: false, loop: false },
};

// ------------------------------------------------------------------ UI: conditions
const COND_DEFS = [
  { key: 'temp', label: 'Temperature', min: -3, max: 3, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v} °C`, hint: 'vs regional normal; shifts bloom and harvest dates' },
  { key: 'sun', label: 'Sunlight', min: 40, max: 130, step: 5, fmt: (v) => `${v}%`, hint: 'drives fruit size, sugar and red colour' },
  { key: 'water', label: 'Water supply', min: 30, max: 180, step: 5, fmt: (v) => `${v}%`, hint: 'of crop need; drought shrinks fruit, excess dilutes sugar' },
  { key: 'pollinators', label: 'Pollinator activity', min: 10, max: 150, step: 5, fmt: (v) => `${v}%`, hint: 'bee visits during bloom set the fruit count' },
  { key: 'thinning', label: 'Fruit thinning', min: 0, max: 80, step: 5, fmt: (v) => `${v}%`, hint: 'fruitlets removed; fewer apples grow larger' },
];
const condInputs = {};
for (const d of COND_DEFS) {
  const wrap = document.createElement('div');
  wrap.className = 'cond';
  const id = `cond-${d.key}`;
  wrap.innerHTML = `<label for="${id}"><span>${d.label}</span><output id="${id}-out"></output></label>
    <input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}" />
    <div class="hint-text">${d.hint}</div>`;
  $('conditions').appendChild(wrap);
  const input = wrap.querySelector('input');
  const out = wrap.querySelector('output');
  condInputs[d.key] = { input, out, def: d };
  input.addEventListener('input', () => {
    app.cond[d.key] = parseFloat(input.value);
    out.textContent = d.fmt(app.cond[d.key]);
    app.dirty = app.chartsDirty = app.stripDirty = true;
  });
}
function syncCondInputs() {
  for (const [k, { input, out, def }] of Object.entries(condInputs)) {
    input.value = app.cond[k];
    out.textContent = def.fmt(app.cond[k]);
  }
}
$('reset-cond').addEventListener('click', () => {
  app.cond = { ...M.DEFAULT_CONDITIONS };
  syncCondInputs();
  app.dirty = app.chartsDirty = app.stripDirty = true;
});

// variety
for (const [k, v] of Object.entries(M.VARIETIES)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = v.label;
  $('variety').appendChild(o);
}
$('variety').addEventListener('change', (e) => setVariety(e.target.value));
function setVariety(k) {
  app.variety = k;
  $('variety').value = k;
  tree.setVariety(k);
  app.dirty = app.chartsDirty = app.stripDirty = true;
}

// ------------------------------------------------------------------ UI: charts
const fruitX = [95, 335];
const monthTicks = (from, to, every = 1) => (x0, x1) => {
  const t = [];
  for (let m = from; m <= to; m += every) {
    const x = MONTH_START[m] + 15;
    if (x >= x0 && x <= x1) t.push({ x, label: MONTHS[m] });
  }
  return t;
};
const chartsRoot = $('charts');
const groups = {
  fruit: new ChartGroup(
    chartsRoot,
    [
      { title: 'Fruit diameter', unit: 'mm', fmt: (v) => `${v.toFixed(1)} mm`, bandLabels: true },
      { title: 'Fruit weight', unit: 'g', fmt: (v) => `${v.toFixed(0)} g` },
      { title: 'Sugar content', unit: '°Brix', fmt: (v) => `${v.toFixed(1)} °Bx`, yMin: null },
      { title: 'Flesh firmness', unit: 'lbf', fmt: (v) => `${v.toFixed(1)} lbf`, yMin: null },
    ],
    {
      xDomain: fruitX,
      xTicks: monthTicks(3, 10),
      xLabel: (x) => doyLabel(x),
      bands: () => {
        const p = M.phenology(app.cond, app.variety);
        return [
          { x0: p.fullBloom, x1: p.cellDivEnd, label: 'Cell division' },
          { x0: p.ripening, x1: p.harvest, label: 'Ripening' },
        ];
      },
    }
  ),
  climate: new ChartGroup(
    chartsRoot,
    [
      { title: 'Daily mean temperature', unit: '°C', fmt: (v) => `${v.toFixed(1)} °C`, yMin: null },
      { title: 'Heat units, cumulative', unit: 'GDD base 5 °C', fmt: (v) => `${Math.round(v)} GDD` },
    ],
    { xDomain: [0, 364], xTicks: monthTicks(0, 11, 2), xLabel: (x) => doyLabel(x) }
  ),
  tree: new ChartGroup(
    chartsRoot,
    [
      { title: 'Tree height', unit: 'm', fmt: (v) => `${v.toFixed(2)} m` },
      { title: 'Trunk caliper', unit: 'cm', fmt: (v) => `${v.toFixed(1)} cm` },
      { title: 'Canopy width', unit: 'm', fmt: (v) => `${v.toFixed(2)} m` },
    ],
    {
      xDomain: [0, 6],
      xTicks: () => [0, 1, 2, 3, 4, 5, 6].map((y) => ({ x: y, label: `Yr ${y}` })),
      xLabel: (x) => `Tree age ${x.toFixed(1)} yr`,
    }
  ),
};
let seriesCache = null;

function refreshCharts() {
  const mine = M.seasonSeries(app.cond, app.variety, SPURS);
  const base = M.seasonSeries(M.DEFAULT_CONDITIONS, app.variety, SPURS);
  const tMine = M.treeSeries(app.cond);
  const tBase = M.treeSeries(M.DEFAULT_CONDITIONS);
  seriesCache = { mine, base, tMine, tBase };
  const mk = (rows, key, xKey = 'doy') => rows.map((r) => ({ x: r[xKey], y: r[key] }));
  const pair = (key, a, b, xKey) => [
    { label: 'Regional baseline', color: SERIES.base, values: mk(b, key, xKey) },
    { label: 'Your conditions', color: SERIES.mine, values: mk(a, key, xKey), primary: true },
  ];
  ['diam', 'weight', 'brix', 'firmness'].forEach((k, i) => groups.fruit.charts[i].setData(pair(k, mine.rows, base.rows)));
  ['temp', 'gdd'].forEach((k, i) => groups.climate.charts[i].setData(pair(k, mine.rows, base.rows)));
  ['height', 'caliper', 'canopy'].forEach((k, i) => groups.tree.charts[i].setData(pair(k, tMine, tBase, 'years')));
  if (app.table) renderTable();
}

function setTab(tab) {
  app.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const [k, g] of Object.entries(groups)) g.visible = k === tab && !app.table;
  if (app.table) renderTable();
  updateChartMarkers();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('table-toggle').addEventListener('click', () => {
  app.table = !app.table;
  $('table-toggle').setAttribute('aria-pressed', String(app.table));
  $('table-wrap').hidden = !app.table;
  setTab(app.tab);
});

function renderTable() {
  if (!seriesCache) return;
  const wrap = $('table-wrap');
  const st = app.state;
  const table = document.createElement('table');
  table.className = 'data';
  const head = document.createElement('tr');
  const addRow = (cells, isNow) => {
    const tr = document.createElement('tr');
    if (isNow) tr.className = 'now';
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  };
  const pairTxt = (a, b, d = 1) => (a == null ? '—' : `${a.toFixed(d)} (${b == null ? '—' : b.toFixed(d)})`);
  let cols;
  if (app.tab === 'tree') {
    cols = ['Tree age', 'Height m', 'Caliper cm', 'Canopy m'];
    const { tMine, tBase } = seriesCache;
    const nowY = st ? st.absDay / M.YEAR : -1;
    for (let i = 0; i < tMine.length; i += 13) {
      const a = tMine[i];
      const b = tBase[i];
      addRow([`${a.years.toFixed(2)} yr`, pairTxt(a.height, b.height, 2), pairTxt(a.caliper, b.caliper), pairTxt(a.canopy, b.canopy, 2)], Math.abs(a.years - nowY) < 0.125);
    }
  } else {
    const { mine, base } = seriesCache;
    const fruit = app.tab === 'fruit';
    cols = fruit ? ['Date', 'Diam mm', 'Weight g', '°Brix', 'Firm lbf'] : ['Date', 'Mean °C', 'GDD'];
    const start = fruit ? Math.floor(mine.pheno.fullBloom) : 0;
    const end = fruit ? 330 : 364;
    for (let d = start; d <= end; d += 7) {
      const a = mine.rows[d];
      const b = base.rows[d];
      const now = st && Math.abs(st.doy - d) < 3.5;
      if (fruit) addRow([doyLabel(d), pairTxt(a.diam, b.diam), pairTxt(a.weight, b.weight, 0), pairTxt(a.brix, b.brix), pairTxt(a.firmness, b.firmness)], now);
      else addRow([doyLabel(d), pairTxt(a.temp, b.temp), pairTxt(a.gdd, b.gdd, 0)], now);
    }
  }
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    head.appendChild(th);
  }
  table.prepend(head);
  const cap = document.createElement('p');
  cap.className = 'muted small';
  cap.textContent = 'Values: your conditions (regional baseline). Weekly rows; current week highlighted.';
  wrap.replaceChildren(cap, table);
}

function updateChartMarkers() {
  const st = app.state;
  if (!st) return;
  groups.fruit.setMarker(st.doy);
  groups.climate.setMarker(st.doy);
  groups.tree.setMarker(st.absDay / M.YEAR);
  let note = '';
  if (app.tab === 'fruit') note = st.year < M.BEARING_YEAR ? `Projection for the first full crop (year ${M.BEARING_YEAR}). The marker shows today's calendar date.` : 'Curves past the harvest band show fruit left unpicked on the tree.';
  else if (app.tab === 'climate') note = 'Heat accumulation (growing degree days) times bud break, bloom and ripening; warmer springs shift every stage earlier.';
  else note = 'Juvenile trees only grow wood and leaves; sunlight, water and temperature change vigour.';
  $('chart-note').textContent = note;
}

// ------------------------------------------------------------------ UI: timeline strip
const SHORT = {
  seed: 'Seed',
  germination: 'Germinate',
  seedling: 'Seedling',
  juvenile: 'Juvenile growth · years 1–4',
  dormant: 'Dormant',
  silverTip: 'Bud break',
  tightCluster: 'Tight cluster',
  pinkBud: 'Pink',
  bloom: 'Bloom',
  petalFall: 'Petal fall',
  cellDivision: 'Cell division',
  cellExpansion: 'Cell expansion',
  ripening: 'Ripening',
  harvest: 'Harvest',
  leafFall: 'Leaf fall',
  dormant2: 'Dormant',
};
const SEASON_ICON = { Winter: '❄️', Spring: '🌸', Summer: '☀️', Autumn: '🍂' };
const pct = (u) => `${(u / M.TIMELINE_MAX) * 100}%`;

function buildStrip() {
  const strip = $('strip');
  strip.replaceChildren();
  const stages = M.stageList(app.cond, app.variety);
  for (const s of stages) {
    const u0 = M.dayToU(s.start);
    const u1 = M.dayToU(s.end);
    const d = document.createElement('div');
    d.className = 'seg-stage';
    d.dataset.id = s.id;
    d.style.left = pct(u0);
    d.style.width = pct(u1 - u0);
    d.textContent = SHORT[s.id];
    d.title = `${s.label} — click to jump`;
    d.addEventListener('click', () => jumpToDay(s.start + Math.min(2, (s.end - s.start) * 0.15)));
    strip.appendChild(d);
  }
  // drop labels that don't fit their segment (the tooltip still names the stage)
  requestAnimationFrame(() =>
    strip.querySelectorAll('.seg-stage, .seg-season').forEach((d) => {
      if (d.scrollWidth > d.clientWidth + 1) d.textContent = d.dataset.short || '';
      if (d.scrollWidth > d.clientWidth + 1) d.textContent = '';
    })
  );
  // season / year row
  const seasonSpans = [];
  const addSeasons = (yearStart, withNames) => {
    const bounds = [
      [0, 79, 'Winter'],
      [79, 172, 'Spring'],
      [172, 266, 'Summer'],
      [266, 355, 'Autumn'],
      [355, 365, 'Winter'],
    ];
    for (const [a, b, name] of bounds) seasonSpans.push({ u0: M.dayToU(yearStart + a), u1: M.dayToU(yearStart + b), text: withNames && b - a > 20 ? `${SEASON_ICON[name]} ${name}` : SEASON_ICON[name], short: SEASON_ICON[name], title: name });
  };
  addSeasons(0, false);
  seasonSpans.push({ u0: M.dayToU(M.YEAR), u1: M.dayToU(B), text: 'Years 1–4: seasons cycle as the tree grows', title: 'Juvenile years' });
  addSeasons(B, true);
  for (const s of seasonSpans) {
    const d = document.createElement('div');
    d.className = 'seg-season';
    d.style.left = pct(s.u0);
    d.style.width = pct(s.u1 - s.u0);
    d.textContent = s.text;
    if (s.short) d.dataset.short = s.short;
    d.title = s.title;
    strip.appendChild(d);
  }
  // ticks
  const ticks = $('ticks');
  ticks.replaceChildren();
  const addTick = (u, label) => {
    const sp = document.createElement('span');
    sp.style.left = pct(u);
    sp.textContent = label;
    ticks.appendChild(sp);
  };
  addTick(6, 'Sow');
  for (let y = 1; y <= 4; y++) addTick(M.dayToU(y * M.YEAR), `Yr ${y}`);
  addTick(M.dayToU(B) + 8, 'Yr 5');
  for (let m = 1; m < 12; m++) addTick(M.dayToU(B + MONTH_START[m]), MONTHS[m]);
}

// ------------------------------------------------------------------ UI: stage + tiles
let lastStageId = '';
function tileHTML(label, value, unit, sub) {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div>${sub ? `<div class="sub">${sub}</div>` : '<div class="sub">&nbsp;</div>'}</div>`;
}
function delta(v, b, d = 1, unit = '') {
  if (b == null) return '';
  const x = v - b;
  if (Math.abs(x) < Math.pow(10, -d) * 0.5) return 'same as baseline';
  return `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}${unit} vs baseline`;
}
function rootLengthCm(doy) {
  if (doy < 82) return 0;
  return Math.min(24, (0.012 + 0.2 * smoothstep(82, 160, doy) + 0.05 * smoothstep(160, 300, doy)) * 100);
}

function updateInfo(st) {
  const p = st.pheno;
  $('season-chip').textContent = `${SEASON_ICON[st.season]} ${st.season}`;
  const date = doyLabel(st.doy);
  $('date-label').textContent = st.year === 0 ? `Year 0 · ${date}` : st.year < M.BEARING_YEAR ? `Tree age ${(st.absDay / M.YEAR).toFixed(1)} yr · ${date}` : `Year ${M.BEARING_YEAR}, first full crop · ${date}`;
  if (st.stage.id !== lastStageId) {
    lastStageId = st.stage.id;
    $('stage-name').textContent = st.stage.label;
    $('stage-text').textContent = st.stage.text;
    document.querySelectorAll('.seg-stage').forEach((d) => d.classList.toggle('current', d.dataset.id === st.stage.id));
  }
  let html = '';
  if (st.year === 0) {
    html += tileHTML('Days since sowing', Math.floor(st.doy), '', 'sown in cold soil, Jan 1');
    html += tileHTML('Cold stratification', Math.min(82, Math.floor(st.doy)), ' / 80 d', st.doy < 82 ? 'chilling breaks dormancy' : 'requirement met');
    html += tileHTML('Root length', rootLengthCm(st.doy).toFixed(1), 'cm', st.doy < 82 ? 'radicle not yet emerged' : 'primary + lateral roots');
    html += tileHTML('Shoot height', (st.dims.height * 100).toFixed(1), 'cm', st.doy < 108 ? 'below ground' : 'above soil');
    html += tileHTML('Heat units', Math.round(st.gdd), 'GDD', 'since Jan 1, base 5 °C');
    html += tileHTML('Mean temp today', st.temp.toFixed(1), '°C', '');
  } else if (!st.bearing) {
    const base = M.treeDims(st.growth, 1);
    html += tileHTML('Tree age', (st.absDay / M.YEAR).toFixed(1), 'yr', 'no flowers yet (juvenile)');
    html += tileHTML('Height', st.dims.height.toFixed(2), 'm', delta(st.dims.height, base.height, 2, ' m'));
    html += tileHTML('Trunk caliper', st.dims.caliper.toFixed(1), 'cm', delta(st.dims.caliper, base.caliper, 1, ' cm'));
    html += tileHTML('Canopy width', st.dims.canopy.toFixed(2), 'm', delta(st.dims.canopy, base.canopy, 2, ' m'));
    html += tileHTML('Leaves on tree', (tree.visibleLeaves || 0).toLocaleString(), '', st.season === 'Winter' ? 'leafless in winter' : '');
    html += tileHTML('Heat units', Math.round(st.gdd), 'GDD', 'this year, base 5 °C');
  } else if (!st.fruit) {
    const bp = M.phenology(M.DEFAULT_CONDITIONS, app.variety);
    html += tileHTML('Heat units', Math.round(st.gdd), 'GDD', 'drives bud development');
    html += tileHTML('Mean temp today', st.temp.toFixed(1), '°C', '');
    html += tileHTML(st.doy < p.fullBloom ? 'Full bloom (forecast)' : 'Full bloom', doyLabel(p.fullBloom), '', delta(p.fullBloom, bp.fullBloom, 0, ' d'));
    html += tileHTML('Blossoms open', st.blossomsOpen.toLocaleString(), ` / ${st.counts.blossoms.toLocaleString()}`, '5 per cluster, king first');
    html += tileHTML('Fruit set forecast', st.counts.set, 'fruitlets', `${app.cond.pollinators}% pollinator activity`);
    html += tileHTML('Harvest (forecast)', doyLabel(p.harvest), '', delta(p.harvest, bp.harvest, 0, ' d'));
  } else {
    const f = st.fruit;
    const bp = M.phenology(M.DEFAULT_CONDITIONS, app.variety);
    const bd = st.doy - bp.fullBloom;
    const bm = bd >= 0 ? M.fruitMetricsAt(bd, M.DEFAULT_CONDITIONS, app.variety, SPURS) : null;
    html += tileHTML('Days after bloom', Math.floor(st.dafb), 'd', `full bloom ${doyLabel(p.fullBloom)}`);
    html += tileHTML('Fruit diameter', f.diam.toFixed(1), 'mm', delta(f.diam, bm?.diam, 1, ' mm'));
    html += tileHTML('Fruit weight', f.weight.toFixed(0), 'g', delta(f.weight, bm?.weight, 0, ' g'));
    html += tileHTML('Sugar', f.brix.toFixed(1), '°Brix', delta(f.brix, bm?.brix, 1));
    html += tileHTML('Firmness', f.firmness.toFixed(1), 'lbf', delta(f.firmness, bm?.firmness, 1));
    html += tileHTML('Starch index', f.starch.toFixed(1), '/ 8', f.starch < 3 ? 'starchy, not ready' : f.starch < 5.5 ? 'nearing maturity' : 'ready to pick');
    html += tileHTML('Apples on tree', st.fruitOnTree, '', st.doy > p.harvest + 4 ? `${st.counts.final} grew to harvest` : `${st.counts.set} set · ${st.counts.final} expected`);
    const yieldKg = (st.counts.final * f.weight) / 1000;
    html += tileHTML(st.doy > p.harvest ? 'Crop yield' : 'Projected yield', yieldKg.toFixed(1), 'kg', app.basket.length ? `${app.basket.length} in your basket` : 'count × weight');
  }
  $('tiles').innerHTML = html;
}

// ------------------------------------------------------------------ timeline controls
const slider = $('time');
slider.addEventListener('input', () => {
  app.u = parseFloat(slider.value);
  app.dirty = true;
});
$('play').addEventListener('click', () => setPlaying(!app.playing));
function setPlaying(p) {
  app.playing = p;
  if (p && app.u >= M.TIMELINE_MAX - 0.5) app.u = 0;
  $('play').textContent = p ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
}
$('speed').addEventListener('input', (e) => {
  app.speed = parseFloat(e.target.value);
  $('speed-out').textContent = `${app.speed}×`;
});
function jumpToDay(day) {
  app.u = clamp(M.dayToU(day), 0, M.TIMELINE_MAX);
  slider.value = app.u;
  app.dirty = true;
}
function stepStage(dir) {
  const st = app.state;
  const stages = st.stages;
  const i = stages.findIndex((s) => s.id === st.stage.id);
  const j = clamp(i + dir, 0, stages.length - 1);
  const s = stages[j];
  jumpToDay(dir < 0 && st.absDay - stages[i].start > 3 ? stages[i].start + 1 : s.start + Math.min(2, (s.end - s.start) * 0.15));
}
$('prev-stage').addEventListener('click', () => stepStage(-1));
$('next-stage').addEventListener('click', () => stepStage(1));

// ------------------------------------------------------------------ camera
const tween = { active: false };
const _sph = new THREE.Spherical();
function flyTo(target, dist, { polar, azimuth, dur = 1.3 } = {}) {
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = from.clone();
  to.radius = dist;
  if (polar != null) to.phi = polar;
  if (azimuth != null) to.theta = azimuth;
  let dTheta = to.theta - from.theta;
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  to.theta = from.theta + dTheta;
  Object.assign(tween, { active: true, t: 0, dur, from, to, t0: controls.target.clone(), t1: target.clone() });
}
function stepTween(dt) {
  if (!tween.active) return;
  tween.t = Math.min(1, tween.t + dt / tween.dur);
  const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
  controls.target.lerpVectors(tween.t0, tween.t1, e);
  _sph.set(Math.exp(lerp(Math.log(tween.from.radius), Math.log(tween.to.radius), e)), lerp(tween.from.phi, tween.to.phi, e), lerp(tween.from.theta, tween.to.theta, e));
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(_sph));
  if (tween.t >= 1) tween.active = false;
}
controls.addEventListener('start', () => {
  tween.active = false;
  $('hint').classList.add('fade');
});

let lastFrame = null;
function desiredFrame(st) {
  if (st.year === 0) {
    const f = seedling.frameFor(st.doy, st.dims.height);
    return { ...f, kind: st.doy < 100 ? 'seed' : st.doy < 130 ? 'sprout' : 'seedling', opts: { azimuth: Math.PI / 4, polar: st.doy < 100 ? 0.88 : st.doy < 130 ? 1.0 : 1.2 } };
  }
  const h = st.dims.height;
  return { target: new THREE.Vector3(0, h * 0.47, 0), dist: Math.max(1.6, h * 2.3 + 1.6), kind: 'tree', opts: {} };
}
function autoFrame(st, force = false) {
  if (!app.opts.autocam && !force) return;
  if (app.follow && app.selected) return;
  const f = desiredFrame(st);
  if (!lastFrame && !force) {
    lastFrame = f; // boot places the camera itself
    return;
  }
  if (!force) {
    const ratio = f.dist / lastFrame.dist;
    const moved = f.target.distanceTo(lastFrame.target) > lastFrame.dist * 0.35;
    if (f.kind === lastFrame.kind && ratio < 1.35 && ratio > 1 / 1.35 && !moved) return;
  }
  lastFrame = f;
  flyTo(f.target, f.dist, f.opts);
}

function cameraPreset(name) {
  const st = app.state;
  app.focusPoint = null;
  const h = st.dims.height;
  if (st.year === 0 && name !== 'orchard') return autoFrame(st, true);
  if (name === 'tree') {
    lastFrame = desiredFrame(st);
    flyTo(lastFrame.target, lastFrame.dist, { polar: 1.3 });
  } else if (name === 'orchard') flyTo(new THREE.Vector3(0, 1.5, 0), 34, { polar: 1.08 });
  else if (name === 'ground') {
    const dist = Math.max(2, h * 1.75);
    const ty = h * 0.5;
    flyTo(new THREE.Vector3(0, ty, 0), dist, { polar: Math.acos(clamp((1.2 - ty) / dist, -0.95, 0.95)) });
  } else if (name === 'branch') {
    // a well-lit cluster on the side currently facing the camera
    const camDir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
    const pts = tree.spurWorldPositions();
    let best = null;
    let bestScore = -Infinity;
    pts.forEach((p) => {
      const radial = Math.hypot(p.x, p.z);
      if (p.y < h * 0.3 || p.y > h * 0.75 || radial < h * 0.18) return;
      const score = new THREE.Vector3(p.x, 0, p.z).normalize().dot(camDir) * 2 + radial / h - Math.abs(p.y / h - 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    });
    if (!best) return cameraPreset('tree');
    const az = Math.atan2(best.x, best.z);
    app.focusPoint = best.clone();
    flyTo(best.clone().add(new THREE.Vector3(0, -0.04, 0)), 0.65, { polar: 1.42, azimuth: az + 0.25 });
  }
  document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === name));
}
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => cameraPreset(b.dataset.cam)));

// ------------------------------------------------------------------ references
function goReference(kind) {
  setPlaying(false);
  const p = M.phenology(app.cond, app.variety === 'family' && kind === 'tree' ? 'gala' : kind === 'branch' ? 'family' : app.variety);
  if (kind === 'blossom') jumpToDay(B + p.firstBloom + 1.2);
  if (kind === 'branch') {
    setVariety('family');
    jumpToDay(B + p.harvest + 6);
  }
  if (kind === 'tree') {
    if (app.variety === 'family' || app.variety === 'golden') setVariety('gala');
    jumpToDay(B + M.phenology(app.cond, app.variety).harvest - 3);
  }
  update();
  app.dirty = true;
  cameraPreset(kind === 'tree' ? 'ground' : 'branch');
  togglePopover('refs', false);
}
document.querySelectorAll('[data-ref]').forEach((b) => b.addEventListener('click', () => goReference(b.dataset.ref)));

function togglePopover(id, force) {
  const pop = $(id);
  const show = force ?? pop.hidden;
  pop.hidden = !show;
  $(`${id}-btn`).setAttribute('aria-expanded', String(show));
}
$('refs-btn').addEventListener('click', () => {
  togglePopover('opts', false);
  togglePopover('refs');
});
$('opts-btn').addEventListener('click', () => {
  togglePopover('refs', false);
  togglePopover('opts');
});
const optMap = { 'opt-autocam': 'autocam', 'opt-wind': 'wind', 'opt-shadows': 'shadows', 'opt-bees': 'bees', 'opt-rotate': 'rotate', 'opt-loop': 'loop' };
for (const [id, key] of Object.entries(optMap)) {
  $(id).addEventListener('change', (e) => {
    app.opts[key] = e.target.checked;
    applyOpts();
  });
}
function applyOpts() {
  windUniforms.uWind.value = app.opts.wind ? 1 : 0;
  renderer.shadowMap.enabled = app.opts.shadows;
  env.sun.castShadow = app.opts.shadows;
  scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
  controls.autoRotate = app.opts.rotate;
  app.dirty = true;
}

function setCollapsed(btn, c) {
  $(btn.dataset.target).classList.toggle('collapsed', c);
  btn.textContent = c ? '+' : '–';
  btn.setAttribute('aria-label', c ? 'Expand panel' : 'Collapse panel');
}
document.querySelectorAll('.collapse-btn').forEach((b) => {
  b.addEventListener('click', () => setCollapsed(b, !$(b.dataset.target).classList.contains('collapsed')));
  // small screens start with the conditions panel tucked away
  if (window.innerWidth <= 760 && b.dataset.target === 'side') setCollapsed(b, true);
});

// ------------------------------------------------------------------ picking + inspector
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickAt(clientX, clientY, hoverOnly) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [];
  if (tree.group.visible) {
    targets.push(tree.fruit, tree.petals, tree.buds);
    if (!hoverOnly) targets.push(tree.bark);
  }
  targets.push(env.fallen);
  if (seedling.group.visible) targets.push(seedling.seed, seedling.stem, seedling.root, ...seedling.cots, ...seedling.trueLeaves);
  const hits = raycaster.intersectObjects(targets, false);
  for (const h of hits) {
    if (!h.object.visible) continue;
    if (h.object === tree.fruit && tree.fruitInfo[h.instanceId]) return { kind: 'fruit', index: h.instanceId };
    if (h.object === env.fallen && env.fallenInfo[h.instanceId]) return { kind: 'fallen', index: h.instanceId };
    if (h.object === tree.petals || h.object === tree.buds) {
      const fi = h.object === tree.buds ? h.instanceId : Math.floor(h.instanceId / 5);
      if (tree.flowerStates && tree.flowerStates[fi]) return { kind: 'flower', index: fi };
      continue;
    }
    if (h.object === tree.bark) return { kind: 'tree' };
    if (seedling.group.visible) return { kind: 'seed' };
  }
  return null;
}

let downPos = null;
canvas.addEventListener('pointerdown', (e) => (downPos = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!downPos || Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) return;
  const hit = pickAt(e.clientX, e.clientY, false);
  select(hit);
});
let hoverPending = false;
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons || hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    app.hovered = pickAt(e.clientX, e.clientY, true);
    canvas.style.cursor = app.hovered ? 'pointer' : '';
  });
});

function selectionWorld(sel, out = new THREE.Vector3()) {
  if (!sel) return null;
  if (sel.kind === 'fruit') return tree.fruitInfo[sel.index] ? tree.fruitWorldPosition(sel.index, out) : null;
  if (sel.kind === 'fallen') {
    if (!env.fallenInfo[sel.index]) return null;
    const m = new THREE.Matrix4();
    env.fallen.getMatrixAt(sel.index, m);
    return out.setFromMatrixPosition(m);
  }
  if (sel.kind === 'flower') return tree.flowerStates?.[sel.index] ? tree.flowerWorldPosition(sel.index, out) : null;
  if (sel.kind === 'seed') return seedling.seed.getWorldPosition(out);
  if (sel.kind === 'tree') return out.set(0, app.state.dims.height * 0.45, 0);
  return null;
}
function selectionRadius(sel) {
  if (!sel) return 0;
  if (sel.kind === 'fruit') return (tree.fruitInfo[sel.index]?.worldRadius || 0.03) * 1.3;
  if (sel.kind === 'fallen') return (env.fallenInfo[sel.index]?.worldRadius || 0.03) * 1.3;
  if (sel.kind === 'flower') return 0.02 * VIS.flower;
  return 0;
}

function select(sel) {
  app.selected = sel;
  if (!sel) {
    $('inspector').hidden = true;
    app.follow = false;
    $('insp-follow').setAttribute('aria-pressed', 'false');
    return;
  }
  $('inspector').hidden = false;
  renderInspector();
}
$('insp-close').addEventListener('click', () => select(null));
$('insp-focus').addEventListener('click', () => focusSelection());
$('insp-follow').addEventListener('click', () => {
  app.follow = !app.follow;
  $('insp-follow').setAttribute('aria-pressed', String(app.follow));
  if (app.follow) focusSelection();
});
function focusSelection() {
  const p = selectionWorld(app.selected);
  if (!p) return;
  const kind = app.selected.kind;
  if (kind === 'tree') return cameraPreset('tree');
  if (kind === 'seed') return flyTo(p, 0.3, { dur: 1, azimuth: Math.PI / 4, polar: 1.0 });
  // approach from outside the canopy, choosing the angle least blocked by other fruit
  const r = Math.max(kind === 'flower' ? 0.16 : 0.24, selectionRadius(app.selected) * 6);
  const outward = Math.atan2(p.x, p.z);
  let best = { az: outward + 0.3, polar: kind === 'fallen' ? 0.9 : 1.4, score: Infinity };
  if (kind === 'fruit') {
    const others = [];
    tree.fruitInfo.forEach((f, i) => f && i !== app.selected.index && others.push({ p: tree.fruitWorldPosition(i), r: f.worldRadius }));
    const cam = new THREE.Vector3();
    const seg = new THREE.Line3();
    const tmp = new THREE.Vector3();
    for (const da of [-1.2, -0.6, 0, 0.6, 1.2]) {
      for (const polar of [1.15, 1.4, 1.7]) {
        cam.copy(p).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, polar, outward + da)));
        seg.set(cam, p);
        let blocked = 0;
        for (const o of others) if (seg.closestPointToPoint(o.p, true, tmp).distanceTo(o.p) < o.r + 0.02) blocked++;
        const score = blocked * 10 + Math.abs(da) + Math.abs(polar - 1.4);
        if (score < best.score) best = { az: outward + da, polar, score };
      }
    }
  }
  flyTo(p, r, { dur: 1, azimuth: best.az, polar: best.polar });
}
$('insp-pick').addEventListener('click', () => {
  const sel = app.selected;
  if (!sel || sel.kind !== 'fruit') return;
  const info = tree.fruitInfo[sel.index];
  if (!info) return;
  if (info.starch < 4.5) {
    toast(`Too early to pick: starch index ${info.starch.toFixed(1)} — it would taste starchy and sour. Try again near harvest.`);
    return;
  }
  tree.picked.add(sel.index);
  app.basket.push({ ...info });
  toast(`Picked apple #${info.id}: ${info.weight.toFixed(0)} g ${M.VARIETIES[info.variety].label.split(' (')[0]}, ${info.brix.toFixed(1)} °Brix. Basket: ${app.basket.length}.`);
  app.dirty = true;
});

function fruitStageLabel(info, p) {
  const d = info.dafb;
  if (d < 16) return 'Fruitlet, just set';
  if (d < p.cellDivEnd - p.fullBloom) return 'Cell division';
  if (d < p.ripening - p.fullBloom) return 'Cell expansion';
  if (info.starch < 5.5) return 'Ripening';
  if (info.firmness >= 15.5) return 'Ripe — ready to pick';
  return 'Over-ripe, softening';
}

function renderInspector() {
  const sel = app.selected;
  if (!sel) return;
  const st = app.state;
  const rows = [];
  let title = '';
  let sub = '';
  let note = '';
  let spark = null;
  let canPick = false;
  let canFocus = true;
  if (sel.kind === 'fruit' || sel.kind === 'fallen') {
    const info = sel.kind === 'fruit' ? tree.fruitInfo[sel.index] : env.fallenInfo[sel.index];
    if (!info) {
      title = 'Apple gone';
      sub = 'Picked, harvested or dropped';
      note = tree.picked.has(sel.index) ? 'This apple is in your basket.' : 'It is no longer on the tree at this point in the timeline. Scrub back to see it again.';
      canFocus = false;
    } else {
      const v = M.VARIETIES[info.variety];
      title = sel.kind === 'fruit' ? `Apple #${info.id}` : `Windfall apple ${info.id}`;
      sub = `${v.label}${info.king ? ' · king fruit' : ''}`;
      rows.push(['Stage', fruitStageLabel(info, st.pheno)]);
      rows.push(['Days after bloom', `${Math.floor(info.dafb)} d`]);
      rows.push(['Diameter', `${info.diam.toFixed(1)} mm`]);
      rows.push(['Weight', `${info.weight.toFixed(0)} g`]);
      rows.push(['Sugar', `${info.brix.toFixed(1)} °Brix`]);
      rows.push(['Starch index', `${info.starch.toFixed(1)} / 8`]);
      rows.push(['Firmness', `${info.firmness.toFixed(1)} lbf`]);
      rows.push(['Red blush cover', `${Math.round(info.blush * 100)}%`]);
      rows.push(['Sun exposure', `${Math.round(info.exposure * 100)}%`]);
      note = info.starch < 3 ? 'Starch-rich and sour: sugars have not developed yet.' : info.starch < 5.5 ? 'Starch is converting to sugar; colour is developing on the sunny side.' : info.firmness >= 15.5 ? 'Sweet and crisp: this apple is ready to pick.' : 'Past its prime: the flesh is softening.';
      if (sel.kind === 'fallen') note = 'Windfalls bruise on impact and are usually sent for juice or cider.';
      canPick = sel.kind === 'fruit';
      const slot = sel.kind === 'fruit' ? tree.slots[sel.index] : null;
      const sizeF = slot ? slot.sizeF : 1;
      const rowsS = M.seasonSeries(app.cond, info.variety, SPURS).rows;
      spark = { values: rowsS.filter((r) => r.diam != null && r.doy <= 330).map((r) => ({ x: r.doy, y: r.diam * sizeF })), current: { x: st.doy, y: info.diam }, cap: 'This apple’s diameter over the season' };
    }
  } else if (sel.kind === 'flower') {
    const fs = tree.flowerStates?.[sel.index];
    const f = tree.flowers[sel.index];
    if (!fs) {
      title = 'Blossom gone';
      sub = 'Petals have fallen';
      note = 'Pollinated blossoms become fruitlets; others wither and drop.';
      canFocus = false;
    } else {
      const p = st.pheno;
      const d = st.doy;
      const stageTxt = d > p.leafFall ? 'Dormant fruit bud (next spring)' : fs.petals < 1 ? 'Petal fall' : fs.open > 0.95 ? 'Open blossom' : fs.open > 0.05 ? 'Opening' : d >= p.pinkBud ? 'Pink bud' : d >= p.tightCluster ? 'Tight cluster' : d >= p.greenTip ? 'Green tip' : d >= p.silverTip ? 'Silver tip' : 'Dormant bud';
      title = f.king ? 'King blossom' : 'Side blossom';
      sub = f.king ? 'Opens first; usually becomes the largest fruit' : 'One of 4–5 lateral flowers in the cluster';
      rows.push(['Stage', stageTxt]);
      rows.push(['Petals open', `${Math.round(fs.open * 100)}%`]);
      rows.push(['Petals attached', `${Math.round(fs.petals * 5)} / 5`]);
      const spurSlots = tree.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.spur === f.spur);
      const setsFruit = spurSlots.some(({ i, s }) => i < st.counts.final && (f.king ? s.king : !s.king));
      rows.push(['Cluster', `${5} flowers on spur #${f.spur + 1}`]);
      rows.push(['Fruit outlook', setsFruit ? 'Likely to set fruit' : 'Likely to drop']);
      note = 'Apples need cross-pollination: bees carry pollen from a different, compatible variety. Pollen tubes reach the ovary in 2–3 days.';
    }
  } else if (sel.kind === 'seed') {
    const d = st.doy;
    title = d < 82 ? 'Apple seed' : d < 125 ? 'Germinating seed' : 'Apple seedling';
    sub = 'Grown from seed (not true to the parent variety)';
    rows.push(['Cold stratification', `${Math.min(82, Math.floor(d))} / 80 days`]);
    rows.push(['Root length', `${rootLengthCm(d).toFixed(1)} cm`]);
    rows.push(['Shoot height', `${(st.dims.height * 100).toFixed(1)} cm`]);
    rows.push(['Leaves', d < 115 ? 'none yet' : d < 125 ? '2 cotyledons' : `${Math.min(9, Math.floor(9 * smoothstep(122, 245, d)))} true leaves`]);
    note = 'Each apple seed is a genetic cross, so orchards graft known varieties onto rootstocks. A seedling still shows every life stage, just more slowly.';
  } else if (sel.kind === 'tree') {
    title = 'The tree';
    sub = `${M.VARIETIES[app.variety].label}`;
    rows.push(['Age', `${(st.absDay / M.YEAR).toFixed(1)} yr`]);
    rows.push(['Height', `${st.dims.height.toFixed(2)} m`]);
    rows.push(['Trunk caliper', `${st.dims.caliper.toFixed(1)} cm`]);
    rows.push(['Canopy width', `${st.dims.canopy.toFixed(2)} m`]);
    rows.push(['Leaves', (tree.visibleLeaves || 0).toLocaleString()]);
    rows.push(['Fruit spurs', st.bearing ? SPURS : 'not yet formed']);
    note = 'Scaffold limbs spread from about 1 m up the trunk, an open shape that lets light reach the fruit.';
  }
  $('insp-title').textContent = title;
  $('insp-sub').textContent = sub;
  const dl = $('insp-rows');
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $('insp-note').textContent = note;
  $('insp-spark-wrap').hidden = !spark;
  if (spark) {
    $('insp-spark-cap').textContent = spark.cap;
    sparkline($('insp-spark'), spark.values, spark.current, { color: SERIES.mine });
  }
  $('insp-pick').hidden = !canPick;
  $('insp-focus').disabled = !canFocus;
  $('insp-follow').disabled = !canFocus;
}

// ------------------------------------------------------------------ 3D labels (seed + seedling stages)
const labelLayer = document.createElement('div');
labelLayer.className = 'labels';
document.body.appendChild(labelLayer);
const labelEls = new Map();
const _lp = new THREE.Vector3();
function seedlingLabels(st) {
  if (st.year !== 0) return [];
  const d = st.doy;
  const out = [];
  // anchor labels just beside their subject so the marker dot never hides it
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const seedP = seedling.seed.getWorldPosition(new THREE.Vector3()).addScaledVector(right, -0.014);
  if (d < 128) out.push({ id: 'seed', text: d < 82 ? 'Seed, chilling in moist soil' : 'Seed coat splits open', pos: seedP, dx: -1 });
  if (d >= 86) out.push({ id: 'root', text: d < 140 ? 'Radicle (first root)' : 'Tap root + lateral roots', pos: seedP.clone().add(new THREE.Vector3(0.006, -Math.min(0.22, rootLengthCm(d) / 100) * 0.7, 0.005)), dx: -1 });
  out.push({ id: 'soil', text: 'Soil surface', pos: new THREE.Vector3(0.2, 0.0, 0.0), dx: 1 });
  if (d >= 112 && d < 205 && seedling.cots[0].visible) out.push({ id: 'cots', text: 'Cotyledons (seed leaves)', pos: seedling.cots[0].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.01, 0)), dx: 1 });
  const leaves = seedling.trueLeaves.filter((l) => l.visible);
  if (d >= 135 && leaves.length) out.push({ id: 'leaf', text: 'True leaves', pos: leaves[leaves.length - 1].getWorldPosition(new THREE.Vector3()), dx: -1 });
  return out;
}
function updateLabels(st) {
  const items = seedlingLabels(st);
  const seen = new Set();
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const it of items) {
    seen.add(it.id);
    let el = labelEls.get(it.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'label3d';
      labelLayer.appendChild(el);
      labelEls.set(it.id, el);
    }
    el.textContent = it.text;
    el.classList.toggle('left', it.dx < 0);
    _lp.copy(it.pos).project(camera);
    const vis = _lp.z < 1 && Math.abs(_lp.x) < 1.1 && Math.abs(_lp.y) < 1.1;
    el.hidden = !vis;
    if (vis) el.style.transform = `translate(${((_lp.x + 1) / 2) * w}px, ${((1 - _lp.y) / 2) * h}px)`;
  }
  for (const [id, el] of labelEls) if (!seen.has(id)) el.hidden = true;
}

// ------------------------------------------------------------------ share link
function encodeState() {
  const q = new URLSearchParams();
  q.set('t', app.u.toFixed(1));
  q.set('v', app.variety);
  for (const k of Object.keys(M.DEFAULT_CONDITIONS)) if (app.cond[k] !== M.DEFAULT_CONDITIONS[k]) q.set(k, app.cond[k]);
  const r = (v) => v.toFixed(3);
  q.set('cam', [camera.position.x, camera.position.y, camera.position.z, controls.target.x, controls.target.y, controls.target.z].map(r).join(','));
  return q.toString();
}
function decodeState() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (!q.has('t')) return false;
  app.u = clamp(parseFloat(q.get('t')) || 0, 0, M.TIMELINE_MAX);
  if (M.VARIETIES[q.get('v')]) setVariety(q.get('v'));
  for (const d of COND_DEFS) if (q.has(d.key)) app.cond[d.key] = clamp(parseFloat(q.get(d.key)), d.min, d.max);
  const cam = (q.get('cam') || '').split(',').map(Number);
  if (cam.length === 6 && cam.every(Number.isFinite)) {
    camera.position.set(cam[0], cam[1], cam[2]);
    controls.target.set(cam[3], cam[4], cam[5]);
    return 'camera';
  }
  return true;
}
$('share-btn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${encodeState()}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast(`Link copied: ${url}`);
  } catch {
    toast(`Share this link: ${url}`);
  }
});

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input[type=text], select, textarea')) return;
  const dayStep = (days) => jumpToDay(M.uToDay(app.u) + days);
  if (e.code === 'Space' && !e.target.closest('button')) {
    e.preventDefault();
    setPlaying(!app.playing);
  } else if (e.key === 'ArrowRight' && e.target === document.body) dayStep(e.shiftKey ? 14 : 1);
  else if (e.key === 'ArrowLeft' && e.target === document.body) dayStep(e.shiftKey ? -14 : -1);
  else if (e.key === ']') stepStage(1);
  else if (e.key === '[') stepStage(-1);
  else if (e.key === 'Escape') select(null);
  else if (!e.metaKey && !e.ctrlKey) {
    const cams = { t: 'tree', b: 'branch', o: 'orchard', g: 'ground' };
    if (cams[e.key.toLowerCase()]) cameraPreset(cams[e.key.toLowerCase()]);
  }
});

// ------------------------------------------------------------------ update + loop
let spurCache = { scale: -1, pts: [] };
let uiTimer = 0;

function update() {
  const absDay = M.uToDay(app.u);
  const st = M.stateAt(absDay, app.cond, app.variety, SPURS);
  app.state = st;
  if (st.year < M.BEARING_YEAR || st.doy < st.pheno.ripening - 30) {
    if (tree.picked.size) tree.picked.clear();
    app.basket = [];
  }
  const cache = {};
  const metricsFor = (vk) => cache[vk] || (cache[vk] = M.fruitMetricsAt(st.dafb ?? 0, app.cond, vk, SPURS));
  seedling.update(st);
  tree.update(st, app.cond, app.variety, metricsFor);
  env.update(st, app.cond, app.variety, metricsFor, tree.scale);
  const p = st.pheno;
  const bloom = st.bearing ? smoothstep(p.firstBloom - 1, p.firstBloom + 2, st.doy) * (1 - smoothstep(p.petalFall - 2, p.petalFall + 2, st.doy)) : 0;
  if (bloom > 0 && spurCache.scale !== tree.scale) spurCache = { scale: tree.scale, pts: tree.spurWorldPositions() };
  bees.setTargets(spurCache.pts, app.opts.bees ? bloom * clamp(app.cond.pollinators / 100, 0, 1.5) / 1.5 : 0);
  autoFrame(st);
}

function updateUI(force) {
  const now = performance.now();
  if (!force && now - uiTimer < 90) return;
  uiTimer = now;
  if (app.stripDirty) {
    buildStrip();
    lastStageId = '';
    app.stripDirty = false;
  }
  if (app.chartsDirty) {
    refreshCharts();
    app.chartsDirty = false;
  }
  updateInfo(app.state);
  updateChartMarkers();
  if (app.table) {
    const wk = Math.floor(app.state.doy / 7);
    if (wk !== app.lastTableWeek) {
      app.lastTableWeek = wk;
      renderTable();
    }
  }
  if (app.selected) renderInspector();
}

let last = performance.now();
let uiDirty = true;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (app.playing) {
    app.u += 9 * app.speed * dt;
    if (app.u >= M.TIMELINE_MAX) {
      if (app.opts.loop) app.u = 0;
      else {
        app.u = M.TIMELINE_MAX;
        setPlaying(false);
      }
    }
    slider.value = app.u;
    app.dirty = true;
  }
  if (app.dirty) {
    update();
    app.dirty = false;
    uiDirty = true;
  }
  if (uiDirty || app.chartsDirty || app.stripDirty) {
    updateUI(!app.playing);
    uiDirty = app.playing;
  }
  windUniforms.uTime.value += dt;
  env.animate(dt, camera, controls.target);
  bees.animate(dt);
  stepTween(dt);
  if (app.follow && app.selected && !tween.active) {
    const p = selectionWorld(app.selected);
    if (p) {
      const delta = p.clone().sub(controls.target);
      controls.target.add(delta);
      camera.position.add(delta);
    }
  }
  // keep the camera above the ground while allowing full 360° orbits around raised targets
  const dist = camera.position.distanceTo(controls.target);
  controls.maxPolarAngle = Math.acos(clamp((0.03 - controls.target.y) / Math.max(dist, 1e-3), -1, 1));
  controls.update();

  const hp = selectionWorld(app.hovered);
  hoverHalo.visible = !!hp && !(app.selected && app.hovered && app.selected.kind === app.hovered.kind && app.selected.index === app.hovered.index);
  if (hp) {
    hoverHalo.position.copy(hp);
    hoverHalo.quaternion.copy(camera.quaternion);
    hoverHalo.scale.setScalar(Math.max(0.004, selectionRadius(app.hovered)));
  }
  const sp = selectionWorld(app.selected);
  // clear foliage on the line of sight to the inspected object (or the branch close-up)
  if (app.focusPoint && !tween.active && controls.target.distanceTo(app.focusPoint) > 0.6) app.focusPoint = null;
  const sightTarget = sp && ['fruit', 'flower'].includes(app.selected?.kind) ? sp : app.focusPoint;
  const sightOn = !!sightTarget && camera.position.distanceTo(sightTarget) < 4;
  sightUniforms.uSightOn.value = sightOn ? 1 : 0;
  if (sightOn) {
    sightUniforms.uSightA.value.copy(camera.position);
    sightUniforms.uSightB.value.copy(sightTarget);
    sightUniforms.uSightR.value = sightTarget === sp ? Math.max(0.09, selectionRadius(app.selected) * 2.6) : 0.2;
  }
  selHalo.visible = !!sp && ['fruit', 'fallen', 'flower'].includes(app.selected?.kind);
  if (selHalo.visible) {
    selHalo.position.copy(sp);
    selHalo.quaternion.copy(camera.quaternion);
    selHalo.scale.setScalar(Math.max(0.004, selectionRadius(app.selected)));
  }
  updateLabels(app.state);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  app.stripDirty = true;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ boot
syncCondInputs();
const restored = decodeState();
syncCondInputs();
slider.value = app.u;
update();
if (restored !== 'camera') {
  const f = desiredFrame(app.state);
  lastFrame = f;
  controls.target.copy(f.target);
  camera.position.copy(f.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(f.dist, f.opts.polar ?? 1.3, f.opts.azimuth ?? Math.PI / 4)));
} else lastFrame = desiredFrame(app.state);
setTab('fruit');
updateUI(true);
applyOpts();
requestAnimationFrame(frame);
requestAnimationFrame(() => $('loading').classList.add('done'));
setTimeout(() => $('hint').classList.add('fade'), 9000);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#toolbar')) {
    togglePopover('refs', false);
    togglePopover('opts', false);
  }
});

// expose for debugging / automated screenshots
window.__apple = { app, M, tree, env, camera, controls, cameraPreset, jumpToDay, goReference, setVariety, select, update, focusSelection };
