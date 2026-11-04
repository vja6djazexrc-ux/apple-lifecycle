import * as THREE from 'three';
import { VIS, rng, addWind, addSightClip, barkTexture, createLeafGeometry, createPetalGeometry } from './shared.js';
import { createAppleGeometry, createAppleMaterial, setAppleAttributes } from './apple.js';
import { smoothstep, clamp, lerp, leafState, VARIETIES } from '../model.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function srgb(r, g, b) {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

const LEAF_YOUNG = srgb(0.56, 0.74, 0.26);
const LEAF_SUMMER = srgb(0.2, 0.42, 0.12);
const LEAF_AUTUMN = [srgb(0.86, 0.7, 0.16), srgb(0.88, 0.5, 0.12), srgb(0.6, 0.42, 0.14), srgb(0.7, 0.2, 0.08)];
const BUD_BROWN = srgb(0.36, 0.25, 0.17);
const BUD_SILVER = srgb(0.64, 0.64, 0.55);
const BUD_GREEN = srgb(0.48, 0.62, 0.26);
const BUD_PINK = srgb(0.82, 0.18, 0.34);
const PETAL_OPEN = srgb(1, 0.93, 0.95);
const PETAL_OLD = srgb(1, 0.99, 0.97);
const FRUITLET = srgb(0.46, 0.62, 0.2);

