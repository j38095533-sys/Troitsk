'use strict';
// Троицк сквозь время: карта → пролёт к точке → вид улицы со слайдером лет.
// © 2026 Олег Бурылов. Все права защищены. Подпись автора: TSV-OLEG-2026-aef4bc14a4b0
const TSV_SIG = 'TSV-OLEG-2026-aef4bc14a4b0';
document.documentElement.dataset.tsv = TSV_SIG;

// вступительный пролёт из космоса (один раз за сеанс; ?debug — без него)
const INTRO = !location.search.includes('debug') && !sessionStorage.getItem('troitsk-intro');
// мир ограничен Троицком и окрестностями
const WORLD = [[61.40, 53.98], [61.72, 54.17]];
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
  minZoom: 10.5,
  maxBounds: WORLD,
  renderWorldCopies: false,
  ...(INTRO ? { center: [61.56, 54.09], zoom: 10.5, pitch: 0, bearing: -35 } : OVERVIEW),
  attributionControl: { compact: true, customAttribution: '© 2026 Олег Бурылов · «Троицк сквозь время»' },
  hash: location.search.includes('debug'),
  style: {
    version: 8,
    glyphs: base + 'fonts/{fontstack}/{range}.pbf',
    sprite: base + 'sprites/light',
    sources: {
      sat: { type: 'raster', tiles: [base + 'sat/{z}/{x}/{y}.jpg'], tileSize: 256, minzoom: 8, maxzoom: 15,
        bounds: [61.45, 53.98, 61.70, 54.15],
        attribution: 'Спутник: <a href="https://s2maps.eu">Sentinel-2 cloudless 2023 by EOX</a> (Copernicus)' },
      // детальный спутник (онлайн); если не грузится или нет сети — виден Sentinel под ним
      esri: { type: 'raster', tileSize: 256, maxzoom: 18,  // z19 у Esri по Троицку — серая заглушка «Map data not yet available»
        minzoom: 10, bounds: [61.40, 53.98, 61.72, 54.17],
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Спутник: Esri, Maxar, Earthstar Geographics' },
      pm: { type: 'vector', url: 'pmtiles://' + base + 'troitsk.pmtiles', minzoom: 10,
        attribution: '<a href="https://openstreetmap.org/copyright">© OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>' },
    },
    sky: { 'sky-color': '#9cc0e6', 'horizon-color': '#efe2cf', 'fog-color': '#d9cbb6',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.6, 'atmosphere-blend': 0.8 },
    light: { anchor: 'map', position: [1.3, 210, 35], intensity: 0.45, color: '#fff4e0' },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1c2430' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.08 } },
      { id: 'esri', type: 'raster', source: 'esri', minzoom: 10, paint: { 'raster-fade-duration': 250, 'raster-contrast': 0.05 } },
      { id: 'roads', type: 'line', source: 'pm', 'source-layer': 'roads', minzoom: 13,
        filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road', 'minor_road', 'highway']]],
        paint: { 'line-color': '#f3e9dc', 'line-opacity': 0.35,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, 0.5, 18, 8] } },
      { id: 'buildings', type: 'fill-extrusion', source: 'pm', 'source-layer': 'buildings', minzoom: 14,
        paint: {
          'fill-extrusion-color': '#ddd2c0',
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 7],
          'fill-extrusion-opacity': 0,
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
  if (fit) OVERVIEW = { center: fit.center, zoom: Math.min(fit.zoom, 15), pitch: 0, bearing: 0 };
  const ready = () => { addPins(); startIntro(); };
  if (map.loaded()) ready(); else map.once('load', ready);
  updatePassport();
});

function lockToTown() { document.body.classList.remove('intro'); declutter(); }
function startIntro() {
  if (!INTRO) { map.jumpTo(OVERVIEW); lockToTown(); return; }
  try { sessionStorage.setItem('troitsk-intro', '1'); } catch (e) {}
  document.body.classList.add('intro');
  let done = false; const finish = () => { if (!done) { done = true; lockToTown(); } };
  setTimeout(() => {
    map.flyTo({ ...OVERVIEW, duration: 4200, curve: 1.2, essential: true });
    map.once('moveend', finish);
  }, 700);
  setTimeout(finish, 6500);                          // если пролёт прервали касанием
}

