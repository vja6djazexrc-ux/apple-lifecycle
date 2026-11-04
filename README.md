# 🍎 Apple Lifecycle — 3D growth simulator

An interactive Three.js simulation of an apple tree, from a seed chilling in winter soil to a five-year-old tree carrying its first full crop. It runs through every season and growth stage, with live growth data you can steer with sliders.

The three reference photos are recreated as scenes. Open **References** in the toolbar to jump to each one.

| Reference | Simulated scene |
|---|---|
| `apple-example2.jpg`: pink buds and an opening blossom | Year 5, first bloom: king blossoms open, side buds still deep pink (branch close-up) |
| `apple-example.jpg`: red and golden apples on one branch | *Family tree* variety at harvest: red Gala-type and Golden Delicious limbs on one tree (branch close-up) |
| `apple-example3.jpg`: an orchard tree laden with fruit | Gala at harvest, eye-level view among orchard rows |

## Run it

### Option 1: double-click, no install
Open **`dist/apple-lifecycle.html`** in Chrome, Edge, Firefox or Safari. It's a single self-contained file (about 1.2 MB, with Three.js, code, styles and reference images inlined). It works offline, and you can email it, post it in chat or put it on a shared drive.

### Option 2: local server, shareable on your network
```bash
node serve.mjs          # or: npm start
```
This prints a `Local` URL and a `Network` URL (e.g. `http://10.0.0.119:5173/`). Anyone on the same Wi-Fi or LAN can open the Network URL. No `npm install` is needed: Three.js is vendored in `vendor/`.

### Option 3: a public link
The site is fully static, so any static host can serve it:
- **GitHub Pages**: push this folder to a GitHub repo, then set *Settings → Pages → Source → GitHub Actions*. `.github/workflows/pages.yml` publishes it on every push to `main`.
- **Netlify Drop / Cloudflare Pages / Vercel**: upload the `dist/` folder (it contains `index.html`).

### Sharing an exact view
**Share link** copies a URL that encodes the timeline position, variety, growing conditions and camera, e.g. `…/#t=770.8&v=gala&water=40&cam=…`. Anyone opening the link sees the same moment from the same angle.

## Using it

| | |
|---|---|
| **Timeline** | Drag the slider, press ▶ (Space), or click any stage in the strip. `[` / `]` jump between stages; ← / → step a day (Shift = 2 weeks). |
| **Orbit** | Drag to orbit a full 360°, scroll or pinch to zoom, right-drag to pan. Presets: Tree (T), Branch (B), Orchard (O), Ground/eye level (G). |
| **Inspect** | Click any apple, blossom, windfall, the seed or the trunk. The inspector shows that object's own data and a growth sparkline. **Focus** flies the camera to it, and foliage in the line of sight is cut away. **Follow** keeps it centred as it grows. Ripe apples can be **picked** into your basket. |
| **Growing conditions** | Temperature, sunlight, water, pollinator activity and fruit thinning feed the growth model. Every chart compares *your conditions* (blue) against the *regional baseline* (grey). |
| **Growth data** | Fruit: diameter, weight, sugar (°Brix), firmness. Climate: daily temperature, heat units. Tree: height, trunk caliper, canopy. Hover for a synced crosshair tooltip; **Table view** gives the same numbers as weekly rows. |
| **Varieties** | Gala, Honeycrisp, Golden Delicious, or a *Family tree* with red and gold apples on different limbs. |

## The timeline

| Period | Stages shown |
|---|---|
| Year 0 | Seed and cold stratification → germination (radicle, hooked shoot) → seedling (cotyledons, true leaves), all in a soil cut-away with labels |
| Years 1–4 | Juvenile growth: the tree grows from a whip to a scaffolded tree while the seasons cycle (leaf-out, summer canopy, autumn colour, bare winter) |
| Year 5 | Dormancy → bud break → tight cluster → pink bud → bloom (bees) → petal fall and fruit set → cell division (thinning, June drop) → cell expansion → ripening and colour → harvest (windfalls) → leaf fall → dormancy |

The environment follows the calendar: sky, sun angle, snow cover and falling snow, grass colour, blossom-white neighbouring trees, falling petals and leaves, and leaf litter.

## The growth model (`src/model.js`)

The model is a simplified but grounded temperate (≈45° N) orchard model:
- **Phenology** is driven by growing degree days (base 5 °C) from a synthetic daily climate. Bud stages have GDD thresholds, so the temperature slider shifts bloom and harvest dates (about −20 days at +3 °C).
- **Fruit diameter** follows a logistic curve in days after full bloom. Weight is derived from diameter and density. Final size depends on sunlight, water, temperature stress and crop load (fewer fruit grow larger).
- **Ripening**: soluble solids (°Brix) rise, the starch index climbs from 1 to 8, firmness falls, and red blush builds with sunlight. Blush is held back by warm nights.
- **Fruit count**: blossoms × fruit set (pollinators) × (1 − thinning) × June-drop survival (water stress).

Values are illustrative rather than agronomic advice. Blossoms and fruit are drawn about 1.3× life size so they read from orbit distance; the inspector and charts always report true sizes. Real seed-grown apple trees usually take 5–10 years to fruit; the timeline uses 5.

## Project layout

```
index.html            app shell (uses an import map → vendor/three)
css/styles.css
src/main.js           renderer, camera, UI wiring, picking, share links
src/model.js          growth / phenology model (pure functions)
src/scene/tree.js     procedural tree: bark, leaves, buds, petals, fruit
src/scene/apple.js    apple geometry + skin shader (streaks, blush, lenticels)
src/scene/seedling.js seed, roots, seedling, soil cut-away
src/scene/environment.js  sky, light, ground, grass, orchard, weather
src/scene/bees.js
src/ui/charts.js      dependency-free SVG charts with synced tooltips
serve.mjs             zero-dependency static server (prints LAN URL)
scripts/build.mjs     → dist/apple-lifecycle.html (single file)
scripts/screenshot.mjs, scripts/smoke.mjs   headless-Chrome checks
assets/ref/           the three reference photos
```

## Development

```bash
npm install           # only needed for build/test tooling
npm run build         # rebuild dist/ after changing src/
npm start &           # then:
npm run shots         # screenshots of key stages → shots/
npm run smoke         # click-an-apple / pick / table / share-link test
npm run vendor        # refresh vendor/three from node_modules
```
