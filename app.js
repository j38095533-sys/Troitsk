'use strict';
// Троицк сквозь время: карта → пролёт к точке → вид улицы со слайдером лет.

let OVERVIEW = { center: [61.556, 54.093], zoom: 13.2, pitch: 25, bearing: 0 };
const BOUNDS = [[61.45, 53.98], [61.70, 54.15]];

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const base = new URL('.', location.href).href;
const LABELS = ['roads_labels_minor', 'roads_labels_major', 'water_waterway_label', 'water_label_lakes',
  'places_subplace', 'places_locality'];
const labelLayers = basemaps.layers('pm', basemaps.namedFlavor('dark'), { lang: 'ru' })
  .filter(l => LABELS.includes(l.id));

const map = new maplibregl.Map({
  container: 'map',
  maxPitch: 85,
  maxBounds: [[61.35, 53.93], [61.80, 54.20]],
  minZoom: 10,
  ...OVERVIEW,
  attributionControl: { compact: true },
  hash: location.search.includes('debug'),
  style: {
    version: 8,
    glyphs: base + 'fonts/{fontstack}/{range}.pbf',
    sprite: base + 'sprites/light',
    sources: {
      sat: { type: 'raster', tiles: [base + 'sat/{z}/{x}/{y}.jpg'], tileSize: 256, minzoom: 8, maxzoom: 15,
        bounds: [61.45, 53.98, 61.70, 54.15],
        attribution: 'Спутник: <a href="https://s2maps.eu">Sentinel-2 cloudless 2023 by EOX</a> (Copernicus)' },
      pm: { type: 'vector', url: 'pmtiles://' + base + 'troitsk.pmtiles',
        attribution: '<a href="https://openstreetmap.org/copyright">© OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>' },
    },
    sky: { 'sky-color': '#9cc0e6', 'horizon-color': '#efe2cf', 'fog-color': '#d9cbb6',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.6, 'atmosphere-blend': 0.8 },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#3b3a2c' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.08 } },
      { id: 'roads', type: 'line', source: 'pm', 'source-layer': 'roads', minzoom: 13,
        filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road', 'minor_road', 'highway']]],
        paint: { 'line-color': '#f3e9dc', 'line-opacity': 0.35,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, 0.5, 18, 8] } },
      { id: 'buildings', type: 'fill-extrusion', source: 'pm', 'source-layer': 'buildings', minzoom: 14,
        paint: {
          'fill-extrusion-color': '#e6d3b3',
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 7],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.85],
        } },
      ...labelLayers,
    ],
  },
});
map.touchPitch.enable();

let places = [];
let eras = {};
const $ = id => document.getElementById(id);

Promise.all([
  fetch('data/places.json').then(r => r.json()),
  fetch('data/eras.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
]).then(([p, e]) => {
  places = p; eras = e;
  // стартовый вид: все точки на экране любого телефона
  const b = new maplibregl.LngLatBounds();
  places.forEach(pl => b.extend(pl.pos));
  const fit = map.cameraForBounds(b, { padding: { top: 120, bottom: 130, left: 90, right: 90 } });
  if (fit) { OVERVIEW = { center: fit.center, zoom: Math.min(fit.zoom, 15), pitch: 0, bearing: 0 }; map.jumpTo(OVERVIEW); }
  map.on('load', addPins);
  if (map.loaded()) addPins();
});

let pinsAdded = false;
function addPins() {
  if (pinsAdded) return; pinsAdded = true;
  for (const pl of places) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.innerHTML = `<div class="pin-label">${pl.title}</div>`;
    el.addEventListener('click', ev => { ev.stopPropagation(); flyToPlace(pl); });
    new maplibregl.Marker({ element: el }).setLngLat(pl.pos).addTo(map);
  }
}

// ---- пролёт: с высоты птичьего полёта → плавный наклон до горизонта улицы ----
let busy = false, current = null;
function flyToPlace(pl) {
  if (busy) return; busy = true; current = pl;
  document.body.classList.add('in-street');
  map.flyTo({ center: pl.pos, zoom: 16.2, pitch: 50, bearing: pl.heading, duration: 2600, curve: 1.5,
    essential: true });
  map.once('moveend', () => {
    // камера ровно в точке обзора на улице (высота глаз ~15 м), взгляд на здание
    const cam = map.calculateCameraOptionsFromTo(
      maplibregl.LngLat.convert(pl.cam), pl.eye || 15, maplibregl.LngLat.convert(pl.pos), pl.target || 8);
    map.easeTo({ ...cam, pitch: Math.min(cam.pitch, 84), duration: 2400,
      easing: t => 1 - Math.pow(1 - t, 3), essential: true });
    map.once('moveend', () => { openStreet(pl); busy = false; });
  });
}

