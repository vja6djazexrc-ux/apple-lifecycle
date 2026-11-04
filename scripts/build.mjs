// Builds dist/apple-lifecycle.html: one self-contained file (JS, CSS, Three.js
// and reference images inlined) that opens by double-click, with no server,
// and can be emailed, put on a shared drive, or dropped on any static host.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  alias: { 'three/addons': 'three/examples/jsm' },
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');

html = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace('<link rel="stylesheet" href="css/styles.css" />', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js}\n</script>`)
  .replace(/src="assets\/ref\/([^"]+)"/g, (_, f) => `src="data:image/jpeg;base64,${readFileSync(join(root, 'assets/ref', f)).toString('base64')}"`);

writeFileSync(join(out, 'apple-lifecycle.html'), html);
// index.html copy so the dist folder can be dropped on any static host as-is
writeFileSync(join(out, 'index.html'), html);
console.log(`dist/apple-lifecycle.html  ${(html.length / 1024).toFixed(0)} KB`);
