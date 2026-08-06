/* ═══════════════════════════════════════════════════════════════════════
   ORION V2.2 — orion-v22-phase1.js
   Phase 1 : modules d'ANALYSE (lecture seule, aucune écriture de données).
     • Prévision de fin de mois      (#6)
     • Assistant ORION intelligent   (#4)
     • Analyse Premium               (#9)
     • Objectifs Premium             (#10)
   Additif : ne modifie ni app.js, ni orion-v22.js. Lit bgt4 / budgetV3 /
   budgetV2 et orion_v21_goals en direct. Utilise ORION.register().
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
function ready(cb){ if(window.ORION && typeof window.ORION.register==='function'){ cb(); } else { setTimeout(function(){ ready(cb); },40); } }

ready(function(){
  var ORION=window.ORION, ic=ORION.v22.ic, esc=ORION.v22.esc;
  var ML=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  var CATS={logement:'Logement',transport:'Transport',alimentation:'Alimentation',abonnements:'Abonnements',enfants:'Enfants',credits:'Crédits',assurances:'Assurances',loisirs:'Loisirs',sante:'Santé',autres:'Autres'};

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function num(v){ v=parseFloat(v); return isFinite(v)?v:0; }
  function eur(v){ v=num(v); return (v<0?'-':'')+Math.abs(v).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'; }
  function short(v){ v=num(v); return Math.abs(v)>=1000?(v<0?'-':'')+(Math.abs(v)/1000).toLocaleString('fr-FR',{maximumFractionDigits:1})+'k €':eur(v); }
  function isAuto(r){ return !!(r&&r.auto)||/salaire|paie|pay/i.test((r&&r.name)||''); }
  function daysLeft(s){ if(!s)return null; var p=String(s).split('-'); if(p.length!==3)return null; var d=new Date(+p[0],+p[1]-1,+p[2]); d.setHours(0,0,0,0); var t=new Date(); t.setHours(0,0,0,0); return Math.round((d-t)/86400000); }

  function budget(){ // lecture directe (toujours à jour car app.js écrit bgt4 à chaque changement)
    var keys=['bgt4','budgetV3','budgetV2'];
    for(var i=0;i<keys.length;i++){ try{ var v=localStorage.getItem(keys[i]); if(v){ var d=JSON.parse(v); if(d&&(d.months||d.years||d.monthlyData)) return d; } }catch(e){} }
    return {currentMonth:new Date().getMonth(),months:{},savings:{}};
  }
  function goalsList(){ try{ var g=JSON.parse(localStorage.getItem('orion_v21_goals')||'[]'); return Array.isArray(g)?g:[]; }catch(e){ return []; } }
  function curMonth(b){ return Number.isInteger(b.currentMonth)?b.currentMonth:new Date().getMonth(); }
  function curYear(b){ return Number.isInteger(b.currentYear)?b.currentYear:new Date().getFullYear(); }
  function monthObj(b,i){
    var mo=null;
    if(b.monthlyData){ var key=curYear(b)+'-'+('0'+(i+1)).slice(-2); mo=b.monthlyData[key]; }
    if(!mo && b.years){ var Y=b.years[curYear(b)]||b.years[String(curYear(b))]; mo=Y&&Y.months&&(Y.months[i]||Y.months[String(i)]); }
    if(!mo && b.months){ mo=b.months[i]||b.months[String(i)]; }
    return {income:(mo&&mo.income)||[],expenses:(mo&&mo.expenses)||[],savings:(mo&&mo.savings)||{amount:0}};
  }

  function totalsOf(mo){
    var tin=0,tex=0,pin=0,pex=0;
    mo.income.forEach(function(r){ tin+=num(r.amount); if(r.paid||isAuto(r)) pin+=num(r.amount); });
    mo.expenses.forEach(function(r){ tex+=num(r.amount); if(r.paid) pex+=num(r.amount); });
    var future=mo.expenses.filter(function(r){return !r.paid;}).reduce(function(s,r){return s+num(r.amount);},0);
    return { tin:tin,tex:tex,pin:pin,pex:pex, solde:pin-pex, final:pin-tex, futureAll:tin-pin, future:future,
             sav:num(mo.savings&&mo.savings.amount), pct:tin?Math.round(tex/tin*100):0 };
  }
  function catTotals(mo){ var o={}; mo.expenses.forEach(function(r){ if(num(r.amount)>0) o[r.cat||'autres']=(o[r.cat||'autres']||0)+num(r.amount); }); return o; }
  function yearFinals(b){ var a=[]; for(var k=0;k<12;k++){ a.push(totalsOf(monthObj(b,k)).final); } return a; }

  function sparkFrom(vals,stroke){
    stroke=stroke||'#16C47F';
    if(!vals||vals.length<2) vals=[0,0];
    var mx=Math.max.apply(null,vals),mn=Math.min.apply(null,vals),rng=(mx-mn)||1,W=280,H=54,step=W/(vals.length-1);
    var pts=vals.map(function(v,i){ return (i*step).toFixed(0)+','+(H-5-(v-mn)/rng*(H-12)).toFixed(1); }).join(' ');
    return '<div class="spark" style="margin:8px 0 0"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="width:100%;height:54px;display:block"><polyline points="'+pts+'" fill="none" stroke="'+stroke+'" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
  }
  function statRow(label,val,cls){ return '<div class="rowline" style="padding:9px 0;border-top:1px solid var(--line)"><span class="sub">'+label+'</span><b style="font-weight:800;color:'+(cls||'var(--navy)')+'">'+val+'</b></div>'; }
  function bigStat(label,val,cls){ return '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--dim)">'+label+'</div><div style="font-size:20px;font-weight:800;color:'+(cls||'var(--navy)')+';margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+val+'</div></div>'; }

  /* ═══════════════════════════════════════════════════════════════════
     MODULE #6 — Prévision de fin de mois
     ═══════════════════════════════════════════════════════════════════ */
  ORION.register({
    id:'forecast', order:14, title:'Prévision', subtitle:'Fin de mois & projection',
    icon:ic('clock'),
    render:function(){
      var b=budget(), i=curMonth(b), t=totalsOf(monthObj(b,i));
      var prevoyant=t.tin-t.tex, prudent=t.pin-t.tex;
      // projection mois prochain = moyenne des mois renseignés (tin-tex)
      var vals=[]; for(var k=0;k<12;k++){ var tt=totalsOf(monthObj(b,k)); if(tt.tin||tt.tex) vals.push(tt.tin-tt.tex); }
      var proj = vals.length?vals.reduce(function(s,x){return s+x;},0)/vals.length : prevoyant;
      return ''
        +'<section class="card"><div class="eyebrow" style="margin-bottom:10px">'+ML[i]+'</div>'
          +'<div style="display:flex;gap:14px">'+bigStat('Argent restant',eur(t.solde),t.solde<0?'var(--red)':'var(--navy)')+bigStat('Disponible fin de mois',eur(prevoyant),prevoyant<0?'var(--red)':'var(--green-d)')+'</div>'
          +sparkFrom(yearFinals(b),'#16C47F')
        +'</section>'
        +'<section class="card"><h2 class="v22-h2">Détail du mois</h2>'
          +statRow('Revenus reçus',eur(t.pin),'var(--green-d)')
          +statRow('Revenus à venir',eur(t.futureAll))
          +statRow('Dépenses payées',eur(t.pex))
          +statRow('Dépenses restantes (engagé)',eur(t.future),'var(--orange)')
          +statRow('Prévision prudente (hors revenus à venir)',eur(prudent),prudent<0?'var(--red)':'var(--navy)')
        +'</section>'
        +'<section class="card"><h2 class="v22-h2">Projection mois prochain</h2>'
          +'<div class="insight"><div class="ic">'+ic('clock')+'</div><div><b>'+eur(proj)+' estimés</b><p>Basé sur la moyenne de tes '+(vals.length||1)+' mois renseignés. S’affinera avec les dépenses récurrentes (Phase 2).</p></div></div>'
        +'</section>';
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     MODULE #4 — Assistant ORION intelligent
     ═══════════════════════════════════════════════════════════════════ */
  function advices(b){
    var i=curMonth(b), mo=monthObj(b,i), prev=monthObj(b,(i+11)%12), t=totalsOf(mo), tp=totalsOf(prev);
    var list=[];
    // 1. Dérives par catégorie vs mois précédent
    var ct=catTotals(mo), cp=catTotals(prev);
    Object.keys(ct).forEach(function(k){
      if(cp[k]>0){ var diff=(ct[k]-cp[k])/cp[k]*100;
        if(diff>=15) list.push({ic:'alert',c:'var(--red)',t:'Hausse en '+(CATS[k]||k),x:'Tu dépenses '+Math.round(diff)+' % de plus qu’au mois précédent ('+eur(ct[k])+').'});
        else if(diff<=-15) list.push({ic:'shield',c:'var(--green-d)',t:(CATS[k]||k)+' bien maîtrisé',x:'−'+Math.round(-diff)+' % vs le mois dernier. Continue comme ça.'});
      }
    });
    // 2. Prélèvements de la semaine
    var soon=mo.expenses.filter(function(r){ var d=daysLeft(r.dueDate); return !r.paid&&num(r.amount)>0&&d!=null&&d>=0&&d<=7; });
    if(soon.length>=2){ var s=soon.reduce(function(a,r){return a+num(r.amount);},0); list.push({ic:'clock',c:'var(--orange)',t:'Plusieurs prélèvements cette semaine',x:soon.length+' échéances pour '+eur(s)+' d’ici 7 jours.'}); }
    // 3. Épargne possible (loisirs + restaurants au-dessus de 15% des dépenses)
    var disc=(ct.loisirs||0)+(ct.abonnements||0); if(t.tex>0 && disc/t.tex>0.15){ list.push({ic:'save',c:'var(--green-d)',t:'Économie possible',x:'En optimisant loisirs/abonnements, tu pourrais dégager ~'+eur(Math.round(disc*0.2))+'.'}); }
    // 4. Taux d'épargne
    if(t.tin>0){ var tx=Math.round(t.sav/t.tin*100); if(tx>=15) list.push({ic:'save',c:'var(--green-d)',t:'Bon taux d’épargne',x:'Tu épargnes '+tx+' % de tes revenus ce mois-ci.'}); else if(t.sav>0) list.push({ic:'save',c:'var(--navy)',t:'Épargne en cours',x:'Taux d’épargne actuel : '+tx+' %.'}); }
    // 5. Objectif principal
    var g=goalsList()[0]; if(g&&num(g.target)>0){ var monthly=num(b.savings&&b.savings.monthlyTarget)||t.sav; var remain=Math.max(0,num(g.target)-num(g.current)); if(monthly>0){ var mois=Math.ceil(remain/monthly); list.push({ic:'clock',c:'var(--navy)',t:'Objectif '+esc(g.n),x:'Atteint dans ~'+mois+' mois au rythme actuel.'}); } }
    // 6. Budget dépassé
    if(t.tex>t.tin && t.tin>0) list.push({ic:'alert',c:'var(--red)',t:'Budget dépassé',x:'Tes dépenses ('+eur(t.tex)+') dépassent tes revenus ('+eur(t.tin)+').'});
    if(!list.length) list.push({ic:'shield',c:'var(--green-d)',t:'Tout est sous contrôle',x:'Aucune alerte ce mois-ci. Renseigne plus de lignes pour des analyses plus fines.'});
    return list;
  }
  ORION.register({
    id:'assistant', order:16, title:'Assistant ORION', subtitle:'Conseils automatiques',
    icon:ic('spark'),
    render:function(){
      var b=budget(); var list=advices(b);
      return '<section class="card"><div class="insight"><div class="ic">'+ic('spark')+'</div><div><b>Analyse automatique</b><p>ORION examine tes revenus, dépenses, catégories, épargne et objectifs.</p></div></div></section>'
        +list.map(function(a){ return '<section class="card"><div class="insight"><div class="ic" style="background:var(--gray-l);color:'+a.c+'">'+ic(a.ic)+'</div><div><b style="color:'+a.c+'">'+esc(a.t)+'</b><p>'+esc(a.x)+'</p></div></div></section>'; }).join('');
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     MODULE #9 — Analyse Premium
     ═══════════════════════════════════════════════════════════════════ */
  ORION.register({
    id:'premium', order:12, title:'Analyse Premium', subtitle:'Stats avancées',
    icon:ic('grid'),
    render:function(){
      var b=budget(), i=curMonth(b), mo=monthObj(b,i), t=totalsOf(mo), tp=totalsOf(monthObj(b,(i+11)%12));
      var ct=catTotals(mo), ck=Object.keys(ct).sort(function(a,c){return ct[c]-ct[a];});
      var big=ck[0]?{k:ck[0],v:ct[ck[0]]}:null;
      var maxLine=mo.expenses.filter(function(r){return num(r.amount)>0;}).sort(function(a,c){return num(c.amount)-num(a.amount);})[0];
      var yf=yearFinals(b), annual=yf.reduce(function(s,x){return s+x;},0);
      var txEp=t.tin?Math.round(t.sav/t.tin*100):0;
      function pct(a,c){ if(!a)return '—'; var v=Math.round((c-a)/Math.abs(a)*100); return (v>0?'+':'')+v+' %'; }
      return ''
        +'<section class="card"><div style="display:flex;gap:14px">'+bigStat('Taux d’épargne',txEp+' %','var(--green-d)')+bigStat('Reste à vivre',eur(t.final),t.final<0?'var(--red)':'var(--navy)')+'</div></section>'
        +'<section class="card"><h2 class="v22-h2">Historique annuel (reste à vivre / mois)</h2>'+sparkFrom(yf,'#16C47F')
          +statRow('Projection annuelle cumulée',eur(annual),annual<0?'var(--red)':'var(--green-d)')+'</section>'
        +'<section class="card"><h2 class="v22-h2">Points clés du mois</h2>'
          +(big?statRow('Plus gros poste',(CATS[big.k]||big.k)+' · '+eur(big.v)):'')
          +(maxLine?statRow('Plus grosse dépense',esc(maxLine.name)+' · '+eur(maxLine.amount)):'')
          +statRow('Évolution des dépenses',pct(tp.tex,t.tex), t.tex<=tp.tex?'var(--green-d)':'var(--red)')
        +'</section>'
        +'<section class="card"><h2 class="v22-h2">Comparaison mois précédent</h2>'
          +statRow('Revenus',short(tp.tin)+' → '+short(t.tin))
          +statRow('Dépenses',short(tp.tex)+' → '+short(t.tex), t.tex<=tp.tex?'var(--green-d)':'var(--red)')
          +statRow('Reste',short(tp.final)+' → '+short(t.final), t.final>=tp.final?'var(--green-d)':'var(--red)')
        +'</section>'
        +'<section class="card"><div class="insight"><div class="ic">'+ic('spark')+'</div><div><b>Résumé ORION</b><p>'+(t.final>=0?'Mois équilibré : ':'Attention : ')+'reste à vivre de '+eur(t.final)+', taux d’épargne '+txEp+' %'+(big?', poste principal '+(CATS[big.k]||big.k):'')+'.</p></div></div></section>';
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     MODULE #10 — Objectifs Premium
     ═══════════════════════════════════════════════════════════════════ */
  ORION.register({
    id:'goalspro', order:18, title:'Objectifs Premium', subtitle:'Projections & échéances',
    icon:ic('save'),
    render:function(){
      var b=budget(), gs=goalsList(), t=totalsOf(monthObj(b,curMonth(b)));
      var monthly=num(b.savings&&b.savings.monthlyTarget)||t.sav;
      if(!gs.length) return '<section class="card"><p class="empty">Aucun objectif. Ajoute-en dans l’onglet Objectifs.</p></section>';
      return gs.map(function(g){
        var target=num(g.target),current=num(g.current),pctv=target>0?Math.min(100,Math.round(current/target*100)):0;
        var remain=Math.max(0,target-current);
        var mois=monthly>0?Math.ceil(remain/monthly):null;
        var when='Définis un rythme d’épargne';
        if(mois!=null){ if(mois===0) when='Objectif atteint 🎉'; else { var dd=new Date(); dd.setMonth(dd.getMonth()+mois); when=ML[dd.getMonth()]+' '+dd.getFullYear(); } }
        return '<section class="card"><div class="goal-card"><div class="big-emoji">'+(g.e||'🎯')+'</div><div class="middle"><h3>'+esc(g.n)+'</h3><p>'+eur(current)+' / '+eur(target)+'</p><div class="progress"><span style="width:'+pctv+'%"></span></div></div><b class="pct">'+pctv+'%</b></div>'
          +statRow('Reste à économiser',eur(remain),'var(--navy)')
          +statRow('Temps restant',mois!=null?(mois+' mois'):'—')
          +statRow('Date estimée',when,'var(--green-d)')
          +'</section>';
      }).join('');
    }
  });

});
})();
