/* Demo animate: ogni scena è un elenco di passi. Gli elementi con data-s="n" compaiono dal passo n, quelli con data-x="n" spariscono dal passo n.
   A riposo (senza JavaScript o con movimento ridotto) la scena mostra lo stato finale completo. */
const I=n=>`<svg class="ic"><use href="/icons.svg#${n}"/></svg>`;
const DEMOS={
 extract:{title:"trama · Passo 2 di 6 · Requisiti",steps:["Carichi il documento: Word, PDF, Excel o immagini.","Claude lo legge e propone un requisito per riga.","Ogni riga ha componenti, release e dipendenze.","Le ambiguità diventano domande aperte.","Il PO controlla e valida la lista."],
  html:`<div class="d-grid"><div data-s="0"><p class="label-s">Documento</p><div class="doc"><div class="doc-h">${I("i-file")}Requisiti_OrtoComune_v2.docx</div>
   <p><mark>RF-013 · Richiesta di un lotto con lista d'attesa</mark> ordinata per data.</p><p>RF-020 · Calendario dei turni di irrigazione.</p><p>RF-025 · Sospensione turni per allerta meteo.</p><p>RM-01 · App per iOS e Android: <mark>nativa o cross-platform?</mark></p></div></div>
   <div class="stack"><p class="label-s" data-s="1">Requisiti estratti</p>
   <div class="req" data-s="1"><span class="key">RF-013</span><b>Richiesta lotto con lista d'attesa</b><span class="pill primary">MVP</span></div>
   <div class="req" data-s="2"><span class="key">RF-020</span><b>Calendario dei turni</b><span class="pill primary">MVP</span></div>
   <div class="req" data-s="2"><span class="key">RF-025</span><b>Sospensione per allerta meteo</b><span class="pill">Release 1.0</span></div>
   <div class="row" data-s="2"><span class="pill">Web App</span><span class="pill">Mobile App</span><span class="pill">Back-end</span><span class="pill accent">dipende da RF-060</span></div>
   <div class="req" data-s="3"><span class="key">RM-01</span><b>Tecnologia dell'app mobile</b><span class="pill err">domanda aperta</span></div>
   <div data-s="4"><span class="done-badge">${I("i-check")}75 requisiti · 12 domande aperte · lista validata</span></div></div></div>`},
 split:{title:"trama · Passo 5 di 6 · Backlog",steps:["Un requisito con interfaccia e design non pronto.","Trama propone la UX Story per il design.","Poi le storie BE, FE Web e FE Mobile, collegate.","Il controllo trova un metadato mancante.","Corretto: tutti i metadati del kit sono a posto."],
  html:`<div class="stack"><div class="req" data-s="0"><span class="key">RF-020</span><b>Calendario dei turni di irrigazione</b><span class="pill">Web · Mobile · BE</span></div>
   <div class="d-grid" style="margin-top:6px"><div class="stack">
   <div class="tk ux" data-s="1"><span class="key">T-014</span><span class="t" data-no-i18n><em>[UX - Web/Mobile]</em> Watering shifts calendar design</span><span class="m"><span class="pill accent">UX Story</span><span class="pill">UX-UI</span></span></div>
   <div class="tk" data-s="2"><span class="key">T-015</span><span class="t" data-no-i18n><em>[BE]</em> Shifts API and rotation rules</span><span class="m"><span class="pill">Story</span><span class="pill">Back-End</span><span class="pill primary">blocca T-016, T-017</span></span></div>
   <div class="tk" data-s="2"><span class="key">T-016</span><span class="t" data-no-i18n><em>[FE - Web]</em> Shifts calendar</span><span class="m"><span class="pill">Story</span><span class="pill">UI</span></span></div>
   <div class="tk" data-s="2"><span class="key">T-017</span><span class="t" data-no-i18n><em>[FE - Mobile]</em> Shifts calendar</span><span class="m"><span class="pill">Story</span><span class="pill">UI</span></span></div></div>
   <div class="card" style="padding:14px" data-s="3"><p class="label-s">Controllo metadati · T-017</p><div class="stack">
   <div class="chk">${I("i-check")}Label di release: MVP</div><div class="chk">${I("i-check")}Label di tipo lavoro: UI</div><div class="chk">${I("i-check")}Prefisso nel titolo: [FE - Mobile]</div>
   <div class="chk bad" data-x="4">${I("i-alert")}Epica mancante (K3)</div><div class="chk" data-s="4">${I("i-check")}Epica: Turni e presenze</div>
   <div data-s="4" style="margin-top:6px"><span class="pill ok">pronto per Jira</span></div></div></div></div></div>`},
 jira:{title:"trama · Passo 6 di 6 · Crea su Jira",steps:["Il controllo è verde: si conferma e si crea.","Prima il Project, sotto il cliente COM.","Poi le Fasi, con il Project come Principale.","Le epiche sotto la Fase, le storie sotto l'epica.","Trama rilegge Jira: ogni livello è collegato."],
  html:`<div class="tree"><div class="row" data-s="0" style="margin-bottom:6px"><span class="pill ok">${I("i-check")}9 controlli superati</span><span class="pill">1 Project · 2 Fasi · 6 epiche · 48 ticket</span></div>
   <div class="node" data-s="1"><span class="lv">Project</span><b>OrtoComune</b><span class="key">COM-901</span></div>
   <div class="node n1" data-s="2"><span class="lv">Fase</span><b>Analisi</b><span class="key">COM-902</span></div>
   <div class="node n1" data-s="2"><span class="lv">Fase</span><b>Sviluppo MVP</b><span class="key">COM-903</span></div>
   <div class="node n2" data-s="3"><span class="lv">Feature Epic</span><b>Turni e presenze</b><span class="key">COM-904</span></div>
   <div class="node n3" data-s="3"><span class="lv">Story</span><b>[BE] Shifts API and rotation rules</b><span class="key">COM-905</span></div>
   <div class="node n3" data-s="3"><span class="lv">Story</span><b>[FE - Web] Shifts calendar</b><span class="key">COM-906</span></div>
   <div data-s="4" style="margin-top:6px"><span class="done-badge">${I("i-check")}Struttura verificata: 57 di 57 livelli collegati</span></div></div>`},
 plan:{title:"trama · Passo 5 di 6 · Qualità del backlog",steps:["Chiedi a Claude un controllo del backlog.","Segnala un criterio vago, con la correzione.","Le altre segnalazioni, in ordine di gravità.","Correggi e ricontrolla: il backlog è pronto."],
  html:`<div class="d-grid"><div class="stack"><div class="bub u" data-s="0">Controlla la qualità del backlog dell'MVP</div>
   <div class="card" style="padding:12px" data-s="1"><div class="row"><span class="key">T-016</span><span class="pill err">alta</span><span class="pill primary">Criteri vaghi</span></div><p style="margin:8px 0 4px;font-size:13.5px">«Funziona bene su mobile» non è verificabile.</p><p style="margin:0;font-size:13px;color:var(--muted)">Cosa fare: calendario leggibile da 360 px, caricamento sotto 2 s.</p></div></div>
   <div class="stack" data-s="2"><p class="label-s">Altre segnalazioni</p>
   <div class="req"><span class="key">T-021</span><b>Storia senza criteri di accettazione</b><span class="pill accent">media</span></div>
   <div class="req"><span class="key">T-033</span><b>Dipendenza dal firmware non indicata</b><span class="pill accent">media</span></div>
   <div class="req"><span class="key">T-040</span><b>Titolo troppo generico</b><span class="pill">bassa</span></div>
   <div data-s="3" style="margin-top:6px"><span class="done-badge">${I("i-check")}Nessuna segnalazione alta · backlog pronto per Jira</span></div></div></div>`}};

