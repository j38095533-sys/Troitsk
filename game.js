'use strict';
// © 2026 Олег Бурылов. Подпись автора: TSV-OLEG-2026-aef4bc14a4b0
// Викторина «как Kahoot»: учитель (по паролю) создаёт игру, ученики входят по коду.
// Связь — сразу несколько публичных каналов (MQTT-брокеры + ntfy.sh); устройство учителя ведёт игру и считает очки.

(() => {
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
// SHA-256 пароля учителя (смена пароля: tools/teacher_password.py «новый пароль»)
const TEACHER_HASH = 'f82423d35cf0c21d0f2a10453d85722123ff2b7a9a6caa3dbcccfc252b40301a';
const ROOT = 'troitsk-quiz/v1/';
const SHAPES = ['▲', '◆', '●', '■'];
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

let bank = null;
const loadBank = () => bank ? Promise.resolve(bank) : fetch('data/quiz.json').then(r => r.json()).then(b => (bank = b));

const screen = $('game');
screen.dataset.tsv = 'TSV-OLEG-2026-aef4bc14a4b0';
function show(html) { screen.hidden = false; document.body.classList.add('in-game'); const box = $('game-box'); box.innerHTML = ''; box.append(...[].concat(html)); }
function close() { document.querySelectorAll('.duo').forEach(n => n.remove()); pair = null; clearInterval(beatId); clearInterval(watchId); screen.hidden = true; document.body.classList.remove('in-game'); if (client) { try { client.end(true); } catch (e) {} client = null; } clearInterval(timerId); }
$('game-close').addEventListener('click', () => { if (role === 'host' && phase !== 'end' && phase !== 'menu' && !confirm('Закончить игру?')) return; if (role === 'host') publishState({ phase: 'end', scores: board() }); close(); });

// ---------- связь: сразу все каналы ----------
// В школьных и мобильных сетях РФ отдельные серверы/порты бывают закрыты, поэтому каждое сообщение
// уходит во все MQTT-брокеры + ntfy.sh (обычный HTTPS, порт 443); повторы отбрасываются по метке _m.
const NTFY = 'https://ntfy.sh/';
let client = null;
const ntfyTopic = t => 'tq1_' + t.replace(ROOT, '').replace(/[^A-Za-z0-9]/g, '_');
function makeBus() {
  const handlers = { message: [], connect: [] }, seen = new Set(), seenQ = [];
  const subs = new Set(), ws = new Map();
  const emit = (ev, ...a) => handlers[ev].forEach(f => { try { f(...a); } catch (e) {} });
  const deliver = (topic, text) => {
    let mid = null;
    try { mid = JSON.parse(text)._m; } catch (e) {}
    if (mid) { if (seen.has(mid)) return; seen.add(mid); seenQ.push(mid); if (seenQ.length > 600) seen.delete(seenQ.shift()); }
    emit('message', topic, text);
  };
  // MQTT: подключаемся ко всем брокерам параллельно и держим те, что ответили
  const mq = BROKERS.map(url => {
    const c = mqtt.connect(url, { connectTimeout: 7000, reconnectPeriod: 3000, clean: true, keepalive: 15, resubscribe: true,
      clientId: 'tq_' + Math.random().toString(16).slice(2, 10) });
    c.on('error', () => {});
    c.on('connect', () => { subs.forEach(t => c.subscribe(t, { qos: 1 })); emit('connect'); });
    c.on('message', (t, m) => deliver(t, m.toString()));
    return c;
  });
  // ntfy.sh: подписка по WebSocket на каждую тему
  const openWs = t => {
    if (ws.get(t) && ws.get(t).readyState <= 1) return;
    let s; try { s = new WebSocket('wss://ntfy.sh/' + ntfyTopic(t) + '/ws'); } catch (e) { return; }
    ws.set(t, s);
    s.onmessage = e => { try { const m = JSON.parse(e.data); if (m.event === 'message') deliver(t, m.message); } catch (er) {} };
    s.onopen = () => emit('connect');
    s.onclose = () => { if (bus.alive && subs.has(t)) setTimeout(() => openWs(t), 2500); };
  };
  // ntfy ограничивает частоту — повтор одного и того же состояния шлём не чаще раза в 8 с
  const ntfyLast = new Map();
  const bus = {
    alive: true,
    get connected() { return mq.some(c => c.connected) || [...ws.values()].some(s => s.readyState === 1); },
    status() { return { mqtt: mq.map(c => c.connected), ntfy: [...ws.values()].some(s => s.readyState === 1) }; },
    on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); return bus; },
    subscribe(topics, opts, cb) {
      [].concat(topics).forEach(t => { subs.add(t); mq.forEach(c => c.connected && c.subscribe(t, { qos: 1 })); openWs(t); });
      if (typeof cb === 'function') cb();
    },
    unsubscribe(t, cb) { let n = 0; const done = () => { if (++n >= mq.length && cb) cb(); }; mq.forEach(c => c.connected ? c.unsubscribe(t, done) : done()); },
    publish(topic, payload, opts = {}) {
      let text = payload;
      if (payload) { try { const o = JSON.parse(payload); o._m = Math.random().toString(36).slice(2, 11); text = JSON.stringify(o); } catch (e) {} }
      mq.forEach(c => { if (c.connected) c.publish(topic, text, { qos: 1, retain: !!opts.retain }); });
      if (!payload) return;
      const key = topic.endsWith('/state') ? payload.replace(/"elapsed":\d+,?/, '') : null;
      const last = ntfyLast.get(topic);
      if (key && last && last.key === key && Date.now() - last.t < 8000) return;   // повтор — пропускаем
      if (key) ntfyLast.set(topic, { key, t: Date.now() });
      fetch(NTFY + ntfyTopic(topic), { method: 'POST', body: text }).catch(() => {});
    },
    reconnect() { mq.forEach(c => { if (!c.connected) try { c.reconnect(); } catch (e) {} }); subs.forEach(openWs); },
    end() { bus.alive = false; mq.forEach(c => { try { c.end(true); } catch (e) {} }); ws.forEach(s => { try { s.close(); } catch (e) {} }); },
  };
  return bus;
}
// совместимость со старым кодом: ждём, пока поднимется хоть один канал
async function connectAny() {
  const bus = makeBus();
  const pre = ROOT + '_ping';
  bus.subscribe(pre);                                  // открывает ntfy-сокет, чтобы проверить и его
  for (let i = 0; i < 50; i++) { if (bus.connected) break; await new Promise(r => setTimeout(r, 200)); }
  if (!bus.connected) { bus.end(); throw new Error('Нет связи с сервером игры. Проверьте интернет.'); }
  return { c: bus, i: 0 };
}
// индикатор каналов связи (виден внизу экрана игры)
setInterval(() => {
  const n = document.getElementById('net-status'); if (!n) return;
  if (!client || !client.status) { n.textContent = ''; return; }
  const s = client.status();
  n.textContent = 'Связь: ' + s.mqtt.map((ok, i) => (ok ? '●' : '○') + (i + 1)).join(' ') + ' ' + (s.ntfy ? '●' : '○') + 'H';
  n.className = s.mqtt.some(Boolean) || s.ntfy ? 'ok' : 'bad';
}, 1500);

