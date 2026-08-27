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
    e.events = Array.isArray(e.events) ? e.events : [];
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
    // Rattrapage d'épargne (temporaire, séparé de l'engagement) — additif, non destructif.
    e.savingsCatchup = (e.savingsCatchup && typeof e.savingsCatchup === 'object') ? e.savingsCatchup : null;
    return e;
  }

  function loadGoals() {
    let g = safeParse(localStorage.getItem(KEY_GOALS), []);
    if (!Array.isArray(g)) g = [];
    g.forEach(x => {
      if (!x.id) x.id = uid('g');
      // Champs additifs (non destructifs) — anciens objectifs restent lisibles.
      if (x.primary == null) x.primary = false;
      if (x.priority == null) x.priority = 'mid';
      if (x.archived == null) x.archived = false;
      if (x.linkedPocketId === undefined) x.linkedPocketId = '';
      if (x.contribution === undefined) x.contribution = 0;
      if (x.cat === undefined) x.cat = '';
      if (x.color === undefined) x.color = '';
    });
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
  let glView = 'list';       // 'list' | 'table'
  let glSort = 'progress';   // progress | priority | date | amount
  let glSimContrib = null;   // contribution simulée dans le détail
  let svYear = null;            // année affichée dans Épargne
  let svChartMode = 'month';    // 'month' | 'cumul'
  let anPeriod = 'month';   // month | 3m | 6m | year | 12m | all
  let anYear = null;        // année civile sélectionnée pour la vue "Année"
  let anHidden = {};        // séries masquées dans le graphique
  let anTip = null;         // index du point survolé/touché
  let planView = 'day';      // 'day' | 'week' | 'month'
  let planDay = null;        // jour sélectionné dans le mois affiché
  let planFilter = 'all';    // all | expense | income | installment | birthday
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
    const goal = primaryGoal();
    const gp = goal && num(goal.target) ? Math.min(100, Math.round((glCurrent(goal) / num(goal.target)) * 100)) : 0;
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
          <div class="ss">${eur(glCurrent(goal))} / ${eur(goal.target)}</div><div class="mini" style="background:#dbe6f7"><span style="width:${gp}%;background:#3f7fe0"></span></div>
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

  /* ---- Planification : helpers dédiés (source unique — lecture des mêmes données) ---- */
  function planMonthObj(k) { return k === key() ? monthObj() : projectMonth(k); }
  function planItemsForISO(ds) {
    const k = ds.slice(0, 7), cur = k === key(), mo = planMonthObj(k), out = [];
    (mo.income || []).forEach((r, i) => { const d = r.dueDate || `${k}-01`; if (d === ds) out.push({ kind: 'income', color: 'green', name: r.name, cat: r.cat, amount: num(r.amount), dueDate: ds, sign: '+', idx: cur ? i : -1, paid: r.paid || isAutoIncome(r), ref: r }); });
    (mo.expenses || []).forEach((r, i) => { if (r.dueDate === ds) { const tpl = templateOf(r); const inst = tpl && num(tpl.installments) > 0; out.push({ kind: 'expense', color: inst ? 'blue' : 'red', name: r.name, cat: r.cat, amount: num(r.amount), dueDate: ds, sign: '-', idx: cur ? i : -1, paid: !!r.paid, install: inst, ref: r }); } });
    extra.birthdays.forEach((b, i) => { const n = birthdayNext(b); if (n && n.date === ds) out.push({ kind: 'birthday', color: 'pink', name: b.name, cat: 'autres', amount: num(b.budget), dueDate: ds, sign: '', bidx: i, age: n.age }); });
    (extra.events || []).forEach((ev, i) => { if (ev.date === ds) out.push({ kind: 'event', color: 'pink', name: ev.name, cat: 'autres', amount: num(ev.amount), dueDate: ds, sign: ev.amount ? '-' : '', eidx: i, note: ev.note }); });
    let list = out;
    if (planFilter === 'expense') list = out.filter(x => x.kind === 'expense');
    else if (planFilter === 'income') list = out.filter(x => x.kind === 'income');
    else if (planFilter === 'installment') list = out.filter(x => x.install);
    else if (planFilter === 'birthday') list = out.filter(x => x.kind === 'birthday' || x.kind === 'event');
    // tri : non payé d'abord ; puis retard→proche pour les dépenses
    return list.sort((a, b) => {
      const ap = a.paid ? 1 : 0, bp = b.paid ? 1 : 0; if (ap !== bp) return ap - bp;
      const rank = { income: 0, expense: 1, birthday: 2, event: 3 };
      return (rank[a.kind] - rank[b.kind]);
    });
  }
  function planColorsForISO(ds) {
    const set = []; planItemsForISO(ds).forEach(x => { if (!set.includes(x.color)) set.push(x.color); });
    const order = ['green', 'red', 'blue', 'pink', 'violet']; return order.filter(c => set.includes(c)).slice(0, 4);
  }
  function planRow(ev) {
    const id = (ev.kind === 'expense' || ev.kind === 'income') ? identityOf(ev.ref || { name: ev.name, cat: ev.cat }) : { mark: ev.kind === 'birthday' ? '🎂' : '📌', cls: 'brand-generic' };
    let badge, bcls;
    if (ev.kind === 'expense') { const di = dueInfo(ev.ref); badge = ev.paid ? 'Payée' : di.label; bcls = ev.paid ? 'green' : (ev.install ? 'blue' : (expColor(ev.ref) === 'red' ? 'red' : expColor(ev.ref) === 'orange' ? 'orange' : 'green')); }
    else if (ev.kind === 'income') { badge = ev.paid ? 'Reçu' : 'Attendu'; bcls = 'green'; }
    else if (ev.kind === 'birthday') { badge = `Anniversaire${ev.age ? ' · ' + ev.age + ' ans' : ''}`; bcls = 'pink'; }
    else { badge = 'Événement'; bcls = 'pink'; }
    const tpl = ev.ref ? templateOf(ev.ref) : null;
    const sub = ev.kind === 'expense' ? `${CATS[ev.cat] || 'Autres'} · ${freqLabel(tpl)}` : ev.kind === 'income' ? 'Revenu' : (ev.note ? esc(ev.note) : 'Événement personnel');
    const attr = ev.kind === 'expense' && ev.idx >= 0 ? `data-edit-tx="expense" data-index="${ev.idx}"`
      : ev.kind === 'income' && ev.idx >= 0 ? `data-edit-tx="income" data-index="${ev.idx}"`
      : ev.bidx != null ? `data-edit-birthday="${ev.bidx}"`
      : ev.eidx != null ? `data-edit-event="${ev.eidx}"` : '';
    return `<div class="pl-row ${ev.paid ? 'paid' : ''} ${attr ? 'clickable' : ''}" ${attr}>
      <div class="pl-railcol"><span class="pl-dot dot-${ev.color}"></span></div>
      <div class="brandmark pl-logo ${id.cls}">${id.mark}</div>
      <div class="pl-main"><b>${esc(ev.name || 'Sans libellé')}</b><small>${sub}</small><span class="pl-badge b-${bcls}">${badge}</span></div>
      <div class="pl-amt when-${ev.color}">${ev.sign}${eur(ev.amount)}</div>
      <span class="pl-chev">›</span>
    </div>`;
  }
  function planSummary() {
    const mo = monthObj(), t = totals(mo);
    const instMonthly = installmentItems().reduce((s, i) => s + num(i.amount), 0);
    const instCount = installmentItems().length;
    const engagement = (extra.pockets || []).reduce((s, p) => s + num(p.monthlyTarget), 0);
    const incCount = (mo.income || []).length, expCount = (mo.expenses || []).length;
    return { rev: t.tin, dep: t.tex, ech: instMonthly, epg: engagement, incCount, expCount, instCount };
  }
  function planStrip(centerDate) {
    const dow = (centerDate.getDay() + 6) % 7;
    const monday = new Date(centerDate); monday.setDate(centerDate.getDate() - dow);
    const todayD = new Date(); const cells = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const ds = iso(d.getFullYear(), d.getMonth(), d.getDate());
      const inMonth = d.getMonth() === month && d.getFullYear() === year;
      const sel = d.getDate() === planDay && inMonth;
      const isToday = d.getFullYear() === todayD.getFullYear() && d.getMonth() === todayD.getMonth() && d.getDate() === todayD.getDate();
      const dots = planColorsForISO(ds);
      cells.push(`<button class="pl-day ${sel ? 'sel' : ''} ${isToday ? 'today' : ''} ${inMonth ? '' : 'out'}" data-plan-cursor="${ds}">
        <span class="wd">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][i]}</span>
        <span class="dn">${d.getDate()}</span>
        <span class="pl-daydots">${dots.map(c => `<i class="i-${c}"></i>`).join('')}</span>
      </button>`);
    }
    return `<div class="pl-strip-wrap"><button class="pl-nav" data-plan-shift="-1">‹</button><div class="pl-strip">${cells.join('')}</div><button class="pl-nav" data-plan-shift="1">›</button></div>`;
  }
  function planInsights() {
    const out = [];
    const soon = projectRange(5).filter(r => !r.isBirthday);
    if (soon.length >= 3) out.push({ icon: '📌', text: `${soon.length} prélèvements arrivent dans les 5 prochains jours (${eur(soon.reduce((s, r) => s + num(r.amount), 0))}).` });
    const byDay = {}; projectRange(31).filter(r => !r.isBirthday).forEach(r => { byDay[r.dueDate] = (byDay[r.dueDate] || 0) + 1; });
    const conc = Object.entries(byDay).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0];
    if (conc) out.push({ icon: '📅', text: `Le ${dateLabel(conc[0])} concentre ${conc[1]} prélèvements.` });
    try { installmentItems().forEach(i => { if (i.remainingCount === 0 && i.currentIndex === num(i.installments) - 1) out.push({ icon: '✅', text: `Ton échéancier « ${esc(i.name)} » se termine ce mois-ci.` }); }); } catch (_) {}
    return out.slice(0, 2);
  }
  function planEchCards() {
    const inst = installmentItems();
    if (!inst.length) return '';
    return `<section class="card"><div class="sec-head"><h2>Échéanciers en cours</h2><button class="link" data-go="installments">Voir tout ›</button></div>
      <div class="pl-inst">${inst.map(i => {
      const pct = Math.round((i.paidCount / num(i.installments)) * 100);
      const nextK = monthKeyAdd(key(), 1); const nx = `${nextK}-${p2(Math.min(num(i.dueDay) || 1, 28))}`;
      const br = brandOf(i.name, i.cat);
      return `<div class="pl-instcard"><div class="top"><div class="brandmark ${br.cls}">${br.mark}</div><div style="min-width:0"><div class="nm">${esc(i.name)}</div><div class="mo">${eur(i.amount)} / mois</div></div></div>
        <div class="pl-instbar"><span style="width:${pct}%"></span></div>
        <div class="pl-instfoot"><span>${i.paidCount} / ${i.installments}</span><span>${pct}%</span></div>
        <div class="pl-instnext">Prochaine : ${i.remainingCount > 0 ? dateLabel(nx) : '— terminé'}</div></div>`;
    }).join('')}</div></section>`;
  }

  function renderPlanning() {
    setTitle('Planification');
    const last = lastDayOfMonth(year, month);
    const todayD = new Date();
    if (planDay == null || planDay > last) planDay = (todayD.getFullYear() === year && todayD.getMonth() === month) ? todayD.getDate() : 1;
    const s = planSummary();

    const toolbar = `<div class="pl-toolbar">
      <div class="pl-search"><span>⌕</span><span>${ML[month]} ${year}</span></div>
      <button class="pl-add" data-add-event><span>＋</span><b>Ajouter</b></button>
    </div>`;
    const summary = `<section class="card"><div class="pl-sum">
      <div class="m rev"><small>Revenus</small><b>${eur(s.rev)}</b><span class="u">${s.incCount} op.</span></div>
      <div class="m dep"><small>Dépenses</small><b>${eur(s.dep)}</b><span class="u">${s.expCount} op.</span></div>
      <div class="m ech"><small>Échéanciers</small><b>${eur(s.ech)}</b><span class="u">${s.instCount} op.</span></div>
      <div class="m epg"><small>Épargne prévue</small><b>${eur(s.epg)}</b><span class="u">objectif</span></div>
    </div></section>`;
    const seg = `<div class="pl-seg">
      <button class="${planView === 'day' ? 'active' : ''}" data-plan-view="day">Jour</button>
      <button class="${planView === 'week' ? 'active' : ''}" data-plan-view="week">Semaine</button>
      <button class="${planView === 'month' ? 'active' : ''}" data-plan-view="month">Mois</button>
    </div>`;
    const chip = (id, label, color) => `<button class="pl-chip ${planFilter === id ? 'active' : ''}" data-plan-filter="${id}">${color ? `<span class="ic i-${color}"></span>` : ''}${label}</button>`;
    const chips = `<div class="pl-chips">${chip('all', 'Tout')}${chip('expense', 'Dépenses', 'red')}${chip('income', 'Revenus', 'green')}${chip('installment', 'Échéanciers', 'blue')}${chip('birthday', 'Anniversaires', 'pink')}</div>`;

    let body = '';
    if (planView === 'day') {
      const center = new Date(year, month, planDay);
      const ds = iso(year, month, planDay);
      const items = planItemsForISO(ds);
      const shown = items.slice(0, 6);
      const dayLabel = center.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      body = `${planStrip(center)}
        <section class="card">
          <div class="pl-tl-head"><h2>${dayLabel}</h2><button class="pl-today-btn" data-plan-today>◎ Aujourd’hui</button></div>
          ${shown.length ? shown.map(planRow).join('') : '<div class="empty">Aucun événement ce jour.<br><button class="link" data-add-event style="margin-top:8px">＋ Ajouter un événement</button></div>'}
          ${items.length > 6 ? `<button class="link pl-voir" data-plan-day-detail="${planDay}">Voir les ${items.length} opérations ›</button>` : ''}
        </section>
        ${planEchCards()}`;
    } else if (planView === 'week') {
      const center = new Date(year, month, planDay);
      const dow = (center.getDay() + 6) % 7; const monday = new Date(center); monday.setDate(center.getDate() - dow);
      let din = 0, dout = 0, groups = '';
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday); d.setDate(monday.getDate() + i);
        const ds = iso(d.getFullYear(), d.getMonth(), d.getDate());
        const items = planItemsForISO(ds);
        items.forEach(x => { if (x.sign === '+') din += x.amount; else if (x.sign === '-') dout += x.amount; });
        if (items.length) groups += `<div class="pl-wday"><div class="pl-wday-h">${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</div>${items.map(planRow).join('')}</div>`;
      }
      const wkLabel = `${monday.getDate()} – ${new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6).getDate()} ${ML[new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6).getMonth()].toLowerCase()}`;
      body = `${planStrip(center)}
        <section class="card"><div class="pl-weeksum">
          <div class="w in"><small>Entrées</small><b>+${eur(din)}</b></div>
          <div class="w out"><small>Sorties</small><b>-${eur(dout)}</b></div>
          <div class="w net"><small>Net prévu</small><b>${din - dout >= 0 ? '+' : ''}${eur(din - dout)}</b></div>
        </div></section>
        <section class="card"><div class="pl-tl-head"><h2 style="text-transform:none">Semaine du ${wkLabel}</h2><button class="pl-today-btn" data-plan-today>◎ Aujourd’hui</button></div>
          ${groups || '<div class="empty">Aucun événement cette semaine.</div>'}</section>`;
    } else {
      // MOIS
      const first = (new Date(year, month, 1).getDay() + 6) % 7;
      let cells = '';
      const prevLast = lastDayOfMonth(month === 0 ? year - 1 : year, (month + 11) % 12);
      for (let i = 0; i < first; i++) cells += `<div class="pl-cell other"><span class="dn">${prevLast - first + i + 1}</span><span class="pl-cd"></span></div>`;
      for (let d = 1; d <= last; d++) {
        const ds = iso(year, month, d);
        const dots = planColorsForISO(ds);
        const isToday = todayD.getFullYear() === year && todayD.getMonth() === month && todayD.getDate() === d;
        cells += `<div class="pl-cell clickable ${isToday ? 'today' : ''}" data-day="${d}"><span class="dn">${d}</span><span class="pl-cd">${dots.map(c => `<i class="i-${c}"></i>`).join('')}</span></div>`;
      }
      const upcoming = projectRange(31).filter(r => !r.isBirthday && !r.paid).slice(0, 6);
      body = `<section class="card pl-cal">
        <div class="cal-head"><button data-plan-shift="-1">‹</button><b>${ML[month]} ${year}</b><button data-plan-shift="1">›</button></div>
        <div class="pl-grid">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(x => `<span class="wk">${x}</span>`).join('')}${cells}</div>
        <div class="pl-legend"><span><i class="i-green"></i>Revenus</span><span><i class="i-red"></i>Dépenses</span><span><i class="i-blue"></i>Échéanciers</span><span><i class="i-pink"></i>Anniversaires</span></div>
      </section>
      ${upcoming.length ? `<section class="card"><div class="sec-head"><h2>À venir ce mois-ci</h2></div>
        <div class="pl-up">${upcoming.map(r => { const br = identityOf(r); return `<div class="pl-upcard clickable" data-edit-tx="expense" data-index="${(monthObj().expenses || []).indexOf(r)}"><div class="brandmark ${br.cls}">${br.mark}</div><b>${esc(r.name)}</b><small>${dueInfo(r).label}</small><span class="a">-${eur(r.amount)}</span></div>`; }).join('')}</div></section>` : ''}
      ${planEchCards()}`;
    }

    const ins = planInsights();
    const insBlock = ins.length ? `<section class="card">${ins.map(i => `<div class="pl-ins"><span class="ic">${i.icon}</span><span>${i.text}</span></div>`).join('')}</section>` : '';

    // Prévisions (horizon financier) — distinct de la navigation calendrier
    const rangeItems = projectRange(planningRange);
    const heavy = heavyMonthsAhead();
    const annualMonthly = annualItems().reduce((s, a) => s + a.monthly, 0);
    const prevBlock = `<section class="card"><div class="sec-head"><h2>Prévisions</h2></div>
      <div class="pl-range">${[[30,'30 j'],[90,'90 j'],[182,'6 mois'],[365,'12 mois']].map(([d,l]) => `<button data-range="${d}" class="${planningRange===d?'active':''}">${l}</button>`).join('')}</div>
      <div class="metric-grid" style="margin-top:10px"><div class="metric"><small>Total prévu</small><b>${eur(rangeItems.reduce((s,r)=>s+num(r.amount),0))}</b></div><div class="metric"><small>Événements</small><b>${rangeItems.length}</b></div></div>
      ${heavy.length ? `<div class="insight" style="margin-top:10px" data-plan-goto="${heavy[0].key}"><b>${heavy[0].label} sera un mois chargé</b> : ${eur(heavy[0].planned)} prévus · moyenne ${eur(heavy[0].avg)} (+${heavy[0].pct}%).</div>` : ''}
      ${annualMonthly > 0 ? `<div class="insight annual-box" style="margin-top:10px">Pour absorber tes dépenses non mensuelles → prévoir <b>${eur(annualMonthly)}/mois</b>.</div>` : ''}
    </section>`;

    $('#view').innerHTML = `<div class="stack pl-page">
      ${toolbar}${summary}${seg}${chips}${insBlock}${body}${prevBlock}
    </div>`;
  }

  /* =====================================================================
     MOTEUR D'ANALYSE CENTRALISÉ — lecture seule des vraies données.
     Réel = payé / reçu / épargne validée. Prévu = montants planifiés.
     Ne JAMAIS inventer de mois : seuls les mois réellement présents comptent.
     ===================================================================== */
  function anFirstKey() {
    const ks = Object.keys(budget.monthlyData).filter(k => { const m = budget.monthlyData[k]; return (m.income && m.income.length) || (m.expenses && m.expenses.length) || (m.savings && m.savings.paid); }).sort();
    return ks[0] || key();
  }
  function anMonthAgg(k) {
    const m = budget.monthlyData[k];
    if (!m) return { key: k, has: false, income: 0, expense: 0, saved: 0, realizedSav: 0, incomePlan: 0, expensePlan: 0, cats: {}, fixed: 0 };
    const t = totals(m);
    const realizedSav = (m.savings && m.savings.paid) ? num(m.savings.amount) : 0;
    const fixed = (m.expenses || []).filter(r => r.paid && (r.recurring || r.templateId)).reduce((s, r) => s + num(r.amount), 0);
    const has = !!((m.income && m.income.length) || (m.expenses && m.expenses.length) || realizedSav > 0);
    return { key: k, has, income: t.pin, expense: t.pex, saved: t.pin - t.pex, realizedSav, incomePlan: t.tin, expensePlan: t.tex, cats: catTotals(m, true), fixed };
  }
  function anRangeKeys(period) {
    const selKey = key(); let start, end = selKey;
    if (period === 'month') start = selKey;
    else if (period === '3m') start = monthKeyAdd(selKey, -2);
    else if (period === '6m') start = monthKeyAdd(selKey, -5);
    else if (period === '12m') start = monthKeyAdd(selKey, -11);
    else if (period === 'year') { const y = anYear || year; start = `${y}-01`; end = (y === year) ? selKey : `${y}-12`; }
    else { start = anFirstKey(); end = selKey; } // all
    const keys = []; let c = start, g = 0; while (c <= end && g < 600) { keys.push(c); c = monthKeyAdd(c, 1); g++; }
    return { keys, start, end };
  }
  function anPrevCats(prevKeys) { const o = {}; prevKeys.map(anMonthAgg).filter(x => x.has).forEach(x => { for (const c in x.cats) o[c] = (o[c] || 0) + x.cats[c]; }); return o; }
  function analysisEngine(period = anPeriod) {
    const { keys, start, end } = anRangeKeys(period);
    const months = keys.map(anMonthAgg);
    const avail = months.filter(x => x.has);
    const n = avail.length || 1;
    const S = f => avail.reduce((s, x) => s + f(x), 0);
    const incomeReal = S(x => x.income), expenseReal = S(x => x.expense), saved = incomeReal - expenseReal, realizedSav = S(x => x.realizedSav);
    const incomePlan = S(x => x.incomePlan), expensePlan = S(x => x.expensePlan);
    const retention = incomeReal > 0 ? (saved / incomeReal) * 100 : 0;
    const cats = {}; avail.forEach(x => { for (const c in x.cats) cats[c] = (cats[c] || 0) + x.cats[c]; });
    const averages = { income: incomeReal / n, expense: expenseReal / n, saved: saved / n };
    const fixed = S(x => x.fixed), fixedAvg = fixed / n, fixedRate = incomeReal > 0 ? (fixed / incomeReal) * 100 : 0;
    // Période précédente comparable (même longueur, juste avant)
    const len = keys.length, prevEnd = monthKeyAdd(start, -1), prevKeys = [];
    let c = monthKeyAdd(prevEnd, -(len - 1)), g = 0; while (c <= prevEnd && g < 600) { prevKeys.push(c); c = monthKeyAdd(c, 1); g++; }
    const prevAvail = prevKeys.map(anMonthAgg).filter(x => x.has);
    const pS = f => prevAvail.reduce((s, x) => s + f(x), 0);
    const prevIncome = pS(x => x.income), prevExpense = pS(x => x.expense), prevSaved = prevIncome - prevExpense;
    const prev = { income: prevIncome, expense: prevExpense, saved: prevSaved, retention: prevIncome > 0 ? (prevSaved / prevIncome) * 100 : 0, has: prevAvail.length > 0, cats: anPrevCats(prevKeys) };
    // Meilleur / pire mois
    let best = null, worst = null, bestRate = null;
    avail.forEach(x => { if (best == null || x.saved > best.saved) best = x; if (worst == null || x.expense > worst.expense) worst = x; const r = x.income > 0 ? x.saved / x.income : -1; if (bestRate == null || r > (bestRate.income > 0 ? bestRate.saved / bestRate.income : -1)) bestRate = x; });
    // Non mensuelles (trim/sem/annuelles) + échéanciers
    const nonMonthly = (budget.recurringTemplates || []).filter(t => t.kind === 'expense' && num(t.installments) === 0 && t.freq !== 'once' && Math.max(1, num(t.interval) || 1) > 1);
    const nonMonthlyYear = nonMonthly.reduce((s, t) => s + (num(t.amount) * 12) / Math.max(1, num(t.interval) || 1), 0);
    const subsMonthly = avail.length ? (cats.abonnements || 0) / n : 0;
    return { period, keys, start, end, months, avail, n: avail.length, incomeReal, expenseReal, saved, realizedSav, incomePlan, expensePlan, retention, cats, averages, fixed, fixedAvg, fixedRate, prev, best, worst, bestRate, firstKey: anFirstKey(), nonMonthlyYear, subsMonthly };
  }
  function anDelta(cur, prev, lowerIsBetter) {
    if (!isFinite(prev) || prev === 0) return null;
    const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
    if (pct === 0) return { pct: 0, better: null, arrow: '→', cls: 'muted' };
    const better = lowerIsBetter ? cur < prev : cur > prev;
    return { pct, better, arrow: cur > prev ? '↑' : '↓', cls: better ? 'pos' : 'neg' };
  }
  function anMonthLabel(k, short) { const [y, m] = k.split('-').map(Number); return short ? ML[m - 1].slice(0, 3) : `${ML[m - 1]} ${y}`; }

  /* ---- Graphique SVG (lignes revenus/dépenses/conservé), responsive & tactile ---- */
  function anLineChart(points) {
    // points: [{label, income, expense, saved, key}]
    const W = 320, H = 168, padL = 30, padR = 10, padT = 12, padB = 22;
    const iw = W - padL - padR, ih = H - padT - padB;
    const series = [['income', 'an-line-income', 'var(--an-green)'], ['expense', 'an-line-expense', 'var(--an-red)'], ['saved', 'an-line-saved', 'var(--an-blue)']].filter(s => !anHidden[s[0]]);
    let maxV = 1, minV = 0;
    points.forEach(p => { ['income', 'expense', 'saved'].forEach(k => { if (!anHidden[k]) { maxV = Math.max(maxV, p[k]); minV = Math.min(minV, p[k]); } }); });
    const niceMax = Math.ceil(maxV / 500) * 500 || 500; const lo = Math.min(0, minV);
    const X = i => padL + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const Y = v => padT + ih - ((v - lo) / (niceMax - lo)) * ih;
    const path = k => points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join(' ');
    // grille + libellés Y
    let grid = '', ylab = '';
    for (let g = 0; g <= 3; g++) { const v = lo + (niceMax - lo) * g / 3; const yy = Y(v); grid += `<line class="an-grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`; ylab += `<text class="an-axis" x="2" y="${(yy + 3).toFixed(1)}">${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : Math.round(v)}</text>`; }
    // libellés X (max ~7)
    const step = Math.ceil(points.length / 7);
    const xlab = points.map((p, i) => (i % step === 0 || i === points.length - 1) ? `<text class="an-axis" text-anchor="middle" x="${X(i).toFixed(1)}" y="${H - 6}">${p.label}</text>` : '').join('');
    const areas = series.map(([k]) => { const col = k === 'income' ? 'var(--an-green)' : k === 'expense' ? 'var(--an-red)' : 'var(--an-blue)'; return `<path class="an-area" fill="${col}" d="${path(k)} L${X(points.length - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L${X(0).toFixed(1)} ${(padT + ih).toFixed(1)} Z"/>`; }).join('');
    const lines = series.map(([k, cls]) => `<path class="${cls}" d="${path(k)}"/>`).join('');
    const dots = series.map(([k]) => points.map((p, i) => `<circle class="an-dot" cx="${X(i).toFixed(1)}" cy="${Y(p[k]).toFixed(1)}" r="3" fill="${k === 'income' ? 'var(--an-green)' : k === 'expense' ? 'var(--an-red)' : 'var(--an-blue)'}"/>`).join('')).join('');
    const hits = points.map((p, i) => `<rect class="an-hit" data-an-pt="${i}" x="${(X(i) - iw / (points.length * 2 || 1)).toFixed(1)}" y="${padT}" width="${(iw / (points.length || 1)).toFixed(1)}" height="${ih}"/>`).join('');
    let tip = '';
    if (anTip != null && points[anTip]) {
      const p = points[anTip]; const leftPct = (X(anTip) / W) * 100;
      tip = `<div class="an-tip" style="left:${leftPct}%;top:6px">${p.label}${!anHidden.income ? `<br><i style="background:var(--an-green)"></i>Rev. <b>${eur(p.income)}</b>` : ''}${!anHidden.expense ? `<br><i style="background:var(--an-red)"></i>Dép. <b>${eur(p.expense)}</b>` : ''}${!anHidden.saved ? `<br><i style="background:var(--an-blue)"></i>Cons. <b>${eur(p.saved)}</b>` : ''}</div>`;
    }
    return `<div class="an-svg-wrap"><svg class="an-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${grid}${ylab}${areas}${lines}${dots}${xlab}${hits}</svg>${tip}</div>`;
  }

  function anChartPoints(E) {
    // Mois actuel → points hebdomadaires ; sinon un point par mois disponible.
    if (E.period === 'month') {
      const m = monthObj(); const last = lastDayOfMonth(year, month);
      const weeks = [[1, 7], [8, 14], [15, 21], [22, last]];
      return weeks.map((w, i) => {
        let inc = 0, exp = 0;
        (m.income || []).forEach(r => { const d = r.dueDate ? +r.dueDate.slice(-2) : 1; if ((r.paid || isAutoIncome(r)) && d >= w[0] && d <= w[1]) inc += num(r.amount); });
        (m.expenses || []).forEach(r => { const d = r.dueDate ? +r.dueDate.slice(-2) : 1; if (r.paid && d >= w[0] && d <= w[1]) exp += num(r.amount); });
        return { label: 'S' + (i + 1), income: inc, expense: exp, saved: inc - exp, key: key() };
      });
    }
    const pts = E.months.map(x => ({ label: anMonthLabel(x.key, true), income: x.income, expense: x.expense, saved: x.saved, key: x.key, has: x.has }));
    return pts.length ? pts : [{ label: anMonthLabel(key(), true), income: 0, expense: 0, saved: 0, key: key() }];
  }

  function renderAnalysis() {
    setTitle('Analyse');
    const E = analysisEngine(anPeriod);
    const green = 'var(--an-green)', red = 'var(--an-red)', blue = 'var(--an-blue)';

    // En-tête période
    const P = [['month', 'Mois actuel'], ['3m', '3 mois'], ['6m', '6 mois'], ['year', 'Année'], ['12m', '12 mois'], ['all', 'Tout']];
    const periods = `<div class="an-periods">${P.map(([id, l]) => `<button class="an-per ${anPeriod === id ? 'active' : ''}" data-an-period="${id}">${l}</button>`).join('')}</div>`;
    const yearsWithData = [...new Set(Object.keys(budget.monthlyData).map(k => +k.slice(0, 4)))].sort();
    const yNav = (anPeriod === 'year') ? `<div class="an-yearnav"><button data-an-year="-1" ${(anYear || year) <= (yearsWithData[0] || year) ? 'disabled style=opacity:.3' : ''}>‹</button><b>${anYear || year}</b><button data-an-year="1" ${(anYear || year) >= year ? 'disabled style=opacity:.3' : ''}>›</button></div>` : '';

    // Libellé de portée
    let scope;
    if (anPeriod === 'month') scope = `Mois actuel — ${ML[month]} ${year}`;
    else if (anPeriod === 'year') scope = `Année ${anYear || year}` + ((anYear || year) === year ? ` — janv. à ${ML[month].toLowerCase()}` : '');
    else if (anPeriod === 'all') scope = `Depuis le début (${anMonthLabel(E.firstKey)})`;
    else { const lbl = { '3m': '3 derniers mois', '6m': '6 derniers mois', '12m': '12 derniers mois' }[anPeriod]; scope = `${lbl} — ${anMonthLabel(E.keys[0])} à ${anMonthLabel(E.keys[E.keys.length - 1])}`; }

    // Cas zéro donnée
    if (!E.avail.length) {
      $('#view').innerHTML = `<div class="stack an-page"><p class="an-sub">Comprendre pour mieux décider.</p>${periods}${yNav}
        <section class="card"><div class="empty">Pas encore assez de données pour analyser cette période.<br><button class="link" data-page="transactions" style="margin-top:8px">Ajoute tes revenus et dépenses pour commencer ›</button></div></section></div>`;
      return;
    }

    // Deltas (sens financier)
    const dRev = E.prev.has ? anDelta(E.incomeReal, E.prev.income, false) : null;
    const dDep = E.prev.has ? anDelta(E.expenseReal, E.prev.expense, true) : null;
    const dCons = E.prev.has ? anDelta(E.saved, E.prev.saved, false) : null;
    const dRatePts = E.prev.has ? Math.round((E.retention - E.prev.retention) * 10) / 10 : null;
    const dHtml = (d, extra = '') => d ? `<span class="d ${d.cls}">${d.arrow} ${d.pct > 0 ? '+' : ''}${d.pct}%${extra}</span>` : '';

    // Sur 100 € reçus
    const depPct = E.incomeReal ? Math.round((E.expenseReal / E.incomeReal) * 100) : 0;
    const savPct = E.incomeReal ? Math.round((E.realizedSav / E.incomeReal) * 100) : 0;
    const dispoPct = Math.max(0, 100 - depPct - savPct);

    // Situation
    const situ = `<section class="card">
      <div class="an-situ-head"><h2>Ta situation · ${esc(scope)}</h2><span class="i" data-an-help>i</span></div>
      <div class="an-kpis">
        <div class="an-kpi rev"><small>Revenus reçus</small><b>${eur(E.incomeReal)}</b>${dHtml(dRev)}</div>
        <div class="an-kpi dep"><small>Dépenses réelles</small><b>${eur(E.expenseReal)}</b>${dHtml(dDep)}</div>
        <div class="an-kpi cons"><small>Conservé</small><b>${eur(E.saved)}</b>${dHtml(dCons)}</div>
        <div class="an-kpi rate"><small>Taux conservation</small><b>${Math.round(E.retention)}%</b>${dRatePts != null && dRatePts !== 0 ? `<span class="d ${dRatePts > 0 ? 'pos' : 'neg'}">${dRatePts > 0 ? '+' : ''}${dRatePts} pts</span>` : ''}</div>
      </div>
      <div class="an-100"><div class="an-100-bar"><i class="dep" style="width:${depPct}%"></i><i class="sav" style="width:${savPct}%"></i><i class="dispo" style="width:${dispoPct}%"></i></div>
        <div class="an-100-leg"><span><i style="background:var(--an-red)"></i>Dépenses<b>${depPct} €</b></span><span><i style="background:var(--an-blue)"></i>Épargne<b>${savPct} €</b></span><span><i style="background:#cfe9db"></i>Disponible<b>${dispoPct} €</b></span></div>
        <div class="an-sub" style="margin-top:6px">Sur 100 € reçus</div>
      </div></section>`;

    // Graphique
    const pts = anChartPoints(E);
    const legBtn = (k, col, lab) => `<button class="${anHidden[k] ? 'off' : ''}" data-an-toggle="${k}"><i style="background:${col}"></i>${lab}</button>`;
    const chart = `<section class="card">
      <div class="an-chart-head"><h2>Évolution ${anPeriod === 'month' ? 'ce mois' : anPeriod === 'year' ? "sur l'année " + (anYear || year) : 'de tes finances'}</h2></div>
      <div class="an-legend">${legBtn('income', green, 'Revenus')}${legBtn('expense', red, 'Dépenses')}${legBtn('saved', blue, 'Conservé')}</div>
      ${anLineChart(pts)}
      ${E.firstKey.slice(0, 7) > E.keys[0] && anPeriod !== 'month' ? `<div class="an-sub" style="margin-top:6px">Données disponibles depuis ${anMonthLabel(E.firstKey)}.</div>` : ''}
    </section>`;

    // Où part ton argent
    const catKeys = Object.keys(E.cats).sort((a, b) => E.cats[b] - E.cats[a]);
    const top = catKeys.slice(0, 5); const othersVal = catKeys.slice(5).reduce((s, c) => s + E.cats[c], 0);
    const catMax = Math.max(1, ...top.map(c => E.cats[c]), othersVal);
    const totCat = catKeys.reduce((s, c) => s + E.cats[c], 0) || 1;
    const catRow = (c, val, color, clickable) => `<div class="an-cat ${clickable ? 'clickable' : ''}" ${clickable ? `data-an-cat="${c}"` : ''}>
      <span class="dotc" style="background:${color}"></span>
      <div class="cn"><b>${clickable ? (CATS[c] || c) : 'Autres'}</b><div class="track"><span style="width:${Math.round((val / catMax) * 100)}%;background:${color}"></span></div></div>
      <div class="cv"><b>${eur(val)}</b><small>${Math.round((val / totCat) * 100)} %</small></div>${clickable ? '<span class="chev">›</span>' : ''}</div>`;
    const where = `<section class="card"><div class="sec-head"><h2>Où part ton argent ?</h2></div>
      ${top.map(c => catRow(c, E.cats[c], COLORS[c] || '#5f8aa8', true)).join('')}
      ${othersVal > 0 ? catRow('autres_group', othersVal, '#c2ccc6', false) : ''}</section>`;

    // Comparaison période précédente
    const cmp = E.prev.has ? `<section class="card"><div class="sec-head"><h2>Vs période précédente</h2></div>
      <div class="an-cmp">
        <div class="c"><small>Revenus</small><b class="${dRev ? dRev.cls : 'muted'}">${dRev ? (dRev.pct > 0 ? '+' : '') + dRev.pct + '%' : '—'}</b></div>
        <div class="c"><small>Dépenses</small><b class="${dDep ? dDep.cls : 'muted'}">${dDep ? (dDep.pct > 0 ? '+' : '') + dDep.pct + '%' : '—'}</b></div>
        <div class="c"><small>Conservé</small><b class="${dCons ? dCons.cls : 'muted'}">${dCons ? (dCons.pct > 0 ? '+' : '') + dCons.pct + '%' : '—'}</b></div>
        <div class="c"><small>Taux</small><b class="${dRatePts > 0 ? 'pos' : dRatePts < 0 ? 'neg' : 'muted'}">${dRatePts != null ? (dRatePts > 0 ? '+' : '') + dRatePts + ' pts' : '—'}</b></div>
      </div></section>` : '';

    // Cartes marquantes (multi-mois)
    const marks = (E.avail.length >= 2 && E.best && E.worst && E.bestRate) ? `<section class="card"><div class="sec-head"><h2>Ce qui a marqué la période</h2></div>
      <div class="an-marks">
        <div class="an-mark good clickable" data-an-month="${E.best.key}"><small>Meilleur mois</small><b>${anMonthLabel(E.best.key, true)}</b><div class="v">${eur(E.best.saved)} conservés</div></div>
        <div class="an-mark bad clickable" data-an-month="${E.worst.key}"><small>Plus coûteux</small><b>${anMonthLabel(E.worst.key, true)}</b><div class="v">${eur(E.worst.expense)} dépensés</div></div>
        <div class="an-mark blue clickable" data-an-month="${E.bestRate.key}"><small>Meilleur taux</small><b>${anMonthLabel(E.bestRate.key, true)}</b><div class="v">${Math.round(E.bestRate.income > 0 ? E.bestRate.saved / E.bestRate.income * 100 : 0)} %</div></div>
      </div></section>` : '';

    // Ce qui a changé (max 3) + Budget Orion a détecté (max 3)
    const changed = anChanges(E).slice(0, 3);
    const insights = anInsights(E).slice(0, 3);
    const changedCard = changed.length ? `<section class="card"><div class="sec-head"><h2>Ce qui a changé</h2></div>
      ${changed.map(c => `<div class="an-ins ${c.dir}" ${c.cat ? `data-an-cat="${c.cat}"` : ''} ${c.cat ? 'style=cursor:pointer' : ''}><span class="ic">${c.icon}</span><span class="tx">${c.text}</span>${c.cat ? '<span class="chev">›</span>' : ''}</div>`).join('')}</section>` : '';
    const insightsCard = insights.length ? `<section class="card"><div class="sec-head"><h2>Budget Orion a détecté</h2></div>
      ${insights.map(c => `<div class="an-ins ${c.dir}"><span class="ic">${c.icon}</span><span class="tx">${c.text}</span></div>`).join('')}</section>` : '';

    // Projection fin d'année (année en cours) + fiabilité
    let projCard = '';
    if ((anPeriod === 'year' || anPeriod === 'all' || anPeriod === '12m')) {
      const yr = anYear || year;
      if ((anYear || year) === year) {
        if (E.avail.length >= 3) {
          const elapsed = E.avail.filter(x => x.key.slice(0, 4) == year).length || E.avail.length;
          const cumThisYear = analysisEngine('year').saved;
          const rem = Math.max(0, 12 - month - 1);
          const proj = cumThisYear + E.averages.saved * rem;
          const goal = 8000;
          projCard = `<section class="card an-proj"><div class="sec-head"><h2>Projection fin d'année</h2></div>
            <div class="an-sub">À ce rythme, tu terminerais ${year} avec environ</div>
            <b class="big">${eur(proj)}</b> <span class="an-sub">conservés</span>
            <div class="track"><span style="width:${Math.min(100, Math.round(proj / goal * 100))}%"></span></div>
            <div class="an-sub">Objectif indicatif ${eur(goal)} · ${Math.min(100, Math.round(proj / goal * 100))}% — estimation, pas une certitude.</div></section>`;
        } else {
          projCard = `<section class="card an-proj"><div class="sec-head"><h2>Projection fin d'année</h2></div><div class="warn">Historique encore insuffisant pour une projection fiable (au moins 3 mois de données requis).</div></section>`;
        }
      }
    }

    // Charges fixes + abonnements + non mensuelles
    const extraCards = `<div class="metric-grid">
      <div class="metric"><small>Charges fixes / revenus</small><b>${Math.round(E.fixedRate)}%</b></div>
      <div class="metric"><small>Charges fixes / mois</small><b>${eur(E.fixedAvg)}</b></div>
      <div class="metric clickable" data-an-cat="abonnements"><small>Abonnements / mois</small><b class="blue">${eur(E.subsMonthly)}</b></div>
      <div class="metric annual-box"><small>Non mensuelles / an</small><b class="blue">${eur(E.nonMonthlyYear)}</b></div>
    </div>`;

    // Moyennes + année jusqu'ici
    const avgs = `<section class="card"><div class="sec-head"><h2>Moyennes sur la période</h2></div>
      <div class="an-avgs">
        <div class="an-avg rev"><small>Revenus moyens</small><b>${eur(E.averages.income)}</b><small>/ mois</small></div>
        <div class="an-avg dep"><small>Dépenses moyennes</small><b>${eur(E.averages.expense)}</b><small>/ mois</small></div>
        <div class="an-avg cons"><small>Conservé moyen</small><b>${eur(E.averages.saved)}</b><small>/ mois</small></div>
      </div></section>`;

    $('#view').innerHTML = `<div class="stack an-page">
      <p class="an-sub">Comprendre pour mieux décider.</p>
      ${periods}${yNav}${situ}${chart}${where}${cmp}${marks}${changedCard}${insightsCard}${projCard}${extraCards}${avgs}
    </div>`;
  }

  /* Insights fiables (seuils) — "Ce qui a changé" */
  function anChanges(E) {
    const out = [];
    if (E.prev.has) {
      Object.keys(CATS).forEach(c => {
        const cur = num(E.cats[c]), prv = num(E.prev.cats[c]);
        if (prv >= 20 && Math.abs(cur - prv) >= 20) { const pct = Math.round(((cur - prv) / prv) * 100); if (Math.abs(pct) >= 12) out.push({ icon: cur > prv ? '📈' : '📉', dir: cur > prv ? 'up' : 'down', cat: c, text: `Tes dépenses ${CATS[c].toLowerCase()} ont ${cur > prv ? 'augmenté' : 'diminué'} de ${Math.abs(pct)} % (${cur > prv ? '+' : ''}${eur(cur - prv)}).` }); }
      });
      const dS = E.saved - E.prev.saved;
      if (Math.abs(dS) >= 50) out.push({ icon: dS > 0 ? '💙' : '⚠️', dir: dS > 0 ? 'down' : 'up', text: `Tu as conservé ${dS > 0 ? eur(dS) + ' de plus' : eur(-dS) + ' de moins'} que la période précédente.` });
    }
    (budget.recurringTemplates || []).length && (() => {
      try { installmentItems().forEach(i => { if (i.remainingCount === 0 && i.currentIndex === num(i.installments) - 1) out.push({ icon: '✅', dir: 'down', text: `Ton échéancier « ${esc(i.name)} » est terminé : ${eur(i.amount)}/mois libérés.` }); }); } catch (_) {}
    })();
    if (E.fixedRate >= 50) out.push({ icon: '🏠', dir: 'info', text: `Tes charges fixes représentent ${Math.round(E.fixedRate)} % de tes revenus reçus.` });
    return out;
  }
  function anInsights(E) {
    const out = [];
    if (E.subsMonthly > 0) out.push({ icon: '📺', dir: 'info', text: `Tes abonnements représentent ${eur(E.subsMonthly * 12)} / an (${eur(E.subsMonthly)}/mois).` });
    if (E.avail.length >= 2 && E.worst) { const avg = E.expenseReal / E.n; if (avg > 0 && E.worst.expense > avg * 1.25) out.push({ icon: '🔺', dir: 'up', text: `${anMonthLabel(E.worst.key, true)} a été ${Math.round(((E.worst.expense - avg) / avg) * 100)} % plus coûteux que ta moyenne.` }); }
    if (E.prev.has) { const dp = Math.round((E.retention - E.prev.retention) * 10) / 10; if (Math.abs(dp) >= 3) out.push({ icon: dp > 0 ? '📈' : '📉', dir: dp > 0 ? 'down' : 'up', text: `Ton taux de conservation est passé de ${Math.round(E.prev.retention)} % à ${Math.round(E.retention)} %.` }); }
    if (E.nonMonthlyYear > 0) out.push({ icon: '🗓️', dir: 'info', text: `Tu as ${eur(E.nonMonthlyYear)} de dépenses non mensuelles sur l'année (trimestrielles, annuelles…).` });
    return out;
  }

  /* Drill-down catégorie (période courante) → dépenses → fiche */
  function anCategorySheet(cat) {
    const E = analysisEngine(anPeriod);
    const rows = [];
    E.keys.forEach(k => { const m = budget.monthlyData[k]; if (!m) return; (m.expenses || []).forEach(r => { if ((r.cat || 'autres') === cat && r.paid) rows.push({ r, k, idx: m.expenses.indexOf(r) }); }); });
    const sum = rows.reduce((s, x) => s + num(x.r.amount), 0);
    const perMonth = E.n ? sum / E.n : 0;
    const prevVal = num(E.prev.cats[cat]);
    const d = E.prev.has && prevVal ? anDelta(E.cats[cat] || 0, prevVal, true) : null;
    // Regrouper par libellé
    const byName = {}; rows.forEach(x => { const n = x.r.name || 'Sans nom'; const g = (byName[n] = byName[n] || { sum: 0, sample: x }); g.sum += num(x.r.amount); g.sample = x; /* garder la plus récente (itération chronologique) */ });
    const names = Object.keys(byName).sort((a, b) => byName[b].sum - byName[a].sum);
    openSheet(CATS[cat] || cat, `
      <section class="an-sheet-tot"><small style="color:var(--mut)">Total sur la période</small><br><b>${eur(sum)}</b>
        <div class="an-sheet-sub"><span>${eur(perMonth)} / mois</span>${d ? `<span class="${d.cls}">${d.arrow} ${d.pct > 0 ? '+' : ''}${d.pct} % vs préc.</span>` : ''}</div></section>
      <section class="card" style="margin-top:10px">${names.length ? names.map(n => { const x = byName[n].sample; const id = identityOf(x.r); return `<div class="row clickable" data-an-open-exp="${x.k}" data-an-open-idx="${x.idx}"><div class="brandmark ${id.cls}" style="width:34px;height:34px;flex:0 0 34px">${id.mark}</div><div class="row-main"><b>${esc(n)}</b><small>${CATS[cat] || cat} · ${anMonthLabel(x.k, true)}</small></div><b>${eur(byName[n].sum)}</b></div>`; }).join('') : '<div class="empty">Aucune dépense payée dans cette catégorie sur la période.</div>'}</section>`);
  }

  /* Détail d'un mois (depuis le graphique / cartes marquantes) */
  function anMonthSheet(k) {
    const m = budget.monthlyData[k]; if (!m) return;
    const t = totals(m); const saved = t.pin - t.pex; const rate = t.pin ? Math.round((saved / t.pin) * 1000) / 10 : 0;
    const ct = catTotals(m, true); const topCat = Object.keys(ct).sort((a, b) => ct[b] - ct[a])[0];
    const goThisMonth = () => { const [y, mo] = k.split('-').map(Number); year = y; month = mo - 1; };
    openSheet(anMonthLabel(k), `
      <div class="an-kpis" style="margin-top:6px">
        <div class="an-kpi rev"><small>Revenus</small><b>${eur(t.pin)}</b></div>
        <div class="an-kpi dep"><small>Dépenses</small><b>${eur(t.pex)}</b></div>
        <div class="an-kpi cons"><small>Conservé</small><b>${eur(saved)}</b></div>
        <div class="an-kpi rate"><small>Taux</small><b>${rate}%</b></div>
      </div>
      <div class="an-sheet-sub" style="margin:12px 2px">Top catégorie : <b>${topCat ? (CATS[topCat] || topCat) + ' (' + eur(ct[topCat]) + ')' : '—'}</b></div>
      <button class="action" data-an-goto-month="${k}">Voir le détail du mois</button>`);
  }

  /* =====================================================================
     MOTEUR D'ÉPARGNE CENTRALISÉ — prévu ≠ réalisé. Source unique : m.savings.
     planned = snapshot d'engagement (additif) sinon engagement live.
     ===================================================================== */
  function svBaseEngagement() { return (extra.pockets || []).reduce((s, p) => s + num(p.monthlyTarget), 0); }
  function svCatchupPerMonth(k) {
    const c = extra.savingsCatchup; if (!c || !c.months) return 0;
    // fenêtre [startKey , startKey+months-1]
    let inWindow = false, cur = c.startKey;
    for (let i = 0; i < c.months; i++) { if (cur === k) { inWindow = true; break; } cur = monthKeyAdd(cur, 1); }
    return inWindow ? num(c.perMonth) : 0;
  }
  function svPlanned(k) { const sv = budget.monthlyData[k] && budget.monthlyData[k].savings; return (sv && sv.planned != null) ? num(sv.planned) : svBaseEngagement(); }
  function svRealKey() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; }
  function svStatusRaw(k) {
    const sv = budget.monthlyData[k] && budget.monthlyData[k].savings;
    const planned = svPlanned(k), validated = !!(sv && sv.paid), realized = validated ? num(sv.amount) : 0;
    const rk = svRealKey();
    if (k > rk) return { status: 'future', planned, realized, validated };
    if (validated) {
      if (planned <= 0) return { status: realized > 0 ? 'exceeded' : 'none', planned, realized, validated };
      if (realized > planned) return { status: 'exceeded', planned, realized, validated };
      if (realized >= planned) return { status: 'respected', planned, realized, validated };
      if (realized > 0) return { status: 'partial', planned, realized, validated };
      return { status: 'missed', planned, realized, validated };
    }
    if (k < rk) return { status: planned > 0 ? 'missed' : 'none', planned, realized: 0, validated: false };
    return { status: 'topay', planned, realized: 0, validated: false }; // mois courant non validé
  }
  function svStatus(k) { const r = svStatusRaw(k); r.meta = SV_META[r.status]; return r; }
  const SV_META = {
    respected: { sym: '✓', label: 'Respecté', cls: 'respected' }, exceeded: { sym: '★', label: 'Dépassé', cls: 'exceeded' },
    partial: { sym: '◐', label: 'Partiel', cls: 'partial' }, missed: { sym: '✕', label: 'Manqué', cls: 'missed' },
    topay: { sym: '○', label: 'À valider', cls: 'topay' }, future: { sym: '', label: 'À venir', cls: 'future' }, none: { sym: '', label: '—', cls: 'none' }
  };
  function savingsEngine(y) {
    const rows = [];
    for (let m = 0; m < 12; m++) { const k = `${y}-${p2(m + 1)}`; const st = svStatus(k); rows.push({ key: k, month: m, ...st, meta: SV_META[st.status] }); }
    const evaluable = rows.filter(r => r.planned > 0 && ['respected', 'exceeded', 'partial', 'missed'].includes(r.status));
    const respected = rows.filter(r => ['respected', 'exceeded'].includes(r.status)).length;
    const partial = rows.filter(r => r.status === 'partial').length;
    const missed = rows.filter(r => r.status === 'missed').length;
    const regularity = evaluable.length ? Math.round((respected / evaluable.length) * 100) : 0;
    const rk = svRealKey();
    const applicable = rows.filter(r => r.key <= rk && r.planned > 0);
    const plannedTotal = applicable.reduce((s, r) => s + r.planned, 0);
    const realizedTotal = applicable.reduce((s, r) => s + r.realized, 0);
    const retard = evaluable.reduce((s, r) => s + Math.max(r.planned - r.realized, 0), 0);
    const avance = evaluable.reduce((s, r) => s + Math.max(r.realized - r.planned, 0), 0);
    const retardNet = Math.max(0, retard - avance);
    // série / record (mois évaluables chronologiques)
    let streak = 0, record = 0, run = 0;
    evaluable.forEach(r => { if (['respected', 'exceeded'].includes(r.status)) { run++; record = Math.max(record, run); } else run = 0; });
    for (let i = evaluable.length - 1; i >= 0; i--) { if (['respected', 'exceeded'].includes(evaluable[i].status)) streak++; else break; }
    return { y, rows, evaluable, respected, partial, missed, regularity, plannedTotal, realizedTotal, ecart: realizedTotal - plannedTotal, retard, avance, retardNet, streak, record };
  }
  function svImpactYears(amount, years) {
    const rate = num(extra.strategy && extra.strategy.rate) || 7;
    return projectCapital(years, amount, 0, rate); // valeur future théorique d'un capital ponctuel
  }
  /* Réconciliation poche (idempotente) : évite tout double comptage à la re-validation. */
  function svApplyAllocation(k, newAlloc) {
    const sv = budget.monthlyData[k].savings; const old = (sv && sv.alloc) || {};
    for (const pid in old) { const p = (extra.pockets || []).find(x => x.id === pid); if (p) p.balance = num(p.balance) - num(old[pid]); }
    for (const pid in newAlloc) { const p = (extra.pockets || []).find(x => x.id === pid); if (p) p.balance = num(p.balance) + num(newAlloc[pid]); }
    saveExtra();
  }

  function renderSavings() {
    setTitle('Épargne');
    if (svYear == null) svYear = year;
    const E = savingsEngine(svYear);
    const pTotal = pocketsTotal();
    const cov = coverageMonths();
    const covPct = Math.min(100, (cov / Math.max(1, extra.coverageTargetMonths)) * 100);
    const curKey = key();
    const curSt = svStatus(curKey);
    const engagementLive = svBaseEngagement();
    const catchup = svCatchupPerMonth(curKey);
    const target = engagementLive + catchup;
    // Δ épargne totale ce mois (réalisé validé du mois courant)
    const monthRealized = curSt.validated ? curSt.realized : 0;

    // Poches
    const pocketsHtml = (extra.pockets || []).map(p => {
      const goal = num(p.goal) || 0; const pct = goal ? Math.min(100, Math.round((num(p.balance) / goal) * 100)) : (pTotal ? Math.round((num(p.balance) / pTotal) * 100) : 0);
      return `<div class="sv-pocket clickable" data-edit-pocket="${p.id}">
        <div class="pemo">${esc(p.emoji || '💶')}</div>
        <div class="pmain"><b>${esc(p.name)}${p.security ? ' 🛡️' : ''}</b><span class="amt">${eur(p.balance)}${goal ? ' / ' + eur(goal) : ''}${p.monthlyTarget ? ' · ' + eur(p.monthlyTarget) + '/mois' : ''}</span><div class="track"><span style="width:${pct}%"></span></div></div>
        <span class="pct">${pct}%</span></div>`;
    }).join('');

    // Validation du mois
    const cm = curSt.meta;
    const validCard = `<section class="card sv-valid">
      <div class="sv-valid-head"><h2>Épargne du mois de ${ML[month].toLowerCase()}</h2><span class="sv-status sv-st-${cm.cls}">${cm.sym} ${cm.label}</span></div>
      <div class="sv-valid-grid">
        <div class="sv-vk plan"><small>Engagement${catchup ? ' (+ rattrapage)' : ''}</small><b>${eur(target)}</b></div>
        <div class="sv-vk real"><small>Réalisé</small><b>${curSt.validated ? eur(curSt.realized) : '—'}</b></div>
      </div>
      <button class="action" data-validate-saving="${curKey}">${curSt.validated ? 'Modifier ma validation' : 'Valider mon épargne'}</button>
    </section>`;

    // Respect des engagements (timeline)
    const yearsWithData = [...new Set(Object.keys(budget.monthlyData).map(k => +k.slice(0, 4)))].sort();
    const minY = yearsWithData[0] || year;
    const timeline = `<section class="card">
      <div class="sv-reg-head"><h2 style="font-size:15px;margin:0;font-weight:850">Respect de mes engagements</h2>
        <div class="sv-reg-year"><button data-sv-year="-1" ${svYear <= minY ? 'disabled style=opacity:.3' : ''}>‹</button><b>${svYear}</b><button data-sv-year="1" ${svYear >= year ? 'disabled style=opacity:.3' : ''}>›</button></div></div>
      <div class="sv-months">${E.rows.map(r => `<button class="sv-mo ${r.key === curKey ? 'sel' : ''}" data-validate-saving="${r.key}"><span class="l">${['J','F','M','A','M','J','J','A','S','O','N','D'][r.month]}</span><span class="s s-${r.meta.cls}">${r.meta.sym}</span></button>`).join('')}</div>
      <div class="sv-reg-counts">
        <div class="sv-rc g"><small>Respectés</small><b>${E.respected}${E.evaluable.length ? ' / ' + E.evaluable.length : ''}</b></div>
        <div class="sv-rc o"><small>Partiels</small><b>${E.partial}</b></div>
        <div class="sv-rc r"><small>Manqués</small><b>${E.missed}</b></div>
      </div>
      <div class="sv-legend"><span><i class="s-respected"></i>Respecté</span><span><i class="s-partial"></i>Partiel</span><span><i class="s-missed"></i>Manqué</span><span><i class="s-topay" style="background:#fff;border:1.5px solid var(--sv-orange)"></i>À valider</span></div>
      ${E.evaluable.length ? `<button class="link" data-sv-regularity style="display:block;text-align:center;width:100%;margin-top:10px">Voir le tableau détaillé ›</button>` : ''}
      ${E.streak >= 2 ? `<div class="insight" style="margin-top:8px">🔥 Série en cours : <b>${E.streak} mois</b> consécutifs respectés${E.record > E.streak ? ` · record ${E.record}` : ''}.</div>` : ''}
    </section>`;

    // Retard / Avance
    let delayCard = '';
    if (E.retardNet > 0) {
      delayCard = `<section class="card"><div class="sv-delay late clickable" data-sv-catchup>
        <div class="ic">⚠️</div><div class="dm"><small>Retard d'épargne cumulé</small><b>${eur(E.retardNet)}</b><small>${E.missed} mois manqué${E.missed > 1 ? 's' : ''} · touche pour rattraper</small></div><span class="go link">Rattraper ›</span></div></section>`;
    } else if (E.avance > 0) {
      const moisEng = engagementLive > 0 ? (E.avance / engagementLive) : 0;
      delayCard = `<section class="card"><div class="sv-delay ahead">
        <div class="ic">🎉</div><div class="dm"><small>Avance d'épargne</small><b>+${eur(E.avance)}</b><small>${moisEng >= 0.5 ? '≈ ' + moisEng.toFixed(1).replace('.', ',') + ' mois d\'engagement' : 'au-dessus de ton engagement'}</small></div></div></section>`;
    }

    // Cumul annuel
    const cumulCard = `<section class="card"><div class="sec-head"><h2>Cette année ${svYear}</h2></div>
      <div class="metric-grid">
        <div class="metric"><small>Prévu cumulé</small><b>${eur(E.plannedTotal)}</b></div>
        <div class="metric"><small>Réalisé cumulé</small><b class="pos">${eur(E.realizedTotal)}</b></div>
        <div class="metric"><small>Écart</small><b class="${E.ecart >= 0 ? 'pos' : 'neg'}">${E.ecart >= 0 ? '+' : ''}${eur(E.ecart)}</b></div>
        <div class="metric"><small>Régularité</small><b>${E.regularity}%</b></div>
      </div></section>`;

    // Graphique prévu vs réalisé
    const chartCard = `<section class="card">
      <div class="sv-chart-head"><h2>Prévu vs réalisé</h2><div class="sv-modes"><button class="${svChartMode === 'month' ? 'active' : ''}" data-sv-mode="month">Mensuel</button><button class="${svChartMode === 'cumul' ? 'active' : ''}" data-sv-mode="cumul">Cumulé</button></div></div>
      <div class="sv-legend2"><span><i class="sv-bar-plan" style="background:#d7e0da"></i>Prévu</span><span><i class="sv-bar-real" style="background:var(--sv-green)"></i>Réalisé</span></div>
      ${svChart(E)}</section>`;

    // Insights (max 3)
    const insights = svInsights(E).slice(0, 3);
    const insightsCard = insights.length ? `<section class="card">${insights.map(i => `<div class="sv-ins ${i.level}" ${i.attr || ''} ${i.attr ? 'style=cursor:pointer' : ''}><span class="ic">${i.icon}</span><span class="tx">${i.text}</span>${i.attr ? '<span class="chev">›</span>' : ''}</div>`).join('')}</section>` : '';

    $('#view').innerHTML = `<div class="stack sv-page">
      <p class="sv-sub">Construis ton avenir, un pas après l'autre.</p>
      <div class="sv-heros">
        <div class="sv-hero-a clickable" data-open-transfer><small>Épargne totale</small><b>${eur(pTotal)}</b><span class="up">${monthRealized > 0 ? '+' + eur(monthRealized) + ' ce mois' : 'toutes poches'}</span></div>
        <div class="sv-hero-b clickable" data-edit-coverage-target><small>Couverture financière</small><b>${cov.toFixed(1).replace('.', ',')} mois</b><span style="font-size:10.5px;color:var(--mut)">Dépenses essentielles</span><div class="track"><span style="width:${covPct}%"></span></div></div>
      </div>
      ${validCard}
      <div><div class="sec-head"><h2>Mes poches d'épargne</h2><button class="link" data-add-pocket>Gérer ›</button></div>
      <section class="card">${pocketsHtml || '<div class="empty">Aucune poche. Ajoute-en une pour commencer.</div>'}</section></div>
      ${timeline}
      ${delayCard}
      ${cumulCard}
      ${chartCard}
      ${insightsCard}
    </div>`;
  }

  /* Graphique SVG prévu/réalisé (mensuel groupé ou cumulé) */
  function svChart(E) {
    const rk = svRealKey();
    const rows = E.rows.filter(r => r.key <= rk); // pas de futur
    if (!rows.length) return '<div class="empty">Pas encore de données cette année.</div>';
    const W = 320, H = 150, padL = 28, padR = 8, padT = 10, padB = 20, iw = W - padL - padR, ih = H - padT - padB;
    const X = i => padL + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
    let grid = '', ylab = '';
    if (svChartMode === 'month') {
      const maxV = Math.max(1, ...rows.map(r => Math.max(r.planned, r.realized)));
      const nice = Math.ceil(maxV / 100) * 100 || 100;
      const Y = v => padT + ih - (v / nice) * ih;
      for (let g = 0; g <= 2; g++) { const v = nice * g / 2, yy = Y(v); grid += `<line class="sv-grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`; ylab += `<text class="sv-axis" x="2" y="${(yy + 3).toFixed(1)}">${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)}</text>`; }
      const bw = Math.min(9, iw / (rows.length * 2.6));
      const bars = rows.map((r, i) => { const x = X(i); const yp = Y(r.planned), yr = Y(r.realized); return `<rect class="sv-bar-plan" x="${(x - bw - 1).toFixed(1)}" y="${yp.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT + ih - yp).toFixed(1)}" rx="2"/><rect class="sv-bar-real" x="${(x + 1).toFixed(1)}" y="${yr.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT + ih - yr).toFixed(1)}" rx="2"/>`; }).join('');
      const xlab = rows.map((r, i) => `<text class="sv-axis" text-anchor="middle" x="${X(i).toFixed(1)}" y="${H - 6}">${['J','F','M','A','M','J','J','A','S','O','N','D'][r.month]}</text>`).join('');
      const hits = rows.map((r, i) => `<rect fill="transparent" data-sv-mo="${r.key}" x="${(X(i) - iw / (rows.length * 2 || 1)).toFixed(1)}" y="${padT}" width="${(iw / (rows.length || 1)).toFixed(1)}" height="${ih}"/>`).join('');
      return `<svg class="sv-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${grid}${ylab}${bars}${xlab}${hits}</svg>`;
    }
    // cumulé
    let cp = 0, cr = 0; const P = rows.map(r => (cp += r.planned)), Rr = rows.map(r => (cr += r.realized));
    const maxV = Math.max(1, ...P, ...Rr); const nice = Math.ceil(maxV / 200) * 200 || 200;
    const Y = v => padT + ih - (v / nice) * ih;
    for (let g = 0; g <= 2; g++) { const v = nice * g / 2, yy = Y(v); grid += `<line class="sv-grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`; ylab += `<text class="sv-axis" x="2" y="${(yy + 3).toFixed(1)}">${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)}</text>`; }
    const pathP = P.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const pathR = Rr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const xlab = rows.map((r, i) => `<text class="sv-axis" text-anchor="middle" x="${X(i).toFixed(1)}" y="${H - 6}">${['J','F','M','A','M','J','J','A','S','O','N','D'][r.month]}</text>`).join('');
    return `<svg class="sv-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${grid}${ylab}<path class="sv-line-plan" d="${pathP}"/><path class="sv-line-real" d="${pathR}"/>${xlab}</svg>`;
  }

  function svInsights(E) {
    const out = [];
    if (svStatus(key()).status === 'topay' && svBaseEngagement() > 0) out.push({ icon: '🐷', level: 'action', text: `Pense à valider ton épargne de ${ML[month].toLowerCase()} (engagement ${eur(svBaseEngagement())}).`, attr: `data-validate-saving="${key()}"` });
    if (E.streak >= 3) out.push({ icon: '🔥', level: 'good', text: `Tu respectes ton engagement depuis ${E.streak} mois. Continue !` });
    if (E.retardNet > 0) { const eng = svBaseEngagement(); out.push({ icon: '↩️', level: 'action', text: eng > 0 && E.retardNet < eng ? `Tu as ${eur(E.retardNet)} de retard, soit moins d'un mois d'engagement.` : `En ajoutant ${eur(Math.ceil(E.retardNet / 3))}/mois pendant 3 mois, ton retard serait absorbé.`, attr: 'data-sv-catchup' }); }
    if (E.avance > 0) out.push({ icon: '⭐', level: 'good', text: `Tu as épargné ${eur(E.avance)} de plus que prévu cette année.` });
    const impact = E.retardNet > 0 ? svImpactYears(E.retardNet, 10) : 0;
    if (impact > E.retardNet) out.push({ icon: '📉', level: 'action', text: `Projection théorique : ces ${eur(E.retardNet)} non épargnés représenteraient ~${eur(impact)} dans 10 ans (au taux ${num(extra.strategy?.rate) || 7}%).` });
    return out;
  }

  /* Bottom-sheet de validation mensuelle (prévu / réalisé / partiel / rien) */
  function savingsValidateSheet(k) {
    const [y, mo] = k.split('-').map(Number); const label = `${ML[mo - 1]} ${y}`;
    const m = budget.monthlyData[k] || { savings: { amount: 0, paid: false } };
    const sv = m.savings || { amount: 0, paid: false };
    const planned = svPlanned(k) + svCatchupPerMonth(k);
    const cur = sv.paid ? num(sv.amount) : '';
    const st = svStatus(k);
    openSheet(`Validation — ${label}`, `<form class="form" id="savingsValidateForm">
      <input type="hidden" name="key" value="${k}">
      <div class="metric-grid" style="margin-bottom:4px"><div class="metric"><small>Engagement</small><b>${eur(planned)}</b></div><div class="metric"><small>Statut actuel</small><b class="sv-status sv-st-${st.meta.cls}" style="font-size:12px">${st.meta.sym} ${st.meta.label}</b></div></div>
      <label>Combien as-tu réellement épargné ?<input type="number" min="0" step="0.01" name="amount" value="${cur}" placeholder="Ex : ${Math.round(planned) || 200}"></label>
      <div class="sv-quick">${[planned, planned * 0.75, planned * 0.5, 0].map(v => `<button type="button" data-sv-quick="${Math.round(v)}">${Math.round(v)} €</button>`).join('')}</div>
      <label>Vers quelle poche ? (optionnel)<select name="pocket"><option value="">— Ne pas affecter —</option>${(extra.pockets || []).map(p => `<option value="${p.id}" ${(sv.alloc && sv.alloc[p.id]) ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>
      <label>Date de validation<input type="date" name="date" value="${sv.date || today()}"></label>
      <button class="action" name="act" value="save">Valider ce mois</button>
      ${sv.paid ? '<button type="button" class="ghost danger" data-cancel-validation="' + k + '">Annuler la validation</button>' : '<button type="button" class="ghost" data-sv-nothing="' + k + '">Pas ce mois-ci (0 €)</button>'}
    </form>`);
  }

  /* Tableau de régularité (lignes compactes — jamais un tableau desktop) */
  function savingsRegularitySheet() {
    const E = savingsEngine(svYear);
    const rows = E.rows.filter(r => r.status !== 'future');
    openSheet(`Régularité ${svYear}`, `<section class="card sv-tbl">${rows.map(r => `<div class="sv-trow clickable" data-validate-saving="${r.key}">
      <span class="mn">${ML[r.month].slice(0, 4)}.</span>
      <div class="col"><small>Prévu</small><b>${eur(r.planned)}</b></div>
      <div class="col real"><small>Réalisé</small><b>${r.validated ? eur(r.realized) : '—'}</b></div>
      <span class="stt sv-st-${r.meta.cls}" style="padding:3px 8px;border-radius:999px">${r.meta.sym} ${r.meta.label}</span></div>`).join('') || '<div class="empty">Aucun mois évaluable.</div>'}</section>
      <div class="insight" style="margin-top:10px">Régularité : <b>${E.respected}/${E.evaluable.length || 0}</b> mois respectés (${E.regularity}%).</div>`);
  }

  /* Plan de rattrapage */
  function savingsCatchupSheet() {
    const E = savingsEngine(svYear); const R = E.retardNet;
    if (R <= 0) { openSheet('Rattrapage', '<div class="empty">Aucun retard à rattraper. 🎉</div>'); return; }
    const opts = [[1, Math.ceil(R)], [3, Math.ceil(R / 3)], [6, Math.ceil(R / 6)]];
    openSheet('Rattraper mon retard', `
      <section class="card" style="border-color:#f6d3da;background:#fdf0f2"><small style="color:var(--mut)">Montant total manquant</small><h2 style="margin:4px 0;color:var(--sv-red)">${eur(R)}</h2></section>
      <div class="sec-head" style="margin-top:12px"><h2 style="font-size:14px">Pour rattraper sans changer tes échéances</h2></div>
      ${opts.map(([mths, pm]) => `<button class="sv-catch-opt" data-sv-apply-catchup="${mths}" data-permonth="${pm}"><div><b>+${eur(pm)} / mois</b><br><small>pendant ${mths} mois</small></div><span class="link">Choisir ›</span></button>`).join('')}
      ${extra.savingsCatchup ? `<button class="ghost danger" style="margin-top:10px" data-sv-clear-catchup>Annuler le plan de rattrapage en cours</button>` : ''}
      <div class="insight" style="margin-top:10px">Ce rattrapage s'ajoute temporairement à ton engagement de ${eur(svBaseEngagement())}/mois, puis disparaît automatiquement. Ton engagement de base ne change pas.</div>`);
  }

  function whatIfSavingsText(delta) {
    const w = whatIf(num(delta));
    return `+${eur(delta)}/mois → ${eur(w.annual)}/an, ${eur(w.fiveYears)} sur 5 ans. Investi au taux actuel (${w.rate}%), cela ferait environ <b>${eur(w.investedFiveYears)}</b> dans 5 ans.`;
  }

  /* =====================================================================
     MOTEUR OBJECTIFS — lecture des données existantes. Source unique.
     Si un objectif est lié à une poche, son "actuel" DÉRIVE du solde de la
     poche (pas de champ dupliqué → zéro double comptage).
     ===================================================================== */
  const GL_COLORS = ['#7b5bd6', '#2f6bd6', '#f0932b', '#12a45f', '#e84393', '#16a1a1'];
  function glLinkedPocket(g) { return g.linkedPocketId ? (extra.pockets || []).find(p => p.id === g.linkedPocketId) : null; }
  function glCurrent(g) { const p = glLinkedPocket(g); return p ? num(p.balance) : num(g.current); }
  function glContribution(g) { const p = glLinkedPocket(g); return p ? num(p.monthlyTarget) : num(g.contribution); }
  function glColor(g, i) { return g.color || GL_COLORS[i % GL_COLORS.length]; }
  function glRemaining(g) { return Math.max(0, num(g.target) - glCurrent(g)); }
  function glProgress(g) { return num(g.target) ? (glCurrent(g) / num(g.target)) * 100 : 0; }
  function glDone(g) { return num(g.target) > 0 && glCurrent(g) >= num(g.target); }
  function glMonthsToTarget(g) { return g.targetDate ? Math.max(0, monthsBetween(today(), g.targetDate)) : null; }
  function glNeeded(g) { const mt = glMonthsToTarget(g); return mt != null ? glRemaining(g) / Math.max(1, mt) : null; }
  function glProjMonths(g, contribOverride) { const c = contribOverride != null ? contribOverride : glContribution(g); return c > 0 ? Math.ceil(glRemaining(g) / c) : null; }
  function glAddMonths(n) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d; }
  function glProjDate(g, contribOverride) { const m = glProjMonths(g, contribOverride); return m != null ? glAddMonths(m) : null; }
  function glStatus(g) {
    if (glDone(g)) return { key: 'done', label: 'Objectif atteint', cls: 'done' };
    const c = glContribution(g);
    if (!g.targetDate) return c > 0 ? { key: 'nodate', label: `≈ ${glProjMonths(g)} mois à ce rythme`, cls: 'nodate' } : { key: 'nocontrib', label: 'Définir une contribution', cls: 'nodate' };
    if (c <= 0) return { key: 'nocontrib', label: 'Définir une contribution', cls: 'nodate' };
    const proj = glProjDate(g); const tgt = new Date(g.targetDate + 'T12:00:00');
    const delta = monthsBetween(iso(proj.getFullYear(), proj.getMonth(), 1), iso(tgt.getFullYear(), tgt.getMonth(), 1)); // >0 si cible après proj = avance
    if (delta >= 1) return { key: 'ahead', label: `En avance d'environ ${delta} mois`, cls: 'ahead', delta };
    if (delta <= -1) return { key: 'late', label: `En retard d'environ ${-delta} mois`, cls: 'late', delta };
    return { key: 'ontime', label: 'À l\'heure', cls: 'ontime', delta: 0 };
  }
  /* Suivi mensuel d'un objectif lié : prévu = contribution, réalisé = montant réellement
     affecté à la poche ce mois-là (m.savings.alloc[pocketId]) — même donnée qu'Épargne. */
  function glMonthlyTracking(g, y) {
    const p = glLinkedPocket(g); const rows = [];
    const rk = svRealKey();
    for (let m = 0; m < 12; m++) {
      const k = `${y}-${p2(m + 1)}`; if (k > rk) continue;
      const sv = budget.monthlyData[k] && budget.monthlyData[k].savings;
      const planned = glContribution(g);
      let realized = 0;
      if (p && sv && sv.paid) realized = (sv.alloc && sv.alloc[p.id] != null) ? num(sv.alloc[p.id]) : 0;
      rows.push({ key: k, month: m, planned, realized, validated: !!(sv && sv.paid) });
    }
    return rows;
  }
  function primaryGoal() { const act = goals.filter(g => !g.archived); return act.find(g => g.primary) || act[0] || null; }

  function glSorted() {
    const act = goals.filter(g => !g.archived);
    const arr = act.slice();
    if (glSort === 'progress') arr.sort((a, b) => glProgress(b) - glProgress(a));
    else if (glSort === 'amount') arr.sort((a, b) => num(b.target) - num(a.target));
    else if (glSort === 'date') arr.sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));
    else if (glSort === 'priority') { const r = { high: 0, mid: 1, low: 2 }; arr.sort((a, b) => r[a.priority] - r[b.priority]); }
    // objectif principal toujours en tête
    arr.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    return arr;
  }

  function renderGoals() {
    setTitle('Objectifs', false);
    const active = goals.filter(g => !g.archived);
    const archived = goals.filter(g => g.archived);
    const targetSum = active.reduce((s, g) => s + num(g.target), 0);
    const currentSum = active.reduce((s, g) => s + glCurrent(g), 0);
    const doneSum = active.filter(glDone).reduce((s, g) => s + num(g.target), 0);
    const globalPct = targetSum ? Math.round((currentSum / targetSum) * 100) : 0;
    const remainSum = Math.max(0, targetSum - currentSum);

    const overview = `<div>
      <div class="gl-ovh">Vue d'ensemble</div>
      <div class="gl-ov">
        <div class="gl-ovc tot"><small>Total objectifs</small><b>${eur(targetSum)}</b><span class="u">${active.length} actif${active.length > 1 ? 's' : ''}</span></div>
        <div class="gl-ovc done"><small>Déjà atteint</small><b>${eur(currentSum)}</b><span class="u">${globalPct}% du total</span></div>
        <div class="gl-ovc run"><small>En cours</small><b>${eur(remainSum)}</b><span class="u">${100 - globalPct}% du total</span></div>
      </div></div>`;

    const sortLabel = { progress: 'Progression', priority: 'Priorité', date: 'Échéance', amount: 'Montant' }[glSort];
    const tabs = `<div class="gl-tabs">
      <button class="gl-tab ${glView === 'list' ? 'active' : ''}" data-gl-view="list">Liste</button>
      <button class="gl-tab ${glView === 'table' ? 'active' : ''}" data-gl-view="table">Tableau</button>
      <button class="gl-tab gl-sort" data-gl-sort>Trier : ${sortLabel} ⇅</button>
    </div>`;

    let body;
    if (!active.length) {
      body = '<section class="card"><div class="empty">Aucun objectif. Appuie sur « + Nouvel objectif » pour créer ton premier projet.</div></section>';
    } else if (glView === 'list') {
      body = glSorted().map((g, i) => {
        const col = glColor(g, goals.indexOf(g)); const pct = Math.round(glProgress(g)); const done = glDone(g);
        const contrib = glContribution(g);
        return `<div class="gl-card clickable" data-gl-detail="${g.id}">
          <div class="gl-emo" style="background:${col}1a">${esc(g.e || '🎯')}</div>
          <div class="gl-body">
            <div class="gl-row1"><span class="gl-name">${g.primary ? '<span class="gl-star">★</span> ' : ''}${esc(g.n)}</span>${done ? '<span class="gl-done">✓</span>' : `<span class="gl-pct" style="color:${col}">${pct}%</span>`}</div>
            ${done ? `<div class="gl-amt"><b>${eur(g.target)}</b> · <span class="gl-done">Objectif atteint !</span></div>` : `<div class="gl-amt"><b>${eur(glCurrent(g))}</b> / ${eur(g.target)}</div>`}
            <div class="gl-bar"><span style="width:${Math.min(100, pct)}%;background:${col}"></span></div>
            <div class="gl-row3"><span>${g.targetDate ? 'Échéance : ' + dateLabelLong(g.targetDate).replace(/^\d+ /, '').replace(/(\w)\w* (\d{4})/, (m0, a, b) => m0) : (done ? 'Atteint' : 'Sans date')}</span><span class="contrib">${contrib > 0 ? eur(contrib) + ' /mois' : ''}</span></div>
          </div></div>`;
      }).join('');
    } else {
      // Tableau + résumé global + donut catégories
      const rows = glSorted().map((g) => { const col = glColor(g, goals.indexOf(g)); const pct = Math.round(glProgress(g)); const done = glDone(g); return `<div class="gl-trow clickable" data-gl-detail="${g.id}">
        <span class="te">${esc(g.e || '🎯')}</span><span class="tn">${esc(g.n)}</span>
        <span class="tc"><b>${eur(glCurrent(g))}</b><small>épargné</small></span>
        <span class="tc"><b>${eur(glRemaining(g))}</b><small>reste</small></span>
        <span class="tp" style="color:${done ? 'var(--gl-p4)' : col}">${done ? '✓' : pct + '%'}</span></div>`; }).join('');
      // Répartition par catégorie (part du montant cible)
      const catMap = {}; active.forEach((g, i) => { const c = g.cat || g.n; catMap[c] = (catMap[c] || 0) + num(g.target); });
      const catKeys = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a]);
      let acc = 0; const conic = catKeys.map((c, i) => { const p = targetSum ? catMap[c] / targetSum * 100 : 0; const seg = `${GL_COLORS[i % GL_COLORS.length]} ${acc}% ${acc + p}%`; acc += p; return seg; }).join(',');
      body = `<section class="card gl-tbl">${rows}</section>
        <div class="gl-ovh" style="margin-top:14px">Résumé global</div>
        <div class="gl-glob">
          <div class="gl-globc"><small>Total objectifs</small><b>${eur(targetSum)}</b></div>
          <div class="gl-globc"><small>Déjà épargné</small><b class="pos">${eur(currentSum)} · ${globalPct}%</b></div>
          <div class="gl-globc"><small>Reste à épargner</small><b>${eur(remainSum)}</b></div>
        </div>
        <section class="card" style="margin-top:12px"><div class="sec-head"><h2>Répartition par catégorie</h2></div>
          <div class="gl-donut-wrap"><div class="gl-donut" style="background:conic-gradient(${conic || '#e9efeb 0 100%'})"><div class="gl-donut-c"><div><b style="font-size:14px;color:var(--ink)">${active.length}</b><br>objectifs</div></div></div>
          <div class="gl-legl">${catKeys.slice(0, 6).map((c, i) => `<div class="gl-leg"><i style="background:${GL_COLORS[i % GL_COLORS.length]}"></i><span>${esc(c)}</span><b>${targetSum ? Math.round(catMap[c] / targetSum * 100) : 0}%</b></div>`).join('')}</div></div></section>`;
    }

    const archivedCard = archived.length ? `<details style="margin-top:6px"><summary class="link" style="cursor:pointer;padding:6px 2px">Objectifs terminés (${archived.length}) ›</summary>
      <section class="card" style="margin-top:8px">${archived.map(g => `<div class="gl-trow clickable" data-gl-detail="${g.id}"><span class="te">${esc(g.e || '🎯')}</span><span class="tn">${esc(g.n)}</span><span class="tc"><b>${eur(g.target)}</b><small>atteint</small></span><span class="tp pos">✓</span></div>`).join('')}</section></details>` : '';

    $('#view').innerHTML = `<div class="stack gl-page">
      <p class="gl-sub">Construis tes projets, un pas après l'autre.</p>
      <div class="sec-head" style="margin:0 2px"><button class="link" data-go="plus">‹ Retour</button><button class="action" style="width:auto;padding:9px 14px" data-add-goal>＋ Nouvel objectif</button></div>
      ${overview}${tabs}<div>${body}</div>${archivedCard}
    </div>`;
  }

  /* Détail objectif (fidèle maquette : montant, ring, reste, contribution, statut,
     scénarios "Et si ?", graphique projection, infos clés, actions). */
  function goalDetail(id) {
    const g = goals.find(x => x.id === id); if (!g) return;
    const i = goals.indexOf(g); const col = glColor(g, i);
    const cur = glCurrent(g), tgt = num(g.target), pct = Math.round(glProgress(g)), rem = glRemaining(g);
    const contrib = glContribution(g); const st = glStatus(g);
    const mt = glMonthsToTarget(g); const needed = glNeeded(g);
    const proj = glProjDate(g); const projTxt = proj ? proj.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '—';
    // ring SVG
    const R = 30, C = 2 * Math.PI * R, off = C * (1 - Math.min(1, pct / 100));
    const ring = `<svg class="gl-ring" viewBox="0 0 74 74"><circle cx="37" cy="37" r="${R}" fill="none" stroke="#eef2f0" stroke-width="7"/><circle cx="37" cy="37" r="${R}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 37 37)"/><text x="37" y="41" text-anchor="middle" font-size="15" font-weight="800" fill="${col}">${pct}%</text></svg>`;
    // scénarios Et si ?
    const baseC = contrib > 0 ? contrib : 50;
    const scn = [baseC, baseC + 25, baseC + 50, baseC + 100].map((c, idx) => {
      const pm = glProjMonths(g, c); const d = pm != null ? glAddMonths(pm) : null;
      const baseM = glProjMonths(g, baseC); const delta = (baseM != null && pm != null) ? baseM - pm : null;
      return `<div class="gl-scn ${idx === 0 ? 'cur' : ''}"><div><b>${eur(c)}/mois</b>${idx === 0 ? ' <small>(actuel)</small>' : ''}</div><div class="date">${d ? d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) : '—'}</div>${delta && idx > 0 ? `<div class="delta pos">−${delta} mois</div>` : '<div class="delta"></div>'}</div>`;
    }).join('');
    // graphique projection
    const chart = goalProjChart(g, col);
    // suivi lié
    const trackRows = glLinkedPocket(g) ? glMonthlyTracking(g, (svYear || year)).filter(r => r.planned > 0) : [];
    const retard = trackRows.reduce((s, r) => s + Math.max(r.planned - r.realized, 0), 0);

    openSheet('Détail de l\'objectif', `
      <div class="gl-d-head"><div class="gl-d-emo" style="background:${col}1a">${esc(g.e || '🎯')}</div><div style="flex:1;min-width:0"><b>${g.primary ? '★ ' : ''}${esc(g.n)}</b><small>${g.targetDate ? 'Échéance : ' + dateLabelLong(g.targetDate) + (mt != null ? ` (dans ${mt} mois)` : '') : 'Sans date cible'}</small></div><button class="link" data-edit-goal="${g.id}">Modifier</button></div>
      <div class="gl-d-main"><div class="gl-d-amt"><b>${eur(cur)}</b> <small>/ ${eur(tgt)}</small><div class="gl-d-rest">${glDone(g) ? '🎉 Objectif atteint' : eur(rem) + ' restants'}</div></div>${ring}</div>
      <div class="gl-d-bar gl-bar" style="height:8px"><span style="width:${Math.min(100, pct)}%;background:${col}"></span></div>
      <div style="margin-top:12px"><span class="gl-status gl-st-${st.cls}">${st.cls === 'ahead' ? '⏩' : st.cls === 'late' ? '⚠️' : st.cls === 'done' ? '🎉' : st.cls === 'ontime' ? '✓' : 'ℹ️'} ${st.label}</span></div>
      <div class="gl-d-3">
        <div class="k"><small>Contribution</small><b>${contrib > 0 ? eur(contrib) : '—'}</b></div>
        <div class="k"><small>Pour être à l'heure</small><b>${needed != null ? eur(needed) : '—'}</b></div>
        <div class="k"><small>Date estimée</small><b>${projTxt}</b></div>
      </div>
      ${contrib > 0 && needed != null && needed > contrib + 1 ? `<div class="insight" style="border-left-color:${col}">Il manque environ <b>${eur(needed - contrib)}/mois</b> pour tenir l'échéance.</div>` : ''}
      <div class="sec-head" style="margin-top:14px"><h2>Et si j'épargnais plus ?</h2></div>${scn}
      <div class="sec-head" style="margin-top:14px"><h2>Progression de l'objectif</h2></div>
      <section class="card">${chart}</section>
      ${trackRows.length ? `<div class="sec-head" style="margin-top:14px"><h2>Suivi mensuel</h2>${retard > 0 ? `<button class="link" data-sv-catchup>Rattraper ›</button>` : ''}</div>
        <section class="card">${trackRows.map(r => { const imp = r.realized >= r.planned ? '✓' : r.planned > 0 ? '+' + ((r.planned - r.realized) / Math.max(1, glContribution(g))).toFixed(1).replace('.', ',') + ' mois' : '—'; return `<div class="gl-mrow"><span class="mn">${ML[r.month].slice(0, 4)}.</span><span class="mc"><small>Prévu</small>${eur(r.planned)}</span><span class="mc"><small>Réalisé</small>${eur(r.realized)}</span><span class="mi ${r.realized >= r.planned ? 'pos' : 'neg'}">${imp}</span></div>`; }).join('')}</section>` : ''}
      <div class="sec-head" style="margin-top:14px"><h2>Informations clés</h2></div>
      <section class="card">
        ${g.cat ? `<div class="gl-info"><b>Catégorie</b><span>${esc(g.cat)}</span></div>` : ''}
        <div class="gl-info"><b>Date de création</b><span>${g.createdAt ? dateLabelLong(g.createdAt) : '—'}</span></div>
        ${glLinkedPocket(g) ? `<div class="gl-info"><b>Poche liée</b><span>${esc(glLinkedPocket(g).emoji)} ${esc(glLinkedPocket(g).name)}</span></div>` : ''}
        ${g.desc ? `<div class="gl-info"><b>Description</b><span>${esc(g.desc)}</span></div>` : ''}
      </section>
      <div class="gl-acts">
        <button class="ghost" data-gl-primary="${g.id}">${g.primary ? '★ Principal' : 'Définir principal'}</button>
        ${glDone(g) ? `<button class="ghost" data-gl-archive="${g.id}">${g.archived ? 'Désarchiver' : 'Archiver 🎉'}</button>` : `<button class="ghost" data-edit-goal="${g.id}">Modifier</button>`}
      </div>`);
  }

  function goalProjChart(g, col) {
    const cur = glCurrent(g), tgt = num(g.target), contrib = glContribution(g);
    const W = 320, H = 150, padL = 30, padR = 8, padT = 10, padB = 20, iw = W - padL - padR, ih = H - padT - padB;
    const months = contrib > 0 ? Math.min(24, Math.max(3, glProjMonths(g) || 12)) : 12;
    const pts = []; for (let i = 0; i <= months; i++) pts.push(Math.min(tgt || cur, cur + contrib * i));
    const maxV = Math.max(tgt || 1, ...pts, 1);
    const X = i => padL + (i / months) * iw, Y = v => padT + ih - (v / maxV) * ih;
    let grid = '', ylab = '';
    for (let gg = 0; gg <= 2; gg++) { const v = maxV * gg / 2, yy = Y(v); grid += `<line class="gl-grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`; ylab += `<text class="gl-axis" x="2" y="${(yy + 3).toFixed(1)}">${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)}</text>`; }
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const tgtY = Y(tgt || maxV);
    const xlab = `<text class="gl-axis" x="${padL}" y="${H - 6}">auj.</text><text class="gl-axis" text-anchor="end" x="${W - padR}" y="${H - 6}">${glProjDate(g) ? glProjDate(g).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) : '+' + months + ' m'}</text>`;
    return `<svg class="gl-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${grid}${ylab}<line class="gl-target-line" x1="${padL}" y1="${tgtY.toFixed(1)}" x2="${W - padR}" y2="${tgtY.toFixed(1)}"/><path class="gl-line-proj" d="${path}" style="stroke:${col}"/>${xlab}</svg>`;
  }

  const GL_EMOJIS = ['🏠', '✈️', '🚗', '🎓', '🎁', '🛟', '💍', '📷', '🛠️', '💻', '🏝️', '🎯'];
  function goalForm(id = '') {
    const g = id === '' ? {} : goals.find(x => x.id === id) || {};
    const curEmoji = g.e || '🎯';
    openSheet(id === '' ? 'Ajouter un objectif' : 'Modifier l\'objectif', `<form class="form" id="goalForm"><input type="hidden" name="itemId" value="${id}">
      <label>Icône</label>
      <div class="gl-emopick">${GL_EMOJIS.map(em => `<button type="button" class="${em === curEmoji ? 'on' : ''}" data-gl-emoji="${em}">${em}</button>`).join('')}</div>
      <input type="hidden" name="emoji" value="${esc(curEmoji)}">
      <label>Nom de l'objectif<input name="name" required value="${esc(g.n || '')}" placeholder="Ex : Voyage à New York"></label>
      <div class="two"><label>Montant cible (€)<input type="number" name="target" step="1" value="${num(g.target) || ''}"></label><label>Déjà épargné (€)<input type="number" name="current" step="1" value="${num(g.current) || ''}" ${g.linkedPocketId ? 'disabled' : ''}></label></div>
      ${g.linkedPocketId ? '<small class="subtle">Montant actuel dérivé de la poche liée.</small>' : ''}
      <label>Date cible<input type="date" name="targetDate" value="${g.targetDate || ''}"></label>
      <label>Contribution mensuelle prévue (€)<input type="number" name="contribution" step="1" value="${num(g.contribution) || ''}" ${g.linkedPocketId ? 'disabled' : ''}></label>
      <label>Poche d'épargne liée (optionnel)<select name="linkedPocketId"><option value="">— Aucune —</option>${(extra.pockets || []).map(p => `<option value="${p.id}" ${g.linkedPocketId === p.id ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select><small class="subtle">Si liée, l'objectif avance automatiquement avec ton épargne validée.</small></label>
      <label>Catégorie (optionnel)<input name="cat" value="${esc(g.cat || '')}" placeholder="Ex : Voyage"></label>
      <label>Description (optionnel)<textarea name="desc" rows="2">${esc(g.desc || '')}</textarea></label>
      <label><input type="checkbox" name="primary" ${g.primary ? 'checked' : ''}> Objectif principal (affiché sur l'Accueil)</label>
      <button class="action">${id === '' ? 'Créer' : 'Enregistrer'}</button>${id !== '' ? '<button type="button" class="ghost danger" data-delete-goal>Supprimer</button>' : ''}</form>`);
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
    const items = planItemsForISO(ds);
    let din = 0, dout = 0;
    items.forEach(x => { if (x.sign === '+') din += x.amount; else if (x.sign === '-') dout += x.amount; });
    const body = `<section class="card">${items.length ? items.map(planRow).join('') : '<div class="empty">Aucun événement ce jour.</div>'}</section>
      ${items.length ? `<div class="pl-sheet-tot"><span>Total du jour</span><span>${din ? '<b class="in">+' + eur(din) + '</b> ' : ''}${dout ? '<b class="out">-' + eur(dout) + '</b>' : ''}</span></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px">
        <button class="ghost" type="button" data-add-tx>＋ Dépense</button>
        <button class="action" type="button" data-add-event data-date="${ds}">＋ Événement</button>
      </div>`;
    openSheet(new Date(year, month, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), body);
  }

  function eventForm(i = '') {
    const ev = i === '' ? {} : (extra.events[+i] || {});
    openSheet(i === '' ? 'Ajouter un événement' : 'Modifier l’événement', `<form class="form" id="eventForm">
      <input type="hidden" name="idx" value="${i}">
      <label>Nom<input name="name" required value="${esc(ev.name || '')}" placeholder="Ex : Contrôle technique"></label>
      <div class="two"><label>Date<input type="date" name="date" required value="${ev.date || iso(year, month, planDay || 1)}"></label><label>Montant éventuel (€)<input type="number" step="0.01" name="amount" value="${num(ev.amount) || ''}" placeholder="Optionnel"></label></div>
      <label>Note<textarea name="note" rows="2">${esc(ev.note || '')}</textarea></label>
      <button class="action">Enregistrer</button>
      ${i !== '' ? '<button type="button" class="ghost danger" data-delete-event="' + i + '">Supprimer</button>' : ''}
    </form>`);
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
    const gld = e.target.closest('[data-gl-detail]'); if (gld) return goalDetail(gld.dataset.glDetail);
    const glv = e.target.closest('[data-gl-view]'); if (glv) { glView = glv.dataset.glView; render(); return; }
    if (e.target.closest('[data-gl-sort]')) { const order = ['progress', 'priority', 'date', 'amount']; glSort = order[(order.indexOf(glSort) + 1) % order.length]; render(); return; }
    const glp = e.target.closest('[data-gl-primary]'); if (glp) { const id = glp.dataset.glPrimary; goals.forEach(g => g.primary = (g.id === id) ? !g.primary : false); saveGoals(); closeSheet(); render(); toast('Objectif principal mis à jour'); return; }
    const gla = e.target.closest('[data-gl-archive]'); if (gla) { const g = goals.find(x => x.id === gla.dataset.glArchive); if (g) { g.archived = !g.archived; saveGoals(); closeSheet(); render(); toast(g.archived ? 'Objectif archivé 🎉' : 'Objectif réactivé'); } return; }
    const gle = e.target.closest('[data-gl-emoji]'); if (gle) { const f = $('#goalForm'); if (f) { f.querySelector('[name=emoji]').value = gle.dataset.glEmoji; $$('.gl-emopick button').forEach(b => b.classList.toggle('on', b === gle)); } return; }

    if (e.target.closest('[data-add-goal]')) return goalForm();
    const svv = e.target.closest('[data-validate-saving]'); if (svv) { const k = svv.dataset.validateSaving; if (svStatus(k).status === 'future') { toast('Mois à venir : pas encore de validation.'); return; } return savingsValidateSheet(k); }
    const svy = e.target.closest('[data-sv-year]'); if (svy) { svYear = (svYear || year) + (+svy.dataset.svYear); render(); return; }
    const svm = e.target.closest('[data-sv-mode]'); if (svm) { svChartMode = svm.dataset.svMode; render(); return; }
    if (e.target.closest('[data-sv-regularity]')) return savingsRegularitySheet();
    if (e.target.closest('[data-sv-catchup]')) return savingsCatchupSheet();
    const svmo = e.target.closest('[data-sv-mo]'); if (svmo) return savingsValidateSheet(svmo.dataset.svMo);
    const svq = e.target.closest('[data-sv-quick]'); if (svq) { const inp = $('#savingsValidateForm [name=amount]'); if (inp) inp.value = svq.dataset.svQuick; $$('.sv-quick button').forEach(b => b.classList.toggle('on', b === svq)); return; }
    const svn = e.target.closest('[data-sv-nothing]'); if (svn) { const k = svn.dataset.svNothing; const m = monthObj(k); svApplyAllocation(k, {}); m.savings = { amount: 0, paid: true, date: today(), planned: svPlanned(k), alloc: {} }; saveBudget(); closeSheet(); render(); toast('Mois marqué : rien épargné'); return; }
    const svc = e.target.closest('[data-cancel-validation]'); if (svc) { const k = svc.dataset.cancelValidation; const m = budget.monthlyData[k]; if (m && m.savings) { svApplyAllocation(k, {}); const prev = { ...m.savings }; m.savings = { amount: 0, paid: false, date: '', planned: m.savings.planned }; saveBudget(); closeSheet(); render(); toast('Validation annulée', () => { m.savings = prev; svApplyAllocation(k, prev.alloc || {}); saveBudget(); render(); }); } return; }
    const svac = e.target.closest('[data-sv-apply-catchup]'); if (svac) { extra.savingsCatchup = { total: savingsEngine(svYear).retardNet, perMonth: num(svac.dataset.permonth), months: +svac.dataset.svApplyCatchup, startKey: svRealKey() }; saveExtra(); closeSheet(); render(); toast('Plan de rattrapage activé'); return; }
    if (e.target.closest('[data-sv-clear-catchup]')) { extra.savingsCatchup = null; saveExtra(); closeSheet(); render(); toast('Plan de rattrapage annulé'); return; }

    if (e.target.closest('[data-edit-month-saving]')) return savingsValidateSheet(key());
    if (e.target.closest('[data-edit-coverage-target]')) { const v = prompt('Objectif de couverture (en mois)', extra.coverageTargetMonths); if (v !== null && num(v) > 0) { extra.coverageTargetMonths = num(v); saveExtra(); render(); } return; }
    if (e.target.closest('[data-open-exchange]')) return exchangeForm();
    if (e.target.closest('[data-edit-strategy]')) return strategyForm();
    if (e.target.closest('[data-add-pocket]')) { const p = { id: uid('pk'), name: 'Nouvelle poche', emoji: '💶', balance: 0, monthlyTarget: 0 }; extra.pockets.push(p); saveExtra(); pocketForm(p.id); return; }
    if (e.target.closest('[data-open-transfer]')) return transferForm();
    if (e.target.closest('[data-make-backup]')) { snapshotNow('Sauvegarde manuelle', false); render(); return; }
    if (e.target.closest('[data-restore-backup]')) { const id = e.target.closest('[data-restore-backup]').dataset.restoreBackup; if (confirm('Restaurer cette sauvegarde ? Ton état actuel sera lui aussi sauvegardé avant.')) { if (restoreSnapshot(id)) { alert('Sauvegarde restaurée. La page va se recharger.'); location.reload(); } } return; }
    const anoe = e.target.closest('[data-an-open-exp]'); if (anoe) { const [y, mo] = anoe.dataset.anOpenExp.split('-').map(Number); year = y; month = mo - 1; saveBudget(); return txForm('expense', anoe.dataset.anOpenIdx); }
    const anp = e.target.closest('[data-an-period]'); if (anp) { anPeriod = anp.dataset.anPeriod; if (anPeriod === 'year' && anYear == null) anYear = year; anTip = null; render(); return; }
    const any = e.target.closest('[data-an-year]'); if (any) { anYear = (anYear || year) + (+any.dataset.anYear); render(); return; }
    const ant = e.target.closest('[data-an-toggle]'); if (ant) { const k = ant.dataset.anToggle; anHidden[k] = !anHidden[k]; render(); return; }
    const anpt = e.target.closest('[data-an-pt]'); if (anpt) { const E = analysisEngine(anPeriod); const pts = anChartPoints(E); const i = +anpt.dataset.anPt; if (anTip === i && pts[i] && pts[i].key && pts[i].has !== false && anPeriod !== 'month') { return anMonthSheet(pts[i].key); } anTip = i; render(); return; }
    const anc = e.target.closest('[data-an-cat]'); if (anc) return anCategorySheet(anc.dataset.anCat);
    const anm = e.target.closest('[data-an-month]'); if (anm) return anMonthSheet(anm.dataset.anMonth);
    const angm = e.target.closest('[data-an-goto-month]'); if (angm) { const [y, mo] = angm.dataset.anGotoMonth.split('-').map(Number); year = y; month = mo - 1; saveBudget(); closeSheet(); page = 'analysis'; render(); return; }
    if (e.target.closest('[data-an-help]')) return openSheet('Comment lire l\'Analyse', `<div class="insight" style="margin-bottom:10px"><b style="color:var(--an-green)">Revenus</b> = argent réellement reçu (payé/auto).</div><div class="insight" style="margin-bottom:10px"><b style="color:var(--an-red)">Dépenses</b> = argent réellement payé (coché).</div><div class="insight" style="margin-bottom:10px"><b style="color:var(--an-blue)">Conservé</b> = revenus reçus − dépenses payées.</div><div class="insight"><b>Taux de conservation</b> = conservé ÷ revenus reçus. L'analyse utilise le <b>réel</b>, jamais le prévu, et n'invente aucun mois manquant.</div>`);

    if (e.target.closest('[data-cat-detail]')) return categoryDetail(e.target.closest('[data-cat-detail]').dataset.catDetail);
    if (e.target.closest('[data-whatif-remove]')) return whatIfRemoveSheet(e.target.closest('[data-whatif-remove]').dataset.whatifRemove);
    const back = e.target.closest('[data-back-to-tx]'); if (back) return txForm(back.dataset.backToTx, back.dataset.index);

    const pv = e.target.closest('[data-plan-view]'); if (pv) { planView = pv.dataset.planView; render(); return; }
    const pf = e.target.closest('[data-plan-filter]'); if (pf) { planFilter = pf.dataset.planFilter; render(); return; }
    if (e.target.closest('[data-plan-today]')) { const t = new Date(); year = t.getFullYear(); month = t.getMonth(); planDay = t.getDate(); saveBudget(); render(); return; }
    const pc = e.target.closest('[data-plan-cursor]'); if (pc) { const [Y, M, D] = pc.dataset.planCursor.split('-').map(Number); year = Y; month = M - 1; planDay = D; planView = 'day'; saveBudget(); render(); return; }
    const ps = e.target.closest('[data-plan-shift]'); if (ps) { const dir = +ps.dataset.planShift; if (planView === 'month') { month += dir; if (month < 0) { month = 11; year--; } if (month > 11) { month = 0; year++; } planDay = 1; } else { const step = planView === 'week' ? 7 : 1; const dt = new Date(year, month, (planDay || 1) + dir * step); year = dt.getFullYear(); month = dt.getMonth(); planDay = dt.getDate(); } saveBudget(); render(); return; }
    const pg = e.target.closest('[data-plan-goto]'); if (pg) { const [Y, M] = pg.dataset.planGoto.split('-').map(Number); year = Y; month = M - 1; planDay = 1; planView = 'month'; saveBudget(); closeSheet(); render(); return; }
    const pdd = e.target.closest('[data-plan-day-detail]'); if (pdd) return dayDetails(+pdd.dataset.planDayDetail);
    const aev = e.target.closest('[data-add-event]'); if (aev) { if (aev.dataset.date) { const [Y, M, D] = aev.dataset.date.split('-').map(Number); year = Y; month = M - 1; planDay = D; } return eventForm(); }
    const eev = e.target.closest('[data-edit-event]'); if (eev) return eventForm(eev.dataset.editEvent);
    const dev = e.target.closest('[data-delete-event]'); if (dev) { if (confirm('Supprimer cet événement ?')) { extra.events.splice(+dev.dataset.deleteEvent, 1); saveExtra(); closeSheet(); render(); } return; }

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
    if (e.target.id === 'eventForm') { const i = fd.get('idx'); const o = { id: (i !== '' && extra.events[+i]?.id) || uid('ev'), name: (fd.get('name') || '').trim(), date: fd.get('date'), amount: num(fd.get('amount')), note: (fd.get('note') || '').trim() }; if (i === '') extra.events.push(o); else extra.events[+i] = o; saveExtra(); closeSheet(); render(); toast('Événement enregistré'); return; }
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
      const linkedPocketId = fd.get('linkedPocketId') || '';
      const o = {
        id: id || uid('g'), n: fd.get('name').trim(), e: fd.get('emoji') || '🎯',
        target: num(fd.get('target')),
        current: linkedPocketId ? (existing ? num(existing.current) : 0) : num(fd.get('current')),
        targetDate: fd.get('targetDate') || '',
        contribution: linkedPocketId ? (existing ? num(existing.contribution) : 0) : num(fd.get('contribution')),
        linkedPocketId, cat: (fd.get('cat') || '').trim(), desc: (fd.get('desc') || '').trim(),
        primary: fd.get('primary') === 'on',
        priority: existing?.priority || 'mid', archived: existing?.archived || false, color: existing?.color || '',
        createdAt: existing?.createdAt || today()
      };
      if (o.primary) goals.forEach(g => { if (g.id !== o.id) g.primary = false; });
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
    if (e.target.id === 'savingsValidateForm') {
      const k = fd.get('key'); const m = monthObj(k);
      const amount = Math.max(0, num(fd.get('amount')));
      const pocketId = fd.get('pocket');
      const prev = m.savings ? { ...m.savings } : null;
      const alloc = pocketId ? { [pocketId]: amount } : {};
      svApplyAllocation(k, alloc); // idempotent : révoque l'ancienne affectation avant d'appliquer la nouvelle
      m.savings = { amount, paid: true, date: fd.get('date') || today(), planned: svPlanned(k), alloc };
      saveBudget(); closeSheet(); render();
      toast(`Épargne de ${ML[+k.slice(5, 7) - 1].toLowerCase()} validée : ${eur(amount)}`, prev ? () => { svApplyAllocation(k, prev.alloc || {}); m.savings = prev; saveBudget(); render(); } : null);
      return;
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
