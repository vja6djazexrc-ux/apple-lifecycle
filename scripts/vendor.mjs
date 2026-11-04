// Copies the Three.js runtime files the app needs into ./vendor so the site
// runs from any static host without npm install or a CDN.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/three');
const out = join(root, 'vendor/three');
const files = [
  ['build/three.module.js', 'three.module.js'],
  ['build/three.core.js', 'three.core.js'],
  ['examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'],
  ['LICENSE', 'LICENSE'],
];
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(src, from), join(out, to));
  console.log('vendored', to);
}
