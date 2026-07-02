(function(){
'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   ORION v21 — app.js
   Moteur compatible (lit bgt4 / budgetV3 / budgetV2, écrit bgt4) + UI premium.
   Aucune dépendance. Objectifs : montant courant propre à chaque objectif.
   ═══════════════════════════════════════════════════════════════════════ */
const ML=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const cats={logement:'Logement',transport:'Transport',alimentation:'Alimentation',abonnements:'Abonnements',enfants:'Enfants',credits:'Crédits',assurances:'Assurances',loisirs:'Loisirs',sante:'Santé',autres:'Autres'};

/* ── Icônes SVG (pas d'emoji hors objectifs) ─────────────────────────── */
const PATHS={
  home:'<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
  car:'<path d="M5 16 6.2 9.5A2 2 0 0 1 8.2 8h7.6a2 2 0 0 1 2 1.5L19 16"/><path d="M4 16h16v3H5a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="18.5" r="1.2"/><circle cx="16.5" cy="18.5" r="1.2"/>',
  cart:'<circle cx="9" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/><path d="M3 4h2l2.2 11h10l1.8-8H6.2"/>',
  phone:'<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  heart:'<path d="M12 20s-6.5-4.2-6.5-9A3.3 3.3 0 0 1 12 7.6 3.3 3.3 0 0 1 18.5 11c0 4.8-6.5 9-6.5 9z"/>',
  card:'<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18"/>',
  shield:'<path d="M12 3l7 3v6c0 4.8-7 9-7 9s-7-4.2-7-9V6z"/>',
  star:'<path d="M12 4l2.3 4.7 5.2.8-3.8 3.6.9 5.2L12 16.7 7.4 18.3l.9-5.2L4.5 9.5l5.2-.8z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  dot:'<circle cx="12" cy="12" r="7"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  down:'<path d="M12 5v14M5 12l7 7 7-7"/>',
  wallet:'<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16 12.5h2.5"/>',
  alert:'<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  check:'<path d="M5 12l4.5 4.5L19 7"/>',
  chart:'<path d="M4 20h16"/><path d="M7 20v-6M12 20V9M17 20v-10"/>',
  spark:'<path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  robot:'<rect x="5" y="8" width="14" height="10" rx="3.2"/><circle cx="9.6" cy="13" r="1"/><circle cx="14.4" cy="13" r="1"/><path d="M12 5v3M9.5 18v2M14.5 18v2"/>'
};
function icon(n){return '<svg viewBox="0 0 24 24">'+(PATHS[n]||PATHS.dot)+'</svg>';}
const CAT_ICON={logement:'home',transport:'car',alimentation:'cart',abonnements:'phone',enfants:'heart',credits:'card',assurances:'shield',loisirs:'star',sante:'plus',autres:'dot'};

const defaultGoals=[
  {id:'maison',n:'Maison',e:'🏡',target:80000,current:0},
  {id:'urgence',n:"Fonds d'urgence",e:'🛡️',target:10000,current:0},
  {id:'voyage',n:'Voyage',e:'✈️',target:3000,current:0}
];
const GOAL_EMOJIS=['🏡','✈️','🚗','🛡️','💍','🎓','🏖️','💻','📈','🎯'];

let month=new Date().getMonth();
let currentPage='dashboard';
let filter='all';
let app=load();
let goals=loadGoals();

/* ── Utils ───────────────────────────────────────────────────────────── */
function $(id){return document.getElementById(id);}
function num(v){v=parseFloat(v);return isFinite(v)?v:0;}
function eur(v){v=num(v);return (v<0?'-':'')+Math.abs(v).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
function short(v){v=num(v);return Math.abs(v)>=1000?(v<0?'-':'')+(Math.abs(v)/1000).toLocaleString('fr-FR',{maximumFractionDigits:1})+'k €':eur(v);}
function p2(n){return String(n).padStart(2,'0');}
function today(){let d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());}
function dateFR(s){if(!s)return 'Sans date';let p=String(s).split('-');return p.length===3?p[2]+'/'+p[1]:'Sans date';}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}

/* ── Modèle de données (compatible bgt4 / budgetV3 / budgetV2) ───────── */
function mkRow(n,a,d,c){return{name:n||'',amount:num(a),paid:false,dueDate:d||'',paidDate:'',cat:c||'autres'};}
function isAutoIncome(r){return !!(r&&r.auto)||/salaire|paie|pay/i.test((r&&r.name)||'');}
function guessCat(n){n=(n||'').toLowerCase();if(/loyer|pret|prêt|logement|electricit|électricit|gaz|eau|immo|lit/.test(n))return'logement';if(/voiture|essence|autoroute|vinci|parking|transport/.test(n))return'transport';if(/supermarch|course|aliment|restaurant|carrefour/.test(n))return'alimentation';if(/mobile|internet|freebox|netflix|spotify|apple|abonnement/.test(n))return'abonnements';if(/cantine|ecole|école|creche|crèche|enfant/.test(n))return'enfants';if(/credit|crédit|cetelem|natixis|cofidis|klarna/.test(n))return'credits';if(/assurance|mutuelle/.test(n))return'assurances';if(/loisir|vacance|cinema|cinéma|sport/.test(n))return'loisirs';if(/pharma|medecin|médecin|sante|santé/.test(n))return'sante';return'autres';}
function defIncome(){let sal=mkRow('Salaire',0,'','autres');sal.auto=true;sal.paid=true;let sup=mkRow('Revenus supplémentaires',0,'','autres');sup.auto=false;return[sal,sup];}
function defExpenses(){return[mkRow('Logement',0,'','logement'),mkRow('Supermarché',0,'','alimentation'),mkRow('Assurance voiture',0,'','assurances'),mkRow('Essence',0,'','transport'),mkRow('Free mobile',0,'','abonnements')];}
function defMonth(){return{income:defIncome(),expenses:defExpenses(),savings:{amount:0,paid:false,date:''}};}
function fix(r){r.name=r.name||'';r.amount=num(r.amount);r.paid=!!r.paid;r.dueDate=r.dueDate||'';r.paidDate=r.paidDate||'';r.cat=r.cat||guessCat(r.name);if(isAutoIncome(r)){r.auto=true;r.paid=true;}}
function normalize(d){
  if(!d)d={currentMonth:new Date().getMonth(),months:{}};
  if(!d.months)d.months={};
  for(let i=0;i<12;i++){
    let mo=d.months[i]||d.months[String(i)]||defMonth();
    mo.income=Array.isArray(mo.income)?mo.income:defIncome();
    mo.expenses=Array.isArray(mo.expenses)?mo.expenses:defExpenses();
    mo.savings=mo.savings||{amount:0,paid:false,date:''};
    mo.income.forEach(fix);mo.expenses.forEach(fix);
    mo.savings.amount=num(mo.savings.amount);mo.savings.paid=!!mo.savings.paid;mo.savings.date=mo.savings.date||'';
    d.months[i]=mo;
  }
  if(!d.savings)d.savings={balance:0,target:50000,monthlyTarget:1000,history:{}};
  if(!d.savings.history)d.savings.history={};
  month=Number.isInteger(d.currentMonth)?d.currentMonth:new Date().getMonth();
  return d;
}
function load(){
  let keys=['bgt4','budgetV3','budgetV2'];
  for(let k of keys){try{let v=localStorage.getItem(k);if(v)return normalize(JSON.parse(v));}catch(e){if(window.console)console.warn('Lecture impossible',k,e);}}
  return normalize(null); // aucune donnée existante : structure vide propre (aucune donnée factice)
}
function save(){app.currentMonth=month;try{localStorage.setItem('bgt4',JSON.stringify(app));}catch(e){alert('Sauvegarde impossible (espace navigateur plein ?)');}}
function loadGoals(){
  try{
    let g=JSON.parse(localStorage.getItem('orion_v21_goals')||'null');
    if(!Array.isArray(g))return defaultGoals.map(x=>Object.assign({},x));
    return g.map(x=>({id:x.id||'g'+Math.random().toString(36).slice(2),n:x.n||'Objectif',e:x.e||'🎯',target:num(x.target),current:num(x.current)}));
  }catch(e){return defaultGoals.map(x=>Object.assign({},x));}
}
function saveGoals(){try{localStorage.setItem('orion_v21_goals',JSON.stringify(goals));}catch(e){}}

/* ── Calculs (recalcul instantané) ───────────────────────────────────── */
function m(){return app.months[month];}
function totals(){
  let mi=m(),tin=0,tex=0,pin=0,pex=0;
  mi.income.forEach(r=>{tin+=num(r.amount);if(r.paid||isAutoIncome(r))pin+=num(r.amount);});
  mi.expenses.forEach(r=>{tex+=num(r.amount);if(r.paid)pex+=num(r.amount);});
  let future=mi.expenses.filter(r=>!r.paid).reduce((s,r)=>s+num(r.amount),0);
  let futureCount=mi.expenses.filter(r=>!r.paid&&num(r.amount)>0).length;
  return {tin,tex,pin,pex,solde:pin-pex,final:pin-tex,future,futureCount,sav:num(mi.savings.amount),pct:tin?Math.round(tex/tin*100):0};
}
function finalOf(k){let old=month;month=k;let t=totals();month=old;return t.final;}
function prevTotals(){let old=month;month=(old+11)%12;let t=totals();month=old;return t;}
function yearFinals(){let a=[];for(let k=0;k<12;k++)a.push(finalOf(k));return a;}
function catTotals(){let out={};m().expenses.forEach(r=>{if(num(r.amount)>0)out[r.cat]=(out[r.cat]||0)+num(r.amount);});return out;}
function upcoming(n){return m().expenses.filter(r=>!r.paid&&num(r.amount)>0).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,n||5);}
function biggestCat(){let ct=catTotals(),ks=Object.keys(ct).sort((a,b)=>ct[b]-ct[a]);return ks[0]?{key:ks[0],name:cats[ks[0]]||ks[0],val:ct[ks[0]]}:null;}
function dayCurve(){
  let mi=m(),days=new Date(new Date().getFullYear(),month+1,0).getDate();
  let inc=0;mi.income.forEach(r=>{if(r.paid||isAutoIncome(r))inc+=num(r.amount);});
  let byDay=new Array(days).fill(0);
  mi.expenses.forEach(r=>{let d=r.dueDate?Number(String(r.dueDate).split('-')[2]):1;d=Math.max(1,Math.min(days,d||1));byDay[d-1]+=num(r.amount);});
  let bal=inc,out=[inc];for(let i=0;i<days;i++){bal-=byDay[i];out.push(bal);}return out;
}

