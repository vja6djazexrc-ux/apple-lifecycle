// Zero-dependency static server: `node serve.mjs [port]`.
// Prints a localhost URL plus LAN URLs that other devices on the same network can open.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
// only the app's own files are served
const allowed = ['index.html', 'css/', 'src/', 'vendor/', 'assets/', 'dist/'];

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const rel = normalize(path).replace(/^([/\\])+/, '');
    if (rel.includes('..') || !allowed.some((a) => rel === a || rel.startsWith(a))) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' });
    const file = join(root, rel);
    const info = await stat(file);
    if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  console.log('\n  🍎 Apple Lifecycle simulator is running\n');
  console.log(`  Local:    http://localhost:${port}/`);
  if (host === '0.0.0.0') {
    for (const list of Object.values(networkInterfaces()))
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Network:  http://${n.address}:${port}/   (share with devices on your Wi-Fi/LAN)`);
  }
  console.log('\n  Press Ctrl+C to stop.\n');
});
