import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const files = (await readdir('dist/assets')).map(name => `/assets/${name}`);
const fontFiles = await readdir('dist/fonts').then(names => names.map(name => `/fonts/${name}`)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
const shell = await readFile('dist/index.html', 'utf8');
const assets = ['/index.html', '/favicon.svg', ...files, ...fontFiles, '/data-notices.html', '/data/transit-routes.geojson'];
// Data-only refreshes must install a new cache even if the JS and HTML are unchanged.
const hash = createHash('sha256').update(shell);
for (const path of [...assets].sort()) hash.update(path).update(await readFile(`dist${path}`));
const revision = hash.digest('hex').slice(0, 12);
await writeFile('dist/sw.js', `// Generated for this exact build. Caches dated static route data; never live feeds, board queries, or map tiles.
const CACHE = 'near-next-${revision}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('near-next-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/catalog/') || url.pathname.startsWith('/health/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html', { ignoreVary: true }))));
  } else if (ASSETS.includes(url.pathname)) {
    // Immutable local build files have identical bytes for every Origin. Dev/preview
    // hosts may attach Vary: Origin, unlike the install-time cache.addAll request.
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname, { ignoreVary: true })).then(cached => cached || fetch(event.request)));
  }
});
`);
console.log(`Offline shell generated: ${assets.length} local assets.`);
