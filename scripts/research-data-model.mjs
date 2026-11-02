export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else throw new Error('Invalid quote in CSV');
    } else if (!quoted && (ch === delimiter || ch === '\n' || ch === '\r')) {
      row.push(field); field = '';
      if (ch !== delimiter) { if (row.some(x => x.trim())) rows.push(row); row = []; if (ch === '\r' && text[i + 1] === '\n') i++; }
    } else field += ch;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  if (field || row.length) { row.push(field); if (row.some(x => x.trim())) rows.push(row); }
  return rows;
}
export const toCsv = rows => rows.map(row => row.map(value => {
  const s = String(value ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}).join(',')).join('\r\n') + '\r\n';
export function readExclusions(text, concepts) {
  const rows = parseCsv(text), rules = new Map(), known = new Map();
  for (const c of concepts) { known.set(c.id.toLowerCase(), c.id); known.set(c.id.slice(7).toLowerCase(), c.id); }
  if (!rows.length) return rules;
  if (rows[0].length !== 2 || rows[0][0].trim().toLowerCase() !== 'neptun' || rows[0][1].trim().toLowerCase() !== 'concept_id') throw new Error('Exclusions header must be neptun,concept_id');
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== 2) throw new Error(`Exclusions line ${index + 2}: expected exactly two columns`);
    const code = row[0].trim().toUpperCase(), value = row[1].trim().toLowerCase();
    if (!/^(?:[A-Z0-9]{6}|TESZT)$/.test(code)) throw new Error(`Exclusions line ${index + 2}: invalid Neptun code`);
    if (value !== 'full' && !known.has(value)) throw new Error(`Exclusions line ${index + 2}: unknown concept ID`);
    const set = rules.get(code) || new Set(); set.add(value === 'full' ? 'full' : known.get(value)); rules.set(code, set);
  }
  return rules;
}
export const RAW_HEADERS = ['participant_id','study_id','study_name','concept_name','concept_id','itemno','assignment_id','response_id','response_content','response_saved_at_utc','concept_assigned_at_utc','concept_completed_at_utc','participant_started_at_utc','participant_completed_at_utc','concept_number','cap_exceeded','subcategory_relaxed'];
export const DEMO_HEADERS = ['participant_id','study_id','study_name','neptun','gender','age','schooling','hungarian','sni','consent_version','participant_started_at_utc','participant_completed_at_utc','abandoned_at_utc','retained_concepts_with_responses','retained_text_entries','excluded_concepts','course'];

export function makeExport(snapshot, baselineText, rules = new Map(), countMode = 'concepts') {
  if (!['zero','completed'].includes(snapshot.seedMode)) throw new Error('Unknown source baseline; export stopped');
  if (!['concepts', 'features'].includes(countMode)) throw new Error('Invalid count mode');
  const baseline = parseCsv(baselineText);
  if (JSON.stringify(baseline[0]) !== JSON.stringify(['item','itemno','category','férfi','nő'])) throw new Error('Tally template header mismatch');
  const sessions = new Map(snapshot.sessions.map(s => [s.id, s]));
  const concepts = new Map(snapshot.concepts.map(c => [c.id, c]));
  const studies = new Map((snapshot.studies || []).map(s => [s.id, s.name]));
  const assignments = new Map(snapshot.assignments.map(a => [a.id, a]));
  const raw = [], retained = new Map(), excludedFeatures = [], unbinned = [];
  for (const f of snapshot.features) {
    const a = assignments.get(f.assignment_id), s = sessions.get(a?.session_id), c = concepts.get(a?.concept_id);
    if (!a || !s || !c) throw new Error('Source contains an orphan response; export stopped');
    const excluded = rules.get(s.neptun.trim().toUpperCase());
    if (excluded?.has('full') || excluded?.has(c.id)) { excludedFeatures.push(f.id); continue; }
    raw.push([s.id,s.study_id,studies.get(s.study_id)||'',c.name,c.id,c.id.slice(7),a.id,f.id,f.text,f.saved_at,a.assigned_at,a.completed_at,s.created_at,s.completed_at,a.ordinal,a.overflow,a.relaxed]);
    const item = retained.get(a.id) || { assignment: a, session: s, features: 0 }; item.features++; retained.set(a.id, item);
  }
  raw.sort((a,b) => String(a[0]).localeCompare(String(b[0])) || a[14]-b[14] || String(a[9]).localeCompare(String(b[9])) || String(a[7]).localeCompare(String(b[7])));
  const demographics = snapshot.sessions.filter(s => !rules.get(s.neptun.trim().toUpperCase())?.has('full')).map(s => {
    const d = typeof s.demographics === 'string' ? JSON.parse(s.demographics) : s.demographics;
    const answers = [...retained.values()].filter(x => x.session.id === s.id);
    const removed = snapshot.assignments.filter(a => a.session_id === s.id && rules.get(s.neptun.trim().toUpperCase())?.has(a.concept_id)).length;
    return [s.id,s.study_id,studies.get(s.study_id)||'',s.neptun,d.gender,d.age,d.schooling,d.hungarian,d.sni,s.consent_version,s.created_at,s.completed_at,s.abandoned_at,answers.length,answers.reduce((n,a)=>n+a.features,0),removed,d.course||''];
  }).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const tallies = new Map(baseline.slice(1).map(row => [row[1], [row[0],row[1],row[2],snapshot.seedMode === 'completed' ? +row[3] : 0,snapshot.seedMode === 'completed' ? +row[4] : 0]]));
  for (const {assignment:a,session:s,features} of retained.values()) {
    const row = tallies.get(a.concept_id.slice(7)); if (!row) throw new Error('Concept missing from tally template');
    const gender = typeof s.demographics === 'string' ? JSON.parse(s.demographics).gender : s.demographics.gender;
    const amount = countMode === 'features' ? features : 1;
    if (gender === 'male') row[3] += amount;
    else if (gender === 'female') row[4] += amount;
    else unbinned.push({participant_id:s.id,concept_id:a.concept_id,count:amount,gender});
  }
  return {rawHeaders:RAW_HEADERS,raw,demoHeaders:DEMO_HEADERS,demographics,
    tally:[baseline[0],...tallies.values()],report:{countMode,sourceParticipants:snapshot.sessions.length,retainedParticipants:demographics.length,sourceTextEntries:snapshot.features.length,retainedTextEntries:raw.length,retainedConceptResponses:retained.size,excludedTextEntries:excludedFeatures.length,unbinnedResponses:unbinned}};
}
