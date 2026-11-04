import * as THREE from 'three';
import { rng, addWind, canvasTexture, createLeafGeometry, createPetalGeometry, NOISE_GLSL, windUniforms, VIS } from './shared.js';
import { createAppleGeometry, createAppleMaterial, setAppleAttributes } from './apple.js';
import { smoothstep, clamp, lerp, leafState, VARIETIES } from '../model.js';

const c = (hex) => new THREE.Color(hex);

// Season palettes, keyed by a continuous "season phase" so colours blend.
const SKY = {
  winter: { top: c(0x7d98b5), horizon: c(0xd9dee4), ground: c(0xe8ecef), sun: c(0xfff1de), sunI: 1.6, hemi: 0.75, fog: [30, 150] },
  spring: { top: c(0x4f8fd6), horizon: c(0xcfe3f2), ground: c(0x86a35a), sun: c(0xfff4e0), sunI: 2.6, hemi: 0.85, fog: [40, 190] },
  summer: { top: c(0x3a7fd4), horizon: c(0xbcd8ef), ground: c(0x6f8f3a), sun: c(0xfff2d6), sunI: 3.1, hemi: 0.8, fog: [45, 200] },
  autumn: { top: c(0x6f93bd), horizon: c(0xe6d7bf), ground: c(0x9a8a4c), sun: c(0xffe1b8), sunI: 2.3, hemi: 0.8, fog: [35, 170] },
};
const GRASS = {
  winter: c(0x8a8a5c),
  spring: c(0x6fa83a),
  summer: c(0x5c8f2c),
  autumn: c(0x8c8a3e),
};

export function seasonWeights(doy) {
  // smooth weights for winter/spring/summer/autumn centred on mid-season
  const centers = { winter: 15, spring: 120, summer: 205, autumn: 290 };
  const w = {};
  let sum = 0;
  for (const [k, ctr] of Object.entries(centers)) {
    let d = Math.abs(doy - ctr);
    d = Math.min(d, 365 - d);
    w[k] = Math.max(0, 1 - d / 95);
    w[k] = w[k] * w[k];
    sum += w[k];
  }
  for (const k in w) w[k] /= sum || 1;
  return w;
}

