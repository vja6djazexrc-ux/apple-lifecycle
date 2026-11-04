// Growth model: maps one timeline position to everything the scene, charts and
// stat tiles need. Phenology is driven by growing degree days (heat units),
// fruit development by days after full bloom (DAFB), both nudged by the
// growing-condition sliders. Numbers are calibrated to a temperate
// Northern-Hemisphere orchard (roughly Washington / New York / UK climate).

export const YEAR = 365;
export const BEARING_YEAR = 5;
export const TIMELINE_MAX = 1000;
export const TOTAL_DAYS = (BEARING_YEAR + 1) * YEAR;

// The slider is piecewise so the detailed fruiting year gets most of its travel.
const SEGMENTS = [
  { u0: 0, u1: 120, a0: 0, a1: YEAR }, // year 0: seed -> seedling
  { u0: 120, u1: 320, a0: YEAR, a1: BEARING_YEAR * YEAR }, // years 1-4: juvenile tree
  { u0: 320, u1: TIMELINE_MAX, a0: BEARING_YEAR * YEAR, a1: TOTAL_DAYS }, // year 5: fruiting
];

export function uToDay(u) {
  const s = SEGMENTS.find((seg) => u <= seg.u1) || SEGMENTS[SEGMENTS.length - 1];
  return s.a0 + ((u - s.u0) / (s.u1 - s.u0)) * (s.a1 - s.a0);
}

export function dayToU(a) {
  const s = SEGMENTS.find((seg) => a <= seg.a1) || SEGMENTS[SEGMENTS.length - 1];
  return s.u0 + ((a - s.a0) / (s.a1 - s.a0)) * (s.u1 - s.u0);
}

export const DEFAULT_CONDITIONS = {
  temp: 0, // °C offset from the regional normal
  sun: 100, // % of typical sunshine hours
  water: 100, // % of crop water need met (rain + irrigation)
  pollinators: 100, // % of typical bee activity during bloom
  thinning: 40, // % of fruitlets removed by hand thinning
};

export const VARIETIES = {
  gala: { label: 'Gala (red-streaked)', harvestDafb: 125, sizeMm: 74, brix: 13.5, blush: 0.88, ground: [0.93, 0.78, 0.3], blushColor: [0.74, 0.07, 0.06] },
  honeycrisp: { label: 'Honeycrisp (mottled)', harvestDafb: 132, sizeMm: 82, brix: 14, blush: 0.7, ground: [0.95, 0.83, 0.38], blushColor: [0.82, 0.16, 0.12] },
  golden: { label: 'Golden Delicious (yellow)', harvestDafb: 142, sizeMm: 72, brix: 14.5, blush: 0.08, ground: [0.96, 0.82, 0.26], blushColor: [0.92, 0.55, 0.22] },
  family: { label: 'Family tree (red + gold)', harvestDafb: 132, sizeMm: 75, brix: 13.8, blush: 0.55, ground: [0.94, 0.82, 0.36], blushColor: [0.8, 0.1, 0.1] },
};

// ---------- helpers ----------
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const logistic = (x) => 1 / (1 + Math.exp(-x));

// ---------- climate ----------
const GDD_BASE = 5; // °C

function weatherNoise(doy) {
  // deterministic "weather": a few incommensurate waves so every run is identical
  return 1.6 * Math.sin(doy * 0.71 + 1.3) + 1.1 * Math.sin(doy * 0.23 + 4.1) + 0.8 * Math.sin(doy * 1.37 + 0.4);
}

export function dailyMeanTemp(doy, tempOffset) {
  return 9.5 + 11.5 * Math.sin((2 * Math.PI * (doy - 105)) / YEAR) + weatherNoise(doy) + tempOffset;
}

function dailyGdd(tMean) {
  // integrate an approximate diurnal cycle (±5.5 °C) so cool spring days still
  // accumulate a little heat during their warm afternoon hours
  let sum = 0;
  for (let k = 0; k < 8; k++) sum += Math.max(0, tMean + 5.5 * Math.sin((2 * Math.PI * k) / 8) - GDD_BASE);
  return sum / 8;
}