// ---------- меню ----------
let role = null, phase = 'menu';
function menu() {
  role = null; phase = 'menu';
  const pin = new URLSearchParams(location.search).get('pin');
  const b1 = el('button', 'g-big g-student', 'Я ученик'), b2 = el('button', 'g-big g-teacher', 'Я учитель');
  const b3 = el('button', 'g-big g-solo', 'Играть одному');
  b1.onclick = () => studentJoin(pin); b2.onclick = teacherLogin; b3.onclick = soloStart;
  const best = store.get('tq-best', 0);
  const review = el('button', 'g-big g-review', '📖 Повторить перед игрой'); review.onclick = summaryScreen;
  show([el('h2', 'g-title', 'Викторина «Троицк сквозь время»'),
    el('p', 'g-sub', 'Учитель создаёт игру, ученики входят по коду со своих телефонов.'), b1, b2,
    review,
    el('p', 'g-sub', 'Или потренируйся сам — 10 вопросов на время' + (best ? ` (твой рекорд: ${best})` : '') + ':'), b3]);
  if (pin) studentJoin(pin);
}
window.openGame = menu;

// ---------- ученик ----------
let me = null, myScore = 0, answeredQ = -1, lastState = null;
function studentJoin(pin) {
  role = 'student';
  const inPin = el('input', 'g-input'); inPin.inputMode = 'numeric'; inPin.maxLength = 6; inPin.placeholder = 'Код игры (6 цифр)'; inPin.value = pin || '';
  const inName = el('input', 'g-input'); inName.maxLength = 18; inName.placeholder = 'Твоё имя'; inName.value = store.get('tq-name', '');
  const pairBox = el('label', 'g-check'); const pairIn = el('input'); pairIn.type = 'checkbox';
  pairBox.append(pairIn, el('span', '', ' 👥 Нас двое на одном телефоне (у друга нет телефона или интернета)'));
  const inName2 = el('input', 'g-input'); inName2.maxLength = 18; inName2.placeholder = 'Имя второго игрока'; inName2.hidden = true;
  pairIn.onchange = () => { inName2.hidden = !pairIn.checked; };
  const err = el('div', 'g-err'); const go = el('button', 'g-big g-student', 'Войти в игру');
  go.onclick = async () => {
    const p = inPin.value.replace(/\D/g, ''), n = inName.value.trim();
    if (p.length !== 6) { err.textContent = 'Код — 6 цифр с экрана учителя'; return; }
    if (!n) { err.textContent = 'Напиши имя'; return; }
    const n2 = inName2.value.trim();
    if (pairIn.checked && !n2) { err.textContent = 'Напиши имя второго игрока'; return; }
    store.set('tq-name', n); go.disabled = true; err.textContent = 'Подключаюсь…';
    try {
      const { c } = await connectAny(+p[0] - 1); client = c;
      me = { id: store.get('tq-id', null) || Math.random().toString(36).slice(2, 10), name: n, pin: p };
      store.set('tq-id', me.id);
      if (window.stat) window.stat('game', { kind: pairIn.checked ? 'pair' : 'student' });
      if (pairIn.checked) { pairInit([n, n2]); me.id = pair.players[0].id; }
      client.subscribe(ROOT + p + '/state', { qos: 1 });
      client.on('message', (t, m) => { lastMsgAt = Date.now(); if (!m.length) return; try { onState(JSON.parse(m.toString())); } catch (e) {} });
      lastMsgAt = Date.now(); startWatchdog(p);
      const hello = () => (pair ? pair.players : [{ id: me.id, name: n }]).forEach(pl =>
        client.publish(ROOT + p + '/join', JSON.stringify({ id: pl.id, name: pl.name }), { qos: 1 }));
      hello(); client.on('connect', hello);
      if (pair) pairState({ phase: 'lobby', players: 0 }); else waitScreen('Ты в игре, ' + n + '!', 'Смотри на экран учителя — скоро начнём.');
      setTimeout(() => { if (!lastState && !pair) waitScreen('Ждём учителя…', 'Проверь код: ' + p + '. Если игра ещё не создана — подожди.'); }, 6000);
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  };
  show([el('h2', 'g-title', 'Вход в игру'), inPin, inName, pairBox, inName2, go, err]);
}
function waitScreen(t, s) {
  const parts = [el('div', 'g-wait-dot'), el('h2', 'g-title', t), el('p', 'g-sub', s)];
  if (role === 'student') { const r = el('button', 'g-link', '↻ Обновить, если завис'); r.onclick = () => resync(true); parts.push(r); }
  show(parts);
}

// вопрос пришёл, таймер ещё не запущен: грузим картинку и сообщаем учителю «готов»
function studentLoading(s) {
  clearInterval(timerId);
  const btns = el('div', 'g-answers');
  s.options.forEach((o, i) => { const b = el('button', 'g-ans g-c' + i); b.disabled = true; b.append(el('span', 'g-shape', SHAPES[i]), el('span', '', o)); btns.append(b); });
  const parts = [el('div', 'g-qnum', `Вопрос ${s.qi + 1} из ${s.total}`), el('h2', 'g-q', s.q)];
  const note = el('div', 'g-loadnote', '⏳ Ждём, пока вопрос загрузится у всех…');
  const ready = () => {
    if (readySent === s.qi) return; readySent = s.qi;
    client.publish(ROOT + me.pin + '/ans', JSON.stringify({ id: me.id, name: me.name, qi: s.qi, ready: 1 }), { qos: 1 });
  };
  if (s.img) {
    const im = el('img', 'g-qimg'); parts.push(im);
    im.onload = im.onerror = ready; im.src = s.img;
    setTimeout(ready, 8000);                          // картинка не грузится — не держим весь класс
  } else ready();
  show([...parts, note, btns]);
}

// сторож: учитель шлёт состояние каждые 4 с; тишина > 10 с = связь уснула — переподключаемся и берём сохранённое состояние
let lastMsgAt = 0, watchId = null, rendered = '';
function resync(force) {
  if (!client || !me) return;
  lastMsgAt = Date.now();
  if (force) rendered = '';
  const t = ROOT + me.pin + '/state';
  if (!client.connected) { try { client.reconnect(); } catch (e) {} return; }
  client.unsubscribe(t, () => client.subscribe(t, { qos: 1 }));     // повторная подписка отдаёт retained-состояние
}
function startWatchdog() {
  clearInterval(watchId);
  watchId = setInterval(() => { if (role === 'student' && client && Date.now() - lastMsgAt > 10000) resync(false); }, 2000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && role === 'student') resync(false); });

