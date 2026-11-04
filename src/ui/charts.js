// Small SVG line charts with a shared crosshair + tooltip, built without a
// charting library so the app stays dependency-free and works offline.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function doyLabel(doy) {
  let m = 11;
  while (m > 0 && doy < MONTH_START[m]) m--;
  return `${MONTHS[m]} ${Math.floor(doy - MONTH_START[m]) + 1}`;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return { ticks, step };
}

export class LineChart {
  constructor(parent, opts) {
    this.opts = { height: 96, yMin: 0, ...opts };
    this.root = document.createElement('figure');
    this.root.className = 'chart';
    const head = document.createElement('figcaption');
    head.className = 'chart-title';
    const t = document.createElement('span');
    t.textContent = opts.title;
    const u = document.createElement('span');
    u.className = 'chart-unit';
    u.textContent = opts.unit ? `(${opts.unit})` : '';
    head.append(t, ' ', u);
    this.readout = document.createElement('span');
    this.readout.className = 'chart-readout';
    head.appendChild(this.readout);
    this.root.appendChild(head);
    this.svg = el('svg', { class: 'chart-svg', role: 'img', 'aria-label': `${opts.title} chart` });
    this.root.appendChild(this.svg);
    parent.appendChild(this.root);
    this.series = [];
    this.marker = null;
    this.hoverX = null;
    this.width = 300;
    new ResizeObserver(() => this.layout()).observe(this.root);
    this.svg.addEventListener('pointermove', (e) => this.handleHover(e));
    this.svg.addEventListener('pointerleave', () => this.opts.onHover && this.opts.onHover(null));
  }

  layout() {
    const w = Math.max(160, Math.round(this.root.clientWidth));
    if (w !== this.width || !this.drawn) {
      this.width = w;
      this.render();
    }
  }

  setData(series, domain) {
    this.series = series;
    if (domain) this.opts.xDomain = domain;
    this.render();
  }

  scales() {
    const { height } = this.opts;
    const m = { l: 34, r: 12, t: 6, b: 18 };
    const [x0, x1] = this.opts.xDomain;
    let yMax = -Infinity;
    let yMin = this.opts.yMin ?? Infinity;
    for (const s of this.series)
      for (const p of s.values) {
        if (p.y == null) continue;
        if (p.x < x0 || p.x > x1) continue;
        yMax = Math.max(yMax, p.y);
        if (this.opts.yMin == null) yMin = Math.min(yMin, p.y);
      }
    if (!isFinite(yMax)) yMax = 1;
    if (!isFinite(yMin)) yMin = 0;
    const { ticks, step } = niceTicks(yMin, yMax, 3);
    const top = Math.max(yMax, ticks[ticks.length - 1]);
    const yTop = top + (top === ticks[ticks.length - 1] ? 0 : step);
    const yBottom = Math.min(yMin, ticks[0]);
    const X = (x) => m.l + ((x - x0) / (x1 - x0)) * (this.width - m.l - m.r);
    const Y = (y) => m.t + (1 - (y - yBottom) / (yTop - yBottom || 1)) * (height - m.t - m.b);
    return { X, Y, m, ticks: ticks.filter((t) => t <= yTop), x0, x1, height };
  }

