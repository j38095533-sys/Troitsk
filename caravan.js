'use strict';
// Слой «Караванные пути»: торговля Троицка со Средней Азией и степью (данные — data/caravan.json, проверенные источники).
(() => {
  let data = null, on = false, layersAdded = false, markers = [];
  const btn = $('caravan-btn'), panel = $('caravan');
  const SRC = 'caravan';

  // круг-зона радиусом r метров (для мест, точное положение которых неизвестно)
  const circle = (lon, lat, r, n = 48) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = 2 * Math.PI * i / n;
      pts.push([lon + (r / (111320 * Math.cos(lat * Math.PI / 180))) * Math.cos(a), lat + (r / 110540) * Math.sin(a)]);
    }
    return pts;
  };
  // отрезок от Троицка в сторону далёкой точки, обрезанный рамкой карты
  const toward = (from, to) => {
    const [[x1, y1], [x2, y2]] = WORLD; let t = 1;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    if (dx) t = Math.min(t, ((dx > 0 ? x2 : x1) - from[0]) / dx);
    if (dy) t = Math.min(t, ((dy > 0 ? y2 : y1) - from[1]) / dy);
    t *= 0.97;
    return [from, [from[0] + dx * t, from[1] + dy * t]];
  };

  function addLayers() {
    if (layersAdded) return; layersAdded = true;
    const route = data.route, troitsk = route.find(r => r.name === 'Троицк').pos;
    const south = route.find(r => /Николаевская/.test(r.name)).pos, north = route.find(r => r.name === 'Кичигино').pos;
    const menovoy = data.points.find(p => p.id === 'menovoy_dvor').pos;
    const feats = [];
    data.points.filter(p => p.pos && p.area).forEach(p =>
      feats.push({ type: 'Feature', properties: { kind: 'zone', title: p.title }, geometry: { type: 'Polygon', coordinates: [circle(p.pos[0], p.pos[1], p.id === 'menovoy_dvor' ? 300 : 160)] } }));
    // караванная дорога: из степи (юг) к меновому двору, через город — на север к Челябинску
    const inRoad = toward(menovoy, south), outRoad = toward(troitsk, north);
    feats.push({ type: 'Feature', properties: { kind: 'road', label: 'из степи · Бухара ≈1500 км, 52 дня' }, geometry: { type: 'LineString', coordinates: [inRoad[1], menovoy, troitsk] } });
    feats.push({ type: 'Feature', properties: { kind: 'road', label: 'на Кичигино и Челябинск' }, geometry: { type: 'LineString', coordinates: [troitsk, outRoad[1]] } });
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
    const vis = { visibility: 'none' };
    map.addLayer({ id: 'cv-zone', type: 'fill', source: SRC, filter: ['==', ['get', 'kind'], 'zone'], layout: vis,
      paint: { 'fill-color': '#e0a43a', 'fill-opacity': 0.28 } });
    map.addLayer({ id: 'cv-zone-line', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'zone'], layout: vis,
      paint: { 'line-color': '#f3c66b', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'cv-road', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'road'], layout: { ...vis, 'line-cap': 'round' },
      paint: { 'line-color': '#f3c66b', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 7], 'line-dasharray': [1.2, 1.2], 'line-opacity': 0.95 } });
    map.addLayer({ id: 'cv-road-label', type: 'symbol', source: SRC, filter: ['==', ['get', 'kind'], 'road'],
      layout: { ...vis, 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['Noto Sans Medium'], 'text-offset': [0, -1] },
      paint: { 'text-color': '#fff1cf', 'text-halo-color': '#3a2608', 'text-halo-width': 2 } });
    // метки мест с координатами
    data.points.filter(p => p.pos).forEach(p => {
      const el = document.createElement('div'); el.className = 'cv-pin' + (p.area ? ' area' : '');
      el.innerHTML = `<span>🐫</span><div class="cv-label">${p.title.split(/ \(| на месте| и первая/)[0]}</div>`;
      el.addEventListener('pointerup', ev => { ev.stopPropagation(); showPoint(p); });
      el.addEventListener('pointerdown', ev => ev.stopPropagation());
      const m = new maplibregl.Marker({ element: el }).setLngLat(p.pos); markers.push(m);
    });
  }

  function setOn(v) {
    on = v; btn.classList.toggle('on', on); document.body.classList.toggle('caravan-on', on);
    ['cv-zone', 'cv-zone-line', 'cv-road', 'cv-road-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    markers.forEach(m => on ? m.addTo(map) : m.remove());
    if (on) { if (window.stat) window.stat('caravan', {}); overview(); map.fitBounds([[61.545, 54.068], [61.575, 54.088]], { padding: pad(), duration: 1500 }); }
    else panel.hidden = true;
  }

  const pad = () => ({ top: 110, bottom: Math.round(innerHeight * 0.55), left: 40, right: 40 });
  const srcLinks = list => (list || []).map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(' · ');

  // схема всего пути (врезка): простая проекция долготы/широты
  function routeSvg() {
    const W = 320, H = 300, L = [57, 86], B = [38.5, 56];
    const xy = ([lon, lat]) => [(lon - L[0]) / (L[1] - L[0]) * W, (B[1] - lat) / (B[1] - B[0]) * H];
    const pts = data.route.filter(r => r.pos).map(r => ({ ...r, p: xy(r.pos) }));
    const line = pts.map(r => r.p.map(v => v.toFixed(1)).join(',')).join(' ');
    let s = `<svg viewBox="0 0 ${W} ${H}" class="cv-svg" role="img" aria-label="Схема караванного пути">`;
    s += `<rect width="${W}" height="${H}" rx="12" fill="#1b2430"/>`;
    const yan = pts.find(r => /Яныкурган/.test(r.name)), tr = pts.find(r => r.name === 'Троицк');
    (data.route_branches || []).filter(b => b.pos).forEach(b => {
      const p = xy(b.pos), j = b.joins === 'Яныкурган' ? yan : b.joins === 'Троицк' ? tr : null;
      if (j) s += `<line x1="${j.p[0]}" y1="${j.p[1]}" x2="${p[0]}" y2="${p[1]}" stroke="${/Чугучак/.test(b.name) ? '#7fc8a9' : '#c99a4a'}" stroke-width="2" stroke-dasharray="4 4"/>`;
      const right = p[0] > W - 70;
      s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#c99a4a"/><text x="${p[0] + (right ? -6 : 5)}" y="${p[1] + (right ? -7 : 4)}" text-anchor="${right ? 'end' : 'start'}" class="cv-t">${b.name.split(' (')[0]}${/Чугучак/.test(b.name) ? ' · чай' : ''}</text>`;
    });
    s += `<polyline points="${line}" fill="none" stroke="#f3c66b" stroke-width="3" stroke-linejoin="round"/>`;
    pts.forEach(r => {
      const big = r.name === 'Троицк' || r.name === 'Бухара';
      const short = r.name.split(' (')[0].replace('Урочище ', '').replace(' на Сырдарье', '').replace(' на р. Тургай', '').replace(' на р. Аят', '').replace(' на Тоболе', '');
      s += `<circle cx="${r.p[0]}" cy="${r.p[1]}" r="${big ? 6 : 3.5}" fill="${r.name === 'Троицк' ? '#ff7a45' : '#f3c66b'}" stroke="#1b2430" stroke-width="1.5"/>`;
      s += `<text x="${r.p[0] + 8}" y="${r.p[1] + 4}" class="cv-t${big ? ' b' : ''}">${short}</text>`;
    });
    return s + '</svg>';
  }

  function overview() {
    const list = data.points.map(p => `<li data-id="${p.id}">${p.pos ? '🐫' : '•'} ${p.title}${p.pos ? '' : ' <i>(место не установлено)</i>'}</li>`).join('');
    panel.innerHTML = `<button class="cv-close" aria-label="Закрыть">✕</button>
      <h2>Караванные пути</h2>
      <p>${data.intro}</p>
      ${routeSvg()}
      <p class="cv-note">${data.route_note || ''}</p>
      <h3>Места на карте</h3><ul class="cv-list">${list}</ul>
      <details class="cv-facts"><summary>Главное — коротко</summary><ul>${data.facts.map(f => `<li>${f}</li>`).join('')}</ul></details>
      <p class="cv-src">Источники: ${srcLinks(data.sources)}</p>`;
    bind(); panel.hidden = false; panel.scrollTop = 0;
  }
  function showPoint(p) {
    if (p.pos) map.flyTo({ center: p.pos, zoom: 15.2, pitch: 0, duration: 1400, padding: pad() });
    panel.innerHTML = `<button class="cv-close" aria-label="Закрыть">✕</button>
      <button class="cv-back">‹ Все караванные места</button>
      <h2>${p.title}</h2><p>${p.text}</p>
      ${p.area ? '<p class="cv-note">Оранжевая зона на карте — примерное место: точно оно в источниках не указано.</p>' : ''}
      ${p.pos ? '' : '<p class="cv-note">Где именно стояло здание, источники не сообщают — поэтому на карте нет метки.</p>'}
      <p class="cv-src">Источники: ${srcLinks(p.sources)}</p>`;
    bind(); panel.hidden = false; panel.scrollTop = 0;
  }
  function bind() {
    panel.querySelector('.cv-close').onclick = () => setOn(false);
    const back = panel.querySelector('.cv-back'); if (back) back.onclick = () => { overview(); map.fitBounds([[61.545, 54.068], [61.575, 54.088]], { padding: pad(), duration: 1200 }); };
    panel.querySelectorAll('.cv-list li').forEach(li => li.onclick = () => showPoint(data.points.find(p => p.id === li.dataset.id)));
  }

  btn.addEventListener('click', async () => {
    if (on) return setOn(false);
    if (!data) data = await fetch('data/caravan.json').then(r => r.json());
    addLayers(); setOn(true);
  });
})();