/* ── SVG helpers ─────────────────────────────────────────────────────── */
function sparkFrom(vals,stroke){
  stroke=stroke||'#16C47F';
  if(!vals||vals.length<2)vals=[0,0];
  let max=Math.max.apply(null,vals),min=Math.min.apply(null,vals),rng=(max-min)||1,W=280,H=60,step=W/(vals.length-1);
  let pts=vals.map((v,i)=>(i*step).toFixed(0)+','+(H-5-(v-min)/rng*(H-12)).toFixed(1)).join(' ');
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true"><polyline points="'+pts+'" fill="none" stroke="'+stroke+'" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function ringSVG(pct){
  let R=22,C=2*Math.PI*R,off=C*(1-Math.min(100,pct)/100);
  return '<div class="ring"><svg viewBox="0 0 52 52"><circle class="bg" cx="26" cy="26" r="'+R+'" fill="none" stroke-width="5"/><circle class="fg" cx="26" cy="26" r="'+R+'" fill="none" stroke-width="5" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/><text class="ring-label" x="26" y="30" text-anchor="middle">'+pct+'%</text></svg></div>';
}
function donutSVG(ct){
  let keys=Object.keys(ct).filter(k=>ct[k]>0).sort((a,b)=>ct[b]-ct[a]);
  let total=keys.reduce((s,k)=>s+ct[k],0);
  if(!total)return '';
  let r=48,cx=60,cy=60,start=-Math.PI/2,paths='';
  keys.forEach(k=>{let ang=ct[k]/total*2*Math.PI,end=start+ang,x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end),lg=ang>Math.PI?1:0;paths+='<path d="M'+cx+' '+cy+' L'+x1.toFixed(1)+' '+y1.toFixed(1)+' A'+r+' '+r+' 0 '+lg+' 1 '+x2.toFixed(1)+' '+y2.toFixed(1)+' Z" fill="'+catColor(k)+'"/>';start=end;});
  return '<svg class="donut" viewBox="0 0 120 120">'+paths+'<circle cx="60" cy="60" r="30" fill="#fff"/><text x="60" y="57" text-anchor="middle" font-size="15" font-weight="800" fill="#0D1321">'+short(total)+'</text><text x="60" y="73" text-anchor="middle" font-size="9" fill="#9AA3AF">Total</text></svg>';
}
const CAT_COLORS={logement:'#2563EB',alimentation:'#16C47F',transport:'#FF4D4F',abonnements:'#7C3AED',loisirs:'#FFB020',assurances:'#0891B2',credits:'#EA580C',enfants:'#DB2777',sante:'#E11D48',autres:'#687280'};
function catColor(k){return CAT_COLORS[k]||'#687280';}