function climateYear(tempOffset) {
  const temp = new Float32Array(YEAR + 1);
  const gdd = new Float32Array(YEAR + 1);
  let acc = 0;
  for (let d = 0; d <= YEAR; d++) {
    temp[d] = dailyMeanTemp(d, tempOffset);
    acc += dailyGdd(temp[d]);
    gdd[d] = acc;
  }
  return { temp, gdd };
}

const BASE_CLIMATE = climateYear(0);

// Bud-development stages in the baseline climate (day of year). They are
// converted to GDD thresholds so warmer/cooler springs shift them.
const SPRING_STAGES_BASE_DOY = {
  silverTip: 76,
  greenTip: 88,
  tightCluster: 99,
  pinkBud: 109,
  firstBloom: 117,
  fullBloom: 122,
};
const SPRING_GDD = Object.fromEntries(Object.entries(SPRING_STAGES_BASE_DOY).map(([k, d]) => [k, BASE_CLIMATE.gdd[d]]));

function doyAtGdd(gdd, target) {
  for (let d = 1; d <= YEAR; d++) {
    if (gdd[d] >= target) {
      const f = (target - gdd[d - 1]) / Math.max(1e-6, gdd[d] - gdd[d - 1]);
      return d - 1 + f;
    }
  }
  return YEAR;
}

// ---------- phenology for a given set of conditions ----------
const phenoCache = new Map();

export function phenology(cond, varietyKey = 'gala') {
  const key = `${cond.temp}|${varietyKey}`;
  if (phenoCache.has(key)) return phenoCache.get(key);
  const clim = climateYear(cond.temp);
  const v = VARIETIES[varietyKey];
  const p = {};
  for (const [k, g] of Object.entries(SPRING_GDD)) p[k] = doyAtGdd(clim.gdd, g);
  // fruit develops a little faster in warmer seasons
  const rate = 1 + 0.025 * cond.temp;
  p.harvestDafb = v.harvestDafb / rate;
  p.petalFall = p.fullBloom + 8;
  p.fruitSet = p.fullBloom + 16;
  p.thinning = p.fullBloom + 24;
  p.cellDivEnd = p.fullBloom + 40 / rate;
  p.juneDrop = p.fullBloom + 42 / rate;
  p.ripening = p.fullBloom + p.harvestDafb - 32;
  p.harvest = p.fullBloom + p.harvestDafb;
  p.harvestEnd = p.harvest + 20;
  // leaf senescence is mostly photoperiod-driven; warmth delays it slightly
  p.leafColor = 280 + 1.5 * cond.temp;
  p.leafFall = 297 + 1.5 * cond.temp;
  p.leafFallEnd = 325 + 1.5 * cond.temp;
  p.climate = clim;
  phenoCache.set(key, p);
  if (phenoCache.size > 64) phenoCache.delete(phenoCache.keys().next().value);
  return p;
}

