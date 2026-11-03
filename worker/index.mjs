import corpus from '../data/concepts.json' with { type: 'json' };
import { assign } from './assignment.mjs';
import { initialize } from './schema.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const validNeptun = value => typeof value === 'string' && /^(?:[A-Z0-9]{6}|TESZT)$/i.test(value);
const ALREADY_COMPLETED = 'Te már résztvettél ebben a kísérletben. Nagyon köszönjük a segítséget!';
const stages = ['instruction','tutorial-intro','video','practice-intro','practice','start-experiment','experiment'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (origin && !allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403);
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      if (request.method !== 'POST') fail('Use POST', 405);
      if (+(request.headers.get('content-length') || 0) > 20000) fail('Request too large', 413);
      // One coordinator for the complete corpus, including every named study.
      const stub = env.EXPERIMENT.get(env.EXPERIMENT.idFromName('adult-v1'));
      const response = await stub.fetch(request);
      const combined = new Headers(response.headers);
      for (const [k, v] of headers) combined.set(k, v);
      return new Response(response.body, { status: response.status, headers: combined });
    } catch (e) {
      if (env.DEBUG_ERRORS === 'true') console.error(e.stack);
      return new Response(JSON.stringify({ error: e.status ? e.message : 'Service unavailable' }), { status: e.status || 503, headers: { ...Object.fromEntries(headers), 'Content-Type': 'application/json' } });
    }
  }
};