/* ── DASHBOARD ───────────────────────────────────────────────────────── */
function orionNote(){
  let delta=totals().final-prevTotals().final;
  let txt = delta>=0 ? 'Tu gardes '+eur(delta)+' de plus que le mois dernier.' : 'Tu gardes '+eur(Math.abs(delta))+' de moins que le mois dernier.';
  if(prevTotals().final===0 && prevTotals().tin===0) txt='Bienvenue. Renseigne tes lignes pour activer tes analyses.';
  return '<div class="orion-note"><div class="bot">'+icon('robot')+'</div><div><b>ORION</b><p>'+txt+'</p></div></div>';
}
function dashRow(r,type,idx){
  let done=r.paid||isAutoIncome(r);
  let sign=type==='income'?'+':'-';
  let meta=type==='income'?(done?'Reçu':'En attente'):((done?'Confirmé':'Prévu')+' · '+dateFR(r.dueDate));
  return '<div class="row '+(done?'done':'')+'" data-toggle="'+type+'" data-index="'+idx+'"><div class="check">'+(done?icon('check'):icon(type==='income'?'up':(CAT_ICON[r.cat]||'dot')))+'</div><div class="row-main"><div class="row-title">'+esc(r.name)+'</div><div class="row-meta">'+meta+'</div></div><div class="amount '+(type==='income'?'pos':'neg')+'">'+sign+eur(r.amount)+'</div></div>';
}
function goalMini(g){
  let pct=g.target>0?Math.min(100,Math.round(g.current/g.target*100)):0;
  return '<div class="goal-mini"><div class="emoji">'+g.e+'</div>'+ringSVG(pct)+'<b>'+esc(g.n)+'</b><small>'+short(g.current)+' / '+short(g.target)+'</small></div>';
}
function renderDashboard(){
  let t=totals(),prev=prevTotals(),delta=t.final-prev.final,up=upcoming(3);
  let mi=m();
  // événements du jour : revenus reçus + prochains prélèvements
  let events=[];
  mi.income.forEach((r,i)=>{ if((r.paid||isAutoIncome(r))&&num(r.amount)>0) events.push({r,type:'income',idx:i}); });
  up.forEach(r=>events.push({r,type:'expense',idx:mi.expenses.indexOf(r)}));
  events=events.slice(0,4);
  let deltaArrow=delta>=0?icon('up'):icon('down');

  $('page-dashboard').innerHTML=
    '<div class="greet"><h1>Bonjour 👋</h1><p>'+(JOURS[new Date().getDay()])+' '+new Date().getDate()+' '+ML[month].toLowerCase()+' '+new Date().getFullYear()+'</p></div>'
    +orionNote()
    +'<section class="hero'+(t.solde<0?'':'')+'"><div class="eyebrow">Disponible</div><div class="hero-amount">'+eur(t.solde)+'</div>'
      +'<div class="hero-delta">'+deltaArrow+(delta>=0?'+':'')+eur(delta)+' vs '+ML[(month+11)%12].toLowerCase()+'</div>'
      +'<div class="spark">'+sparkFrom(yearFinals(),'rgba(255,255,255,.95)')+'</div>'
      +'<div class="hero-fore"><span>Prévision fin de mois</span><b>'+eur(t.final)+'</b></div></section>'
    +'<div class="kpi-grid">'
      +'<article class="kpi green"><div class="ico">'+icon('up')+'</div><h3>Revenus</h3><strong>'+short(t.tin)+'</strong><p>ce mois</p></article>'
      +'<article class="kpi red"><div class="ico">'+icon('down')+'</div><h3>Dépenses</h3><strong>'+short(t.tex)+'</strong><p>ce mois</p></article>'
      +'<article class="kpi blue"><div class="ico">'+icon('wallet')+'</div><h3>Épargne</h3><strong>'+short(t.sav)+'</strong><p>ce mois</p></article>'
      +'<article class="kpi orange"><div class="ico">'+icon('alert')+'</div><h3>À payer</h3><strong>'+short(t.future)+'</strong><p>'+t.futureCount+' prélèv.</p></article>'
    +'</div>'
    +'<section class="card"><div class="usage-top"><b>Taux du budget</b><span style="color:'+(t.pct<80?'var(--green)':t.pct<100?'var(--orange)':'var(--red)')+'">'+t.pct+'%</span></div><div class="track"><span style="width:'+Math.min(100,t.pct)+'%;background:'+(t.pct<80?'var(--green)':t.pct<100?'var(--orange)':'var(--red)')+'"></span></div></section>'
    +'<section class="card"><div class="section-head"><h2>Aujourd’hui</h2><button class="link" data-page-go="transactions">Voir tout</button></div>'
      +(events.length?events.map(e=>dashRow(e.r,e.type,e.idx)).join(''):'<p class="empty">Aucun événement à venir.</p>')+'</section>'
    +'<section class="card"><div class="section-head"><h2>Objectifs</h2><button class="link" data-page-go="goals">Voir tous</button></div><div class="goal-grid">'+goals.slice(0,3).map(goalMini).join('')+'</div></section>'
    +'<section class="card"><div class="section-head"><h2>Conseil ORION</h2></div><div class="insight"><div class="ic">'+icon('spark')+'</div><div><b>'+(t.pct<80?'Budget sous contrôle':'Budget à surveiller')+'</b><p>'+(biggestCat()?('Plus gros poste : '+biggestCat().name+' ('+eur(biggestCat().val)+').'):'Ajoute tes dépenses pour recevoir des conseils.')+'</p></div></div></section>';
}