// ---------- stage catalogue ----------
export const STAGE_INFO = {
  seed: {
    label: 'Seed & stratification',
    text: 'Apple seeds need 60–90 days of cold, moist conditions (stratification) before they will sprout. The embryo is dormant inside a glossy brown seed coat.',
  },
  germination: {
    label: 'Germination',
    text: 'As the soil warms, the seed coat splits and the radicle (first root) pushes down. The shoot follows, hooked to protect its tip as it breaks the surface.',
  },
  seedling: {
    label: 'Seedling',
    text: 'Two rounded cotyledons feed the seedling until the first serrated true leaves take over photosynthesis. By autumn it is a slender 20–30 cm stem.',
  },
  juvenile: {
    label: 'Juvenile growth',
    text: 'For several years the tree only grows wood and leaves: the trunk thickens and scaffold limbs form. Seed-grown apples take 5–10 years to flower (grafted trees 2–4).',
  },
  dormant: {
    label: 'Winter dormancy',
    text: 'Leafless and frost-hardy. The tree is collecting “chill hours” (≈1,000 h below 7 °C) that it needs before buds will respond to spring warmth.',
  },
  silverTip: {
    label: 'Silver tip → green tip',
    text: 'Fruit buds swell and their fuzzy scales part, showing silver, then green leaf tissue. Each fruit bud holds a cluster of 5–6 flowers.',
  },
  tightCluster: {
    label: 'Tight cluster',
    text: 'Rosette leaves unfold and the flower buds become visible as a tight green cluster. Frost at −2 °C can now kill 10% of buds.',
  },
  pinkBud: {
    label: 'Pink bud',
    text: 'The individual flower stems lengthen and the buds turn deep pink — the stage in the blossom reference photo.',
  },
  bloom: {
    label: 'Bloom',
    text: 'The central “king” blossom opens first, followed by the 4–5 side blossoms. Pink-edged white petals fade to white as they open. Bees carry pollen from compatible varieties.',
  },
  petalFall: {
    label: 'Petal fall & fruit set',
    text: 'Pollinated flowers drop their petals and the ovary begins to swell into a fruitlet. Unpollinated flowers wither and fall.',
  },
  cellDivision: {
    label: 'Cell division',
    text: 'For about 40 days after bloom, fruitlet cells multiply rapidly — this sets the size potential. Growers thin clusters to one or two fruit; the tree sheds the rest in the “June drop”.',
  },
  cellExpansion: {
    label: 'Cell expansion',
    text: 'Cell number is fixed; now each cell swells with water and sugars. Diameter climbs steadily and fruit weight can triple. Water and sunlight matter most here.',
  },
  ripening: {
    label: 'Ripening & colour',
    text: 'Starch converts to sugar, the flesh softens, chlorophyll fades to a yellow background and cool nights trigger red anthocyanin blush on the sunny side.',
  },
  harvest: {
    label: 'Harvest',
    text: 'Fruit is picked when sugar, starch index and firmness hit target. Apples come away with a lift-and-twist; a few windfalls drop to the grass.',
  },
  leafFall: {
    label: 'Leaf colour & leaf fall',
    text: 'Shorter days trigger the tree to pull nutrients from its leaves, which turn yellow and orange and drop. Next year’s fruit buds are already formed on the spurs.',
  },
  dormant2: {
    label: 'Return to dormancy',
    text: 'The cycle closes. With buds set and leaves gone, the tree rests until spring — and the annual fruiting cycle repeats for decades.',
  },
};

export function seasonOf(doy) {
  if (doy >= 79 && doy < 172) return 'Spring';
  if (doy >= 172 && doy < 266) return 'Summer';
  if (doy >= 266 && doy < 355) return 'Autumn';
  return 'Winter';
}

// stage boundaries (absolute day) for the whole timeline under these conditions
export function stageList(cond, varietyKey) {
  const p = phenology(cond, varietyKey);
  const b = BEARING_YEAR * YEAR;
  const list = [
    ['seed', 0, 82],
    ['germination', 82, 125],
    ['seedling', 125, YEAR],
    ['juvenile', YEAR, b],
    ['dormant', b, b + p.silverTip],
    ['silverTip', b + p.silverTip, b + p.tightCluster],
    ['tightCluster', b + p.tightCluster, b + p.pinkBud],
    ['pinkBud', b + p.pinkBud, b + p.firstBloom],
    ['bloom', b + p.firstBloom, b + p.petalFall],
    ['petalFall', b + p.petalFall, b + p.fruitSet],
    ['cellDivision', b + p.fruitSet, b + p.cellDivEnd],
    ['cellExpansion', b + p.cellDivEnd, b + p.ripening],
    ['ripening', b + p.ripening, b + p.harvest],
    ['harvest', b + p.harvest, b + Math.max(p.harvestEnd, p.leafColor)],
    ['leafFall', b + Math.max(p.harvestEnd, p.leafColor), b + p.leafFallEnd],
    ['dormant2', b + p.leafFallEnd, TOTAL_DAYS],
  ];
  return list.map(([id, start, end]) => ({ id, start, end, ...STAGE_INFO[id] }));
}

// ---------- fruit development ----------
function factors(cond, varietyKey) {
  const v = VARIETIES[varietyKey];
  const sunR = cond.sun / 100;
  const sunF = clamp(0.68 + 0.32 * sunR, 0.6, 1.07);
  const drought = Math.max(0, (100 - cond.water) / 100);
  const flood = Math.max(0, (cond.water - 120) / 80);
  const waterF = 1 - 0.45 * Math.pow(drought, 1.2) - 0.07 * flood;
  const tempF = 1 - 0.018 * Math.abs(cond.temp);
  return { v, sunR, sunF, waterF, tempF, drought };
}

