/* =====================================================================
   dashboard.js — cálculos financeiros e renderização do painel
   Nada aqui grava dados: apenas lê a lista e desenha. FIN.Dashboard
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.Dashboard = (function () {
  'use strict';

  var U = FIN.Utils;
  var T = FIN.Transactions;
  var C = FIN.Charts;
  var Cfg = FIN.Config;

  /* ------------------------------------------------------------------
     CÁLCULOS
     ------------------------------------------------------------------ */

  function sum(list) {
    return U.round2(list.reduce(function (s, t) { return s + t.amount; }, 0));
  }

  function totalsOf(list) {
    var income = sum(list.filter(function (t) { return t.type === 'receita'; }));
    var expense = sum(list.filter(function (t) { return t.type === 'despesa'; }));
    return { income: income, expense: expense, balance: U.round2(income - expense) };
  }

  /** Agrupa despesas por um campo, ordenado do maior para o menor */
  function groupExpenses(list, field, emptyLabel) {
    var map = {};
    list.filter(function (t) { return t.type === 'despesa'; }).forEach(function (t) {
      var key = t[field] || emptyLabel;
      map[key] = U.round2((map[key] || 0) + t.amount);
    });
    return Object.keys(map).map(function (k) {
      return { label: k, value: map[k] };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  /**
   * Resumo completo do mês selecionado.
   * `upcoming` = despesas do mês que ainda não venceram (data > hoje).
   */
  function compute(list, monthKey) {
    var month = T.byMonth(list, monthKey);
    var totals = totalsOf(month);
    var today = U.todayISO();

    var upcoming = sum(month.filter(function (t) {
      return t.type === 'despesa' && t.date > today;
    }));

    var topExpenses = month.filter(function (t) { return t.type === 'despesa'; })
      .sort(function (a, b) { return b.amount - a.amount; })
      .slice(0, 5);

    // histórico dos 6 meses que terminam no mês selecionado
    var historyKeys = U.monthRange(U.addMonthsToKey(monthKey, -5), 6);
    var history = historyKeys.map(function (key) {
      var t = totalsOf(T.byMonth(list, key));
      return { key: key, label: U.monthLabelShort(key), income: t.income, expense: t.expense, balance: t.balance };
    });

    // compromissos dos próximos meses
    var futureKeys = U.monthRange(U.addMonthsToKey(monthKey, 1), Cfg.futureMonths);
    var future = futureKeys.map(function (key) {
      var items = T.byMonth(list, key).filter(function (t) { return t.type === 'despesa'; });
      var incomes = T.byMonth(list, key).filter(function (t) { return t.type === 'receita'; });
      return {
        key: key,
        label: U.monthLabel(key),
        expense: sum(items),
        income: sum(incomes),
        count: items.length,
        installmentValue: sum(items.filter(function (t) { return !!t.installment; })),
        items: items.sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      };
    });

    return {
      monthKey: monthKey,
      month: month,
      income: totals.income,
      expense: totals.expense,
      balance: totals.balance,
      upcoming: upcoming,
      count: month.length,
      incomeCount: month.filter(function (t) { return t.type === 'receita'; }).length,
      expenseCount: month.filter(function (t) { return t.type === 'despesa'; }).length,
      byCategory: groupExpenses(month, 'category', 'Sem categoria'),
      byPayment: groupExpenses(month, 'paymentMethod', 'Sem forma de pagamento'),
      topExpenses: topExpenses,
      history: history,
      future: future,
      futureTotal: U.round2(future.reduce(function (s, f) { return s + f.expense; }, 0))
    };
  }

  /** Compras parceladas com parcelas ainda a vencer depois do mês de referência */
  function openInstallments(list, monthKey) {
    var groups = {};
    list.forEach(function (t) {
      if (!t.installment) return;
      var g = groups[t.installment.groupId];
      if (!g) {
        g = groups[t.installment.groupId] = {
          groupId: t.installment.groupId,
          description: t.description,
          total: t.installment.total,
          totalAmount: t.installment.totalAmount,
          category: t.category,
          paymentMethod: t.paymentMethod,
          paid: 0, remaining: 0, remainingValue: 0, nextDate: null
        };
      }
      if (U.monthKey(t.date) <= monthKey) {
        g.paid++;
      } else {
        g.remaining++;
        g.remainingValue = U.round2(g.remainingValue + t.amount);
        if (!g.nextDate || t.date < g.nextDate) g.nextDate = t.date;
      }
    });

    return Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.remaining > 0; })
      .sort(function (a, b) { return b.remainingValue - a.remainingValue; });
  }

  /* ------------------------------------------------------------------
     RENDERIZAÇÃO — PAINEL
     ------------------------------------------------------------------ */

  function renderCards(s) {
    var negative = s.balance < 0;
    U.qs('#balanceMonth').textContent = U.monthLabel(s.monthKey).toLowerCase();
    var balanceEl = U.qs('#balanceValue');
    balanceEl.textContent = U.money(s.balance);
    balanceEl.classList.toggle('is-negative', negative);

    U.qs('#balanceHint').textContent = negative
      ? 'As despesas superaram as receitas em ' + U.money(Math.abs(s.balance)) + '.'
      : s.income === 0 && s.expense === 0
        ? 'Nenhum movimento registrado neste mês.'
        : 'Sobra de ' + U.money(s.balance) + ' sobre as receitas do mês.';

    var total = s.income + s.expense;
    U.qs('#barIn').style.width = total ? (s.income / total * 100) + '%' : '0%';
    U.qs('#barOut').style.width = total ? (s.expense / total * 100) + '%' : '0%';
    U.qs('#heroIn').textContent = U.money(s.income);
    U.qs('#heroOut').textContent = U.money(s.expense);

    U.qs('#cardIncome').textContent = U.money(s.income);
    U.qs('#cardIncomeFoot').textContent = s.incomeCount === 1 ? '1 entrada' : s.incomeCount + ' entradas';
    U.qs('#cardExpense').textContent = U.money(s.expense);
    U.qs('#cardExpenseFoot').textContent = s.expenseCount === 1 ? '1 saída' : s.expenseCount + ' saídas';
    U.qs('#cardUpcoming').textContent = U.money(s.upcoming);
    U.qs('#cardCount').textContent = String(s.count);
    U.qs('#cardCountFoot').textContent = 'em ' + U.monthLabel(s.monthKey).toLowerCase();
    U.qs('#catMonth').textContent = U.monthLabel(s.monthKey);
  }

  function renderCategory(s) {
    var items = s.byCategory.map(function (c) {
      return { label: c.label, value: c.value, color: Cfg.categoryColors[c.label] || 'var(--muted)' };
    });

    C.donut(U.qs('#chartDonut'), items, 'Gasto no mês');

    var legend = U.qs('#catLegend');
    if (!items.length) { legend.innerHTML = ''; return; }
    var total = items.reduce(function (a, i) { return a + i.value; }, 0);
    legend.innerHTML = items.map(function (i) {
      var pct = total ? (i.value / total * 100) : 0;
      return '<li>' +
        '<span class="swatch" style="background:' + i.color + '"></span>' +
        '<span class="lg-name">' + U.escapeHTML(i.label) + '</span>' +
        '<span class="lg-val">' + U.money(i.value) + '</span>' +
        '<span class="lg-pct">' + pct.toFixed(0) + '%</span>' +
        '</li>';
    }).join('');
  }

  function renderPayments(s) {
    var box = U.qs('#paymentBreak');
    if (!s.byPayment.length) {
      box.innerHTML = '<p class="hint" style="text-align:center;padding:26px 0">Nenhuma despesa registrada neste mês.</p>';
      return;
    }
    var max = s.byPayment[0].value;
    box.innerHTML = '<div class="meter">' + s.byPayment.map(function (p) {
      var color = Cfg.paymentColors[p.label] || 'var(--muted)';
      var pct = max ? Math.max(3, (p.value / max) * 100) : 0;
      var share = s.expense ? (p.value / s.expense * 100).toFixed(0) : 0;
      return '<div class="meter__row">' +
        '<span class="meter__name">' + U.escapeHTML(p.label) + ' <span class="lg-pct">' + share + '%</span></span>' +
        '<span class="meter__val">' + U.money(p.value) + '</span>' +
        '<span class="meter__track"><span class="meter__fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderTop(s) {
    var box = U.qs('#topExpenses');
    if (!s.topExpenses.length) {
      box.innerHTML = '<p class="hint" style="text-align:center;padding:26px 0">Nenhuma despesa registrada neste mês.</p>';
      return;
    }
    box.innerHTML = '<ul class="ranklist">' + s.topExpenses.map(function (t) {
      var meta = [U.dateBR(t.date), t.category || 'Sem categoria', t.paymentMethod || '—'].join(' · ');
      var badge = t.installment ? ' <span class="tag tag--inst">' + T.installmentLabel(t) + '</span>' : '';
      return '<li>' +
        '<div class="rank__main"><div class="rank__name">' + U.escapeHTML(t.description) + badge + '</div>' +
        '<div class="rank__meta">' + U.escapeHTML(meta) + '</div></div>' +
        '<div class="rank__val">' + U.money(t.amount) + '</div>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function renderCharts(s) {
    C.bars(U.qs('#chartBars'), {
      labels: s.history.map(function (h) { return h.label; }),
      income: s.history.map(function (h) { return h.income; }),
      expense: s.history.map(function (h) { return h.expense; })
    });

    C.line(U.qs('#chartLine'), {
      labels: s.history.map(function (h) { return h.label; }),
      values: s.history.map(function (h) { return h.balance; })
    });
  }

  function render(list, monthKey) {
    var s = compute(list, monthKey);
    renderCards(s);
    renderCategory(s);
    renderPayments(s);
    renderTop(s);
    renderCharts(s);
    return s;
  }

  /* ------------------------------------------------------------------
     RENDERIZAÇÃO — VISÃO FUTURA
     ------------------------------------------------------------------ */
  function renderFuture(list, monthKey) {
    var s = compute(list, monthKey);
    var box = U.qs('#futureList');
    var max = Math.max.apply(null, s.future.map(function (f) { return f.expense; }).concat([1]));

    var strip = '<div class="summary-strip">' +
      '<div>Total comprometido<b>' + U.money(s.futureTotal) + '</b></div>' +
      '<div>Em parcelas<b>' + U.money(s.future.reduce(function (a, f) { return a + f.installmentValue; }, 0)) + '</b></div>' +
      '<div>Próximos meses<b>' + Cfg.futureMonths + '</b></div>' +
      '</div>';

    var rows = s.future.map(function (f) {
      return '<div class="futurerow">' +
        '<span class="futurerow__month">' + U.escapeHTML(f.label) + '</span>' +
        '<span class="futurerow__val">' + U.money(f.expense) + '</span>' +
        '<span class="futurerow__meta">' + f.count + (f.count === 1 ? ' lançamento' : ' lançamentos') +
        (f.installmentValue ? ' · ' + U.money(f.installmentValue) + ' em parcelas' : '') + '</span>' +
        '<span class="futurerow__track"><span class="futurerow__fill" style="width:' +
        (f.expense / max * 100).toFixed(1) + '%"></span></span>' +
        '</div>';
    }).join('');

    box.innerHTML = strip + (s.futureTotal > 0 ? rows :
      '<p class="hint" style="text-align:center;padding:20px 0">Nenhuma despesa lançada para os próximos meses.</p>' + rows);

    // --- parcelas em aberto ---
    var open = openInstallments(list, monthKey);
    var openBox = U.qs('#openInstallments');
    if (!open.length) {
      openBox.innerHTML = '<p class="hint" style="text-align:center;padding:26px 0">Nenhuma compra parcelada em aberto.</p>';
    } else {
      openBox.innerHTML = '<ul class="ranklist">' + open.map(function (g) {
        var meta = 'Faltam ' + g.remaining + ' de ' + g.total + ' · próxima em ' + U.dateBR(g.nextDate) +
          ' · ' + (g.paymentMethod || '—');
        return '<li>' +
          '<div class="rank__main"><div class="rank__name">' + U.escapeHTML(g.description) +
          ' <span class="tag tag--inst">' + g.paid + '/' + g.total + ' pagas</span></div>' +
          '<div class="rank__meta">' + U.escapeHTML(meta) + '</div></div>' +
          '<div class="rank__val">' + U.money(g.remainingValue) + '</div>' +
          '</li>';
      }).join('') + '</ul>';
    }

    // --- detalhe dos lançamentos futuros ---
    var detail = U.qs('#futureDetail');
    var withItems = s.future.filter(function (f) { return f.items.length; });
    if (!withItems.length) {
      detail.innerHTML = '<p class="hint" style="text-align:center;padding:26px 0">Nada agendado depois de ' +
        U.escapeHTML(U.monthLabel(monthKey)) + '.</p>';
      return s;
    }

    detail.innerHTML = withItems.map(function (f) {
      return '<section class="futuregroup">' +
        '<header class="futuregroup__head">' +
        '<span class="futurerow__month">' + U.escapeHTML(f.label) + '</span>' +
        '<span class="futurerow__val">' + U.money(f.expense) + '</span></header>' +
        '<ul class="ranklist">' + f.items.map(function (t) {
          var badge = t.installment ? ' <span class="tag tag--inst">' + T.installmentLabel(t) + '</span>' : '';
          return '<li><div class="rank__main">' +
            '<div class="rank__name">' + U.escapeHTML(t.description) + badge + '</div>' +
            '<div class="rank__meta">' + U.dateBR(t.date) + ' · ' + U.escapeHTML(t.category || 'Sem categoria') +
            ' · ' + U.escapeHTML(t.paymentMethod || '—') + '</div></div>' +
            '<div class="rank__val">' + U.money(t.amount) + '</div></li>';
        }).join('') + '</ul></section>';
    }).join('');

    return s;
  }

  return {
    compute: compute,
    totalsOf: totalsOf,
    groupExpenses: groupExpenses,
    openInstallments: openInstallments,
    render: render,
    renderFuture: renderFuture
  };
})();
