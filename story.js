'use strict';
// © 2026 Олег Бурылов. Подпись автора: TSV-OLEG-2026-aef4bc14a4b0
// «Режим истории»: интерактивный комикс о Троицке (идея — scroll-сторителлинг вроде Notturno Experience).
// Прокрутка ведёт сцены: кадр медленно наезжает, подписи появляются по очереди; в ключевых сценах — «зажми и держи».
// Звук: фон каждой сцены (плавная смена) + озвучка подписей. Данные — data/story.json.
(() => {
  const root = document.getElementById('story');
  root.dataset.tsv = 'TSV-OLEG-2026-aef4bc14a4b0';
  let data = null, built = false, soundOn = true, active = -1;
  const amb = [new Audio(), new Audio()]; let ambI = 0;      // два плеера фона для плавной смены
  amb.forEach(a => { a.loop = true; a.volume = 0; });
  const voice = new Audio();
  const fades = new Map();
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const src = (s, k) => `img/story/${s.id}_${k}.webp`;
  const snd = (s, k) => `audio/story/${s.id}_${k}.mp3`;

  function fade(a, to, ms = 900) {
    clearInterval(fades.get(a));
    const from = a.volume, t0 = performance.now();
    if (to > 0 && a.paused) a.play().catch(() => {});
    fades.set(a, setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { clearInterval(fades.get(a)); if (to === 0) a.pause(); }
    }, 40));
  }
  function playScene(i) {
    if (i === active) return; active = i;
    const s = data.scenes[i];
    document.getElementById('st-bar').style.width = (100 * (i + 1) / data.scenes.length) + '%';
    if (!soundOn || !s) return;
    const next = amb[1 - ambI], cur = amb[ambI];
    next.src = snd(s, 'amb'); next.volume = 0; fade(next, 0.35); fade(cur, 0); ambI = 1 - ambI;
    voice.pause(); voice.src = snd(s, 'voice'); voice.currentTime = 0;
    setTimeout(() => { if (active === i && soundOn) voice.play().catch(() => {}); }, 700);
  }
  function setSound(on) {
    soundOn = on; document.getElementById('st-sound').textContent = on ? '🔊' : '🔇';
    if (!on) { amb.forEach(a => fade(a, 0, 300)); voice.pause(); }
    else { const i = active; active = -1; if (i >= 0) playScene(i); }
  }

  function build() {
    if (built) return; built = true;
    const scroller = el('div', 'st-scroll'); scroller.id = 'st-scroll';
    // титул
    const intro = el('section', 'st-intro');
    intro.innerHTML = `<div class="st-intro-in"><div class="st-kicker">Интерактивная история</div>
      <h1>${esc(data.title || 'Троицк. История города')}</h1>
      <p>${esc(data.subtitle || 'Листай вниз. В некоторых сценах — зажми кнопку и держи.')}</p>
      <button class="st-go" id="st-go">▶ Начать со звуком</button><button class="st-mute" id="st-mute">без звука</button></div>`;
    scroller.append(intro);
    data.scenes.forEach((s, i) => {
      const sec = el('section', 'st-scene'); sec.dataset.i = i;
      const stick = el('div', 'st-stick');
      const frame = el('div', 'st-frame');
      const a = el('img', 'st-img a'); a.alt = ''; a.loading = i < 2 ? 'eager' : 'lazy'; a.src = src(s, 'a');
      a.onerror = () => { a.replaceWith(Object.assign(el('div', 'st-img a st-ph', `<span>${esc(s.year)}</span>`))); };
      frame.append(a);
      if (s.interaction) {
        const b = el('img', 'st-img b'); b.alt = ''; b.loading = 'lazy'; b.src = src(s, 'b');
        b.onerror = () => { b.replaceWith(el('div', 'st-img b st-ph st-ph-b', `<span>${esc(s.year)}</span>`)); };
        frame.append(b);
      }
      stick.append(frame, el('div', 'st-year', esc(s.year)));
      const caps = el('div', 'st-caps');
      (s.captions || []).forEach((c, k) => caps.append(el('div', 'st-cap' + (k % 2 ? ' r' : ''), esc(c))));
      stick.append(caps);
      if (s.interaction) makeControl(stick, frame, s);
      sec.append(stick); scroller.append(sec);
    });
    const outro = el('section', 'st-outro');
    outro.innerHTML = `<div class="st-intro-in">${[].concat((data.outro && data.outro.captions) || data.outro || []).map(t => `<p>${esc(t)}</p>`).join('')}
      <button class="st-go" id="st-map">🗺 ${esc((data.outro && data.outro.cta && data.outro.cta.label) || 'К карте — исследуй места')}</button>
      <details class="st-src"><summary>Источники</summary><ul>${[...new Map(data.scenes.flatMap(s => s.sources || []).map(x => [x.url, x])).values()]
        .map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></li>`).join('')}</ul></details></div>`;
    scroller.append(outro);
    root.append(scroller);
    document.getElementById('st-go').onclick = () => { setSound(true); scrollToScene(0); };
    document.getElementById('st-mute').onclick = () => { setSound(false); scrollToScene(0); };
    document.getElementById('st-map').onclick = close;
    scroller.addEventListener('scroll', onScroll, { passive: true });
  }
  const scrollToScene = i => { const s = root.querySelectorAll('.st-scene')[i]; if (s) document.getElementById('st-scroll').scrollTo({ top: s.offsetTop, behavior: 'smooth' }); };

  // прокрутка: в пределах сцены p = 0..1 — наезд кадра, появление подписей
  let raf = 0;
  function onScroll() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }
  function update() {
    const sc = document.getElementById('st-scroll'), H = sc.clientHeight;
    let cur = -1;
    sc.querySelectorAll('.st-scene').forEach(sec => {
      const top = sec.offsetTop - sc.scrollTop, len = sec.offsetHeight - H;
      const p = Math.max(0, Math.min(1, -top / Math.max(1, len)));
      const vis = top < H && top + sec.offsetHeight > 0;
      if (!vis) return;
      if (top <= H * 0.5) cur = +sec.dataset.i;
      const frame = sec.querySelector('.st-frame');
      frame.style.transform = `scale(${1.14 - 0.14 * p}) translateY(${(0.5 - p) * 3}%)`;
      const caps = sec.querySelectorAll('.st-cap'), n = caps.length;            // подписи по одной: появилась — сменилась следующей
      const ci = p < 0.06 ? -1 : Math.min(n - 1, Math.floor((p - 0.06) / (0.8 / Math.max(1, n))));
      caps.forEach((c, k) => c.classList.toggle('on', k === ci));
      const ctl = sec.querySelector('.st-ctl'); if (ctl) ctl.classList.toggle('on', p > 0.35);
    });
    if (cur >= 0) playScene(cur);
  }

  // ---- жесты: hold (зажми), drag (потяни →), swipe (смахни вверх), tap (стучи N раз), rub (сотри пальцем) ----
  function makeControl(stick, frame, s) {
    const it = s.interaction, type = it.type || 'hold', label = esc(it.label || 'Зажми и держи');
    let k = 0, done = false;
    const b = () => frame.querySelector('.st-img.b');
    const setK = v => { k = Math.max(0, Math.min(1, v)); const bb = b(); if (bb && type !== 'rub') bb.style.opacity = k; ctl.style.setProperty('--p', k); };
    const finish = () => {
      if (done) return; done = true; setK(1); ctl.classList.add('done');
      if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
      if (soundOn) { const fx = new Audio(snd(s, 'fx')); fx.volume = 0.9; fx.play().catch(() => {}); }
    };
    const rollback = () => { if (done) return; const back = () => { if (done) return; setK(k - 0.05); if (k > 0) requestAnimationFrame(back); }; requestAnimationFrame(back); };
    let ctl;
    if (type === 'drag' || type === 'swipe') {
      const vert = type === 'swipe';
      ctl = el('div', 'st-ctl st-' + type, `<div class="st-track"><i></i><b>${vert ? '⬆' : '➜'}</b></div><span>${label}</span>`);
      const track = ctl.querySelector('.st-track');
      let drag = false;
      const at = ev => {
        const r = track.getBoundingClientRect();
        const v = vert ? (r.bottom - ev.clientY - 24) / (r.height - 48) : (ev.clientX - r.left - 24) / (r.width - 48);
        setK(v); if (k >= 0.98) { drag = false; finish(); }
      };
      track.addEventListener('pointerdown', ev => { if (done) return; ev.preventDefault(); drag = true; track.setPointerCapture(ev.pointerId); at(ev); });
      track.addEventListener('pointermove', ev => { if (drag) at(ev); });
      const up = () => { if (drag) { drag = false; rollback(); } };
      track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    } else if (type === 'tap') {
      const n = it.count || 3;
      ctl = el('button', 'st-ctl st-tap', `<span class="st-tapn">${n}</span><span>${label}</span>`);
      let hits = 0;
      ctl.addEventListener('pointerdown', ev => {
        ev.preventDefault(); if (done) return;
        hits++; setK(hits / n); ctl.querySelector('.st-tapn').textContent = n - hits || '✓';
        ctl.classList.remove('pop'); void ctl.offsetWidth; ctl.classList.add('pop');
        if (navigator.vibrate) navigator.vibrate(12);
        if (hits >= n) finish();
      });
    } else if (type === 'rub') {
      ctl = el('button', 'st-ctl st-rubbtn', `<span>✋</span><span>${label}</span>`);
      let canvas = null, ctx = null, rubbing = false, lastCheck = 0;
      const start = () => {
        if (done || canvas) return;
        const a = frame.querySelector('.st-img.a'), bb = b();
        canvas = el('canvas', 'st-rub'); frame.append(canvas);
        const W = frame.clientWidth, H = frame.clientHeight; canvas.width = W; canvas.height = H;
        ctx = canvas.getContext('2d');
        if (a && a.naturalWidth) {                                     // рисуем кадр A «как object-fit: cover»
          const sc = Math.max(W / a.naturalWidth, H / a.naturalHeight), w = a.naturalWidth * sc, h = a.naturalHeight * sc;
          ctx.drawImage(a, (W - w) / 2, (H - h) / 2, w, h);
        } else { ctx.fillStyle = '#e4ddd0'; ctx.fillRect(0, 0, W, H); }
        if (bb) bb.style.opacity = 1;
        ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(46, W * 0.13);
        stick.classList.add('rubbing'); ctl.querySelector('span:last-child').textContent = 'Води пальцем по картинке';
        let prev = null;
        const pt = ev => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height]; };
        canvas.addEventListener('pointerdown', ev => { ev.preventDefault(); rubbing = true; canvas.setPointerCapture(ev.pointerId); prev = pt(ev); });
        canvas.addEventListener('pointermove', ev => {
          if (!rubbing) return; const p = pt(ev);
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); prev = p;
          if (performance.now() - lastCheck > 250) { lastCheck = performance.now(); measure(); }
        });
        const end = () => { rubbing = false; measure(); };
        canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      };
      const measure = () => {                                          // доля стёртого (по редкой сетке точек)
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let clear = 0, tot = 0;
        for (let i = 3; i < d.length; i += 4 * 97) { tot++; if (d[i] < 40) clear++; }
        setK(clear / tot / 0.55);
        if (clear / tot > 0.55) { canvas.style.transition = 'opacity .8s'; canvas.style.opacity = 0; stick.classList.remove('rubbing'); finish(); }
      };
      ctl.addEventListener('pointerdown', ev => { ev.preventDefault(); start(); });
    } else {                                                            // hold
      ctl = el('button', 'st-ctl st-hold', `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><circle class="p" cx="50" cy="50" r="46"/></svg><span>${label}</span>`);
      let t0 = 0, raf2 = 0;
      const step = () => { setK((performance.now() - t0) / 1600); if (k >= 1) return finish(); raf2 = requestAnimationFrame(step); };
      ctl.addEventListener('pointerdown', ev => { ev.preventDefault(); if (done) return; t0 = performance.now() - k * 1600; cancelAnimationFrame(raf2); raf2 = requestAnimationFrame(step); });
      const stop = () => { cancelAnimationFrame(raf2); rollback(); };
      ctl.addEventListener('pointerup', stop); ctl.addEventListener('pointerleave', stop); ctl.addEventListener('pointercancel', stop);
    }
    ctl.addEventListener('contextmenu', e => e.preventDefault());
    stick.append(ctl);
  }

  async function open() {
    if (!data) data = await fetch('data/story.json', { cache: 'no-cache' }).then(r => r.json());
    build();
    root.hidden = false; document.body.classList.add('in-story');
    document.getElementById('st-scroll').scrollTop = 0; active = -1;
    if (window.stat) window.stat('story', {});
  }
  function close() {
    root.hidden = true; document.body.classList.remove('in-story');
    amb.forEach(a => fade(a, 0, 300)); voice.pause(); active = -1;
  }
  window.openStory = open;
  document.getElementById('st-close').addEventListener('click', close);
  document.getElementById('st-sound').addEventListener('click', () => setSound(!soundOn));
})();