function blend(weights, pick) {
  const out = new THREE.Color(0, 0, 0);
  for (const [k, w] of Object.entries(weights)) out.add(pick(k).clone().multiplyScalar(w));
  return out;
}
function blendN(weights, pick) {
  let v = 0;
  for (const [k, w] of Object.entries(weights)) v += pick(k) * w;
  return v;
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.rand = rng(99);
    this.time = 0;
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildGrass();
    this.buildOrchard();
    this.buildParticles();
    this.buildGroundCover();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envKey = '';
  }

  buildSky() {
    this.skyUniforms = {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0.5, 0.6, 0.4).normalize() },
      sunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      cloud: { value: 0.4 },
      uTime: windUniforms.uTime,
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float cloud; uniform float uTime;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, -0.08, h));
          float sd = max(0.0, dot(d, normalize(sunDir)));
          col += sunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 18.0) * 0.18);
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.18);
            float n = vnoise(vec3(uv * 1.3 + vec2(uTime * 0.004, 0.0), 1.0)) * 0.6 + vnoise(vec3(uv * 3.1, 2.0)) * 0.3 + vnoise(vec3(uv * 7.0, 3.0)) * 0.1;
            float cl = smoothstep(1.0 - cloud * 0.75, 1.05 - cloud * 0.3, n) * smoothstep(0.0, 0.18, h);
            col = mix(col, mix(vec3(1.0), horizon, 0.25), cl * 0.85);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xcfe3f2, 40, 190);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6f8f3a, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -7;
    sc.right = 7;
    sc.top = 9;
    sc.bottom = -3;
    sc.near = 1;
    sc.far = 40;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
  }

  buildGround() {
    const r = rng(5);
    const grassTex = canvasTexture(
      512,
      512,
      (g, w, h) => {
        g.fillStyle = '#7f7f7f';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 26000; i++) {
          const v = 90 + r() * 110;
          g.fillStyle = `rgba(${v},${v},${v},0.5)`;
          const x = r() * w;
          const y = r() * h;
          g.fillRect(x, y, 1, 2 + r() * 5);
        }
      },
      { repeat: [60, 60] }
    );
    this.groundUniforms = {
      grass: { value: new THREE.Color(0x5c8f2c) },
      soil: { value: new THREE.Color(0x6a5238) },
      snow: { value: 0 },
      cutaway: { value: 0 },
      cutSize: { value: 0.32 },
      straw: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.groundUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorld; uniform vec3 grass; uniform vec3 soil; uniform float snow; uniform float cutaway; uniform float cutSize; uniform float straw;
          ${NOISE_GLSL}`
        )
        .replace(
          '#include <map_fragment>',
          `
          if (cutaway > 0.5 && vWorld.x > 0.0 && vWorld.z > 0.0 && vWorld.x < cutSize && vWorld.z < cutSize) discard;
          vec4 texel = texture2D(map, vMapUv);
          float n = vnoise(vec3(vWorld.xz * 0.35, 0.0)) * 0.6 + vnoise(vec3(vWorld.xz * 1.7, 4.0)) * 0.4;
          vec3 g = grass * (0.75 + 0.5 * n) * (0.7 + 0.6 * texel.r);
          g = mix(g, vec3(0.62, 0.55, 0.32) * (0.8 + 0.4 * texel.r), straw * smoothstep(0.35, 0.75, n));
          // bare-soil strip along each orchard row (reference 1 background)
          float row = abs(mod(vWorld.x + 3.0, 6.0) - 3.0);
          float strip = 1.0 - smoothstep(0.55, 0.95 + 0.25 * n, row);
          float nearTree = 1.0 - smoothstep(0.25, 0.7, length(vWorld.xz));
          strip = max(strip * 0.85, nearTree);
          vec3 s = soil * (0.7 + 0.5 * vnoise(vec3(vWorld.xz * 6.0, 1.0))) * (0.8 + 0.3 * texel.r);
          vec3 col = mix(g, s, strip);
          float sn = smoothstep(0.0, 1.0, snow * 1.3 - n * 0.35);
          float drift = vnoise(vec3(vWorld.xz * 2.2, 7.0)) * 0.6 + vnoise(vec3(vWorld.xz * 13.0, 9.0)) * 0.3 + vnoise(vec3(vWorld.xz * 60.0, 2.0)) * 0.1;
          vec3 snowCol = mix(vec3(0.7, 0.76, 0.86), vec3(0.97, 0.98, 1.0), drift) * (0.92 + 0.08 * texel.r);
          col = mix(col, snowCol, sn);
          diffuseColor.rgb *= col;
          `
        );
    };
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground);
  }

  buildGrass() {
    const r = rng(17);
    const blade = new THREE.PlaneGeometry(0.03, 0.22, 1, 3);
    blade.translate(0, 0.11, 0);
    const pos = blade.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 0.22;
      pos.setX(i, pos.getX(i) * (1 - y * 0.9));
      pos.setZ(i, y * y * 0.05);
    }
    blade.computeVertexNormals();
    const count = 26000;
    const mat = addWind(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), { amp: 0.25, freq: 1.3 });
    const mesh = new THREE.InstancedMesh(blade, mat, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.grassData = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = 0.4 + Math.pow(r(), 0.7) * 16;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const row = Math.abs((((x + 3) % 6) + 6) % 6 - 3);
      if (row < 0.7 && r() < 0.85) {
        i--;
        continue;
      }
      this.grassData.push({ x, z, h: 0.6 + r() * 0.9, rot: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.5, tone: 0.75 + r() * 0.45 });
    }
    this.grass = mesh;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.grassHeight = -1;
    this.grassColorKey = '';
  }

  updateGrass(height, color, dry) {
    const mesh = this.grass;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    if (Math.abs(height - this.grassHeight) > 0.01) {
      this.grassHeight = height;
      this.grassData.forEach((g, i) => {
        e.set(g.tilt, g.rot, 0);
        q.setFromEuler(e);
        const hh = g.h * height;
        s.set(hh < 0.08 ? 0 : 1, Math.max(0.001, hh), hh < 0.08 ? 0 : 1);
        p.set(g.x, 0, g.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    const key = color.getHexString() + dry.toFixed(2);
    if (key !== this.grassColorKey) {
      this.grassColorKey = key;
      const arr = mesh.instanceColor.array;
      const dryC = new THREE.Color(0.62, 0.55, 0.3);
      const tmp = new THREE.Color();
      this.grassData.forEach((g, i) => {
        tmp.copy(color).multiplyScalar(g.tone);
        if (g.tone > 1.05) tmp.lerp(dryC, dry);
        arr[i * 3] = tmp.r;
        arr[i * 3 + 1] = tmp.g;
        arr[i * 3 + 2] = tmp.b;
      });
      mesh.instanceColor.needsUpdate = true;
    }
  }

  buildOrchard() {
    // background rows of mature trees, as in reference 3
    const r = rng(23);
    const positions = [];
    for (let row = -4; row <= 4; row++) {
      for (let k = -9; k <= 9; k++) {
        if (row === 0 && Math.abs(k) < 1) continue;
        const x = row * 6 + (r() - 0.5) * 0.4;
        const z = k * 5 + (row % 2 ? 2.5 : 0) + (r() - 0.5) * 0.6;
        if (Math.hypot(x, z) < 5) continue;
        positions.push({ x, z, s: 0.8 + r() * 0.35, rot: r() * 6.28 });
      }
    }
    this.orchardTrees = positions;
    // trunk + bare limbs merged into one geometry
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.09, 0.14, 1.3, 7);
    trunk.translate(0, 0.65, 0);
    parts.push(trunk);
    for (let i = 0; i < 5; i++) {
      const limb = new THREE.CylinderGeometry(0.02, 0.06, 2.4, 5);
      limb.translate(0, 1.2, 0);
      limb.rotateZ(0.6 + r() * 0.3);
      limb.rotateY((i / 5) * Math.PI * 2 + r());
      limb.translate(0, 1.2, 0);
      parts.push(limb);
    }
    const trunkGeo = mergeGeometries(parts);
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x5d5046, roughness: 1 });
    this.orchardTrunks = new THREE.InstancedMesh(trunkGeo, barkMat, positions.length);
    // canopy: a cluster of lumpy blobs gives a leafy, irregular silhouette
    const blobParts = [];
    for (let i = 0; i < 24; i++) {
      const rad = 0.42 + r() * 0.35;
      const g = new THREE.IcosahedronGeometry(rad, 1);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, j);
        v.multiplyScalar(0.9 + 0.18 * Math.sin(v.x * 9 + i) * Math.cos(v.z * 7 + v.y * 5));
        p.setXYZ(j, v.x, v.y, v.z);
      }
      const a = r() * Math.PI * 2;
      const u = Math.pow(r(), 0.6);
      const h = 1.9 + r() * 1.7;
      const spread = 1.9 * (1 - Math.pow((h - 1.9) / 1.9, 2) * 0.6);
      g.translate(Math.cos(a) * u * spread, h, Math.sin(a) * u * spread);
      blobParts.push(g);
    }
    const canopyGeo = mergeGeometries(blobParts);
    this.canopyMat = new THREE.MeshStandardMaterial({ color: 0x3f6b24, roughness: 0.9, flatShading: false });
    this.canopyMat.onBeforeCompile = (shader) => {
      shader.uniforms.speckle = this.speckleU = this.speckleU || { value: new THREE.Vector4(1, 0.2, 0.2, 0) };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vP; uniform vec4 speckle;\n${NOISE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float leafy = vnoise(vP * 22.0) * 0.6 + vnoise(vP * 6.0) * 0.4;
          diffuseColor.rgb *= 0.55 + 0.75 * leafy;
          // dots of blossom / fruit across the canopy
          float dots = smoothstep(0.8, 0.86, vnoise(vP * 34.0 + 3.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, speckle.rgb, dots * speckle.a);`
        );
    };
    this.orchardCanopy = new THREE.InstancedMesh(canopyGeo, this.canopyMat, positions.length);
    this.orchardCanopy.castShadow = false;
    this.orchardCanopy.receiveShadow = true;
    const m = new THREE.Matrix4();
    positions.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, 0, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.rot, 0)), new THREE.Vector3(t.s, t.s, t.s));
      this.orchardTrunks.setMatrixAt(i, m);
      this.orchardCanopy.setMatrixAt(i, m);
    });
    this.scene.add(this.orchardTrunks, this.orchardCanopy);
  }

  buildParticles() {
    const r = rng(31);
    // snow
    const N = 2500;
    const sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      sp[i * 3] = (r() - 0.5) * 40;
      sp[i * 3 + 1] = r() * 14;
      sp[i * 3 + 2] = (r() - 0.5) * 40;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const flake = canvasTexture(32, 32, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, map: flake, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // falling petals and falling leaves share one tumbling-instance system each
    const mkFaller = (geo, mat, count, radius) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
      mesh.frustumCulled = false;
      const data = [];
      for (let i = 0; i < count; i++) {
        const a = r() * 6.28;
        const d = Math.sqrt(r()) * radius;
        data.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y0: 1 + r() * 3.5, phase: r() * 10, speed: 0.25 + r() * 0.35, spin: r() * 6.28, hue: r() });
      }
      this.scene.add(mesh);
      return { mesh, data, amount: 0 };
    };
    this.fallingPetals = mkFaller(createPetalGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }), 500, 2.6);
    this.fallingLeaves = mkFaller(createLeafGeometry(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 }), 260, 2.6);
  }

  buildGroundCover() {
    const r = rng(41);
    // leaf litter under the canopy after leaf fall
    const N = 1400;
    const geo = createLeafGeometry();
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), N);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    const m = new THREE.Matrix4();
    const cols = [new THREE.Color(0.75, 0.58, 0.14), new THREE.Color(0.7, 0.35, 0.08), new THREE.Color(0.45, 0.32, 0.12), new THREE.Color(0.55, 0.45, 0.18)];
    this.litterData = [];
    for (let i = 0; i < N; i++) {
      const a = r() * 6.28;
      const d = 0.2 + Math.pow(r(), 0.8) * 2.8;
      const s = 0.07 + r() * 0.04;
      this.litterData.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, 0.006 + r() * 0.01, Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (r() - 0.5) * 0.4, 0, r() * 6.28, 'YXZ')), new THREE.Vector3(s, s, s)), at: r() });
      const cc = cols[Math.floor(r() * cols.length)];
      mesh.instanceColor.setXYZ(i, cc.r, cc.g, cc.b);
    }
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.litter = mesh;
    this.scene.add(mesh);
    this.litterAmount = -1;

    // windfall apples on the grass at harvest time (reference 1 background)
    const AN = 36;
    const ageo = setAppleAttributes(createAppleGeometry(24), AN);
    this.fallen = new THREE.InstancedMesh(ageo, createAppleMaterial(), AN);
    this.fallen.castShadow = true;
    this.fallen.receiveShadow = true;
    this.fallen.frustumCulled = false;
    this.fallen.name = 'fallen';
    this.fallenData = [];
    for (let i = 0; i < AN; i++) {
      const a = r() * 6.28;
      const d = 0.6 + Math.sqrt(r()) * 2.4;
      this.fallenData.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, at: r(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 2 - 1 + Math.PI / 2, r() * 6.28, r() - 0.5)), seed: r(), sizeF: 0.9 + r() * 0.2, exposure: 0.4 + r() * 0.6, golden: r() < 0.5 });
      ageo.attributes.aSeed.array[i] = this.fallenData[i].seed;
    }
    ageo.attributes.aSeed.needsUpdate = true;
    this.scene.add(this.fallen);
    this.fallenInfo = [];
  }

  // ---------------------------------------------------------------- update
  update(state, cond, varietyKey, metricsFor, treeScale) {
    const doy = state.doy;
    const p = state.pheno;
    const w = seasonWeights(doy);
    const sky = this.skyUniforms;
    sky.top.value.copy(blend(w, (k) => SKY[k].top));
    sky.horizon.value.copy(blend(w, (k) => SKY[k].horizon));
    sky.bottom.value.copy(blend(w, (k) => SKY[k].ground));
    const cloudBase = blendN(w, (k) => ({ winter: 0.75, spring: 0.45, summer: 0.3, autumn: 0.55 })[k]);
    sky.cloud.value = clamp(cloudBase * (1.25 - 0.45 * (cond.sun / 100)), 0.05, 0.95);
    this.scene.fog.color.copy(sky.horizon.value);
    this.scene.fog.near = blendN(w, (k) => SKY[k].fog[0]);
    this.scene.fog.far = blendN(w, (k) => SKY[k].fog[1]);

    // sun elevation follows the season (solar noon at ~45°N)
    const decl = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365);
    const elev = THREE.MathUtils.degToRad(Math.max(14, 45 + decl * 0.9));
    const az = THREE.MathUtils.degToRad(-35);
    const dir = new THREE.Vector3(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az));
    sky.sunDir.value.copy(dir);
    this.sun.position.copy(dir).multiplyScalar(20);
    this.sun.target.position.set(0, 1.5, 0);
    const sunScale = clamp(0.55 + 0.45 * (cond.sun / 100), 0.4, 1.15);
    this.sun.intensity = blendN(w, (k) => SKY[k].sunI) * sunScale;
    this.sun.color.copy(blend(w, (k) => SKY[k].sun));
    this.hemi.color.copy(sky.top.value).lerp(new THREE.Color(1, 1, 1), 0.4);
    this.hemi.intensity = blendN(w, (k) => SKY[k].hemi);

    // snow cover: deep winter, less in a warmer climate
    const snowCover = clamp((1 - smoothstep(48, 78, doy) + smoothstep(338, 362, doy)) * (1 - cond.temp / 5));
    const droughtBrown = clamp((100 - cond.water) / 80) * smoothstep(150, 200, doy) * (1 - smoothstep(280, 320, doy));
    this.groundUniforms.snow.value = snowCover;
    this.groundUniforms.straw.value = clamp(w.winter * 0.6 + w.autumn * 0.35 + droughtBrown * 0.8);
    const grassCol = blend(w, (k) => GRASS[k]).lerp(new THREE.Color(0.6, 0.55, 0.3), droughtBrown * 0.6);
    this.groundUniforms.grass.value.copy(grassCol);
    const grassH = lerp(0.35, 1, smoothstep(85, 150, doy) * (1 - smoothstep(300, 340, doy))) * (1 - snowCover * 0.95);
    this.updateGrass(grassH, grassCol, clamp(w.autumn + w.winter * 0.5 + droughtBrown));
    this.groundUniforms.cutaway.value = state.year === 0 ? 1 : 0;

    // background orchard follows the same calendar as the main tree
    const ls = leafState(doy, p);
    const leafy = ls.amount;
    const canopyCol = new THREE.Color(0x8fb34a).lerp(new THREE.Color(0x3c6a22), smoothstep(p.fruitSet, p.fruitSet + 40, doy)).lerp(new THREE.Color(0xc0902a), ls.color);
    this.canopyMat.color.copy(canopyCol);
    const bloomAmt = smoothstep(p.pinkBud, p.firstBloom + 2, doy) * (1 - smoothstep(p.petalFall - 2, p.fruitSet, doy));
    const fruitAmt = smoothstep(p.cellDivEnd, p.ripening, doy) * (1 - smoothstep(p.harvest + 5, p.harvestEnd + 5, doy));
    if (this.speckleU) {
      const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
      const sc = bloomAmt > 0.01 ? lin(1, 0.92, 0.94).lerp(lin(0.92, 0.45, 0.6), 1 - smoothstep(p.pinkBud, p.firstBloom + 2, doy)) : lin(0.5, 0.65, 0.22).lerp(lin(0.72, 0.1, 0.08), smoothstep(p.ripening - 10, p.harvest, doy));
      this.speckleU.value.set(sc.r, sc.g, sc.b, Math.max(bloomAmt * 1.6, fruitAmt * 0.9));
    }
    this.canopyScale = Math.max(bloomAmt * 0.85, leafy);
    this.orchardCanopy.visible = this.canopyScale > 0.02;

    // particle intensities
    this.snowAmount = smoothstep(0.25, 0.9, snowCover) * (doy < 70 || doy > 340 ? 1 : 0);
    this.fallingPetals.amount = state.bearing ? smoothstep(p.petalFall - 5, p.petalFall, doy) * (1 - smoothstep(p.fruitSet - 4, p.fruitSet + 2, doy)) : 0;
    this.fallingLeaves.amount = state.year >= 1 ? Math.min(1, ls.fall * 4) * (1 - smoothstep(0.85, 1, ls.fall)) * Math.min(1, treeScale * 1.5) : 0;
    this.fallingLeaves.color = new THREE.Color(0.8, 0.6, 0.15);
    this.fallingRadius = Math.max(0.3, (state.dims.canopy || 1) * 0.55);

    // leaf litter
    const litter = state.year >= 1 ? Math.max(smoothstep(p.leafFall, p.leafFallEnd, doy), 1 - smoothstep(70, 112, doy)) * (1 - snowCover * 0.9) * Math.min(1, treeScale * 1.2) : 0;
    if (Math.abs(litter - this.litterAmount) > 0.005) {
      this.litterAmount = litter;
      const spread = Math.max(0.2, (state.dims.canopy || 1) / 4.3);
      const tmp = new THREE.Matrix4();
      const sm = new THREE.Matrix4().makeScale(spread, 1, spread);
      this.litterData.forEach((d, i) => {
        if (d.at < litter) {
          tmp.copy(d.m);
          const e = tmp.elements;
          e[12] *= spread;
          e[14] *= spread;
          this.litter.setMatrixAt(i, tmp);
        } else this.litter.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      });
      this.litter.instanceMatrix.needsUpdate = true;
    }

    // windfalls
    this.updateFallen(state, varietyKey, metricsFor);
  }

  updateFallen(state, varietyKey, metricsFor) {
    const p = state.pheno;
    const doy = state.doy;
    const amt = state.bearing ? smoothstep(p.harvest - 12, p.harvestEnd + 6, doy) * (1 - smoothstep(340, 352, doy)) : 0;
    const geo = this.fallen.geometry;
    const m = new THREE.Matrix4();
    this.fallenInfo = [];
    for (let i = 0; i < this.fallenData.length; i++) {
      const d = this.fallenData[i];
      if (d.at >= amt * 0.9 || !state.fruit) {
        this.fallen.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        this.fallenInfo[i] = null;
        continue;
      }
      const vk = varietyKey === 'family' ? (d.golden ? 'golden' : 'gala') : varietyKey;
      const met = metricsFor(vk);
      const v = VARIETIES[vk];
      const rad = (met.diam * d.sizeF) / 2000 * VIS.fruit;
      m.compose(new THREE.Vector3(d.x, rad * 0.86, d.z), d.q, new THREE.Vector3(rad, rad, rad));
      this.fallen.setMatrixAt(i, m);
      // windfalls bruise and brown as autumn goes on
      const age = smoothstep(p.harvestEnd, 345, doy);
      const ground = new THREE.Color().setRGB(...v.ground, THREE.SRGBColorSpace).lerp(new THREE.Color(0.3, 0.2, 0.08), age * 0.7);
      const blush = new THREE.Color().setRGB(...v.blushColor, THREE.SRGBColorSpace).lerp(new THREE.Color(0.25, 0.1, 0.05), age * 0.6);
      geo.attributes.aGround.setXYZ(i, ground.r, ground.g, ground.b);
      geo.attributes.aBlush.setXYZW(i, blush.r, blush.g, blush.b, clamp(met.blush * d.exposure * 1.1));
      this.fallenInfo[i] = { id: `W${i + 1}`, variety: vk, windfall: true, diam: met.diam * d.sizeF, weight: 0.374 * Math.pow((met.diam * d.sizeF) / 10, 3), brix: met.brix, starch: met.starch, firmness: met.firmness - 2 - age * 4, blush: met.blush * d.exposure, exposure: d.exposure, dafb: met.dafb, worldRadius: rad };
    }
    this.fallen.instanceMatrix.needsUpdate = true;
    geo.attributes.aGround.needsUpdate = true;
    geo.attributes.aBlush.needsUpdate = true;
    this.fallen.boundingSphere = null;
  }

  // hide background trees that would block the view of the main tree
  updateOrchard(camera, target) {
    const cs = this.canopyScale ?? 1;
    const key = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)},${target.x.toFixed(2)},${target.z.toFixed(2)},${cs.toFixed(3)}`;
    if (key === this.orchardKey) return;
    this.orchardKey = key;
    const m = this.orchardMatrix || (this.orchardMatrix = new THREE.Matrix4());
    const q = new THREE.Quaternion();
    const camXZ = new THREE.Vector2(camera.position.x, camera.position.z);
    const tXZ = new THREE.Vector2(target.x, target.z);
    const seg = tXZ.clone().sub(camXZ);
    const segLen2 = Math.max(1e-6, seg.lengthSq());
    const pt = new THREE.Vector2();
    this.orchardTrees.forEach((t, i) => {
      pt.set(t.x, t.z);
      const k = clamp(pt.clone().sub(camXZ).dot(seg) / segLen2, 0, 1);
      const d = pt.distanceTo(camXZ.clone().addScaledVector(seg, k));
      const nearCam = pt.distanceTo(camXZ);
      // fade trees on the sight line (or right next to the camera) so they never block the subject
      const block = k < 0.98 && camera.position.y < 9 ? (1 - smoothstep(2.2, 3.4, d)) : 0;
      const vis = Math.min(1 - block, smoothstep(1.5, 3, nearCam));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      const s = t.s * Math.max(0.0001, (0.35 + 0.65 * cs) * vis);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(s, t.s * (cs < 0.02 ? 0.0001 : 0.6 + 0.4 * cs) * vis + 0.0001, s));
      this.orchardCanopy.setMatrixAt(i, m);
      const ts = t.s * Math.max(0.0001, vis);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(ts, ts, ts));
      this.orchardTrunks.setMatrixAt(i, m);
    });
    this.orchardCanopy.instanceMatrix.needsUpdate = true;
    this.orchardTrunks.instanceMatrix.needsUpdate = true;
  }

  // per-frame animation
  animate(dt, camera, target) {
    this.time += dt;
    if (target) this.updateOrchard(camera, target);
    // snow
    const sp = this.snow.geometry.attributes.position;
    this.snow.visible = this.snowAmount > 0.01;
    if (this.snow.visible) {
      this.snow.material.opacity = 0.9 * this.snowAmount;
      for (let i = 0; i < sp.count; i++) {
        let y = sp.getY(i) - dt * (0.6 + (i % 7) * 0.08);
        let x = sp.getX(i) + Math.sin(this.time * 0.7 + i) * dt * 0.15;
        if (y < 0) y += 14;
        sp.setY(i, y);
        sp.setX(i, x);
      }
      sp.needsUpdate = true;
    }
    this.animateFaller(this.fallingPetals, dt, new THREE.Color(1, 0.95, 0.96), 0.024);
    this.animateFaller(this.fallingLeaves, dt, null, 0.09);
    // refresh environment reflections when the sky changes noticeably
    const key = this.skyUniforms.top.value.getHexString() + this.skyUniforms.horizon.value.getHexString();
    if (key !== this.envKey && this.time - (this.envTime || -10) > 0.6) {
      this.envKey = key;
      this.envTime = this.time;
      const envScene = new THREE.Scene();
      const skyClone = new THREE.Mesh(this.sky.geometry, this.sky.material);
      envScene.add(skyClone);
      const rt = this.pmrem.fromScene(envScene, 0.04);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.55;
    }
  }

  animateFaller(f, dt, color, size) {
    const mesh = f.mesh;
    const n = Math.floor(f.data.length * f.amount);
    mesh.count = n;
    mesh.visible = n > 0;
    if (!n) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const R = (this.fallingRadius || 2) / 2.6;
    const leafCols = [new THREE.Color(0.85, 0.65, 0.12), new THREE.Color(0.85, 0.45, 0.1), new THREE.Color(0.6, 0.45, 0.15)];
    for (let i = 0; i < n; i++) {
      const d = f.data[i];
      const cyc = (this.time * d.speed + d.phase) % 1;
      const y = d.y0 * R * 1.3 * (1 - cyc);
      p.set(d.x * R + Math.sin(this.time * 1.3 + d.phase) * 0.25 + cyc * 0.6, Math.max(0.01, y), d.z * R + Math.cos(this.time + d.phase) * 0.2);
      e.set(this.time * 2 + d.spin, this.time * 1.4 + d.phase, d.spin);
      q.setFromEuler(e);
      s.setScalar(size * (cyc > 0.97 ? (1 - cyc) / 0.03 : 1));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      const cc = color || leafCols[Math.floor(d.hue * 3)];
      mesh.setColorAt(i, cc);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}

// minimal geometry merge (positions/normals/uvs, non-indexed output)
export function mergeGeometries(geos) {
  const pos = [];
  const nor = [];
  const uv = [];
  for (let g of geos) {
    g = g.index ? g.toNonIndexed() : g;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (g.attributes.uv) uv.push(...g.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (uv.length === (pos.length / 3) * 2) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