/* ── TRANSACTIONS ────────────────────────────────────────────────────── */
function txRow(r,type,idx){
  let done=r.paid||isAutoIncome(r);
  let sub=(type==='income'?'Revenu':(cats[r.cat]||'Autres'))+' · '+dateFR(r.dueDate)+' · '+(done?'confirmé':'prévu');
  return '<div class="tx-row">'
    +'<button class="tx-icon '+(done?'inc':'')+'" data-toggle="'+type+'" data-index="'+idx+'" aria-label="Confirmer">'+(done?icon('check'):icon(type==='income'?'up':(CAT_ICON[r.cat]||'dot')))+'</button>'
    +'<div class="tx-info" data-edit="'+type+'" data-index="'+idx+'"><b>'+esc(r.name)+'</b><p>'+sub+'</p></div>'
    +'<div class="amount '+(type==='income'?'pos':'neg')+'">'+(type==='income'?'+':'-')+eur(r.amount)+'</div></div>';
}
function renderTransactions(){
  let mi=m();
  let rows=[].concat(mi.income.map((r,i)=>({r,type:'income',idx:i})),mi.expenses.map((r,i)=>({r,type:'expense',idx:i})));
  let q=(($('txSearch')&&$('txSearch').value)||'').toLowerCase();
  rows=rows.filter(o=>(filter==='all'||filter===o.type)&&(!q||o.r.name.toLowerCase().includes(q)||(cats[o.r.cat]||'').toLowerCase().includes(q)));
  $('page-transactions').innerHTML=
    '<section class="card"><div class="list-head"><h2>Transactions</h2><button class="icon-btn" id="addLine" aria-label="Ajouter">+</button></div>'
    +'<div class="filters"><input class="search" id="txSearch" placeholder="Rechercher" value="'+esc(q)+'"><select class="month-select" id="monthPick">'+ML.map((x,i)=>'<option value="'+i+'"'+(i===month?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'
    +'<div class="tabs"><button class="tab '+(filter==='all'?'active':'')+'" data-filter="all">Tout</button><button class="tab '+(filter==='income'?'active':'')+'" data-filter="income">Revenus</button><button class="tab '+(filter==='expense'?'active':'')+'" data-filter="expense">Dépenses</button></div>'
    +(rows.length?rows.map(o=>txRow(o.r,o.type,o.idx)).join(''):'<p class="empty">Aucune ligne pour ce filtre.</p>')
    +'</section>';
}

/* ── STATS ───────────────────────────────────────────────────────────── */
function renderStats(){
  let ct=catTotals(),total=Object.values(ct).reduce((s,v)=>s+v,0),t=totals(),prev=prevTotals(),diff=t.tex-prev.tex,big=biggestCat();
  let keys=Object.keys(ct).sort((a,b)=>ct[b]-ct[a]);
  let legend=keys.slice(0,6).map(k=>'<div class="leg-item"><span class="leg-dot" style="background:'+catColor(k)+'"></span><span class="leg-name">'+(cats[k]||k)+'</span><span class="leg-pct">'+Math.round(ct[k]/(total||1)*100)+'%</span><span class="leg-val">'+eur(ct[k])+'</span></div>').join('');
  $('page-stats').innerHTML=
    '<div class="page-h"><h1>Statistiques</h1><p>'+ML[month]+' '+new Date().getFullYear()+'</p></div>'
    +'<section class="card"><div class="section-head"><h2>Dépenses du mois</h2><b style="color:var(--navy)">'+eur(t.tex)+'</b></div><div class="spark">'+sparkFrom(dayCurve(),'#16C47F')+'</div></section>'
    +'<section class="card"><h2 style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:14px">Répartition des dépenses</h2>'
      +(total?('<div class="donut-wrap">'+donutSVG(ct)+'<div class="legend">'+legend+'</div></div>'):'<p class="empty">Aucune dépense ce mois-ci.</p>')+'</section>'
    +'<section class="card"><h2 style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:12px">Comparaison mois précédent</h2><div class="insight"><div class="ic">'+icon('chart')+'</div><div><b>'+(diff<=0?'−':'+')+eur(Math.abs(diff))+' de dépenses vs '+ML[(month+11)%12]+'</b><p>Revenus '+eur(t.tin)+' · Dépenses '+eur(t.tex)+' · Reste '+eur(t.final)+'</p></div></div></section>'
    +'<section class="card"><h2 style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:12px">Plus gros poste</h2>'
      +(big?('<div class="big-post"><div class="ic">'+icon(CAT_ICON[big.key]||'dot')+'</div><div class="mid"><b>'+big.name+'</b><p>'+Math.round(big.val/(total||1)*100)+'% des dépenses</p></div><strong>'+eur(big.val)+'</strong></div>'):'<p class="empty">Aucune dépense.</p>')+'</section>';
}

/* ── OBJECTIFS ───────────────────────────────────────────────────────── */
function goalCard(g,i){
  let pct=g.target>0?Math.min(100,Math.round(g.current/g.target*100)):0;
  return '<section class="card goal-card" data-goaledit="'+i+'"><div class="big-emoji">'+g.e+'</div><div class="middle"><h3>'+esc(g.n)+'</h3><p>'+eur(g.current)+' / '+eur(g.target)+'</p><div class="progress"><span style="width:'+pct+'%"></span></div><div class="goal-foot"><span>Reste '+eur(Math.max(0,g.target-g.current))+'</span><span>'+pct+'%</span></div></div><b class="pct">'+pct+'%</b></section>';
}
function renderGoals(){
  $('page-goals').innerHTML=
    '<section class="card"><div class="list-head"><h2>Objectifs</h2><button class="icon-btn" id="addGoal" aria-label="Ajouter">+</button></div><p class="empty" style="text-align:left;padding:0">Touche un objectif pour modifier son montant.</p></section>'
    +(goals.length?goals.map((g,i)=>goalCard(g,i)).join(''):'<section class="card"><p class="empty">Aucun objectif. Ajoute-en un avec +.</p></section>');
}

/* ── RÉGLAGES ────────────────────────────────────────────────────────── */
function renderSettings(){
  let src='bgt4';try{if(!localStorage.getItem('bgt4')){if(localStorage.getItem('budgetV3'))src='budgetV3';else if(localStorage.getItem('budgetV2'))src='budgetV2';else src='nouveau';}}catch(e){}
  $('page-settings').innerHTML=
    '<div class="page-h"><h1>Réglages</h1></div>'
    +'<section class="card settings-area"><h2 style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:12px">Données</h2>'
      +'<textarea id="jsonArea" placeholder="Le JSON exporté s’affiche ici. Colle un JSON puis Importer."></textarea>'
      +'<div class="set-row"><button class="secondary" id="exportBtn">Exporter JSON</button><button class="primary" id="importBtn">Importer JSON</button></div></section>'
    +'<section class="card"><h2 style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:12px">Compatibilité</h2>'
      +'<div class="insight"><div class="ic">'+icon('check')+'</div><div><b>Lecture des anciennes données</b><p>Source détectée : <b>'+src+'</b>. Compatible bgt4, budgetV3, budgetV2, bgt4_cats.</p></div></div>'
      +'<div class="insight" style="margin-top:12px"><div class="ic">'+icon('shield')+'</div><div><b>Stockage local</b><p>Toutes tes données restent dans ce navigateur.</p></div></div></section>'
    +'<section class="card danger-zone"><h2 style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:12px">Maintenance</h2><button class="danger" id="reloadBtn">Recharger depuis le stockage</button></section>';
}

/* ── Rendu global / navigation ───────────────────────────────────────── */
function render(){
  $('monthLabel').textContent=ML[month]+' '+new Date().getFullYear();
  renderDashboard();renderTransactions();renderStats();renderGoals();renderSettings();
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===currentPage));
}
function switchPage(p){
  currentPage=p;
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  $('page-'+p).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));
  try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}
}

