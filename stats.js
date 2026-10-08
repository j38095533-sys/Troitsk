'use strict';
// © 2026 Олег Бурылов. Подпись автора: TSV-OLEG-2026-aef4bc14a4b0
// Анонимная статистика для программы Олега (TroitskStats): без имён и личных данных.
// Каждое устройство хранит у себя сводку (заходы, открытые места, игры) и кладёт её на MQTT-брокеры
// как «сохраняемое» сообщение — программа на ПК забирает все сводки, даже если была выключена.
(() => {
  const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  const ROOT = 'troitsk-stats/v1/';
  const KEY = 'troitsk-stats';
  if (location.hostname === 'localhost' || location.search.includes('debug')) return;   // свои тесты не считаем
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { S = null; }
  const now = Date.now();
  if (!S) S = { id: Math.random().toString(36).slice(2, 12), first: now, visits: 0, days: [], places: {}, games: {} };
  const today = new Date().toISOString().slice(0, 10);
  S.visits++; S.last = now;
  if (!S.days.includes(today)) S.days.push(today);
  if (S.days.length > 60) S.days = S.days.slice(-60);
  S.mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  S.sig = 'TSV-OLEG-2026-aef4bc14a4b0'.slice(-12);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  save();

  let clients = [], queue = [];
  const send = (topic, obj, retain) => {
    const msg = JSON.stringify(obj);
    const live = clients.filter(c => c.connected);
    if (!live.length) { queue.push([topic, msg, retain]); return; }
    live.forEach(c => c.publish(ROOT + topic, msg, { qos: 1, retain }));
  };
  let t = null;
  const pushSummary = () => { clearTimeout(t); t = setTimeout(() => send('dev/' + S.id, S, true), 800); };

  // события сайта → сводка + живая лента
  window.stat = (type, data = {}) => {
    try {
      if (type === 'place' && data.id) S.places[data.id] = (S.places[data.id] || 0) + 1;
      if (type === 'game' && data.kind) S.games[data.kind] = (S.games[data.kind] || 0) + 1;
      save(); pushSummary();
      send('live', { id: S.id, type, ...data, t: Date.now() }, false);
    } catch (e) {}
  };

  const start = () => {
    if (!window.mqtt) return setTimeout(start, 500);
    clients = BROKERS.map(url => {
      const c = mqtt.connect(url, { connectTimeout: 8000, reconnectPeriod: 5000, clean: true, keepalive: 30,
        clientId: 'ts_' + Math.random().toString(16).slice(2, 10) });
      c.on('error', () => {});
      c.on('connect', () => {
        c.publish(ROOT + 'dev/' + S.id, JSON.stringify(S), { qos: 1, retain: true });
        queue.forEach(([tp, m, r]) => c.publish(ROOT + tp, m, { qos: 1, retain: r }));
      });
      return c;
    });
    setTimeout(() => { queue = []; }, 20000);
    window.stat('visit', {});
  };
  start();
})();
