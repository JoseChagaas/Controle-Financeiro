/* =====================================================================
   app.js — inicialização, estado da aplicação e ligação entre módulos
   ===================================================================== */
(function () {
  'use strict';

  var U = FIN.Utils;
  var S = FIN.Storage;
  var T = FIN.Transactions;
  var D = FIN.Dashboard;
  var UI = FIN.UI;

  var VIEW_INFO = {
    dashboard: { title: 'Painel', sub: 'Resumo do mês selecionado' },
    transactions: { title: 'Lançamentos', sub: 'Histórico completo com filtros' },
    future: { title: 'Futuro', sub: 'Compromissos já assumidos para os próximos meses' }
  };

  var state = {
    view: 'dashboard',
    monthKey: U.currentMonthKey(),
    filters: { month: U.currentMonthKey(), type: '', category: '', paymentMethod: '', text: '' },
    sortBy: 'date',
    sortDir: 'desc'
  };

  /* ------------------------------------------------------------------
     RENDERIZAÇÃO
     ------------------------------------------------------------------ */
  function refresh() {
    var list = S.all();

    U.qs('#monthLabel').textContent = U.monthLabel(state.monthKey);
    U.qs('#viewTitle').textContent = VIEW_INFO[state.view].title;
    U.qs('#viewSub').textContent = VIEW_INFO[state.view].sub;

    D.render(list, state.monthKey);
    D.renderFuture(list, state.monthKey);

    syncMonthFilter(list);
    var filtered = T.sort(T.filter(list, state.filters), state.sortBy, state.sortDir);
    var hasExtraFilter = !!(state.filters.type || state.filters.category ||
      state.filters.paymentMethod || state.filters.text);
    UI.renderTable(filtered, { filtered: hasExtraFilter });
    UI.markSort(state.sortBy, state.sortDir);
  }

  /** Mantém o seletor de mês dos filtros alinhado com os dados existentes */
  function syncMonthFilter(list) {
    var select = U.qs('#fMonth');
    var months = T.availableMonths(list);
    if (state.monthKey && months.indexOf(state.monthKey) === -1) months.push(state.monthKey);
    months.sort().reverse();

    var current = state.filters.month;
    select.innerHTML = '<option value="">Todos os meses</option>' + months.map(function (m) {
      return '<option value="' + m + '">' + U.monthLabel(m) + '</option>';
    }).join('');
    select.value = current || '';
  }

  function setView(view) {
    state.view = view;
    U.qsa('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + view); });
    U.qsa('.navlink, .tabbar__item[data-view]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    U.qs('#viewTitle').textContent = VIEW_INFO[view].title;
    U.qs('#viewSub').textContent = VIEW_INFO[view].sub;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function changeMonth(delta) {
    state.monthKey = U.addMonthsToKey(state.monthKey, delta);
    state.filters.month = state.monthKey; // o histórico acompanha o mês do painel
    refresh();
  }

  /* ------------------------------------------------------------------
     AÇÕES DE LANÇAMENTO
     ------------------------------------------------------------------ */
  function save() {
    var form = UI.readForm();
    var result = form.id
      ? T.update(form.id, form, form.scope)
      : T.create(form);

    if (!result.ok) {
      UI.showErrors(result.errors);
      UI.toast('Revise os campos destacados.', 'err');
      return;
    }

    UI.closeForm();

    // envia para a nuvem em segundo plano; se falhar (ex.: sem internet),
    // o dado já está salvo localmente e entra no próximo "Sincronizar agora"
    var toSync = result.created || (result.updated ? [result.updated] : []);
    if ((result.mode === 'group-rebuilt' || result.mode === 'group-replaced') && form.groupId) {
      FIN.Sync.removeGroupRemote(form.groupId);
    }
    if (toSync.length) FIN.Sync.pushMany(toSync);

    // leva o painel para o mês do lançamento salvo, para o usuário ver o efeito
    var target = (result.created && result.created[0]) || result.updated;
    if (target) {
      state.monthKey = U.monthKey(target.date);
      state.filters.month = state.monthKey;
    }
    refresh();

    if (result.mode === 'group-rebuilt') UI.toast('Compra parcelada atualizada em ' + result.created.length + ' parcelas.', 'ok');
    else if (result.mode === 'group-replaced') UI.toast('Parcelamento removido. Lançamento salvo em uma única parcela.', 'ok');
    else if (result.mode === 'single') UI.toast('Lançamento atualizado.', 'ok');
    else if (result.count > 1) UI.toast(result.count + ' parcelas criadas.', 'ok');
    else UI.toast('Lançamento salvo.', 'ok');
  }

  function edit(id) {
    var tx = S.getById(id);
    if (!tx) return UI.toast('Lançamento não encontrado.', 'err');
    UI.openForm(tx);
  }

  function askDelete(id) {
    var tx = S.getById(id);
    if (!tx) return;

    var card = '<div class="confirm-card"><span>' + U.escapeHTML(tx.description) +
      (tx.installment ? ' · ' + T.installmentLabel(tx) : '') +
      '<br><span class="confirm-sub">' + U.dateBR(tx.date) + ' · ' +
      U.escapeHTML(tx.category || 'sem categoria') + '</span></span><b>' + U.money(tx.amount) + '</b></div>';

    if (!tx.installment) {
      UI.confirm({
        title: 'Excluir lançamento',
        body: '<p class="confirm-text">Tem certeza que deseja excluir este lançamento?</p>' + card,
        actions: [
          { label: 'Cancelar', value: null, kind: 'ghost' },
          { label: 'Excluir', value: 'one', kind: 'danger' }
        ]
      }).then(function (choice) {
        if (choice !== 'one') return;
        T.remove(id);
        FIN.Sync.removeRemote(id);
        refresh();
        UI.toast('Lançamento excluído.', 'ok');
      });
      return;
    }

    var group = S.getGroup(tx.installment.groupId);
    UI.confirm({
      title: 'Excluir compra parcelada',
      body: '<p class="confirm-text">Esta despesa faz parte de uma compra em ' + tx.installment.total +
        ' parcelas. O que deseja excluir?</p>' + card +
        '<p class="confirm-sub">A compra inteira soma ' +
        U.money(group.reduce(function (s, g) { return s + g.amount; }, 0)) + ' em ' + group.length +
        ' parcelas registradas.</p>',
      actions: [
        { label: 'Excluir somente esta parcela', value: 'one', kind: 'ghost' },
        { label: 'Excluir a compra inteira', value: 'group', kind: 'danger' },
        { label: 'Cancelar', value: null, kind: 'ghost' }
      ]
    }).then(function (choice) {
      if (!choice) return;
      if (choice === 'one') {
        T.remove(id);
        FIN.Sync.removeRemote(id);
        UI.toast('Parcela excluída.', 'ok');
      } else {
        var res = T.removeGroup(tx.installment.groupId);
        FIN.Sync.removeGroupRemote(tx.installment.groupId);
        UI.toast(res.count + ' parcelas excluídas.', 'ok');
      }
      refresh();
    });
  }

  /* ------------------------------------------------------------------
     DADOS: backup, demonstração e limpeza
     ------------------------------------------------------------------ */
  function openDataModal() {
    var list = S.all();
    var demo = list.filter(function (t) { return t.demo; }).length;
    U.qs('#dataStat').textContent = list.length + ' lançamentos salvos neste navegador' +
      (demo ? ' · ' + demo + ' são de demonstração' : '') +
      (S.isAvailable ? '' : ' · atenção: este navegador bloqueou o armazenamento local');
    U.qs('#btnClearDemo').hidden = demo === 0;

    var cloud = FIN.Sync.isConfigured();
    var box = U.qs('#syncStatus');
    box.hidden = !cloud;
    U.qs('#btnSyncNow').hidden = !cloud;
    U.qs('#btnChangePin').hidden = !cloud;
    if (cloud) {
      var online = FIN.Sync.isOnline();
      box.className = 'syncstatus ' + (online ? 'is-ok' : 'is-off');
      U.qs('#syncText').textContent = online
        ? 'Conectado à nuvem — os mesmos dados aparecem em todos os seus aparelhos.'
        : 'Sem conexão agora. O que você fizer aqui sincroniza quando a internet voltar.';
    }
    UI.openOverlay('#dataOverlay');
  }

  function syncNow(silent) {
    if (!FIN.Sync.isConfigured()) return;
    if (!silent) UI.toast('Sincronizando…');
    FIN.Sync.mergeAndSync().then(function (merged) {
      if (merged === null) {
        if (!silent) UI.toast('Não foi possível sincronizar agora. Verifique a internet.', 'err');
        return;
      }
      refresh();
      if (!silent) UI.toast('Sincronizado com a nuvem.', 'ok');
    });
  }

  function exportBackup() {
    var payload = {
      app: 'caixa',
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: S.all()
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'caixa-backup-' + U.todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    UI.toast('Backup exportado.', 'ok');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var items = Array.isArray(data) ? data : data.transactions;
        if (!Array.isArray(items)) throw new Error('formato');
        var count = S.replaceAll(items);
        S.setMeta({ seeded: true, demoLoaded: false });
        FIN.Sync.replaceAllRemote(S.all());
        UI.closeOverlay('#dataOverlay');
        refresh();
        UI.toast(count + ' lançamentos importados.', 'ok');
      } catch (e) {
        UI.toast('Arquivo inválido. Use um backup exportado pelo Caixa.', 'err');
      }
    };
    reader.readAsText(file);
  }

  function clearDemo() {
    UI.closeOverlay('#dataOverlay'); // evita dois modais empilhados
    UI.confirm({
      title: 'Limpar demonstração',
      body: '<p class="confirm-text">Os lançamentos de exemplo serão removidos. Os que você criou permanecem.</p>',
      actions: [
        { label: 'Cancelar', value: null, kind: 'ghost' },
        { label: 'Limpar exemplos', value: 'ok', kind: 'danger' }
      ]
    }).then(function (choice) {
      if (!choice) return;
      var demoIds = S.all().filter(function (t) { return t.demo; }).map(function (t) { return t.id; });
      S.removeDemo();
      demoIds.forEach(function (id) { FIN.Sync.removeRemote(id); });
      refresh();
      UI.toast('Dados de demonstração removidos.', 'ok');
    });
  }

  function clearAll() {
    UI.closeOverlay('#dataOverlay');
    UI.confirm({
      title: 'Apagar tudo',
      body: '<p class="confirm-text">Todos os lançamentos salvos neste navegador serão apagados. Não é possível desfazer.</p>' +
        '<p class="confirm-sub">Se quiser guardar uma cópia, exporte um backup antes.</p>',
      actions: [
        { label: 'Cancelar', value: null, kind: 'ghost' },
        { label: 'Apagar tudo', value: 'ok', kind: 'danger' }
      ]
    }).then(function (choice) {
      if (!choice) return;
      S.clearAll();
      FIN.Sync.replaceAllRemote([]);
      refresh();
      UI.toast('Todos os lançamentos foram apagados.', 'ok');
    });
  }

  /* ------------------------------------------------------------------
     TEMA
     ------------------------------------------------------------------ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    S.setPrefs({ theme: theme });
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    refresh(); // redesenha os gráficos com as cores do novo tema
  }

  /* ------------------------------------------------------------------
     EVENTOS
     ------------------------------------------------------------------ */
  function bindEvents() {
    // navegação
    U.qsa('.navlink, .tabbar__item[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.dataset.view); });
    });

    // mês
    U.qs('#prevMonth').addEventListener('click', function () { changeMonth(-1); });
    U.qs('#nextMonth').addEventListener('click', function () { changeMonth(1); });
    U.qs('#monthLabel').addEventListener('click', function () {
      state.monthKey = U.currentMonthKey();
      state.filters.month = state.monthKey;
      refresh();
      UI.toast('Voltamos para o mês atual.');
    });

    // novo lançamento
    U.qs('#btnNew').addEventListener('click', function () { UI.openForm(null); });
    U.qs('#btnNewMobile').addEventListener('click', function () { UI.openForm(null); });
    U.qsa('[data-new]').forEach(function (b) {
      b.addEventListener('click', function () { UI.openForm(null); });
    });

    U.qs('#btnSave').addEventListener('click', save);
    U.qs('#txForm').addEventListener('submit', function (e) { e.preventDefault(); save(); });
    U.qs('#txForm').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); save(); }
    });

    // ações na tabela (delegação de eventos)
    U.qs('#txBody').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.closest('tr').dataset.id;
      if (btn.dataset.action === 'edit') edit(id);
      else askDelete(id);
    });

    // filtros
    U.qs('#fText').addEventListener('input', U.debounce(function (e) {
      state.filters.text = e.target.value;
      refresh();
    }, 160));

    U.qs('#fMonth').addEventListener('change', function (e) {
      state.filters.month = e.target.value;
      if (e.target.value) state.monthKey = e.target.value;
      refresh();
    });

    ['fType', 'fCategory', 'fPayment'].forEach(function (id) {
      var map = { fType: 'type', fCategory: 'category', fPayment: 'paymentMethod' };
      U.qs('#' + id).addEventListener('change', function (e) {
        state.filters[map[id]] = e.target.value;
        refresh();
      });
    });

    U.qs('#btnClearFilters').addEventListener('click', function () {
      state.filters = { month: state.monthKey, type: '', category: '', paymentMethod: '', text: '' };
      U.qs('#fText').value = '';
      U.qs('#fType').value = '';
      U.qs('#fCategory').value = '';
      U.qs('#fPayment').value = '';
      refresh();
      UI.toast('Filtros limpos.');
    });

    // ordenação
    U.qsa('.th-sort').forEach(function (th) {
      th.addEventListener('click', function () {
        var by = th.dataset.sort;
        if (state.sortBy === by) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortBy = by; state.sortDir = by === 'date' || by === 'amount' ? 'desc' : 'asc'; }
        S.setPrefs({ sortBy: state.sortBy, sortDir: state.sortDir });
        refresh();
      });
    });

    // tema e dados
    U.qs('#btnTheme').addEventListener('click', toggleTheme);
    U.qs('#btnData').addEventListener('click', openDataModal);
    U.qs('#btnDataMobile').addEventListener('click', openDataModal);
    U.qs('#btnExport').addEventListener('click', exportBackup);
    U.qs('#btnImport').addEventListener('click', function () { U.qs('#fileInput').click(); });
    U.qs('#fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });
    U.qs('#btnClearDemo').addEventListener('click', clearDemo);
    U.qs('#btnClearAll').addEventListener('click', clearAll);
    U.qs('#btnSyncNow').addEventListener('click', function () { syncNow(false); });
    U.qs('#btnChangePin').addEventListener('click', function () {
      FIN.Sync.clearPin();
      UI.closeOverlay('#dataOverlay');
      showPinGate('Digite o novo PIN para continuar.');
    });

    // atalhos de teclado
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); UI.openForm(null); }
      if (e.key === 'ArrowLeft') changeMonth(-1);
      if (e.key === 'ArrowRight') changeMonth(1);
    });

    // gráficos em SVG usam viewBox, mas a legenda precisa reagir a mudanças grandes
    window.addEventListener('resize', U.debounce(function () {
      if (state.view === 'dashboard') D.render(S.all(), state.monthKey);
    }, 250));
  }

  /* ------------------------------------------------------------------
     PORTA DE ENTRADA (PIN)
     Some sozinha se o app não tem Supabase configurado (uso 100% local).
     ------------------------------------------------------------------ */
  function showPinGate(message) {
    var gate = U.qs('#pinGate');
    gate.hidden = false;
    document.body.style.overflow = 'hidden';
    U.qs('#pinSub').textContent = message || 'Digite o PIN para acessar seus dados neste aparelho.';
    U.qs('#pinError').textContent = '';
    var input = U.qs('#pinInput');
    input.value = '';
    setTimeout(function () { input.focus(); }, 50);
  }

  function hidePinGate() {
    U.qs('#pinGate').hidden = true;
    document.body.style.overflow = '';
  }

  function bindPinGate() {
    U.qs('#pinForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var pin = U.qs('#pinInput').value.trim();
      var btn = U.qs('#pinSubmit');
      var errorEl = U.qs('#pinError');
      errorEl.textContent = '';

      if (!pin) { errorEl.textContent = 'Digite o PIN.'; return; }
      if (!FIN.Sync.isOnline()) {
        errorEl.textContent = 'Sem internet agora — é preciso estar online na primeira vez.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Verificando…';
      FIN.Sync.verifyPin(pin).then(function (ok) {
        btn.disabled = false;
        btn.textContent = 'Entrar';
        if (!ok) { errorEl.textContent = 'PIN incorreto. Tente de novo.'; return; }
        FIN.Sync.setPin(pin);
        hidePinGate();
        startApp();
      });
    });
  }

  /* ------------------------------------------------------------------
     INÍCIO
     ------------------------------------------------------------------ */
  function init() {
    bindPinGate();

    // sem Supabase configurado (ex.: sem internet para carregar a
    // biblioteca) ou já com o PIN salvo neste aparelho: entra direto
    if (!FIN.Sync.isConfigured() || FIN.Sync.hasPin()) {
      startApp();
    } else {
      showPinGate();
    }
  }

  function startApp() {
    var prefs = S.getPrefs();
    applyTheme(prefs.theme || 'light');
    state.sortBy = prefs.sortBy || 'date';
    state.sortDir = prefs.sortDir || 'desc';

    UI.initSelects();
    UI.bindFormBehaviour();
    bindEvents();

    var seeded = T.seedDemoIfEmpty();

    // abre no mês mais recente com dados, ou no mês atual
    var months = T.availableMonths(S.all());
    var current = U.currentMonthKey();
    state.monthKey = months.indexOf(current) > -1 ? current : (months[0] || current);
    state.filters.month = state.monthKey;

    refresh();

    if (seeded) {
      UI.toast('Carregamos alguns lançamentos de exemplo. Você pode removê-los em Dados.', 'ok');
    }
    if (!S.isAvailable) {
      UI.toast('Este navegador bloqueou o armazenamento local: os dados não serão salvos.', 'err');
    }

    // primeira sincronização da sessão, silenciosa (sem toast de sucesso)
    if (FIN.Sync.isConfigured() && FIN.Sync.hasPin()) syncNow(true);
    window.addEventListener('online', function () { syncNow(true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
