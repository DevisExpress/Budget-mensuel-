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
  let txFilter = 'all';
  let planningRange = 30;
  let stratPreviewRate = null; // overrides extra.strategy.rate for live "et si" preview only
  const key = () => `${year}-${p2(month + 1)}`;

  function saveBudget() { budget.currentYear = year; budget.currentMonth = month; budget.schema = SCHEMA_VERSION; try { localStorage.setItem(KEY_BUDGET, JSON.stringify(budget)); } catch {} }
  // Persiste immédiatement si une migration de schéma vient d'avoir lieu, pour ne pas
  // la relancer (et resnapshot) à chaque chargement tant qu'aucune autre action n'a sauvegardé.
  if (budget.__justMigrated) { delete budget.__justMigrated; saveBudget(); }
  function saveExtra() { try { localStorage.setItem(KEY_EXTRA, JSON.stringify(extra)); } catch {} }
  function saveGoals() { try { localStorage.setItem(KEY_GOALS, JSON.stringify(goals)); } catch {} }

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
      list.push({
        name: ov?.name || t.name,
        amount: num(ov ? ov.amount : t.amount),
        cat: ov?.cat || t.cat || 'autres',
        paid: false, paidDate: '',
        dueDate: t.kind === 'income' ? '' : `${k}-${p2(day)}`,
        templateId: t.id, recurring: true, auto: !!t.auto, createdPeriod: k
      });
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
  function simulateStrategy(capital, monthly, ratePct, maxMonths = 1200) {
    const rate = Math.max(0, num(ratePct)) / 100;
    const annual = monthly * 12;
    let c = capital, months = 0, basculeMonth = null, accelMonth = null;
    const mr = Math.pow(1 + rate, 1 / 12) - 1;
    const yearly = [];
    while (months <= maxMonths) {
      const gain = c * rate;
      if (basculeMonth == null && annual > 0 && gain >= annual) basculeMonth = months;
      if (accelMonth == null && annual > 0 && gain >= annual * 2) accelMonth = months;
      if (months % 12 === 0) yearly.push({ year: months / 12, capital: c });
      if (basculeMonth != null && accelMonth != null && months / 12 >= 30) break;
      c = c * (1 + mr) + monthly;
      months++;
    }
    return { annual, rate, basculeMonth, accelMonth, yearly, finalCapital: c };
  }

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
    const sim = simulateStrategy(capital, monthly, rate);
    const gain = capital * (rate / 100);
    const progress = sim.annual > 0 ? Math.min(999, (gain / sim.annual) * 100) : 0;
    const target = rate > 0 ? sim.annual / (rate / 100) : 0;
    const annualExp = annualExpensesEstimate();
    const libertyPct = annualExp > 0 ? Math.round((gain / annualExp) * 100) : 0;
    return {
      capital, monthly, rate, annual: sim.annual, target, gain, progress,
      basculeMonths: sim.basculeMonth, accelMonths: sim.accelMonth,
      dailyGain: gain / 365, monthlyGain: gain / 12,
      libertyPct, annualExpenses: annualExp
    };
  }

  function monthsToText(m) { if (m == null) return 'Horizon non calculable'; const y = Math.floor(m / 12), mm = m % 12; if (y <= 0) return `${mm} mois`; if (mm === 0) return `${y} an${y > 1 ? 's' : ''}`; return `${y} an${y > 1 ? 's' : ''} et ${mm} mois`; }
  function monthsToDate(m) { if (m == null) return '—'; const d = new Date(); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); }

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
    const fn = {
      home: renderHome, transactions: renderTransactions, planning: renderPlanning, analysis: renderAnalysis,
      savings: renderSavings, goals: renderGoals, strategy: renderStrategy, plus: renderPlus,
      birthdays: renderBirthdays, installments: renderInstallments, annual: renderAnnual, exchanges: renderExchanges,
      backups: renderBackups
    }[page] || renderHome;
    fn();
    updateBadge();
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
  function renderHome() {
    setTitle('Budget Orion');
    const t = totals();
    const bds = extra.birthdays.map(b => ({ b, n: birthdayNext(b) })).filter(x => x.n && x.n.days <= 45).sort((a, b) => a.n.days - b.n.days);
    const up = upcomingExpenses().slice(0, 3);
    const goal = goals[0];
    const gp = goal && num(goal.target) ? Math.min(100, Math.round((num(goal.current) / num(goal.target)) * 100)) : 0;
    const pct = Math.max(0, Math.min(100, t.paidPct));
    const engaged = t.future; // prélèvements restant à venir ce mois-ci
    const dispoReel = t.current - Math.max(0, engaged);

    $('#view').innerHTML = `<div class="stack">
      <section class="hero">
        <div class="ring" style="--pct:${pct}%"><b>${pct}%</b></div>
        <div class="label">Solde actuel</div>
        <strong class="clickable" data-edit-month-saving>${eur(t.current)}</strong>
        <small>Revenus reçus ${eur(t.pin)} · dépenses prélevées ${eur(t.pex)}</small>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <div class="hero-sub"><span>À payer : ${eur(t.future)}</span><span>Fin de mois : ${eur(t.final)}</span></div>
      </section>

      <section class="card engaged-card clickable" data-go="planning">
        <div class="sec-head"><h2>Argent déjà engagé</h2></div>
        <div class="engaged-row"><span>Compte</span><b>${eur(t.current)}</b></div>
        <div class="engaged-row"><span>Prélèvements restant à venir</span><b class="neg">- ${eur(Math.max(0, engaged))}</b></div>
        <div class="engaged-row total"><span>Disponible réel estimé</span><b class="${dispoReel >= 0 ? 'pos' : 'neg'}">${eur(dispoReel)}</b></div>
      </section>

      ${insightsBlock()}

      ${bds.length ? `<div><div class="sec-head"><h2>Prévisions &amp; Anticipations</h2><button class="link" data-go="planning">Voir tout ›</button></div>
        <section class="card anticip" data-go="birthdays"><div class="big">🎂 Anniversaires</div><div class="meta">À venir · ${esc(bds[0].b.name)}</div><div class="days">${bds[0].n.days === 0 ? 'Aujourd’hui' : bds[0].n.days + ' jours restants'}</div><div class="meta">Âge : ${bds[0].n.age} ans · Budget ${eur(bds[0].b.budget)}</div></section></div>` : ''}

      <div><div class="sec-head"><h2>À venir cette semaine</h2></div>
      <section class="card upcoming">${up.length ? up.map(r => rowTx(r, 'expense', monthObj().expenses.indexOf(r))).join('') : '<div class="empty">Aucune dépense prévue cette semaine.</div>'}</section></div>

      <div class="quick-row">
        <button class="quick-chip" data-go="goals">🎯 Objectifs</button>
        <button class="quick-chip" data-go="strategy">↗ Ma stratégie</button>
        <button class="quick-chip" data-go="savings">🐷 Épargne</button>
      </div>

      ${goal ? `<section class="hero savings-home-card clickable" data-go="goals">
        <div class="savings-home-head"><div><div class="label">🎯 Objectif d’épargne</div><b class="savings-home-name">${esc(goal.n || 'Mon objectif')}</b></div><span class="edit-chip">Voir ›</span></div>
        <strong style="font-size:18px">${eur(goal.current)} <small>/ ${eur(goal.target)}</small></strong>
        <div class="progress"><span style="width:${gp}%"></span></div>
        <div class="hero-sub"><span>${gp}% atteint</span><span>Toucher pour régler ›</span></div>
      </section>` : `<section class="card savings-empty-home clickable" data-go="goals"><div><b>🎯 Objectif d’épargne</b><small>Crée un objectif pour suivre ton projet.</small></div><span>＋</span></section>`}
    </div>`;
  }

  function renderTransactions() {
    setTitle('Dépenses');
    const m = monthObj();
    let rows = [];
    (m.income || []).forEach((r, i) => rows.push({ r, t: 'income', i }));
    (m.expenses || []).forEach((r, i) => rows.push({ r, t: 'expense', i }));
    if (txFilter !== 'all') rows = rows.filter(x => x.t === txFilter);
    $('#view').innerHTML = `<div class="stack transactions-page">
      <div class="monthbar"><select id="mSel">${ML.map((x, i) => `<option value="${i}" ${i === month ? 'selected' : ''}>${x}</option>`).join('')}</select><select id="ySel">${[year - 1, year, year + 1].map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div class="summary"><div><small>Solde actuel</small><small style="display:block;color:var(--mut)">Fin de mois estimée : ${tSign(totals().final)}</small></div><strong>${tSign(totals().current)}</strong></div>
      <div class="tabs"><button data-filter="all" class="${txFilter === 'all' ? 'active' : ''}">Toutes</button><button data-filter="income" class="${txFilter === 'income' ? 'active' : ''}">Revenus</button><button data-filter="expense" class="${txFilter === 'expense' ? 'active' : ''}">Dépenses</button></div>
      <section class="card list">${rows.length ? rows.map(x => rowTx(x.r, x.t, x.i)).join('') : '<div class="empty">Aucune transaction.</div>'}</section>
    </div><button class="tx-fab" data-add-tx aria-label="Ajouter une transaction"><span>＋</span><b>Ajouter</b></button>`;
  }

  function eventsForDay(y, m2, d) {
    const ds = iso(y, m2, d), a = [];
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
    const p10 = projectCapital(10, x.capital, x.monthly, x.rate), p20 = projectCapital(20, x.capital, x.monthly, x.rate), p30 = projectCapital(30, x.capital, x.monthly, x.rate);

    $('#view').innerHTML = `<div class="stack">
      <div class="sec-head"><button class="link" data-go="plus">‹ Retour</button><button class="mini-action" data-edit-strategy>Modifier</button></div>

      <div class="tabs scenario-tabs">
        <button data-scenario="5" class="${rate === 5 ? 'active' : ''}">Prudent 5%</button>
        <button data-scenario="7" class="${rate === 7 ? 'active' : ''}">Central 7%</button>
        <button data-scenario="10" class="${rate === 10 ? 'active' : ''}">Dynamique 10%</button>
      </div>

      <section class="card strategy-hero clickable-card" data-edit-strategy>
        <small>POINT DE BASCULE</small>
        <div class="strategy-number">${x.target ? eur(x.target) : '—'}</div>
        <div class="subtle">Capital où le rendement annuel ≈ tes versements annuels.</div>
        <div class="strategy-track" style="margin-top:14px"><span style="width:${Math.min(100, x.progress)}%"></span></div>
        <div class="hero-sub" style="color:var(--ink);margin-top:7px"><span>${Math.round(x.progress)}% atteint</span><span>${monthsToText(x.basculeMonths)} · ${monthsToDate(x.basculeMonths)}</span></div>
      </section>

      <div class="strategy-grid">
        <div class="strategy-kpi clickable-card" data-edit-strategy><small>Capital actuel</small><b>${eur(x.capital)}</b></div>
        <div class="strategy-kpi clickable-card" data-edit-strategy><small>Versement mensuel</small><b>${eur(x.monthly)}</b></div>
        <div class="strategy-kpi clickable-card" data-edit-strategy><small>Rendement estimé</small><b>${x.rate.toFixed(1).replace('.', ',')} % / an</b></div>
        <div class="strategy-kpi"><small>Capital généré / an</small><b>${eur(x.gain)}</b></div>
      </div>

      <section class="card"><div class="sec-head"><h2>Ton argent travaille pour toi</h2></div>
        <div class="scenario-row"><span>Tu investis</span><b>${eur(x.annual)}</b><small>/ an</small></div>
        <div class="scenario-row"><span>Ton capital génère</span><b class="pos">${eur(x.gain)}</b><small>/ an</small></div>
        <div class="scenario-row"><span>Soit</span><b class="pos">${eur(x.monthlyGain)}</b><small>/ mois</small></div>
        <div class="scenario-row"><span>Soit</span><b class="pos">${eur(x.dailyGain)}</b><small>/ jour</small></div>
        <div class="insight" style="margin-top:10px">Ton capital fournit actuellement <b>${Math.round(x.progress)}%</b> de ton effort annuel d’investissement.</div>
      </section>

      <section class="premium-note"><b>⚡ Point d’accélération</b>
        <div class="subtle" style="margin-top:4px">Moment où ton capital génère 2× tes versements annuels.</div>
        <div class="strategy-number" style="font-size:22px;margin-top:6px">${monthsToText(x.accelMonths)}</div>
        <div class="subtle">${x.accelMonths != null ? 'Estimation : ' + monthsToDate(x.accelMonths) : ''}</div>
      </section>

      <section class="card"><div class="sec-head"><h2>Taux de liberté financière</h2></div>
        <div class="strategy-number" style="font-size:26px">${x.libertyPct}%</div>
        <div class="subtle">De tes dépenses annuelles (${eur(x.annualExpenses)}) sont théoriquement couvertes par ton capital.</div>
      </section>

      <section class="card"><div class="sec-head"><h2>Projection</h2></div>
        ${[[10, p10], [20, p20], [30, p30]].map(a => `<div class="scenario-row"><span>Dans ${a[0]} ans</span><b>${eur(a[1])}</b><small>à ${x.rate.toFixed(1)}%</small></div>`).join('')}
        <small class="subtle">Simulation indicative : le rendement réel n’est pas garanti.</small>
      </section>

      <section class="card"><div class="sec-head"><h2>Et si j’investissais plus ?</h2></div>
        <div class="two"><label>Versement supplémentaire (€/mois)<input type="number" id="whatifStratInput" min="0" step="10" value="100"></label><div></div></div>
        <div id="whatifStratResult" class="insight" style="margin-top:8px">${whatIfStrategyText(100, x)}</div>
      </section>
    </div>`;
  }

  function whatIfStrategyText(delta, base) {
    const withDelta = simulateStrategy(base.capital, base.monthly + num(delta), base.rate);
    const gainedMonths = (base.basculeMonths ?? 0) - (withDelta.basculeMonth ?? 0);
    return `+${eur(delta)}/mois → point de bascule atteint ${gainedMonths > 0 ? gainedMonths + ' mois plus tôt' : 'à la même échéance environ'} (${monthsToText(withDelta.basculeMonth)}). Capital à 20 ans : ${eur(projectCapital(20, base.capital, base.monthly + num(delta), base.rate))}.`;
  }

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
    openSheet('Régler Ma stratégie', `<form class="form" id="strategyForm">
      <label>Capital déjà investi (€)<input type="number" min="0" step="0.01" name="capital" value="${num(s.capital)}"></label>
      <label>Versement mensuel (€)<input type="number" min="0" step="0.01" name="monthly" value="${num(s.monthly)}"></label>
      <label>Rendement annuel estimé (%)<input type="number" min="0" max="50" step="0.1" name="rate" value="${num(s.rate)}"></label>
      <div class="insight">Le point de bascule correspond au moment où le rendement annuel théorique devient supérieur ou égal à tes versements annuels. Ces projections ne garantissent aucun rendement futur.</div>
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
    if (tog) { const arr = tog.dataset.toggle === 'income' ? monthObj().income : monthObj().expenses; const item = arr[+tog.dataset.index]; if (item && !isAutoIncome(item)) { item.paid = !item.paid; item.paidDate = item.paid ? today() : ''; saveBudget(); render(); } return; }

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
    if (e.target.id === 'whatifStratInput') { const rate = stratPreviewRate != null ? stratPreviewRate : num(extra.strategy?.rate); $('#whatifStratResult').innerHTML = whatIfStrategyText(num(e.target.value), strategyCalc(rate)); }
    if (e.target.id === 'txName') { const brandHint = document.querySelector('.brand-hint'); const b = brandOf(e.target.value, $('#txForm')?.cat?.value); if (brandHint) { if (b.matched) { brandHint.innerHTML = `<span class="brandmark ${b.cls}">${b.mark}</span> Reconnu : <b>${esc(b.label)}</b>`; brandHint.style.display = ''; } else brandHint.style.display = 'none'; } }
  });

  document.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (e.target.id === 'txForm') return saveTx(fd);
    if (e.target.id === 'strategyForm') { extra.strategy = { capital: Math.max(0, num(fd.get('capital'))), monthly: Math.max(0, num(fd.get('monthly'))), rate: Math.max(0, num(fd.get('rate'))) }; stratPreviewRate = null; saveExtra(); closeSheet(); page = 'strategy'; render(); return; }
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
    if (e.target.id === 'ySel') { year = +e.target.value; saveBudget(); render(); }
  });

  window.addEventListener('error', e => console.error('Budget Orion', e.error || e.message));

  render();
})();
