/* =====================================================================
   sync.js — ponte entre o app e o Supabase
   Nada aqui é obrigatório: se o script do Supabase não carregar (sem
   internet, ou rodando localmente sem esse recurso), isConfigured()
   volta false e o app continua funcionando só com o localStorage.
   Exposto em FIN.Sync
   ===================================================================== */
window.FIN = window.FIN || {};

FIN.Sync = (function () {
  'use strict';

  // Projeto Supabase "caixa-financeiro". A chave abaixo é a chave PÚBLICA
  // (publishable/anon) — ela sozinha não abre os dados: as políticas de
  // segurança do banco (RLS) só liberam leitura/escrita para quem manda
  // o PIN certo no cabeçalho x-app-pin.
  var SUPABASE_URL = 'https://nuncjwdswhcfjlwlnjhx.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_gV7DnXXVfZDd_6laI3G9eA_zhNJD1OX';
  var PIN_KEY = 'caixa:v1:pin';
  // IDs que já vimos confirmados na nuvem numa sincronização anterior. Se um
  // desses IDs sumir da nuvem, é porque outro aparelho apagou — não é um
  // lançamento novo esperando para subir.
  var SYNCED_KEY = 'caixa:v1:syncedIds';
  // IDs apagados neste aparelho mas ainda não confirmados como apagados na
  // nuvem (ex.: apagou offline). Ficam "escondidos" até a exclusão colar.
  var TOMB_KEY = 'caixa:v1:tombstones';

  var client = null;   // cliente autenticado com o PIN (recriado se o PIN mudar)
  var pinCache = null;

  function isConfigured() {
    return typeof window.supabase !== 'undefined' && !!window.supabase.createClient;
  }

  function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function getPin() {
    if (pinCache) return pinCache;
    try { pinCache = window.localStorage.getItem(PIN_KEY); } catch (e) { pinCache = null; }
    return pinCache;
  }

  function setPin(value) {
    pinCache = value;
    try { window.localStorage.setItem(PIN_KEY, value); } catch (e) { /* sem storage disponível */ }
    client = null; // força recriar o cliente com o cabeçalho novo
  }

  function clearPin() {
    pinCache = null;
    try { window.localStorage.removeItem(PIN_KEY); } catch (e) { /* ignorado */ }
    client = null;
  }

  function hasPin() { return !!getPin(); }

  function readIdList(key) {
    try { return JSON.parse(window.localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function writeIdList(key, ids) {
    try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch (e) { /* ignorado */ }
  }

  function getSyncedIds() { return readIdList(SYNCED_KEY); }
  function setSyncedIds(ids) { writeIdList(SYNCED_KEY, ids); }

  function getTombstones() { return readIdList(TOMB_KEY); }
  function addTombstones(ids) {
    var set = {};
    getTombstones().concat(ids).forEach(function (id) { set[id] = true; });
    writeIdList(TOMB_KEY, Object.keys(set));
  }
  function clearTombstones(ids) {
    var drop = {};
    ids.forEach(function (id) { drop[id] = true; });
    writeIdList(TOMB_KEY, getTombstones().filter(function (id) { return !drop[id]; }));
  }

  function getClient() {
    if (!isConfigured()) return null;
    var pin = getPin();
    if (!pin) return null;
    if (client) return client;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { 'x-app-pin': pin } }
    });
    return client;
  }

  /**
   * Confirma um PIN chamando a função do banco (check_app_pin), sem
   * guardar nada ainda. Resolve true/false; nunca lança erro.
   */
  function verifyPin(candidate) {
    if (!isConfigured()) return Promise.resolve(false);
    try {
      var probe = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return probe.rpc('check_app_pin', { input: candidate }).then(function (res) {
        return !res.error && res.data === true;
      }).catch(function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* ------------------------------------------------------------------
     Conversão entre o formato usado no app (camelCase, installment
     aninhado) e as colunas da tabela no Postgres (snake_case, plano).
     ------------------------------------------------------------------ */
  function toRow(t) {
    return {
      id: t.id,
      type: t.type,
      description: t.description,
      amount: t.amount,
      date: t.date,
      category: t.category || '',
      payment_method: t.paymentMethod || '',
      installment_current: t.installment ? t.installment.current : null,
      installment_total: t.installment ? t.installment.total : null,
      installment_group_id: t.installment ? t.installment.groupId : null,
      installment_total_amount: t.installment ? t.installment.totalAmount : null,
      demo: !!t.demo,
      created_at: t.createdAt || new Date().toISOString()
    };
  }

  function fromRow(r) {
    var installment = (r.installment_total && r.installment_total > 1) ? {
      current: r.installment_current,
      total: r.installment_total,
      groupId: r.installment_group_id,
      totalAmount: Number(r.installment_total_amount) || 0
    } : null;
    return {
      id: r.id,
      type: r.type,
      description: r.description,
      amount: Number(r.amount),
      date: r.date,
      category: r.category || '',
      paymentMethod: r.payment_method || '',
      installment: installment,
      demo: !!r.demo,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  /* ------------------------------------------------------------------
     Operações remotas — todas "best-effort": se falharem (sem
     internet, PIN mudou, etc.) resolvem false/[] em vez de travar a
     interface. A cópia local sempre manda no que a tela mostra.
     ------------------------------------------------------------------ */
  function pullAll() {
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.from('transactions').select('*').then(function (res) {
      if (res.error) throw res.error;
      return res.data.map(fromRow);
    }).catch(function () { return null; });
  }

  function pushMany(list) {
    var c = getClient();
    if (!c || !list || !list.length) return Promise.resolve(false);
    return c.from('transactions').upsert(list.map(toRow)).then(function (res) {
      return !res.error;
    }).catch(function () { return false; });
  }

  function removeRemote(id, _skipTombstone) {
    if (!_skipTombstone) addTombstones([id]);
    var c = getClient();
    if (!c) return Promise.resolve(false);
    return c.from('transactions').delete().eq('id', id)
      .then(function (res) { return !res.error; })
      .catch(function () { return false; });
  }

  /** Marca vários IDs como "apagados aqui" antes de excluir (usado para compras parceladas) */
  function tombstoneMany(ids) {
    if (ids && ids.length) addTombstones(ids);
  }

  function removeGroupRemote(groupId) {
    var c = getClient();
    if (!c || !groupId) return Promise.resolve(false);
    return c.from('transactions').delete().eq('installment_group_id', groupId)
      .then(function (res) { return !res.error; })
      .catch(function () { return false; });
  }

  /** Apaga tudo na nuvem e sobe a lista informada (usado por "apagar tudo" e importação) */
  function replaceAllRemote(list) {
    var c = getClient();
    if (!c) return Promise.resolve(false);
    return c.from('transactions').delete().neq('id', '__none__')
      .then(function () { return pushMany(list); })
      .catch(function () { return false; });
  }

  /**
   * Busca a nuvem, resolve conflitos com o que existe localmente
   * (o registro com updatedAt/createdAt mais recente vence) e grava o
   * resultado combinado como a nova cópia local. Devolve a lista final,
   * ou null se não havia como sincronizar (offline, sem PIN, etc.).
   *
   * Simplificação assumida: como o app é de uso pessoal em poucos
   * aparelhos, "o mais recente vence" é suficiente. Editar o MESMO
   * lançamento em dois aparelhos ao mesmo tempo, offline nos dois,
   * não é um caso tratado (o que for sincronizado por último apaga a
   * outra edição) — na prática isso quase nunca acontece no dia a dia.
   */
  function mergeAndSync() {
    if (!isConfigured() || !hasPin() || !isOnline()) return Promise.resolve(null);

    return pullAll().then(function (remote) {
      if (remote === null) return null; // sem conexão com o banco agora

      // 1) trata as exclusões pendentes deste aparelho primeiro: qualquer
      //    coisa marcada como "apagada aqui" nunca volta a aparecer, e se
      //    ainda estiver na nuvem (ex.: a exclusão falhou por estar
      //    offline na hora), tenta apagar de novo agora.
      var tombstones = getTombstones();
      if (tombstones.length) {
        var tombSet = {};
        tombstones.forEach(function (id) { tombSet[id] = true; });
        var stillOnCloud = [];
        remote = remote.filter(function (r) {
          if (!tombSet[r.id]) return true;
          stillOnCloud.push(r.id);
          return false;
        });
        stillOnCloud.forEach(function (id) { removeRemote(id, true); });
        var confirmedGone = tombstones.filter(function (id) { return stillOnCloud.indexOf(id) === -1; });
        if (confirmedGone.length) clearTombstones(confirmedGone);
      }

      var local = FIN.Storage.all();
      var byId = {};
      local.forEach(function (t) { byId[t.id] = t; });

      var wasSynced = {};
      getSyncedIds().forEach(function (id) { wasSynced[id] = true; });

      var merged = [];
      var toPush = [];
      var seen = {};

      remote.forEach(function (r) {
        seen[r.id] = true;
        var l = byId[r.id];
        if (!l) { merged.push(r); return; }
        var lu = l.updatedAt || l.createdAt || '';
        var ru = r.updatedAt || r.createdAt || '';
        if (lu > ru) { merged.push(l); toPush.push(l); }
        else { merged.push(r); }
      });

      local.forEach(function (l) {
        if (seen[l.id]) return;
        if (tombSetHas(tombstones, l.id)) return;      // apagado aqui mesmo: não ressuscita
        if (wasSynced[l.id]) return;                     // existia na nuvem antes e sumiu: outro aparelho apagou
        merged.push(l);                                  // nunca visto na nuvem: é novo daqui, sobe
        toPush.push(l);
      });

      FIN.Storage.saveAll(merged);
      if (toPush.length) pushMany(toPush);
      setSyncedIds(merged.map(function (t) { return t.id; }));
      return merged;
    });
  }

  function tombSetHas(list, id) { return list.indexOf(id) !== -1; }

  return {
    isConfigured: isConfigured,
    isOnline: isOnline,
    hasPin: hasPin,
    getPin: getPin,
    setPin: setPin,
    clearPin: clearPin,
    verifyPin: verifyPin,
    pullAll: pullAll,
    pushMany: pushMany,
    removeRemote: removeRemote,
    removeGroupRemote: removeGroupRemote,
    tombstoneMany: tombstoneMany,
    replaceAllRemote: replaceAllRemote,
    mergeAndSync: mergeAndSync
  };
})();
