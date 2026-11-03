const app=document.querySelector('#app'), network=document.querySelector('#network');
const help=document.querySelector('#help'), confirm=document.querySelector('#confirm');
const apiBase=window.MRNGO_CONFIG?.apiBase?.replace(/\/$/,'');
const fragment=new URLSearchParams(location.hash.slice(1));
const route=fragment.get('study')?{studyId:fragment.get('study'),joinCode:fragment.get('join')}:{};
const completedMessage='Te már résztvettél ebben a kísérletben. Nagyon köszönjük a segítséget!';
let study,auth,state,neptun='',consented=false,busy=false,practiceFeatures=[],pendingFeature=null,lastTrial=null,opening=0;
// Remove only this application's legacy saved state. No browser storage is written.
try{for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.startsWith('mrngo-'))storage.removeItem(key);}catch{}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function view(kind){document.body.className=kind;window.scrollTo({top:0,behavior:'instant'});}
function message(error){if(error.name==='StaleOpening')return;const el=document.querySelector('.error');if(el)el.textContent=error.message||String(error);}
async function api(path,body={},authenticated=true){
  const requestOpening=opening;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(apiBase+path,{method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...(authenticated&&auth?{Authorization:'Bearer '+auth.token}:{})},body:JSON.stringify(body)});
    const data=await response.json();if(requestOpening!==opening)throw Object.assign(new Error('Korábbi megnyitás.'),{name:'StaleOpening'});if(!response.ok)throw Object.assign(new Error(data.error||'A mentés nem sikerült. Próbálja újra.'),{status:response.status});return data;
  }catch(error){
    if(requestOpening!==opening)throw Object.assign(new Error('Korábbi megnyitás.'),{name:'StaleOpening'});
    if(error instanceof TypeError||error.name==='AbortError')throw new Error('Nem érhető el a szerver. Kérjük, próbálja újra. A még nem visszaigazolt válasz mentéséig ne zárja be ezt az oldalt.');
    throw error;
  }finally{clearTimeout(timer);}
}
async function action(fn){
  if(busy)return;const actionOpening=opening;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await fn();}catch(error){
    if(actionOpening!==opening||error.name==='StaleOpening')return;
    if(error.status===401){auth=null;state=null;neptunScreen('A részvételt egy másik megnyitásban folytatta, vagy a kutató törölte. Kérjük, adja meg újra a Neptun-kódot.');}
    else{message(error);if(document.querySelector('#demography-frame'))document.querySelector('#demography-frame').contentWindow.postMessage({type:'demographics-error',message:error.message},location.origin);}
  }finally{if(actionOpening===opening){busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=b.dataset.locked==='true');if(confirm.open)document.querySelector('#edit').focus();}}
}
function scene(text,label,next,withMimo=false){
  view('scene');app.innerHTML=`<section class="scene-screen"><div class="scene-content">${withMimo?'<img class="scene-mimo" src="./assets/mimo-frontal.png" alt="M.I.M.O.">':''}${text.split('\n\n').map(p=>`<p>${escape(p).replaceAll('\n','<br>')}</p>`).join('')}<button id="scene-next">${escape(label)}</button><p class="error" role="alert"></p></div></section>`;
  document.querySelector('#scene-next').onclick=()=>action(next);
}
function neptunScreen(error=''){
  auth=null;state=null;neptun='';consented=false;practiceFeatures=[];pendingFeature=null;lastTrial=null;
  view('entry');confirm.close();help.close();network.textContent='';
  app.innerHTML=`<section class="panel entry-panel"><img class="mimo" src="./assets/mimo-frontal.png" alt="M.I.M.O."><h1>Fogalmak magyarázata</h1><form id="neptun-form" autocomplete="off"><label for="neptun">Kérjük, adja meg a Neptun-kódját.</label><input id="neptun" name="neptun" autocomplete="off" autocapitalize="characters" spellcheck="false" required minlength="5" maxlength="6" pattern="(?:[A-Za-z0-9]{6}|[Tt][Ee][Ss][Zz][Tt])"><p class="muted">Ha már megkezdte a kísérletet, ugyanazzal a kóddal folytathatja.</p><button type="submit">Folytatás</button><p class="error" role="alert">${escape(error)}</p></form></section>`;
  document.querySelector('form').onsubmit=e=>{e.preventDefault();action(async()=>{
    neptun=new FormData(e.target).get('neptun').trim().toUpperCase();auth={token:token(),sessionId:crypto.randomUUID()};
    const result=await api('/participants/enter',{...route,neptun,token:auth.token},false);
    if(result.status==='completed'){auth=null;renderCompleted();return;}
    if(result.status==='resume'){state=result.state;renderStage();return;}
    study=result.study;consented=false;welcome();
  });};
}
function renderCompleted(){view('scene');network.textContent='';app.innerHTML=`<section class="scene-screen"><div class="scene-content completion"><p>${completedMessage}</p></div></section>`;}
function welcome(){scene('Kedves Résztvevő!\nKöszönjük, hogy részt vesz kutatásunkban! A kísérlet során fogalmak magyarázatára fogjuk kérni. Ez 20–30 percet vesz igénybe, a részvétel önkéntes és bármikor megszakítható.\nA részvétel feltétele a magyar anyanyelv, normál pszichiátriai és neurológiai státusz.\nEgy tájékoztató és beleegyező nyilatkozatot fog látni a gombra kattintva, miután elolvasta, a lenti gomb megnyomásával továbbléphet.','Tájékoztató és beleegyező',async()=>consentDocument());}
function consentDocument(){
  view('document-view');const supplied=new URL(study.consentUrl,location.href);const src=supplied.origin===location.origin?supplied.href:'./tajekoztato.html';
  app.innerHTML=`<section class="document-screen"><iframe id="consent-frame" title="Tájékoztató és beleegyező nyilatkozat" src="${escape(src)}"></iframe><p class="error" role="alert"></p></section>`;
}
function demographicIntro(){scene('Elsőként kérlek válaszolj néhány demográfiai kérdésre.','Következő',async()=>demographics());}
function demographics(){view('demographics-view');app.innerHTML='<section class="demography-screen"><iframe id="demography-frame" title="Demográfia" src="./form_demo.html"></iframe><p class="error" role="alert"></p></section>';}
async function advance(stage){state=await api('/stage',{stage});renderStage();}
function renderStage(){
  if(state.done){renderCompleted();return;}
  switch(state.stage){
    case 'instruction':scene('A M.I.M.O. (Mesterséges Intelligencia a Magyarázatok Oktatásához) egy mesterséges intelligencia, amelynek célja, hogy emberi módon tudjon magyarázni, tanítani. Hogy ezt megtanulhassa, emberi gondolkodásmintákra és példákra van szüksége. Kísérletünkben arra kérjük, segítsen M.I.M.O.-nak, hogy jobban megértse, milyen jellemzőkkel írnak le egy-egy fogalmat az emberek.\n\nMinden bemutatott fogalomhoz kérjük, soroljon fel legalább 10 jellemzőt, amelyek Ön szerint kifejezik vagy leírják azt a fogalmat. Ha nincs ötlete, M.I.M.O. fejére bökve megnézheti segítő kérdéseit. Lehetősége van 10-nél több jellemzőt is felsorolni. Kérjük próbáljon értelmes mondatokban, felsorolásszerűen fogalmazni, ügyeljen a központozásra és az ékezetek használatára!\n\nÖsszesen 10 fogalom magyarázatára kérjük. Minden beküldött választ azonnal mentünk. Ha később ugyanazzal a Neptun-kóddal megnyitja a kísérletet, folytathatja a megkezdett részvételt.\n\nNincs helyes vagy helytelen válasz – a lényeg az, hogy M.I.M.O. megismerje, mit jelentenek a fogalmak. Kérjük kattintson a lenti gombra a folytatáshoz.','Folytatás',()=>advance('tutorial-intro'));break;
    case 'tutorial-intro':scene('Elsőként egy rövid videót fog látni arról, hogyan működik a feladat, kérjük figyelmesen nézze végig.','Indít',()=>advance('video'));break;
    case 'video':tutorial();break;
    case 'practice-intro':scene('Most egy gyakorlás következik. Ne feledje, használhatja a segítő kérdéseket, M.I.M.O. fejére kattintva.','Lássuk M.I.M.O.-t!',()=>advance('practice'));break;
    case 'practice':renderTrial(true);break;
    case 'start-experiment':scene('Vége a gyakorlásnak! Innen kezdődik a kísérlet. Ez körülbelül 20–30 percet vehet igénybe. A beküldött válaszokat mentjük, és ugyanazzal a Neptun-kóddal később is folytathatja.','Indít',()=>advance('experiment'));break;
    default:renderTrial(false);
  }
}
function tutorial(){
  view('scene');app.innerHTML='<section class="scene-screen"><div class="video-content"><video id="tutorial-video" controls playsinline preload="metadata" src="./assets/tutorial_video.mp4" aria-label="A feladat bemutatása"></video><p class="video-note">Kérjük, nézze végig a bemutatót.</p><p class="error" role="alert"></p><button id="retry-video" hidden>Videó újratöltése</button></div></section>';
  const video=document.querySelector('video');video.onended=()=>action(()=>advance('practice-intro'));
  video.onerror=()=>{message(new Error('A videó nem tölthető be. Kérjük, próbálja újra.'));document.querySelector('#retry-video').hidden=false;};
  document.querySelector('#retry-video').onclick=()=>{video.load();video.play().catch(()=>{});};video.play().catch(()=>{});
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  const consent=document.querySelector('#consent-frame'), form=document.querySelector('#demography-frame');
  if(consent&&event.source===consent.contentWindow&&event.data?.type==='adult-consent-accepted'){
    consented=true;demographicIntro();return;
  }
  if(!form||event.source!==form.contentWindow)return;
  if(event.data?.type==='demographics-height'&&Number.isFinite(event.data.height)){const height=Math.max(400,Math.min(event.data.height,10000));if(Math.abs(form.getBoundingClientRect().height-height)>1)form.style.height=height+'px';return;}
  if(event.data?.type==='adult-demographics')action(async()=>{
    if(!consented)throw new Error('Kérjük, előbb fogadja el a beleegyező nyilatkozatot.');
    state=await api('/sessions',{...route,neptun,sessionId:auth.sessionId,token:auth.token,demographics:event.data.demographics,consent:true,consentVersion:study.consentVersion,flowVersion:'pavlovia-v2'},false);
    renderStage();
  });
});
document.querySelector('#close-help').onclick=()=>help.close();
document.querySelector('#edit').onclick=()=>{confirm.close();document.querySelector('.entry')?.focus();};
document.querySelector('#finish').onclick=()=>action(async()=>{
  confirm.close();if(state.stage==='practice'){await advance('start-experiment');return;}
  state=await api('/complete',{assignmentId:state.current.id});pendingFeature=null;network.textContent='';renderStage();
});
function renderTrial(practicing){
  const current=state.current,trialKey=practicing?'practice':current.id;
  const name=practicing?(state.gender==='female'?'katica':'motor'):current.name;
  const responses=practicing?practiceFeatures:current.features;
  document.body.className='trial-view';
  app.innerHTML=`<section class="trial"><div class="trial-progress"><div class="progress" role="progressbar" aria-label="Elkészült fogalmak" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${state.completed}"><div style="width:${state.completed*10}%"></div></div><span class="progress-label">${practicing?'Gyakorlás':state.completed+' / 10 fogalom'}</span></div><header class="trial-heading"><div><p class="prompt">Magyarázd el nekem, mi az, hogy…</p><h1 class="concept">${escape(name)}</h1></div></header><div class="trial-workspace"><div class="composer"><button class="help-button" aria-label="M.I.M.O. segítő kérdései" title="Segítő kérdések"><img src="./assets/mimo-icon.png" alt=""></button><textarea id="feature-entry" class="entry" aria-label="Magyarázat" maxlength="2000" autocomplete="off" placeholder="Írd ide a magyarázatodat, hogy minél több jellemzőt tartalmazzon (legalább 10)."></textarea><button class="submit">Válasz beküldése</button></div><section class="response-panel" aria-labelledby="responses-title"><div class="response-heading"><h2 id="responses-title">Eddigi válaszok</h2><span class="response-count">${responses.length} válasz</span></div><div class="responses" role="log" aria-label="Eddigi válaszok">${responses.length?responses.map(f=>`<p>${escape(f.text)}</p>`).join(''):'<p class="empty-responses">A beküldött válaszok itt jelennek meg</p>'}</div></section></div><p class="error" role="alert"></p><footer class="trial-footer"><span class="trial-note">${practicing?'A gyakorlóválaszokat nem használjuk az adatfelvételben.':escape(state.studyName)}</span></footer></section>`;
  if(lastTrial!==trialKey)window.scrollTo({top:0,behavior:'instant'});lastTrial=trialKey;
  const entry=document.querySelector('.entry');if(pendingFeature){entry.value=pendingFeature.text;entry.readOnly=true;}
  document.querySelector('.help-button').onclick=()=>help.showModal();
  document.querySelector('.submit').onclick=()=>action(async()=>{
    const text=entry.value.trim();if(!text)throw new Error('Kérjük adjon meg választ a továbblépéshez.');
    if(practicing)practiceFeatures.push({text});
    else{
      pendingFeature||={id:crypto.randomUUID(),assignmentId:current.id,text};entry.readOnly=true;
      network.textContent='Válasz mentése…';await api('/features',pendingFeature);
      if(!current.features.some(f=>f.id===pendingFeature.id))current.features.push({id:pendingFeature.id,text:pendingFeature.text});
      pendingFeature=null;network.textContent='Minden beküldött válasz mentve.';
    }
    renderTrial(practicing);confirm.showModal();
  });
  entry.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();document.querySelector('.submit').click();}};
}
async function start(){
  opening++;busy=false;confirm.close();help.close();const previousVideo=document.querySelector('video');if(previousVideo){previousVideo.onended=null;previousVideo.pause();}
  auth=null;state=null;neptun='';consented=false;practiceFeatures=[];pendingFeature=null;lastTrial=null;
  view('entry');app.innerHTML='<section class="panel"><p>Betöltés…</p><p class="error" role="alert"></p><button id="retry">Újrapróbálás</button></section>';
  document.querySelector('#retry').onclick=()=>start().catch(message);
  if(!apiBase||(!apiBase.startsWith('https://')&&!['localhost','127.0.0.1'].includes(location.hostname)))throw new Error('Az adatfelvételi szerver még nincs beállítva.');
  if(!route.studyId||!route.joinCode){
    app.innerHTML='<section class="panel entry-panel"><h1>Fogalmak magyarázata</h1><p>Kérjük, a kurzushoz vagy adatfelvételhez kapott kísérleti hivatkozást nyissa meg.</p></section>';return;
  }
  study=await api('/entry-info',route,false);neptunScreen();
}
window.addEventListener('pageshow',e=>{if(e.persisted)start().catch(message);});
window.addEventListener('offline',()=>{network.textContent='Nincs internetkapcsolat. A még nem visszaigazolt választ ne zárja be; a mentéshez próbálja újra a beküldést.';});
start().catch(message);