function makePlayer(host,key){
  const d=DEMOS[key],reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  host.innerHTML=`<div class="player" role="group" aria-label="Demo animata: ${d.title}"><div class="p-bar"><span class="p-dots"><i></i><i></i><i></i></span><span class="p-title">${d.title}</span><span class="pill">demo</span></div><div class="screen">${d.html}</div><div class="p-ctrl"><button class="p-btn" type="button">${I("i-pause")}</button><div class="p-track"><i></i></div><div class="p-cap" aria-live="polite"></div></div></div>`;
  const pl=host.querySelector(".player"),btn=pl.querySelector(".p-btn"),bar=pl.querySelector(".p-track i"),cap=pl.querySelector(".p-cap");
  const STEP=2700,N=d.steps.length;let step=N-1,timer=null,playing=false,t0=0,raf=null,userPaused=false,io=null;
  const show=s=>{step=s;pl.querySelectorAll("[data-s]").forEach(e=>e.classList.toggle("on",+e.dataset.s<=s));pl.querySelectorAll("[data-x]").forEach(e=>e.classList.toggle("off",+e.dataset.x<=s));cap.innerHTML=`<b>${s+1}/${N}</b>${d.steps[s]}`};
  const setBtn=()=>{btn.innerHTML=playing?I("i-pause"):(step>=N-1?I("i-replay"):I("i-play"));btn.setAttribute("aria-label",playing?"Metti in pausa la demo":"Riproduci la demo")};
  const tick=()=>{if(!playing)return;bar.style.width=Math.min(100,((step+(performance.now()-t0)/STEP)/N)*100)+"%";raf=requestAnimationFrame(tick)};
  const next=()=>{if(step<N-1){show(step+1);t0=performance.now();timer=setTimeout(next,STEP)}else{timer=setTimeout(()=>{show(0);t0=performance.now();timer=setTimeout(next,STEP)},STEP+1400)}};
  function play(){if(playing)return;pl.classList.add("playing");if(step>=N-1)show(0);playing=true;t0=performance.now();timer=setTimeout(next,STEP);setBtn();tick()}
  function stop(){playing=false;clearTimeout(timer);cancelAnimationFrame(raf);setBtn()}
  btn.onclick=()=>{if(playing){userPaused=true;stop()}else{userPaused=false;play()}};
  show(N-1);bar.style.width="100%";setBtn();
  if(!reduce){io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting&&!playing&&!userPaused)play();else if(!e.isIntersecting&&playing)stop()}),{threshold:.35});io.observe(pl)}
  return{destroy(){stop();io&&io.disconnect()}}}

