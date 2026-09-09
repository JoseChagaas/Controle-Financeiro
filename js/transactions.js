/* =====================================================================
   transactions.js — regras de negócio dos lançamentos
   Criar, parcelar, editar, excluir, filtrar e ordenar. FIN.Transactions
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.Transactions = (function () {
  'use strict';

  var U = FIN.Utils;
  var S = FIN.Storage;

  /* ------------------------------------------------------------------
     VALIDAÇÃO
     Recebe os dados crus do formulário e devolve { valid, errors, data }
     ------------------------------------------------------------------ */
  function validate(input) {
    var errors = {};
    var type = input.type === 'receita' ? 'receita' : 'despesa';
    var description = String(input.description || '').trim();
    var amount = U.round2(U.parseMoney(input.amount));
    var date = String(input.date || '');
    var isInstallment = !!input.isInstallment && type === 'despesa';
    var parts = parseInt(input.installments, 10);

    if (!description) errors.description = 'Informe uma descrição.';
    else if (description.length < 2) errors.description = 'Use pelo menos 2 caracteres.';

    if (!amount || amount <= 0) errors.amount = 'O valor precisa ser maior que zero.';
    else if (amount > 99999999) errors.amount = 'Valor acima do limite suportado.';

    if (!U.isValidISO(date)) errors.date = 'Informe uma data válida no formato DD-MM-AAAA.';

    if (type === 'despesa') {
      if (!input.category) errors.category = 'Escolha uma categoria.';
      if (!input.paymentMethod) errors.paymentMethod = 'Escolha a forma de pagamento.';
    }

    if (isInstallment) {
      if (!parts || isNaN(parts)) errors.installments = 'Informe a quantidade de parcelas.';
      else if (parts < 2) errors.installments = 'Use 2 ou mais parcelas.';
      else if (parts > 120) errors.installments = 'Máximo de 120 parcelas.';
      else if (amount / parts < 0.01) errors.installments = 'O valor é pequeno demais para esse número de parcelas.';
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors: errors,
      data: {
        type: type,
        description: description,
        amount: amount,
        date: date,
        category: type === 'receita' ? (input.category || '') : input.category,
        paymentMethod: type === 'receita' ? (input.paymentMethod || '') : input.paymentMethod,
        isInstallment: isInstallment,
        installments: isInstallment ? parts : 1
      }
    };
  }

  /* ------------------------------------------------------------------
     PARCELAMENTO
     Divide o total em N parcelas sem perder centavos: as primeiras
     recebem o arredondamento para baixo e a última fecha a diferença.
     ------------------------------------------------------------------ */
  function splitAmount(total, parts) {
    var cents = Math.round(U.round2(total) * 100);
    var base = Math.floor(cents / parts);
    var rest = cents - base * parts; // centavos que sobraram
    var values = [];
    for (var i = 0; i < parts; i++) {
      // distribui o resto nas primeiras parcelas (1 centavo por vez)
      values.push((base + (i < rest ? 1 : 0)) / 100);
    }
    return values;
  }

  /** Gera os registros de uma compra parcelada (um por mês) */
  function buildInstallments(data, groupId) {
    var gid = groupId || U.uid('grp');
    var values = splitAmount(data.amount, data.installments);
    return values.map(function (value, i) {
      return {
        id: U.uid('tx'),
        type: 'despesa',
        description: data.description,
        amount: value,
        date: U.addMonths(data.date, i),
        category: data.category,
        paymentMethod: data.paymentMethod,
        installment: {
          current: i + 1,
          total: data.installments,
          groupId: gid,
          totalAmount: U.round2(data.amount)
        },
        demo: !!data.demo,
        createdAt: new Date().toISOString()
      };
    });
  }

  function buildSingle(data) {
    return {
      id: U.uid('tx'),
      type: data.type,
      description: data.description,
      amount: U.round2(data.amount),
      date: data.date,
      category: data.category || '',
      paymentMethod: data.paymentMethod || '',
      installment: null,
      demo: !!data.demo,
      createdAt: new Date().toISOString()
    };
  }

  /* ------------------------------------------------------------------
     CRIAÇÃO
     ------------------------------------------------------------------ */
  function create(input) {
    var check = validate(input);
    if (!check.valid) return { ok: false, errors: check.errors };

    var data = check.data;
    var created = data.isInstallment ? buildInstallments(data) : [buildSingle(data)];
    S.insertMany(created);
    return { ok: true, created: created, count: created.length };
  }

  /* ------------------------------------------------------------------
     EDIÇÃO
     scope = 'one'  -> altera somente o registro atual
     scope = 'all'  -> recria o grupo de parcelas mantendo o mesmo groupId
     ------------------------------------------------------------------ */
  function update(id, input, scope) {
    var current = S.getById(id);
    if (!current) return { ok: false, errors: { general: 'Lançamento não encontrado.' } };

    var check = validate(input);
    if (!check.valid) return { ok: false, errors: check.errors };
    var data = check.data;

    var wasGroup = !!current.installment;
    var groupId = wasGroup ? current.installment.groupId : null;

    // 1) Deixou de ser parcelado (ou virou receita): remove o grupo e cria um único lançamento
    if (wasGroup && !data.isInstallment && scope === 'all') {
      S.removeGroup(groupId);
      var single = buildSingle(data);
      S.insertMany([single]);
      return { ok: true, mode: 'group-replaced', created: [single] };
    }

    // 2) Continua parcelado e a edição vale para a compra inteira: recria as parcelas
    if (data.isInstallment && (scope === 'all' || !wasGroup)) {
      if (wasGroup) S.removeGroup(groupId);
      else S.remove(id);
      var rebuilt = buildInstallments(data, groupId || null);
      S.insertMany(rebuilt);
      return { ok: true, mode: 'group-rebuilt', created: rebuilt };
    }

    // 3) Edição pontual — mantém o vínculo com o grupo, se houver
    var patch = {
      type: data.type,
      description: data.description,
      amount: U.round2(data.amount),
      date: data.date,
      category: data.category || '',
      paymentMethod: data.paymentMethod || '',
      installment: current.installment || null
    };

    // se virou receita, perde o vínculo de parcelamento
    if (patch.type === 'receita') patch.installment = null;

    var saved = S.update(id, patch);
    return { ok: true, mode: 'single', updated: saved };
  }

  /* ------------------------------------------------------------------
     EXCLUSÃO
     ------------------------------------------------------------------ */
  function remove(id) { S.remove(id); return { ok: true, mode: 'single' }; }

  function removeGroup(groupId) {
    var qty = S.getGroup(groupId).length;
    S.removeGroup(groupId);
    return { ok: true, mode: 'group', count: qty };
  }

  /* ------------------------------------------------------------------
     CONSULTAS
     ------------------------------------------------------------------ */
  function byMonth(list, monthKey) {
    return list.filter(function (t) { return U.monthKey(t.date) === monthKey; });
  }

  /** Meses que possuem lançamentos, do mais recente para o mais antigo */
  function availableMonths(list) {
    var set = {};
    list.forEach(function (t) { set[U.monthKey(t.date)] = true; });
    return Object.keys(set).sort().reverse();
  }

  /**
   * filters = { month, type, category, paymentMethod, text }
   * Campos vazios são ignorados. `month` vazio significa "todos os meses".
   */
  function filter(list, filters) {
    var f = filters || {};
    var text = U.normalize(f.text || '');
    return list.filter(function (t) {
      if (f.month && U.monthKey(t.date) !== f.month) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.category && t.category !== f.category) return false;
      if (f.paymentMethod && t.paymentMethod !== f.paymentMethod) return false;
      if (text && U.normalize(t.description).indexOf(text) === -1) return false;
      return true;
    });
  }

  var SORTERS = {
    date: function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; },
    amount: function (a, b) { return a.amount - b.amount; },
    description: function (a, b) { return U.normalize(a.description).localeCompare(U.normalize(b.description)); },
    category: function (a, b) { return String(a.category).localeCompare(String(b.category)); },
    paymentMethod: function (a, b) { return String(a.paymentMethod).localeCompare(String(b.paymentMethod)); }
  };

  function sort(list, by, dir) {
    var fn = SORTERS[by] || SORTERS.date;
    var factor = dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var r = fn(a, b) * factor;
      // desempate estável pela data e pela descrição
      if (r !== 0) return r;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  /** Rótulo curto de parcela: "3/12" */
  function installmentLabel(t) {
    return t.installment ? t.installment.current + '/' + t.installment.total : '';
  }

  /* ------------------------------------------------------------------
     DADOS DE DEMONSTRAÇÃO
     Criados a partir do mês atual, para o painel nunca abrir vazio.
     ------------------------------------------------------------------ */
  function demoData() {
    var base = U.currentMonthKey();
    var prev1 = U.addMonthsToKey(base, -1);
    var prev2 = U.addMonthsToKey(base, -2);
    var out = [];

    function single(monthKey, day, type, description, amount, category, payment) {
      out.push(buildSingle({
        type: type, description: description, amount: amount,
        date: monthKey + '-' + day, category: category || '',
        paymentMethod: payment || '', demo: true
      }));
    }

    function parcelado(monthKey, day, description, total, parts, category, payment) {
      buildInstallments({
        description: description, amount: total, installments: parts,
        date: monthKey + '-' + day, category: category, paymentMethod: payment, demo: true
      }).forEach(function (t) { out.push(t); });
    }

    // --- dois meses atrás ---
    single(prev2, '05', 'receita', 'Salário', 4700, '', '');
    single(prev2, '08', 'despesa', 'Supermercado', 612.4, 'Casa', 'Inter (N)');
    single(prev2, '12', 'despesa', 'Combustível', 280, 'Pessoal', 'Nubank (N)');
    single(prev2, '20', 'despesa', 'Aluguel', 1450, 'Casa', 'Bradesco');
    single(prev2, '22', 'despesa', 'Filamento PLA (lote)', 430, 'Hyper Logic 3D', 'Mercado Pago');

    // --- mês anterior ---
    single(prev1, '05', 'receita', 'Salário', 4700, '', '');
    single(prev1, '15', 'receita', 'Vendas Hyper Logic 3D', 1280, 'Hyper Logic 3D', '');
    single(prev1, '06', 'despesa', 'Supermercado', 548.9, 'Casa', 'Inter (N)');
    single(prev1, '10', 'despesa', 'Aluguel', 1450, 'Casa', 'Bradesco');
    single(prev1, '14', 'despesa', 'Internet e telefone', 189.9, 'Casa', 'Inter (J)');
    single(prev1, '18', 'despesa', 'Almoços da semana', 320, 'Trabalho', 'Nubank (N)');
    parcelado(prev1, '21', 'Impressora 3D Bambu Lab', 3600, 12, 'Hyper Logic 3D', 'Nubank (N)');

    // --- mês atual ---
    single(base, '05', 'receita', 'Salário', 4700, '', '');
    single(base, '11', 'receita', 'Reembolso de viagem', 430, 'Trabalho', '');
    single(base, '03', 'despesa', 'Aluguel', 1450, 'Casa', 'Bradesco');
    single(base, '06', 'despesa', 'Supermercado', 587.3, 'Casa', 'Inter (N)');
    single(base, '07', 'despesa', 'Assinaturas (streaming)', 79.9, 'Pessoal', 'Nubank (N)');
    single(base, '09', 'despesa', 'Combustível', 260, 'Pessoal', 'Inter (N)');
    single(base, '12', 'despesa', 'Anúncios do e-commerce', 350, 'Hyper Logic 3D', 'Mercado Pago');
    single(base, '16', 'despesa', 'Internet e telefone', 189.9, 'Casa', 'Inter (J)');
    single(base, '19', 'despesa', 'Material de escritório', 145.5, 'Trabalho', 'Inter (J)');
    single(base, '24', 'despesa', 'Farmácia', 96.7, 'Pessoal', 'Inter (N)');
    parcelado(base, '14', 'Notebook Dell', 1200, 12, 'Trabalho', 'Inter (J)');

    return out;
  }

  function seedDemoIfEmpty() {
    var meta = S.getMeta();
    if (meta.seeded || S.all().length) return false;
    S.insertMany(demoData());
    S.setMeta({ seeded: true, demoLoaded: true });
    return true;
  }

  function loadDemo() {
    S.insertMany(demoData());
    S.setMeta({ seeded: true, demoLoaded: true });
  }

  return {
    validate: validate,
    splitAmount: splitAmount,
    buildInstallments: buildInstallments,
    buildSingle: buildSingle,
    create: create,
    update: update,
    remove: remove,
    removeGroup: removeGroup,
    byMonth: byMonth,
    availableMonths: availableMonths,
    filter: filter,
    sort: sort,
    installmentLabel: installmentLabel,
    demoData: demoData,
    seedDemoIfEmpty: seedDemoIfEmpty,
    loadDemo: loadDemo
  };
})();
