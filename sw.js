// Кэш: оболочка сайта сразу, остальное (тайлы, картинки) — по мере просмотра. Работает и при плохой связи.
const VERSION = 'troitsk-v24';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lib/maplibre-gl.js', 'lib/maplibre-gl.css',
  'lib/pmtiles.js', 'lib/basemaps.js', 'data/places.json', 'data/eras.json',
  'game.js', 'caravan.js', 'data/caravan.json', 'lib/mqtt.min.js', 'lib/qrcode.js', 'data/quiz.json', 'data/summary.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (/\/video\/.+\.mp4$/.test(new URL(req.url).pathname)) return;     // фильмы — напрямую из сети (большие, идут кусками)
  // .pmtiles читается кусками (Range): держим файл в кэше целиком и сами отдаём нужный кусок
  if (req.headers.has('range')) {
    if (!/\.(pmtiles|mp3)$/.test(new URL(req.url).pathname)) return;
    e.respondWith(rangeFromCache(req));
    return;
  }
  const fresh = /\.(html|js|css|json)$|\/$/.test(new URL(req.url).pathname);
  if (fresh) {
    // сначала сеть (чтобы обновления доходили), при отсутствии сети — кэш
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; })
      .catch(() => caches.match(req)));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
      return r;
    })));
  }
});

const bufs = new Map();      // файлы, читаемые кусками (карта, озвучка), в памяти воркера
function loadPm(url) {
  if (!bufs.has(url)) bufs.set(url, (async () => {
    const cache = await caches.open(VERSION);
    let r = await cache.match(url);
    if (!r) { r = await fetch(url); if (!r.ok) throw new Error('pmtiles ' + r.status); await cache.put(url, r.clone()); }
    return r.arrayBuffer();
  })().catch(err => { bufs.delete(url); throw err; }));
  return bufs.get(url);
}

async function rangeFromCache(req) {
  let buf;
  try { buf = await loadPm(req.url.split('#')[0]); } catch (err) { return fetch(req); }
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range'));
  const start = +m[1], end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1),
    'Content-Type': /\.mp3$/.test(req.url) ? 'audio/mpeg' : 'application/octet-stream', 'Accept-Ranges': 'bytes' } });
}