let timerId = null, preloaded = false;
function onState(s) {
  lastState = s;
  if (pair) return pairState(s);
  const key = s.phase + ':' + (s.qi ?? '') + (s.phase === 'lobby' ? ':' + s.players : '') + (s.phase === 'question' ? ':' + (s.go !== false) : '');
  if (key === rendered) return;                    // повтор от учителя — экран уже актуален
  rendered = key;
  if (s.phase === 'lobby' && s.pre && !preloaded) { preloaded = true; s.pre.forEach(u => { const i = new Image(); i.src = u; }); }
  if (s.phase === 'lobby') waitScreen('Ты в игре, ' + me.name + '!', 'Ждём остальных. Игроков: ' + (s.players || 0));
  else if (s.phase === 'question') studentQuestion(s);
  else if (s.phase === 'reveal') studentReveal(s);
  else if (s.phase === 'end') studentEnd(s);
}
let readySent = -1;
function studentQuestion(s) {
  if (answeredQ === s.qi) return;                      // уже ответил на этот вопрос
  if (s.go === false) return studentLoading(s);
  const got = Date.now(), dur = Math.max(4000, s.dur * 1000 - (s.elapsed || 0));
  const bar = el('div', 'g-timer'); const fill = el('i'); bar.append(fill);
  const btns = el('div', 'g-answers');
  s.options.forEach((o, i) => {
    const b = el('button', 'g-ans g-c' + i); b.append(el('span', 'g-shape', SHAPES[i]), el('span', '', o));
    b.onclick = () => {
      answeredQ = s.qi;
      client.publish(ROOT + me.pin + '/ans', JSON.stringify({ id: me.id, name: me.name, qi: s.qi, c: i, ms: Date.now() - got + (s.elapsed || 0) }), { qos: 1 });
      waitScreen('Ответ принят!', 'Ждём остальных…');
    };
    btns.append(b);
  });
  const parts = [el('div', 'g-qnum', `Вопрос ${s.qi + 1} из ${s.total}`), el('h2', 'g-q', s.q)];
  if (s.img) { const im = el('img', 'g-qimg'); im.src = s.img; parts.push(im); }
  show([...parts, bar, btns]);
  clearInterval(timerId);
  timerId = setInterval(() => {
    const left = Math.max(0, dur - (Date.now() - got)); fill.style.width = (100 * left / (s.dur * 1000)) + '%';
    if (!left) { clearInterval(timerId); if (answeredQ !== s.qi) waitScreen('Время вышло', 'Смотри правильный ответ на экране учителя.'); }
  }, 100);
}
function studentReveal(s) {
  clearInterval(timerId);
  const mine = (s.scores || []).find(x => x.id === me.id);
  const ok = mine && mine.last && mine.last.ok;
  const place = mine ? (s.scores.indexOf(mine) + 1) : '—';
  show([el('div', 'g-result ' + (ok ? 'g-ok' : 'g-bad'), ok ? 'Верно!' : 'Неверно'),
    el('p', 'g-sub', ok ? '+' + mine.last.pts + ' очков' : 'Правильный ответ: ' + s.options[s.correct]),
    el('p', 'g-explain', s.explain || ''),
    el('div', 'g-score', 'Очки: ' + (mine ? mine.score : 0) + ' · место ' + place)]);
}
function studentEnd(s) {
  clearInterval(timerId);
  const sc = s.scores || [], i = sc.findIndex(x => x.id === me.id);
  show([el('h2', 'g-title', 'Игра окончена!'), el('div', 'g-result g-ok', i >= 0 ? (i + 1) + ' место' : 'Спасибо!'),
    el('div', 'g-score', i >= 0 ? 'Очки: ' + sc[i].score : ''), podium(sc)]);
}