makePlayer(document.getElementById("heroPlayer"),"extract");
let current=makePlayer(document.getElementById("mainPlayer"),"split");
document.querySelector(".chapters").addEventListener("click",e=>{const b=e.target.closest(".chapter");if(!b)return;document.querySelectorAll(".chapter").forEach(x=>x.setAttribute("aria-selected",x===b?"true":"false"));current.destroy();current=makePlayer(document.getElementById("mainPlayer"),b.dataset.demo)});

/* Esempi pratici */
const EX=[
 {in:`<h4>Requisito nel documento</h4><div class="doc"><div class="doc-h">${I("i-file")}Requisiti_OrtoComune_v2.docx · pag. 6</div><p><mark>RF-025 · Sospensione automatica dei turni in caso di allerta meteo</mark> (pioggia intensa, gelo). Se il servizio meteo non risponde, i turni restano confermati.</p></div><p class="ex-note">Componenti: Back-end, Web, Mobile · Release 1.0 · dipende da RF-020 e RF-060.</p>`,
  out:`<h4>Ticket proposti da Trama</h4><div class="tk"><span class="key">T-031</span><span class="t" data-no-i18n><em>[BE]</em> Weather alert shift suspension</span><span class="m"><span class="pill">Story</span><span class="pill">Back-End</span><span class="pill">Release1.0</span></span></div>
   <div class="tk"><span class="key">T-032</span><span class="t" data-no-i18n><em>[FE - Mobile]</em> Suspended shift banner and push</span><span class="m"><span class="pill">Story</span><span class="pill">UI</span></span></div>
   <div class="ticket-doc" tabindex="0" role="region" aria-label="Esempio di ticket completo" data-no-i18n><b>## Context</b>
RF-025: shifts are suspended automatically on weather alerts.

<b>## User story</b>
As a gardener, I want my shift to be suspended on a weather alert, so that I don't go to the garden for nothing.

<b>## Scope / Action</b>
* Poll the weather service every 30 min for the garden area.
* Suspend shifts on heavy rain or frost; notify enrolled users (RF-060).
* If the weather service is down, keep shifts confirmed (RNF-12).

<b>## Points to clarify</b>
* Threshold for "heavy rain": mm/h or official alert level?

<b>## Acceptance criteria</b>
* An alert suspends all shifts of that garden within 30 min.
* Users receive a push and an email.</div>`},
 {in:`<h4>Domanda aperta</h4><div class="doc"><p><b>RM-01</b> · Il documento lascia aperta la scelta tra app nativa e cross-platform. Qual è la tecnologia decisa?</p></div><p class="ex-note">Senza risposta, ogni ticket FE - Mobile andrebbe scritto due volte.</p>`,
  out:`<h4>Risposta e registro delle decisioni</h4><div class="card" style="padding:16px"><div class="row"><span class="pill ok">Risposta</span><span class="pill">Cliente</span></div><p style="margin:10px 0 0">App cross-platform (Flutter), una base di codice per iOS e Android.</p></div>
   <div class="ticket-doc" tabindex="0" role="region" aria-label="Esempio di ticket completo" style="max-height:none"><b>Registro · 16/10/2026</b>
Decisione: l'app mobile è cross-platform (Flutter).
Chi: Cliente · Fonte: Domande di apertura
Impatto: un solo ticket FE - Mobile per funzione;
label Android e iOS solo per i casi di piattaforma.
Regola del kit: K5 · Label</div><p class="ex-note">Da quel momento Claude scompone i requisiti mobile con un ticket solo.</p>`},
 {in:`<h4>Ticket in bozza</h4><div class="tk"><span class="key">T-016</span><span class="t" data-no-i18n><em>[FE - Web]</em> Shifts calendar</span><span class="m"><span class="pill">Story</span></span></div><div class="ticket-doc" tabindex="0" role="region" aria-label="Esempio di ticket completo" data-no-i18n><b>## Acceptance criteria</b>
* The calendar works well.</div>`,
  out:`<h4>Segnalazione del controllo qualità</h4><div class="card" style="padding:16px"><div class="row"><span class="key">T-016</span><span class="pill err">alta</span><span class="pill primary">Criteri vaghi</span></div><p style="margin:10px 0 4px">«Works well» non è verificabile.</p><p style="margin:0;color:var(--muted);font-size:15px">Cosa fare: indicare viste, larghezza minima e tempi.</p></div>
   <div class="ticket-doc" tabindex="0" role="region" aria-label="Esempio di ticket completo" data-no-i18n><b>## Acceptance criteria</b>
* Week and month views, readable from 360 px.
* The calendar loads in under 2 s with 200 shifts.
* Suspended shifts are shown in grey with the reason.

<b>## Points to clarify</b>
* Do referents see all gardens or only theirs?</div><p class="ex-note">Il punto da chiarire viene aggiunto con un clic; la scelta resta tua.</p>`}];
const exBox=document.getElementById("exBox");
function showEx(i){exBox.innerHTML=`<div class="example" role="tabpanel"><div class="ex-in">${EX[i].in}</div><div class="arrow" aria-hidden="true">${I("i-arrow")}</div><div class="ex-out">${EX[i].out}</div></div>`;document.querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-selected",+t.dataset.ex===i?"true":"false"))}
document.querySelector(".tabs").addEventListener("click",e=>{const t=e.target.closest(".tab");if(t)showEx(+t.dataset.ex)});showEx(0);

/* Lingua: lo stesso switch dell'header di Trama; la scelta vale anche dentro Trama */
{const dd=document.getElementById("langDd"),btn=document.getElementById("langBtn"),menu=document.getElementById("langMenu");
 const close=focus=>{menu.hidden=true;btn.setAttribute("aria-expanded","false");if(focus)btn.focus()};
 btn.addEventListener("click",()=>{const open=menu.hidden;menu.hidden=!open;btn.setAttribute("aria-expanded",String(open));if(open)menu.querySelector('[aria-checked="true"]')?.focus()});
 menu.addEventListener("click",e=>{const b=e.target.closest("[data-lang]");if(!b)return;if(b.dataset.lang===window.I18N?.lang)return close(true);window.I18N?.set(b.dataset.lang);location.reload()});
 menu.addEventListener("keydown",e=>{const it=[...menu.querySelectorAll("[data-lang]")],i=it.indexOf(document.activeElement);if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();it[(i+(e.key==="ArrowDown"?1:it.length-1))%it.length].focus()}});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!menu.hidden)close(true)});
 document.addEventListener("click",e=>{if(!menu.hidden&&!dd.contains(e.target))close(false)});}
