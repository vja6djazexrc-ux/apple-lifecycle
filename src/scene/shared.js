import * as THREE from 'three';

// Real organs are small next to a 4 m tree; scale them up a little so they read
// from an orbiting camera. The inspector and charts always report true sizes.
export const VIS = { fruit: 1.35, flower: 1.3, leaf: 1.35, seed: 2.4 };

// Shared wind/time uniforms injected into several materials.
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

export function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

// Sight-line cut-away: while inspecting an object, foliage between the camera
// and the object is discarded so the object stays visible from any angle.
export const sightUniforms = {
  uSightOn: { value: 0 },
  uSightA: { value: new THREE.Vector3() },
  uSightB: { value: new THREE.Vector3() },
  uSightR: { value: 0.12 },
};

export function addSightClip(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, sightUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSightW;')
      .replace('mvPosition = viewMatrix * wpos;', 'mvPosition = viewMatrix * wpos;\n vSightW = wpos.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSightW; uniform float uSightOn; uniform vec3 uSightA; uniform vec3 uSightB; uniform float uSightR;')
      .replace(
        'void main() {',
        `void main() {
        if (uSightOn > 0.5) {
          vec3 ab = uSightB - uSightA;
          float t = clamp(dot(vSightW - uSightA, ab) / dot(ab, ab), 0.0, 1.0);
          float d = length(vSightW - (uSightA + ab * t));
          if (t < 0.96 && d < uSightR * (0.45 + 0.55 * t)) discard;
        }`
      );
  };
  return material;
}

// Adds a gentle wind sway to an instanced material. `amp` scales with the
// vertex's local height so leaf/petal bases stay attached.
export function addWind(material, { amp = 0.03, freq = 1.6, localAxis = 'y' } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;`)
      .replace(
        '#include <project_vertex>',
        `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        vec4 wpos = modelMatrix * mvPosition;
        float ph = dot(ip, vec3(1.7, 0.9, 1.3));
        float s = sin(uTime * ${freq.toFixed(2)} + ph) + 0.5 * sin(uTime * ${(freq * 2.3).toFixed(2)} + ph * 1.7);
        float k = clamp(position.${localAxis}, 0.0, 2.0) * ${amp.toFixed(4)} * uWind;
        wpos.xyz += vec3(s * k, 0.3 * s * k, 0.7 * cos(uTime * ${(freq * 0.8).toFixed(2)} + ph) * k);
        mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;
        `
      );
  };
  return material;
}

// Canvas texture helper
export function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function barkTexture() {
  const r = rng(7);
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#6b5a4a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = r() * w;
      const y = r() * h;
      const l = 20 + r() * 90;
      const shade = 60 + r() * 70;
      g.strokeStyle = `rgba(${shade + 20},${shade + 8},${shade - 8},${0.25 + r() * 0.35})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + (r() - 0.5) * 8, y + l * 0.3, x + (r() - 0.5) * 8, y + l * 0.6, x + (r() - 0.5) * 6, y + l);
      g.stroke();
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(40,30,22,${0.2 + r() * 0.3})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 10, 1 + r() * 2);
    }
    // lichen-grey patches as on old orchard trunks
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(150,150,130,${0.08 + r() * 0.1})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 6 + r() * 18, 4 + r() * 10, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// A serrated apple leaf: ovate blade with a gentle fold along the midrib.
export function createLeafGeometry() {
  const shape = new THREE.Shape();
  const N = 28;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = t;
    let w = Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.44 * (1 - 0.2 * t);
    if (i % 2 === 1 && t > 0.1 && t < 0.95) w *= 1.06; // serration
    pts.push([w, y]);
  }
  shape.moveTo(0, 0);
  for (const [x, y] of pts) shape.lineTo(x, y);
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
  const geo = new THREE.ShapeGeometry(shape, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, Math.abs(x) * 0.12 - y * y * 0.14); // slight midrib fold + droop
  }
  // petiole offset so the leaf hangs off its stalk
  geo.translate(0, 0.08, 0);
  geo.computeVertexNormals();
  return geo;
}

export function createPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.22, 0.12, 0.55, 0.55, 0.38, 0.88);
  shape.bezierCurveTo(0.25, 1.05, -0.25, 1.05, -0.38, 0.88);
  shape.bezierCurveTo(-0.55, 0.55, -0.22, 0.12, 0, 0);
  const geo = new THREE.ShapeGeometry(shape, 12);
  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, x * x * 1.5 + y * y * 0.18); // cupped
    // pink veining towards the edge, as in the blossom reference
    const edge = Math.min(1, Math.abs(x) / 0.5 + Math.max(0, y - 0.6) * 0.8);
    const c = new THREE.Color().setRGB(1, 1 - 0.28 * edge, 1 - 0.18 * edge, THREE.SRGBColorSpace);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