/* ── Feuille : transaction ───────────────────────────────────────────── */
function setType(type){$('editorSheet').dataset.type=type;document.querySelectorAll('#typeTabs button').forEach(b=>b.classList.toggle('active',b.dataset.type===type));$('editCat').closest('label').style.display=type==='income'?'none':'';}
function openSheet(type,idx){
  type=type||'expense';idx=(idx===0||idx)?String(idx):'';
  let arr=type==='income'?m().income:m().expenses;
  let r=idx!==''?arr[Number(idx)]:mkRow('',0,today(),'autres');
  $('editIndex').value=idx;setType(type);
  $('editName').value=r.name;$('editAmount').value=num(r.amount)||'';$('editDate').value=r.dueDate||today();
  $('editCat').innerHTML=Object.keys(cats).map(k=>'<option value="'+k+'"'+(r.cat===k?' selected':'')+'>'+cats[k]+'</option>').join('');
  $('editPaid').checked=!!r.paid||isAutoIncome(r);
  $('btnDelete').style.display=idx===''?'none':'';
  $('sheetTitle').textContent=idx===''?'Ajouter une ligne':'Modifier la ligne';
  $('sheetBackdrop').classList.add('open');$('editorSheet').classList.add('open');
}
function closeSheet(){$('sheetBackdrop').classList.remove('open');$('editorSheet').classList.remove('open');$('goalSheet').classList.remove('open');}
function saveLine(){
  let type=$('editorSheet').dataset.type||'expense',idx=$('editIndex').value;
  let name=$('editName').value.trim();if(!name)return alert('Ajoute un libellé.');
  let r=mkRow(name,$('editAmount').value,type==='income'?'':$('editDate').value,$('editCat').value);
  r.paid=$('editPaid').checked;r.paidDate=r.paid?today():'';
  if(type==='income'){r.auto=isAutoIncome(r);if(idx==='')m().income.push(r);else Object.assign(m().income[Number(idx)],r);}
  else{if(idx==='')m().expenses.push(r);else Object.assign(m().expenses[Number(idx)],r);}
  save();render();closeSheet();
}
function delLine(){
  let type=$('editorSheet').dataset.type||'expense',idx=$('editIndex').value;
  if(idx==='')return;if(!confirm('Supprimer cette ligne ?'))return;
  if(type==='income')m().income.splice(Number(idx),1);else m().expenses.splice(Number(idx),1);
  save();render();closeSheet();
}

