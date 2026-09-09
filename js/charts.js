/* =====================================================================
   charts.js — gráficos desenhados em SVG puro (sem bibliotecas)
   Todos usam viewBox, então escalam sozinhos junto com o container.
   Exposto em FIN.Charts
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.Charts = (function () {
  'use strict';

  var U = FIN.Utils;

  /* ---------- apoio ---------- */

  /** Em telas estreitas o desenho usa um viewBox menor, para o texto
      não ficar minúsculo depois da escala. */
  function isNarrow() {
    return typeof window !== 'undefined' && window.innerWidth && window.innerWidth <= 720;
  }

  /** Escolhe um teto "redondo" para o eixo (100, 250, 500, 1.000...) */
  function niceMax(value) {
    if (!value || value <= 0) return 100;
    var exp = Math.floor(Math.log(value) / Math.LN10);
    var pow = Math.pow(10, exp);
    var n = value / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  function emptyState(message) {
    return '<p class="hint" style="text-align:center;padding:26px 0">' + U.escapeHTML(message) + '</p>';
  }

  function polar(cx, cy, r, angle) {
    var rad = (angle - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function donutSlice(cx, cy, rOut, rIn, start, end) {
    var a = polar(cx, cy, rOut, end), b = polar(cx, cy, rOut, start);
    var c = polar(cx, cy, rIn, start), d = polar(cx, cy, rIn, end);
    var large = end - start > 180 ? 1 : 0;
    return [
      'M', a.x.toFixed(2), a.y.toFixed(2),
      'A', rOut, rOut, 0, large, 0, b.x.toFixed(2), b.y.toFixed(2),
      'L', c.x.toFixed(2), c.y.toFixed(2),
      'A', rIn, rIn, 0, large, 1, d.x.toFixed(2), d.y.toFixed(2),
      'Z'
    ].join(' ');
  }

  /* ------------------------------------------------------------------
     1) Barras agrupadas — receitas x despesas por mês
     data = { labels: [], income: [], expense: [] }
     ------------------------------------------------------------------ */
  function bars(container, data) {
    if (!container) return;
    var n = data.labels.length;
    var maxValue = Math.max.apply(null, data.income.concat(data.expense).concat([0]));

    if (!n || maxValue <= 0) {
      container.innerHTML = emptyState('Ainda não há valores para comparar nestes meses.');
      return;
    }

    var narrow = isNarrow();
    var W = narrow ? 380 : 700, H = narrow ? 230 : 260;
    var padL = narrow ? 46 : 52, padR = 8, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var top = niceMax(maxValue);
    var slot = plotW / n;
    var barW = Math.min(narrow ? 14 : 26, slot / 3.2);
    var gap = 5;

    var svg = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Receitas e despesas por mês">'];

    // linhas de grade e rótulos do eixo Y
    for (var g = 0; g <= 4; g++) {
      var val = top * (g / 4);
      var y = padT + plotH - (val / top) * plotH;
      svg.push('<line class="grid-line" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>');
      svg.push('<text x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + U.short(val) + '</text>');
    }

    data.labels.forEach(function (label, i) {
      var cx = padL + slot * i + slot / 2;
      var hIn = (data.income[i] / top) * plotH;
      var hOut = (data.expense[i] / top) * plotH;

      svg.push('<rect class="bar" x="' + (cx - barW - gap / 2).toFixed(1) + '" y="' + (padT + plotH - hIn).toFixed(1) +
        '" width="' + barW + '" height="' + Math.max(hIn, 0).toFixed(1) + '" rx="3" fill="var(--in)">' +
        '<title>' + label + ' · receitas ' + U.money(data.income[i]) + '</title></rect>');

      svg.push('<rect class="bar" x="' + (cx + gap / 2).toFixed(1) + '" y="' + (padT + plotH - hOut).toFixed(1) +
        '" width="' + barW + '" height="' + Math.max(hOut, 0).toFixed(1) + '" rx="3" fill="var(--out)">' +
        '<title>' + label + ' · despesas ' + U.money(data.expense[i]) + '</title></rect>');

      svg.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + label + '</text>');
    });

    svg.push('<line class="axis" x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '"/>');
    svg.push('</svg>');

    svg.push('<ul class="legend" style="flex-direction:row;gap:18px;margin-top:10px;justify-content:center">' +
      '<li><span class="swatch" style="background:var(--in)"></span>Receitas</li>' +
      '<li><span class="swatch" style="background:var(--out)"></span>Despesas</li></ul>');

    container.innerHTML = svg.join('');
  }

  /* ------------------------------------------------------------------
     2) Rosca — distribuição dos gastos
     items = [{ label, value, color }]
     ------------------------------------------------------------------ */
  function donut(container, items, centerLabel) {
    if (!container) return;
    var total = items.reduce(function (s, i) { return s + i.value; }, 0);

    if (!items.length || total <= 0) {
      container.innerHTML = emptyState('Sem gastos no mês.');
      return;
    }

    var size = 160, cx = size / 2, cy = size / 2, rOut = 74, rIn = 50;
    var svg = ['<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Distribuição dos gastos">'];
    var angle = 0;

    items.forEach(function (item) {
      var share = item.value / total;
      var sweep = share * 360;
      if (sweep >= 359.99) {
        // fatia única: dois anéis completos evitam artefato de arco fechado
        svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + ((rOut + rIn) / 2) + '" fill="none" stroke="' + item.color +
          '" stroke-width="' + (rOut - rIn) + '"><title>' + U.escapeHTML(item.label) + ' · ' + U.money(item.value) + '</title></circle>');
      } else {
        svg.push('<path class="bar" d="' + donutSlice(cx, cy, rOut, rIn, angle, angle + sweep) + '" fill="' + item.color + '">' +
          '<title>' + U.escapeHTML(item.label) + ' · ' + U.money(item.value) +
          ' (' + (share * 100).toFixed(1).replace('.', ',') + '%)</title></path>');
      }
      angle += sweep;
    });

    svg.push('<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" style="font-size:9px">' + (centerLabel || 'Total') + '</text>');
    svg.push('<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" style="font-size:13px;font-weight:600;fill:var(--text)">' +
      U.money(total).replace('R$\u00a0', 'R$ ') + '</text>');
    svg.push('</svg>');

    container.innerHTML = svg.join('');
  }

  /* ------------------------------------------------------------------
     3) Linha — evolução do saldo mensal (aceita valores negativos)
     data = { labels: [], values: [] }
     ------------------------------------------------------------------ */
  function line(container, data) {
    if (!container) return;
    var n = data.labels.length;
    if (!n) { container.innerHTML = emptyState('Sem histórico suficiente.'); return; }

    var narrow = isNarrow();
    var W = narrow ? 380 : 700, H = narrow ? 220 : 240;
    var padL = narrow ? 46 : 52, padR = 12, padT = 16, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var maxV = Math.max.apply(null, data.values.concat([0]));
    var minV = Math.min.apply(null, data.values.concat([0]));
    var top = niceMax(maxV || 1);
    var bottom = minV < 0 ? -niceMax(Math.abs(minV)) : 0;
    var span = top - bottom || 1;

    function y(v) { return padT + plotH - ((v - bottom) / span) * plotH; }
    function x(i) { return n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1); }

    var svg = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Evolução do saldo mensal">'];

    for (var g = 0; g <= 4; g++) {
      var val = bottom + (span * g) / 4;
      var gy = y(val);
      svg.push('<line class="grid-line" x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '"/>');
      svg.push('<text x="' + (padL - 8) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end">' + U.short(val) + '</text>');
    }

    // linha do zero em destaque
    svg.push('<line class="axis" x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(0).toFixed(1) + '"/>');

    var pts = data.values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    var area = 'M' + x(0).toFixed(1) + ',' + y(0).toFixed(1) + ' L' + pts.join(' L') +
      ' L' + x(n - 1).toFixed(1) + ',' + y(0).toFixed(1) + ' Z';

    svg.push('<defs><linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/>' +
      '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>');
    svg.push('<path d="' + area + '" fill="url(#lineFill)"/>');
    svg.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');

    data.values.forEach(function (v, i) {
      svg.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="var(--surface)" stroke="' +
        (v < 0 ? 'var(--out)' : 'var(--accent)') + '" stroke-width="2.5">' +
        '<title>' + data.labels[i] + ' · ' + U.money(v) + '</title></circle>');
      svg.push('<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + data.labels[i] + '</text>');
    });

    svg.push('</svg>');
    container.innerHTML = svg.join('');
  }

  return { bars: bars, donut: donut, line: line, niceMax: niceMax };
})();