// 3D-дома проявляются только при наклоне камеры: сверху — чистый спутник
function updateBuildings() {
  if (!map.getLayer('buildings')) return;
  const p = map.getPitch(), z = map.getZoom();
  const k = Math.min(1, Math.max(0, (p - 30) / 25)) * Math.min(1, Math.max(0, (z - 15) / 1.2));
  map.setPaintProperty('buildings', 'fill-extrusion-opacity', +(0.8 * k).toFixed(2));
}
map.on('pitch', updateBuildings); map.on('zoom', updateBuildings); map.on('load', updateBuildings);

// подписи точек не налезают: перекрытые прячутся (раньше в списке — важнее)
function declutter() {
  const shown = [...document.querySelectorAll('.pin')].map(p => p.getBoundingClientRect());
  document.querySelectorAll('.pin-label').forEach(l => {
    l.style.visibility = '';
    const r = l.getBoundingClientRect();
    const own = l.parentElement.getBoundingClientRect();
    const hit = shown.some(o => o.left !== own.left && !(r.right < o.left - 4 || r.left > o.right + 4 || r.bottom < o.top - 2 || r.top > o.bottom + 2));
    if (hit) l.style.visibility = 'hidden'; else shown.push(r);
  });
}
map.on('moveend', declutter); map.on('zoomend', declutter);

let pinsAdded = false;
function addPins() {
  if (pinsAdded) return; pinsAdded = true;
  for (const pl of places) {
    const el = document.createElement('div');
    el.className = 'pin' + (seenSet().has(pl.id) ? ' seen' : '');
    el.dataset.id = pl.id;
    el.innerHTML = `<div class="pin-label">${pl.title}</div>`;
    // на телефоне карта глушит click у маркеров — ловим касание сами (без сдвига пальца = нажатие)
    let start = null;
    el.addEventListener('pointerdown', ev => { start = [ev.clientX, ev.clientY]; ev.stopPropagation(); });
    el.addEventListener('pointerup', ev => {
      ev.stopPropagation();
      if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 12) flyToPlace(pl);
      start = null;
    });
    el.addEventListener('touchstart', ev => ev.stopPropagation(), { passive: true });
    new maplibregl.Marker({ element: el }).setLngLat(pl.pos).addTo(map);
  }
  requestAnimationFrame(declutter);
  const chips = $('chips'); chips.innerHTML = '';
  for (const pl of places) {
    const b = document.createElement('button'); b.textContent = pl.title; b.dataset.id = pl.id;
    if (seenSet().has(pl.id)) b.classList.add('seen');
    b.addEventListener('click', () => flyToPlace(pl));
    chips.appendChild(b);
  }
}

// ---- пролёт: с высоты птичьего полёта → плавный наклон до горизонта улицы ----
let busy = false, current = null;
function flyToPlace(pl) {
  if (busy) return; busy = true; current = pl;
  (eras[pl.id] || []).forEach(e => { const i = new Image(); i.src = e.img || `img/${pl.id}/${e.year}.webp`; });
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

function seenSet() { try { return new Set(JSON.parse(localStorage.getItem('troitsk-seen') || '[]')); } catch (e) { return new Set(); } }
function markSeen(id) {
  const s = seenSet(); s.add(id);
  try { localStorage.setItem('troitsk-seen', JSON.stringify([...s])); } catch (e) {}
  document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.add('seen'));
}

function openStreet(pl) {
  markSeen(pl.id);
  if (window.stat) window.stat('place', { id: pl.id });
  const list = (eras[pl.id] || []).slice().sort((a, b) => a.year - b.year);
  const frames = $('frames'); frames.innerHTML = '';
  $('place-title').textContent = pl.title;
  $('place-intro').textContent = pl.intro || '';
  const sum = $('place-sum'), ul = sum.querySelector('ul'); ul.innerHTML = '';
  (pl.summary || []).forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
  sum.hidden = !(pl.summary || []).length;
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
  let last = list.length - 1;
  curList = list; curPlace = pl;
  slider.oninput = () => {
    const v = +slider.value;
    if (v !== last) { last = v; if (navigator.vibrate) navigator.vibrate(8); }
    showEra(list, v); hideHint();
  };
  showEra(list, list.length - 1);
  $('panel').scrollTop = 0; $('frames-box').style.height = '';
  const s = $('street'); s.hidden = false;
  requestAnimationFrame(() => s.classList.add('show'));
  let hinted = false; try { hinted = !!localStorage.getItem('troitsk-hint'); } catch (e) {}
  if (list.length > 1 && !hinted) setTimeout(() => { $('hint').hidden = false; }, 1200);
  updatePassport();
}
let curList = [], curPlace = null;
function hideHint() {
  if ($('hint').hidden) return;
  $('hint').hidden = true; try { localStorage.setItem('troitsk-hint', '1'); } catch (e) {}
}