// ---------- учитель ----------
async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function teacherLogin() {
  role = 'host';
  if (sessionStorage.getItem('tq-teacher') === '1') return teacherSetup();
  const inp = el('input', 'g-input'); inp.type = 'password'; inp.placeholder = 'Пароль учителя';
  const err = el('div', 'g-err'), go = el('button', 'g-big g-teacher', 'Войти');
  const tryIn = async () => {
    if (await sha256(inp.value.trim()) === TEACHER_HASH) { try { sessionStorage.setItem('tq-teacher', '1'); } catch (e) {} teacherSetup(); }
    else err.textContent = 'Неверный пароль';
  };
  go.onclick = tryIn; inp.onkeydown = e => { if (e.key === 'Enter') tryIn(); };
  show([el('h2', 'g-title', 'Вход для учителя'), inp, go, err]);
}

async function teacherSetup() {
  const b = await loadBank(); const own = store.get('tq-own', []);
  const placeNames = { passazh: 'Пассаж', sobor: 'Собор', kazan: 'Монастырь', vokzal: 'Вокзал', ryady: 'Гостиный двор',
    ploshad: 'Администрация', mikhail: 'Михайловская церковь', torg: 'Торговые ряды', erahtin: 'Дом Ерахтина', licey13: 'Лицей №13', caravan: 'Караванные пути' };
  const places = [...new Set(b.map(q => q.place).filter(Boolean))].concat(b.some(q => !q.place) ? ['__town'] : []);
  placeNames.__town = 'Весь город';
  const sel = new Set(places);
  const chips = el('div', 'g-chips');
  places.forEach(p => { const c = el('button', 'g-chip on', placeNames[p] || p);
    c.onclick = () => { sel.has(p) ? sel.delete(p) : sel.add(p); c.classList.toggle('on'); count(); }; chips.append(c); });
  const nSel = el('select', 'g-input'); [5, 10, 15, 'все'].forEach(n => nSel.append(new Option(n === 'все' ? 'Все вопросы' : n + ' вопросов', n)));
  nSel.value = 10;
  const tSel = el('select', 'g-input'); [10, 20, 30].forEach(t => tSel.append(new Option(t + ' секунд на ответ', t))); tSel.value = 20;
  const info = el('p', 'g-sub');
  const pick = () => b.filter(q => sel.has(q.place || '__town'));
  const count = () => { const n = pick().length + own.length; info.textContent = `Доступно вопросов: ${n} (своих: ${own.length})`; };
  count();
  const waitBox = el('label', 'g-check'); const waitIn = el('input'); waitIn.type = 'checkbox'; waitIn.checked = store.get('tq-wait', false);
  waitBox.append(waitIn, el('span', '', ' Ждать, пока вопрос загрузится у всех, и только потом запускать таймер'));
  const go = el('button', 'g-big g-teacher', 'Создать игру');
  go.onclick = () => {
    let qs = shuffle(pick().concat(own));
    if (nSel.value !== 'все') qs = qs.slice(0, +nSel.value);
    if (!qs.length) { info.textContent = 'Выберите хотя бы одно место'; return; }
    store.set('tq-wait', waitIn.checked);
    hostGame(qs, +tSel.value, waitIn.checked);
  };
  const addOwn = el('button', 'g-link', '+ Добавить свой вопрос'); addOwn.onclick = ownEditor;
  show([el('h2', 'g-title', 'Новая игра'), el('p', 'g-sub', 'Вопросы по местам:'), chips, nSel, tSel, waitBox, info, go, addOwn]);
}
function ownEditor() {
  const own = store.get('tq-own', []);
  const q = el('input', 'g-input'); q.placeholder = 'Вопрос';
  const opts = [0, 1, 2, 3].map(i => { const x = el('input', 'g-input g-c' + i + 'b'); x.placeholder = (i ? 'Неверный ответ ' + i : 'Правильный ответ'); return x; });
  const err = el('div', 'g-err'), save = el('button', 'g-big g-teacher', 'Сохранить вопрос'), back = el('button', 'g-link', '‹ Назад');
  save.onclick = () => {
    if (!q.value.trim() || opts.some(o => !o.value.trim())) { err.textContent = 'Заполните вопрос и все 4 ответа'; return; }
    own.push({ id: 'own' + Date.now(), place: null, q: q.value.trim(), options: opts.map(o => o.value.trim()), a: 0, explain: '' });
    store.set('tq-own', own); teacherSetup();
  };
  back.onclick = teacherSetup;
  const list = el('div', 'g-ownlist');
  own.forEach((x, i) => { const r = el('div', 'g-ownrow'); r.append(el('span', '', x.q)); const d = el('button', 'g-link', 'удалить');
    d.onclick = () => { own.splice(i, 1); store.set('tq-own', own); ownEditor(); }; r.append(d); list.append(r); });
  show([el('h2', 'g-title', 'Свой вопрос'), el('p', 'g-sub', 'Порядок ответов перемешается в игре. Вопросы хранятся на этом устройстве.'), q, ...opts, save, err, back, list]);
}

