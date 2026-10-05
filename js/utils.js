/* =====================================================================
   utils.js — funções de apoio usadas por todos os módulos
   Sem dependências. Exposto em window.FIN.Utils
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.Config = {
  categories: ['Pessoal', 'Trabalho', 'Casa', 'Hyper Logic 3D'],
  payments: ['Inter (N)', 'Inter (J)', 'Nubank (N)', 'Bradesco', 'Mercado Pago', 'Pessoal'],
  // Cores usadas em gráficos e legendas (batem com as variáveis do CSS)
  categoryColors: {
    'Pessoal': 'var(--cat-pessoal)',
    'Trabalho': 'var(--cat-trabalho)',
    'Casa': 'var(--cat-casa)',
    'Hyper Logic 3D': 'var(--cat-hyper)',
    'Sem categoria': 'var(--muted)'
  },
  paymentColors: {
    'Inter (N)': '#e8730a',
    'Inter (J)': '#f0a44a',
    'Nubank (N)': '#8a2be2',
    'Bradesco': '#cc092f',
    'Mercado Pago': '#00a5e0',
    'Pessoal': '#0d9488',
    'Sem forma de pagamento': 'var(--muted)'
  },
  futureMonths: 6 // quantos meses adiante projetar
};

FIN.Utils = (function () {
  'use strict';

  var MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /* ---------- identificadores ---------- */
  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  /* ---------- números e moeda ---------- */
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  /** 1234.5 -> "R$ 1.234,50" */
  function money(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  /** 1234.5 -> "1.234,50" (sem o símbolo) */
  function number(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  /** Versão curta para eixos de gráfico: 1250 -> "1,3 mil" */
  function short(n) {
    var v = Number(n) || 0;
    var abs = Math.abs(v);
    if (abs >= 1000000) return (v / 1000000).toFixed(1).replace('.', ',') + ' mi';
    if (abs >= 1000) return (v / 1000).toFixed(1).replace('.', ',') + ' mil';
    return String(Math.round(v));
  }

  /** "1.234,50" ou "1234,5" ou "1234.5" -> 1234.5 */
  function parseMoney(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    var s = String(str).trim().replace(/[R$\s]/g, '');
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /** Máscara progressiva: o usuário digita "1500" e vê "1.500,00" */
  function maskMoney(raw) {
    var digits = String(raw || '').replace(/\D/g, '').slice(0, 12);
    if (!digits) return '';
    var cents = parseInt(digits, 10) / 100;
    return number(cents);
  }

  /* ---------- datas (sempre em ISO "YYYY-MM-DD", sem fuso) ---------- */
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isValidISO(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
    var p = iso.split('-').map(Number);
    if (p[1] < 1 || p[1] > 12) return false;
    var last = new Date(p[0], p[1], 0).getDate();
    return p[2] >= 1 && p[2] <= last;
  }

  /** "2026-09-10" -> "10-09-2026" (formato exibido em toda a interface) */
  function dateBR(iso) {
    if (!isValidISO(iso)) return '—';
    var p = iso.split('-');
    return p[2] + '-' + p[1] + '-' + p[0];
  }

  /** "10-09-2026" (ou só os dígitos) -> "2026-09-10"; devolve '' se não for válida */
  function isoFromBR(str) {
    var d = String(str || '').replace(/\D/g, '');
    if (d.length !== 8) return '';
    var iso = d.slice(4, 8) + '-' + d.slice(2, 4) + '-' + d.slice(0, 2);
    return isValidISO(iso) ? iso : '';
  }

  /** Máscara progressiva do campo de data: "1009" -> "10-09" */
  function maskDate(raw) {
    var d = String(raw || '').replace(/\D/g, '').slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return d.slice(0, 2) + '-' + d.slice(2);
    return d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4);
  }

  /** Soma meses preservando o dia (com ajuste para meses curtos) */
  function addMonths(iso, n) {
    var p = iso.split('-').map(Number);
    var total = (p[1] - 1) + n;
    var y = p[0] + Math.floor(total / 12);
    var m = ((total % 12) + 12) % 12;
    var lastDay = new Date(y, m + 1, 0).getDate();
    var d = Math.min(p[2], lastDay);
    return y + '-' + pad(m + 1) + '-' + pad(d);
  }

  /** "2026-09-10" -> "2026-09" */
  function monthKey(iso) { return String(iso || '').slice(0, 7); }

  function currentMonthKey() { return monthKey(todayISO()); }

  /** "2026-09" + 1 -> "2026-10" */
  function addMonthsToKey(key, n) {
    return monthKey(addMonths(key + '-01', n));
  }

  /** "2026-09" -> "Setembro 2026" */
  function monthLabel(key) {
    var p = String(key || '').split('-');
    if (p.length < 2) return '—';
    return MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }

  /** "2026-09" -> "set/26" */
  function monthLabelShort(key) {
    var p = String(key || '').split('-');
    if (p.length < 2) return '—';
    return MONTHS_SHORT[Number(p[1]) - 1] + '/' + p[0].slice(2);
  }

  /** Diferença em meses entre duas chaves: ("2026-09","2026-12") -> 3 */
  function monthDiff(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return (pb[0] - pa[0]) * 12 + (pb[1] - pa[1]);
  }

  /** Lista de chaves de mês, de `start` até `count` meses */
  function monthRange(startKey, count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(addMonthsToKey(startKey, i));
    return out;
  }

  /* ---------- DOM ---------- */
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function escapeHTML(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fillSelect(select, values, placeholder) {
    if (!select) return;
    select.innerHTML = '';
    if (placeholder != null) {
      var o = document.createElement('option');
      o.value = ''; o.textContent = placeholder;
      select.appendChild(o);
    }
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      select.appendChild(opt);
    });
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait || 180);
    };
  }

  /** Remove acentos e caixa, para busca textual tolerante */
  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  return {
    uid: uid, round2: round2, money: money, number: number, short: short,
    parseMoney: parseMoney, maskMoney: maskMoney,
    todayISO: todayISO, isValidISO: isValidISO, dateBR: dateBR,
    isoFromBR: isoFromBR, maskDate: maskDate, addMonths: addMonths,
    monthKey: monthKey, currentMonthKey: currentMonthKey, addMonthsToKey: addMonthsToKey,
    monthLabel: monthLabel, monthLabelShort: monthLabelShort, monthDiff: monthDiff,
    monthRange: monthRange,
    qs: qs, qsa: qsa, el: el, escapeHTML: escapeHTML, fillSelect: fillSelect,
    debounce: debounce, normalize: normalize,
    MONTHS: MONTHS
  };
})();
