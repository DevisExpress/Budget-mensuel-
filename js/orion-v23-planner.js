/* ═══════════════════════════════════════════════════════════════════════
   ORION V2.3 — Anticipation financière
   Additif : anniversaires, dépenses annuelles, échéanciers, échanges.
   Stockage dédié : orion_v22_planner (inclus dans les sauvegardes V2.2).
   Le cœur bgt4 n'est écrit que sur action explicite « Ajouter au budget »,
   avec snapshot de sécurité préalable et sans écraser aucune ligne existante.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
function ready(cb){if(window.ORION&&window.ORION.v22&&typeof window.ORION.register==='function')cb();else setTimeout(function(){ready(cb);},40);}
ready(function(){
  var ORION=window.ORION, V=ORION.v22, Store=V.Store, esc=V.esc, toast=V.toast;
  var KEY='orion_v22_planner', ML=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  function num(v){v=Number(String(v==null?'':v).replace(',','.'));return isFinite(v)?v:0;}
  function eur(v){return num(v).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
  function id(p){return (p||'x')+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
  function isoMonth(d){return String(d||'').slice(0,7);}
  function currentKey(){var b=core();var y=Number(b.currentYear)||new Date().getFullYear(),m=Number(b.currentMonth);if(!isFinite(m))m=new Date().getMonth();return y+'-'+String(m+1).padStart(2,'0');}
  function addMonths(key,n){var p=key.split('-'),d=new Date(Number(p[0]),Number(p[1])-1+n,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
  function monthDiff(a,b){var A=a.split('-'),B=b.split('-');return (Number(B[0])-Number(A[0]))*12+(Number(B[1])-Number(A[1]));}
  function daysUntil(md){if(!md)return 9999;var now=new Date(),p=md.split('-'),d=new Date(now.getFullYear(),Number(p[1])-1,Number(p[2]));d.setHours(0,0,0,0);var n=new Date(now.getFullYear(),now.getMonth(),now.getDate());if(d<n)d.setFullYear(d.getFullYear()+1);return Math.ceil((d-n)/86400000);}
  function dateFR(d){if(!d)return '—';try{return new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});}catch(e){return d;}}
  function state(){var s=Store.get(KEY,null);if(!s||typeof s!=='object')s={birthdays:[],annual:[],installments:[],exchanges:[]};['birthdays','annual','installments','exchanges'].forEach(function(k){if(!Array.isArray(s[k]))s[k]=[];});return s;}
  function save(s){Store.set(KEY,s);}
  function core(){try{return JSON.parse(localStorage.getItem('bgt4')||localStorage.getItem('budgetV3')||localStorage.getItem('budgetV2')||'{}')||{};}catch(e){return {};}}
  function coreSave(b){try{localStorage.setItem('bgt4',JSON.stringify(b));return true;}catch(e){return false;}}
  function backup(reason){try{if(V.backup&&V.backup.addBackup)V.backup.addBackup(reason||'avant-planificateur',true);}catch(e){}}
  function val(id){var e=document.getElementById(id);return e?e.value:'';}
  function clear(ids){ids.forEach(function(x){var e=document.getElementById(x);if(e)e.value='';});}
  function rer(id){V.rerender(id);injectDashboard();}
  function annualCostOfRecurring(){var b=core(),t=b.recurringTemplates||[],out=[];t.forEach(function(x){if(x.kind!=='expense')return;var yearly=0;if(x.freq==='monthly')yearly=num(x.amount)*12;else if(x.freq==='everyN')yearly=num(x.amount)*(12/Math.max(1,num(x.interval)||1));else if(x.installments>0)yearly=num(x.amount)*num(x.installments);else yearly=num(x.amount);out.push({name:x.name||'Dépense',amount:yearly,monthly:yearly/12});});return out.sort(function(a,b){return b.amount-a.amount;});}
  function plannerForecast(){
    var s=state(),key=currentKey(),next=addMonths(key,1),sumThis=0,sumNext=0,items=[];
    s.birthdays.forEach(function(x){var d=daysUntil(x.date);if(d<=62){var target=d<=31?'this':'next';if(target==='this')sumThis+=num(x.budget);else sumNext+=num(x.budget);items.push({ic:'🎂',name:x.name||'Anniversaire',meta:'Dans '+d+' jour'+(d>1?'s':''),amount:num(x.budget),d:d});}});
    s.annual.forEach(function(x){var mk=isoMonth(x.nextDate);if(mk===key){sumThis+=num(x.amount);items.push({ic:'📅',name:x.name,meta:'Dépense annuelle · '+dateFR(x.nextDate),amount:num(x.amount),d:0});}else if(mk===next){sumNext+=num(x.amount);items.push({ic:'📅',name:x.name,meta:'Le mois prochain',amount:num(x.amount),d:32});}});
    s.installments.forEach(function(x){var start=isoMonth(x.startDate),n=monthDiff(start,key),count=Math.max(1,Number(x.count)||1);if(n>=0&&n<count){sumThis+=num(x.amount);items.push({ic:'💳',name:x.name,meta:'Échéance '+(n+1)+'/'+count,amount:num(x.amount),d:0});}var nn=monthDiff(start,next);if(nn>=0&&nn<count)sumNext+=num(x.amount);});
    var due=s.exchanges.filter(function(x){return x.status!=='done'&&x.direction==='owe';}).reduce(function(a,x){return a+num(x.amount);},0);sumThis+=due;
    if(due)items.push({ic:'🤝',name:'À rembourser',meta:'Échanges en attente',amount:due,d:0});
    items.sort(function(a,b){return a.d-b.d;});return {thisMonth:sumThis,nextMonth:sumNext,items:items.slice(0,4)};
  }
  function injectDashboard(){
    var host=document.getElementById('page-dashboard');
    if(!host)return;
    var f=plannerForecast();
    var sig=JSON.stringify({t:f.thisMonth,n:f.nextMonth,i:f.items});
    var sec=host.querySelector('[data-v23-anticip]');
    /* Important : ne pas recréer la carte si son contenu n'a pas changé.
       L'ancienne version supprimait/réinsérait la carte à chaque mutation DOM,
       ce qui relançait le MutationObserver en boucle et pouvait figer l'app. */
    if(sec && sec.getAttribute('data-v23-sig')===sig)return;
    if(!sec){
      sec=document.createElement('section');
      sec.className='card v23-anticip';
      sec.setAttribute('data-v23-anticip','1');
      var hero=host.querySelector('.hero');
      if(hero&&hero.nextSibling)host.insertBefore(sec,hero.nextSibling);else host.appendChild(sec);
    }
    sec.setAttribute('data-v23-sig',sig);
    sec.innerHTML='<div class="v23-headrow"><div><div class="v23-title">Prévisions &amp; Anticipations</div><div class="v23-note">Ce qui arrive avant que l’argent ne parte.</div></div><span class="v23-badge">Budget+</span></div>'
      +'<div class="v23-forecast-grid"><div class="v23-forecast"><small>À anticiper ce mois</small><b>'+eur(f.thisMonth)+'</b></div><div class="v23-forecast"><small>Mois prochain</small><b>'+eur(f.nextMonth)+'</b></div></div>'
      +(f.items.length?'<div class="v23-mini-list">'+f.items.map(function(x){return '<div class="v23-mini"><span class="v23-mini-ic">'+x.ic+'</span><span class="v23-mini-main"><b>'+esc(x.name)+'</b><span>'+esc(x.meta)+'</span></span><span class="v23-mini-amt">'+eur(x.amount)+'</span></div>';}).join('')+'</div>':'<p class="v23-empty">Ajoute un anniversaire, une dépense annuelle ou un échéancier dans « Plus ».</p>')
      +'<div class="v23-actions"><button class="primary" data-openmod="birthdays">Gérer les anticipations</button></div>';
  }
  /* Injection volontairement SANS MutationObserver.
     Le dashboard de l'app est très dynamique : observer tout le DOM peut provoquer
     une boucle de rendu et figer Safari/Chrome mobile. On réinjecte seulement après
     les interactions utilisateur et les changements de période. */
  var injectTimer=null;
  function queueInject(){
    clearTimeout(injectTimer);
    injectTimer=setTimeout(injectDashboard,40);
  }
  setTimeout(injectDashboard,120);
  document.addEventListener('click',queueInject,true);
  document.addEventListener('change',queueInject,true);

  ORION.register({id:'birthdays',order:20,title:'Anniversaires',subtitle:'Anticiper cadeaux & événements',icon:'🎂',render:function(){var s=state(),total=s.birthdays.reduce(function(a,x){return a+num(x.budget);},0);return '<section class="card"><div class="v23-kpis"><div class="v23-kpi"><small>Budget annuel prévu</small><b>'+eur(total)+'</b></div><div class="v23-kpi"><small>Événements enregistrés</small><b>'+s.birthdays.length+'</b></div></div><div class="v23-form"><label>Personne / événement<input id="v23-b-name" placeholder="Ex : Emma"></label><div class="v23-form-grid"><label>Date<input id="v23-b-date" type="date"></label><label>Budget cadeau (€)<input id="v23-b-budget" type="number" step="0.01" inputmode="decimal"></label></div><button class="primary" data-v22="v23-b-add">Ajouter l’anniversaire</button></div></section><section class="card">'+(s.birthdays.length?s.birthdays.slice().sort(function(a,b){return daysUntil(a.date)-daysUntil(b.date);}).map(function(x){var d=daysUntil(x.date);return '<div class="v23-row"><div class="v23-row-main"><b>🎂 '+esc(x.name)+'</b><span>'+dateFR(x.date)+' · dans '+d+' jour'+(d>1?'s':'')+'</span><span class="v23-status '+(d<=30?'warn':'')+'">'+(d<=30?'À anticiper maintenant':'Prévu')+'</span></div><div class="v23-row-amt"><b>'+eur(x.budget)+'</b><div class="v23-actions"><button class="danger" data-v22="v23-del" data-kind="birthdays" data-id="'+x.id+'">Suppr.</button></div></div></div>';}).join(''):'<p class="v23-empty">Aucun anniversaire enregistré.</p>')+'</section>';},actions:{'v23-b-add':function(){var n=val('v23-b-name').trim(),d=val('v23-b-date');if(!n||!d){toast('Nom et date obligatoires');return;}var s=state();s.birthdays.push({id:id('b'),name:n,date:d,budget:num(val('v23-b-budget'))});save(s);rer('birthdays');toast('Anniversaire ajouté');},'v23-del':delAction}});

  ORION.register({id:'annual',order:21,title:'Dépenses annuelles',subtitle:'Voir le vrai coût sur 12 mois',icon:'📅',render:function(){var s=state(),sum=s.annual.reduce(function(a,x){return a+num(x.amount);},0),rec=annualCostOfRecurring();return '<section class="card"><div class="v23-kpis"><div class="v23-kpi"><small>Dépenses annuelles saisies</small><b>'+eur(sum)+'</b></div><div class="v23-kpi"><small>À lisser par mois</small><b>'+eur(sum/12)+'</b></div></div><div class="v23-form"><label>Dépense<input id="v23-a-name" placeholder="Ex : Assurance habitation"></label><div class="v23-form-grid"><label>Montant annuel (€)<input id="v23-a-amount" type="number" step="0.01"></label><label>Prochaine échéance<input id="v23-a-date" type="date"></label></div><button class="primary" data-v22="v23-a-add">Ajouter</button></div></section><section class="card"><h2 class="v22-h2">Dépenses annuelles planifiées</h2>'+(s.annual.length?s.annual.map(function(x){return '<div class="v23-row"><div class="v23-row-main"><b>'+esc(x.name)+'</b><span>'+dateFR(x.nextDate)+' · '+eur(num(x.amount)/12)+'/mois à provisionner</span></div><div class="v23-row-amt"><b>'+eur(x.amount)+'/an</b><div class="v23-actions"><button data-v22="v23-add-budget" data-kind="annual" data-id="'+x.id+'">Ajouter au budget</button><button class="danger" data-v22="v23-del" data-kind="annual" data-id="'+x.id+'">Suppr.</button></div></div></div>';}).join(''):'<p class="v23-empty">Aucune dépense annuelle.</p>')+'</section><section class="card"><h2 class="v22-h2">Coût annuel des dépenses récurrentes</h2><p class="v23-note">Calculé automatiquement à partir des récurrences déjà présentes dans ton budget.</p>'+(rec.length?rec.slice(0,12).map(function(x){return '<div class="v23-row"><div class="v23-row-main"><b>'+esc(x.name)+'</b><span>'+eur(x.monthly)+'/mois en moyenne</span></div><div class="v23-row-amt"><b>'+eur(x.amount)+'/an</b></div></div>';}).join(''):'<p class="v23-empty">Aucune récurrence détectée.</p>')+'</section>';},actions:{'v23-a-add':function(){var n=val('v23-a-name').trim(),d=val('v23-a-date'),a=num(val('v23-a-amount'));if(!n||!d||a<=0){toast('Complète la dépense');return;}var s=state();s.annual.push({id:id('a'),name:n,amount:a,nextDate:d});save(s);rer('annual');toast('Dépense annuelle ajoutée');},'v23-del':delAction,'v23-add-budget':addBudgetAction}});

  ORION.register({id:'installments',order:22,title:'Paiements en plusieurs fois',subtitle:'Échéances restantes & coût total',icon:'💳',render:function(){var s=state(),monthly=0,remain=0,key=currentKey();s.installments.forEach(function(x){var n=monthDiff(isoMonth(x.startDate),key),c=Math.max(1,Number(x.count)||1);if(n>=0&&n<c)monthly+=num(x.amount);var paid=Math.max(0,Math.min(c,n));remain+=num(x.amount)*(c-paid);});return '<section class="card"><div class="v23-kpis"><div class="v23-kpi"><small>Total échéances ce mois</small><b>'+eur(monthly)+'</b></div><div class="v23-kpi"><small>Reste à payer</small><b>'+eur(remain)+'</b></div></div><div class="v23-form"><label>Achat<input id="v23-i-name" placeholder="Ex : Canapé"></label><div class="v23-form-grid"><label>Montant par échéance (€)<input id="v23-i-amount" type="number" step="0.01"></label><label>Nombre de paiements<input id="v23-i-count" type="number" min="2" value="3"></label></div><label>Première échéance<input id="v23-i-date" type="date"></label><button class="primary" data-v22="v23-i-add">Ajouter l’échéancier</button></div></section><section class="card">'+(s.installments.length?s.installments.map(function(x){var c=Math.max(1,Number(x.count)||1),n=monthDiff(isoMonth(x.startDate),key),done=Math.max(0,Math.min(c,n)),left=Math.max(0,c-done),pct=Math.round(done/c*100);return '<div class="v23-row"><div class="v23-row-main"><b>💳 '+esc(x.name)+'</b><span>'+c+'x · total '+eur(num(x.amount)*c)+' · reste '+left+'/'+c+'</span><div class="v23-progress"><span style="width:'+pct+'%"></span></div></div><div class="v23-row-amt"><b>'+eur(x.amount)+'/mois</b><div class="v23-actions"><button data-v22="v23-add-budget" data-kind="installments" data-id="'+x.id+'">Ajouter au budget</button><button class="danger" data-v22="v23-del" data-kind="installments" data-id="'+x.id+'">Suppr.</button></div></div></div>';}).join(''):'<p class="v23-empty">Aucun paiement fractionné.</p>')+'</section>';},actions:{'v23-i-add':function(){var n=val('v23-i-name').trim(),d=val('v23-i-date'),a=num(val('v23-i-amount')),c=Math.max(2,Math.round(num(val('v23-i-count'))));if(!n||!d||a<=0){toast('Complète l’échéancier');return;}var s=state();s.installments.push({id:id('i'),name:n,amount:a,count:c,startDate:d});save(s);rer('installments');toast('Échéancier ajouté');},'v23-del':delAction,'v23-add-budget':addBudgetAction}});

  ORION.register({id:'exchanges',order:23,title:'Échanges de paiements',subtitle:'À me rembourser / à rembourser',icon:'🤝',render:function(){var s=state(),get=s.exchanges.filter(function(x){return x.status!=='done'&&x.direction==='get';}).reduce(function(a,x){return a+num(x.amount);},0),owe=s.exchanges.filter(function(x){return x.status!=='done'&&x.direction==='owe';}).reduce(function(a,x){return a+num(x.amount);},0);return '<section class="card"><div class="v23-kpis"><div class="v23-kpi"><small>À me rembourser</small><b>'+eur(get)+'</b></div><div class="v23-kpi"><small>À rembourser</small><b>'+eur(owe)+'</b></div></div><div class="v23-form"><label>Personne<input id="v23-e-name" placeholder="Ex : Paul"></label><div class="v23-form-grid"><label>Montant (€)<input id="v23-e-amount" type="number" step="0.01"></label><label>Sens<select id="v23-e-dir"><option value="get">On me doit</option><option value="owe">Je dois</option></select></label></div><label>Motif<input id="v23-e-note" placeholder="Ex : dîner du 12/05"></label><button class="primary" data-v22="v23-e-add">Ajouter l’échange</button></div></section><section class="card">'+(s.exchanges.length?s.exchanges.map(function(x){return '<div class="v23-row"><div class="v23-row-main"><b>🤝 '+esc(x.name)+'</b><span>'+esc(x.note||'Échange')+' · '+(x.direction==='get'?'À me rembourser':'À rembourser')+'</span><span class="v23-status '+(x.status==='done'?'':'warn')+'">'+(x.status==='done'?'Soldé':'En attente')+'</span></div><div class="v23-row-amt"><b>'+eur(x.amount)+'</b><div class="v23-actions">'+(x.status==='done'?'':'<button class="primary" data-v22="v23-e-done" data-id="'+x.id+'">Remboursé</button>')+'<button class="danger" data-v22="v23-del" data-kind="exchanges" data-id="'+x.id+'">Suppr.</button></div></div></div>';}).join(''):'<p class="v23-empty">Aucun remboursement en attente.</p>')+'</section>';},actions:{'v23-e-add':function(){var n=val('v23-e-name').trim(),a=num(val('v23-e-amount'));if(!n||a<=0){toast('Nom et montant obligatoires');return;}var s=state();s.exchanges.push({id:id('e'),name:n,amount:a,direction:val('v23-e-dir')||'get',note:val('v23-e-note').trim(),status:'open',created:new Date().toISOString()});save(s);rer('exchanges');toast('Échange ajouté');},'v23-e-done':function(el){var s=state(),x=s.exchanges.find(function(z){return z.id===el.getAttribute('data-id');});if(x)x.status='done';save(s);rer('exchanges');toast('Échange soldé');},'v23-del':delAction}});

  function delAction(el){var kind=el.getAttribute('data-kind'),iid=el.getAttribute('data-id'),s=state();if(!s[kind])return;if(!confirm('Supprimer cet élément ?'))return;s[kind]=s[kind].filter(function(x){return x.id!==iid;});save(s);rer(kind==='birthdays'?'birthdays':kind);toast('Supprimé');}
  function addBudgetAction(el){var kind=el.getAttribute('data-kind'),iid=el.getAttribute('data-id'),s=state(),x=(s[kind]||[]).find(function(z){return z.id===iid;});if(!x)return;var b=core();b.monthlyData=b.monthlyData||{};backup('avant-ajout-planificateur');var added=0;
    function ensure(k){if(!b.monthlyData[k])b.monthlyData[k]={income:[],expenses:[],savings:{amount:0,paid:false,date:''},meta:{generated:true,note:''}};if(!Array.isArray(b.monthlyData[k].expenses))b.monthlyData[k].expenses=[];return b.monthlyData[k];}
    function push(k,name,amount,due,tag){var m=ensure(k);if(m.expenses.some(function(o){return o&&o.plannerId===tag;}))return;m.expenses.push({name:name,amount:num(amount),cat:'autres',paid:false,paidDate:'',dueDate:due,createdPeriod:k,life:0,plannerId:tag});added++;}
    if(kind==='annual'){var k=isoMonth(x.nextDate),day=String(x.nextDate).slice(8,10)||'01';push(k,x.name,x.amount,k+'-'+day,'annual:'+x.id+':'+k);}
    if(kind==='installments'){var start=isoMonth(x.startDate),day=String(x.startDate).slice(8,10)||'01',c=Math.max(1,Number(x.count)||1);for(var n=0;n<c;n++){var k2=addMonths(start,n);push(k2,x.name+' ('+(n+1)+'/'+c+')',x.amount,k2+'-'+day,'inst:'+x.id+':'+n);}}
    if(!added){toast('Déjà présent dans le budget');return;}if(coreSave(b)){toast(added+' ligne'+(added>1?'s':'')+' ajoutée'+(added>1?'s':'')+' au budget');setTimeout(function(){location.reload();},650);}else toast('Sauvegarde impossible');
  }
  ORION.v23={state:state,forecast:plannerForecast,injectDashboard:injectDashboard};
});
})();
