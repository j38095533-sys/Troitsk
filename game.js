'use strict';
// Викторина «как Kahoot»: учитель (по паролю) создаёт игру, ученики входят по коду.
// Связь — публичный MQTT-брокер по WebSocket; устройство учителя ведёт игру и считает очки.

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
function show(html) { screen.hidden = false; document.body.classList.add('in-game'); const box = $('game-box'); box.innerHTML = ''; box.append(...[].concat(html)); }
function close() { screen.hidden = true; document.body.classList.remove('in-game'); if (client) { try { client.end(true); } catch (e) {} client = null; } clearInterval(timerId); }
$('game-close').addEventListener('click', () => { if (role === 'host' && phase !== 'end' && phase !== 'menu' && !confirm('Закончить игру?')) return; if (role === 'host') publishState({ phase: 'end', scores: board() }); close(); });

// ---------- подключение к брокеру ----------
let client = null;
function connect(idx) {
  return new Promise((res, rej) => {
    const c = mqtt.connect(BROKERS[idx], { connectTimeout: 7000, reconnectPeriod: 2000, clean: true,
      clientId: 'tq_' + Math.random().toString(16).slice(2, 10) });
    const t = setTimeout(() => { c.end(true); rej(new Error('timeout')); }, 8000);
    c.once('connect', () => { clearTimeout(t); res(c); });
    c.once('error', () => {});
  });
}
async function connectAny(prefer) {
  const order = prefer != null ? [prefer] : BROKERS.map((_, i) => i);
  for (const i of order) { try { return { c: await connect(i), i }; } catch (e) {} }
  throw new Error('Нет связи с сервером игры. Проверьте интернет.');
}

// ---------- меню ----------
let role = null, phase = 'menu';
function menu() {
  role = null; phase = 'menu';
  const pin = new URLSearchParams(location.search).get('pin');
  const b1 = el('button', 'g-big g-student', 'Я ученик'), b2 = el('button', 'g-big g-teacher', 'Я учитель');
  b1.onclick = () => studentJoin(pin); b2.onclick = teacherLogin;
  show([el('h2', 'g-title', 'Викторина «Троицк сквозь время»'),
    el('p', 'g-sub', 'Учитель создаёт игру, ученики входят по коду со своих телефонов.'), b1, b2]);
  if (pin) studentJoin(pin);
}
window.openGame = menu;

