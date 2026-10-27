const app = document.querySelector('#app');
const network = document.querySelector('#network');
const help = document.querySelector('#help');
const confirm = document.querySelector('#confirm');
const apiBase = window.MRNGO_CONFIG?.apiBase?.replace(/\/$/, '');
const fragment = new URLSearchParams(location.hash.slice(1));
const studyId = fragment.get('study') || sessionStorage.getItem('mrngo-study');
if (studyId) sessionStorage.setItem('mrngo-study', studyId);
const joinCode = fragment.get('join') || sessionStorage.getItem(`mrngo-join:${studyId}`);
if (joinCode) sessionStorage.setItem(`mrngo-join:${studyId}`, joinCode);
// Keep enrollment codes out of copied addresses and referrers after first use.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
const key = `mrngo-session:${studyId}`;
let stored, state, study, practicing = false, practiceFeatures = [], busy = false;
try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch { stored = null; }
const persist = () => localStorage.setItem(key, JSON.stringify(stored));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(error) { const el = document.querySelector('.error'); if (el) el.textContent = error.message || String(error); }
async function api(path, body = {}, authenticated = true) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const result = await fetch(`${apiBase}${path}`, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(authenticated && stored ? { Authorization: `Bearer ${stored.token}` } : {}) }, body: JSON.stringify(body) });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || 'A mentés nem sikerült. Próbálja újra.');
    return data;
  } catch (e) {
    if (e instanceof TypeError || e.name === 'AbortError') throw new Error('Nem érhető el a szerver. A válasz ezen az eszközön megmaradt; csatlakozás után próbálja újra.');
    throw e;
  } finally { clearTimeout(timer); }
}
async function action(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { message(e); network.textContent = 'A művelet nem fejeződött be. Próbálja újra.'; }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
document.querySelector('#close-help').onclick = () => help.close();
document.querySelector('#edit').onclick = () => confirm.close();
document.querySelector('#finish').onclick = () => action(async () => {
  confirm.close();
  if (practicing) { practicing = false; stored.practiceDone = true; persist(); renderTrial(); return; }
  await flush();
  state = await api('/complete', { assignmentId: state.current.id });
  stored.draft = ''; persist(); network.textContent = 'Minden beküldött válasz mentve.'; renderTrial();
});
function introduction() {
  app.innerHTML = `<section class="panel"><img class="mimo" src="./assets/mimo-frontal.png" alt="M.I.M.O."><h1>Fogalmak magyarázata</h1><p>A M.I.M.O. (Mesterséges Intelligencia a Magyarázatok Oktatásához) egy mesterséges intelligencia, amelynek célja, hogy emberi módon tudjon magyarázni, tanítani. Ehhez emberi gondolkodásmintákra és példákra van szüksége.</p><p>Minden bemutatott fogalomhoz kérjük, soroljon fel legalább 10 jellemzőt, amelyek Ön szerint kifejezik vagy leírják azt a fogalmat. Ha nincs ötlete, M.I.M.O. fejére bökve megnézheti segítő kérdéseit. Lehetősége van 10-nél több jellemzőt is felsorolni. Kérjük próbáljon értelmes mondatokban, felsorolásszerűen fogalmazni, ügyeljen a központozásra és az ékezetek használatára!</p><p>Összesen <strong>10 fogalom</strong> magyarázatára kérjük, egy rövid gyakorlás után. A feladat körülbelül 20–30 percet vesz igénybe. Minden beküldött válaszát azonnal mentjük; ezen a böngészőn később is folytathatja.</p><p class="muted">Adatfelvétel: ${escape(study.name)}</p><button id="begin">Folytatás</button><p class="error" role="alert"></p></section>`;
  document.querySelector('#begin').onclick = demographics;
}
function demographics() {
  app.innerHTML = `<section class="panel"><h1>Demográfia</h1><p>Köszönjük, hogy részt vesz kutatásunkban! Kérjük, válaszoljon a lenti kérdésekre.</p><form id="demographics"><label>Neptun-kód<input name="neptun" required minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" autocapitalize="characters"></label><div class="two-col"><label>Életkor<input name="age" type="number" required min="18" max="110"></label><label>Nem<select name="gender" required><option value="">Válasszon…</option><option value="female">Nő</option><option value="male">Férfi</option><option value="other">Egyéb</option><option value="undisclosed">Nem kívánok válaszolni</option></select></label></div><label>Hány évet töltött oktatásban (általános iskolától ezidáig)?<input name="schooling" type="number" min="0" max="50" required></label><label>Magyar anyanyelvű?<select name="hungarian" required><option value="">Válasszon…</option><option value="native">Igen – az első nyelvem</option><option value="second">Nem – második nyelvem</option><option value="no">Nem</option></select></label><label>Rendelkezik-e SNI diagnózissal?<select name="sni" required><option value="">Válasszon…</option><option value="yes">Igen</option><option value="no">Nem</option></select></label><p><a href="${escape(study.consentUrl)}" target="_blank" rel="noopener noreferrer">Kutatási tájékoztató, adatkezelés és beleegyező nyilatkozat</a></p><label class="check"><input name="consent" type="checkbox" required>Elolvastam a tájékoztatót, betöltöttem a 18. életévemet, és önként hozzájárulok a részvételhez.</label><button type="submit">Gyakorlás indítása</button><p class="error" role="alert"></p></form></section>`;
  document.querySelector('form').onsubmit = e => { e.preventDefault(); action(async () => {
    const d = Object.fromEntries(new FormData(e.target));
    if (!stored) {
      stored = { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join(''), sessionId: crypto.randomUUID(), queue: [], draft: '' };
      persist(); // Credential exists before the first network request, including lost acknowledgments.
    }
    stored.enrollment = { studyId, joinCode, sessionId: stored.sessionId, token: stored.token,
      neptun: d.neptun.toUpperCase(), demographics: { gender: d.gender, age: +d.age, schooling: +d.schooling, hungarian: d.hungarian, sni: d.sni }, consent: true, consentVersion: study.consentVersion };
    persist();
    state = await api('/sessions', stored.enrollment, false);
    stored.gender = d.gender; delete stored.enrollment; persist(); practicing = true; renderTrial();
  }); };
}
async function flush() {
  while (stored.queue.length) {
    network.textContent = 'Válasz mentése…';
    const pending = stored.queue[0];
    await api('/features', pending);
    if (state?.current?.id === pending.assignmentId && !state.current.features.some(f => f.id === pending.id)) state.current.features.push({id:pending.id,text:pending.text});
    stored.queue.shift(); persist();
  }
  network.textContent = 'Minden beküldött válasz mentve.';
}
function renderTrial() {
  if (state.done) {
    app.innerHTML = `<section class="panel completion"><img class="mimo" src="./assets/mimo-frontal.png" alt="M.I.M.O."><h1>Köszönjük a részvételt!</h1><p>Mind a 10 fogalom magyarázatát sikeresen elmentettük.</p><p class="muted">Adatfelvétel: ${escape(state.studyName)}<br>Azonosító: ${escape(state.sessionId)}</p></section>`; return;
  }
  const current = state.current;
  const name = practicing ? (stored.gender === 'female' ? 'katica' : 'motor') : current.name;
  const responses = practicing ? practiceFeatures : [...current.features, ...stored.queue.filter(x => x.assignmentId === current.id && !current.features.some(f => f.id === x.id))];
  app.innerHTML = `<section class="trial"><div class="progress" role="progressbar" aria-label="Elkészült fogalmak" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${state.completed}"><div style="width:${state.completed*10}%"></div></div><span class="progress-label">${practicing ? 'Gyakorlás' : `${state.completed} / 10`}</span><div class="prompt">Magyarázd el nekem, mi az, hogy…</div><h1 class="concept">${escape(name)}</h1><button class="help-button" aria-label="M.I.M.O. segítő kérdései"><img src="./assets/mimo-icon.png" alt=""></button><textarea class="entry" maxlength="2000" aria-label="Egy jellemző vagy magyarázat" placeholder="Írjon ide egy jellemzőt…"></textarea><button class="submit">Válasz beküldése</button><div class="responses" role="log" aria-label="Eddigi válaszok">${responses.map(f => `<p>${escape(f.text)}</p>`).join('')}</div><button class="next">${practicing ? 'Gyakorlás befejezése' : 'Fogalom befejezése'}</button><p class="error" role="alert"></p><span class="trial-note">${practicing ? 'A gyakorlóválaszokat nem használjuk az adatfelvételben.' : escape(state.studyName)}</span></section>`;
  const entry = document.querySelector('.entry');
  entry.value = practicing ? '' : stored.draft || '';
  entry.oninput = () => { if (!practicing) { stored.draft = entry.value; persist(); } };
  document.querySelector('.help-button').onclick = () => help.showModal();
  document.querySelector('.submit').onclick = () => action(async () => {
    const value = entry.value.trim();
    if (!value) throw new Error('Kérjük adjon meg választ a továbblépéshez.');
    if (practicing) practiceFeatures.push({ text: value });
    else {
      stored.queue.push({ id: crypto.randomUUID(), assignmentId: current.id, text: value });
      stored.draft = ''; persist(); entry.value = '';
      renderTrial(); await flush(); state = await api('/state');
    }
    renderTrial(); document.querySelector('.entry').focus();
  });
  document.querySelector('.next').onclick = () => {
    if (entry.value.trim()) { message(new Error('A beírt szöveget előbb küldje be a „Válasz beküldése” gombbal.')); return; }
    if (!responses.length) { message(new Error('Kérjük adjon meg legalább egy választ.')); return; }
    confirm.showModal();
  };
  entry.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); document.querySelector('.submit').click(); } };
}
async function start() {
  app.innerHTML = '<section class="panel"><h1>M.I.M.O.</h1><p>Betöltés…</p><p class="error" role="alert"></p><button id="retry">Újrapróbálás</button></section>';
  document.querySelector('#retry').onclick = () => action(start);
  if (!apiBase || (!apiBase.startsWith('https://') && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost')) throw new Error('Az adatfelvételi szerver még nincs beállítva.');
  if (!studyId) throw new Error('Kérjük, a kutatótól kapott adatfelvételi hivatkozással nyissa meg az oldalt.');
  if (stored) {
    if (stored.enrollment) { state = await api('/sessions', stored.enrollment, false); stored.gender = stored.enrollment.demographics.gender; delete stored.enrollment; persist(); }
    else state = await api('/state');
    await flush(); state = await api('/state'); practicing = !stored.practiceDone && !state.done && state.completed === 0; renderTrial(); return;
  }
  study = await api('/join-info', { studyId, joinCode }, false); introduction();
}
window.addEventListener('online', () => { if (stored && state) action(async () => { await flush(); state = await api('/state'); renderTrial(); }); });
window.addEventListener('offline', () => { network.textContent = 'Nincs internetkapcsolat. A nem mentett válaszokat ezen a böngészőn tároljuk.'; });
start().catch(message);