// при чтении картинка сжимается до ~трети экрана, чтобы текст не прятался
$('panel').addEventListener('scroll', () => {
  const fr = $('frames-box'), full = Math.min(innerWidth * 4 / 3, innerHeight * 0.58), min = innerHeight * 0.3;
  fr.style.height = Math.max(min, full - $('panel').scrollTop) + 'px';
}, { passive: true });

let shown = null;
function showEra(list, i) {
  const e = list[i]; shown = e;
  [...$('frames').children].forEach((n, k) => n.classList.toggle('on', k === i));
  [...$('ticks').children].forEach((n, k) => n.classList.toggle('on', k === i));
  $('year-big').textContent = e.label || e.year;
  $('era-text').textContent = e.text || '';
  const today = e.label === 'Сегодня';
  $('recon').textContent = e.photo ? (today ? 'Кадр собран по современному фото' :
    `Реконструкция по архивному фото (${e.label || e.year}). Камера та же, меняется только время.` + (e.note ? ' ' + e.note : '')) : '';
  $('orig-btn').hidden = !origOf(e);
  setVoice(curPlace && e.year ? `audio/${curPlace.id}/${e.year}.mp3` : null);
  const todayE = curList[curList.length - 1];
  $('cmp-btn').hidden = !(curList.length > 1 && e !== todayE);
  if (!$('cmp').hidden) (e === todayE ? closeCompare() : openCompare());
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

// ---- шторка «было / стало» ----
const imgOf = (pl, e) => e.img || `img/${pl.id}/${e.year}.webp`;
let cmpX = 50;
function openCompare() {
  const old = shown, now = curList[curList.length - 1];
  $('cmp-a').src = imgOf(curPlace, old); $('cmp-b').src = imgOf(curPlace, now);
  $('cmp-la').textContent = old.label || old.year; $('cmp-lb').textContent = 'сейчас';
  $('cmp').hidden = false; $('cmp-btn').classList.add('on'); setCmp(cmpX);
}
function closeCompare() { $('cmp').hidden = true; $('cmp-btn').classList.remove('on'); }
function setCmp(x) {
  cmpX = Math.max(0, Math.min(100, x));
  $('cmp-b').style.clipPath = `inset(0 0 0 ${cmpX}%)`; $('cmp-line').style.left = cmpX + '%';
}
$('cmp-btn').addEventListener('click', () => ($('cmp').hidden ? openCompare() : closeCompare()));
(() => {
  const c = $('cmp'); let drag = false;
  const at = ev => { const r = c.getBoundingClientRect(); setCmp(100 * (ev.clientX - r.left) / r.width); };
  c.addEventListener('pointerdown', ev => { drag = true; c.setPointerCapture(ev.pointerId); at(ev); });
  c.addEventListener('pointermove', ev => { if (drag) at(ev); });
  c.addEventListener('pointerup', () => { drag = false; });
})();

$('back').addEventListener('click', () => {
  stopVoice();
  closeCompare(); hideHint();
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

$('game-btn').addEventListener('click', () => window.openGame && window.openGame());
// ---- фильмы ----
$('video-btn').addEventListener('click', () => { $('videos').hidden = false; document.body.classList.add('in-video'); });
$('vd-close').addEventListener('click', () => {
  document.querySelectorAll('#videos video').forEach(v => v.pause());
  $('videos').hidden = true; document.body.classList.remove('in-video');
});
document.querySelectorAll('#videos video').forEach(v => v.addEventListener('play', () =>
  document.querySelectorAll('#videos video').forEach(o => { if (o !== v) o.pause(); })));

// ---- паспорт знатока: пройденные места ----
function updatePassport() {
  if (!places.length) return;
  const n = places.filter(p => seenSet().has(p.id)).length;
  $('pass-btn').textContent = `🏅 ${n} из ${places.length}`;
  $('pass-btn').classList.toggle('full', n === places.length);
}
$('pass-btn').addEventListener('click', () => {
  const seen = seenSet(), list = $('pass-list'); list.innerHTML = '';
  places.forEach(p => {
    const li = document.createElement('li'); li.className = seen.has(p.id) ? 'ok' : '';
    li.textContent = p.title; li.onclick = () => { $('pass').hidden = true; flyToPlace(p); };
    list.appendChild(li);
  });
  const left = places.filter(p => !seen.has(p.id)).length;
  $('pass-done').hidden = left > 0; $('pass-todo').hidden = left === 0;
  $('pass-todo').textContent = `Осталось мест: ${left}.`;
  $('pass').hidden = false;
});
$('pass-close').addEventListener('click', () => { $('pass').hidden = true; });

// ---- озвучка текста (голос заранее записан в audio/<место>/<год>.mp3) ----
// Если ученик включил «Слушать», озвучка не обрывается при движении ползунка:
// через полсекунды после остановки ползунка начинается текст нового года.
const voice = new Audio(); voice.preload = 'none';
let voiceSrc = null, listening = false, voiceTimer = null;
const vbtn = t => { const b = $('voice-btn'); b.textContent = t; b.classList.toggle('on', t.startsWith('❚❚')); };
function playVoice() {
  if (!voiceSrc) return;
  if (!voice.src.endsWith(voiceSrc)) voice.src = voiceSrc;
  voice.play().then(() => vbtn('❚❚ Пауза')).catch(() => vbtn('Нет звука'));
}
function setVoice(src) {
  voiceSrc = src; clearTimeout(voiceTimer);
  const b = $('voice-btn'); b.hidden = !src;
  if (!src) { voice.pause(); return; }
  fetch(src, { method: 'HEAD' }).then(r => { if (!r.ok && voiceSrc === src) b.hidden = true; }).catch(() => {});
  if (listening) {                       // продолжаем слушать уже новый год
    voice.pause(); vbtn('❚❚ Пауза');
    voiceTimer = setTimeout(() => { voice.currentTime = 0; playVoice(); }, 450);
  } else { voice.pause(); voice.currentTime = 0; vbtn('▶ Слушать'); }
}
function stopVoice() {                   // уход с места — озвучка выключается совсем
  listening = false; clearTimeout(voiceTimer); voice.pause(); voice.currentTime = 0; vbtn('▶ Слушать');
}
$('voice-btn').addEventListener('click', () => {
  if (listening && !voice.paused) { listening = false; voice.pause(); vbtn('▶ Дальше'); return; }
  listening = true; playVoice();
});
voice.addEventListener('ended', () => { vbtn('↻ Ещё раз'); voice.currentTime = 0; });

// ---- «Сообщить об ошибке» ----
$('report-btn').addEventListener('click', () => {
  const where = curPlace ? `${curPlace.title}${shown ? ' · ' + (shown.label || shown.year) : ''}` : 'Сайт';
  $('report-where').textContent = 'Место: ' + where + '. Сообщение получит автор сайта.';
  $('report-status').textContent = ''; $('report-send').disabled = false; $('report').hidden = false;
});
$('report-close').addEventListener('click', () => { $('report').hidden = true; });
$('report-send').addEventListener('click', async () => {
  const text = $('report-text').value.trim();
  if (text.length < 3) { $('report-status').textContent = 'Напишите, что не так.'; return; }
  $('report-send').disabled = true; $('report-status').textContent = 'Отправляю…';
  const ok = window.reportError && await window.reportError({ place: curPlace && curPlace.id, placeTitle: curPlace && curPlace.title,
    year: shown && shown.year, label: shown && (shown.label || shown.year), text, contact: $('report-contact').value.trim() });
  if (ok) { $('report-status').textContent = 'Спасибо! Сообщение отправлено автору.'; $('report-text').value = ''; setTimeout(() => { $('report').hidden = true; }, 1800); }
  else { $('report-status').textContent = 'Не получилось отправить — проверьте интернет и попробуйте ещё раз.'; $('report-send').disabled = false; }
});