// ---------- ученик ----------
let me = null, myScore = 0, answeredQ = -1, lastState = null;
function studentJoin(pin) {
  role = 'student';
  const inPin = el('input', 'g-input'); inPin.inputMode = 'numeric'; inPin.maxLength = 6; inPin.placeholder = 'Код игры (6 цифр)'; inPin.value = pin || '';
  const inName = el('input', 'g-input'); inName.maxLength = 18; inName.placeholder = 'Твоё имя'; inName.value = store.get('tq-name', '');
  const err = el('div', 'g-err'); const go = el('button', 'g-big g-student', 'Войти в игру');
  go.onclick = async () => {
    const p = inPin.value.replace(/\D/g, ''), n = inName.value.trim();
    if (p.length !== 6) { err.textContent = 'Код — 6 цифр с экрана учителя'; return; }
    if (!n) { err.textContent = 'Напиши имя'; return; }
    store.set('tq-name', n); go.disabled = true; err.textContent = 'Подключаюсь…';
    try {
      const { c } = await connectAny(+p[0] - 1); client = c;
      me = { id: store.get('tq-id', null) || Math.random().toString(36).slice(2, 10), name: n, pin: p };
      store.set('tq-id', me.id);
      client.subscribe(ROOT + p + '/state', { qos: 1 });
      client.on('message', (t, m) => { if (!m.length) return; try { onState(JSON.parse(m.toString())); } catch (e) {} });
      const hello = () => client.publish(ROOT + p + '/join', JSON.stringify({ id: me.id, name: n }), { qos: 1 });
      hello(); client.on('connect', hello);
      waitScreen('Ты в игре, ' + n + '!', 'Смотри на экран учителя — скоро начнём.');
      setTimeout(() => { if (!lastState) waitScreen('Ждём учителя…', 'Проверь код: ' + p + '. Если игра ещё не создана — подожди.'); }, 6000);
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  };
  show([el('h2', 'g-title', 'Вход в игру'), inPin, inName, go, err]);
}
function waitScreen(t, s) { show([el('div', 'g-wait-dot'), el('h2', 'g-title', t), el('p', 'g-sub', s)]); }

let timerId = null;
function onState(s) {
  lastState = s;
  if (s.phase === 'lobby') waitScreen('Ты в игре, ' + me.name + '!', 'Ждём остальных. Игроков: ' + (s.players || 0));
  else if (s.phase === 'question') studentQuestion(s);
  else if (s.phase === 'reveal') studentReveal(s);
  else if (s.phase === 'end') studentEnd(s);
}
function studentQuestion(s) {
  if (answeredQ === s.qi) return;                      // уже ответил на этот вопрос
  const got = Date.now(), dur = s.dur * 1000 - (s.elapsed || 0);
  const bar = el('div', 'g-timer'); const fill = el('i'); bar.append(fill);
  const btns = el('div', 'g-answers');
  s.options.forEach((o, i) => {
    const b = el('button', 'g-ans g-c' + i); b.append(el('span', 'g-shape', SHAPES[i]), el('span', '', o));
    b.onclick = () => {
      answeredQ = s.qi;
      client.publish(ROOT + me.pin + '/ans', JSON.stringify({ id: me.id, qi: s.qi, c: i, ms: Date.now() - got + (s.elapsed || 0) }), { qos: 1 });
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
    ploshad: 'Администрация', mikhail: 'Михайловская церковь', torg: 'Торговые ряды', erahtin: 'Дом Ерахтина', licey13: 'Лицей №13' };
  const places = [...new Set(b.map(q => q.place).filter(Boolean))];
  const sel = new Set(places);
  const chips = el('div', 'g-chips');
  places.forEach(p => { const c = el('button', 'g-chip on', placeNames[p] || p);
    c.onclick = () => { sel.has(p) ? sel.delete(p) : sel.add(p); c.classList.toggle('on'); count(); }; chips.append(c); });
  const nSel = el('select', 'g-input'); [5, 10, 15, 'все'].forEach(n => nSel.append(new Option(n === 'все' ? 'Все вопросы' : n + ' вопросов', n)));
  nSel.value = 10;
  const tSel = el('select', 'g-input'); [10, 20, 30].forEach(t => tSel.append(new Option(t + ' секунд на ответ', t))); tSel.value = 20;
  const info = el('p', 'g-sub');
  const count = () => { const n = b.filter(q => !q.place || sel.has(q.place)).length + own.length; info.textContent = `Доступно вопросов: ${n} (своих: ${own.length})`; };
  count();
  const go = el('button', 'g-big g-teacher', 'Создать игру');
  go.onclick = () => {
    let qs = shuffle(b.filter(q => !q.place || sel.has(q.place)).concat(own));
    if (nSel.value !== 'все') qs = qs.slice(0, +nSel.value);
    if (!qs.length) { info.textContent = 'Выберите хотя бы одно место'; return; }
    hostGame(qs, +tSel.value);
  };
  const addOwn = el('button', 'g-link', '+ Добавить свой вопрос'); addOwn.onclick = ownEditor;
  show([el('h2', 'g-title', 'Новая игра'), el('p', 'g-sub', 'Вопросы по местам:'), chips, nSel, tSel, info, go, addOwn]);
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
function publishState(s) { if (client && H) client.publish(ROOT + H.pin + '/state', JSON.stringify(s), { qos: 1, retain: true }); }
const board = () => H ? [...H.players.values()].sort((a, b) => b.score - a.score) : [];

async function hostGame(qs, dur) {
  phase = 'connecting'; waitScreen('Создаю игру…', 'Подключаюсь к серверу игры');
  let c, i;
  try { ({ c, i } = await connectAny()); } catch (e) { show([el('h2', 'g-title', 'Нет связи'), el('p', 'g-sub', e.message)]); return; }
  client = c;
  const pin = String(i + 1) + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  // перемешиваем варианты, запоминаем правильный
  qs = qs.map(q => { const order = shuffle([0, 1, 2, 3]); return { ...q, options: order.map(k => q.options[k]), a: order.indexOf(q.a) }; });
  H = { pin, qs, dur, players: new Map(), qi: -1, answers: new Map() };
  client.subscribe([ROOT + pin + '/join', ROOT + pin + '/ans'], { qos: 1 });
  client.on('message', (t, m) => {
    let d; try { d = JSON.parse(m.toString()); } catch (e) { return; }
    if (t.endsWith('/join') && d.id && d.name) {
      if (!H.players.has(d.id)) H.players.set(d.id, { id: d.id, name: String(d.name).slice(0, 18), score: 0, last: null });
      if (phase === 'lobby') { lobby(); publishState({ phase: 'lobby', players: H.players.size }); }
      else republish();
    }
    if (t.endsWith('/ans') && phase === 'question' && d.qi === H.qi && H.players.has(d.id) && !H.answers.has(d.id)) {
      H.answers.set(d.id, { c: d.c, ms: Math.min(+d.ms || 0, H.dur * 1000) });
      $('g-anscount') && ($('g-anscount').textContent = `Ответили: ${H.answers.size} из ${H.players.size}`);
      if (H.answers.size >= H.players.size) reveal();
    }
  });
  phase = 'lobby'; publishState({ phase: 'lobby', players: 0 }); lobby();
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
  H.qi++; H.answers = new Map();
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
  show([...parts, bar, grid, cnt, skip]);
  clearInterval(timerId);
  timerId = setInterval(() => {
    const left = Math.max(0, H.dur * 1000 - (Date.now() - H.t0)); fill.style.width = (100 * left / (H.dur * 1000)) + '%';
    if (!left) reveal();
  }, 100);
}
function sendQuestion(again) {
  const q = H.qs[H.qi];
  publishState({ phase: 'question', qi: H.qi, total: H.qs.length, q: q.q, img: q.img || null, options: q.options, dur: H.dur,
    elapsed: again ? Date.now() - H.t0 : 0 });
}
function reveal() {
  if (phase !== 'question') return; phase = 'reveal'; clearInterval(timerId);
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

// ссылка вида ?pin=123456 сразу открывает вход ученика
if (new URLSearchParams(location.search).get('pin')) setTimeout(menu, 300);
})();