export class Experiment {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    ctx.storage.transactionSync(() => initialize(this.sql, corpus, env.SEED_MODE));
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  state(session) {
    const history = this.rows('SELECT * FROM assignments WHERE session_id=? ORDER BY ordinal', session.id);
    const current = history.find(x => !x.completed_at);
    return {
      sessionId: session.id, studyName: this.one('SELECT name FROM studies WHERE id=?', session.study_id).name,
      completed: history.filter(x => x.completed_at).length, done: !!session.completed_at,
      stage: this.one('SELECT stage FROM session_progress WHERE session_id=?', session.id)?.stage || 'experiment',
      gender: session.gender,
      current: current ? {
        id: current.id, name: this.one('SELECT name FROM concepts WHERE id=?', current.concept_id).name,
        ordinal: current.ordinal, features: this.rows('SELECT id,text,saved_at FROM features WHERE assignment_id=? ORDER BY rowid', current.id)
      } : null
    };
  }
  next(session) {
    const history = this.rows('SELECT * FROM assignments WHERE session_id=? ORDER BY ordinal', session.id);
    if (history.some(x => !x.completed_at) || history.length >= 10) return;
    // Read only open reservations; finished responses never enlarge this scan.
    const concepts = this.rows(`SELECT c.*, COALESCE(r.reserved,0) AS reserved,
      COALESCE(r.male_reserved,0) AS male_reserved, COALESCE(r.female_reserved,0) AS female_reserved
      FROM concepts c LEFT JOIN (
        SELECT a.concept_id, COUNT(*) AS reserved,
          SUM(s.gender='male') AS male_reserved, SUM(s.gender='female') AS female_reserved
        FROM assignments a JOIN sessions s ON s.id=a.session_id
        WHERE a.completed_at IS NULL AND s.abandoned_at IS NULL GROUP BY a.concept_id
      ) r ON r.concept_id=c.id`);
    const selected = assign(concepts, history, session.gender);
    if (!selected) fail('No concept available; contact the researcher', 409);
    this.sql.exec('INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?,NULL)', crypto.randomUUID(), session.id,
      selected.id, selected.category, selected.subcategory, history.length + 1, +selected.overflow, +selected.relaxed, now());
  }
  async fetch(request) {
    try {
      const raw = await request.text();
      if (raw.length > 20000) fail('Request too large', 413);
      let body; try { body = JSON.parse(raw); } catch { fail('Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid request');
      const path = new URL(request.url).pathname;
      if (path.startsWith('/admin/')) {
        const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
        if (!this.env.ADMIN_TOKEN || !token || await hash(token) !== await hash(this.env.ADMIN_TOKEN)) fail('Unauthorized', 401);
        return await this.admin(path, body);
      }
      if (path === '/entry-info' || path === '/participants/enter') {
        if (!text(body.studyId,1,80) || !text(body.joinCode,16,128)) fail('Kérjük, a kurzushoz kapott kísérleti hivatkozást nyissa meg.',403);
        const study = this.one('SELECT * FROM studies WHERE id=? AND join_hash=?',body.studyId,await hash(body.joinCode));
        if (!study) fail('Érvénytelen adatfelvételi hivatkozás.',403);
        const publicStudy = {id:study.id,name:study.name,consentUrl:study.consent_url,consentVersion:study.consent_version};
        if (path === '/entry-info') return json(publicStudy);
        if (!validNeptun(body.neptun) || !/^[0-9a-f]{64}$/.test(body.token||'')) fail('Kérjük, ellenőrizze a Neptun-kódot.');
        const tokenHash = await hash(body.token), code = body.neptun.toUpperCase();
        return this.ctx.storage.transactionSync(() => {
          if (this.one('SELECT id FROM sessions WHERE neptun=? AND completed_at IS NOT NULL',code)) return json({status:'completed',message:ALREADY_COMPLETED});
          const existing = this.one('SELECT * FROM sessions WHERE neptun=? AND completed_at IS NULL AND abandoned_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1',code);
          if (existing) {
            if (existing.study_id !== study.id) fail('A megkezdett részvétel folytatásához az eredeti kurzus hivatkozását nyissa meg.',409);
            this.sql.exec('UPDATE sessions SET token_hash=? WHERE id=?',tokenHash,existing.id);
            return json({status:'resume',state:this.state(existing)});
          }
          if (!study.active) fail('Ez az adatfelvétel már lezárult.',403);
          return json({status:'new',study:publicStudy});
        });
      }
      if (path === '/join-info' || path === '/sessions') {
        if (!text(body.studyId, 1, 80) || !text(body.joinCode, 16, 128)) fail('Invalid study link', 403);
        const study = this.one('SELECT * FROM studies WHERE id=? AND join_hash=? AND active=1', body.studyId, await hash(body.joinCode));
        if (!study) fail('The study link is invalid or closed', 403);
        if (path === '/join-info') return json({ name: study.name, consentUrl: study.consent_url, consentVersion: study.consent_version });
        const d = body.demographics;
        if (!d || !['male', 'female', 'other', 'undisclosed'].includes(d.gender) ||
          !Number.isInteger(d.age) || d.age < 18 || d.age > 110 ||
          !Number.isInteger(d.schooling) || d.schooling < 0 || d.schooling > 50 ||
          !['native', 'second', 'no'].includes(d.hungarian) || !['yes', 'no'].includes(d.sni) ||
          !validNeptun(body.neptun) ||
          body.consent !== true || body.consentVersion !== study.consent_version) fail('Please check demographics and consent');
        if (!uuid(body.sessionId) || !/^[0-9a-f]{64}$/.test(body.token || '')) fail('Invalid session credentials');
        const tokenHash = await hash(body.token);
        const normalized = { gender: d.gender, age: d.age, schooling: d.schooling, hungarian: d.hungarian, sni: d.sni, course: study.name };
        return this.ctx.storage.transactionSync(() => {
          const previous = this.one('SELECT * FROM sessions WHERE id=?', body.sessionId);
          if (previous) {
            if (previous.token_hash !== tokenHash || previous.study_id !== study.id || previous.abandoned_at) fail('Session conflict', 409);
            return json(this.state(previous));
          }
          if (this.one('SELECT id FROM sessions WHERE neptun=? AND completed_at IS NOT NULL',body.neptun.toUpperCase())) fail(ALREADY_COMPLETED,409);
          if (this.one('SELECT id FROM sessions WHERE neptun=? AND abandoned_at IS NULL',body.neptun.toUpperCase())) fail('Ezzel a Neptun-kóddal már van megkezdett részvétel. Adja meg újra a kezdőoldalon.',409);
          if (this.one('SELECT id FROM sessions WHERE study_id=? AND neptun=?',study.id,body.neptun.toUpperCase())) fail('A korábbi részvételt a kutató lezárta. Kérje a kutató segítségét.',409);
          this.sql.exec('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,NULL,NULL)', body.sessionId, study.id, body.neptun.toUpperCase(), tokenHash, JSON.stringify(normalized), d.gender, study.consent_version, now());
          const session = this.one('SELECT * FROM sessions WHERE id=?', body.sessionId);
          if (body.flowVersion === 'pavlovia-v2') this.sql.exec('INSERT INTO session_progress VALUES (?,?)',session.id,'instruction');
          else this.next(session);
          return json(this.state(session), 201);
        });
      }
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
      if (!token || token.length !== 64) fail('Unauthorized', 401);
      const session = this.one('SELECT * FROM sessions WHERE token_hash=?', await hash(token));
      if (!session || session.abandoned_at) fail('Unauthorized', 401);
      return this.ctx.storage.transactionSync(() => {
        if (path === '/state') return json(this.state(session));
        if (path === '/stage') {
          if (!stages.includes(body.stage)) fail('Invalid stage');
          const current = this.state(session).stage;
          if (body.stage === current) return json(this.state(session));
          if (session.completed_at || stages[stages.indexOf(current)+1] !== body.stage) fail('Érvénytelen lépés. Nyissa meg újra a kísérletet a folytatáshoz.',409);
          this.sql.exec('INSERT INTO session_progress VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET stage=excluded.stage',session.id,body.stage);
          if (body.stage === 'experiment') this.next(session);
          return json(this.state(session));
        }
        const assignment = this.one('SELECT * FROM assignments WHERE id=? AND session_id=?', body.assignmentId, session.id);
        if (!assignment) fail('Assignment not found', 404);
        if (path === '/features') {
          if (!uuid(body.id) || !text(body.text, 1, 2000)) fail('Invalid response');
          const previous = this.one('SELECT * FROM features WHERE id=?', body.id);
          if (previous) {
            if (previous.assignment_id !== assignment.id || previous.text !== body.text.trim()) fail('Response ID conflict', 409);
            return json({ saved: true, id: body.id });
          }
          if (assignment.completed_at || session.completed_at) fail('Concept already completed', 409);
          if (this.one('SELECT COUNT(*) AS n FROM features WHERE assignment_id=?', assignment.id).n >= 100) fail('Maximum 100 response entries');
          this.sql.exec('INSERT INTO features VALUES (?,?,?,?)', body.id, assignment.id, body.text.trim(), now());
          return json({ saved: true, id: body.id });
        }
        if (path === '/complete') {
          if (assignment.completed_at) return json(this.state(this.one('SELECT * FROM sessions WHERE id=?', session.id)));
          if (!this.one('SELECT id FROM features WHERE assignment_id=?', assignment.id)) fail('Submit at least one response');
          this.sql.exec('UPDATE assignments SET completed_at=? WHERE id=?', now(), assignment.id);
          this.sql.exec('UPDATE concepts SET total=total+1,male=male+?,female=female+? WHERE id=?', +(session.gender === 'male'), +(session.gender === 'female'), assignment.concept_id);
          if (assignment.ordinal === 10) this.sql.exec('UPDATE sessions SET completed_at=? WHERE id=?', now(), session.id);
          else this.next(session);
          return json(this.state(this.one('SELECT * FROM sessions WHERE id=?', session.id)));
        }
        fail('Not found', 404);
      });
    } catch (e) { return json({ error: e.status ? e.message : 'Internal server error' }, e.status || 500); }
  }
  async admin(path, body) {
    if (path === '/admin/list-studies') return json({studies:this.rows('SELECT id,name,active FROM studies ORDER BY rowid')});
    if (path === '/admin/reset-baseline') {
      return this.ctx.storage.transactionSync(() => {
        const counts = {
          sessions: this.one('SELECT COUNT(*) AS n FROM sessions').n,
          assignments: this.one('SELECT COUNT(*) AS n FROM assignments').n,
          features: this.one('SELECT COUNT(*) AS n FROM features').n
        };
        if (body.confirm !== 'RESET TO BASELINE') return json({counts,reset:false});
        if (JSON.stringify(body.expectedCounts) !== JSON.stringify(counts)) fail('Records changed. Preview the reset again.',409);
        this.sql.exec('DELETE FROM features');
        this.sql.exec('DELETE FROM assignments');
        this.sql.exec('DELETE FROM session_progress');
        this.sql.exec('DELETE FROM sessions');
        for (const c of corpus) this.sql.exec('UPDATE concepts SET total=?,male=?,female=? WHERE id=?',c.baseline_male+c.baseline_female,c.baseline_male,c.baseline_female,c.id);
        this.sql.exec("UPDATE metadata SET value='completed' WHERE key='seed_mode'");
        return json({counts,reset:true,concepts:corpus.length,studiesPreserved:true});
      });
    }
    if (path === '/admin/delete-test-entries') {
      const scope = 'neptun';
      if (body.scope && body.scope !== scope) fail('Only Neptun-code test cleanup is supported');
      return this.ctx.storage.transactionSync(() => {
        const condition = "LOWER(TRIM(s.neptun))='teszt'";
        const targets = `SELECT s.id FROM sessions s JOIN studies t ON t.id=s.study_id WHERE ${condition}`;
        const ids = this.rows(targets).map(x => x.id).sort();
        const assignments = this.one(`SELECT COUNT(*) AS n FROM assignments WHERE session_id IN (${targets})`).n;
        const features = this.one(`SELECT COUNT(*) AS n FROM features WHERE assignment_id IN (SELECT id FROM assignments WHERE session_id IN (${targets}))`).n;
        const completed = this.one(`SELECT COUNT(*) AS n FROM assignments WHERE completed_at IS NOT NULL AND session_id IN (${targets})`).n;
        const counts = { sessions: ids.length, assignments, features, completed };
        if (body.confirm !== true) return json({ scope, counts, sessionIds: ids, deleted: false });
        if (JSON.stringify(body.expectedSessionIds) !== JSON.stringify(ids) || JSON.stringify(body.expectedCounts) !== JSON.stringify(counts)) fail('Test records changed since the preview. Run the script again.', 409);
        const changes = this.rows(`SELECT a.concept_id,COUNT(*) AS total,SUM(CASE WHEN s.gender='male' THEN 1 ELSE 0 END) AS male,SUM(CASE WHEN s.gender='female' THEN 1 ELSE 0 END) AS female FROM assignments a JOIN sessions s ON s.id=a.session_id WHERE a.completed_at IS NOT NULL AND s.id IN (${targets}) GROUP BY a.concept_id`);
        for (const c of changes) this.sql.exec('UPDATE concepts SET total=total-?,male=male-?,female=female-? WHERE id=?', c.total, c.male, c.female, c.concept_id);
        this.sql.exec(`DELETE FROM features WHERE assignment_id IN (SELECT id FROM assignments WHERE session_id IN (${targets}))`);
        this.sql.exec(`DELETE FROM assignments WHERE session_id IN (${targets})`);
        this.sql.exec(`DELETE FROM session_progress WHERE session_id IN (${targets})`);
        this.sql.exec(`DELETE FROM sessions WHERE id IN (${targets})`);
        return json({ scope, counts, deleted: true });
      });
    }
    if (path === '/admin/studies') {
      if (!text(body.name, 1, 120) || !text(body.consentVersion, 1, 80)) fail('Name and consent version are required');
      let url; try { url = new URL(body.consentUrl); } catch { fail('Consent URL is required'); }
      if (url.protocol !== 'https:') fail('Consent URL must use HTTPS');
      const joinCode = secret(), id = crypto.randomUUID(), codeHash = await hash(joinCode);
      this.sql.exec('INSERT INTO studies (id,name,join_hash,consent_url,consent_version) VALUES (?,?,?,?,?)', id, body.name.trim(), codeHash, url.href, body.consentVersion);
      return json({ id, name: body.name, joinCode }, 201);
    }
    if (path === '/admin/close-study') {
      this.sql.exec('UPDATE studies SET active=0 WHERE id=?', body.studyId);
      return json({ closed: true });
    }
    if (path === '/admin/abandon') {
      this.sql.exec('UPDATE sessions SET abandoned_at=? WHERE id=? AND completed_at IS NULL', now(), body.sessionId);
      return json({ abandoned: true });
    }
    if (path === '/admin/stats') return json({
      seedMode: this.one("SELECT value FROM metadata WHERE key='seed_mode'").value,
      studies: this.rows('SELECT id,name,active FROM studies'),
      sessions: this.rows('SELECT id,study_id,created_at,completed_at,abandoned_at FROM sessions'),
      concepts: this.rows('SELECT * FROM concepts'),
      overflowAssignments: this.one('SELECT COUNT(*) AS n FROM assignments WHERE overflow=1').n
    });
    if (path === '/admin/export') return json({
      exportedAt: now(), seedMode: this.one("SELECT value FROM metadata WHERE key='seed_mode'").value,
      studies: this.rows('SELECT id,name,active FROM studies'),
      sessions: this.rows("SELECT s.id,s.study_id,s.neptun,s.demographics,s.consent_version,s.created_at,s.completed_at,s.abandoned_at,COALESCE(p.stage,'experiment') AS stage FROM sessions s LEFT JOIN session_progress p ON p.session_id=s.id"),
      assignments: this.rows('SELECT a.*,c.name FROM assignments a JOIN concepts c ON c.id=a.concept_id'),
      features: this.rows('SELECT * FROM features'), concepts: this.rows('SELECT * FROM concepts')
    });
    fail('Not found', 404);
  }
}