// ---- ведение игры ----
let H = null;   // { pin, qs, dur, players:Map, qi, answers:Map, t0 }
let lastPub = null, beatId = null;
function publishState(s) {
  if (!client || !H) return;
  if (s.phase === 'question') s = { ...s, go: !!H.go, elapsed: H.go ? Date.now() - H.t0 : 0 };
  lastPub = s;
  client.publish(ROOT + H.pin + '/state', JSON.stringify(s), { qos: 1, retain: true });
  clearInterval(beatId);
  if (s.phase !== 'end') beatId = setInterval(() => {
    if (!client || !H || !lastPub) return;
    const b = lastPub.phase === 'question' ? { ...lastPub, go: !!H.go, elapsed: H.go ? Date.now() - H.t0 : 0 } : lastPub;
    client.publish(ROOT + H.pin + '/state', JSON.stringify(b), { qos: 1, retain: true });
  }, 4000);
}
const board = () => H ? [...H.players.values()].sort((a, b) => b.score - a.score) : [];

async function hostGame(qs, dur, wait = true) {
  phase = 'connecting'; waitScreen('Создаю игру…', 'Подключаюсь к серверу игры');
  let c, i;
  try { ({ c, i } = await connectAny()); } catch (e) { show([el('h2', 'g-title', 'Нет связи'), el('p', 'g-sub', e.message)]); return; }
  client = c;
  const pin = String(i + 1) + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  // перемешиваем варианты, запоминаем правильный
  qs = qs.map(q => { const order = shuffle([0, 1, 2, 3]); return { ...q, options: order.map(k => q.options[k]), a: order.indexOf(q.a) }; });
  H = { pin, qs, dur, wait, players: new Map(), qi: -1, answers: new Map(), ready: new Set(), go: false };
  if (window.stat) window.stat('game', { kind: 'teacher' });
  client.subscribe([ROOT + pin + '/join', ROOT + pin + '/ans'], { qos: 1 });
  client.on('message', (t, m) => {
    let d; try { d = JSON.parse(m.toString()); } catch (e) { return; }
    if (t.endsWith('/join') && d.id && d.name) {
      if (!H.players.has(d.id)) H.players.set(d.id, { id: d.id, name: String(d.name).slice(0, 18), score: 0, last: null });
      if (phase === 'lobby') { lobby(); publishState({ phase: 'lobby', players: H.players.size, pre: H.pre }); }
      else republish();
    }
    if (t.endsWith('/ans') && d.id && !H.players.has(d.id) && d.name)          // вход ученика потерялся в сети — добавляем по ответу
      H.players.set(d.id, { id: d.id, name: String(d.name).slice(0, 18), score: 0, last: null });
    if (t.endsWith('/ans') && d.ready) {                                   // «вопрос загрузился у меня»
      if (phase === 'question' && d.qi === H.qi && !H.go) { H.ready.add(d.id); updateReady(); }
      return;
    }
    if (t.endsWith('/ans') && phase === 'question' && H.go && d.qi === H.qi && H.players.has(d.id) && !H.answers.has(d.id)) {
      H.answers.set(d.id, { c: d.c, ms: Math.min(+d.ms || 0, H.dur * 1000) });
      $('g-anscount') && ($('g-anscount').textContent = `Ответили: ${H.answers.size} из ${H.players.size}`);
      if (H.answers.size >= H.players.size) reveal();
    }
  });
  H.pre = [...new Set(qs.map(q => q.img).filter(Boolean))];
  phase = 'lobby'; publishState({ phase: 'lobby', players: 0, pre: H.pre }); lobby();
}
function republish() { if (phase === 'question') sendQuestion(true); else if (phase === 'reveal') publishState(H.revealState); }

