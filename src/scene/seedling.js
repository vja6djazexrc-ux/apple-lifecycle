import * as THREE from 'three';
import { VIS, rng, canvasTexture, createLeafGeometry } from './shared.js';
import { smoothstep, clamp, lerp } from '../model.js';

const UP = new THREE.Vector3(0, 1, 0);
const CUT = 0.32; // size of the soil cut-away (m)
const DEPTH = 0.3;
// The seed sits just inside the cut-away so the root is visible against the soil face.
export const SEED_POS = new THREE.Vector3(0.035, -0.035, 0.035);

function soilTexture() {
  const r = rng(3);
  return canvasTexture(512, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#3b2a1c');
    grad.addColorStop(0.35, '#5a4129');
    grad.addColorStop(1, '#7a5c3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? `rgba(20,12,6,${0.15 + r() * 0.3})` : `rgba(150,120,85,${0.1 + r() * 0.25})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 70; i++) {
      // pebbles
      const x = r() * w;
      const y = h * 0.25 + r() * h * 0.75;
      const s = 1.5 + r() * 4.5;
      const v = 95 + r() * 50;
      g.fillStyle = `rgb(${v + 12},${v + 4},${v - 10})`;
      g.beginPath();
      g.ellipse(x, y, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // thin dark top band = organic layer
    g.fillStyle = 'rgba(25,16,8,0.6)';
    g.fillRect(0, 0, w, h * 0.06);
  }, { repeat: [1, 1] });
}

export class Seedling {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'seedling';
    const soilMat = new THREE.MeshStandardMaterial({ map: soilTexture(), roughness: 1 });
    // two soil faces and the floor of the cut-away quadrant
    const wallA = new THREE.Mesh(new THREE.PlaneGeometry(CUT, DEPTH), soilMat);
    wallA.position.set(CUT / 2, -DEPTH / 2, 0);
    const wallB = new THREE.Mesh(new THREE.PlaneGeometry(CUT, DEPTH), soilMat);
    wallB.rotation.y = Math.PI / 2;
    wallB.position.set(0, -DEPTH / 2, CUT / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CUT, CUT), soilMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(CUT / 2, -DEPTH, CUT / 2);
    this.soil = new THREE.Group();
    this.soil.add(wallA, wallB, floor);
    for (const m of [wallA, wallB, floor]) m.receiveShadow = true;
    this.group.add(this.soil);

    // seed: glossy teardrop
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const y = t;
      const r = Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.5 * (1 - 0.35 * t);
      pts.push(new THREE.Vector2(Math.max(0, r), y - 0.5));
    }
    const seedGeo = new THREE.LatheGeometry(pts, 24);
    seedGeo.scale(0.6, 1, 0.42);
    this.seedMat = new THREE.MeshPhysicalMaterial({ color: 0x4a2a14, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    this.seed = new THREE.Mesh(seedGeo, this.seedMat);
    this.seed.position.copy(SEED_POS);
    this.seed.rotation.set(0.4, 0, 0.9);
    this.seed.name = 'seed';
    this.seed.castShadow = true;
    this.group.add(this.seed);

    this.rootMat = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.7 });
    this.stemMat = new THREE.MeshStandardMaterial({ color: 0x8aa04a, roughness: 0.6 });
    this.root = new THREE.Mesh(new THREE.BufferGeometry(), this.rootMat);
    this.laterals = new THREE.Group();
    this.stem = new THREE.Mesh(new THREE.BufferGeometry(), this.stemMat);
    this.stem.castShadow = true;
    this.group.add(this.root, this.laterals, this.stem);

    // cotyledons: thick, rounded seed leaves
    const cotGeo = new THREE.SphereGeometry(0.5, 16, 8);
    cotGeo.scale(0.75, 1, 0.18);
    cotGeo.translate(0, 0.5, 0);
    this.cotMat = new THREE.MeshStandardMaterial({ color: 0x9cbf55, roughness: 0.55 });
    this.cots = [0, 1].map(() => {
      const m = new THREE.Mesh(cotGeo, this.cotMat);
      m.castShadow = true;
      this.group.add(m);
      return m;
    });

    this.leafGeo = createLeafGeometry();
    this.leafMats = [];
    this.trueLeaves = [];
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3f7a22, side: THREE.DoubleSide, roughness: 0.6 });
      const m = new THREE.Mesh(this.leafGeo, mat);
      m.castShadow = true;
      this.trueLeaves.push(m);
      this.group.add(m);
    }
    this.lastKey = '';
    this.rand = rng(77);
    this.lateralSeeds = Array.from({ length: 10 }, () => ({ t: 0.2 + this.rand() * 0.7, a: this.rand() * 6.28, len: 0.4 + this.rand() * 0.6 }));
  }

  update(state) {
    const visible = state.year === 0;
    this.group.visible = visible;
    if (!visible) return;
    const doy = state.doy;
    const key = doy.toFixed(1);
    if (key === this.lastKey) return;
    this.lastKey = key;

    // --- seed: swells during stratification, splits at germination
    const swell = smoothstep(10, 80, doy);
    const seedS = 0.008 * VIS.seed * (1 + 0.15 * swell);
    this.seed.scale.setScalar(seedS / 1);
    this.seed.visible = doy < 128;
    this.seedMat.color.setHex(0x4a2a14).lerp(new THREE.Color(0x5e3a1e), swell);

    // --- radicle (primary root), growing down from the seed
    const rootLen = 0.012 + 0.2 * smoothstep(82, 160, doy) + 0.05 * smoothstep(160, 300, doy);
    const showRoot = doy >= 82;
    this.root.visible = showRoot;
    if (showRoot) {
      const rp = [];
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        rp.push(new THREE.Vector3(SEED_POS.x + Math.sin(t * 5) * 0.006 + t * 0.01, SEED_POS.y - 0.004 - t * Math.min(rootLen, DEPTH - 0.06), SEED_POS.z + Math.cos(t * 4) * 0.004 + t * 0.008));
      }
      const curve = new THREE.CatmullRomCurve3(rp);
      this.root.geometry.dispose();
      this.root.geometry = new THREE.TubeGeometry(curve, 24, lerp(0.0012, 0.0028, smoothstep(90, 250, doy)), 6, false);
      taperTube(this.root.geometry, 6);
      // lateral roots appear once the seedling establishes
      this.laterals.clear();
      const latAmt = smoothstep(120, 220, doy);
      if (latAmt > 0) {
        for (const ls of this.lateralSeeds) {
          if (ls.t > latAmt + 0.1) continue;
          const start = curve.getPoint(ls.t);
          const dir = new THREE.Vector3(Math.cos(ls.a), -0.6, Math.sin(ls.a));
          // keep laterals in front of the soil face
          if (dir.x < 0) dir.x *= -0.3;
          if (dir.z < 0) dir.z *= -0.3;
          dir.normalize();
          const len = 0.06 * ls.len * latAmt;
          const lc = new THREE.CatmullRomCurve3([start, start.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, -0.005, 0)), start.clone().addScaledVector(dir, len)]);
          const lg = new THREE.TubeGeometry(lc, 8, 0.0009, 4, false);
          taperTube(lg, 4);
          this.laterals.add(new THREE.Mesh(lg, this.rootMat));
        }
      }
    } else this.laterals.clear();

    // --- shoot: hooked hypocotyl breaks the surface, straightens, then elongates
    const emerge = smoothstep(95, 112, doy);
    const straighten = smoothstep(108, 122, doy);
    const height = state.dims.height;
    const showStem = doy >= 95;
    this.stem.visible = showStem;
    const top = new THREE.Vector3();
    let stemCurve = null;
    if (showStem) {
      const base = SEED_POS.clone().add(new THREE.Vector3(0, 0.004, 0));
      const h = Math.max(0.004, emerge * 0.02 + height);
      const hook = (1 - straighten) * 0.012;
      const pts = [base, new THREE.Vector3(base.x, base.y + (h - base.y) * 0.35, base.z), new THREE.Vector3(base.x + 0.002, base.y + (h - base.y) * 0.7, base.z), new THREE.Vector3(base.x + hook * 0.6, h, base.z + hook * 0.2), new THREE.Vector3(base.x + hook * 1.3, h - hook * 0.9, base.z + hook * 0.4)];
      stemCurve = new THREE.CatmullRomCurve3(pts);
      this.stem.geometry.dispose();
      const thick = lerp(0.0012, 0.003, smoothstep(110, 300, doy));
      this.stem.geometry = new THREE.TubeGeometry(stemCurve, 32, thick, 6, false);
      taperTube(this.stem.geometry, 6, 0.5);
      top.copy(stemCurve.getPoint(1));
      // stem turns woody brown by autumn
      this.stemMat.color.setHex(0x8aa04a).lerp(new THREE.Color(0x6b4a33), smoothstep(230, 320, doy));
    }

    // --- cotyledons
    const cotOpen = smoothstep(112, 126, doy);
    const cotAlive = 1 - smoothstep(190, 225, doy);
    const cotSize = 0.012 * VIS.seed * lerp(0.5, 1, cotOpen) * (doy < 112 ? 0.6 : 1);
    this.cots.forEach((m, i) => {
      m.visible = showStem && cotAlive > 0.02;
      if (!m.visible) return;
      const ref = stemCurve ? stemCurve.getPoint(straighten < 1 ? 0.97 : 0.25 + 0.75 * clamp(0.03 / Math.max(height, 0.03))) : top;
      m.position.copy(straighten < 0.99 ? top : ref);
      const side = i === 0 ? 1 : -1;
      const angle = lerp(0.15, 1.25, cotOpen) * side;
      m.rotation.set(0, 0.6, angle);
      if (straighten < 1) m.rotation.x = Math.PI * (1 - straighten) * 0.8;
      m.scale.setScalar(cotSize * cotAlive + 0.0001);
      this.cotMat.color.setHex(0x9cbf55).lerp(new THREE.Color(0xc9b44a), smoothstep(170, 215, doy));
    });

    // --- true leaves, alternate up the stem
    const leafCount = 9 * smoothstep(122, 245, doy);
    const autumn = smoothstep(280, 305, doy);
    const fall = smoothstep(292, 322, doy);
    this.trueLeaves.forEach((m, i) => {
      const grow = clamp(leafCount - i);
      const dropped = (i * 0.37) % 1 < fall;
      m.visible = showStem && grow > 0.02 && !dropped && stemCurve;
      if (!m.visible) return;
      const t = clamp(0.32 + (i / 9) * 0.68);
      const p = stemCurve.getPoint(Math.min(0.99, t + (1 - grow) * 0.05));
      m.position.copy(p);
      const ang = i * 2.4;
      const out = new THREE.Vector3(Math.cos(ang), 0.7, Math.sin(ang)).normalize();
      m.quaternion.setFromUnitVectors(UP, out);
      m.rotateY(Math.PI / 2);
      const sz = 0.055 * VIS.leaf * (0.45 + 0.55 * grow) * (i === 8 ? 0.6 : 1);
      m.scale.setScalar(sz * grow);
      m.material.color.setHex(i > 6 ? 0x6a9a34 : 0x3f7a22).lerp(new THREE.Color(0xd2a52a), clamp(autumn * 1.3 - (i / 9) * 0.3));
    });

    this.soil.visible = true;
  }

  frameFor(doy, height) {
    if (doy < 100) return { target: SEED_POS.clone().add(new THREE.Vector3(0.02, -0.03, 0.02)), dist: 0.45 };
    if (doy < 130) return { target: new THREE.Vector3(0.06, -0.06, 0.06), dist: 0.8 };
    return { target: new THREE.Vector3(0.04, height * 0.4 - 0.06, 0.04), dist: Math.max(0.8, height * 3.2) };
  }
}

// taper a tube from full radius at the start to `tip` × radius at the end
function taperTube(geo, radial, tip = 0.15) {
  const pos = geo.attributes.position;
  const params = geo.parameters;
  const curve = params.path;
  const segs = params.tubularSegments;
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const k = lerp(1, tip, t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const x = pos.getX(idx);
      const y = pos.getY(idx);
      const z = pos.getZ(idx);
      pos.setXYZ(idx, c.x + (x - c.x) * k, c.y + (y - c.y) * k, c.z + (z - c.z) * k);
    }
  }
  pos.needsUpdate = true;
}
