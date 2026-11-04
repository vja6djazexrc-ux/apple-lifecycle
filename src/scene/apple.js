import * as THREE from 'three';
import { NOISE_GLSL } from './shared.js';

// Unit apple (max radius 1) from a lathe profile: broad shoulders, stem cavity
// on top, calyx basin underneath.
export function createAppleGeometry(segments = 40) {
  const pts = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * Math.PI; // 0 = bottom pole, PI = top pole
    let r = Math.sin(phi) * (1 - 0.1 * Math.cos(phi));
    let y = -Math.cos(phi) * 0.86;
    y += 0.11 * Math.exp(-Math.pow(phi / 0.27, 2)); // calyx basin
    y -= 0.2 * Math.exp(-Math.pow((Math.PI - phi) / 0.32, 2)); // stem cavity
    pts.push(new THREE.Vector2(Math.max(0, r), y));
  }
  const maxR = Math.max(...pts.map((p) => p.x));
  pts.forEach((p) => p.multiplyScalar(1 / maxR));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

// Physical apple skin. Per-instance attributes:
//   aGround (rgb background colour), aBlush (rgb blush colour + amount), aSeed
export function createAppleMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.42,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aGround; attribute vec4 aBlush; attribute float aSeed;
        varying vec3 vGround; varying vec4 vBlush; varying vec3 vObj; varying float vSeed;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGround = aGround; vBlush = aBlush; vObj = position; vSeed = aSeed;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGround; varying vec4 vBlush; varying vec3 vObj; varying float vSeed;
        ${NOISE_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = normalize(vObj);
          float ang = atan(p.z, p.x);
          vec3 cyl = vec3(cos(ang) * 7.0, sin(ang) * 7.0, p.y * 1.6 + vSeed * 13.0);
          float streak = vnoise(cyl) * 0.65 + vnoise(cyl * 2.3) * 0.35;
          float mott = vnoise(vObj * 3.2 + vSeed * 31.0);
          // blush builds up on the sun-facing side first
          float sunSide = 0.5 + 0.5 * dot(p, normalize(vec3(0.55, 0.45, 0.7)));
          float amt = vBlush.a;
          float field = sunSide * 0.7 + mott * 0.3;
          float cover = smoothstep(1.02 - amt * 1.15, 1.18 - amt * 1.15, field);
          vec3 blushCol = vBlush.rgb * mix(0.62, 1.12, streak);
          vec3 col = mix(vGround, blushCol, cover * mix(0.7, 1.0, streak));
          col = mix(col, vBlush.rgb * 0.7, smoothstep(0.85, 1.0, amt) * 0.5 * cover);
          // lenticels
          float len = smoothstep(0.88, 0.96, vnoise(vObj * 95.0 + vSeed * 7.0));
          col = mix(col, vec3(0.9, 0.82, 0.55), len * 0.35);
          // darker stem cavity and calyx basin
          float r = length(vObj.xz);
          col *= mix(0.55, 1.0, smoothstep(0.08, 0.32, r));
          diffuseColor.rgb = col;
        }`
      );
  };
  return mat;
}

// Per-instance skin attributes for an InstancedMesh of apples (each mesh needs
// its own geometry clone because the attributes live on the geometry).
export function setAppleAttributes(geo, count) {
  geo.setAttribute('aGround', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aBlush', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  return geo;
}
