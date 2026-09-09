/* =====================================================================
   storage.js — única camada que fala com o localStorage
   Guarda lançamentos, preferências e metadados. Exposto em FIN.Storage
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.Storage = (function () {
  'use strict';

  var KEYS = {
    tx: 'caixa:v1:transactions',
    prefs: 'caixa:v1:prefs',
    meta: 'caixa:v1:meta'
  };

  var memoryFallback = {}; // usado quando o localStorage está bloqueado
  var available = (function () {
    try {
      var k = '__caixa_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function readRaw(key) {
    try {
      return available ? window.localStorage.getItem(key) : (memoryFallback[key] || null);
    } catch (e) { return null; }
  }

  function writeRaw(key, value) {
    try {
      if (available) window.localStorage.setItem(key, value);
      else memoryFallback[key] = value;
      return true;
    } catch (e) {
      memoryFallback[key] = value;
      return false;
    }
  }

  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (!raw) return fallback;
    try {
      var data = JSON.parse(raw);
      return data == null ? fallback : data;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) { return writeRaw(key, JSON.stringify(value)); }

  /* ---------- lançamentos ---------- */

  /** Garante que cada registro carregado tenha o formato esperado */
  function sanitize(t) {
    if (!t || typeof t !== 'object') return null;
    var inst = null;
    if (t.installment && t.installment.total > 1) {
      inst = {
        current: Number(t.installment.current) || 1,
        total: Number(t.installment.total) || 1,
        groupId: String(t.installment.groupId || ''),
        totalAmount: Number(t.installment.totalAmount) || 0
      };
    }
    return {
      id: String(t.id || ''),
      type: t.type === 'receita' ? 'receita' : 'despesa',
      description: String(t.description || '').trim(),
      amount: Number(t.amount) || 0,
      date: String(t.date || ''),
      category: t.category ? String(t.category) : '',
      paymentMethod: t.paymentMethod ? String(t.paymentMethod) : '',
      installment: inst,
      demo: !!t.demo,
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || t.createdAt || new Date().toISOString()
    };
  }

  function all() {
    var list = readJSON(KEYS.tx, []);
    if (!Array.isArray(list)) return [];
    return list.map(sanitize).filter(function (t) { return t && t.id && t.date; });
  }

  function saveAll(list) { return writeJSON(KEYS.tx, list); }

  function insertMany(items) {
    var list = all().concat(items.map(sanitize));
    saveAll(list);
    return items;
  }

  function insert(item) { return insertMany([item])[0]; }

  function getById(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function getGroup(groupId) {
    return all().filter(function (t) {
      return t.installment && t.installment.groupId === groupId;
    }).sort(function (a, b) { return a.installment.current - b.installment.current; });
  }

  function update(id, patch) {
    var list = all(), found = null;
    list = list.map(function (t) {
      if (t.id !== id) return t;
      found = sanitize(Object.assign({}, t, patch, {
        id: t.id, createdAt: t.createdAt, updatedAt: new Date().toISOString()
      }));
      return found;
    });
    saveAll(list);
    return found;
  }

  function remove(id) {
    saveAll(all().filter(function (t) { return t.id !== id; }));
  }

  function removeGroup(groupId) {
    saveAll(all().filter(function (t) {
      return !(t.installment && t.installment.groupId === groupId);
    }));
  }

  function removeDemo() {
    saveAll(all().filter(function (t) { return !t.demo; }));
    setMeta({ demoLoaded: false });
  }

  function clearAll() {
    saveAll([]);
    setMeta({ demoLoaded: false, seeded: true });
  }

  function replaceAll(items) {
    var clean = (items || []).map(sanitize).filter(function (t) { return t && t.id && t.date; });
    saveAll(clean);
    return clean.length;
  }

  function hasDemo() {
    return all().some(function (t) { return t.demo; });
  }

  /* ---------- preferências e metadados ---------- */
  function getPrefs() {
    return Object.assign({ theme: 'light', sortBy: 'date', sortDir: 'desc' }, readJSON(KEYS.prefs, {}));
  }
  function setPrefs(patch) {
    var next = Object.assign(getPrefs(), patch);
    writeJSON(KEYS.prefs, next);
    return next;
  }

  function getMeta() {
    return Object.assign({ seeded: false, demoLoaded: false }, readJSON(KEYS.meta, {}));
  }
  function setMeta(patch) {
    var next = Object.assign(getMeta(), patch);
    writeJSON(KEYS.meta, next);
    return next;
  }

  return {
    isAvailable: available,
    all: all, saveAll: saveAll,
    insert: insert, insertMany: insertMany,
    getById: getById, getGroup: getGroup,
    update: update, remove: remove, removeGroup: removeGroup,
    removeDemo: removeDemo, clearAll: clearAll, replaceAll: replaceAll, hasDemo: hasDemo,
    getPrefs: getPrefs, setPrefs: setPrefs,
    getMeta: getMeta, setMeta: setMeta
  };
})();