  render() {
    const svg = this.svg;
    const { height } = this.opts;
    svg.setAttribute('viewBox', `0 0 ${this.width} ${height}`);
    svg.setAttribute('height', height);
    svg.replaceChildren();
    this.drawn = true;
    const sc = this.scales();
    this.sc = sc;
    const { X, Y, m } = sc;
    const grid = el('g', { class: 'grid' }, svg);
    for (const t of sc.ticks) {
      el('line', { x1: m.l, x2: this.width - m.r, y1: Y(t), y2: Y(t) }, grid);
      const lab = el('text', { x: m.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'tick' }, grid);
      lab.textContent = this.opts.yFormat ? this.opts.yFormat(t) : t;
    }
    const xt = this.opts.xTicks(sc.x0, sc.x1);
    for (const t of xt) {
      const lab = el('text', { x: X(t.x), y: height - 4, 'text-anchor': 'middle', class: 'tick' }, grid);
      lab.textContent = t.label;
    }
    el('line', { x1: m.l, x2: this.width - m.r, y1: height - m.b, y2: height - m.b, class: 'baseline' }, grid);

    // annotation bands (e.g. stage spans)
    if (this.opts.bands) {
      for (const b of this.opts.bands()) {
        const r = el('rect', { x: X(b.x0), y: m.t, width: Math.max(0, X(b.x1) - X(b.x0)), height: height - m.t - m.b, class: 'band' }, svg);
        if (b.label && this.opts.bandLabels) {
          const tx = el('text', { x: X(b.x0) + 3, y: m.t + 9, class: 'band-label' }, svg);
          tx.textContent = b.label;
        }
      }
    }

    this.paths = [];
    for (const s of this.series) {
      let d = '';
      let pen = false;
      for (const p of s.values) {
        if (p.y == null || p.x < sc.x0 || p.x > sc.x1) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`;
        pen = true;
      }
      el('path', { d, class: 'line', stroke: s.color, 'stroke-width': s.width || 2 }, svg);
    }
    this.markerG = el('g', { class: 'marker' }, svg);
    this.hoverG = el('g', { class: 'hover' }, svg);
    this.drawMarker();
    this.drawHover();
  }

  valueAt(s, x) {
    // linear interpolation on sorted x
    const v = s.values;
    if (!v.length || x < v[0].x || x > v[v.length - 1].x) return null;
    let lo = 0;
    let hi = v.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (v[mid].x <= x) lo = mid;
      else hi = mid;
    }
    const a = v[lo];
    const b = v[hi];
    if (a.y == null || b.y == null) return a.y ?? b.y ?? null;
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }

  setMarker(x, label) {
    this.marker = x;
    this.markerLabel = label;
    this.drawMarker();
  }

  drawMarker() {
    if (!this.markerG) return;
    this.markerG.replaceChildren();
    const x = this.marker;
    const sc = this.sc;
    if (x == null || x < sc.x0 || x > sc.x1) {
      this.readout.textContent = '';
      return;
    }
    const { X, Y, m, height } = sc;
    el('line', { x1: X(x), x2: X(x), y1: m.t, y2: height - m.b, class: 'now-line' }, this.markerG);
    const primary = this.series.find((s) => s.primary) || this.series[0];
    for (const s of this.series) {
      const y = this.valueAt(s, x);
      if (y == null) continue;
      el('circle', { cx: X(x), cy: Y(y), r: s.primary ? 4 : 3, fill: s.color, class: 'dot' }, this.markerG);
    }
    const pv = primary ? this.valueAt(primary, x) : null;
    this.readout.textContent = pv == null ? '' : `${this.opts.fmt(pv)} now`;
  }

  handleHover(e) {
    const rect = this.svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.width;
    const { m, x0, x1 } = this.sc;
    const x = x0 + ((px - m.l) / (this.width - m.l - m.r)) * (x1 - x0);
    if (x < x0 || x > x1) return this.opts.onHover && this.opts.onHover(null);
    this.opts.onHover && this.opts.onHover(Math.round(x * 4) / 4, e);
  }

  setHover(x) {
    this.hoverX = x;
    this.drawHover();
  }

  drawHover() {
    if (!this.hoverG) return;
    this.hoverG.replaceChildren();
    const x = this.hoverX;
    const sc = this.sc;
    if (x == null || x < sc.x0 || x > sc.x1) return;
    const { X, Y, m, height } = sc;
    el('line', { x1: X(x), x2: X(x), y1: m.t, y2: height - m.b, class: 'hover-line' }, this.hoverG);
    for (const s of this.series) {
      const y = this.valueAt(s, x);
      if (y == null) continue;
      el('circle', { cx: X(x), cy: Y(y), r: 4, fill: s.color, class: 'dot' }, this.hoverG);
    }
  }

  tooltipRows(x) {
    return this.series.map((s) => ({ label: s.label, color: s.color, value: this.valueAt(s, x), fmt: this.opts.fmt }));
  }
}

// A group of charts sharing one x-axis, crosshair, and tooltip.
export class ChartGroup {
  constructor(parent, defs, { xDomain, xTicks, xLabel, bands }) {
    this.root = document.createElement('div');
    this.root.className = 'chart-group';
    parent.appendChild(this.root);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);
    this.xLabel = xLabel;
    this.charts = defs.map(
      (d) =>
        new LineChart(this.root, {
          ...d,
          xDomain,
          xTicks,
          bands,
          onHover: (x, e) => this.hover(x, e),
        })
    );
  }

  hover(x, e) {
    for (const c of this.charts) c.setHover(x);
    if (x == null) {
      this.tooltip.hidden = true;
      return;
    }
    const tt = this.tooltip;
    tt.replaceChildren();
    const h = document.createElement('div');
    h.className = 'tt-head';
    h.textContent = this.xLabel(x);
    tt.appendChild(h);
    for (const c of this.charts) {
      const sec = document.createElement('div');
      sec.className = 'tt-sec';
      const name = document.createElement('div');
      name.className = 'tt-name';
      name.textContent = c.opts.title;
      sec.appendChild(name);
      for (const r of c.tooltipRows(x)) {
        const row = document.createElement('div');
        row.className = 'tt-row';
        const key = document.createElement('span');
        key.className = 'tt-key';
        key.style.background = r.color;
        const val = document.createElement('strong');
        val.textContent = r.value == null ? '—' : r.fmt(r.value);
        const lab = document.createElement('span');
        lab.className = 'tt-label';
        lab.textContent = r.label;
        row.append(key, val, lab);
        sec.appendChild(row);
      }
      tt.appendChild(sec);
    }
    tt.hidden = false;
    const pad = 14;
    const w = tt.offsetWidth;
    const hgt = tt.offsetHeight;
    let left = e.clientX - w - pad;
    if (left < 8) left = e.clientX + pad;
    let top = Math.min(window.innerHeight - hgt - 8, Math.max(8, e.clientY - hgt / 2));
    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
  }

  setMarker(x) {
    for (const c of this.charts) c.setMarker(x);
  }

  set visible(v) {
    this.root.hidden = !v;
  }
}

// Tiny sparkline for the inspector card
export function sparkline(svg, values, current, { color = '#3987e5', w = 220, h = 44 } = {}) {
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.replaceChildren();
  const pts = values.filter((p) => p.y != null);
  if (!pts.length) return;
  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x;
  const yMax = Math.max(...pts.map((p) => p.y)) || 1;
  const X = (x) => 4 + ((x - x0) / (x1 - x0 || 1)) * (w - 8);
  const Y = (y) => h - 4 - (y / yMax) * (h - 10);
  el('line', { x1: 4, x2: w - 4, y1: h - 4, y2: h - 4, class: 'baseline' }, svg);
  el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(''), class: 'line', stroke: color, 'stroke-width': 2 }, svg);
  if (current && current.x >= x0 && current.x <= x1) {
    el('circle', { cx: X(current.x), cy: Y(current.y), r: 4, fill: color, class: 'dot' }, svg);
  }
}