export function fruitCounts(cond, spurCount) {
  const blossoms = spurCount * 5;
  const setFrac = clamp(0.32 * Math.pow(cond.pollinators / 100, 0.8), 0.01, 0.42);
  const set = blossoms * setFrac;
  const afterThin = set * (1 - cond.thinning / 100);
  const dropKeep = clamp(0.78 - 0.25 * Math.max(0, (85 - cond.water) / 85), 0.4, 0.8);
  const final = afterThin * dropKeep;
  return { blossoms, set: Math.round(set), afterThin: Math.round(afterThin), final: Math.round(final) };
}

// Per-fruit metrics at a given DAFB (days after full bloom).
export function fruitMetricsAt(dafb, cond, varietyKey, spurCount = 240) {
  const p = phenology(cond, varietyKey);
  const { v, sunR, sunF, waterF, tempF } = factors(cond, varietyKey);
  const counts = fruitCounts(cond, spurCount);
  const baseFinal = fruitCounts(DEFAULT_CONDITIONS, spurCount).final;
  const loadF = clamp(Math.pow(baseFinal / Math.max(1, counts.final), 0.12), 0.88, 1.14);
  const Dmax = v.sizeMm * sunF * waterF * tempF * loadF;
  const H = p.harvestDafb;
  const t0 = 50 * (H / 130);
  const k = 0.065 * (130 / H);
  const raw = (t) => 1 / (1 + Math.exp(-k * (t - t0)));
  const r0 = raw(0);
  const t = Math.max(0, dafb);
  const diam = 2.5 + (Dmax - 2.5) * ((raw(t) - r0) / (1 - r0));
  const dcm = diam / 10;
  const weight = 0.374 * dcm * dcm * dcm;

  const ripeT = (t - (H - 22)) / 11;
  const brixMax = v.brix * (0.86 + 0.14 * clamp(sunR, 0, 1.2)) * (1 + 0.015 * cond.temp) * (cond.water > 110 ? 1 - 0.12 * clamp((cond.water - 110) / 90) : 1) * clamp(Math.pow(loadF, 0.6), 0.95, 1.06);
  const brix = 5.5 + 2.5 * smoothstep(20, H - 30, t) + (brixMax - 8) * logistic(ripeT);
  const starch = 1 + 7 * logistic((t - (H - 6)) / 8);
  const firmness = 17 + 15 * Math.exp(-Math.max(0, t - 30) / 42) - 0.35 * cond.temp - 0.09 * Math.max(0, t - H);
  const blushMax = clamp(v.blush * clamp(0.35 + 0.65 * sunR, 0, 1.1) * (1 - 0.07 * cond.temp), 0, 0.95);
  const blush = blushMax * logistic((t - (H - 28)) / 8);
  const yellowing = logistic((t - (H - 12)) / 10);
  return { dafb, diam, weight, brix, starch, firmness, blush, blushMax, yellowing, Dmax };
}

// ---------- tree growth ----------
// growth 0..1 across juvenile years; each year's growth happens in its growing season
const YEAR_GROWTH = [0.0, 0.006, 0.2, 0.45, 0.68, 0.88, 1.0];

export function treeGrowth(absDay) {
  const year = Math.floor(absDay / YEAR);
  const doy = absDay - year * YEAR;
  if (year < 1) return 0;
  const y = Math.min(year, BEARING_YEAR);
  const g0 = YEAR_GROWTH[y];
  const g1 = YEAR_GROWTH[y + 1];
  return lerp(g0, g1, smoothstep(105, 240, doy));
}

export function treeVigor(cond) {
  const { sunF, waterF, tempF } = factors(cond, 'gala');
  return clamp(sunF * waterF * tempF, 0.6, 1.08);
}

export function treeDims(g, vigor = 1) {
  const s = lerp(1, vigor, clamp(g * 1.5));
  return {
    height: (0.3 + 3.75 * Math.pow(g, 0.9)) * s,
    caliper: (0.4 + 11.6 * Math.pow(g, 1.15)) * s,
    canopy: (0.1 + 4.3 * Math.pow(g, 1.2)) * s,
  };
}

