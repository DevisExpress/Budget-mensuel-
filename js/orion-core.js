/* Budget Orion: validation, money arithmetic and recoverable local commits. */
(function (root) {
  'use strict';
  const JOURNAL = 'orion_transaction_v1';
  const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const copy = x => JSON.parse(JSON.stringify(x));
  const cents = x => Math.sign(Number(x)||0)*Math.round(Math.abs(Number(x)||0)*100+1e-7);
  const money = x => cents(x) / 100;
  function invalid(path) { throw new Error('Fichier incompatible : ' + path + '. Aucune donnée remplacée.'); }
  function number(x, path) {
    if (x != null && (typeof x !== 'number' && typeof x !== 'string' || x === '' || !Number.isFinite(Number(x)) || Math.abs(Number(x)) > 1e12)) invalid(path);
  }
  function date(x, path, monthOnly = false) {
    if (x == null || x === '') return;
    if (typeof x !== 'string' || !(monthOnly ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).test(x)) invalid(path);
    if (!monthOnly) {
      const d = new Date(x + 'T12:00:00');
      if (!Number.isFinite(+d) || d.getDate() !== +x.slice(8) || d.getMonth() + 1 !== +x.slice(5, 7)) invalid(path);
    }
  }
  function inspect(value, depth = 0) {
    if (depth > 40) invalid('structure trop profonde');
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(k)) invalid('clé interdite');
        if (['id', 'templateId', 'linkedPocketId', 'sourceEventId'].includes(k) && v != null && v !== '' && (typeof v !== 'string' || !/^[\w:.-]{1,150}$/.test(v))) invalid(k);
        if (['emoji', 'e', 'customEmoji'].includes(k) && v != null && (typeof v !== 'string' || v.length > 32 || /[<>"&]/.test(v))) invalid(k);
        inspect(v, depth + 1);
      }
    }
  }
  function arrayObjects(value, path, check) {
    if (!Array.isArray(value)) invalid(path);
    value.forEach((x, i) => { if (!record(x)) invalid(path + '[' + i + ']'); if (check) check(x, path + '[' + i + ']'); });
  }
  function transaction(r, path) {
    if (r.name != null && typeof r.name !== 'string') invalid(path + '.name');
    number(r.amount, path + '.amount');
    if (r.paid != null && typeof r.paid !== 'boolean') invalid(path + '.paid');
    for (const k of ['dueDate', 'paidDate']) date(r[k], path + '.' + k);
  }
  function month(m, path) {
    if (!record(m)) invalid(path);
    for (const k of ['income', 'expenses']) if (m[k] !== undefined) arrayObjects(m[k], path + '.' + k, transaction);
    if (m.savings != null) {
      if (!record(m.savings)) invalid(path + '.savings');
      number(m.savings.amount, path + '.savings.amount');
      if (m.savings.paid != null && typeof m.savings.paid !== 'boolean') invalid(path + '.savings.paid');
      if (m.savings.fromAccount != null && typeof m.savings.fromAccount !== 'boolean') invalid(path + '.savings.fromAccount');
      date(m.savings.date, path + '.savings.date');
      if (m.savings.alloc != null) { if (!record(m.savings.alloc)) invalid(path + '.savings.alloc'); Object.values(m.savings.alloc).forEach(x => number(x, path + '.alloc')); }
    }
    if (m.meta != null) {
      if (!record(m.meta)) invalid(path + '.meta'); number(m.meta.openingBalance, path + '.openingBalance');
      if (m.meta.categoryBudgets != null) { if (!record(m.meta.categoryBudgets)) invalid(path + '.categoryBudgets'); Object.values(m.meta.categoryBudgets).forEach(x => number(x, path + '.categoryBudgets')); }
    }
  }
  function validateBudget(b) {
    if (!record(b)) invalid('budget');
    if (b.schema != null && (!Number.isInteger(+b.schema) || +b.schema < 0 || +b.schema > 6)) invalid('version du budget');
    if (b.currentMonth != null && (!Number.isInteger(+b.currentMonth) || +b.currentMonth < 0 || +b.currentMonth > 11)) invalid('mois');
    if (b.currentYear != null && (!Number.isInteger(+b.currentYear) || +b.currentYear < 1900 || +b.currentYear > 2200)) invalid('année');
    if (b.monthlyData != null) {
      if (!record(b.monthlyData)) invalid('monthlyData');
      for (const [k, m] of Object.entries(b.monthlyData)) { date(k, 'période', true); month(m, k); }
    }
    if (b.months != null) { if (!record(b.months) && !Array.isArray(b.months)) invalid('months'); Object.entries(b.months).forEach(([k,m]) => month(m, k)); }
    if (b.years != null) { if (!record(b.years)) invalid('years'); Object.values(b.years).forEach(y => { if (!record(y) || !y.months) invalid('years.months'); Object.entries(y.months).forEach(([k,m]) => month(m,k)); }); }
    if (b.recurringTemplates != null) arrayObjects(b.recurringTemplates, 'récurrences', (t,p) => {
      transaction(t,p); date(t.startDate, p + '.startDate'); date(t.endDate,p + '.endDate');
      if (!['expense','income'].includes(t.kind)) invalid(p + '.kind');
      for (const k of ['interval','installments','dueDay']) number(t[k],p + '.' + k);
      if (t.skipMonths != null) { if (!Array.isArray(t.skipMonths)) invalid(p + '.skipMonths'); t.skipMonths.forEach(k=>date(k,p,true)); }
      if (t.overrides != null) { if (!record(t.overrides)) invalid(p + '.overrides'); Object.entries(t.overrides).forEach(([k,v])=>{date(k,p,true); if (!record(v)) invalid(p);transaction(v,p);}); }
    });
  }
  function validateBackup(obj, includeHistory = true) {
    if (!record(obj) || !['budget','goals','extra'].some(k => obj[k] != null)) invalid('contenu du fichier');
    inspect(obj);
    if(obj.schema!=null && (!Number.isInteger(+obj.schema)||+obj.schema>6||+obj.schema<0))invalid('version de sauvegarde');
    if (obj.budget != null) validateBudget(obj.budget);
    if (obj.goals != null) arrayObjects(obj.goals, 'objectifs', (g,p) => { for (const k of ['target','current','contribution','t','c']) number(g[k],p+'.'+k); date(g.targetDate,p+'.targetDate');for(const k of ['n','desc','cat'])if(g[k]!=null&&typeof g[k]!=='string')invalid(p+'.'+k);if(g.color && !/^#[0-9a-f]{6}$/i.test(g.color))invalid(p+'.color'); });
    if (obj.extra != null) {
      if (!record(obj.extra)) invalid('extra');
      for (const k of ['birthdays','exchanges','events','pockets','categories']) if (obj.extra[k] != null) arrayObjects(obj.extra[k], k, (x,p)=> {
        for (const n of ['amount','balance','monthlyTarget','budget','reminder']) number(x[n],p+'.'+n);
        for (const n of ['date','birthDate']) date(x[n],p+'.'+n);
        if (k==='categories' && (typeof x.id!=='string'||typeof x.name!=='string'||/[<>]/.test(x.name)))invalid(p);
        if (x.name != null && typeof x.name !== 'string') invalid(p+'.name');
      });
      for (const k of ['strategy','notifications','savingsCatchup']) if (obj.extra[k] != null && !record(obj.extra[k])) invalid(k);
      if (obj.extra.strategy) for (const k of ['capital','monthly','rate','horizon','emergencyFund']) number(obj.extra.strategy[k],'strategy.'+k);
      if (obj.extra.notifications?.leadDays != null && (!Array.isArray(obj.extra.notifications.leadDays) || obj.extra.notifications.leadDays.some(x=> !Number.isInteger(x) || x<0 || x>30))) invalid('notifications.leadDays');
    }
    if (includeHistory && obj.backups != null) arrayObjects(obj.backups, 'sauvegardes', (bk,p)=> {
      if (!record(bk.data)) invalid(p+'.data');
      const allowed = ['bgt4','budgetV3','budgetV2','orion_plus_v6','orion_plus_v4','orion_plus_v3','orion_v21_goals'];
      for (const [key, value] of Object.entries(bk.data)) {
        if (!allowed.includes(key) || typeof value !== 'string') invalid(p+'.data');
        let parsed; try {parsed=JSON.parse(value);}catch{invalid(p+'.data JSON');}
        const type = key.includes('goals') ? 'goals' : key.startsWith('orion_plus') ? 'extra' : 'budget';
        validateBackup({[type]:parsed},false);
      }
    });
    return copy(obj);
  }
  function normalizeBudget(raw) {
    const b=copy(raw);
    if(b.currentYear!=null)b.currentYear=+b.currentYear;if(b.currentMonth!=null)b.currentMonth=+b.currentMonth;
    b.monthlyData=b.monthlyData||{};
    if (!Object.keys(b.monthlyData).length && b.years) for(const [y,obj] of Object.entries(b.years)) for(const [m,v] of Object.entries(obj.months)) b.monthlyData[`${y}-${String(+m+1).padStart(2,'0')}`]=v;
    if (!Object.keys(b.monthlyData).length && b.months) for(const [m,v] of Object.entries(b.months)) b.monthlyData[`${b.currentYear||new Date().getFullYear()}-${String(+m+1).padStart(2,'0')}`]=v;
    for(const m of Object.values(b.monthlyData)) {m.income=m.income||[];m.expenses=m.expenses||[];m.meta=m.meta||{};m.savings=m.savings||{amount:0,paid:false,date:''};}
    b.recurringTemplates=b.recurringTemplates||[];
    b.recurringTemplates.forEach(t=>{t.skipMonths=t.skipMonths||[];t.overrides=t.overrides||{};});
    return b;
  }
  function totals(m) {
    let tin=0,tex=0,pin=0,pex=0;
    for(const r of m.income||[]) {tin+=cents(r.amount);if(r.paid===true)pin+=cents(r.amount);}
    for(const r of m.expenses||[]) {tex+=cents(r.amount);if(r.paid===true)pex+=cents(r.amount);}
    const opening=cents(m.meta?.openingBalance),sav=cents(m.savings?.amount);
    const outSaving=m.savings?.paid && m.savings?.fromAccount ? sav : 0;
    return {tin:tin/100,tex:tex/100,pin:pin/100,pex:pex/100,sav:sav/100,opening:opening/100,outSaving:outSaving/100,current:(opening+pin-pex-outSaving)/100,final:(opening+tin-tex-outSaving)/100,future:(tex-pex)/100,remaining:(opening+tin-tex-outSaving)/100,pct:tin?Math.round(tex/tin*100):0,paidPct:tex?Math.round(pex/tex*100):0};
  }
  function restoreValues(storage, values) {
    for(const [k,v] of Object.entries(values)) {
      if(storage.getItem(k)===v)continue;
      if(v===null)storage.removeItem(k);else storage.setItem(k,v);
    }
  }
  function recover(storage) {
    const raw=storage.getItem(JOURNAL);if(!raw)return;
    const j=JSON.parse(raw);
    if(j.version!==1 || Object.keys(j.before||{}).some(k=>!['bgt4','orion_plus_v6','orion_v21_goals','orion_backups_v1'].includes(k)) || !record(j.before) || Object.values(j.before).some(v=>v!==null&&typeof v!=='string'))throw Error('Journal de sauvegarde incompatible.');
    restoreValues(storage,j.before);storage.removeItem(JOURNAL);
  }
  function atomicWrite(storage, values) {
    const changed=Object.fromEntries(Object.entries(values).filter(([k,v])=>storage.getItem(k)!==v));
    if(!Object.keys(changed).length)return;
    const before=Object.fromEntries(Object.keys(changed).map(k=>[k,storage.getItem(k)]));
    let journalWritten=false;
    try {
      storage.setItem(JOURNAL,JSON.stringify({version:1,before}));journalWritten=true;
      restoreValues(storage,changed);storage.removeItem(JOURNAL);
    } catch(cause) {
      if(journalWritten)try{restoreValues(storage,before);storage.removeItem(JOURNAL);}catch{}
      const error=Error('Enregistrement impossible. L’opération n’a pas été confirmée. Exporte ton budget et réessaie.');
      error.name='OrionPersistenceError';error.cause=cause;throw error;
    }
  }
  function checkStored(storage) {
    const first=keys=>{for(const k of keys){const s=storage.getItem(k);if(s!==null)return JSON.parse(s);}return undefined;};
    const payload={budget:first(['bgt4','budgetV3','budgetV2']),extra:first(['orion_plus_v6','orion_plus_v4','orion_plus_v3']),goals:first(['orion_v21_goals'])};
    if(Object.values(payload).some(x=>x!==undefined))validateBackup(payload,false);
    const history=storage.getItem('orion_backups_v1');if(history!==null){const parsed=JSON.parse(history);if(!Array.isArray(parsed)||parsed.some(x=>!record(x)||!record(x.data)))invalid('historique de sauvegardes');}
  }
  root.ORION_CORE={cents,money,totals,validateBackup,normalizeBudget,atomicWrite,recover,checkStored};
})(typeof window!=='undefined'?window:globalThis);
