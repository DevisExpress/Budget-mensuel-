/* ============================================================================
   BUDGET ORION — application principale (V6)
   Fichier unique volontairement (pas de bundler) mais organisé en sections
   claires. Le HTML/CSS/JS restent séparés (index.html / css / js).

   Compatibilité des données : ce fichier lit et migre en douceur les
   anciennes clés localStorage (bgt4, budgetV3, budgetV2, orion_v21_goals,
   orion_plus_v3/v4). Rien n'est jamais supprimé silencieusement : une
   sauvegarde horodatée est créée avant chaque migration de schéma.
   ========================================================================= */
(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     0. CONSTANTES & UTILITAIRES
     ------------------------------------------------------------------- */
  const SCHEMA_VERSION = 6;
  const ML = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const CATS = { logement:'Logement', alimentation:'Alimentation', transport:'Transport', loisirs:'Loisirs', sante:'Santé', abonnements:'Abonnements', assurances:'Assurances', credits:'Crédits', enfants:'Enfants', autres:'Autres' };
  const ESSENTIAL_CATS = ['logement','alimentation','sante','assurances','credits','transport'];
  const COLORS = { logement:'#16a15b', alimentation:'#8b6aa8', transport:'#f39718', loisirs:'#f0b21d', sante:'#64b89f', abonnements:'#2781d8', assurances:'#4e8fe7', credits:'#ea6b2d', enfants:'#ee5d89', autres:'#5f8aa8' };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const num = v => (Number.isFinite(+v) ? +v : 0);
  const p2 = n => String(n).padStart(2, '0');
  const eur = v => num(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const tSign = v => (v >= 0 ? '+' : '') + eur(v);
  const iso = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
  const today = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const uid = p => `${p || 'x'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  function safeParse(s, d) { try { const v = JSON.parse(s); return (v === null || v === undefined) ? d : v; } catch { return d; } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function monthKeyAdd(key, n) { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; }
  function monthsBetween(a, b) { const A = a.slice(0, 7).split('-').map(Number), B = b.slice(0, 7).split('-').map(Number); return (B[0] - A[0]) * 12 + (B[1] - A[1]); }
  function daysUntilDate(s) { if (!s) return null; const a = new Date(); a.setHours(0,0,0,0); const b = new Date(s + 'T00:00:00'); return Math.ceil((b - a) / 86400000); }
  function dateLabel(s) { if (!s) return 'Sans date'; const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('fr-FR', { day:'numeric', month:'short' }); }
  function dateLabelLong(s) { if (!s) return '—'; const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }); }
  const brandOf = (name, cat) => (window.ORION_BRANDS ? window.ORION_BRANDS.identify(name, cat) : { mark:'•', cls:'brand-generic', matched:false, suggestedCat: cat || 'autres' });

  /* Bus d'événements interne (léger) + toast — synchronisation + retours visuels.
     Toute écriture de données émet 'budget:dataChanged'. Aucun framework. */
  const Bus = (() => { const map = {}; return {
    on: (ev, fn) => { (map[ev] = map[ev] || []).push(fn); },
    emit: (ev, data) => { (map[ev] || []).forEach(fn => { try { fn(data); } catch (_) {} }); }
  }; })();
  window.ORION_BUS = Bus;
  let _toastEl = null, _toastTimer = null;
  function toast(msg, undo) {
    if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'home-toast'; document.body.appendChild(_toastEl); }
    _toastEl.innerHTML = esc(msg) + (undo ? ' <button class="undo" type="button">Annuler</button>' : '');
    _toastEl.classList.add('show');
    if (undo) { const b = _toastEl.querySelector('.undo'); if (b) b.onclick = () => { _toastEl.classList.remove('show'); try { undo(); } catch (_) {} }; }
    clearTimeout(_toastTimer); _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), undo ? 4200 : 2200);
  }

  /* ---------------------------------------------------------------------
     1. STOCKAGE — clés, chargement, migrations versionnées, sauvegardes
     ------------------------------------------------------------------- */
  const KEY_BUDGET = 'bgt4';
  const KEY_BUDGET_LEGACY = ['budgetV3', 'budgetV2'];
  const KEY_EXTRA = 'orion_plus_v6';
  const KEY_EXTRA_LEGACY = ['orion_plus_v4', 'orion_plus_v3'];
  const KEY_GOALS = 'orion_v21_goals';
  const KEY_BACKUPS = 'orion_backups_v1';
  const KEY_MIGLOG = 'orion_migrations_log';
  const ALL_DATA_KEYS = [KEY_BUDGET, ...KEY_BUDGET_LEGACY, KEY_EXTRA, ...KEY_EXTRA_LEGACY, KEY_GOALS];

  function migrateMonth(m) {
    m = m || {};
    return {
      income: Array.isArray(m.income) ? m.income : [],
      expenses: Array.isArray(m.expenses) ? m.expenses : [],
      savings: m.savings || { amount: 0, paid: false, date: '' },
      meta: m.meta || {}
    };
  }

  function readFirst(keys) { for (const k of keys) { const raw = localStorage.getItem(k); if (raw) return { key: k, raw }; } return null; }

  function loadBudget() {
    const found = readFirst([KEY_BUDGET, ...KEY_BUDGET_LEGACY]);
    let d = found ? safeParse(found.raw, {}) : {};
    if (!d || typeof d !== 'object') d = {};
    d.monthlyData = d.monthlyData || {};
    if (!Object.keys(d.monthlyData).length && d.years) {
      Object.keys(d.years).forEach(y => { const ms = d.years[y]?.months || {}; Object.keys(ms).forEach(m => { d.monthlyData[`${y}-${p2(+m + 1)}`] = migrateMonth(ms[m]); }); });
    }
    if (!Object.keys(d.monthlyData).length && d.months) {
      const y = d.currentYear || new Date().getFullYear();
      Object.keys(d.months).forEach(m => { d.monthlyData[`${y}-${p2(+m + 1)}`] = migrateMonth(d.months[m]); });
    }
    d.recurringTemplates = Array.isArray(d.recurringTemplates) ? d.recurringTemplates : [];
    d.recurringTemplates.forEach(t => { if (!Array.isArray(t.skipMonths)) t.skipMonths = []; if (!t.overrides || typeof t.overrides !== 'object') t.overrides = {}; });
    return d;
  }

  function loadExtra() {
    const found = readFirst([KEY_EXTRA, ...KEY_EXTRA_LEGACY]);
    let e = found ? safeParse(found.raw, {}) : {};
    if (!e || typeof e !== 'object') e = {};
    e.birthdays = Array.isArray(e.birthdays) ? e.birthdays : [];
    e.exchanges = Array.isArray(e.exchanges) ? e.exchanges : [];
    e.strategy = e.strategy || { capital: 0, monthly: 300, rate: 7 };
    // Migration additive (non destructive) : horizon de projection et taux des 3 scénarios.
    e.strategy.horizon = num(e.strategy.horizon) || 20;
    e.strategy.scenarioRates = e.strategy.scenarioRates || { prudent: 5, central: num(e.strategy.rate) || 7, dynamique: 10 };
    if (!Array.isArray(e.pockets) || !e.pockets.length) {
      e.pockets = [
        { id: uid('pk'), name: 'Sécurité', emoji: '🛡️', balance: num(e.strategy?.emergencyFund) || 0, monthlyTarget: 0, security: true },
        { id: uid('pk'), name: 'Projets', emoji: '📦', balance: 0, monthlyTarget: 0 },
        { id: uid('pk'), name: 'Vacances', emoji: '🌴', balance: 0, monthlyTarget: 0 },
        { id: uid('pk'), name: 'Disponible', emoji: '💶', balance: 0, monthlyTarget: 0 }
      ];
    }
    e.coverageTargetMonths = num(e.coverageTargetMonths) || 6;
    return e;
  }

  function loadGoals() {
    let g = safeParse(localStorage.getItem(KEY_GOALS), []);
    if (!Array.isArray(g)) g = [];
    g.forEach(x => { if (!x.id) x.id = uid('g'); });
    return g;
  }

  function loadBackups() { const b = safeParse(localStorage.getItem(KEY_BACKUPS), []); return Array.isArray(b) ? b : []; }
  function saveBackups() { try { localStorage.setItem(KEY_BACKUPS, JSON.stringify(backups)); } catch { /* quota: ignore silencieusement, ne bloque pas l'app */ } }

  function snapshotNow(label, auto) {
    const data = {};
    ALL_DATA_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
    backups.unshift({ id: uid('bk'), ts: new Date().toISOString(), label: label || 'Sauvegarde', auto: !!auto, data });
    // on garde un historique raisonnable : 8 auto + toutes les manuelles (max 20 au total)
    const manual = backups.filter(b => !b.auto);
    const autos = backups.filter(b => b.auto).slice(0, 8);
    backups = [...manual, ...autos].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 20);
    saveBackups();
  }

  function restoreSnapshot(id) {
    const bk = backups.find(b => b.id === id);
    if (!bk) return false;
    // sécurité : on sauvegarde l'état courant avant d'écraser quoi que ce soit
    snapshotNow('Avant restauration', true);
    Object.entries(bk.data).forEach(([k, v]) => localStorage.setItem(k, v));
    return true;
  }

  function runMigrations(rawBudget) {
    const stored = num(rawBudget.schema);
    if (stored >= SCHEMA_VERSION) { rawBudget.schema = Math.max(SCHEMA_VERSION, stored); return rawBudget; }
    // Sauvegarde de sécurité systématique avant toute migration de schéma.
    snapshotNow(`Avant migration v${stored || 0} → v${SCHEMA_VERSION}`, true);
    const log = safeParse(localStorage.getItem(KEY_MIGLOG), []);
    log.push({ from: stored || 0, to: SCHEMA_VERSION, ts: new Date().toISOString() });
    try { localStorage.setItem(KEY_MIGLOG, JSON.stringify(log)); } catch {}
    rawBudget.schema = SCHEMA_VERSION;
    rawBudget.__justMigrated = true;
    return rawBudget;
  }

  let backups = loadBackups();
  let budget = runMigrations(loadBudget());
  let extra = loadExtra();
  let goals = loadGoals();
  let year = Number.isInteger(budget.currentYear) ? budget.currentYear : new Date().getFullYear();
  let month = Number.isInteger(budget.currentMonth) ? budget.currentMonth : new Date().getMonth();
  let page = 'home';
  let lastRenderedPage = null; // used by render() to reset scroll only on real page changes
  let txFilter = 'all';
  let txView = 'due';       // 'due' | 'paid' — grands onglets Dépenses
  let txQuick = 'all';      // all | late | installments | recurring
  let txQuery = '';         // recherche live
  let txPaidOpen = false;   // section "Payées récemment" repliée par défaut
  let planningRange = 30;
  let stratPreviewRate = null; // overrides extra.strategy.rate for live "et si" preview only
  let stratMetric = 'capital'; // 'capital' | 'interets' | 'versements' — métrique affichée sur "Évolution de ton capital"
  let stratProjScenario = 'central'; // scénario affiché sur "Projection détaillée"
  let stratWhatIfDelta = 100; // dernier delta saisi dans la simulation "Et si ?" de Ma stratégie
  const chartData = {}; // stocke les points de données par id de graphique pour les info-bulles au survol
  const key = () => `${year}-${p2(month + 1)}`;

  function saveBudget() { budget.currentYear = year; budget.currentMonth = month; budget.schema = SCHEMA_VERSION; try { localStorage.setItem(KEY_BUDGET, JSON.stringify(budget)); } catch {} Bus.emit('budget:dataChanged', { source: 'budget' }); }
  // Persiste immédiatement si une migration de schéma vient d'avoir lieu, pour ne pas
  // la relancer (et resnapshot) à chaque chargement tant qu'aucune autre action n'a sauvegardé.
  if (budget.__justMigrated) { delete budget.__justMigrated; saveBudget(); }
  function saveExtra() { try { localStorage.setItem(KEY_EXTRA, JSON.stringify(extra)); } catch {} Bus.emit('budget:dataChanged', { source: 'extra' }); }
  function saveGoals() { try { localStorage.setItem(KEY_GOALS, JSON.stringify(goals)); } catch {} Bus.emit('budget:dataChanged', { source: 'goals' }); }

  /* ---------------------------------------------------------------------
     2. MOTEUR DE RÉCURRENCE
     ------------------------------------------------------------------- */
  function occurrenceIndex(t, k) {
    const sk = (t.startDate || '').slice(0, 7);
    if (!sk || k < sk) return null;
    if (t.endDate && k > (t.endDate || '').slice(0, 7)) return null;
    const elapsed = monthsBetween(sk, k);
    if (t.freq === 'once' && elapsed !== 0) return null;
    const interval = Math.max(1, num(t.interval) || 1);
    if (t.freq === 'everyN' && elapsed % interval !== 0) return null;
    const i = t.freq === 'everyN' ? elapsed / interval : elapsed;
    if (num(t.installments) > 0 && i >= num(t.installments)) return null;
    if (Array.isArray(t.skipMonths) && t.skipMonths.includes(k)) return null;
    return i;
  }

  function generateTemplates(k) {
    const mo = budget.monthlyData[k] || { income: [], expenses: [], savings: { amount: 0, paid: false, date: '' }, meta: {} };
    let changed = false;
    (budget.recurringTemplates || []).forEach(t => {
      const occ = occurrenceIndex(t, k);
      if (occ == null) return;
      const list = t.kind === 'income' ? mo.income : mo.expenses;
      if (list.some(r => r.templateId === t.id)) return;
      const day = Math.min(num(t.dueDay) || 1, lastDayOfMonth(+k.slice(0, 4), +k.slice(5, 7)));
      const ov = (t.overrides && t.overrides[k]) || null;
      const nr = {
        name: ov?.name || t.name,
        amount: num(ov ? ov.amount : t.amount),
        cat: ov?.cat || t.cat || 'autres',
        paid: false, paidDate: '',
        dueDate: t.kind === 'income' ? '' : `${k}-${p2(day)}`,
        templateId: t.id, recurring: true, auto: !!t.auto, createdPeriod: k
      };
      if (t.customEmoji) nr.customEmoji = t.customEmoji;
      list.push(nr);
      changed = true;
    });
    budget.monthlyData[k] = mo;
    if (changed) saveBudget();
  }

  function monthObj(k = key()) {
    if (!budget.monthlyData[k]) budget.monthlyData[k] = { income: [], expenses: [], savings: { amount: 0, paid: false, date: '' }, meta: { generated: true } };
    generateTemplates(k);
    return budget.monthlyData[k];
  }

  // Projection en lecture seule (sans persister) pour la planification sur plusieurs mois.
  function projectMonth(k) {
    if (budget.monthlyData[k]) { generateTemplates(k); return budget.monthlyData[k]; }
    const fake = { income: [], expenses: [] };
    (budget.recurringTemplates || []).forEach(t => {
      const occ = occurrenceIndex(t, k);
      if (occ == null) return;
      const list = t.kind === 'income' ? fake.income : fake.expenses;
      const day = Math.min(num(t.dueDay) || 1, lastDayOfMonth(+k.slice(0, 4), +k.slice(5, 7)));
      const ov = (t.overrides && t.overrides[k]) || null;
      list.push({ name: ov?.name || t.name, amount: num(ov ? ov.amount : t.amount), cat: ov?.cat || t.cat || 'autres', paid: false, dueDate: t.kind === 'income' ? '' : `${k}-${p2(day)}`, templateId: t.id, projected: true });
    });
    return fake;
  }

  function totals(m = monthObj()) {
    let tin = 0, tex = 0, pin = 0, pex = 0;
    (m.income || []).forEach(r => { tin += num(r.amount); if (r.paid || r.auto || /salaire|paie/i.test(r.name || '')) pin += num(r.amount); });
    (m.expenses || []).forEach(r => { tex += num(r.amount); if (r.paid) pex += num(r.amount); });
    const sav = num(m.savings?.amount);
    return { tin, tex, pin, pex, sav, current: pin - pex, final: pin - tex, future: tex - pex, remaining: pin - tex, pct: tin ? Math.round((tex / tin) * 100) : 0, paidPct: tex ? Math.round((pex / tex) * 100) : 0 };
  }

  function catTotals(m = monthObj(), onlyPaid = true) {
    const o = {};
    (m.expenses || []).forEach(r => { if (onlyPaid && !r.paid) return; o[r.cat || 'autres'] = (o[r.cat || 'autres'] || 0) + num(r.amount); });
    return o;
  }

  function isAutoIncome(r) { return !!(r && r.auto) || /salaire|paie|pay/i.test(r?.name || ''); }

  /* Identité visuelle d'une dépense — ne renvoie JAMAIS de case vide.
     Priorité : 1) emoji personnalisé (ligne, sinon modèle) 2) logo de marque
     reconnu (brands.js) 3) emoji de catégorie 4) fallback générique. */
  const CAT_EMOJI = {
    logement: '🏠', alimentation: '🛒', transport: '🚗', loisirs: '🎮', sante: '🩺',
    abonnements: '📺', assurances: '🛡️', credits: '🏦', enfants: '🧸', autres: '✨'
  };
  function templateOf(r) { return r && r.templateId ? (budget.recurringTemplates || []).find(t => t.id === r.templateId) : null; }
  function identityOf(r) {
    const tpl = templateOf(r);
    const custom = (r && r.customEmoji) || (tpl && tpl.customEmoji) || '';
    if (custom) return { mark: custom, cls: 'brand-generic', label: null, custom: true };
    const br = brandOf(r.name, r.cat);
    if (br.matched) return br;
    return { mark: CAT_EMOJI[r.cat] || br.mark || '✨', cls: 'brand-generic', label: null };
  }

  function dueInfo(r) {
    if (r.paid) return { cls: 'paid', label: r.paidDate ? 'Payé ' + dateLabel(r.paidDate) : 'Payé' };
    const dl = daysUntilDate(r.dueDate);
    if (dl == null) return { cls: 'nodate', label: 'Sans date' };
    if (dl < 0) return { cls: 'late', label: 'En retard de ' + Math.abs(dl) + ' jour' + (Math.abs(dl) > 1 ? 's' : '') };
    if (dl === 0) return { cls: 'urgent', label: "Aujourd’hui" };
    if (dl === 1) return { cls: 'urgent', label: 'Demain' };
    if (dl <= 5) return { cls: 'soon', label: 'Dans ' + dl + ' jours' };
    return { cls: 'future', label: 'Dans ' + dl + ' jours' };
  }

  function birthdayNext(b) {
    if (!b.birthDate) return null;
    const d = new Date(b.birthDate + 'T12:00:00');
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let next = new Date(t.getFullYear(), d.getMonth(), d.getDate());
    if (next < t) next = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
    const age = next.getFullYear() - d.getFullYear();
    return { date: iso(next.getFullYear(), next.getMonth(), next.getDate()), days: Math.ceil((next - t) / 86400000), age };
  }

  function installmentItems(atKey = key()) {
    return (budget.recurringTemplates || [])
      .filter(t => t.kind === 'expense' && num(t.installments) > 0)
      .map(t => {
        const sk = (t.startDate || '').slice(0, 7);
        const elapsed = Math.max(0, monthsBetween(sk, atKey));
        const paid = Math.min(num(t.installments), elapsed + 1);
        return { ...t, paidCount: paid, remainingCount: Math.max(0, num(t.installments) - paid), remainingAmount: Math.max(0, num(t.installments) - paid) * num(t.amount), currentIndex: elapsed };
      })
      .filter(x => x.remainingCount >= 0 && x.paidCount <= num(x.installments));
  }

  function annualItems() {
    const map = new Map();
    (budget.recurringTemplates || []).filter(t => t.kind === 'expense' && num(t.installments) === 0 && t.freq !== 'once').forEach(t => {
      const interval = Math.max(1, num(t.interval) || 1);
      map.set(t.id, { id: t.id, name: t.name, monthly: num(t.amount) / interval, annual: (num(t.amount) * 12) / interval, cat: t.cat || 'autres' });
    });
    if (!map.size) {
      (monthObj().expenses || []).filter(r => r.recurring || r.templateId).forEach(r => map.set(r.templateId || r.name, { name: r.name, monthly: num(r.amount), annual: num(r.amount) * 12, cat: r.cat || 'autres' }));
    }
    return [...map.values()].sort((a, b) => b.annual - a.annual);
  }

  function upcomingExpenses(atKey = key()) {
    const src = atKey === key() ? monthObj() : projectMonth(atKey);
    return (src.expenses || []).filter(r => !r.paid && r.dueDate).slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /* ---------------------------------------------------------------------
     3. PLANIFICATION MULTI-PÉRIODE & "MOIS CHARGÉ"
     ------------------------------------------------------------------- */
  function projectRange(days) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + days * 86400000);
    const items = [];
    let cursorKey = `${start.getFullYear()}-${p2(start.getMonth() + 1)}`;
    const endKey = `${end.getFullYear()}-${p2(end.getMonth() + 1)}`;
    let guard = 0;
    while (cursorKey <= endKey && guard < 26) {
      const mo = cursorKey === key() ? monthObj(cursorKey) : projectMonth(cursorKey);
      (mo.expenses || []).forEach(r => { if (r.dueDate && new Date(r.dueDate) >= start && new Date(r.dueDate) <= end) items.push(r); });
      cursorKey = monthKeyAdd(cursorKey, 1);
      guard++;
    }
    extra.birthdays.forEach(b => { const n = birthdayNext(b); if (n && n.days >= 0 && n.days <= days) items.push({ name: b.name, amount: num(b.budget), dueDate: n.date, isBirthday: true }); });
    return items.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  }

  function monthlyAverageExpenses(excludeKey) {
    const keys = Object.keys(budget.monthlyData).filter(k => k !== excludeKey);
    const vals = keys.map(k => totals(budget.monthlyData[k]).tex).filter(v => v > 0);
    if (!vals.length) return totals().tex || 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function heavyMonthsAhead() {
    const out = [];
    let cursorKey = key();
    for (let i = 1; i <= 6; i++) {
      cursorKey = monthKeyAdd(cursorKey, 1);
      const mo = projectMonth(cursorKey);
      const planned = (mo.expenses || []).reduce((s, r) => s + num(r.amount), 0);
      const avg = monthlyAverageExpenses(cursorKey);
      if (avg > 0 && planned > avg * 1.25) {
        const [y, m] = cursorKey.split('-').map(Number);
        out.push({ key: cursorKey, label: ML[m - 1], planned, avg, pct: Math.round(((planned - avg) / avg) * 100) });
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------
     4. STRATÉGIE (investissement, point de bascule, point d'accélération)
     ------------------------------------------------------------------- */
  function projectCapital(years, capital, monthly, ratePct) {
    const mr = Math.pow(1 + num(ratePct) / 100, 1 / 12) - 1;
    let c = capital;
    for (let i = 0; i < years * 12; i++) c = c * (1 + mr) + monthly;
    return c;
  }

  function annualExpensesEstimate() {
    const keys = Object.keys(budget.monthlyData);
    const vals = keys.map(k => totals(budget.monthlyData[k]).pex).filter(v => v > 0);
    if (vals.length >= 3) return (vals.reduce((a, b) => a + b, 0) / vals.length) * 12;
    return (totals().tex || 0) * 12;
  }

  function strategyCalc(rateOverride = null) {
    const s = extra.strategy || {};
    const capital = Math.max(0, num(s.capital));
    const monthly = Math.max(0, num(s.monthly));
    const rate = rateOverride != null ? rateOverride : Math.max(0, num(s.rate));
    const horizon = Math.max(5, num(s.horizon) || 20);
    const engine = financeEngine(capital, monthly, rate, horizon);
    const gain = capital * (rate / 100);
    const progress = engine.annual > 0 ? Math.min(999, (gain / engine.annual) * 100) : 0;
    const target = rate > 0 ? engine.annual / (rate / 100) : 0;
    const target2 = rate > 0 ? (engine.annual * 2) / (rate / 100) : 0;
    const annualExp = annualExpensesEstimate();
    const libertyPct = annualExp > 0 ? Math.round((gain / annualExp) * 100) : 0;
    return {
      capital, monthly, rate, horizon, annual: engine.annual, target, target2, gain, progress,
      basculeMonths: engine.basculeMonth, accelMonths: engine.accelMonth,
      dailyGain: gain / 365, monthlyGain: gain / 12,
      libertyPct, annualExpenses: annualExp, engine
    };
  }

  function monthsToText(m) { if (m == null) return 'Horizon non calculable'; const y = Math.floor(m / 12), mm = m % 12; if (y <= 0) return `${mm} mois`; if (mm === 0) return `${y} an${y > 1 ? 's' : ''}`; return `${y} an${y > 1 ? 's' : ''} et ${mm} mois`; }
  function monthsToDate(m) { if (m == null) return '—'; const d = new Date(); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); }

  /* ---------------------------------------------------------------------
     4bis. MOTEUR FINANCIER UNIFIÉ (Ma stratégie)
     ------------------------------------------------------------------- -
     Convention de calcul (identique partout dans l'écran Ma stratégie) :
     - le taux mensuel est dérivé du taux annuel par composition :
         mr = (1 + tauxAnnuel)^(1/12) - 1
     - à chaque mois : le capital du mois précédent produit son rendement,
       PUIS le versement mensuel est ajouté en fin de mois (il ne produit
       donc des intérêts qu'à partir du mois suivant) :
         capital(m) = capital(m-1) * (1 + mr) + versementMensuel
     - "versements cumulés" = somme des versements déjà effectués (hors
       capital initial) ; "intérêts cumulés" = capital(m) - capital(0) -
       versements cumulés(m).
     Ce même moteur alimente : les jauges, le graphique d'évolution, les
     scénarios, la simulation « Et si ? » et le tableau des repères — pour
     ne jamais obtenir de résultats contradictoires entre les cartes.
     ------------------------------------------------------------------- */
  function financeEngine(capital0, monthly, ratePct, horizonYears) {
    capital0 = Math.max(0, num(capital0));
    monthly = Math.max(0, num(monthly));
    const rate = Math.max(0, num(ratePct)) / 100;
    const mr = Math.pow(1 + rate, 1 / 12) - 1;
    const annual = monthly * 12;
    const horizonMonths = Math.max(12, Math.round(num(horizonYears) || 20) * 12);
    const searchCap = Math.max(horizonMonths, 1200); // recherche du point de bascule/accélération au-delà de l'horizon affiché si besoin (jusqu'à 100 ans)
    let c = capital0, versements = 0;
    let basculeMonth = null, accelMonth = null;
    const points = [{ month: 0, year: 0, capital: c, versements: 0, interets: 0 }];
    for (let m = 1; m <= searchCap; m++) {
      c = c * (1 + mr) + monthly;
      versements += monthly;
      const interets = c - capital0 - versements;
      const gain = c * rate;
      if (basculeMonth == null && annual > 0 && gain >= annual) basculeMonth = m;
      if (accelMonth == null && annual > 0 && gain >= annual * 2) accelMonth = m;
      if (m <= horizonMonths) points.push({ month: m, year: m / 12, capital: c, versements, interets });
      if (m >= horizonMonths && basculeMonth != null && accelMonth != null) break;
    }
    const last = points[points.length - 1];
    return {
      capital0, monthly, ratePct: num(ratePct), rate, annual, horizonYears: horizonMonths / 12,
      points, basculeMonth, accelMonth,
      finalCapital: last.capital, finalVersements: last.versements, finalInterets: last.interets
    };
  }

  function pointAtYear(engine, y) {
    const targetMonth = Math.round(y * 12);
    let best = engine.points[0];
    for (const p of engine.points) { if (Math.abs(p.month - targetMonth) < Math.abs(best.month - targetMonth)) best = p; }
    return best;
  }

  function snapshotYears(horizonYears) {
    const h = Math.max(5, Math.round(horizonYears));
    const step = h <= 12 ? 2 : 5;
    const ys = [0];
    for (let y = step; y < h; y += step) ys.push(y);
    ys.push(h);
    return ys;
  }

  const SCENARIOS = [
    { key: 'prudent', label: 'Prudent', rate: 5, color: '#e8892c' },
    { key: 'central', label: 'Central', rate: 7, color: '#20ad6f' },
    { key: 'dynamique', label: 'Dynamique', rate: 10, color: '#2f6fe4' }
  ];

  /* ---------------------------------------------------------------------
     4ter. GRAPHIQUES SVG (sans dépendance externe) + jauges
     ------------------------------------------------------------------- */
  const CHART_W = 640, CHART_H = 220, CHART_PAD_L = 54, CHART_PAD_R = 14, CHART_PAD_T = 14, CHART_PAD_B = 26;
  function lineChartSVG(id, series, opts = {}) {
    const W = opts.width || CHART_W, H = opts.height || CHART_H, PAD_L = CHART_PAD_L, PAD_B = CHART_PAD_B, PAD_T = CHART_PAD_T, PAD_R = CHART_PAD_R;
    const allX = series[0]?.data.map(p => p.x) || [0, 1];
    const allY = series.flatMap(s => s.data.map(p => p.y));
    const maxX = Math.max(...allX, 1);
    const maxY = Math.max(...allY, 1) * 1.08;
    const minY = Math.min(0, ...allY);
    const sx = x => PAD_L + (x / maxX) * (W - PAD_L - PAD_R);
    const sy = y => (H - PAD_B) - ((y - minY) / (maxY - minY || 1)) * (H - PAD_B - PAD_T);
    const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => minY + f * (maxY - minY));
    const grid = gridY.map(v => `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" class="chart-grid"/><text x="${PAD_L - 8}" y="${(sy(v) + 3).toFixed(1)}" class="chart-axis" text-anchor="end">${eurShort(v)}</text>`).join('');
    const xTicksCount = Math.min(6, Math.max(2, Math.round(maxX)));
    const xTicks = Array.from({ length: xTicksCount + 1 }, (_, i) => Math.round((i * maxX) / xTicksCount));
    const xLabels = xTicks.map(xv => `<text x="${sx(xv).toFixed(1)}" y="${H - 6}" class="chart-axis" text-anchor="middle">${new Date().getFullYear() + xv}</text>`).join('');
    const paths = series.map(s => {
      const d = s.data.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.75" stroke-dasharray="${s.dash || ''}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    const markers = (opts.markers || []).map(mk => `<g><line x1="${sx(mk.x).toFixed(1)}" x2="${sx(mk.x).toFixed(1)}" y1="${PAD_T}" y2="${H - PAD_B}" class="chart-marker-line"/><circle cx="${sx(mk.x).toFixed(1)}" cy="${sy(mk.y).toFixed(1)}" r="4.5" fill="${mk.color || '#20ad6f'}" stroke="#fff" stroke-width="2"/></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" id="${id}" data-maxx="${maxX}" data-minx="0" preserveAspectRatio="none">
      ${grid}${markers}${paths}
      <g class="chart-hover" id="${id}-hover" style="display:none"><line x1="0" x2="0" y1="${PAD_T}" y2="${H - PAD_B}" class="chart-hover-line"/></g>
      ${xLabels}
    </svg>`;
  }

  function eurShort(v) {
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v / 1000) + 'k €';
    return Math.round(v) + ' €';
  }

  function semiGauge(pct, color, big, small) {
    const clamped = Math.max(0, Math.min(100, pct));
    return `<div class="gauge">
      <div class="gauge-fill" style="--pct:${clamped};--gcolor:${color}"></div>
      <div class="gauge-center"><b>${big}</b><small>${small}</small></div>
    </div>`;
  }

  /* ---------------------------------------------------------------------
     5. "ET SI ?" — simulateur réutilisable
     ------------------------------------------------------------------- */
  function whatIf(monthlyDelta) {
    const s = extra.strategy || {};
    const rate = Math.max(0, num(s.rate));
    const fiveYearInvested = projectCapital(5, 0, monthlyDelta, rate);
    return {
      monthly: monthlyDelta,
      annual: monthlyDelta * 12,
      fiveYears: monthlyDelta * 60,
      investedFiveYears: fiveYearInvested,
      rate
    };
  }

  /* ---------------------------------------------------------------------
     6. POCHES D'ÉPARGNE
     ------------------------------------------------------------------- */
  function pocketsTotal() { return extra.pockets.reduce((s, p) => s + num(p.balance), 0); }
  function securityPocket() { return extra.pockets.find(p => p.security) || extra.pockets[0]; }
  function essentialMonthlyExpenses() {
    const cur = catTotals(monthObj(), false);
    return ESSENTIAL_CATS.reduce((s, c) => s + num(cur[c]), 0) || (totals().tex * 0.6);
  }
  function coverageMonths() { const ess = essentialMonthlyExpenses(); const sec = securityPocket(); return ess > 0 ? num(sec?.balance) / ess : 0; }

  /* ---------------------------------------------------------------------
     7. OBJECTIFS
     ------------------------------------------------------------------- */
  function goalMonthlyNeeded(g) {
    if (!g.targetDate) return null;
    const m = Math.max(1, monthsBetween(today(), g.targetDate));
    const remain = Math.max(0, num(g.target) - num(g.current));
    return remain / m;
  }
  function goalMonthsLeft(g) { if (!g.targetDate) return null; return Math.max(0, monthsBetween(today(), g.targetDate)); }

  /* ---------------------------------------------------------------------
     8. INTELLIGENCE LOCALE — alertes contextuelles
     ------------------------------------------------------------------- */
  function insights() {
    const out = [];
    const t = totals();
    const up = upcomingExpenses();
    const avg = monthlyAverageExpenses(key());

    // Grosse dépense bientôt
    const big = up.find(r => { const d = daysUntilDate(r.dueDate); return d != null && d <= 7 && num(r.amount) > Math.max(80, avg * 0.15); });
    if (big) out.push({ icon: '⚠️', level: 'warn', text: `Grosse dépense à venir : ${esc(big.name)} (${eur(big.amount)}) dans ${daysUntilDate(big.dueDate)} jour(s).` });

    // Mois chargé
    const heavy = heavyMonthsAhead();
    if (heavy.length) out.push({ icon: '📅', level: 'warn', text: `${heavy[0].label} sera un mois chargé : ${eur(heavy[0].planned)} prévus (+${heavy[0].pct}% vs moyenne).` });

    // Dépenses récurrentes en hausse
    (budget.recurringTemplates || []).filter(t => t.kind === 'expense' && !t.installments).forEach(tpl => {
      const hist = Object.keys(budget.monthlyData).filter(k => k < key()).sort().slice(-4);
      const amounts = hist.map(k => (budget.monthlyData[k].expenses || []).find(r => r.templateId === tpl.id)).filter(Boolean).map(r => num(r.amount));
      if (amounts.length >= 2) {
        const prevAvg = amounts.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, amounts.length - 1);
        const last = amounts[amounts.length - 1];
        if (prevAvg > 0 && last > prevAvg * 1.15) out.push({ icon: '📈', level: 'info', text: `${esc(tpl.name)} a augmenté (${eur(last)} vs ${eur(prevAvg)} en moyenne).` });
      }
    });

    // Abonnements coûteux à l'année
    annualItems().filter(a => CATS[a.cat] === CATS.abonnements ? true : a.cat === 'abonnements').forEach(a => { if (a.annual > 150) out.push({ icon: '💳', level: 'info', text: `${esc(a.name)} coûte ${eur(a.annual)}/an.` }); });

    // Échéancier qui se termine ce mois-ci
    installmentItems().forEach(i => { if (i.remainingCount === 0 && i.currentIndex === num(i.installments) - 1) out.push({ icon: '✅', level: 'good', text: `${esc(i.name)} : dernière échéance ce mois-ci, ${eur(i.amount)}/mois libérés le mois prochain.` }); });

    // Objectifs en avance / retard
    goals.forEach(g => {
      if (!g.targetDate || !g.createdAt) return;
      const totalSpan = Math.max(1, monthsBetween(g.createdAt, g.targetDate));
      const elapsed = Math.max(0, monthsBetween(g.createdAt, today()));
      const expectedPct = Math.min(100, (elapsed / totalSpan) * 100);
      const actualPct = num(g.target) ? Math.min(100, (num(g.current) / num(g.target)) * 100) : 0;
      if (actualPct - expectedPct > 12) out.push({ icon: '🚀', level: 'good', text: `Objectif « ${esc(g.n)} » en avance sur ton rythme.` });
      else if (expectedPct - actualPct > 12) out.push({ icon: '⏳', level: 'warn', text: `Objectif « ${esc(g.n)} » prend du retard.` });
    });

    // Épargne anormalement faible
    if (avg > 0) {
      const savHist = Object.keys(budget.monthlyData).filter(k => k < key()).sort().slice(-3).map(k => num(budget.monthlyData[k]?.savings?.amount));
      const savAvg = savHist.length ? savHist.reduce((a, b) => a + b, 0) / savHist.length : 0;
      if (savAvg > 0 && t.sav < savAvg * 0.5) out.push({ icon: '🐷', level: 'warn', text: `Épargne du mois nettement plus basse que d'habitude (${eur(t.sav)} vs ${eur(savAvg)} en moyenne).` });
    }

    // Charges fixes trop importantes
    const fixed = (monthObj().expenses || []).filter(r => r.recurring || r.templateId).reduce((s, r) => s + num(r.amount), 0);
    if (t.pin && fixed / t.pin > 0.55) out.push({ icon: '🏠', level: 'warn', text: `Tes charges fixes représentent ${Math.round((fixed / t.pin) * 100)}% de tes revenus reçus.` });

    // Anniversaire proche
    const bd = extra.birthdays.map(b => ({ b, n: birthdayNext(b) })).filter(x => x.n && x.n.days <= 14).sort((a, b) => a.n.days - b.n.days)[0];
    if (bd) out.push({ icon: '🎂', level: 'info', text: `${esc(bd.b.name)} : anniversaire dans ${bd.n.days} jour(s), prévoir ${eur(bd.b.budget)}.` });

    // Dépense annuelle à anticiper
    const nextAnnual = annualItems().find(a => a.annual > 100);
    if (nextAnnual && !out.some(i => i.text.includes(nextAnnual.name))) out.push({ icon: '🗓️', level: 'info', text: `Pense à provisionner ${eur(nextAnnual.monthly)}/mois pour ${esc(nextAnnual.name)} (${eur(nextAnnual.annual)}/an).` });

    return out.slice(0, 6);
  }

  /* ---------------------------------------------------------------------
     9. RENDU — en-tête, navigation
     ------------------------------------------------------------------- */
  function setTitle(t, showPeriod = true) { $('#title').textContent = t; $('#periodBtn').style.display = showPeriod ? '' : 'none'; $('#periodBtn').textContent = `${ML[month]} ${year}⌄`; }
  function navActive() { $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page)); }
  function updateBadge() { const c = upcomingExpenses().filter(r => { const d = daysUntilDate(r.dueDate); return d != null && d >= 0 && d <= 7; }).length; $('#bellBadge').hidden = !c; $('#bellBadge').textContent = c; }

  function render() {
    monthObj();
    navActive();
    $('#app').classList.toggle('strategy-wide', page === 'strategy');
    const fn = {
      home: renderHome, transactions: renderTransactions, planning: renderPlanning, analysis: renderAnalysis,
      savings: renderSavings, goals: renderGoals, strategy: renderStrategy, plus: renderPlus,
      birthdays: renderBirthdays, installments: renderInstallments, annual: renderAnnual, exchanges: renderExchanges,
      backups: renderBackups
    }[page] || renderHome;
    fn();
    updateBadge();
    // Navigating to a different screen must start at the top: without this, a scroll position
    // inherited from a longer previous page can land mid-content under the sticky header,
    // making the new screen's top elements unreachable/unclickable until the user scrolls.
    if (page !== lastRenderedPage) {
      window.scrollTo(0, 0);
      lastRenderedPage = page;
    }
    $('#view').classList.remove('fade-in'); void $('#view').offsetWidth; $('#view').classList.add('fade-in');
  }

  function freqLabel(t) {
    if (!t) return 'Ponctuelle';
    if (num(t.installments) > 0) return `Échéancier · ${t.installments} fois`;
    if (t.freq === 'once') return 'Ponctuelle';
    const i = Math.max(1, num(t.interval) || 1);
    return i === 1 ? 'Mensuelle' : i === 3 ? 'Trimestrielle' : i === 6 ? 'Semestrielle' : i === 12 ? 'Annuelle' : `Tous les ${i} mois`;
  }

  function rowTx(r, type, idx) {
    const done = r.paid || isAutoIncome(r);
    const info = type === 'expense' ? dueInfo(r) : { cls: done ? 'paid' : 'future', label: done ? 'Reçu' : 'En attente' };
    const br = brandOf(r.name, r.cat);
    const tpl = r.templateId ? (budget.recurringTemplates || []).find(t => t.id === r.templateId) : null;
    return `<div class="row tx-row ${done ? 'done' : ''}">
      <button class="tx-check ${info.cls}" data-toggle="${type}" data-index="${idx}" aria-label="${done ? 'Marquer comme non payé' : 'Marquer comme payé'}">${done ? '✓' : ''}</button>
      <div class="brandmark ${br.cls}" title="${esc(br.label || CATS[r.cat] || 'Autres')}">${br.mark}</div>
      <div class="row-main clickable" data-edit-tx="${type}" data-index="${idx}">
        <b>${esc(r.name || 'Sans libellé')}</b>
        <small>${type === 'income' ? 'Revenu' : (CATS[r.cat] || 'Autres')} · ${info.label}${r.dueDate ? ' · ' + dateLabel(r.dueDate) : ''}</small>
        ${type === 'expense' ? `<span class="freq-badge">${freqLabel(tpl)}</span>` : ''}
      </div>
      <div class="amt clickable" data-edit-tx="${type}" data-index="${idx}">${type === 'income' ? '+' : '-'}${eur(r.amount)}</div>
    </div>`;
  }

  function insightsBlock(list = insights()) {
    if (!list.length) return '';
    return `<section class="card insights-card"><div class="sec-head"><h2>Ce que Budget Orion remarque</h2></div>${list.map(i => `<div class="insight-row lvl-${i.level}"><span class="insight-ic">${i.icon}</span><span>${i.text}</span></div>`).join('')}</section>`;
  }

  /* ---------------------------------------------------------------------
     10. ÉCRANS
     ------------------------------------------------------------------- */
  /* ---- Accueil : helpers dédiés (lecture seule sur les données centrales) ---- */
  function daysLeftInSelectedMonth() {
    const last = lastDayOfMonth(year, month);
    const now = new Date();
    if (now.getFullYear() === year && now.getMonth() === month) return Math.max(0, last - now.getDate());
    const firstSel = new Date(year, month, 1);
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return firstSel > todayMid ? last : 0; // mois futur : mois entier ; mois passé : 0
  }
  function homeEventColor(days, isBirthday) {
    if (isBirthday) return 'pink';
    if (days == null) return 'green';
    if (days <= 0) return 'red';
    if (days <= 3) return 'orange';
    return 'green';
  }
  function homeWhenLabel(days, isBirthday) {
    if (days == null) return isBirthday ? 'À venir' : 'Sans date';
    if (days < 0) return `En retard de ${-days} j`;
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return 'Demain';
    return `Dans ${days} jours`;
  }
  function homeTimelineEvents() {
    const mo = monthObj();
    const list = [];
    (mo.expenses || []).forEach((r, idx) => { if (!r.paid && r.dueDate) list.push({ kind: 'expense', name: r.name, cat: r.cat, amount: num(r.amount), date: r.dueDate, days: daysUntilDate(r.dueDate), idx }); });
    extra.birthdays.forEach((b, i) => { const n = birthdayNext(b); if (n && n.days >= 0 && n.days <= 45) list.push({ kind: 'birthday', name: b.name, amount: num(b.budget), date: n.date, days: n.days, i, age: n.age }); });
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return list.slice(0, 4);
  }
  function homeSavingsInfo() {
    const mo = monthObj(), t = totals();
    const engagement = (extra.pockets || []).reduce((s, p) => s + num(p.monthlyTarget), 0);
    const validated = !!(mo.savings && mo.savings.paid);
    const amount = num(mo.savings?.amount);
    const realized = validated ? amount : 0;
    const pctRev = t.pin > 0 ? Math.round((realized / t.pin) * 100) : 0;
    const pctEng = engagement > 0 ? Math.round((realized / engagement) * 100) : null;
    const hist = Object.keys(budget.monthlyData).filter(k => k <= key()).sort().slice(-6)
      .map(k => { const s = budget.monthlyData[k]?.savings; return s && s.paid ? num(s.amount) : 0; });
    return { engagement, validated, amount, realized, pctRev, pctEng, hist };
  }
  function homeSparkline(vals) {
    if (!vals || vals.length < 2 || vals.every(v => v === 0)) return '';
    const w = 100, h = 26, max = Math.max(...vals, 1), min = Math.min(...vals, 0), rng = (max - min) || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${(h - 2) - ((v - min) / rng) * (h - 5)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="home-spark"><polyline points="${pts}" fill="none" stroke="#12a45f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  // Insights priorisés et CLIQUABLES, dérivés des données existantes (aucun 2e moteur).
  function homeInsights() {
    const out = [], t = totals(), mo = monthObj();
    const now = new Date(), isFuture = (year > now.getFullYear()) || (year === now.getFullYear() && month > now.getMonth());
    if (!isFuture && !(mo.savings && mo.savings.paid) && t.pin > 0)
      out.push({ icon: '🐷', level: 'action', text: 'Pense à confirmer ton épargne du mois.', attr: 'data-edit-month-saving' });
    const avg = monthlyAverageExpenses(key()) || 0;
    const big = upcomingExpenses().map(r => ({ r, d: daysUntilDate(r.dueDate) })).filter(x => x.d != null && x.d >= 0 && x.d <= 7).sort((a, b) => num(b.r.amount) - num(a.r.amount))[0];
    if (big && num(big.r.amount) >= Math.max(120, avg * 0.2)) {
      const idx = mo.expenses.indexOf(big.r);
      out.push({ icon: '⚠️', level: 'critical', text: `Attention : ${eur(big.r.amount)} prévus dans ${big.d} jour${big.d > 1 ? 's' : ''} (${esc(big.r.name)}).`, attr: `data-edit-tx="expense" data-index="${idx}"` });
    }
    try { installmentItems().forEach(i => { if (i.remainingCount === 0 && i.currentIndex === num(i.installments) - 1) out.push({ icon: '✅', level: 'good', text: `Bonne nouvelle : ${eur(i.amount)}/mois libérés le mois prochain (${esc(i.name)}).`, attr: 'data-go="planning"' }); }); } catch (_) {}
    try { annualItems().filter(a => a.cat === 'abonnements' && a.annual > 150).sort((a, b) => b.annual - a.annual).slice(0, 1).forEach(a => { const idx = mo.expenses.findIndex(r => (r.name || '') === a.name); out.push({ icon: '💳', level: 'info', text: `${esc(a.name)} te coûte ${eur(a.annual)}/an.`, attr: idx >= 0 ? `data-edit-tx="expense" data-index="${idx}"` : 'data-go="analysis"' }); }); } catch (_) {}
    const ct = catTotals(mo, false); const ess = ESSENTIAL_CATS.reduce((s, c) => s + num(ct[c]), 0);
    if (t.tin > 0) { const pf = Math.round((ess / t.tin) * 100); if (pf >= 40) out.push({ icon: '📊', level: 'info', text: `Tes charges fixes représentent ${pf} % de tes revenus.`, attr: 'data-go="analysis"' }); }
    const rank = { critical: 0, action: 1, good: 2, info: 3 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 3);
  }
  function homeExplain(kind) {
    const t = totals(), mo = monthObj();
    const line = (l, v, c, attr) => `<div class="row${attr ? ' clickable' : ''}" ${attr || ''}><div class="row-main"><b>${l}</b></div><b class="${c || ''}">${v}</b></div>`;
    let title = 'Détail', body = '';
    if (kind === 'solde') {
      title = 'Solde disponible';
      body = `<section class="card">${line('Revenus reçus', eur(t.pin))}${line('Dépenses déjà prélevées', '- ' + eur(t.pex), 'neg')}${line('= Solde disponible', eur(t.current))}</section><div class="insight">L’argent réellement présent : revenus déjà reçus moins dépenses déjà prélevées.</div>`;
    } else if (kind === 'engage') {
      title = 'Argent déjà engagé';
      const items = (mo.expenses || []).filter(r => !r.paid).slice().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      body = `<section class="card">${line('Compte (solde disponible)', eur(t.current))}${line('Total engagé ce mois', eur(t.tex))}${line('Déjà prélevé', eur(t.pex))}${line('Prélèvements restant à venir', '- ' + eur(t.future), 'neg')}${line('Disponible réel estimé', eur(t.current - t.future), (t.current - t.future) >= 0 ? 'pos' : 'neg')}</section>
        <div class="sec-head" style="margin-top:6px"><h2>Prélèvements restant à venir</h2></div>
        <section class="card list">${items.length ? items.map(r => { const idx = mo.expenses.indexOf(r); const br = brandOf(r.name, r.cat); const di = dueInfo(r); return `<div class="row clickable" data-edit-tx="expense" data-index="${idx}"><div class="brandmark ${br.cls}">${br.mark}</div><div class="row-main"><b>${esc(r.name)}</b><small>${di.label}${r.dueDate ? ' · ' + dateLabel(r.dueDate) : ''}</small></div><b>-${eur(r.amount)}</b></div>`; }).join('') : '<div class="empty">✓ Tout est réglé pour ce mois.</div>'}</section>`;
    } else if (kind === 'projection') {
      title = 'Projection fin de mois';
      body = `<section class="card">${line('Revenus reçus', eur(t.pin))}${line('Dépenses totales prévues', '- ' + eur(t.tex), 'neg')}${line('= Projection', eur(t.final))}</section><div class="insight">Estimation si toutes les dépenses prévues se prélèvent et sans nouveau revenu. Revenus encore à recevoir : ${eur(t.tin - t.pin)}.</div>`;
    } else if (kind === 'revenus') {
      title = 'Revenus reçus';
      const inc = (mo.income || []);
      body = `<section class="card list">${inc.length ? inc.map(r => `<div class="row clickable" data-edit-tx="income" data-index="${mo.income.indexOf(r)}"><div class="row-main"><b>${esc(r.name)}</b><small>${(r.paid || isAutoIncome(r)) ? 'Reçu' : 'En attente'}</small></div><b class="pos">+${eur(r.amount)}</b></div>`).join('') : '<div class="empty">Aucun revenu.</div>'}</section>`;
    }
    openSheet(title, body);
  }
  function homeTopay() {
    const mo = monthObj();
    const items = (mo.expenses || []).filter(r => !r.paid).slice().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    if (!items.length) { toast('✓ Tout est réglé pour ce mois'); return; }
    const body = `<section class="card list">${items.map(r => { const idx = mo.expenses.indexOf(r); const br = brandOf(r.name, r.cat); const di = dueInfo(r); return `<div class="row"><button class="tx-check ${di.cls}" data-toggle="expense" data-index="${idx}" aria-label="Marquer payé"></button><div class="brandmark ${br.cls}">${br.mark}</div><div class="row-main clickable" data-edit-tx="expense" data-index="${idx}"><b>${esc(r.name)}</b><small>${di.label}${r.dueDate ? ' · ' + dateLabel(r.dueDate) : ''}</small></div><b class="amt">-${eur(r.amount)}</b></div>`; }).join('')}</section>`;
    openSheet('À payer ce mois', body);
  }

  function renderHome() {
    setTitle('Budget Orion');
    const t = totals(), mo = monthObj();
    const solde = t.current, engage = t.tex, aPayer = t.future, projection = t.final;
    const paidPct = t.tex > 0 ? Math.max(0, Math.min(100, Math.round((t.pex / t.tex) * 100))) : 0;
    const bubbleLeft = Math.max(8, Math.min(92, paidPct));
    const last = lastDayOfMonth(year, month);
    const jours = daysLeftInSelectedMonth();
    const events = homeTimelineEvents();
    const ins = homeInsights();

    const sv = homeSavingsInfo();
    const goal = goals[0];
    const gp = goal && num(goal.target) ? Math.min(100, Math.round((num(goal.current) / num(goal.target)) * 100)) : 0;
    const strat = strategyCalc();
    const bMonths = strat.basculeMonths;

    const prevKey = monthKeyAdd(key(), -1);
    const prevMo = budget.monthlyData[prevKey];
    const prevT = prevMo ? totals(prevMo) : null;
    const prevName = ML[(month + 11) % 12];
    const dRev = prevT ? (t.pin - prevT.pin) : null;
    const dExp = prevT ? (t.tex - prevT.tex) : null;
    const dFut = prevT ? (t.future - prevT.future) : null;
    const dFin = prevT ? (t.final - prevT.final) : null;

    const glanceHidden = localStorage.getItem('orion_ui_glanceHidden') === '1';
    const gv = v => glanceHidden ? '••••' : eur(v);
    const delta = (d, goodWhenUp) => d == null ? '' : `<div class="gvs ${(d >= 0) === goodWhenUp ? 'up-good' : 'up-bad'}">${d >= 0 ? '+' : '−'}${eur(Math.abs(d))} vs ${prevName}</div>`;

    const timelineRows = events.length ? events.map(ev => {
      const color = homeEventColor(ev.days, ev.kind === 'birthday');
      const when = homeWhenLabel(ev.days, ev.kind === 'birthday');
      const br = ev.kind === 'birthday' ? { mark: '🎂', cls: 'brand-generic' } : brandOf(ev.name, ev.cat);
      const sub = ev.kind === 'birthday' ? `${dateLabel(ev.date)} · Budget prévu : ${eur(ev.amount)}` : `${dateLabel(ev.date)} · ${CATS[ev.cat] || 'Autres'}`;
      const attr = ev.kind === 'birthday' ? `data-edit-birthday="${ev.i}"` : `data-edit-tx="expense" data-index="${ev.idx}"`;
      const amt = ev.kind === 'birthday' ? `<span class="tl-amt when-pink">${eur(ev.amount)}</span>` : `<span class="tl-amt">-${eur(ev.amount)}</span>`;
      return `<div class="tl-row clickable" ${attr}>
        <div class="home-tl-dotcol"><span class="home-tl-dot dot-${color}"></span></div>
        <div class="brandmark tl-logo ${br.cls}">${br.mark}</div>
        <div class="tl-main"><div class="tl-when when-${color}">${when}</div><b>${esc(ev.name)}</b><small>${sub}</small></div>
        ${amt}<span class="tl-chev">›</span>
      </div>`;
    }).join('') : '<div class="empty">✓ Tout est à jour pour ce mois — aucun événement à venir.</div>';

    const savingsCard = sv.validated
      ? `<button class="home-smart clickable-card" data-go="savings"><span class="badge">🐷</span><div class="st">Épargne ce mois</div><div class="sb">${eur(sv.realized)}</div><div class="ss">${sv.pctEng != null ? sv.pctEng + '% de ton engagement' : sv.pctRev + '% de tes revenus'}</div>${homeSparkline(sv.hist)}</button>`
      : `<button class="home-smart sv-topay clickable-card" data-edit-month-saving><span class="badge">🐷</span><div class="st">Épargne ce mois</div><div class="sb" style="font-size:15px;color:#f0932b">À valider</div><div class="ss">${sv.engagement > 0 ? 'Engagement : ' + eur(sv.engagement) : 'Confirme ton versement'}</div></button>`;

    $('#view').innerHTML = `<div class="stack">
      <section class="home-main">
        <div class="home-cols">
          <button class="home-col" data-home-explain="solde"><div class="lbl">Solde disponible <span class="home-i">i</span></div><div class="val">${eur(solde)}</div><div class="sub">Argent réellement dispo sur ton compte</div></button>
          <button class="home-col center" data-home-explain="engage"><div class="lbl">Déjà engagé <span class="home-i">i</span></div><div class="val">${eur(engage)}</div><div class="sub">Prélèvements à venir et engagements</div></button>
          <button class="home-col" data-home-explain="projection"><div class="lbl">Projection <span class="home-i">i</span></div><div class="val">${eur(projection)}</div><div class="sub">Estimation si rien ne change d’ici là</div></button>
        </div>
        <div class="home-barwrap">
          <div class="home-bubble" style="left:${bubbleLeft}%">${paidPct}%</div>
          <div class="home-bar"><span class="paid" style="width:${paidPct}%"></span><span class="rest" style="width:${100 - paidPct}%"></span></div>
        </div>
        <div class="home-barrow"><span class="d1">Revenus reçus ${eur(t.pin)}</span><span class="d2">Dépenses prévues ${eur(t.tex)}</span></div>
        <div class="home-split">
          <button data-home-topay><div class="ic">▤</div><div><div class="s-lbl">À payer avant le ${last} ${ML[month].toLowerCase()}</div><div class="s-val">${eur(aPayer)}</div></div><div class="chev">›</div></button>
          <div class="sep"></div>
          <button data-edit-period><div class="ic">▦</div><div><div class="s-lbl">Jours restants dans le mois</div><div class="s-val">${jours} jour${jours > 1 ? 's' : ''}</div></div><div class="chev">›</div></button>
        </div>
      </section>

      <section class="home-quick">
        <button data-go="goals"><span class="qi">◎</span>Objectifs</button>
        <button data-go="strategy"><span class="qi">↗</span>Ma stratégie</button>
        <button data-go="savings"><span class="qi">🐷</span>Épargne</button>
        <button data-go="planning"><span class="qi">▦</span>Planification</button>
        <button data-add-tx><span class="qi">＋</span>Ajouter dépense</button>
        <button data-go="plus"><span class="qi">•••</span>Plus</button>
      </section>

      ${ins.length ? `<section class="card home-ins"><div class="sec-head"><h2>Ce que Budget Orion remarque</h2></div>${ins.map(i => `<div class="insight-row lvl-${i.level} clickable" ${i.attr}><span class="insight-ic">${i.icon}</span><span>${i.text}</span><span class="tl-chev">›</span></div>`).join('')}</section>` : ''}

      <section class="card">
        <div class="sec-head"><h2>À venir</h2><button class="link" data-go="planning">Voir tout ›</button></div>
        <div class="home-tl">${timelineRows}</div>
        <button class="link home-tl-all" data-go="planning">Voir tous les événements à venir ›</button>
      </section>

      <div class="home-smart3">
        ${savingsCard}
        ${goal ? `<button class="home-smart gl clickable-card" data-edit-goal="${goal.id}">
          <span class="badge">🎯</span><div class="st" style="color:#2f6bd6">Objectif principal</div><div class="sb">${gp}%</div>
          <div class="ss">${eur(goal.current)} / ${eur(goal.target)}</div><div class="mini" style="background:#dbe6f7"><span style="width:${gp}%;background:#3f7fe0"></span></div>
        </button>` : `<button class="home-smart gl clickable-card" data-add-goal>
          <span class="badge">🎯</span><div class="st" style="color:#2f6bd6">Objectif principal</div><div class="sb" style="font-size:14px">＋ Définir</div><div class="ss">Crée ton premier objectif</div>
        </button>`}
        <button class="home-smart bs clickable-card" data-go="strategy">
          <span class="badge">📈</span><div class="st">Point de bascule</div><div class="sb">${bMonths != null ? monthsToText(bMonths) : '—'}</div>
          <div class="ss">${bMonths != null ? monthsToDate(bMonths) : 'À paramétrer'}</div>
          ${strat.engine && strat.engine.finalCapital ? `<div class="ss" style="margin-top:5px">Capital théorique</div><div class="ss" style="color:#12a45f;font-weight:800">${eur(strat.engine.finalCapital)}</div>` : ''}
        </button>
      </div>

      <section class="card">
        <div class="sec-head"><h2>Ce mois en un coup d’œil</h2><button class="home-eye" data-home-glance>${glanceHidden ? '👁 Afficher' : '🙈 Masquer'}</button></div>
        <div class="home-glance">
          <button class="home-gl" data-home-explain="revenus"><div class="gi gi-down">↓</div><div class="gv">${gv(t.pin)}</div><div class="gl-lbl">Revenus reçus</div>${glanceHidden ? '' : delta(dRev, true)}</button>
          <button class="home-gl" data-go="transactions"><div class="gi gi-up">↑</div><div class="gv">${gv(t.tex)}</div><div class="gl-lbl">Dépenses prévues</div>${glanceHidden ? '' : delta(dExp, false)}</button>
          <button class="home-gl" data-home-topay><div class="gi gi-cal">▦</div><div class="gv">${gv(t.future)}</div><div class="gl-lbl">Reste à payer</div>${glanceHidden ? '' : delta(dFut, false)}</button>
          <button class="home-gl" data-home-explain="projection"><div class="gi gi-wallet">▤</div><div class="gv">${gv(t.final)}</div><div class="gl-lbl">Projection</div>${glanceHidden ? '' : delta(dFin, true)}</button>
        </div>
      </section>
    </div>`;
  }

  /* ---- Dépenses : helpers dédiés (ne modifient pas rowTx, partagé ailleurs) ---- */
  function expDueRank(r) { const d = daysUntilDate(r.dueDate); if (d == null) return 1e6; return d; }
  function expColor(r) {
    if (r.paid) return 'green';
    const d = daysUntilDate(r.dueDate);
    if (d == null) return 'green';
    if (d <= 0) return 'red';
    if (d <= 5) return 'orange';
    return 'green';
  }
  function instProgress(r) {
    const tpl = templateOf(r);
    if (!tpl || num(tpl.installments) <= 0) return null;
    const oi = occurrenceIndex(tpl, (r.dueDate || key()).slice(0, 7));
    const n = (oi != null ? oi : 0) + 1, tot = num(tpl.installments);
    return { n, tot };
  }
  function matchQuery(r, q) {
    if (!q) return true;
    const tpl = templateOf(r);
    const hay = [r.name, CATS[r.cat], brandOf(r.name, r.cat).label, r.note, String(num(r.amount)), eur(r.amount), freqLabel(tpl)].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }
  function passQuick(r) {
    if (txQuick === 'late') { const d = daysUntilDate(r.dueDate); return d != null && d < 0; }
    if (txQuick === 'installments') { const t = templateOf(r); return !!(t && num(t.installments) > 0); }
    if (txQuick === 'recurring') { return !!(r.templateId && !(templateOf(r) && num(templateOf(r).installments) > 0)); }
    return true;
  }
  function expDueRow(r, idx) {
    const id = identityOf(r), info = dueInfo(r), color = expColor(r), tpl = templateOf(r);
    const ip = instProgress(r);
    const instLine = ip ? `<div class="exp-ins"><span class="ins-badge">Échéance ${ip.n} sur ${ip.tot}</span><span class="ins-dots">${Array.from({ length: ip.tot }, (_, i) => `<i class="ins-dot ${i < ip.n ? 'on' : ''}"></i>`).join('')}</span></div>` : '';
    const dotColor = ip ? 'blue' : color;
    return `<div class="exp-row" data-swipe="${idx}">
      <button class="exp-dotcol" data-toggle="expense" data-index="${idx}" aria-label="Marquer payé"><span class="exp-ring dot-${dotColor}"></span></button>
      <button class="brandmark exp-logo ${id.cls}" data-edit-emoji="expense" data-index="${idx}" aria-label="Changer l’icône">${id.mark}</button>
      <div class="exp-main clickable" data-edit-tx="expense" data-index="${idx}">
        <b>${esc(r.name || 'Sans libellé')}</b>
        <small>${CATS[r.cat] || 'Autres'} · ${freqLabel(tpl)}</small>
        <div class="exp-tags"><span class="exp-badge b-${dotColor}">${info.label}</span><span class="exp-date">${r.dueDate ? dateLabel(r.dueDate) : 'Sans date'}</span>${r.reportedFrom ? '<span class="exp-badge b-orange">Reportée</span>' : ''}</div>
        ${instLine}
      </div>
      <div class="exp-right clickable" data-edit-tx="expense" data-index="${idx}">
        <b class="exp-amt">-${eur(r.amount)}</b><small class="when-${dotColor}">${info.label}</small>
      </div>
      <span class="exp-chev">›</span>
    </div>`;
  }
  function expPaidRow(r, idx) {
    const id = identityOf(r), tpl = templateOf(r);
    return `<div class="exp-row paid" data-swipe="${idx}">
      <button class="brandmark exp-logo ${id.cls}" data-edit-emoji="expense" data-index="${idx}" aria-label="Changer l’icône">${id.mark}</button>
      <div class="exp-main clickable" data-edit-tx="expense" data-index="${idx}">
        <b>${esc(r.name || 'Sans libellé')}</b>
        <small>${CATS[r.cat] || 'Autres'} · ${freqLabel(tpl)}</small>
        <small class="exp-date">${r.paidDate ? 'Payée ' + dateLabel(r.paidDate) : (r.dueDate ? dateLabel(r.dueDate) : '')}</small>
      </div>
      <div class="exp-right"><b class="exp-amt">-${eur(r.amount)}</b><span class="exp-paidlbl">Payée</span></div>
      <button class="exp-done" data-toggle="expense" data-index="${idx}" aria-label="Marquer non payé">✓</button>
    </div>`;
  }
  function renderTransactions() {
    setTitle('Dépenses');
    const m = monthObj();
    const t = totals();
    const all = (m.expenses || []).map((r, i) => ({ r, i }));
    const q = txQuery.trim();
    const due = all.filter(x => !x.r.paid).filter(x => passQuick(x.r) && matchQuery(x.r, q)).sort((a, b) => expDueRank(a.r) - expDueRank(b.r));
    const paid = all.filter(x => x.r.paid).filter(x => matchQuery(x.r, q)).sort((a, b) => (b.r.paidDate || b.r.dueDate || '').localeCompare(a.r.paidDate || a.r.dueDate || ''));
    const dueCount = all.filter(x => !x.r.paid).length;
    const paidCount = all.filter(x => x.r.paid).length;
    const lateCount = all.filter(x => { const d = daysUntilDate(x.r.dueDate); return !x.r.paid && d != null && d < 0; }).length;
    const instCount = all.filter(x => { const tp = templateOf(x.r); return tp && num(tp.installments) > 0; }).length;
    const recCount = all.filter(x => x.r.templateId && !(templateOf(x.r) && num(templateOf(x.r).installments) > 0)).length;
    const paidPct = t.tex > 0 ? Math.round((t.pex / t.tex) * 100) : 0;

    const chip = (id, label, count) => `<button class="exp-chip ${txQuick === id ? 'active' : ''}" data-tx-quick="${id}">${label}${count != null ? `<span class="c">${count}</span>` : ''}</button>`;

    const dueList = due.length ? due.map(x => expDueRow(x.r, x.i)).join('') : '<div class="empty">✓ Rien à payer pour ce filtre.</div>';
    const paidPreview = txPaidOpen ? paid : paid.slice(0, 3);
    const paidList = paid.length ? paidPreview.map(x => expPaidRow(x.r, x.i)).join('') : '<div class="empty">Aucune dépense payée.</div>';

    const listBlock = txView === 'due'
      ? `<section class="card">
           <div class="exp-lhead"><h2>À venir</h2><span class="exp-sort">↕ Trier par date</span></div>
           ${dueList}
         </section>
         <section class="card">
           <button class="exp-paidhead" data-tx-paidtoggle><span class="l"><span class="ic">✓</span>Payées récemment${paidCount ? ` (${paidCount})` : ''}</span><span class="exp-caret ${txPaidOpen ? 'open' : ''}">˅</span></button>
           ${txPaidOpen || paidCount <= 3 ? paidList : paid.slice(0, 3).map(x => expPaidRow(x.r, x.i)).join('')}
           ${paidCount > 3 && !txPaidOpen ? '<button class="link exp-voir" data-tx-paidtoggle>Tout voir ›</button>' : ''}
         </section>`
      : `<section class="card">
           <div class="exp-lhead"><h2>Payées récemment</h2></div>
           ${paid.length ? paid.map(x => expPaidRow(x.r, x.i)).join('') : '<div class="empty">Aucune dépense payée ce mois-ci.</div>'}
         </section>`;

    $('#view').innerHTML = `<div class="stack exp-page">
      <div class="exp-toolbar">
        <div class="exp-search"><span class="si">⌕</span><input id="txSearch" type="search" placeholder="Rechercher (nom, marque, montant…)" value="${esc(txQuery)}" autocomplete="off"></div>
        <button class="exp-add" data-add-tx><span>＋</span><b>Ajouter</b></button>
      </div>

      <section class="card">
        <div class="exp-sum">
          <div class="m" data-tx-view="all"><small>Dépenses prévues</small><b>${eur(t.tex)}</b><span class="u">Sur le mois</span></div>
          <div class="m pos" data-tx-view="paid"><small>Déjà payées</small><b>${eur(t.pex)}</b><span class="u">Ce mois</span></div>
          <div class="m warn" data-tx-view="due"><small>À payer</small><b>${eur(t.future)}</b><span class="u">Reste à payer</span></div>
          <div class="m proj" data-home-explain="projection"><small>Prévision fin de mois</small><b>${eur(t.final)}</b><span class="u">si rien ne change</span></div>
        </div>
        <div class="exp-progress"><span style="width:${Math.max(0, Math.min(100, paidPct))}%"></span></div>
        <div class="exp-progress-lbl">${paidPct}% réglé</div>
      </section>

      <div class="exp-tabs">
        <button class="exp-tab ${txView === 'due' ? 'active' : ''}" data-tx-view="due"><span class="tt">🕓 À payer (${dueCount})</span><span class="ts">Du plus proche au plus loin</span></button>
        <button class="exp-tab ${txView === 'paid' ? 'active' : ''}" data-tx-view="paid"><span class="tt">✓ Payées (${paidCount})</span><span class="ts">Classées par date (récent)</span></button>
      </div>

      <div class="exp-chips">
        ${chip('all', 'Toutes')}
        ${chip('late', 'Retard', lateCount)}
        ${chip('installments', 'Échéanciers', instCount)}
        ${chip('recurring', 'Récurrentes', recCount)}
      </div>

      ${listBlock}
    </div>`;

    if (txQuery) { const si = $('#txSearch'); if (si) { si.focus(); try { si.setSelectionRange(si.value.length, si.value.length); } catch (_) {} } }
  }

  function setExpenseEmoji(type, idx, emoji) {
    const list = monthObj()[type === 'income' ? 'income' : 'expenses'];
    const r = list[+idx]; if (!r) return;
    const tpl = templateOf(r);
    if (emoji) { r.customEmoji = emoji; if (tpl) tpl.customEmoji = emoji; }
    else { delete r.customEmoji; if (tpl) delete tpl.customEmoji; }
    saveBudget(); render();
    toast(emoji ? 'Icône mise à jour' : 'Icône automatique rétablie');
  }
  function identityPicker(type, idx) {
    const list = monthObj()[type === 'income' ? 'income' : 'expenses'];
    const r = list[+idx]; if (!r) return;
    const tpl = templateOf(r);
    const cur = (r.customEmoji || (tpl && tpl.customEmoji) || '');
    const br = brandOf(r.name, r.cat);
    const preview = identityOf(r);
    const EMO = ['🍽️','🛒','🏠','⚡','💧','📱','🌐','🚗','🚆','❤️','🩺','🏦','🎒','🧸','🛡️','🎮','✈️','🎁','☕','💇','🥋','🍿','🐶','💊','🧾','✨'];
    openSheet('Identité visuelle', `
      <div class="idp-cur"><div class="brandmark ${preview.cls}" style="width:54px;height:54px;font-size:24px;border-radius:15px">${preview.mark}</div>
        <div><b>${esc(r.name || 'Sans libellé')}</b><small>${br.matched ? 'Logo reconnu : ' + esc(br.label) : 'Catégorie : ' + (CATS[r.cat] || 'Autres')}</small></div></div>
      ${cur ? `<button class="ghost" type="button" data-emoji-set="__auto__" data-etype="${type}" data-eidx="${idx}">↺ Revenir à l’automatique</button>` : ''}
      <div class="group-title">Choisir un emoji</div>
      <div class="idp-grid">${EMO.map(e => `<button type="button" class="idp-emo ${e === cur ? 'sel' : ''}" data-emoji-set="${e}" data-etype="${type}" data-eidx="${idx}">${e}</button>`).join('')}</div>
      <form class="form" id="emojiFreeForm"><input type="hidden" name="etype" value="${type}"><input type="hidden" name="eidx" value="${idx}"><label>Saisir un emoji personnalisé<input name="emoji" maxlength="4" value="${esc(cur)}" placeholder="Ex : 🍝"></label><button class="action">Enregistrer</button></form>
    `);
  }
  function reportSheet(idx) {
    const r = monthObj().expenses[+idx]; if (!r) return;
    const base = r.dueDate ? new Date(r.dueDate + 'T12:00:00') : new Date();
    const plus = n => { const d = new Date(base); d.setDate(d.getDate() + n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
    const nextMonth1 = () => { const d = new Date(base); d.setMonth(d.getMonth() + 1, 1); return iso(d.getFullYear(), d.getMonth(), 1); };
    openSheet('Reporter la dépense', `
      <div class="insight">« ${esc(r.name)} » — actuellement le ${r.dueDate ? dateLabelLong(r.dueDate) : '—'}.</div>
      <div class="exp-quickopts">
        <button type="button" data-report="${idx}" data-date="${plus(7)}">Dans 7 jours · ${dateLabel(plus(7))}</button>
        <button type="button" data-report="${idx}" data-date="${plus(14)}">Dans 14 jours · ${dateLabel(plus(14))}</button>
        <button type="button" data-report="${idx}" data-date="${nextMonth1()}">Début du mois prochain · ${dateLabel(nextMonth1())}</button>
      </div>
      <form class="form" id="reportForm"><input type="hidden" name="idx" value="${idx}"><label>Ou choisir une date<input type="date" name="date" value="${r.dueDate || today()}"></label><button class="action">Reporter</button></form>
    `);
  }
  function reportExpenseTo(idx, newDate) {
    const cur = monthObj(); const r = cur.expenses[+idx]; if (!r || !newDate) return;
    const old = r.dueDate; r.reportedFrom = r.reportedFrom || old || '';
    const newKey = newDate.slice(0, 7);
    if (newKey !== key()) {
      r.dueDate = newDate;
      cur.expenses.splice(+idx, 1);
      const tgt = budget.monthlyData[newKey] || (budget.monthlyData[newKey] = { income: [], expenses: [], savings: { amount: 0, paid: false, date: '' }, meta: {} });
      tgt.expenses.push(r);
      saveBudget(); closeSheet(); render();
      toast('Reportée au ' + dateLabel(newDate)); // déplacement inter-mois : pas d'annulation simple
    } else {
      r.dueDate = newDate;
      saveBudget(); closeSheet(); render();
      toast('Reportée au ' + dateLabel(newDate), () => { const rr = monthObj().expenses[+idx]; if (rr) { rr.dueDate = old; if (rr.reportedFrom === (old || '')) delete rr.reportedFrom; saveBudget(); render(); } });
    }
  }
  function duplicateExpense(idx) {
    const r = monthObj().expenses[+idx]; if (!r) return;
    const copy = { name: r.name, amount: num(r.amount), cat: r.cat || 'autres', paid: false, paidDate: '', dueDate: r.dueDate || today() };
    if (r.customEmoji) copy.customEmoji = r.customEmoji;
    monthObj().expenses.push(copy);
    saveBudget(); closeSheet(); render();
    toast('Dépense dupliquée');
  }

  function eventsForDay(y, m2, d) {    const ds = iso(y, m2, d), a = [];
    const mo = `${y}-${p2(m2 + 1)}` === key() ? monthObj() : projectMonth(`${y}-${p2(m2 + 1)}`);
    (mo.income || []).forEach(r => { if (r.dueDate === ds || (!r.dueDate && d === 1)) a.push('green'); });
    (mo.expenses || []).forEach(r => { if (r.dueDate === ds) { const tp = r.templateId && (budget.recurringTemplates || []).find(x => x.id === r.templateId); a.push(tp && num(tp.installments) > 0 ? 'orange' : 'red'); } });
    extra.birthdays.forEach(b => { const n = birthdayNext(b); if (n && n.date === ds) a.push('pink'); });
    return [...new Set(a)].slice(0, 3);
  }

  function renderPlanning() {
    setTitle('Planification');
    const first = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = lastDayOfMonth(year, month);
    const todayD = new Date();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const ev = eventsForDay(year, month, d);
      const is = todayD.getFullYear() === year && todayD.getMonth() === month && todayD.getDate() === d;
      cells += `<div class="day clickable ${is ? 'today' : ''}" data-day="${d}"><b>${d}</b><div class="dots">${ev.map(c => `<i class="dot d-${c}"></i>`).join('')}</div></div>`;
    }
    const rangeItems = projectRange(planningRange);
    const rangeTotal = rangeItems.reduce((s, r) => s + num(r.amount), 0);
    const heavy = heavyMonthsAhead();
    const nextAnnual = annualItems()[0];

    $('#view').innerHTML = `<div class="stack">
      <div class="tabs range-tabs">${[[30,'30 jours'],[90,'90 jours'],[182,'6 mois'],[365,'12 mois']].map(([d,l]) => `<button data-range="${d}" class="${planningRange===d?'active':''}">${l}</button>`).join('')}</div>

      <section class="card"><div class="sec-head"><h2>Dans les ${planningRange} prochains jours</h2></div>
        <div class="metric-grid"><div class="metric"><small>Total prévu</small><b>${eur(rangeTotal)}</b></div><div class="metric"><small>Nombre d’événements</small><b>${rangeItems.length}</b></div></div>
      </section>

      ${heavy.length ? `<section class="card"><div class="sec-head"><h2>Périodes chargées</h2></div>${heavy.map(h => `<div class="row"><div class="row-main"><b>${h.label} sera un mois chargé</b><small>Dépenses prévues : ${eur(h.planned)} · moyenne habituelle ${eur(h.avg)} (+${h.pct}%)</small></div></div>`).join('')}</section>` : ''}

      ${nextAnnual ? `<section class="card"><div class="insight">Pour absorber les dépenses annuelles prévues → prévoir <b>${eur(annualItems().reduce((s,a)=>s+a.monthly,0))}/mois</b>.</section>` : ''}

      <section class="card calendar">
        <div class="cal-head"><button data-shift="-1">‹</button><b>${ML[month]} ${year}</b><button data-shift="1">›</button></div>
        <div class="week">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="grid">${cells}</div>
        <div class="legend"><span><i class="d-green"></i>Revenus</span><span><i class="d-red"></i>Dépenses fixes</span><span><i class="d-orange"></i>Échéances</span><span><i class="d-pink"></i>Anniversaires</span></div>
      </section>

      <div><div class="sec-head"><h2>Prochains événements</h2></div>
      <section class="card list">${rangeItems.slice(0, 8).map(r => r.isBirthday ? `<div class="row clickable" data-go="birthdays"><div class="ico">🎂</div><div class="row-main"><b>${esc(r.name)} — Anniversaire</b><small>${dateLabel(r.dueDate)}</small></div><b>${eur(r.amount)}</b></div>` : rowTx(r, 'expense', (budget.monthlyData[r.dueDate.slice(0,7)]?.expenses || []).indexOf(r))).join('') || '<div class="empty">Aucun événement à venir.</div>'}</section></div>
    </div>`;
  }

  function renderAnalysis() {
    setTitle('Analyse');
    const t = totals();
    const mcur = monthObj();
    const ct = catTotals(mcur, true);
    const keys = Object.keys(ct).sort((a, b) => ct[b] - ct[a]);
    const total = t.pex || 1;
    let acc = 0; const conic = [];
    keys.forEach(k => { const p = (ct[k] / total) * 100; conic.push(`${COLORS[k] || '#999'} ${acc}% ${acc + p}%`); acc += p; });

    const annual = annualItems(); const annualTotal = annual.reduce((s, x) => s + x.annual, 0);
    const inst = installmentItems(); const instRemain = inst.reduce((s, x) => s + x.remainingAmount, 0);
    const prevKey = month === 0 ? `${year - 1}-12` : `${year}-${p2(month)}`;
    const prev = budget.monthlyData[prevKey] ? totals(budget.monthlyData[prevKey]) : { pex: 0, tex: 0, sav: 0 };
    const prevCat = budget.monthlyData[prevKey] ? catTotals(budget.monthlyData[prevKey], true) : {};
    const diff = prev.pex ? Math.round(((t.pex - prev.pex) / prev.pex) * 100) : 0;

    // Ce qui a changé ce mois-ci (par catégorie)
    const catDeltas = Object.keys(CATS).map(c => ({ c, delta: num(ct[c]) - num(prevCat[c]) })).filter(x => Math.abs(x.delta) >= 10).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);
    const savDelta = t.sav - prev.sav;
    const finishedInstallments = installmentItems(prevKey).filter(i => i.remainingCount === 0).filter(i => !installmentItems().some(j => j.id === i.id && j.remainingCount === 0 && j.currentIndex === i.currentIndex));

    const monthlyPaid = [], monthlyPlanned = [];
    for (let i = 0; i < 12; i++) { const mm = budget.monthlyData[`${year}-${p2(i + 1)}`]; const tt = mm ? totals(mm) : { pex: 0, tex: 0 }; monthlyPaid.push(tt.pex); monthlyPlanned.push(tt.tex); }
    const mx = Math.max(1, ...monthlyPaid, ...monthlyPlanned);
    const saveRate = t.pin ? Math.round((t.sav / t.pin) * 100) : 0;
    const fixed = (mcur.expenses || []).filter(r => r.recurring || r.templateId).reduce((s, r) => s + num(r.amount), 0);
    const fixedRate = t.pin ? Math.round((fixed / t.pin) * 100) : 0;
    const paidRate = t.tex ? Math.round((t.pex / t.tex) * 100) : 0;
    const avgPaid = monthlyPaid.filter(v => v > 0);
    const avg3 = avgPaid.slice(-3).length ? avgPaid.slice(-3).reduce((a, b) => a + b, 0) / avgPaid.slice(-3).length : 0;
    const avg6 = avgPaid.slice(-6).length ? avgPaid.slice(-6).reduce((a, b) => a + b, 0) / avgPaid.slice(-6).length : 0;
    const biggest = keys[0];

    $('#view').innerHTML = `<div class="stack">
      <div class="metric-grid">
        <div class="metric"><small>Solde actuel réel</small><b class="${t.current >= 0 ? 'pos' : 'neg'}">${eur(t.current)}</b></div>
        <div class="metric"><small>Fin de mois estimée</small><b class="${t.final >= 0 ? 'pos' : 'neg'}">${eur(t.final)}</b></div>
        <div class="metric"><small>Déjà prélevé</small><b>${eur(t.pex)} · ${paidRate}%</b></div>
        <div class="metric"><small>Reste à payer</small><b style="color:var(--orange)">${eur(t.future)}</b></div>
      </div>

      <section class="card"><div class="sec-head"><h2>Répartition réellement prélevée</h2></div>
        <div class="donut-wrap">
          <div class="donut clickable" data-donut style="background:conic-gradient(${conic.join(',') || '#e9efeb 0 100%'})"><div class="donut-center"><div><b>${eur(t.pex)}</b><br>Payé</div></div></div>
          <div class="legend-list">${keys.slice(0, 6).map(k => `<div class="leg clickable" data-cat-detail="${k}"><i style="background:${COLORS[k]}"></i><span>${CATS[k] || k}</span><b>${Math.round((ct[k] / total) * 100)}%</b></div>`).join('')}</div>
        </div>
      </section>

      <section class="card"><div class="sec-head"><h2>Ce qui a changé ce mois-ci</h2></div>
        ${catDeltas.length || savDelta ? `${catDeltas.map(d => `<div class="row"><div class="row-main"><b>${CATS[d.c]}</b></div><b class="${d.delta > 0 ? 'neg' : 'pos'}">${d.delta > 0 ? '+' : ''}${eur(d.delta)}</b></div>`).join('')}
        ${savDelta ? `<div class="row"><div class="row-main"><b>Épargne</b></div><b class="${savDelta >= 0 ? 'pos' : 'neg'}">${savDelta >= 0 ? '+' : ''}${eur(savDelta)}</b></div>` : ''}
        ${finishedInstallments.map(i => `<div class="row"><div class="row-main"><b>Fin de paiement : ${esc(i.name)}</b></div><b class="pos">+${eur(i.amount)}/mois libérés</b></div>`).join('')}` : '<div class="empty">Rien de notable par rapport au mois précédent.</div>'}
      </section>

      <section class="card"><div class="sec-head"><h2>Historique réel des prélèvements</h2><b class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? '+' : ''}${diff}%</b></div>
        <div class="chart">${monthlyPaid.map((v, i) => `<div class="bar ${i === month ? 'active' : ''}" style="height:${Math.max(3, (v / mx) * 100)}%" title="${ML[i]} payé ${eur(v)} / prévu ${eur(monthlyPlanned[i])}"></div>`).join('')}</div>
        <small style="color:var(--mut)">Moyenne 3 mois : ${eur(avg3)} · Moyenne 6 mois : ${eur(avg6)}</small>
      </section>

      <div class="metric-grid">
        <div class="metric"><small>Taux d’épargne</small><b class="pos">${saveRate}%</b></div>
        <div class="metric"><small>Charges fixes / revenus reçus</small><b>${fixedRate}%</b></div>
        <div class="metric annual-box clickable" data-go="annual"><small>Coût annuel récurrent</small><b class="blue">${eur(annualTotal)}</b></div>
        <div class="metric install-box clickable" data-go="installments"><small>Échéanciers restants</small><b style="color:var(--orange)">${eur(instRemain)}</b></div>
      </div>

      <section class="card"><div class="sec-head"><h2>Top 5 réellement payées</h2></div>
        ${(mcur.expenses || []).filter(r => r.paid).slice().sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 5).map(r => `<div class="row clickable" data-edit-tx="expense" data-index="${mcur.expenses.indexOf(r)}"><div class="row-main"><b>${esc(r.name)}</b><small>${CATS[r.cat] || 'Autres'}</small></div><b>${eur(r.amount)}</b></div>`).join('') || '<div class="empty">Aucune dépense cochée comme payée ce mois-ci.</div>'}
      </section>

      <div class="insight"><b>Analyse intelligente</b><br>${t.future > t.current ? 'Tes prélèvements restants dépassent ton solde actuel : surveille la fin du mois.' : (biggest ? `Ton poste réellement le plus dépensé est ${CATS[biggest] || biggest} (${eur(ct[biggest])}).` : 'Coche les prélèvements lorsqu’ils passent pour obtenir une analyse réelle de ton mois.')}</div>
    </div>`;
  }

  function renderSavings() {
    setTitle('Épargne');
    const t = totals();
    const rate = t.pin ? Math.round((t.sav / t.pin) * 100) : 0;
    const cov = coverageMonths();
    const covPct = Math.min(100, (cov / Math.max(1, extra.coverageTargetMonths)) * 100);
    const pTotal = pocketsTotal();

    $('#view').innerHTML = `<div class="stack">
      <section class="card savings-hero clickable" data-edit-month-saving>
        <div><small>Épargne enregistrée pour ${ML[month].toLowerCase()}</small><h2 class="pos" style="margin:6px 0">${eur(t.sav)}</h2><small>${rate}% des revenus reçus · <b class="pos">Modifier ›</b></small></div>
        <div class="pig">🐷</div>
      </section>

      <section class="card"><div class="sec-head"><h2>Couverture financière</h2><button class="link" data-edit-coverage-target>Objectif : ${extra.coverageTargetMonths} mois</button></div>
        <div class="strategy-number" style="font-size:22px">${cov.toFixed(1).replace('.', ',')} mois couverts</div>
        <div class="strategy-track" style="margin-top:8px"><span style="width:${covPct}%"></span></div>
        <small class="subtle">Épargne de sécurité (${eur(securityPocket()?.balance)}) ÷ dépenses essentielles mensuelles (${eur(essentialMonthlyExpenses())}).</small>
      </section>

      <div><div class="sec-head"><h2>Poches d’épargne</h2><button class="link" data-add-pocket>＋ Nouvelle poche</button></div>
      <section class="card">${extra.pockets.map(p => { const pct = pTotal ? Math.round((num(p.balance) / pTotal) * 100) : 0; return `<div class="goal clickable" data-edit-pocket="${p.id}"><div class="goal-top"><b>${esc(p.emoji || '💶')} ${esc(p.name)}${p.security ? ' <span class="freq-badge">Sécurité</span>' : ''}</b><b>${eur(p.balance)}</b></div><small>${pct}% de l’épargne disponible ${p.monthlyTarget ? '· ' + eur(p.monthlyTarget) + '/mois' : ''} · Toucher pour gérer</small><div class="progress"><span style="width:${pct}%"></span></div></div>`; }).join('')}</section></div>

      <section class="detail-total mint"><small>Épargne disponible (toutes poches)</small><h2 style="margin:4px 0">${eur(pTotal)}</h2><button class="link" data-open-transfer>⇄ Transférer entre poches</button></section>

      <section class="card"><div class="sec-head"><h2>Et si j’épargnais plus ?</h2></div>
        <div class="two"><label>Effort supplémentaire<input type="number" id="whatifSavingsInput" min="0" step="10" value="50"></label><div></div></div>
        <div id="whatifSavingsResult" class="insight" style="margin-top:8px">${whatIfSavingsText(50)}</div>
      </section>
    </div>`;
  }

  function whatIfSavingsText(delta) {
    const w = whatIf(num(delta));
    return `+${eur(delta)}/mois → ${eur(w.annual)}/an, ${eur(w.fiveYears)} sur 5 ans. Investi au taux actuel (${w.rate}%), cela ferait environ <b>${eur(w.investedFiveYears)}</b> dans 5 ans.`;
  }

  function renderGoals() {
    setTitle('Objectifs', false);
    const total = goals.reduce((s, g) => s + num(g.current), 0);
    const target = goals.reduce((s, g) => s + num(g.target), 0);
    $('#view').innerHTML = `<div class="stack">
      <div class="sec-head"><button class="link" data-go="plus">‹ Retour</button><button class="link" data-add-goal>＋ Ajouter</button></div>
      <section class="card">${goals.length ? goals.map(g => {
        const p = num(g.target) ? Math.min(100, Math.round((num(g.current) / num(g.target)) * 100)) : 0;
        const needed = goalMonthlyNeeded(g); const left = goalMonthsLeft(g);
        return `<div class="goal clickable" data-edit-goal="${g.id}">
          <div class="goal-top"><b>${esc(g.e || '🎯')} ${esc(g.n)}</b><b>${p}%</b></div>
          <small>${eur(g.current)} / ${eur(g.target)}${g.targetDate ? ' · cible ' + dateLabelLong(g.targetDate) : ''}</small>
          <div class="progress"><span style="width:${p}%"></span></div>
          ${needed != null ? `<small class="subtle">Il faut ${eur(needed)}/mois pendant ${left} mois pour l’atteindre à temps.</small>` : ''}
        </div>`;
      }).join('') : '<div class="empty">Aucun objectif d’épargne. Appuie sur « + Ajouter » pour créer ton premier objectif.</div>'}</section>
      <section class="detail-total mint"><small>Total affecté aux objectifs</small><h2 style="margin:4px 0">${eur(total)}</h2><small>${target ? Math.round((total / target) * 100) : 0}% des objectifs cumulés</small></section>
    </div>`;
  }

  function renderStrategy() {
    setTitle('Ma stratégie', false);
    const rate = stratPreviewRate != null ? stratPreviewRate : num(extra.strategy?.rate);
    const x = strategyCalc(rate);
    const rates = extra.strategy.scenarioRates || { prudent: 5, central: 7, dynamique: 10 };
    const scenarios = SCENARIOS.map(s => ({ ...s, rate: num(rates[s.key]) || s.rate }));
    const engines = {}; scenarios.forEach(s => { engines[s.key] = financeEngine(x.capital, x.monthly, s.rate, x.horizon); });
    const centralEngine = engines.central || x.engine;

    $('#view').innerHTML = `<div class="stack strategy-grid-layout">
      <div class="sec-head span-3"><button class="link" data-go="plus">‹ Retour</button><button class="mini-action" data-edit-strategy>✎ Modifier mes paramètres</button></div>

      <!-- 1. POINT DE BASCULE -->
      <section class="card gauge-card span-2" data-explain="bascule">
        <div class="sec-head"><h2>Point de bascule</h2></div>
        <div class="gauge-layout">
          ${semiGauge(x.progress, '#20ad6f', eur(x.gain), `Ton rendement annuel (${x.rate.toFixed(2).replace('.', ',')}%)`)}
          <div class="gauge-target"><small>Versement annuel</small><b>${eur(x.annual)} / an</b></div>
        </div>
        <div class="strategy-number" style="margin-top:8px">${monthsToText(x.basculeMonths)}</div>
        <div class="subtle">${x.basculeMonths != null ? 'Estimation : ' + monthsToDate(x.basculeMonths) : ''}</div>
        <div class="insight" style="margin-top:12px">Le point de bascule est atteint quand le rendement annuel de ton capital est supérieur ou égal à tes versements annuels personnels.</div>
        <div class="strategy-kpi" style="margin-top:10px"><small>Capital nécessaire (théorique)</small><b>${x.target ? eur(x.target) : '—'}</b><small class="subtle">Basé sur ${x.rate.toFixed(2).replace('.', ',')}% de rendement</small></div>
      </section>

      <!-- 2. PARAMÈTRES -->
      <section class="card span-1">
        <div class="sec-head"><h2>Vue rapide</h2></div>
        <div class="param-row clickable" data-edit-strategy><span>Capital actuel</span><b>${eur(x.capital)}</b></div>
        <div class="param-row clickable" data-edit-strategy><span>Versement mensuel</span><b>${eur(x.monthly)}</b></div>
        <div class="param-row clickable" data-edit-strategy><span>Versement annuel</span><b>${eur(x.annual)}</b></div>
        <div class="param-row clickable" data-edit-strategy><span>Rendement annuel</span><b>${x.rate.toFixed(2).replace('.', ',')} %</b></div>
        <div class="param-row clickable" data-edit-strategy><span>Horizon de projection</span><b>${x.horizon} ans</b></div>
        <button class="action" style="margin-top:10px" data-edit-strategy>Modifier mes paramètres</button>
      </section>

      <!-- 3. TON ARGENT TRAVAILLE POUR TOI / EXPRESSION DE TON CAPITAL -->
      <section class="card span-3" id="expression-card">
        <div class="sec-head"><h2>Expression de ton capital</h2></div>
        <div class="expr-row">
          <span class="expr-ic">🐷</span>
          <div class="expr-body">
            <b>Ton argent travaille pour toi</b>
            <div class="expr-tiles">
              <div class="expr-tile"><b>${eur(x.gain)}</b><small>par an</small></div>
              <div class="expr-tile"><b>${eur(x.monthlyGain)}</b><small>par mois</small></div>
              <div class="expr-tile"><b>${eur(x.dailyGain)}</b><small>par jour</small></div>
            </div>
          </div>
        </div>
        <div class="expr-row clickable" data-explain="bascule">
          <span class="expr-ic">⏱️</span>
          <div class="expr-body"><b>Ton capital travaille à ${Math.round(x.progress)}%</b><small>de ton effort annuel</small></div>
        </div>
        <div class="expr-row clickable" data-explain="liberte">
          <span class="expr-ic">🕊️</span>
          <div class="expr-body"><b>Taux de liberté financière ${x.libertyPct}%</b><small>de tes dépenses annuelles (${eur(x.annualExpenses)}) couvertes</small></div>
        </div>
      </section>

      <!-- 4. ÉVOLUTION DE TON CAPITAL -->
      <section class="card span-2">
        <div class="sec-head"><h2>Évolution de ton capital</h2></div>
        <div class="tabs metric-tabs">
          <button data-metric="capital" class="${stratMetric === 'capital' ? 'active' : ''}">Capital total</button>
          <button data-metric="interets" class="${stratMetric === 'interets' ? 'active' : ''}">Intérêts cumulés</button>
          <button data-metric="versements" class="${stratMetric === 'versements' ? 'active' : ''}">Versements</button>
        </div>
        <div class="strategy-number" style="font-size:22px;margin-top:10px">Capital estimé dans ${x.horizon} ans : ${eur(pointAtYear(centralEngine, x.horizon)[stratMetric])}</div>
        <div class="chart-wrap" data-chart-tooltip>
          ${lineChartSVG('chart-evolution', scenarios.map(s => ({ color: s.color, data: engines[s.key].points.filter((_, i) => i % Math.max(1, Math.round(engines[s.key].points.length / 60)) === 0).map(p => ({ x: p.year, y: p[stratMetric] })) })), { markers: x.basculeMonths != null ? [{ x: x.basculeMonths / 12, y: pointAtYear(centralEngine, x.basculeMonths / 12)[stratMetric], color: '#128957' }] : [] })}
          <div class="chart-tooltip" id="tt-chart-evolution" hidden></div>
        </div>
        <div class="chart-legend">${scenarios.map(s => `<span><i style="background:${s.color}"></i>${s.label} (${s.rate.toFixed(0)}%)</span>`).join('')}</div>
        <div class="metric-grid" style="margin-top:10px">
          <div class="metric"><small>Capital actuel</small><b>${eur(x.capital)}</b></div>
          <div class="metric"><small>Total versé (${x.horizon} ans)</small><b>${eur(x.monthly * 12 * x.horizon)}</b></div>
        </div>
        <small class="subtle" style="display:block;margin-top:6px">👉 Survole ou touche le graphique pour voir le détail année par année.</small>
      </section>

      <!-- 5. POINT D'ACCÉLÉRATION -->
      <section class="card gauge-card span-2" data-explain="accel">
        <div class="sec-head"><h2>Point d’accélération</h2></div>
        <div class="gauge-layout">
          ${semiGauge(x.accelMonths != null ? Math.min(100, (x.gain / (x.annual * 2 || 1)) * 100) : 0, '#2f6fe4', eur(x.gain), `Ton rendement annuel (${x.rate.toFixed(2).replace('.', ',')}%)`)}
          <div class="gauge-target"><small>Double versement annuel</small><b>${eur(x.annual * 2)} / an</b></div>
        </div>
        <div class="strategy-number" style="margin-top:8px">${monthsToText(x.accelMonths)}</div>
        <div class="subtle">${x.accelMonths != null ? 'Estimation : ' + monthsToDate(x.accelMonths) : ''}</div>
        <div class="insight" style="margin-top:12px">Le point d’accélération est atteint quand le rendement annuel de ton capital est au moins deux fois supérieur à tes versements annuels personnels.</div>
        <div class="strategy-kpi" style="margin-top:10px"><small>Capital nécessaire (théorique)</small><b>${x.target2 ? eur(x.target2) : '—'}</b><small class="subtle">Basé sur ${x.rate.toFixed(2).replace('.', ',')}% de rendement</small></div>
      </section>

      <!-- 6. SCÉNARIOS + COMPARAISON -->
      <section class="card span-3">
        <div class="sec-head"><h2>Comparaison des scénarios à ${x.horizon} ans</h2></div>
        <div class="scenario-compare">
          ${scenarios.map(s => { const e = engines[s.key]; const last = e.points[e.points.length - 1]; const pct = last.capital ? Math.round((last.interets / last.capital) * 100) : 0; return `<div class="scenario-donut-card clickable" data-scenario="${s.rate}">
            <small>${s.label}<br><b>${s.rate.toFixed(0)}% / an</b></small>
            <div class="donut scenario-donut" style="background:conic-gradient(${s.color} 0% ${pct}%, #e9efeb ${pct}% 100%)"><div class="donut-center"><b>${eur(last.capital)}</b></div></div>
            <div class="scenario-gain">+${eur(last.interets)}</div>
          </div>`; }).join('')}
        </div>
        <div class="scenario-row" style="margin-top:6px"><span>Versements cumulés (identiques pour les 3 scénarios)</span><b>${eur(x.monthly * 12 * x.horizon)}</b></div>
      </section>

      <!-- 7. ET SI ? -->
      <section class="card span-2">
        <div class="sec-head"><h2>Simulation « Et si ? »</h2></div>
        <div class="subtle">Ajuste ton versement mensuel</div>
        <div class="whatif-slider-row">
          <input type="range" id="stratWhatifSlider" min="100" max="1000" step="10" value="${stratWhatIfDelta}">
          <b id="stratWhatifValue">${eur(stratWhatIfDelta)} / mois</b>
        </div>
        <div id="whatifStratResult">${whatIfStrategyBlock(stratWhatIfDelta, x)}</div>
      </section>

      <!-- 8. PROJECTION DÉTAILLÉE -->
      <section class="card span-2">
        <div class="sec-head"><h2>Projection détaillée</h2></div>
        <div class="tabs proj-tabs">${scenarios.map(s => `<button data-proj="${s.key}" class="${stratProjScenario === s.key ? 'active' : ''}">${s.label} ${s.rate.toFixed(0)}%</button>`).join('')}</div>
        <div class="chart-wrap" data-chart-tooltip>
          ${(() => { const e = engines[stratProjScenario] || centralEngine; const sample = e.points.filter((_, i) => i % Math.max(1, Math.round(e.points.length / 60)) === 0);
            return lineChartSVG('chart-projection', [
              { color: '#128957', data: sample.map(p => ({ x: p.year, y: p.capital })) },
              { color: '#728077', dash: '5 4', data: sample.map(p => ({ x: p.year, y: p.versements })) },
              { color: '#2781d8', dash: '2 4', data: sample.map(p => ({ x: p.year, y: p.interets })) }
            ]); })()}
          <div class="chart-tooltip" id="tt-chart-projection" hidden></div>
        </div>
        <div class="chart-legend"><span><i style="background:#128957"></i>Capital total</span><span><i style="background:#728077"></i>Versements cumulés</span><span><i style="background:#2781d8"></i>Intérêts cumulés</span></div>
      </section>

      <!-- 9. REPÈRES -->
      <section class="card span-1" id="reperes-card">
        <div class="sec-head"><h2>Repères clés</h2></div>
        <div class="subtle" style="margin-bottom:6px">Scénario ${(scenarios.find(s => s.key === stratProjScenario) || scenarios[1]).label} (${(scenarios.find(s => s.key === stratProjScenario) || scenarios[1]).rate.toFixed(0)}%)</div>
        <div class="reperes-list">
          ${snapshotYears(x.horizon).map(y => { const e = engines[stratProjScenario] || centralEngine; const p = pointAtYear(e, y); return `<div class="repere-row"><b>${new Date().getFullYear() + Math.round(y)}</b><span>${eur(p.capital)}</span><small>versé ${eur(p.versements)} · intérêts ${eur(p.interets)}</small></div>`; }).join('')}
        </div>
      </section>

      <!-- INFORMATIONS IMPORTANTES -->
      <section class="card span-3 info-card">
        <div class="sec-head"><h2>Informations importantes</h2></div>
        <ul class="info-list">
          <li>Les rendements affichés sont des hypothèses, pas des garanties.</li>
          <li>Les performances passées ne préjugent pas des performances futures.</li>
          <li>Investir comporte un risque de perte en capital.</li>
          <li>Réinvestir les gains accélère fortement la croissance (effet composé).</li>
          <li>Commencer tôt est ton plus grand avantage.</li>
          <li>L’inflation n’est pas prise en compte dans ces projections.</li>
        </ul>
        <div class="insight" style="margin-top:8px"><b>Ces projections ne garantissent aucun rendement futur.</b></div>
      </section>
    </div>`;

    const projScenario = scenarios.find(s => s.key === stratProjScenario) || scenarios[1];
    chartData['chart-evolution'] = { type: 'multi', maxYear: x.horizon, getMetric: () => stratMetric, series: scenarios.map(s => ({ label: s.label, rate: s.rate, color: s.color, points: engines[s.key].points })) };
    chartData['chart-projection'] = { type: 'single', maxYear: x.horizon, series: [{ label: projScenario.label, points: (engines[stratProjScenario] || centralEngine).points }] };
  }

  function whatIfStrategyBlock(delta, base) {
    const withDelta = financeEngine(base.capital, base.monthly + num(delta), base.rate, base.horizon);
    const gainedMonths = (base.basculeMonths ?? 0) - (withDelta.basculeMonth ?? 0);
    const capH = base.engine.finalCapital, capHDelta = withDelta.finalCapital;
    const intH = base.engine.finalInterets, intHDelta = withDelta.finalInterets;
    return `
      <div class="whatif-row"><span>Impact sur ton point de bascule</span><b class="pos">${gainedMonths > 0 ? '−' + monthsToText(gainedMonths) : (gainedMonths < 0 ? '+' + monthsToText(-gainedMonths) : '±0')}</b></div>
      <div class="whatif-row"><span>Nouveau point de bascule</span><b>${monthsToText(withDelta.basculeMonth)} · ${monthsToDate(withDelta.basculeMonth)}</b></div>
      <div class="whatif-row"><span>Capital estimé à ${base.horizon} ans</span><b class="pos">+${eur(capHDelta - capH)}</b><small>(${eur(capHDelta)} au lieu de ${eur(capH)})</small></div>
      <div class="whatif-row"><span>Intérêts supplémentaires</span><b class="pos">+${eur(intHDelta - intH)}</b><small>sur ${base.horizon} ans</small></div>
    `;
  }

  function nearestChartPoint(points, year) {
    let best = points[0];
    for (const p of points) { if (Math.abs(p.year - year) < Math.abs(best.year - year)) best = p; }
    return best;
  }

  function chartYearFromClientX(svg, clientX, maxYear) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return 0;
    const relX = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const vbX = relX * (CHART_W / rect.width);
    const plotW = CHART_W - CHART_PAD_L - CHART_PAD_R;
    const frac = Math.min(1, Math.max(0, (vbX - CHART_PAD_L) / plotW));
    return frac * maxYear;
  }

  function handleChartHover(e) {
    const svg = e.target.closest('svg.chart-svg');
    // masquer toute info-bulle si le pointeur n'est plus sur un graphique
    Object.keys(chartData).forEach(id => { const tt = document.getElementById('tt-' + id); if (tt && (!svg || svg.id !== id)) tt.hidden = true; });
    if (!svg) return;
    const data = chartData[svg.id];
    const tooltip = document.getElementById('tt-' + svg.id);
    if (!data || !tooltip) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const year = chartYearFromClientX(svg, clientX, data.maxYear);
    const yearLabel = new Date().getFullYear() + Math.round(year);
    let html = `<div class="tt-year">Année ${yearLabel}</div>`;
    if (data.type === 'multi') {
      const metric = data.getMetric();
      const metricLabel = { capital: 'Capital total', interets: 'Intérêts cumulés', versements: 'Versements cumulés' }[metric];
      html += `<div class="tt-metric">${metricLabel}</div>`;
      data.series.forEach(s => { const p = nearestChartPoint(s.points, year); html += `<div class="tt-row"><i style="background:${s.color}"></i>${s.label} (${s.rate.toFixed(0)}%) <b>${eur(p[metric])}</b></div>`; });
    } else {
      const p = nearestChartPoint(data.series[0].points, year);
      html += `<div class="tt-row"><span>Capital total</span><b>${eur(p.capital)}</b></div><div class="tt-row"><span>Versements cumulés</span><b>${eur(p.versements)}</b></div><div class="tt-row"><span>Intérêts cumulés</span><b>${eur(p.interets)}</b></div>`;
    }
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const rect = svg.getBoundingClientRect();
    const clampedLeft = Math.min(rect.width - 10, Math.max(10, clientX - rect.left));
    tooltip.style.left = clampedLeft + 'px';
  }
  document.addEventListener('mousemove', handleChartHover);
  document.addEventListener('touchmove', e => { handleChartHover(e); }, { passive: true });
  document.addEventListener('mouseleave', () => { Object.keys(chartData).forEach(id => { const tt = document.getElementById('tt-' + id); if (tt) tt.hidden = true; }); });

  function menuRow(ic, title, sub, action) { return `<div class="row clickable" ${action || ''}><div class="ico">${ic}</div><div class="row-main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div><span class="chev">›</span></div>`; }

  function renderPlus() {
    setTitle('Plus', false);
    const lastBackup = backups[0];
    $('#view').innerHTML = `<div class="stack">
      <section class="card menu-profile"><div class="avatar">●</div><div><b>Mon Budget</b><br><small style="color:var(--mut)">Gérez votre budget facilement</small></div></section>
      <div><div class="group-title">Gestion</div><section class="card menu">
        ${menuRow('▣', 'Comptes &amp; Budget', '', 'data-info="Comptes & Budget"')}
        ${menuRow('▦', 'Catégories', Object.values(CATS).join(' · '), 'data-info="Catégories"')}
        ${menuRow('▰', 'Moyens de paiement', '', 'data-info="Moyens de paiement"')}
        ${menuRow('↻', 'Règles de récurrence', `${(budget.recurringTemplates||[]).length} actives`, 'data-open-recurring')}
      </section></div>
      <div><div class="group-title">Outils &amp; sauvegardes</div><section class="card menu">
        ${menuRow('⇩', 'Exporter toutes mes données', '', 'data-export')}
        ${menuRow('⇧', 'Importer / restaurer un fichier', '', 'data-import')}
        ${menuRow('🗄️', 'Sauvegardes automatiques', lastBackup ? 'Dernière : ' + new Date(lastBackup.ts).toLocaleString('fr-FR') : 'Aucune pour le moment', 'data-go="backups"')}
      </section></div>
      <div><div class="group-title">Patrimoine</div><section class="card menu plus-strategy">
        ${menuRow('↗', 'Ma stratégie', 'Investissement · point de bascule · projections', 'data-go="strategy"')}
        ${menuRow('🎯', 'Objectifs', 'Projets et effort mensuel', 'data-go="goals"')}
        ${menuRow('🐷', 'Épargne &amp; poches', 'Couverture financière et répartition', 'data-go="savings"')}
      </section></div>
      <div><div class="group-title">Anticipation</div><section class="card menu">
        ${menuRow('🎂', 'Anniversaires', `${extra.birthdays.length} enregistré(s)`, 'data-go="birthdays"')}
        ${menuRow('💳', 'Paiements en plusieurs fois', `${installmentItems().length} en cours`, 'data-go="installments"')}
        ${menuRow('🗓️', 'Dépenses annuelles', 'Calculées depuis les dépenses récurrentes', 'data-go="annual"')}
        ${menuRow('🤝', 'Échanges / Remboursements', `${extra.exchanges.filter(x => !x.done).length} en attente`, 'data-go="exchanges"')}
      </section></div>
      <div><div class="group-title">Application</div><section class="card menu">
        ${menuRow('🎨', 'Apparence', 'Thème clair vert doux (par défaut)', 'data-info="Apparence"')}
        ${menuRow('❓', 'Aide', '', 'data-info="Aide"')}
        ${menuRow('ℹ️', 'À propos de Budget Orion', 'Version ' + SCHEMA_VERSION, 'data-info="À propos"')}
      </section></div>
    </div>`;
  }

  function renderBackups() {
    setTitle('Sauvegardes', false);
    $('#view').innerHTML = `<div class="stack">
      <div class="sec-head"><button class="link" data-go="plus">‹ Retour</button><button class="link" data-make-backup>＋ Sauvegarder maintenant</button></div>
      <div class="insight">Une sauvegarde automatique est créée avant chaque migration de données et avant chaque restauration ou import. Restaurer un point ne supprime rien : ton état actuel est lui aussi sauvegardé avant.</div>
      <section class="card list">${backups.length ? backups.map(b => `<div class="row"><div class="row-main"><b>${esc(b.label)}</b><small>${new Date(b.ts).toLocaleString('fr-FR')} ${b.auto ? '· auto' : '· manuelle'}</small></div><button class="mini-action" data-restore-backup="${b.id}">Restaurer</button></div>`).join('') : '<div class="empty">Aucune sauvegarde pour le moment.</div>'}</section>
    </div>`;
  }

  function renderBirthdays() {
    setTitle('Anniversaires', false);
    const arr = extra.birthdays.map((b, i) => ({ b, i, n: birthdayNext(b) })).sort((a, b) => (a.n?.days ?? 9999) - (b.n?.days ?? 9999));
    const sum = arr.reduce((s, x) => s + num(x.b.budget), 0);
    $('#view').innerHTML = `<div class="stack"><div class="sec-head"><button class="link" data-go="plus">‹ Retour</button><button class="link" data-open-birthday>＋</button></div>
      <section class="card list">${arr.length ? arr.map(x => `<div class="row clickable" data-edit-birthday="${x.i}"><div class="ico">🎂</div><div class="row-main"><b>${esc(x.b.name)}</b><small>${x.b.birthDate ? dateLabelLong(x.b.birthDate) : ''} · ${x.n?.age ?? '—'} ans</small><small style="color:var(--red);display:block">${x.n?.days === 0 ? 'Aujourd’hui' : (x.n?.days ?? '—') + ' jours restants'}</small></div><b class="neg">${eur(x.b.budget)}</b></div>`).join('') : '<div class="empty">Aucun anniversaire. Appuie sur + pour en ajouter.</div>'}</section>
      <section class="detail-total pink"><small>Total à prévoir</small><h2 style="margin:4px 0">${eur(sum)}</h2></section></div>`;
  }

  function renderInstallments() {
    setTitle('Paiements en plusieurs fois', false);
    const arr = installmentItems(); const sum = arr.reduce((s, x) => s + x.remainingAmount, 0);
    $('#view').innerHTML = `<div class="stack"><div class="sec-head"><button class="link" data-go="plus">‹ Retour</button><button class="link" data-add-tx-install>＋</button></div>
      <section class="detail-total orange"><small>Total restant dû</small><h2 style="margin:4px 0">${eur(sum)}</h2><small>${arr.reduce((s, x) => s + x.remainingCount, 0)} échéances à venir</small></section>
      <section class="card list">${arr.length ? arr.map(x => `<div class="row"><div class="ico">▣</div><div class="row-main"><b>${esc(x.name)}</b><small>${eur(x.amount)} / mois · Restant : ${x.remainingCount} / ${x.installments}</small></div><b class="neg">-${eur(x.amount)}</b></div>`).join('') : '<div class="empty">Aucun paiement fractionné. Crée-le depuis une dépense avec « Échéancier ».</div>'}</section></div>`;
  }

  function renderAnnual() {
    setTitle('Dépenses annuelles', false);
    const arr = annualItems(); const sum = arr.reduce((s, x) => s + x.annual, 0);
    $('#view').innerHTML = `<div class="stack"><div class="sec-head"><button class="link" data-go="analysis">‹ Analyse</button></div>
      <section class="card"><div class="insight">Ces montants sont calculés automatiquement depuis tes dépenses récurrentes. Rien à saisir deux fois.</div></section>
      <section class="card list">${arr.length ? arr.map(x => `<div class="row"><div class="ico">🗓️</div><div class="row-main"><b>${esc(x.name)}</b><small>${eur(x.monthly)} / mois</small></div><b style="color:var(--blue)">${eur(x.annual)} / an</b></div>`).join('') : '<div class="empty">Aucune dépense récurrente détectée.</div>'}</section>
      <section class="detail-total blue"><small>Total annuel récurrent</small><h2 style="margin:4px 0">${eur(sum)}</h2><small>soit ${eur(sum / 12)} / mois en moyenne</small></section></div>`;
  }

  function renderExchanges() {
    setTitle('Échanges / Remboursements', false);
    const arr = extra.exchanges; const sum = arr.filter(x => !x.done).reduce((s, x) => s + num(x.amount), 0);
    $('#view').innerHTML = `<div class="stack"><div class="sec-head"><button class="link" data-go="plus">‹ Retour</button><button class="link" data-open-exchange>＋</button></div>
      <section class="card list">${arr.length ? arr.map((x, i) => `<div class="row clickable" data-edit-exchange="${i}"><div class="ico">🤝</div><div class="row-main"><b>${esc(x.name)}</b><small>${esc(x.note || '')} ${x.done ? '· Remboursé' : ''}</small></div><b class="${num(x.amount) >= 0 ? 'pos' : 'neg'}">${eur(x.amount)}</b></div>`).join('') : '<div class="empty">Aucun échange enregistré.</div>'}</section>
      <section class="detail-total mint"><small>Total en attente</small><h2 style="margin:4px 0">${eur(sum)}</h2></section></div>`;
  }

  /* ---------------------------------------------------------------------
     11. SHEETS (panneaux d'action)
     ------------------------------------------------------------------- */
  function openSheet(title, html) { $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html; $('#overlay').classList.add('open'); $('#sheet').classList.add('open'); }
  function closeSheet() { $('#overlay').classList.remove('open'); $('#sheet').classList.remove('open'); }

  function txForm(type = 'expense', idx = '', install = false) {
    const r = idx === '' ? {} : monthObj()[type === 'income' ? 'income' : 'expenses'][+idx] || {};
    const tpl = r.templateId ? (budget.recurringTemplates || []).find(t => t.id === r.templateId) : null;
    const recur = install ? 'installments' : tpl?.installments ? 'installments' : tpl ? (num(tpl.interval) === 1 ? 'monthly' : num(tpl.interval) === 3 ? 'quarterly' : num(tpl.interval) === 6 ? 'semiannual' : num(tpl.interval) === 12 ? 'annual' : 'custom') : 'once';
    const brand = brandOf(r.name || '', r.cat);
    openSheet(idx === '' ? 'Ajouter une transaction' : 'Modifier la transaction', `<form class="form" id="txForm">
      <input type="hidden" name="type" value="${type}"><input type="hidden" name="idx" value="${idx}">
      <label>Type<select name="kind"><option value="expense" ${type === 'expense' ? 'selected' : ''}>Dépense</option><option value="income" ${type === 'income' ? 'selected' : ''}>Revenu</option></select></label>
      <label>Libellé<input name="name" id="txName" required value="${esc(r.name || '')}" autocomplete="off"></label>
      ${brand.matched ? `<div class="brand-hint"><span class="brandmark ${brand.cls}">${brand.mark}</span> Reconnu : <b>${esc(brand.label)}</b></div>` : ''}
      <div class="two"><label>Montant (€)<input type="number" step="0.01" name="amount" required value="${num(r.amount) || ''}"></label><label>Date prévue<input type="date" name="date" value="${r.dueDate || today()}"></label></div>
      <label>Catégorie<select name="cat">${Object.keys(CATS).map(k => `<option value="${k}" ${(r.cat || brand.suggestedCat) === k ? 'selected' : ''}>${CATS[k]}</option>`).join('')}</select></label>
      <label>Récurrence<select name="recur">
        <option value="once" ${recur === 'once' ? 'selected' : ''}>Ponctuelle</option>
        <option value="monthly" ${recur === 'monthly' ? 'selected' : ''}>Mensuelle</option>
        <option value="quarterly" ${recur === 'quarterly' ? 'selected' : ''}>Trimestrielle</option>
        <option value="semiannual" ${recur === 'semiannual' ? 'selected' : ''}>Semestrielle</option>
        <option value="annual" ${recur === 'annual' ? 'selected' : ''}>Annuelle</option>
        <option value="custom" ${recur === 'custom' ? 'selected' : ''}>Personnalisée (tous les X mois)</option>
        <option value="installments" ${recur === 'installments' ? 'selected' : ''}>Échéancier (paiement en plusieurs fois)</option>
      </select></label>
      <div class="two"><label>Intervalle personnalisé (mois)<input type="number" min="1" name="interval" value="${tpl?.interval || 2}" placeholder="Ex : 2"></label><label>Nombre de paiements<input type="number" min="2" name="count" value="${tpl?.installments || ''}" placeholder="Ex : 4"></label></div>
      <label><input type="checkbox" name="paid" ${r.paid ? 'checked' : ''}> Déjà payé / reçu</label>
      ${tpl ? `<label>Cette modification s’applique à<select name="scope"><option value="all">Toute la série</option><option value="only">Seulement cette occurrence</option><option value="following">Cette occurrence et les suivantes</option></select></label>` : ''}
      <button class="action">Enregistrer</button>
      ${idx !== '' && type === 'expense' ? `<div class="v23-actions" style="margin-top:4px"><button type="button" data-edit-emoji="expense" data-index="${idx}">🎨 Icône</button><button type="button" data-report-tx="${idx}">↦ Reporter</button><button type="button" data-dup-tx="${idx}">⧉ Dupliquer</button></div>` : ''}
      ${idx !== '' && type === 'expense' ? `<button type="button" class="ghost" data-whatif-remove="${idx}">Et si je supprimais cette dépense ?</button>` : ''}
      ${idx !== '' ? '<button type="button" class="ghost danger" data-delete-tx>Supprimer</button>' : ''}
    </form>`);
  }

  function whatIfRemoveSheet(idx) {
    const r = monthObj().expenses[+idx];
    if (!r) return;
    const w = whatIf(num(r.amount));
    openSheet(`Et si je supprimais « ${r.name} » ?`, `<section class="card">
      <div class="scenario-row"><span>Économie mensuelle</span><b class="pos">${eur(w.monthly)}</b></div>
      <div class="scenario-row"><span>Économie annuelle</span><b class="pos">${eur(w.annual)}</b></div>
      <div class="scenario-row"><span>Économie sur 5 ans</span><b class="pos">${eur(w.fiveYears)}</b></div>
      <div class="insight" style="margin-top:10px">Si cette somme était investie chaque mois au taux actuel (${w.rate}%), elle vaudrait environ <b>${eur(w.investedFiveYears)}</b> dans 5 ans.</div>
    </section><button class="action ghost" type="button" data-back-to-tx="expense" data-index="${idx}">‹ Retour à la dépense</button>`);
  }

  function birthdayForm(i = '') { const b = i === '' ? {} : extra.birthdays[+i] || {}; openSheet(i === '' ? 'Ajouter un anniversaire' : 'Modifier l’anniversaire', `<form class="form" id="birthdayForm"><input type="hidden" name="idx" value="${i}"><label>Prénom / nom<input name="name" required value="${esc(b.name || '')}"></label><label>Date de naissance<input type="date" name="birthDate" required value="${b.birthDate || ''}"></label><label>Budget cadeau prévu (€)<input type="number" step="0.01" name="budget" value="${num(b.budget) || ''}"></label><label>Rappel<select name="reminder"><option value="7">7 jours avant</option><option value="14" ${b.reminder == 14 ? 'selected' : ''}>14 jours avant</option><option value="30" ${b.reminder == 30 ? 'selected' : ''}>30 jours avant</option></select></label><label>Note<textarea name="note" rows="2">${esc(b.note || '')}</textarea></label><button class="action">Enregistrer</button>${i !== '' ? '<button type="button" class="ghost danger" data-delete-birthday>Supprimer</button>' : ''}</form>`); }

  function goalForm(id = '') {
    const g = id === '' ? {} : goals.find(x => x.id === id) || {};
    openSheet(id === '' ? 'Nouvel objectif' : 'Modifier l’objectif', `<form class="form" id="goalForm"><input type="hidden" name="itemId" value="${id}">
      <label>Nom<input name="name" required value="${esc(g.n || '')}"></label>
      <label>Icône<input name="emoji" value="${esc(g.e || '🎯')}"></label>
      <div class="two"><label>Objectif (€)<input type="number" name="target" step="1" value="${num(g.target) || ''}"></label><label>Déjà épargné (€)<input type="number" name="current" step="1" value="${num(g.current) || ''}"></label></div>
      <label>Date cible<input type="date" name="targetDate" value="${g.targetDate || ''}"></label>
      <button class="action">Enregistrer</button>${id !== '' ? '<button type="button" class="ghost danger" data-delete-goal>Supprimer</button>' : ''}</form>`);
  }

  function pocketForm(id) {
    const p = extra.pockets.find(x => x.id === id);
    if (!p) return;
    openSheet('Gérer la poche', `<form class="form" id="pocketForm"><input type="hidden" name="itemId" value="${id}">
      <label>Nom<input name="name" required value="${esc(p.name)}"></label>
      <label>Icône<input name="emoji" value="${esc(p.emoji || '💶')}"></label>
      <label>Solde (€)<input type="number" name="balance" step="1" value="${num(p.balance)}"></label>
      <label>Contribution mensuelle (€)<input type="number" name="monthlyTarget" step="1" value="${num(p.monthlyTarget)}"></label>
      <label><input type="checkbox" name="security" ${p.security ? 'checked' : ''}> Utiliser comme poche de sécurité (pour le calcul de couverture)</label>
      <button class="action">Enregistrer</button>
      ${extra.pockets.length > 1 ? '<button type="button" class="ghost danger" data-delete-pocket>Supprimer cette poche</button>' : ''}
    </form>`);
  }

  function transferForm() {
    openSheet('Transférer entre poches', `<form class="form" id="transferForm">
      <label>Depuis<select name="from">${extra.pockets.map(p => `<option value="${p.id}">${esc(p.emoji)} ${esc(p.name)} (${eur(p.balance)})</option>`).join('')}</select></label>
      <label>Vers<select name="to">${extra.pockets.map(p => `<option value="${p.id}">${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>
      <label>Montant (€)<input type="number" name="amount" min="0" step="1" required></label>
      <button class="action">Transférer</button>
    </form>`);
  }

  function strategyForm() {
    const s = extra.strategy || {};
    const r = s.scenarioRates || { prudent: 5, central: 7, dynamique: 10 };
    openSheet('Régler Ma stratégie', `<form class="form" id="strategyForm">
      <label>Capital déjà investi (€)<input type="number" min="0" step="0.01" name="capital" value="${num(s.capital)}"></label>
      <label>Versement mensuel (€)<input type="number" min="0" step="0.01" name="monthly" value="${num(s.monthly)}"></label>
      <label>Rendement annuel estimé (%)<input type="number" min="0" max="50" step="0.1" name="rate" value="${num(s.rate)}"></label>
      <label>Horizon de projection (années)<input type="number" min="5" max="50" step="1" name="horizon" value="${num(s.horizon) || 20}"></label>
      <div class="insight">Le point de bascule correspond au moment où le rendement annuel théorique devient supérieur ou égal à tes versements annuels. Ces projections ne garantissent aucun rendement futur.</div>
      <div class="group-title" style="margin:4px 0 0">Taux des 3 scénarios de comparaison</div>
      <div class="two">
        <label>Prudent (%)<input type="number" min="0" max="50" step="0.1" name="rPrudent" value="${num(r.prudent) || 5}"></label>
        <label>Central (%)<input type="number" min="0" max="50" step="0.1" name="rCentral" value="${num(r.central) || 7}"></label>
      </div>
      <label>Dynamique (%)<input type="number" min="0" max="50" step="0.1" name="rDynamique" value="${num(r.dynamique) || 10}"></label>
      <button class="action">Recalculer ma stratégie</button>
    </form>`);
  }

  function monthlySavingForm() {
    const m = monthObj(); const sv = m.savings || { amount: 0, paid: false, date: '' };
    openSheet('Épargne du mois', `<form class="form" id="monthlySavingForm">
      <div class="insight">Renseigne le montant réellement mis de côté en ${ML[month].toLowerCase()} ${year}.</div>
      <label>Montant épargné (€)<input type="number" min="0" step="0.01" name="amount" value="${num(sv.amount) || ''}" placeholder="Ex : 250"></label>
      <label>Vers quelle poche ?<select name="pocket"><option value="">— Ne pas affecter —</option>${extra.pockets.map(p => `<option value="${p.id}">${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>
      <label>Date du versement<input type="date" name="date" value="${sv.date || today()}"></label>
      <label><input type="checkbox" name="paid" ${sv.paid ? 'checked' : ''}> Versement effectué</label>
      <button class="action">Enregistrer l’épargne</button></form>`);
  }

  function exchangeForm(i = '') { const x = i === '' ? {} : extra.exchanges[+i] || {}; openSheet(i === '' ? 'Nouvel échange' : 'Modifier l’échange', `<form class="form" id="exchangeForm"><input type="hidden" name="idx" value="${i}"><label>Personne / motif<input name="name" required value="${esc(x.name || '')}"></label><label>Montant (€)<input type="number" step="0.01" name="amount" value="${num(x.amount) || ''}"><small>Positif = on me doit, négatif = je dois.</small></label><label>Note<input name="note" value="${esc(x.note || '')}"></label><label><input type="checkbox" name="done" ${x.done ? 'checked' : ''}> Remboursé / terminé</label><button class="action">Enregistrer</button>${i !== '' ? '<button type="button" class="ghost danger" data-delete-exchange>Supprimer</button>' : ''}</form>`); }

  function dayDetails(d) {
    const ds = iso(year, month, d);
    const inc = (monthObj().income || []).filter(r => r.dueDate === ds);
    const exp = (monthObj().expenses || []).filter(r => r.dueDate === ds);
    const bds = extra.birthdays.filter(b => birthdayNext(b)?.date === ds);
    openSheet(`${d} ${ML[month]} ${year}`, `<section class="card list">${inc.map(r => rowTx(r, 'income', monthObj().income.indexOf(r))).join('')}${exp.map(r => rowTx(r, 'expense', monthObj().expenses.indexOf(r))).join('')}${bds.map(b => `<div class="row"><div class="ico">🎂</div><div class="row-main"><b>${esc(b.name)}</b><small>Anniversaire</small></div></div>`).join('') || (inc.length || exp.length ? '' : '<div class="empty">Aucun événement ce jour.</div>')}</section>`);
  }

  function categoryDetail(cat) {
    const rows = (monthObj().expenses || []).map((r, i) => ({ r, i })).filter(x => (x.r.cat || 'autres') === cat && x.r.paid);
    const sum = rows.reduce((s, x) => s + num(x.r.amount), 0);
    openSheet(CATS[cat] || cat, `<section class="detail-total mint"><small>Total ${ML[month].toLowerCase()}</small><h2 style="margin:4px 0">${eur(sum)}</h2></section><section class="card list">${rows.length ? rows.map(x => rowTx(x.r, 'expense', x.i)).join('') : '<div class="empty">Aucune dépense payée dans cette catégorie ce mois-ci.</div>'}</section>`);
  }

  function info(msg) { openSheet(msg, `<div class="empty">Cette rubrique conserve le visuel de la maquette. Elle sera enrichie sans jamais modifier les données existantes.</div>`); }

  function exportData() {
    const payload = { budget, goals, extra, backups, exported: new Date().toISOString(), schema: SCHEMA_VERSION };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `budget-orion-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  }

  function importData() { openSheet('Importer une sauvegarde', `<form class="form" id="importForm"><label>Fichier JSON<input type="file" name="file" accept="application/json"></label><div class="insight">L’import valide le fichier puis crée d’abord une sauvegarde de sécurité de tes données actuelles. Un fichier invalide n’écrasera jamais tes données.</div><button class="action">Importer</button></form>`); }

  function isValidBackupPayload(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.budget && typeof obj.budget !== 'object') return false;
    if (obj.goals && !Array.isArray(obj.goals)) return false;
    if (obj.extra && typeof obj.extra !== 'object') return false;
    return !!(obj.budget || obj.goals || obj.extra);
  }

  /* ---------------------------------------------------------------------
     12. ENREGISTREMENT DES TRANSACTIONS (avec portée d'édition récurrente)
     ------------------------------------------------------------------- */
  function splitTemplateForward(tpl, fromKey, newValues) {
    // termine l'ancien template la veille de fromKey, crée un nouveau template à partir de fromKey
    const prevKey = monthKeyAdd(fromKey, -1);
    const [py, pm] = prevKey.split('-').map(Number);
    tpl.endDate = `${prevKey}-${p2(lastDayOfMonth(py, pm - 1))}`;
    const occIdx = occurrenceIndex({ ...tpl, endDate: null }, fromKey);
    const newTpl = { ...clone(tpl), id: uid('tpl'), startDate: `${fromKey}-01`, endDate: null, skipMonths: [], overrides: {} };
    if (num(tpl.installments) > 0 && occIdx != null) newTpl.installments = Math.max(0, num(tpl.installments) - occIdx);
    Object.assign(newTpl, newValues);
    budget.recurringTemplates.push(newTpl);
    return newTpl;
  }

  function saveTx(fd) {
    const type = fd.get('kind');
    const idx = fd.get('idx');
    const name = fd.get('name').trim();
    const amount = num(fd.get('amount'));
    const date = fd.get('date');
    const cat = fd.get('cat');
    const paid = fd.get('paid') === 'on';
    const recur = fd.get('recur');
    const scope = fd.get('scope') || 'all';
    const count = Math.max(0, Math.round(num(fd.get('count'))));
    const customInterval = Math.max(1, Math.round(num(fd.get('interval')) || 1));
    const mo = monthObj();
    const list = type === 'income' ? mo.income : mo.expenses;
    const old = idx !== '' ? list[+idx] : null;
    const row = old || {};
    const k = key();

    Object.assign(row, { name, amount, cat, paid, paidDate: paid ? today() : '', dueDate: type === 'income' ? '' : date });
    if (idx === '') list.push(row);

    if (recur !== 'once') {
      let tpl = old?.templateId ? (budget.recurringTemplates || []).find(t => t.id === old.templateId) : null;
      const interval = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, custom: customInterval, installments: 1 }[recur] || 1;
      const installments = recur === 'installments' ? Math.max(2, count || 2) : 0;

      if (!tpl) {
        tpl = { id: uid('tpl'), kind: type, name, amount, cat, freq: 'everyN', interval, installments, startDate: date || `${k}-01`, dueDay: date ? +date.slice(-2) : 1, auto: false, skipMonths: [], overrides: {} };
        budget.recurringTemplates.push(tpl);
        row.templateId = tpl.id; row.recurring = true;
      } else if (scope === 'only') {
        tpl.overrides[k] = { name, amount, cat };
        row.templateId = tpl.id; row.recurring = true;
      } else if (scope === 'following') {
        splitTemplateForward(tpl, k, { name, amount, cat, interval, installments });
        row.templateId = null; row.recurring = false; // la ligne de ce mois redevient une occurrence normale du NOUVEAU template au prochain rendu
        delete budget.monthlyData[k].expenses; // force la régénération propre depuis les templates pour ce mois
        budget.monthlyData[k].expenses = (mo.expenses || []).filter(r => r !== row);
      } else {
        Object.assign(tpl, { name, amount, cat, freq: 'everyN', interval, installments, dueDay: date ? +date.slice(-2) : tpl.dueDay });
        row.templateId = tpl.id; row.recurring = true;
      }
    } else if (row.templateId) {
      const ti = budget.recurringTemplates.findIndex(t => t.id === row.templateId);
      if (ti >= 0) budget.recurringTemplates.splice(ti, 1);
      delete row.templateId; delete row.recurring;
    }
    saveBudget(); closeSheet(); render();
  }

  function deleteTx() {
    const form = $('#txForm'); const fd = new FormData(form);
    const originalType = fd.get('type') || fd.get('kind');
    const idx = +fd.get('idx');
    const scope = fd.get('scope') || 'all';
    const list = monthObj()[originalType === 'income' ? 'income' : 'expenses'];
    const item = list[idx];
    if (!item) return;
    const tplId = item.templateId;
    const question = tplId ? (scope === 'only' ? 'Supprimer uniquement cette occurrence ?' : scope === 'following' ? 'Supprimer cette occurrence et toutes les suivantes ?' : 'Supprimer toute la série récurrente ?') : 'Supprimer cette transaction ?';
    if (!confirm(question)) return;
    if (tplId) {
      const tpl = budget.recurringTemplates.find(t => t.id === tplId);
      if (scope === 'only' && tpl) {
        tpl.skipMonths = tpl.skipMonths || []; tpl.skipMonths.push(key());
        list.splice(idx, 1);
      } else if (scope === 'following' && tpl) {
        const prevKey = monthKeyAdd(key(), -1); const [py, pm] = prevKey.split('-').map(Number);
        tpl.endDate = `${prevKey}-${p2(lastDayOfMonth(py, pm - 1))}`;
        Object.keys(budget.monthlyData).filter(k => k >= key()).forEach(k => {
          budget.monthlyData[k].income = (budget.monthlyData[k].income || []).filter(r => r.templateId !== tplId);
          budget.monthlyData[k].expenses = (budget.monthlyData[k].expenses || []).filter(r => r.templateId !== tplId);
        });
      } else {
        budget.recurringTemplates = (budget.recurringTemplates || []).filter(t => t.id !== tplId);
        Object.values(budget.monthlyData || {}).forEach(m => { m.income = (m.income || []).filter(r => r.templateId !== tplId); m.expenses = (m.expenses || []).filter(r => r.templateId !== tplId); });
      }
    } else { list.splice(idx, 1); }
    saveBudget(); closeSheet(); render();
  }

  /* ---------------------------------------------------------------------
     13. ÉVÉNEMENTS
     ------------------------------------------------------------------- */
  $('#nav').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (!b) return; page = b.dataset.page; if (page !== 'strategy') stratPreviewRate = null; render(); });

  document.addEventListener('click', e => {
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const arr = tog.dataset.toggle === 'income' ? monthObj().income : monthObj().expenses; const iidx = +tog.dataset.index; const item = arr[iidx]; if (item && !isAutoIncome(item)) { const kind = tog.dataset.toggle; item.paid = !item.paid; item.paidDate = item.paid ? today() : ''; const wasPaid = item.paid; saveBudget(); render(); toast(wasPaid ? (kind === 'income' ? '✓ Marqué reçu' : '✓ Marqué payé') : 'Repassé en prévu', () => { const a2 = kind === 'income' ? monthObj().income : monthObj().expenses; const it2 = a2[iidx]; if (it2) { it2.paid = !it2.paid; it2.paidDate = it2.paid ? today() : ''; saveBudget(); render(); } }); } return; }

    const txv = e.target.closest('[data-tx-view]'); if (txv) { const v = txv.dataset.txView; txView = (v === 'paid') ? 'paid' : (v === 'all' ? 'due' : v); if (v === 'all') txQuick = 'all'; if (page !== 'transactions') { page = 'transactions'; } render(); return; }
    const txq = e.target.closest('[data-tx-quick]'); if (txq) { txQuick = txq.dataset.txQuick; render(); return; }
    if (e.target.closest('[data-tx-paidtoggle]')) { txPaidOpen = !txPaidOpen; render(); return; }
    const eem = e.target.closest('[data-edit-emoji]'); if (eem) return identityPicker(eem.dataset.editEmoji, eem.dataset.index);
    const est = e.target.closest('[data-emoji-set]'); if (est) { const v = est.dataset.emojiSet; return setExpenseEmoji(est.dataset.etype, est.dataset.eidx, v === '__auto__' ? '' : v); }
    const rpt = e.target.closest('[data-report-tx]'); if (rpt) return reportSheet(rpt.dataset.reportTx);
    const rdo = e.target.closest('[data-report]'); if (rdo) return reportExpenseTo(rdo.dataset.report, rdo.dataset.date);
    const dup = e.target.closest('[data-dup-tx]'); if (dup) return duplicateExpense(dup.dataset.dupTx);

    const hx = e.target.closest('[data-home-explain]'); if (hx) return homeExplain(hx.dataset.homeExplain);
    if (e.target.closest('[data-home-topay]')) return homeTopay();
    if (e.target.closest('[data-edit-period]')) { $('#periodBtn').click(); return; }
    if (e.target.closest('[data-home-glance]')) { const h = localStorage.getItem('orion_ui_glanceHidden') === '1'; try { localStorage.setItem('orion_ui_glanceHidden', h ? '0' : '1'); } catch {} render(); return; }

    const g = e.target.closest('[data-go]'); if (g) { page = g.dataset.go; if (page !== 'strategy') stratPreviewRate = null; render(); return; }
    if (e.target.closest('[data-add-tx]')) return txForm();
    if (e.target.closest('[data-add-tx-install]')) return txForm('expense', '', true);
    if (e.target.closest('[data-open-birthday]')) return birthdayForm();
    if (e.target.closest('[data-add-goal]')) return goalForm();
    if (e.target.closest('[data-edit-month-saving]')) return monthlySavingForm();
    if (e.target.closest('[data-edit-coverage-target]')) { const v = prompt('Objectif de couverture (en mois)', extra.coverageTargetMonths); if (v !== null && num(v) > 0) { extra.coverageTargetMonths = num(v); saveExtra(); render(); } return; }
    if (e.target.closest('[data-open-exchange]')) return exchangeForm();
    if (e.target.closest('[data-edit-strategy]')) return strategyForm();
    if (e.target.closest('[data-add-pocket]')) { const p = { id: uid('pk'), name: 'Nouvelle poche', emoji: '💶', balance: 0, monthlyTarget: 0 }; extra.pockets.push(p); saveExtra(); pocketForm(p.id); return; }
    if (e.target.closest('[data-open-transfer]')) return transferForm();
    if (e.target.closest('[data-make-backup]')) { snapshotNow('Sauvegarde manuelle', false); render(); return; }
    if (e.target.closest('[data-restore-backup]')) { const id = e.target.closest('[data-restore-backup]').dataset.restoreBackup; if (confirm('Restaurer cette sauvegarde ? Ton état actuel sera lui aussi sauvegardé avant.')) { if (restoreSnapshot(id)) { alert('Sauvegarde restaurée. La page va se recharger.'); location.reload(); } } return; }
    if (e.target.closest('[data-cat-detail]')) return categoryDetail(e.target.closest('[data-cat-detail]').dataset.catDetail);
    if (e.target.closest('[data-whatif-remove]')) return whatIfRemoveSheet(e.target.closest('[data-whatif-remove]').dataset.whatifRemove);
    const back = e.target.closest('[data-back-to-tx]'); if (back) return txForm(back.dataset.backToTx, back.dataset.index);

    const dy = e.target.closest('[data-day]'); if (dy) return dayDetails(+dy.dataset.day);
    const et = e.target.closest('[data-edit-tx]'); if (et) return txForm(et.dataset.editTx, et.dataset.index);
    const eb = e.target.closest('[data-edit-birthday]'); if (eb) return birthdayForm(eb.dataset.editBirthday);
    const eg = e.target.closest('[data-edit-goal]'); if (eg) return goalForm(eg.dataset.editGoal);
    const ep = e.target.closest('[data-edit-pocket]'); if (ep) return pocketForm(ep.dataset.editPocket);
    const ex = e.target.closest('[data-edit-exchange]'); if (ex) return exchangeForm(ex.dataset.editExchange);

    const rf = e.target.closest('[data-range]'); if (rf) { planningRange = +rf.dataset.range; render(); return; }
    const sc = e.target.closest('[data-scenario]'); if (sc) { stratPreviewRate = +sc.dataset.scenario; render(); return; }
    const mt = e.target.closest('[data-metric]'); if (mt) { stratMetric = mt.dataset.metric; render(); return; }
    const pj = e.target.closest('[data-proj]'); if (pj) { stratProjScenario = pj.dataset.proj; render(); return; }
    const xp = e.target.closest('[data-explain]'); if (xp) {
      const texts = {
        bascule: 'Le point de bascule est le moment où le rendement annuel théorique de ton capital devient supérieur ou égal à ce que tu investis toi-même chaque année. À partir de là, ton capital « travaille » autant que toi.',
        accel: 'Le point d’accélération est atteint quand le rendement annuel de ton capital dépasse deux fois tes versements annuels : la croissance vient alors majoritairement du capital, plus de ton effort d’épargne.',
        liberte: 'Le taux de liberté financière compare les revenus théoriques de ton capital à tes dépenses annuelles réelles (calculées depuis Budget Orion). À 100%, ton capital couvrirait à lui seul ton train de vie.'
      };
      return openSheet('Explication', `<div class="insight">${texts[xp.dataset.explain] || ''}</div>`);
    }

    const f = e.target.closest('[data-filter]'); if (f) { txFilter = f.dataset.filter; render(); return; }
    const sh = e.target.closest('[data-shift]'); if (sh) { month += +sh.dataset.shift; if (month < 0) { month = 11; year--; } if (month > 11) { month = 0; year++; } saveBudget(); render(); return; }

    if (e.target.closest('[data-export]')) return exportData();
    if (e.target.closest('[data-import]')) return importData();
    if (e.target.closest('[data-open-recurring]')) {
      const a = (budget.recurringTemplates || []);
      openSheet('Règles de récurrence', `<section class="card list">${a.length ? a.map(t => `<div class="row"><div class="row-main"><b>${esc(t.name)}</b><small>${freqLabel(t)}</small></div><b>${eur(t.amount)}</b></div>`).join('') : '<div class="empty">Aucune règle.</div>'}</section>`);
      return;
    }
    const inf = e.target.closest('[data-info]'); if (inf) return info(inf.dataset.info);
  });

  $('#periodBtn').addEventListener('click', () => openSheet('Choisir la période', `<form class="form" id="periodForm"><label>Mois<select name="month">${ML.map((x, i) => `<option value="${i}" ${i === month ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Année<input name="year" type="number" value="${year}"></label><button class="action">Afficher</button></form>`));
  $('#sheetClose').onclick = closeSheet;
  $('#overlay').onclick = closeSheet;

  document.addEventListener('input', e => {
    if (e.target.id === 'whatifSavingsInput') { $('#whatifSavingsResult').innerHTML = whatIfSavingsText(num(e.target.value)); }
    if (e.target.id === 'stratWhatifSlider') {
      stratWhatIfDelta = num(e.target.value);
      const rate = stratPreviewRate != null ? stratPreviewRate : num(extra.strategy?.rate);
      $('#stratWhatifValue').textContent = eur(stratWhatIfDelta) + ' / mois';
      $('#whatifStratResult').innerHTML = whatIfStrategyBlock(stratWhatIfDelta, strategyCalc(rate));
    }
    if (e.target.id === 'txSearch') { txQuery = e.target.value; renderTransactions(); return; }
    if (e.target.id === 'txName') { const brandHint = document.querySelector('.brand-hint'); const b = brandOf(e.target.value, $('#txForm')?.cat?.value); if (brandHint) { if (b.matched) { brandHint.innerHTML = `<span class="brandmark ${b.cls}">${b.mark}</span> Reconnu : <b>${esc(b.label)}</b>`; brandHint.style.display = ''; } else brandHint.style.display = 'none'; } }
  });

  document.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (e.target.id === 'txForm') return saveTx(fd);
    if (e.target.id === 'emojiFreeForm') { setExpenseEmoji(fd.get('etype'), fd.get('eidx'), (fd.get('emoji') || '').trim()); return; }
    if (e.target.id === 'reportForm') { reportExpenseTo(fd.get('idx'), fd.get('date')); return; }
    if (e.target.id === 'strategyForm') {
      extra.strategy = {
        capital: Math.max(0, num(fd.get('capital'))),
        monthly: Math.max(0, num(fd.get('monthly'))),
        rate: Math.max(0, num(fd.get('rate'))),
        horizon: Math.max(5, Math.min(50, num(fd.get('horizon')) || 20)),
        scenarioRates: {
          prudent: Math.max(0, num(fd.get('rPrudent')) || 5),
          central: Math.max(0, num(fd.get('rCentral')) || 7),
          dynamique: Math.max(0, num(fd.get('rDynamique')) || 10)
        }
      };
      stratPreviewRate = null; saveExtra(); closeSheet(); page = 'strategy'; render(); return;
    }
    if (e.target.id === 'birthdayForm') { const i = fd.get('idx'); const o = { name: fd.get('name').trim(), birthDate: fd.get('birthDate'), budget: num(fd.get('budget')), reminder: num(fd.get('reminder')), note: fd.get('note') }; i === '' ? extra.birthdays.push(o) : extra.birthdays[+i] = o; saveExtra(); closeSheet(); render(); return; }
    if (e.target.id === 'goalForm') {
      const id = fd.get('itemId');
      const existing = id ? goals.find(x => x.id === id) : null;
      const o = { id: id || uid('g'), n: fd.get('name').trim(), e: fd.get('emoji') || '🎯', target: num(fd.get('target')), current: num(fd.get('current')), targetDate: fd.get('targetDate') || '', createdAt: existing?.createdAt || today() };
      if (existing) Object.assign(existing, o); else goals.push(o);
      saveGoals(); closeSheet(); render(); return;
    }
    if (e.target.id === 'pocketForm') {
      const id = fd.get('itemId'); const p = extra.pockets.find(x => x.id === id); if (!p) return;
      const wantsSecurity = fd.get('security') === 'on';
      if (wantsSecurity) extra.pockets.forEach(x => { x.security = x.id === id; }); else p.security = false;
      p.name = fd.get('name').trim(); p.emoji = fd.get('emoji') || '💶'; p.balance = num(fd.get('balance')); p.monthlyTarget = num(fd.get('monthlyTarget'));
      saveExtra(); closeSheet(); render(); return;
    }
    if (e.target.id === 'transferForm') {
      const from = extra.pockets.find(p => p.id === fd.get('from')); const to = extra.pockets.find(p => p.id === fd.get('to')); const amount = num(fd.get('amount'));
      if (from && to && from !== to && amount > 0) { from.balance = num(from.balance) - amount; to.balance = num(to.balance) + amount; saveExtra(); }
      closeSheet(); render(); return;
    }
    if (e.target.id === 'monthlySavingForm') {
      const m = monthObj(); const amount = Math.max(0, num(fd.get('amount')));
      const pocketId = fd.get('pocket');
      m.savings = { amount, paid: fd.get('paid') === 'on', date: fd.get('date') || '' };
      if (pocketId) { const p = extra.pockets.find(x => x.id === pocketId); if (p) { p.balance = num(p.balance) + amount; saveExtra(); } }
      saveBudget(); closeSheet(); render(); return;
    }
    if (e.target.id === 'exchangeForm') { const i = fd.get('idx'); const o = { name: fd.get('name').trim(), amount: num(fd.get('amount')), note: fd.get('note'), done: fd.get('done') === 'on' }; i === '' ? extra.exchanges.push(o) : extra.exchanges[+i] = o; saveExtra(); closeSheet(); render(); return; }
    if (e.target.id === 'periodForm') { month = +fd.get('month'); year = +fd.get('year'); saveBudget(); closeSheet(); render(); return; }
    if (e.target.id === 'importForm') {
      const f = fd.get('file'); if (!f || !f.size) return;
      const text = await f.text();
      const obj = safeParse(text, null);
      if (!isValidBackupPayload(obj)) { alert('Fichier invalide : import annulé, aucune donnée n’a été modifiée.'); return; }
      snapshotNow('Avant import', true);
      if (obj.budget) budget = runMigrations(obj.budget);
      if (obj.goals) goals = obj.goals;
      if (obj.extra) extra = { ...loadExtra(), ...obj.extra };
      saveBudget(); saveGoals(); saveExtra();
      closeSheet(); render();
      alert('Import terminé.');
      return;
    }
  });

  document.addEventListener('click', e => {
    if (e.target.closest('[data-delete-tx]')) return deleteTx();
    if (e.target.closest('[data-delete-birthday]')) { const i = +new FormData($('#birthdayForm')).get('idx'); if (confirm('Supprimer cet anniversaire ?')) { extra.birthdays.splice(i, 1); saveExtra(); closeSheet(); render(); } return; }
    if (e.target.closest('[data-delete-goal]')) { const id = new FormData($('#goalForm')).get('itemId'); if (confirm('Supprimer cet objectif ?')) { goals = goals.filter(g => g.id !== id); saveGoals(); closeSheet(); render(); } return; }
    if (e.target.closest('[data-delete-pocket]')) { const id = new FormData($('#pocketForm')).get('itemId'); const p = extra.pockets.find(x => x.id === id); if (p && confirm(`Supprimer la poche « ${p.name} » ? Son solde (${eur(p.balance)}) sera transféré vers la première poche restante.`)) { extra.pockets = extra.pockets.filter(x => x.id !== id); if (extra.pockets.length) extra.pockets[0].balance = num(extra.pockets[0].balance) + num(p.balance); saveExtra(); closeSheet(); render(); } return; }
    if (e.target.closest('[data-delete-exchange]')) { const i = +new FormData($('#exchangeForm')).get('idx'); if (confirm('Supprimer cet échange ?')) { extra.exchanges.splice(i, 1); saveExtra(); closeSheet(); render(); } return; }
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'mSel') { month = +e.target.value; saveBudget(); render(); }
    if (e.target.id === 'ySel') { year = +e.target.value; saveBudget(); render(); }  });

  // Swipe tactile léger sur une ligne de dépense (raccourci ; toutes les actions
  // restent accessibles via la fiche). Gauche = payer/annuler, droite = reporter.
  let _swX = null, _swY = null, _swEl = null;
  document.addEventListener('touchstart', e => { const row = e.target.closest && e.target.closest('.exp-row[data-swipe]'); if (!row) { _swEl = null; return; } const t = e.touches[0]; _swX = t.clientX; _swY = t.clientY; _swEl = row; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (_swEl == null || _swX == null) return;
    const t = e.changedTouches[0]; const dx = t.clientX - _swX, dy = t.clientY - _swY;
    const row = _swEl; _swEl = null; _swX = null;
    if (Math.abs(dx) < 55 || Math.abs(dy) > 40) return; // pas un swipe horizontal net
    const idx = row.dataset.swipe; const item = monthObj().expenses[+idx]; if (!item) return;
    if (dx < 0) { // gauche → payer / dépayer
      const iidx = +idx; item.paid = !item.paid; item.paidDate = item.paid ? today() : ''; const wp = item.paid; saveBudget(); render();
      toast(wp ? '✓ Marqué payé' : 'Repassé en prévu', () => { const it = monthObj().expenses[iidx]; if (it) { it.paid = !it.paid; it.paidDate = it.paid ? today() : ''; saveBudget(); render(); } });
    } else if (!item.paid) { reportSheet(idx); } // droite → reporter
  }, { passive: true });

  window.addEventListener('error', e => console.error('Budget Orion', e.error || e.message));

  render();
})();