// ---------- leaf / blossom seasonal states ----------
export function leafState(doy, p) {
  const emerge = smoothstep(p.greenTip - 2, p.fruitSet + 30, doy);
  const color = smoothstep(p.leafColor, p.leafFall + 6, doy); // 0 green -> 1 autumn
  const fall = smoothstep(p.leafFall, p.leafFallEnd, doy);
  return { emerge, color, fall, amount: emerge * (1 - fall) };
}

// ---------- full state at a timeline position ----------
export function stateAt(absDay, cond, varietyKey, spurCount = 240) {
  absDay = clamp(absDay, 0, TOTAL_DAYS - 0.001);
  const year = Math.floor(absDay / YEAR);
  const doy = absDay - year * YEAR;
  const p = phenology(cond, varietyKey);
  const stages = stageList(cond, varietyKey);
  const stage = stages.find((s) => absDay >= s.start && absDay < s.end) || stages[stages.length - 1];
  const g = treeGrowth(absDay);
  const vigor = treeVigor(cond);
  const dims = year === 0 ? seedlingDims(doy) : treeDims(g, vigor);
  const bearing = year >= BEARING_YEAR;
  const dafb = bearing ? doy - p.fullBloom : null;
  const counts = fruitCounts(cond, spurCount);

  let fruitOnTree = 0;
  let fruit = null;
  if (bearing && dafb >= 6) {
    fruit = fruitMetricsAt(dafb, cond, varietyKey, spurCount);
    const thinT = smoothstep(p.thinning - p.fullBloom - 3, p.thinning - p.fullBloom + 3, dafb);
    const dropT = smoothstep(36, 50, dafb);
    let n = lerp(counts.set, counts.afterThin, thinT);
    n = lerp(n, counts.final, dropT);
    const pick = smoothstep(p.harvest + 4, p.harvestEnd, doy);
    n *= 1 - 0.93 * pick;
    // the few unpicked apples drop once the leaves are gone
    n *= 1 - smoothstep(p.leafFallEnd - 6, p.leafFallEnd + 8, doy);
    fruitOnTree = Math.round(n);
  }
  const blossomsOpen = bearing ? Math.round(counts.blossoms * smoothstep(p.firstBloom, p.fullBloom + 1, doy) * (1 - smoothstep(p.petalFall - 2, p.fruitSet - 4, doy))) : 0;

  return {
    absDay,
    year,
    doy,
    season: seasonOf(doy),
    stage,
    stages,
    pheno: p,
    growth: g,
    dims,
    bearing,
    dafb,
    fruit,
    counts,
    fruitOnTree,
    blossomsOpen,
    temp: p.climate.temp[Math.floor(doy)],
    gdd: p.climate.gdd[Math.floor(doy)],
    yieldKg: fruit ? (fruitOnTree * fruit.weight) / 1000 : 0,
  };
}

export function seedlingDims(doy) {
  const h = 0.3 * smoothstep(100, 250, doy) + 0.03 * smoothstep(90, 125, doy);
  return { height: h, caliper: 0.1 + 0.3 * smoothstep(100, 300, doy), canopy: 0.02 + 0.12 * smoothstep(110, 250, doy) };
}

// ---------- chart series ----------
export function seasonSeries(cond, varietyKey, spurCount = 240) {
  const p = phenology(cond, varietyKey);
  const rows = [];
  for (let d = 0; d < YEAR; d++) {
    const dafb = d - p.fullBloom;
    const m = dafb >= 0 ? fruitMetricsAt(dafb, cond, varietyKey, spurCount) : null;
    rows.push({
      doy: d,
      temp: p.climate.temp[d],
      gdd: p.climate.gdd[d],
      diam: m ? m.diam : null,
      weight: m ? m.weight : null,
      brix: m && dafb >= 20 ? m.brix : null,
      firmness: m && dafb >= 30 ? m.firmness : null,
    });
  }
  return { rows, pheno: p };
}

export function treeSeries(cond) {
  const vigor = treeVigor(cond);
  const rows = [];
  for (let a = 0; a <= TOTAL_DAYS; a += 7) {
    const year = Math.floor(a / YEAR);
    const doy = a - year * YEAR;
    const d = year === 0 ? seedlingDims(doy) : treeDims(treeGrowth(a), vigor);
    rows.push({ day: a, years: a / YEAR, height: d.height, caliper: d.caliper, canopy: d.canopy });
  }
  return rows;
}
