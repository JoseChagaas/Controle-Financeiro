/* =====================================================================
   ui.js — componentes de interface (modais, formulário, tabela, avisos)
   Não conhece regras de negócio: recebe dados e devolve eventos. FIN.UI
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.UI = (function () {
  'use strict';

  var U = FIN.Utils;
  var T = FIN.Transactions;
  var Cfg = FIN.Config;

  var editCtx = null;      // { tx, group } quando o formulário está editando
  var lastFocused = null;  // devolve o foco ao fechar um modal

  /* ------------------------------------------------------------------
     AVISOS FLUTUANTES
     ------------------------------------------------------------------ */
  function toast(message, kind) {
    var box = U.qs('#toasts');
    var node = U.el('div', 'toast' + (kind ? ' toast--' + kind : ''), U.escapeHTML(message));
    box.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transition = 'opacity .25s';
      setTimeout(function () { node.remove(); }, 250);
    }, 3200);
  }

  /* ------------------------------------------------------------------
     CONTROLE GENÉRICO DE MODAIS
     ------------------------------------------------------------------ */
  function openOverlay(id) {
    lastFocused = document.activeElement;
    var overlay = U.qs(id);
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    var focusable = overlay.querySelector('input, select, button:not([data-close])');
    if (focusable) setTimeout(function () { focusable.focus(); }, 30);
  }

  function closeOverlay(id) {
    U.qs(id).hidden = true;
    if (!U.qsa('.overlay:not([hidden])').length) document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function anyOpen() { return U.qsa('.overlay:not([hidden])'); }

  /* ------------------------------------------------------------------
     FORMULÁRIO DE LANÇAMENTO
     ------------------------------------------------------------------ */
  function setType(type) {
    U.qsa('.segmented__opt').forEach(function (b) {
      var active = b.dataset.type === type;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    var isIncome = type === 'receita';
    U.qs('#optCategory').hidden = !isIncome;
    U.qs('#optPayment').hidden = !isIncome;
    U.qs('#installBlock').hidden = isIncome;   // parcelamento só faz sentido em despesas
    if (isIncome) {
      U.qs('#txInstall').checked = false;
      U.qs('#installFields').hidden = true;
    }
    U.qs('#labelAmount').textContent = U.qs('#txInstall').checked ? 'Valor total da compra' : 'Valor';
    updatePreview();
  }

  function currentType() {
    var active = U.qs('.segmented__opt.is-active');
    return active ? active.dataset.type : 'despesa';
  }

  function updatePreview() {
    var on = U.qs('#txInstall').checked;
    U.qs('#installFields').hidden = !on;
    U.qs('#labelAmount').textContent = on && currentType() === 'despesa' ? 'Valor total da compra' : 'Valor';

    if (!on) { U.qs('#installPreview').textContent = '—'; return; }

    var total = U.parseMoney(U.qs('#txAmount').value);
    var parts = parseInt(U.qs('#txParts').value, 10);
    if (!total || !parts || parts < 2) { U.qs('#installPreview').textContent = '—'; return; }

    var values = T.splitAmount(total, parts);
    var first = values[0], last = values[values.length - 1];
    U.qs('#installPreview').textContent = first === last
      ? parts + 'x de ' + U.money(first)
      : parts + 'x de ' + U.money(last) + ' (1ª de ' + U.money(first) + ')';

    var startDate = U.isoFromBR(U.qs('#txDate').value);
    if (U.isValidISO(startDate)) {
      U.qs('#installHint').textContent = 'Primeira parcela em ' + U.dateBR(startDate) +
        ' e última em ' + U.dateBR(U.addMonths(startDate, parts - 1)) + '.';
    }
  }

  function clearErrors() {
    U.qsa('#txForm .error').forEach(function (e) { e.textContent = ''; });
    U.qsa('#txForm .field').forEach(function (f) { f.classList.remove('has-error'); });
  }

  function showErrors(errors) {
    clearErrors();
    Object.keys(errors).forEach(function (key) {
      var node = U.qs('#txForm [data-error="' + key + '"]');
      if (!node) return;
      node.textContent = errors[key];
      if (node.parentElement) node.parentElement.classList.add('has-error');
    });
    var first = U.qs('#txForm .has-error input, #txForm .has-error select');
    if (first) first.focus();
  }

  /** Preenche o formulário conforme o escopo escolhido ao editar uma parcela */
  function applyScope(scope) {
    if (!editCtx || !editCtx.group.length) return;
    var group = editCtx.group;
    var tx = editCtx.tx;

    if (scope === 'all') {
      U.qs('#txInstall').checked = true;
      U.qs('#txParts').value = tx.installment.total;
      U.qs('#txAmount').value = U.number(tx.installment.totalAmount || group.reduce(function (s, g) { return s + g.amount; }, 0));
      U.qs('#txDate').value = U.dateBR(group[0].date);
      U.qs('#installBlock').hidden = false;
    } else {
      U.qs('#txInstall').checked = false;
      U.qs('#txAmount').value = U.number(tx.amount);
      U.qs('#txDate').value = U.dateBR(tx.date);
      U.qs('#installBlock').hidden = true;
    }
    updatePreview();
  }

  /** transaction = null cria; objeto edita */
  function openForm(transaction) {
    clearErrors();
    editCtx = null;

    U.qs('#txId').value = '';
    U.qs('#txGroupId').value = '';
    U.qs('#txDescription').value = '';
    U.qs('#txAmount').value = '';
    U.qs('#txDate').value = U.dateBR(U.todayISO());
    U.qs('#txCategory').value = '';
    U.qs('#txPayment').value = '';
    U.qs('#txInstall').checked = false;
    U.qs('#txParts').value = '12';
    U.qs('#scopeBlock').hidden = true;
    U.qs('#installBlock').hidden = false;
    U.qs('#installHint').textContent = 'O valor informado é o total da compra. As parcelas são lançadas uma por mês, a partir da data escolhida.';

    if (!transaction) {
      U.qs('#txModalTitle').textContent = 'Novo lançamento';
      U.qs('#btnSave').textContent = 'Salvar lançamento';
      setType('despesa');
      openOverlay('#txOverlay');
      setTimeout(function () { U.qs('#txDescription').focus(); }, 40);
      return;
    }

    var group = transaction.installment ? FIN.Storage.getGroup(transaction.installment.groupId) : [];
    editCtx = { tx: transaction, group: group };

    U.qs('#txModalTitle').textContent = 'Editar lançamento';
    U.qs('#btnSave').textContent = 'Salvar alterações';
    U.qs('#txId').value = transaction.id;
    U.qs('#txGroupId').value = transaction.installment ? transaction.installment.groupId : '';
    U.qs('#txDescription').value = transaction.description;
    U.qs('#txAmount').value = U.number(transaction.amount);
    U.qs('#txDate').value = U.dateBR(transaction.date);
    setType(transaction.type);
    U.qs('#txCategory').value = transaction.category || '';
    U.qs('#txPayment').value = transaction.paymentMethod || '';

    if (transaction.installment && group.length) {
      U.qs('#scopeBlock').hidden = false;
      U.qs('#scopeName').textContent = transaction.description + ' (' + T.installmentLabel(transaction) + ')';
      var one = U.qs('input[name="editScope"][value="one"]');
      one.checked = true;
      applyScope('one');
    }

    openOverlay('#txOverlay');
  }

  function closeForm() { closeOverlay('#txOverlay'); editCtx = null; }

  function readForm() {
    var scopeInput = U.qs('input[name="editScope"]:checked');
    return {
      id: U.qs('#txId').value || null,
      groupId: U.qs('#txGroupId').value || null,
      type: currentType(),
      description: U.qs('#txDescription').value,
      amount: U.parseMoney(U.qs('#txAmount').value),
      date: U.isoFromBR(U.qs('#txDate').value) || U.qs('#txDate').value,
      category: U.qs('#txCategory').value,
      paymentMethod: U.qs('#txPayment').value,
      isInstallment: U.qs('#txInstall').checked && currentType() === 'despesa',
      installments: parseInt(U.qs('#txParts').value, 10),
      scope: U.qs('#scopeBlock').hidden ? null : (scopeInput ? scopeInput.value : 'one')
    };
  }

  /* ------------------------------------------------------------------
     CONFIRMAÇÃO (substitui window.confirm)
     actions = [{ label, value, kind }] — devolve Promise com o valor
     ------------------------------------------------------------------ */
  function confirm(options) {
    return new Promise(function (resolve) {
      U.qs('#confirmTitle').textContent = options.title || 'Confirmar';
      U.qs('#confirmBody').innerHTML = options.body || '';
      var foot = U.qs('#confirmFoot');
      foot.innerHTML = '';
      foot.className = 'modal__foot' + (options.actions.length > 2 ? ' modal__foot--stack' : '');

      function finish(value) {
        closeOverlay('#confirmOverlay');
        foot.innerHTML = '';
        resolve(value);
      }

      options.actions.forEach(function (a) {
        var btn = U.el('button', 'btn btn--' + (a.kind || 'ghost'), U.escapeHTML(a.label));
        btn.type = 'button';
        btn.addEventListener('click', function () { finish(a.value); });
        foot.appendChild(btn);
      });

      U.qs('#confirmOverlay').dataset.resolver = '1';
      U.qs('#confirmOverlay')._cancel = function () { finish(null); };
      openOverlay('#confirmOverlay');
    });
  }

  /* ------------------------------------------------------------------
     TABELA DE LANÇAMENTOS
     ------------------------------------------------------------------ */
  function rowHTML(t) {
    var isIncome = t.type === 'receita';
    var sign = isIncome ? '+ ' : '− ';
    var parcel = T.installmentLabel(t);

    return '<tr data-id="' + t.id + '">' +
      '<td data-label="Data" class="muted">' + U.dateBR(t.date) + '</td>' +
      '<td data-label="Descrição" class="desc">' + U.escapeHTML(t.description) + '</td>' +
      '<td data-label="Categoria"' + (t.category ? '' : ' class="is-empty"') + '>' + (t.category
        ? '<span class="cat" data-cat="' + U.escapeHTML(t.category) + '">' + U.escapeHTML(t.category) + '</span>'
        : '<span class="muted">—</span>') + '</td>' +
      '<td data-label="Pagamento"' + (t.paymentMethod ? '' : ' class="is-empty"') + '>' + (t.paymentMethod ? U.escapeHTML(t.paymentMethod) : '<span class="muted">—</span>') + '</td>' +
      '<td data-label="Tipo"><span class="tag tag--' + (isIncome ? 'in' : 'out') + '">' +
        (isIncome ? 'Receita' : 'Despesa') + '</span></td>' +
      '<td data-label="Parcela"' + (parcel ? '' : ' class="is-empty"') + '>' +
        (parcel ? '<span class="tag tag--inst">' + parcel + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td class="val val--' + (isIncome ? 'in' : 'out') + '">' + sign + U.money(t.amount) + '</td>' +
      '<td class="actions">' +
        '<button class="iconbtn" data-action="edit" title="Editar" aria-label="Editar ' + U.escapeHTML(t.description) + '">✎</button>' +
        '<button class="iconbtn" data-action="delete" title="Excluir" aria-label="Excluir ' + U.escapeHTML(t.description) + '">🗑</button>' +
      '</td></tr>';
  }

  function renderTable(list, context) {
    var body = U.qs('#txBody');
    var empty = U.qs('#txEmpty');
    var table = U.qs('#txTable');

    body.innerHTML = list.map(rowHTML).join('');
    var isEmpty = list.length === 0;
    empty.hidden = !isEmpty;
    table.hidden = isEmpty;

    if (isEmpty) {
      var filtered = context && context.filtered;
      U.qs('.empty__title', empty).textContent = filtered
        ? 'Nenhum lançamento corresponde aos filtros.'
        : 'Nenhum lançamento encontrado neste mês.';
      U.qs('.empty__text', empty).textContent = filtered
        ? 'Ajuste ou limpe os filtros para ver outros períodos.'
        : 'Registre uma entrada ou saída para começar a acompanhar o mês.';
    }

    var totals = FIN.Dashboard.totalsOf(list);
    U.qs('#listCount').textContent = list.length === 1 ? '1 lançamento' : list.length + ' lançamentos';
    U.qs('#txFoot').innerHTML = isEmpty ? '' :
      '<span>Entradas <b style="color:var(--in)">' + U.money(totals.income) + '</b></span>' +
      '<span>Saídas <b style="color:var(--out)">' + U.money(totals.expense) + '</b></span>' +
      '<span>Resultado <b style="color:' + (totals.balance < 0 ? 'var(--out)' : 'var(--in)') + '">' +
      U.money(totals.balance) + '</b></span>';
  }

  function markSort(by, dir) {
    U.qsa('.th-sort').forEach(function (th) {
      if (th.dataset.sort === by) th.dataset.dir = dir;
      else delete th.dataset.dir;
    });
  }

  /* ------------------------------------------------------------------
     INICIALIZAÇÃO DOS COMPONENTES
     ------------------------------------------------------------------ */
  function initSelects() {
    U.fillSelect(U.qs('#txCategory'), Cfg.categories, 'Selecione…');
    U.fillSelect(U.qs('#txPayment'), Cfg.payments, 'Selecione…');
    U.fillSelect(U.qs('#fCategory'), Cfg.categories, 'Todas');
    U.fillSelect(U.qs('#fPayment'), Cfg.payments, 'Todas');
  }

  function bindFormBehaviour() {
    U.qsa('.segmented__opt').forEach(function (btn) {
      btn.addEventListener('click', function () { setType(btn.dataset.type); });
    });

    var amount = U.qs('#txAmount');
    amount.addEventListener('input', function () {
      var pos = amount.value.length - amount.selectionStart;
      amount.value = U.maskMoney(amount.value);
      var newPos = Math.max(0, amount.value.length - pos);
      try { amount.setSelectionRange(newPos, newPos); } catch (e) { /* campos sem seleção */ }
      updatePreview();
    });

    U.qs('#txInstall').addEventListener('change', updatePreview);
    U.qs('#txParts').addEventListener('input', updatePreview);

    // data digitada: máscara DD-MM-AAAA
    var date = U.qs('#txDate');
    date.addEventListener('input', function () {
      var atEnd = date.selectionStart === date.value.length;
      date.value = U.maskDate(date.value);
      if (atEnd) { try { date.setSelectionRange(date.value.length, date.value.length); } catch (e) {} }
      updatePreview();
    });
    date.addEventListener('blur', updatePreview);

    // botão abre o calendário do sistema e devolve a data já formatada
    var native = U.qs('#txDateNative');
    U.qs('#txDatePick').addEventListener('click', function () {
      native.value = U.isoFromBR(date.value) || U.todayISO();
      native.style.pointerEvents = 'auto';
      if (typeof native.showPicker === 'function') {
        try { native.showPicker(); return; } catch (e) { /* navegador sem suporte */ }
      }
      native.focus();
      native.click();
    });
    native.addEventListener('change', function () {
      if (!native.value) return;
      date.value = U.dateBR(native.value);
      native.style.pointerEvents = 'none';
      updatePreview();
    });

    U.qsa('input[name="editScope"]').forEach(function (radio) {
      radio.addEventListener('change', function () { applyScope(radio.value); });
    });

    // fechar modais: botões, clique fora e tecla Esc
    U.qsa('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var overlay = btn.closest('.overlay');
        if (overlay._cancel) overlay._cancel();
        else closeOverlay('#' + overlay.id);
      });
    });

    U.qsa('.overlay').forEach(function (overlay) {
      overlay.addEventListener('mousedown', function (e) {
        if (e.target !== overlay) return;
        if (overlay._cancel) overlay._cancel();
        else closeOverlay('#' + overlay.id);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = anyOpen();
      if (!open.length) return;
      var last = open[open.length - 1];
      if (last._cancel) last._cancel();
      else closeOverlay('#' + last.id);
    });
  }

  return {
    toast: toast,
    openOverlay: openOverlay,
    closeOverlay: closeOverlay,
    openForm: openForm,
    closeForm: closeForm,
    readForm: readForm,
    showErrors: showErrors,
    clearErrors: clearErrors,
    confirm: confirm,
    renderTable: renderTable,
    markSort: markSort,
    initSelects: initSelects,
    bindFormBehaviour: bindFormBehaviour,
    updatePreview: updatePreview
  };
})();
