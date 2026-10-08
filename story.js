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
      if (s.interaction) {
        const hold = el('button', 'st-hold', `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><circle class="p" cx="50" cy="50" r="46"/></svg><span>${esc(s.interaction.label || 'Зажми и держи')}</span>`);
        stick.append(hold); bindHold(hold, frame, s);
      }
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
      const hold = sec.querySelector('.st-hold'); if (hold) hold.classList.toggle('on', p > 0.35);
    });
    if (cur >= 0) playScene(cur);
  }

  // «зажми и держи»: кадр A плавно сменяется кадром B, по завершении — звук действия и вибрация
  function bindHold(btn, frame, s) {
    let t0 = 0, raf2 = 0, done = false, k = 0;
    const b = () => frame.querySelector('.st-img.b');
    const step = () => {
      k = Math.min(1, (performance.now() - t0) / 1600);
      const bb = b(); if (bb) bb.style.opacity = k;
      btn.style.setProperty('--p', k);
      if (k >= 1) {
        done = true; btn.classList.add('done'); btn.querySelector('span').textContent = '✓';
        if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
        if (soundOn) { const fx = new Audio(snd(s, 'fx')); fx.volume = 0.9; fx.play().catch(() => {}); }
        return;
      }
      raf2 = requestAnimationFrame(step);
    };
    const start = ev => { ev.preventDefault(); if (done) return; t0 = performance.now() - k * 1600; cancelAnimationFrame(raf2); raf2 = requestAnimationFrame(step); };
    const stop = () => {
      if (done) return; cancelAnimationFrame(raf2);
      const back = () => { k = Math.max(0, k - 0.06); const bb = b(); if (bb) bb.style.opacity = k; btn.style.setProperty('--p', k); if (k > 0 && !done) raf2 = requestAnimationFrame(back); };
      raf2 = requestAnimationFrame(back);
    };
    btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop); btn.addEventListener('pointercancel', stop);
    btn.addEventListener('contextmenu', e => e.preventDefault());
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
  document.getElementById('story-btn').addEventListener('click', open);
  document.getElementById('st-close').addEventListener('click', close);
  document.getElementById('st-sound').addEventListener('click', () => setSound(!soundOn));
})();
