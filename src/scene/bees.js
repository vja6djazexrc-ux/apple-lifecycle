import * as THREE from 'three';
import { rng, canvasTexture } from './shared.js';

// Honeybees that visit open blossoms during bloom; how many fly is tied to the
// pollinator-activity slider. Drawn about 2× life size so they are findable.
export class Bees {
  constructor(scene, max = 16) {
    this.group = new THREE.Group();
    this.group.name = 'bees';
    scene.add(this.group);
    const r = (this.rand = rng(51));
    const tex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#e0a526';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a1d0e';
      for (let i = 0; i < 4; i++) g.fillRect(0, h * (0.2 + i * 0.17), w, h * 0.08);
      g.fillRect(0, h * 0.86, w, h * 0.14);
    });
    const bodyGeo = new THREE.SphereGeometry(1, 12, 10);
    bodyGeo.scale(0.45, 1, 0.45);
    const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const wingGeo = new THREE.PlaneGeometry(0.7, 1.1);
    wingGeo.translate(0.38, 0, 0);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    this.bees = [];
    for (let i = 0; i < max; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const wl = new THREE.Mesh(wingGeo, wingMat);
      const wr = new THREE.Mesh(wingGeo, wingMat);
      wl.position.set(0.15, 0.15, 0.35);
      wr.position.set(-0.15, 0.15, 0.35);
      wr.rotation.y = Math.PI;
      b.add(body, wl, wr);
      b.scale.setScalar(0.012);
      b.visible = false;
      this.group.add(b);
      this.bees.push({ obj: b, wl, wr, from: new THREE.Vector3(), to: new THREE.Vector3(), t: r(), dur: 2 + r() * 3, phase: r() * 10, pos: new THREE.Vector3(0, 2, 0) });
    }
    this.targets = [];
    this.amount = 0;
    this.time = 0;
  }

  setTargets(points, amount) {
    this.targets = points;
    this.amount = amount;
  }

  animate(dt) {
    this.time += dt;
    const n = Math.round(this.bees.length * this.amount);
    const r = this.rand;
    this.bees.forEach((b, i) => {
      b.obj.visible = i < n && this.targets.length > 0;
      if (!b.obj.visible) return;
      b.t += dt / b.dur;
      if (b.t >= 1 || b.to.lengthSq() === 0) {
        b.t = 0;
        b.dur = 1.5 + r() * 3;
        b.from.copy(b.to.lengthSq() ? b.to : this.targets[Math.floor(r() * this.targets.length)]);
        b.to.copy(this.targets[Math.floor(r() * this.targets.length)]);
      }
      // fly most of the leg, then hover at the blossom
      const travel = Math.min(1, b.t / 0.6);
      const e = travel * travel * (3 - 2 * travel);
      const prev = b.pos.clone();
      b.pos.lerpVectors(b.from, b.to, e);
      b.pos.y += Math.sin(Math.PI * e) * 0.35 + 0.05;
      const w = this.time * 3 + b.phase;
      b.pos.x += Math.sin(w * 2.1) * 0.03;
      b.pos.y += Math.sin(w * 3.3) * 0.02;
      b.pos.z += Math.cos(w * 1.7) * 0.03;
      b.obj.position.copy(b.pos);
      const vel = b.pos.clone().sub(prev);
      if (vel.lengthSq() > 1e-8) {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vel.normalize());
        b.obj.quaternion.slerp(q, 0.25);
      }
      const flap = Math.sin(this.time * 80 + i) * 0.7;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    });
  }
}
