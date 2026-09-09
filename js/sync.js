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
  // Exclusões feitas neste aparelho que ainda não foram confirmadas na
  // nuvem (ex.: apagou sem internet). Ficam guardadas até a marca de
  // exclusão colar lá, e nesse meio tempo o item nunca reaparece aqui.
  var TOMB_KEY = 'caixa:v1:tombstones';

  var client = null;
  var pinCache = null;

  /* ---------- disponibilidade e PIN ---------- */
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
    try { window.localStorage.setItem(PIN_KEY, value); } catch (e) { /* sem storage */ }
    client = null; // recria o cliente com o cabeçalho novo
  }

  function clearPin() {
    pinCache = null;
    try { window.localStorage.removeItem(PIN_KEY); } catch (e) { /* ignorado */ }
    client = null;
  }

  function hasPin() { return !!getPin(); }

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

  /* ---------- exclusões pendentes ---------- */
  function readIdList(key) {
    try { return JSON.parse(window.localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function writeIdList(key, ids) {
    try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch (e) { /* ignorado */ }
  }
  function getTombstones() { return readIdList(TOMB_KEY); }
  function addTombstones(ids) {
    var set = {};
    getTombstones().concat(ids || []).forEach(function (id) { if (id) set[id] = true; });
    writeIdList(TOMB_KEY, Object.keys(set));
  }
  function clearTombstones(ids) {
    var drop = {};
    (ids || []).forEach(function (id) { drop[id] = true; });
    writeIdList(TOMB_KEY, getTombstones().filter(function (id) { return !drop[id]; }));
  }

  /* ---------- conversão app <-> banco ---------- */
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
      created_at: t.createdAt || new Date().toISOString(),
      deleted_at: null
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

  /* ---------- operações remotas (todas tolerantes a falha) ---------- */

  /** Devolve { live: [...], deletedIds: [...] } ou null se não deu para ler */
  function pullAll() {
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.from('transactions').select('*').then(function (res) {
      if (res.error) throw res.error;
      var live = [], deletedIds = [];
      res.data.forEach(function (r) {
        if (r.deleted_at) deletedIds.push(r.id);
        else live.push(fromRow(r));
      });
      return { live: live, deletedIds: deletedIds };
    }).catch(function () { return null; });
  }

  function pushMany(list) {
    var c = getClient();
    if (!c || !list || !list.length) return Promise.resolve(false);
    return c.from('transactions').upsert(list.map(toRow)).then(function (res) {
      return !res.error;
    }).catch(function () { return false; });
  }

  /** Marca como apagado em vez de remover, para os outros aparelhos verem */
  function markDeleted(ids) {
    var c = getClient();
    if (!c || !ids || !ids.length) return Promise.resolve(false);
    return c.from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids)
      .then(function (res) { return !res.error; })
      .catch(function () { return false; });
  }

  function removeRemote(id) {
    addTombstones([id]);
    return markDeleted([id]);
  }

  /** Usado quando a exclusão abrange várias linhas de uma vez (compra parcelada) */
  function tombstoneMany(ids) { addTombstones(ids); }

  function removeGroupRemote(groupId) {
    var c = getClient();
    if (!c || !groupId) return Promise.resolve(false);
    return c.from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('installment_group_id', groupId)
      .then(function (res) { return !res.error; })
      .catch(function () { return false; });
  }

  /** Marca tudo como apagado e sobe a lista nova (usado em "apagar tudo" e importação) */
  function replaceAllRemote(list) {
    var c = getClient();
    if (!c) return Promise.resolve(false);
    return c.from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .neq('id', '__none__')
      .then(function () { return list && list.length ? pushMany(list) : true; })
      .catch(function () { return false; });
  }

  /**
   * Junta nuvem e cópia local.
   *
   * A regra central: exclusão é um FATO registrado na nuvem (deleted_at),
   * não a ausência de uma linha. Por isso um lançamento que existe só
   * aqui é sempre um lançamento novo daqui — pode subir sem medo — e um
   * lançamento marcado como apagado some em todos os aparelhos, mesmo
   * que este aparelho nunca tenha sincronizado antes.
   *
   * Conflito de edição do mesmo lançamento em dois aparelhos: vence o
   * que tiver updatedAt mais recente. Como o uso é pessoal e em poucos
   * aparelhos, isso basta; edições simultâneas do mesmo item, offline
   * nos dois, não são um caso tratado.
   */
  function mergeAndSync() {
    if (!isConfigured() || !hasPin() || !isOnline()) return Promise.resolve(null);

    return pullAll().then(function (remote) {
      if (remote === null) return null; // sem conexão com o banco agora

      var deleted = {};
      remote.deletedIds.forEach(function (id) { deleted[id] = true; });

      // exclusões feitas aqui que talvez não tenham chegado lá
      var tomb = getTombstones();
      if (tomb.length) {
        var liveIds = {};
        remote.live.forEach(function (r) { liveIds[r.id] = true; });

        var pending = tomb.filter(function (id) { return liveIds[id]; });
        if (pending.length) markDeleted(pending); // tenta de novo agora

        var confirmed = tomb.filter(function (id) { return !liveIds[id]; });
        if (confirmed.length) clearTombstones(confirmed);

        tomb.forEach(function (id) { deleted[id] = true; });
      }

      var local = FIN.Storage.all();
      var byId = {};
      local.forEach(function (t) { byId[t.id] = t; });

      var merged = [];
      var toPush = [];
      var seen = {};

      remote.live.forEach(function (r) {
        if (deleted[r.id]) return;      // apagado aqui, ainda vivo lá: já pedimos a exclusão
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
        if (deleted[l.id]) return;      // outro aparelho apagou: não ressuscita
        merged.push(l);                 // só existe aqui: é novo, sobe
        toPush.push(l);
      });

      FIN.Storage.saveAll(merged);
      if (toPush.length) pushMany(toPush);
      return merged;
    });
  }

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
    markDeleted: markDeleted,
    removeRemote: removeRemote,
    removeGroupRemote: removeGroupRemote,
    tombstoneMany: tombstoneMany,
    replaceAllRemote: replaceAllRemote,
    mergeAndSync: mergeAndSync
  };
})();