function lobby() {
  const url = location.origin + location.pathname + '?pin=' + H.pin;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const qrBox = el('div', 'g-qr'); qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  const names = el('div', 'g-names'); H.players.forEach(p => names.append(el('span', 'g-name', p.name)));
  const start = el('button', 'g-big g-teacher', H.players.size ? `Начать (${H.players.size})` : 'Ждём учеников…');
  start.disabled = !H.players.size; start.onclick = () => nextQuestion();
  show([el('p', 'g-sub', 'Зайдите на сайт → «Игра» → «Я ученик» и введите код:'), el('div', 'g-pin', H.pin.replace(/(\d{3})/, '$1 ')),
    qrBox, el('p', 'g-sub', 'или отсканируйте QR-код'), names, start]);
}
function nextQuestion() {
  H.qi++; H.answers = new Map(); H.ready = new Set(); H.go = !H.wait;
  if (H.qi >= H.qs.length) return finish();
  phase = 'question'; H.t0 = Date.now(); sendQuestion(false);
  const q = H.qs[H.qi];
  const bar = el('div', 'g-timer'); const fill = el('i'); bar.append(fill);
  const grid = el('div', 'g-answers g-host');
  q.options.forEach((o, i) => { const b = el('div', 'g-ans g-c' + i); b.append(el('span', 'g-shape', SHAPES[i]), el('span', '', o)); grid.append(b); });
  const cnt = el('div', 'g-sub'); cnt.id = 'g-anscount'; cnt.textContent = `Ответили: 0 из ${H.players.size}`;
  const skip = el('button', 'g-link', 'Показать ответ сейчас ›'); skip.onclick = reveal;
  const parts = [el('div', 'g-qnum', `Вопрос ${H.qi + 1} из ${H.qs.length}`), el('h2', 'g-q', q.q)];
  if (q.img) { const im = el('img', 'g-qimg'); im.src = q.img; parts.push(im); }
  const waitRow = el('div', 'g-waitrow');
  const waitTxt = el('span', 'g-sub'); waitTxt.id = 'g-ready';
  const now = el('button', 'g-link', 'Начать сейчас ›'); now.onclick = startTimer;
  waitRow.append(waitTxt, now);
  show([...parts, bar, grid, H.go ? cnt : waitRow, skip]);
  H.ui = { fill, cnt, waitRow };
  clearInterval(timerId);
  if (H.go) startTimer(); else { updateReady(); H.waitTimer = setTimeout(startTimer, 12000); }   // не дольше 12 с
}
function updateReady() {
  const n = $('g-ready'); if (n) n.textContent = `⏳ Вопрос загрузился у ${H.ready.size} из ${H.players.size}`;
  if (!H.go && H.players.size && H.ready.size >= H.players.size) startTimer();
}
function startTimer() {
  if (phase !== 'question' || H.timerQi === H.qi) return;            // таймер этого вопроса уже идёт
  clearTimeout(H.waitTimer);
  if (!H.go) { H.go = true; H.t0 = Date.now(); sendQuestion(); }       // общий старт для всех
  H.timerQi = H.qi;
  if (H.ui && H.ui.waitRow.isConnected) H.ui.waitRow.replaceWith(H.ui.cnt);
  clearInterval(timerId);
  const fill = H.ui.fill;
  timerId = setInterval(() => {
    const left = Math.max(0, H.dur * 1000 - (Date.now() - H.t0)); fill.style.width = (100 * left / (H.dur * 1000)) + '%';
    if (!left) reveal();
  }, 100);
}
function sendQuestion() {
  const q = H.qs[H.qi];
  publishState({ phase: 'question', qi: H.qi, total: H.qs.length, q: q.q, img: q.img || null, options: q.options, dur: H.dur });
}
function reveal() {
  if (phase !== 'question') return; phase = 'reveal'; clearInterval(timerId); clearTimeout(H.waitTimer);
  const q = H.qs[H.qi], counts = [0, 0, 0, 0];
  H.players.forEach(p => { p.last = { ok: false, pts: 0 }; });
  H.answers.forEach((a, id) => {
    counts[a.c] = (counts[a.c] || 0) + 1;
    const p = H.players.get(id); if (!p) return;
    if (a.c === q.a) { const pts = Math.round(500 + 500 * (1 - a.ms / (H.dur * 1000))); p.score += pts; p.last = { ok: true, pts }; }
  });
  const scores = board().map(p => ({ id: p.id, name: p.name, score: p.score, last: p.last }));
  H.revealState = { phase: 'reveal', qi: H.qi, options: q.options, correct: q.a, explain: q.explain || '', scores };
  publishState(H.revealState);
  const max = Math.max(1, ...counts);
  const bars = el('div', 'g-bars');
  q.options.forEach((o, i) => { const col = el('div', 'g-barcol' + (i === q.a ? ' g-right' : ''));
    const bb = el('div', 'g-bar g-c' + i); bb.style.height = (12 + 120 * counts[i] / max) + 'px'; bb.textContent = counts[i];
    col.append(bb, el('div', 'g-barlbl', SHAPES[i] + (i === q.a ? ' ✓' : ''))); bars.append(col); });
  const top = el('ol', 'g-top'); scores.slice(0, 5).forEach(s => { const li = el('li', ''); li.append(el('span', '', s.name), el('b', '', s.score)); top.append(li); });
  const next = el('button', 'g-big g-teacher', H.qi + 1 < H.qs.length ? 'Следующий вопрос ›' : 'Итоги ›'); next.onclick = nextQuestion;
  show([el('h2', 'g-q', q.q), bars, el('div', 'g-right-ans', 'Правильно: ' + q.options[q.a]), el('p', 'g-explain', q.explain || ''),
    el('h3', 'g-sub', 'Лидеры'), top, next]);
}
function finish() {
  phase = 'end'; const sc = board().map(p => ({ id: p.id, name: p.name, score: p.score }));
  publishState({ phase: 'end', scores: sc });
  const again = el('button', 'g-big g-teacher', 'Новая игра'); again.onclick = () => { publishState({ phase: 'end', scores: sc }); client.end(true); client = null; teacherSetup(); };
  show([el('h2', 'g-title', 'Итоги игры'), podium(sc), again]);
  // убрать сохранённое состояние с сервера через минуту
  setTimeout(() => { if (client && H) client.publish(ROOT + H.pin + '/state', '', { qos: 1, retain: true }); }, 60000);
}
function podium(sc) {
  const p = el('div', 'g-podium');
  [1, 0, 2].forEach(i => { if (!sc[i]) return; const c = el('div', 'g-pod g-pod' + (i + 1));
    c.append(el('div', 'g-podname', sc[i].name), el('div', 'g-podscore', sc[i].score), el('div', 'g-podnum', String(i + 1))); p.append(c); });
  return p;
}