/* ── Feuille : objectif ──────────────────────────────────────────────── */
function openGoalSheet(i){
  let isNew=(i===''||i==null);let g=isNew?{n:'',e:'🎯',target:0,current:0}:goals[i];
  $('goalIndex').value=isNew?'':i;
  $('goalName').value=g.n;$('goalTarget').value=num(g.target)||'';$('goalCurrent').value=num(g.current)||'';
  $('goalEmoji').innerHTML=GOAL_EMOJIS.map(e=>'<option'+(g.e===e?' selected':'')+'>'+e+'</option>').join('');
  $('btnDeleteGoal').style.display=isNew?'none':'';
  $('goalSheetTitle').textContent=isNew?'Nouvel objectif':'Modifier l’objectif';
  $('sheetBackdrop').classList.add('open');$('goalSheet').classList.add('open');
}
function saveGoal(){
  let idx=$('goalIndex').value;let name=$('goalName').value.trim();if(!name)return alert('Ajoute un nom.');
  let g={n:name,e:$('goalEmoji').value,target:num($('goalTarget').value),current:num($('goalCurrent').value)};
  if(idx===''){g.id='g'+Date.now();goals.push(g);}else{g.id=goals[idx].id;goals[idx]=g;}
  saveGoals();render();closeSheet();
}
function delGoal(){let idx=$('goalIndex').value;if(idx==='')return;if(!confirm('Supprimer cet objectif ?'))return;goals.splice(Number(idx),1);saveGoals();render();closeSheet();}