function perpendicular(t, rand) {
  // random unit vector perpendicular to t
  const a = Math.abs(t.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  const p1 = new THREE.Vector3().crossVectors(t, a).normalize();
  const p2 = new THREE.Vector3().crossVectors(t, p1).normalize();
  const ang = rand() * Math.PI * 2;
  return p1.multiplyScalar(Math.cos(ang)).add(p2.multiplyScalar(Math.sin(ang)));
}

export class AppleTree {
  constructor(seed = 11) {
    this.group = new THREE.Group();
    this.group.name = 'appleTree';
    this.rand = rng(seed);
    this.branches = [];
    this.spurs = [];
    this.picked = new Set();
    this.variety = 'gala';
    this.buildSkeleton();
    this.buildBark();
    this.buildLeaves();
    this.buildBlossoms();
    this.buildFruit();
    this.scale = 1;
    this.lastKey = '';
  }

  // ---------------------------------------------------------------- skeleton
  addBranch(o) {
    const r = this.rand;
    const pts = [o.base.clone()];
    const d = o.dir.clone().normalize();
    const p = o.base.clone();
    for (let i = 1; i <= o.segs; i++) {
      const wobble = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).multiplyScalar(o.wobble ?? 0.18);
      d.addScaledVector(UP, (o.bendUp ?? 0) / o.segs).addScaledVector(UP, -(o.droop ?? 0)).add(wobble).normalize();
      p.addScaledVector(d, o.length / o.segs);
      pts.push(p.clone());
    }
    const radii = pts.map((_, i) => (o.radiusFn ? o.radiusFn(i / o.segs) : lerp(o.r0, o.r1, Math.pow(i / o.segs, 0.85))));
    const b = {
      index: this.branches.length,
      parent: o.parent ?? -1,
      tParent: o.tParent ?? 0,
      depth: o.depth,
      pts,
      radii,
      length: o.length,
      birth: o.birth,
      dur: o.dur,
      scaffold: o.scaffold ?? -1,
      f: 1,
      s: 1,
      t: new THREE.Vector3(),
    };
    this.branches.push(b);
    return b;
  }

  pointAt(b, t, out = new THREE.Vector3()) {
    const n = b.pts.length - 1;
    const x = clamp(t) * n;
    const i = Math.min(n - 1, Math.floor(x));
    return out.lerpVectors(b.pts[i], b.pts[i + 1], x - i);
  }

  tangentAt(b, t, out = new THREE.Vector3()) {
    const n = b.pts.length - 1;
    const i = Math.min(n - 1, Math.floor(clamp(t) * n));
    return out.subVectors(b.pts[i + 1], b.pts[i]).normalize();
  }

  radiusAt(b, t) {
    const n = b.radii.length - 1;
    const x = clamp(t) * n;
    const i = Math.min(n - 1, Math.floor(x));
    return lerp(b.radii[i], b.radii[i + 1], x - i);
  }

  childTiming(parent, t, dur) {
    const r = this.rand;
    let birth = parent.birth + parent.dur * t + 0.03 + r() * 0.07;
    birth = Math.min(birth, 0.97 - dur * 0.6);
    return { birth, dur: Math.min(dur, 0.985 - birth) };
  }

  buildSkeleton() {
    const r = this.rand;
    const leader = this.addBranch({
      base: new THREE.Vector3(0, -0.05, 0),
      dir: new THREE.Vector3(0.03, 1, 0.02),
      length: 4.0,
      segs: 16,
      depth: 0,
      wobble: 0.06,
      birth: 0,
      dur: 0,
      radiusFn: (t) => (t < 0.03 ? 0.1 : t < 0.3 ? lerp(0.078, 0.066, t / 0.3) : lerp(0.045, 0.01, (t - 0.3) / 0.7)),
    });

    // scaffold limbs: four spreading low limbs + one upper tier, open-vase like reference 3
    const scaffolds = [];
    const baseAz = r() * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const upper = k === 4;
      const tP = upper ? 0.52 : 0.27 + k * 0.025 + r() * 0.02;
      const az = upper ? baseAz + 0.8 : baseAz + (k * Math.PI) / 2 + (r() - 0.5) * 0.5;
      const el = upper ? 0.75 : 0.55 + r() * 0.25;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const len = upper ? 1.7 : 2.4 + r() * 0.5;
      const s = this.addBranch({
        parent: leader.index,
        tParent: tP,
        base: this.pointAt(leader, tP),
        dir,
        length: len,
        segs: 10,
        depth: 1,
        r0: upper ? 0.035 : 0.055,
        r1: 0.008,
        bendUp: upper ? 0.1 : 0.42,
        wobble: 0.12,
        birth: 0.008 + k * 0.025,
        dur: 0.42,
        scaffold: k,
      });
      scaffolds.push(s);
    }

    // secondary limbs on scaffolds and the upper leader
    const secondaries = [];
    const hosts = [...scaffolds.map((s) => ({ b: s, n: 8, t0: 0.18, t1: 0.95 })), { b: leader, n: 8, t0: 0.4, t1: 0.95 }];
    for (const { b, n, t0, t1 } of hosts) {
      for (let i = 0; i < n; i++) {
        const t = t0 + ((t1 - t0) * (i + r() * 0.6)) / n;
        const tan = this.tangentAt(b, t);
        let side = perpendicular(tan, r);
        if (side.y < -0.35) side.y *= -0.5; // avoid limbs pointing straight down
        side.normalize();
        const dir = side.multiplyScalar(0.9).addScaledVector(tan, 0.55).addScaledVector(UP, 0.15);
        const timing = this.childTiming(b, t, 0.3);
        const len = (0.65 + r() * 0.7) * (1 - 0.5 * t) * (b.depth === 0 ? 0.85 : 1);
        secondaries.push(
          this.addBranch({
            parent: b.index,
            tParent: t,
            base: this.pointAt(b, t),
            dir,
            length: len,
            segs: 6,
            depth: 2,
            r0: Math.min(this.radiusAt(b, t) * 0.6, 0.03),
            r1: 0.004,
            droop: 0.035,
            bendUp: 0.12,
            wobble: 0.2,
            scaffold: b.scaffold,
            ...timing,
          })
        );
      }
    }

    // fruiting twigs
    for (const b of secondaries) {
      const n = 4 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = 0.15 + (0.85 * (i + r() * 0.7)) / n;
        const tan = this.tangentAt(b, t);
        const side = perpendicular(tan, r);
        if (side.y < -0.5) side.y *= -0.3;
        const dir = side.normalize().addScaledVector(tan, 0.7).addScaledVector(UP, 0.1);
        const timing = this.childTiming(b, t, 0.2);
        this.addBranch({
          parent: b.index,
          tParent: t,
          base: this.pointAt(b, t),
          dir,
          length: 0.16 + r() * 0.3,
          segs: 3,
          depth: 3,
          r0: Math.min(this.radiusAt(b, t) * 0.55, 0.011),
          r1: 0.0025,
          droop: 0.05,
          wobble: 0.25,
          scaffold: b.scaffold,
          ...timing,
        });
      }
    }

    // fruit spurs along secondaries and twigs
    for (const b of this.branches) {
      if (b.depth < 2) continue;
      const n = b.depth === 2 ? Math.round(b.length * 2.2) : 1 + (r() < 0.25 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const t = b.depth === 2 ? 0.25 + r() * 0.7 : 0.35 + r() * 0.6;
        const tan = this.tangentAt(b, t);
        const out = perpendicular(tan, r);
        out.addScaledVector(UP, 0.55).normalize();
        this.spurs.push({ branch: b.index, t, pos: this.pointAt(b, t), out, tan, scaffold: b.scaffold });
      }
    }

    let maxY = 0;
    for (const b of this.branches) for (const p of b.pts) maxY = Math.max(maxY, p.y);
    this.matureHeight = maxY;
  }

  // -------------------------------------------------------------------- bark
  buildBark() {
    const positions = [];
    const normals = [];
    const uvs = [];
    const bidx = [];
    const indices = [];
    const radialByDepth = [14, 9, 6, 4];
    for (const b of this.branches) {
      const R = radialByDepth[b.depth];
      const n = b.pts.length;
      // parallel-transport frames
      let tan = new THREE.Vector3().subVectors(b.pts[1], b.pts[0]).normalize();
      let nor = new THREE.Vector3().crossVectors(tan, Math.abs(tan.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
      const start = positions.length / 3;
      let vAcc = 0;
      for (let i = 0; i < n; i++) {
        const nt = i < n - 1 ? new THREE.Vector3().subVectors(b.pts[i + 1], b.pts[i]).normalize() : tan.clone();
        const avg = i === 0 ? nt.clone() : tan.clone().add(nt).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(tan, avg);
        nor.applyQuaternion(q).normalize();
        tan = avg;
        const bin = new THREE.Vector3().crossVectors(tan, nor).normalize();
        if (i > 0) vAcc += b.pts[i].distanceTo(b.pts[i - 1]);
        // root flare at the very bottom of the trunk
        const rad = b.radii[i];
        for (let j = 0; j <= R; j++) {
          const a = (j / R) * Math.PI * 2;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          const nx = nor.x * dx + bin.x * dy;
          const ny = nor.y * dx + bin.y * dy;
          const nz = nor.z * dx + bin.z * dy;
          positions.push(b.pts[i].x + nx * rad, b.pts[i].y + ny * rad, b.pts[i].z + nz * rad);
          normals.push(nx, ny, nz);
          uvs.push((j / R) * Math.max(1, Math.round(rad * 40)), vAcc * 2.2);
          bidx.push(b.index);
        }
        tan = nt;
      }
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < R; j++) {
          const a = start + i * (R + 1) + j;
          const c = a + R + 1;
          indices.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    this.barkRest = new Float32Array(positions);
    this.barkBranch = new Uint16Array(bidx);
    const tex = barkTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xb8a898, roughness: 0.95, metalness: 0 });
    this.bark = new THREE.Mesh(geo, mat);
    this.bark.castShadow = true;
    this.bark.receiveShadow = true;
    this.bark.frustumCulled = false;
    this.bark.name = 'bark';
    this.group.add(this.bark);
  }

  // ------------------------------------------------------------------ leaves
  buildLeaves() {
    const r = this.rand;
    const leaves = [];
    const addLeaf = (branch, t, pos, dir, size, opts = {}) => {
      // orient: leaf +Y along dir, leaf +Z (upper face) as close to world-up as possible
      const y = dir.clone().normalize();
      const z = UP.clone().addScaledVector(y, -UP.dot(y));
      if (z.lengthSq() < 1e-4) z.set(1, 0, 0);
      z.normalize().applyAxisAngle(y, (r() - 0.5) * 1.4);
      const x = new THREE.Vector3().crossVectors(y, z).normalize();
      z.crossVectors(x, y).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      leaves.push({
        branch,
        t,
        pos: pos.clone(),
        q,
        size,
        jit: opts.jit ?? r(),
        fallAt: r(),
        hue: r() < 0.55 ? 0 : r() < 0.6 ? 1 : r() < 0.7 ? 2 : 3,
        tone: 0.85 + r() * 0.3,
        lower: opts.lower ?? 0,
        keep: r(),
        spur: opts.spur ?? -1,
      });
    };
    const density = [24, 14, 46, 88];
    for (const b of this.branches) {
      const n = Math.round(b.length * density[b.depth]);
      for (let i = 0; i < n; i++) {
        const t = b.depth === 0 ? 0.08 + r() * 0.92 : b.depth === 1 ? 0.45 + r() * 0.55 : 0.1 + r() * 0.9;
        const tan = this.tangentAt(b, t);
        const side = perpendicular(tan, r);
        const pos = this.pointAt(b, t).addScaledVector(side, this.radiusAt(b, t));
        const dir = side.clone().multiplyScalar(0.8).addScaledVector(tan, 0.6).addScaledVector(UP, 0.3 + r() * 0.3);
        addLeaf(b.index, t, pos, dir, 0.065 + r() * 0.03, { lower: b.depth === 0 ? t : 0 });
      }
      if (b.depth >= 2) {
        const tip = b.pts[b.pts.length - 1];
        const tan = this.tangentAt(b, 1);
        for (let k = 0; k < (b.depth === 3 ? 8 : 5); k++) {
          const side = perpendicular(tan, r);
          addLeaf(b.index, 1, tip, side.multiplyScalar(0.6).addScaledVector(tan, 0.8).addScaledVector(UP, 0.4), 0.05 + r() * 0.03, { jit: r() * 0.6 });
        }
      }
    }
    // spur rosettes: the first leaves to unfold in spring, around each flower cluster
    this.spurs.forEach((s, si) => {
      for (let k = 0; k < 5; k++) {
        const side = perpendicular(s.out, r);
        addLeaf(s.branch, s.t, s.pos, side.multiplyScalar(0.9).addScaledVector(s.out, 0.5), 0.055 + r() * 0.025, { jit: r() * 0.25, spur: si });
      }
    });
    this.leafData = leaves;
    const geo = createLeafGeometry();
    const mat = addSightClip(addWind(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 }), { amp: 0.035 }));
    const mesh = new THREE.InstancedMesh(geo, mat, leaves.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(leaves.length * 3), 3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'leaves';
    this.leaves = mesh;
    this.group.add(mesh);
  }

  // --------------------------------------------------------------- blossoms
  buildBlossoms() {
    const r = this.rand;
    const flowers = [];
    this.spurs.forEach((s, si) => {
      const p1 = perpendicular(s.out, r);
      const p2 = new THREE.Vector3().crossVectors(s.out, p1).normalize();
      for (let k = 0; k < 5; k++) {
        let axis;
        let lat = new THREE.Vector3();
        if (k === 0) {
          axis = s.out.clone().addScaledVector(UP, 0.6).normalize();
        } else {
          const a = ((k - 1) / 4) * Math.PI * 2 + r() * 0.5;
          lat = p1.clone().multiplyScalar(Math.cos(a)).addScaledVector(p2, Math.sin(a));
          axis = s.out.clone().multiplyScalar(0.5).addScaledVector(lat, 0.9).addScaledVector(UP, 0.45).normalize();
        }
        const R0 = perpendicular(axis, r);
        const R1 = new THREE.Vector3().crossVectors(axis, R0).normalize();
        flowers.push({
          spur: si,
          king: k === 0,
          lat,
          axis,
          R0,
          R1,
          offset: k === 0 ? 0 : 0.15 + r() * 0.85, // opening order within the cluster
          spin: r() * 6.28,
        });
      }
    });
    this.flowers = flowers;
    const petalGeo = createPetalGeometry();
    const petalMat = addWind(
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, emissive: 0x2a1a1e, emissiveIntensity: 0.25 }),
      { amp: 0.02, freq: 2.2 }
    );
    this.petals = new THREE.InstancedMesh(petalGeo, petalMat, flowers.length * 5);
    this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.petals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(flowers.length * 15), 3);
    this.petals.castShadow = true;
    this.petals.frustumCulled = false;
    this.petals.name = 'petals';
    this.group.add(this.petals);

    // closed flower buds: a rounded, slightly pointed bud that splits into petals as it opens
    const budGeo = new THREE.SphereGeometry(1, 14, 10);
    const bp = budGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      const k = y > 0 ? 1 - 0.35 * y * y : 1;
      bp.setXYZ(i, bp.getX(i) * k, y * 1.05 + 1.05, bp.getZ(i) * k);
    }
    budGeo.computeVertexNormals();
    this.buds = new THREE.InstancedMesh(budGeo, addWind(new THREE.MeshStandardMaterial({ roughness: 0.5 }), { amp: 0.01, freq: 2.2 }), flowers.length);
    this.buds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(flowers.length * 3), 3);
    this.buds.castShadow = true;
    this.buds.frustumCulled = false;
    this.buds.name = 'buds';
    this.group.add(this.buds);

    const stamenGeo = new THREE.IcosahedronGeometry(1, 1);
    stamenGeo.scale(1, 0.45, 1);
    this.stamens = new THREE.InstancedMesh(stamenGeo, new THREE.MeshStandardMaterial({ color: 0xf2dc6a, roughness: 0.8, emissive: 0x332a00 }), flowers.length);
    this.stamens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stamens.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(flowers.length * 3).fill(1), 3);
    this.stamens.frustumCulled = false;
    this.group.add(this.stamens);
  }

  // ------------------------------------------------------------------ fruit
  buildFruit() {
    const r = this.rand;
    const slots = [];
    this.spurs.forEach((s, si) => {
      const n = 2;
      for (let k = 0; k < n; k++) {
        const pos = s.pos.clone();
        const height = pos.y / this.matureHeight;
        const radial = Math.min(1, Math.hypot(pos.x, pos.z) / 2.4);
        const exposure = clamp(0.25 + 0.4 * height + 0.45 * radial + (r() - 0.5) * 0.2, 0.15, 1);
        let variety = this.variety;
        slots.push({
          spur: si,
          king: k === 0,
          rank: k === 0 ? r() * 0.55 : 0.4 + r() * 0.6,
          sizeF: (k === 0 ? 1.04 : 0.95) * (0.9 + r() * 0.2),
          exposure,
          seed: r(),
          lat: perpendicular(s.out, r).multiplyScalar(k === 0 ? 0 : 1),
          hangJit: new THREE.Vector3(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.5),
          spinAng: r() * Math.PI * 2,
          variety,
          scaffold: s.scaffold,
          id: 0,
        });
      }
    });
    slots.sort((a, b) => a.rank - b.rank);
    slots.forEach((s, i) => (s.id = i + 1));
    this.slots = slots;
    this.fruitInfo = slots.map(() => null);

    const geo = setAppleAttributes(createAppleGeometry(), slots.length);
    this.appleMat = createAppleMaterial();
    this.fruit = new THREE.InstancedMesh(geo, this.appleMat, slots.length);
    this.fruit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fruit.castShadow = true;
    this.fruit.receiveShadow = true;
    this.fruit.frustumCulled = false;
    this.fruit.name = 'fruit';
    this.group.add(this.fruit);

    const stemGeo = new THREE.CylinderGeometry(0.7, 1, 1, 5, 1);
    stemGeo.translate(0, 0.5, 0);
    this.stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.9 }), slots.length);
    this.stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stems.frustumCulled = false;
    this.group.add(this.stems);
    this.setVariety('gala');
  }

  setVariety(key) {
    this.variety = key;
    for (const s of this.slots) {
      if (key === 'family') s.variety = s.scaffold === 1 || s.scaffold === 3 || (s.scaffold === -1 && s.seed > 0.5) ? 'golden' : 'gala';
      else s.variety = key;
    }
    this.lastKey = '';
  }

  // ------------------------------------------------------------------ update
  update(state, cond, varietyKey, metricsFor) {
    const p = state.pheno;
    const yearFrac = state.year;
    const key = `${state.absDay.toFixed(2)}|${state.dims.height.toFixed(4)}|${state.fruitOnTree}|${varietyKey}|${this.picked.size}|${JSON.stringify(cond)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = state.growth;
    const visible = state.year >= 1;
    this.group.visible = visible;
    if (!visible) return;

    const S = state.dims.height / this.matureHeight;
    this.scale = S;
    this.group.scale.setScalar(S);
    const inv = 1 / S;

    // branch growth transforms (parents always precede children)
    for (const b of this.branches) {
      b.f = b.depth === 0 ? 1 : smoothstep(b.birth, b.birth + b.dur, g);
      const sf = b.f;
      if (b.parent < 0) {
        b.s = sf;
        b.t.copy(b.pts[0]).multiplyScalar(1 - sf);
      } else {
        const par = this.branches[b.parent];
        b.s = par.s * sf;
        b.t.copy(b.pts[0]).multiplyScalar(par.s * (1 - sf)).add(par.t);
      }
    }
    const pos = this.bark.geometry.attributes.position;
    const arr = pos.array;
    const rest = this.barkRest;
    const bi = this.barkBranch;
    for (let i = 0, n = bi.length; i < n; i++) {
      const b = this.branches[bi[i]];
      const s = b.s;
      arr[i * 3] = rest[i * 3] * s + b.t.x;
      arr[i * 3 + 1] = rest[i * 3 + 1] * s + b.t.y;
      arr[i * 3 + 2] = rest[i * 3 + 2] * s + b.t.z;
    }
    pos.needsUpdate = true;

    this.updateLeaves(state, inv, g);
    const bearing = state.bearing;
    this.updateBlossoms(state, inv, bearing);
    this.updateFruit(state, cond, inv, bearing, metricsFor);
  }

  tx(branchIndex, v, out) {
    const b = this.branches[branchIndex];
    return out.copy(v).multiplyScalar(b.s).add(b.t);
  }

  updateLeaves(state, inv, g) {
    const p = state.pheno;
    const ls = leafState(state.doy, p);
    const mesh = this.leaves;
    const colors = mesh.instanceColor.array;
    const leafDensity = lerp(0.3, 1, smoothstep(0, 0.35, g));
    const seasonGreen = smoothstep(p.greenTip, p.fruitSet + 25, state.doy);
    let count = 0;
    for (let i = 0; i < this.leafData.length; i++) {
      const L = this.leafData[i];
      const b = this.branches[L.branch];
      let vis = ls.amount > 0 && b.f > 0.02 && b.f >= L.t * 0.9 && L.fallAt > ls.fall;
      if (L.spur >= 0 && !state.bearing && g < 0.85) vis = false;
      if (L.keep > leafDensity) vis = false;
      // lower trunk becomes bare as the tree matures
      if (L.lower > 0 && L.lower < 0.33 && g > 0.12) vis = false;
      if (!vis) {
        mesh.setMatrixAt(i, ZERO);
        continue;
      }
      const e = smoothstep(L.jit * 0.45, L.jit * 0.45 + 0.55, ls.emerge);
      const sc = L.size * VIS.leaf * inv * Math.max(0.05, e * (0.3 + 0.7 * e));
      this.tx(L.branch, L.pos, _v);
      _s.setScalar(sc);
      _m.compose(_v, L.q, _s);
      mesh.setMatrixAt(i, _m);
      count++;
      _c.copy(LEAF_YOUNG).lerp(LEAF_SUMMER, seasonGreen * (0.6 + 0.4 * e));
      const ac = smoothstep(L.fallAt * 0.6, L.fallAt * 0.6 + 0.4, ls.color);
      if (ac > 0) _c.lerp(LEAF_AUTUMN[L.hue], ac);
      colors[i * 3] = _c.r * L.tone;
      colors[i * 3 + 1] = _c.g * L.tone;
      colors[i * 3 + 2] = _c.b * L.tone;
    }
    this.visibleLeaves = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  flowerState(f, doy, p) {
    // returns { show, bud, spread, open, petals, color }
    const preBloom = doy < p.petalFall + 6;
    const nextYearBuds = doy > p.leafFall;
    if (!preBloom && !nextYearBuds) return null;
    if (nextYearBuds) return { bud: 0.32, spread: 0, open: 0, petals: 1, color: BUD_BROWN, stamen: 0 };
    const bud = lerp(0.32, 1, smoothstep(p.silverTip - 6, p.pinkBud + 2, doy));
    const spread = smoothstep(p.tightCluster - 4, p.pinkBud + 3, doy);
    const openStart = p.firstBloom + f.offset * (p.fullBloom + 2 - p.firstBloom);
    const open = smoothstep(openStart, openStart + 2.5, doy);
    const dropStart = p.petalFall - 4 + f.offset * 5;
    const petals = 1 - smoothstep(dropStart, dropStart + 2.5, doy);
    _c.copy(BUD_BROWN)
      .lerp(BUD_SILVER, smoothstep(p.silverTip - 3, p.silverTip + 4, doy))
      .lerp(BUD_GREEN, smoothstep(p.greenTip, p.tightCluster, doy))
      .lerp(BUD_PINK, smoothstep(p.tightCluster + 3, p.pinkBud + 2, doy))
      .lerp(PETAL_OPEN, open)
      .lerp(PETAL_OLD, smoothstep(openStart + 3, openStart + 8, doy));
    return { bud, spread, open, petals, color: _c, stamen: open * (petals > 0.01 ? 1 : 0) };
  }

  updateBlossoms(state, inv, bearing) {
    const p = state.pheno;
    const doy = state.doy;
    const petals = this.petals;
    const pcol = petals.instanceColor.array;
    const st = this.stamens;
    const showAny = bearing;
    this.flowerStates = this.flowerStates || new Array(this.flowers.length);
    for (let fi = 0; fi < this.flowers.length; fi++) {
      const f = this.flowers[fi];
      const fs = showAny ? this.flowerState(f, doy, p) : null;
      this.flowerStates[fi] = fs ? { open: fs.open, petals: fs.petals, bud: fs.bud } : null;
      if (!fs || fs.petals <= 0.001) {
        for (let j = 0; j < 5; j++) petals.setMatrixAt(fi * 5 + j, ZERO);
        st.setMatrixAt(fi, ZERO);
        this.buds.setMatrixAt(fi, ZERO);
        continue;
      }
      const s = this.spurs[f.spur];
      const size = VIS.flower * inv;
      // centre of the flower in tree space
      this.tx(s.branch, s.pos, _v);
      _v.addScaledVector(s.out, 0.008 * size).addScaledVector(f.lat, 0.028 * fs.spread * size).addScaledVector(f.axis, 0.012 * fs.spread * size);
      // the closed bud shrinks away as the petals unfold out of it
      const budR = (0.0016 + 0.0026 * fs.bud) * size;
      const budS = budR * (1 - smoothstep(0.05, 0.55, fs.open));
      if (budS > 1e-5) {
        _q.setFromUnitVectors(UP, f.axis);
        _m.compose(_v, _q, _s.setScalar(budS));
        this.buds.setMatrixAt(fi, _m);
        this.buds.setColorAt(fi, fs.color);
      } else this.buds.setMatrixAt(fi, ZERO);
      const unfold = smoothstep(0.02, 0.35, fs.open);
      const petalLen = (0.006 + 0.01 * fs.open) * size * Math.max(0.3, fs.petals) * unfold;
      const tilt = lerp(0.45, 1.32, fs.open) + (1 - fs.petals) * 0.4;
      for (let j = 0; j < 5; j++) {
        const a = f.spin + (j * Math.PI * 2) / 5;
        const R = _v2.copy(f.R0).multiplyScalar(Math.cos(a)).addScaledVector(f.R1, Math.sin(a));
        const Y = _v3.copy(f.axis).multiplyScalar(Math.cos(tilt)).addScaledVector(R, Math.sin(tilt));
        const Z = new THREE.Vector3().copy(f.axis).multiplyScalar(Math.sin(tilt)).addScaledVector(R, -Math.cos(tilt));
        const X = new THREE.Vector3().crossVectors(Y, Z);
        _m.makeBasis(X.multiplyScalar(petalLen), Y.clone().multiplyScalar(petalLen), Z.multiplyScalar(petalLen));
        _m.setPosition(_v.x + R.x * 0.0015 * size, _v.y + R.y * 0.0015 * size, _v.z + R.z * 0.0015 * size);
        petals.setMatrixAt(fi * 5 + j, _m);
        const k = (fi * 5 + j) * 3;
        pcol[k] = fs.color.r;
        pcol[k + 1] = fs.color.g;
        pcol[k + 2] = fs.color.b;
      }
      if (fs.stamen > 0.01) {
        const ss = 0.0045 * size * fs.stamen;
        _q.setFromUnitVectors(UP, f.axis);
        _s.set(ss, ss, ss);
        _v.addScaledVector(f.axis, 0.002 * size);
        _m.compose(_v, _q, _s);
        st.setMatrixAt(fi, _m);
      } else st.setMatrixAt(fi, ZERO);
    }
    petals.instanceMatrix.needsUpdate = true;
    petals.instanceColor.needsUpdate = true;
    st.instanceMatrix.needsUpdate = true;
    this.buds.instanceMatrix.needsUpdate = true;
    if (this.buds.instanceColor) this.buds.instanceColor.needsUpdate = true;
    petals.boundingSphere = null;
    this.buds.boundingSphere = null;
  }

  updateFruit(state, cond, inv, bearing, metricsFor) {
    const mesh = this.fruit;
    const stems = this.stems;
    const geo = mesh.geometry;
    const aGround = geo.attributes.aGround.array;
    const aBlush = geo.attributes.aBlush.array;
    const aSeed = geo.attributes.aSeed.array;
    const n = bearing && state.fruit ? state.fruitOnTree : 0;
    const base = state.fruit;
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (i >= n || this.picked.has(i) || !base) {
        mesh.setMatrixAt(i, ZERO);
        stems.setMatrixAt(i, ZERO);
        this.fruitInfo[i] = null;
        continue;
      }
      const m = metricsFor(sl.variety);
      const v = VARIETIES[sl.variety];
      const diam = m.diam * sl.sizeF;
      const spur = this.spurs[sl.spur];
      const size = VIS.fruit * inv;
      const rad = (diam / 2000) * size;
      const stemL = (0.008 + 0.016 * smoothstep(4, 30, diam)) * size;
      // young fruitlets stand upright, then hang as they gain weight
      const hang = smoothstep(14, 38, diam);
      const down = _v2.set(0, -1, 0).addScaledVector(spur.out, 0.35).add(sl.hangJit).normalize();
      const upDir = _v3.copy(spur.out).addScaledVector(UP, 0.8).normalize();
      const dir = new THREE.Vector3().lerpVectors(upDir, down, hang).normalize();
      this.tx(spur.branch, spur.pos, _v);
      _v.addScaledVector(sl.lat, 0.022 * size);
      const stemBase = _v.clone();
      _v.addScaledVector(dir, stemL + rad * 0.78);
      _q.setFromUnitVectors(UP, dir.clone().negate());
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, sl.spinAng));
      const elong = lerp(1.22, 0.93, smoothstep(4, 40, diam));
      _s.set(rad, rad * elong, rad);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
      // stem from spur down to the apple's cavity
      const sr = 0.0012 * size;
      _q.setFromUnitVectors(UP, dir.clone().negate());
      _m.compose(_v.clone().addScaledVector(dir, -rad * 0.62), _q, _s.set(sr, stemL + rad * 0.2, sr));
      stems.setMatrixAt(i, _m);

      // skin colours
      const gc = _c.copy(FRUITLET).lerp(srgb(...v.ground), m.yellowing * 0.9);
      aGround[i * 3] = gc.r;
      aGround[i * 3 + 1] = gc.g;
      aGround[i * 3 + 2] = gc.b;
      const bc = srgb(...v.blushColor);
      const blush = clamp(m.blush * Math.pow(sl.exposure, 0.6) * 1.15);
      aBlush[i * 4] = bc.r;
      aBlush[i * 4 + 1] = bc.g;
      aBlush[i * 4 + 2] = bc.b;
      aBlush[i * 4 + 3] = blush;
      aSeed[i] = sl.seed;
      this.fruitInfo[i] = {
        id: sl.id,
        variety: sl.variety,
        king: sl.king,
        exposure: sl.exposure,
        diam,
        weight: 0.374 * Math.pow(diam / 10, 3),
        brix: m.brix + (sl.exposure - 0.6) * 1.1,
        starch: m.starch,
        firmness: m.firmness - (sl.exposure - 0.6) * 0.8,
        blush,
        dafb: m.dafb,
        worldRadius: rad * this.scale,
      };
    }
    mesh.instanceMatrix.needsUpdate = true;
    stems.instanceMatrix.needsUpdate = true;
    geo.attributes.aGround.needsUpdate = true;
    geo.attributes.aBlush.needsUpdate = true;
    geo.attributes.aSeed.needsUpdate = true;
    mesh.boundingSphere = null;
  }

  // world-space position of a fruit instance (for camera focus / halo)
  fruitWorldPosition(i, out = new THREE.Vector3()) {
    this.fruit.getMatrixAt(i, _m);
    out.setFromMatrixPosition(_m);
    return this.fruit.localToWorld(out);
  }

  flowerWorldPosition(fi, out = new THREE.Vector3()) {
    this.petals.getMatrixAt(fi * 5, _m);
    if (_m.elements[0] === 0 && _m.elements[5] === 0 && _m.elements[10] === 0) this.buds.getMatrixAt(fi, _m);
    out.setFromMatrixPosition(_m);
    return this.petals.localToWorld(out);
  }

  spurWorldPositions() {
    return this.spurs.map((s) => this.group.localToWorld(this.tx(s.branch, s.pos, new THREE.Vector3())));
  }
}