// ---------- шпаргалка перед игрой ----------
async function summaryScreen() {
  const [pl, sm] = await Promise.all([fetch('data/places.json').then(r => r.json()),
    fetch('data/summary.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))]);
  const list = (title, items, open) => {
    const d = el('details', 'g-sum'); if (open) d.open = true;
    d.append(el('summary', '', title));
    const ul = el('ul'); (items || []).forEach(t => ul.append(el('li', '', t))); d.append(ul); return d;
  };
  const back = el('button', 'g-link', '‹ В меню игры'); back.onclick = menu;
  const solo = el('button', 'g-big g-solo', 'Проверить себя — играть одному'); solo.onclick = soloStart;
  const parts = [el('h2', 'g-title', 'Шпаргалка перед игрой'), el('p', 'g-sub', 'Главные факты — все вопросы викторины отсюда.')];
  if (sm.town) parts.push(list('Троицк: коротко о городе', sm.town, true));
  if (sm.caravan) parts.push(list('Караванные пути', sm.caravan, false));
  pl.filter(p => (p.summary || []).length).forEach(p => parts.push(list(p.title, p.summary, false)));
  parts.push(solo, back);
  show(parts);
}

// ---------- одиночная игра ----------
let solo = null;
async function soloStart() {
  role = 'solo'; phase = 'solo';
  if (window.stat) window.stat('game', { kind: 'solo' });
  const b = await loadBank();
  const qs = shuffle(b).slice(0, 10).map(q => { const o = shuffle([0, 1, 2, 3]); return { ...q, options: o.map(k => q.options[k]), a: o.indexOf(q.a) }; });
  solo = { qs, i: -1, score: 0, streak: 0, right: 0 };
  soloNext();
}
function soloNext() {
  solo.i++;
  if (solo.i >= solo.qs.length) return soloEnd();
  const q = solo.qs[solo.i], DUR = 20000, t0 = Date.now();
  const bar = el('div', 'g-timer'); const fill = el('i'); bar.append(fill);
  const btns = el('div', 'g-answers');
  const answer = c => {
    clearInterval(timerId);
    const ms = Date.now() - t0, ok = c === q.a;
    let pts = 0;
    if (ok) { solo.streak++; solo.right++; pts = Math.round(500 + 500 * (1 - Math.min(ms, DUR) / DUR)) + (solo.streak > 1 ? 100 * Math.min(solo.streak - 1, 5) : 0); solo.score += pts; }
    else solo.streak = 0;
    if (navigator.vibrate) navigator.vibrate(ok ? 30 : [60, 40, 60]);
    const next = el('button', 'g-big g-teacher', solo.i + 1 < solo.qs.length ? 'Дальше ›' : 'Итоги ›'); next.onclick = soloNext;
    show([el('div', 'g-result ' + (ok ? 'g-ok' : 'g-bad'), c < 0 ? 'Время вышло' : ok ? 'Верно!' : 'Неверно'),
      el('p', 'g-sub', ok ? `+${pts} очков` + (solo.streak > 1 ? ` · серия ${solo.streak} 🔥` : '') : 'Правильный ответ: ' + q.options[q.a]),
      el('p', 'g-explain', q.explain || ''), el('div', 'g-score', 'Очки: ' + solo.score), next]);
  };
  q.options.forEach((o, i) => {
    const b = el('button', 'g-ans g-c' + i); b.append(el('span', 'g-shape', SHAPES[i]), el('span', '', o));
    b.onclick = () => answer(i); btns.append(b);
  });
  const parts = [el('div', 'g-qnum', `Вопрос ${solo.i + 1} из ${solo.qs.length} · очки ${solo.score}`), el('h2', 'g-q', q.q)];
  if (q.img) { const im = el('img', 'g-qimg'); im.src = q.img; parts.push(im); }
  show([...parts, bar, btns]);
  clearInterval(timerId);
  timerId = setInterval(() => {
    const left = Math.max(0, DUR - (Date.now() - t0)); fill.style.width = (100 * left / DUR) + '%';
    if (!left) answer(-1);
  }, 100);
}
function soloEnd() {
  const best = store.get('tq-best', 0), rec = solo.score > best;
  if (rec) store.set('tq-best', solo.score);
  const again = el('button', 'g-big g-solo', 'Ещё раз'); again.onclick = soloStart;
  const menuB = el('button', 'g-link', '‹ В меню игры'); menuB.onclick = menu;
  const stars = solo.right >= 9 ? '⭐⭐⭐' : solo.right >= 6 ? '⭐⭐' : solo.right >= 3 ? '⭐' : '';
  show([el('h2', 'g-title', 'Итоги'), el('div', 'g-stars', stars),
    el('div', 'g-result g-ok', solo.score + ' очков'),
    el('p', 'g-sub', `Правильных ответов: ${solo.right} из ${solo.qs.length}` + (rec ? ' · новый рекорд! 🎉' : ` · рекорд: ${best}`)),
    again, menuB]);
}

// ---------- двое учеников на одном телефоне ----------
// Телефон лежит между ними: экран пополам, верхняя половина повёрнута к сидящему напротив.
// Для учителя это два отдельных ученика (свои id, имена, ответы и очки) в общей игре класса.
let pair = null;
function pairInit(names) {
  document.querySelectorAll('.duo').forEach(n => n.remove());
  const root = el('div', 'duo');
  const halves = [el('div', 'duo-half top'), el('div', 'duo-half bottom')];
  const mid = el('div', 'duo-mid'); const fill = el('i'); mid.append(fill);
  root.append(halves[0], mid, halves[1]);
  screen.append(root);
  const ids = store.get('tq-pair-ids', null) || [0, 1].map(() => Math.random().toString(36).slice(2, 10));
  store.set('tq-pair-ids', ids);
  pair = { root, halves, fill, rendered: '', players: names.map((n, i) => ({ id: ids[i], name: n, answered: -1, readySent: -1 })) };
}
const pairSend = (topic, obj) => client.publish(ROOT + me.pin + topic, JSON.stringify(obj), { qos: 1 });
function pairHalf(p, nodes) { const h = pair.halves[p]; h.innerHTML = ''; h.append(el('div', 'duo-name p' + p, pair.players[p].name), ...nodes); }
function pairState(s) {
  const key = s.phase + ':' + (s.qi ?? '') + (s.phase === 'lobby' ? ':' + s.players : '') + (s.phase === 'question' ? ':' + (s.go !== false) : '');
  if (key === pair.rendered) return;
  pair.rendered = key;
  clearInterval(timerId); pair.fill.style.width = '0%';
  if (s.phase === 'lobby') {
    if (s.pre && !preloaded) { preloaded = true; s.pre.forEach(u => { const i = new Image(); i.src = u; }); }
    pair.players.forEach((pl, p) => pairHalf(p, [el('div', 'g-wait-dot'), el('p', 'g-sub', 'Ты в игре! Ждём остальных. Игроков: ' + (s.players || 0))]));
  } else if (s.phase === 'question') pairQuestion(s);
  else if (s.phase === 'reveal') {
    pair.players.forEach((pl, p) => {
      const mine = (s.scores || []).find(x => x.id === pl.id), ok = mine && mine.last && mine.last.ok;
      pairHalf(p, [el('div', 'duo-res ' + (ok ? 'g-ok' : 'g-bad'), ok ? 'Верно! +' + mine.last.pts : 'Неверно'),
        el('p', 'g-sub', ok ? '' : 'Правильный ответ: ' + s.options[s.correct]),
        el('div', 'duo-score', 'Очки: ' + (mine ? mine.score : 0) + ' · место ' + (mine ? s.scores.indexOf(mine) + 1 : '—'))]);
    });
  } else if (s.phase === 'end') {
    pair.players.forEach((pl, p) => {
      const sc = s.scores || [], i = sc.findIndex(x => x.id === pl.id);
      pairHalf(p, [el('div', 'g-result g-ok', i >= 0 ? (i + 1) + ' место' : 'Игра окончена!'), el('div', 'g-score', i >= 0 ? 'Очки: ' + sc[i].score : '')]);
    });
  }
}
function pairQuestion(s) {
  const go = s.go !== false, got = Date.now(), dur = Math.max(4000, s.dur * 1000 - (s.elapsed || 0));
  pair.players.forEach((pl, p) => {
    if (go && pl.answered === s.qi) { pairHalf(p, [el('div', 'g-wait-dot'), el('p', 'g-sub', 'Ответ принят! Ждём остальных…')]); return; }
    const grid = el('div', 'g-answers duo-answers');
    s.options.forEach((o, k) => {
      const btn = el('button', 'g-ans g-c' + k); btn.disabled = !go; btn.append(el('span', 'g-shape', SHAPES[k]), el('span', '', o));
      btn.addEventListener('pointerdown', ev => {
        ev.preventDefault(); if (!go || pl.answered === s.qi) return;
        pl.answered = s.qi;
        pairSend('/ans', { id: pl.id, name: pl.name, qi: s.qi, c: k, ms: Date.now() - got + (s.elapsed || 0) });
        if (navigator.vibrate) navigator.vibrate(15);
        pairHalf(p, [el('div', 'g-wait-dot'), el('p', 'g-sub', 'Ответ принят! Ждём остальных…')]);
      });
      grid.append(btn);
    });
    const nodes = [el('div', 'g-qnum', `Вопрос ${s.qi + 1} из ${s.total}`), el('div', 'duo-q', s.q)];
    if (s.img) { const im = el('img', 'duo-img'); im.src = s.img; nodes.push(im); }
    if (!go) nodes.push(el('div', 'g-loadnote', '⏳ Ждём, пока загрузится у всех…'));
    pairHalf(p, [...nodes, grid]);
  });
  if (!go) {                                          // сообщить учителю «готово» за обоих
    const ready = () => pair.players.forEach(pl => { if (pl.readySent !== s.qi) { pl.readySent = s.qi; pairSend('/ans', { id: pl.id, name: pl.name, qi: s.qi, ready: 1 }); } });
    if (s.img) { const i = new Image(); i.onload = i.onerror = ready; i.src = s.img; setTimeout(ready, 8000); } else ready();
    return;
  }
  timerId = setInterval(() => {
    const left = Math.max(0, dur - (Date.now() - got)); pair.fill.style.width = (100 * left / (s.dur * 1000)) + '%';
    if (!left) {
      clearInterval(timerId);
      pair.players.forEach((pl, p) => { if (pl.answered !== s.qi) pairHalf(p, [el('p', 'g-sub', 'Время вышло')]); });
    }
  }, 100);
}

// ссылка вида ?pin=123456 сразу открывает вход ученика
if (new URLSearchParams(location.search).get('pin')) setTimeout(menu, 300);
})();