/* ── Export / Import ─────────────────────────────────────────────────── */
function doExport(){$('jsonArea').value=JSON.stringify({meta:{app:'ORION v21',exported:new Date().toISOString()},app:app,goals:goals},null,2);}
function doImport(){
  let raw=$('jsonArea').value.trim();if(!raw)return alert('Colle d’abord un JSON.');
  let obj;try{obj=JSON.parse(raw);}catch(e){return alert('JSON invalide.');}
  if(!confirm('Remplacer les données actuelles par cet import ?'))return;
  try{
    let data=obj.app||obj;if(!data||!data.months)return alert('Format non reconnu.');
    app=normalize(data);if(Array.isArray(obj.goals))goals=obj.goals.map(x=>({id:x.id||'g'+Math.random().toString(36).slice(2),n:x.n||'Objectif',e:x.e||'🎯',target:num(x.target),current:num(x.current)}));
    save();saveGoals();render();alert('Import réussi.');
  }catch(e){alert('Import impossible.');}
}

/* ── Événements ──────────────────────────────────────────────────────── */
document.addEventListener('click',e=>{
  let nav=e.target.closest('.bottom-nav button');if(nav)return switchPage(nav.dataset.page);
  let go=e.target.closest('[data-page-go]');if(go)return switchPage(go.dataset.pageGo);
  let f=e.target.closest('[data-filter]');if(f){filter=f.dataset.filter;renderTransactions();return;}
  let tog=e.target.closest('[data-toggle]');if(tog){
    let arr=tog.dataset.toggle==='income'?m().income:m().expenses;let it=arr[Number(tog.dataset.index)];
    if(it&&!isAutoIncome(it)){it.paid=!it.paid;it.paidDate=it.paid?today():'';save();render();}
    else if(it&&isAutoIncome(it)){/* revenu automatique : non modifiable */}
    return;
  }
  let ed=e.target.closest('[data-edit]');if(ed)return openSheet(ed.dataset.edit,ed.dataset.index);
  let ge=e.target.closest('[data-goaledit]');if(ge)return openGoalSheet(Number(ge.dataset.goaledit));
  let seg=e.target.closest('#typeTabs button');if(seg)return setType(seg.dataset.type);
  switch(e.target.id){
    case 'addLine': case 'globalAdd': return openSheet('expense','');
    case 'addGoal': return openGoalSheet('');
    case 'btnCloseSheet': case 'btnCloseGoal': case 'sheetBackdrop': return closeSheet();
    case 'btnSaveLine': return saveLine();
    case 'btnDelete': return delLine();
    case 'btnSaveGoal': return saveGoal();
    case 'btnDeleteGoal': return delGoal();
    case 'btnRefresh': app=load();goals=loadGoals();render();return;
    case 'exportBtn': return doExport();
    case 'importBtn': return doImport();
    case 'reloadBtn': if(confirm('Recharger les données depuis le stockage ?')){app=load();goals=loadGoals();render();} return;
  }
});
document.addEventListener('input',e=>{if(e.target.id==='txSearch')renderTransactions();});
document.addEventListener('change',e=>{if(e.target.id==='monthPick'){month=Number(e.target.value);app.currentMonth=month;save();render();}});

/* ── Démarrage ───────────────────────────────────────────────────────── */
try{ render(); }
catch(err){
  if(window.console)console.error(err);
  document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;left:12px;right:12px;bottom:90px;background:#FFECEC;border:1px solid #FFB3B3;color:#B91C1C;padding:12px;border-radius:12px;z-index:999;font-size:12px">Erreur : '+esc(err&&err.message||err)+'</div>');
}
window.ORION={app,goals,totals,switchPage,render}; // debug/tests
})();