const origOf = e => e.photo && e.photo.file ? 'img/orig/' + e.photo.file.replace(/\.[a-z]+$/i, '') + '.webp' : null;

function openStreet(pl) {
  const list = (eras[pl.id] || []).slice().sort((a, b) => a.year - b.year);
  const frames = $('frames'); frames.innerHTML = '';
  $('place-title').textContent = pl.title;
  $('place-intro').textContent = pl.intro || '';
  const slider = $('slider'), ticks = $('ticks');
  ticks.innerHTML = '';
  if (!list.length) list.push({ year: 'скоро', text: 'Материалы по этому месту готовятся.' });
  list.forEach(e => {
    const node = new Image();
    node.alt = `${pl.title}, ${e.label || e.year}`; node.decoding = 'async';
    node.onerror = () => {
      const ph = document.createElement('div'); ph.className = 'placeholder'; ph.textContent = 'Изображение этого года готовится';
      if (node.classList.contains('on')) ph.classList.add('on');
      node.replaceWith(ph);
    };
    node.src = e.img || `img/${pl.id}/${e.year}.webp`;
    frames.appendChild(node);
    const t = document.createElement('span'); t.textContent = e.label === 'Сегодня' ? 'сейчас' : (e.label || e.year); ticks.appendChild(t);
  });
  slider.max = list.length - 1; slider.value = list.length - 1;
  slider.disabled = list.length < 2;
  slider.oninput = () => showEra(list, +slider.value);
  showEra(list, list.length - 1);
  $('panel').scrollTop = 0;
  const s = $('street'); s.hidden = false;
  requestAnimationFrame(() => s.classList.add('show'));
}

let shown = null;
function showEra(list, i) {
  const e = list[i]; shown = e;
  [...$('frames').children].forEach((n, k) => n.classList.toggle('on', k === i));
  [...$('ticks').children].forEach((n, k) => n.classList.toggle('on', k === i));
  $('year-big').textContent = e.label || e.year;
  $('era-text').textContent = e.text || '';
  const today = e.label === 'Сегодня';
  $('recon').textContent = e.photo ? (today ? 'Кадр собран по современному фото' :
    `Реконструкция по архивному фото (${e.label || e.year}). Камера та же, меняется только время.`) : '';
  $('orig-btn').hidden = !origOf(e);
  const src = $('era-src'); src.innerHTML = 'Источники: ';
  (e.sources || []).forEach((s, k) => {
    const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = s.name; if (k) src.append(' · '); src.append(a);
  });
  if (!(e.sources || []).length) src.textContent = '';
}

$('orig-btn').addEventListener('click', () => {
  if (!shown) return;
  $('orig-img').src = origOf(shown);
  const c = $('orig-credit'); c.innerHTML = '';
  const a = document.createElement('a'); a.href = shown.photo.url; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = shown.photo.credit || shown.photo.url; c.append('Подлинник: ', a);
  $('orig').hidden = false;
});
$('orig').addEventListener('click', ev => { if (ev.target.tagName !== 'A') $('orig').hidden = true; });

$('back').addEventListener('click', () => {
  const s = $('street'); s.classList.remove('show');
  setTimeout(() => { s.hidden = true; }, 900);
  document.body.classList.remove('in-street');
  map.easeTo({ ...OVERVIEW, center: current ? current.pos : OVERVIEW.center, zoom: 15, pitch: 45, duration: 1800 });
  map.once('moveend', () => map.flyTo({ ...OVERVIEW, duration: 2200 }));
});

if (location.search.includes('debug')) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:40px;max-height:50%;overflow:auto;background:#000c;color:#f88;font-size:10px;z-index:99;white-space:pre-wrap;margin:0';
  document.body.appendChild(box);
  const log = m => { box.textContent += m + '\n'; };
  window.addEventListener('error', e => log('ERR ' + e.message));
  window.addEventListener('unhandledrejection', e => log('REJ ' + (e.reason && e.reason.message || e.reason)));
  map.on('error', e => log('MAP ' + (e.error && e.error.message || JSON.stringify(e).slice(0, 200))));
  map.on('idle', () => log('idle z=' + map.getZoom().toFixed(1) + ' bld=' + map.queryRenderedFeatures({ layers: ['buildings'] }).length));
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
