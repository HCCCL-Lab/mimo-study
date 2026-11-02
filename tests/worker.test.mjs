import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import entry, { Experiment } from '../worker/index.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const ctx = {storage:{sql:{exec(query,...args) {
    if (!args.length && query.includes(';')) {db.exec(query); return {toArray:()=>[]};}
    const stmt=db.prepare(query);
    const rows=/^\s*SELECT/i.test(query) ? stmt.all(...args) : (stmt.run(...args),[]);
    return {toArray:()=>rows};
  }},transactionSync(fn) { db.exec('BEGIN'); try {const r=fn(); db.exec('COMMIT');return r;} catch(e){db.exec('ROLLBACK');throw e;} }}};
  const worker = new Experiment(ctx,{ADMIN_TOKEN:'test-admin',SEED_MODE:'completed'});
  const call=async(path,body={},token='test-admin')=>{
    const r=await worker.fetch(new Request(`https://api.test${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)}));
    return {status:r.status,body:await r.json()};
  };
  return {worker,call,db,ctx};
}
async function enroll(call, gender='female',neptun='ABC123', study=null) {
  study ||= (await call('/admin/studies',{name:'Lab Monday',consentUrl:'https://example.test/consent',consentVersion:'v1'})).body;
  const token='a'.repeat(64), sessionId=crypto.randomUUID();
  const enrollment={studyId:study.id,joinCode:study.joinCode,sessionId,token,neptun,demographics:{gender,age:24,schooling:16,hungarian:'native',sni:'no'},consent:true,consentVersion:'v1'};
  const result=await call('/sessions',enrollment,'');
  assert.equal(result.status,201);
  return {state:result.body,token,enrollment,study};
}
test('server persists all ten concepts, idempotent features and completions, protects participant data',async()=>{
  const {call,worker,ctx,db}=fixture(); const {token,enrollment,study}=await enroll(call);
  assert.equal((await call('/sessions',enrollment,'')).status,200);
  assert.equal((await call('/state',{},'wrong')).status,401);
  assert.equal((await call('/admin/export',{},token)).status,401);
  assert.equal((await call('/sessions',{...enrollment,sessionId:crypto.randomUUID()},'')).status,409);
  let s=(await call('/state',{},token)).body;
  assert.equal((await call('/complete',{assignmentId:s.current.id},token)).status,400);
  for(let i=0;i<10;i++) {
    const feature={id:crypto.randomUUID(),assignmentId:s.current.id,text:'Ékezetes válasz – különleges & <szöveg>'};
    assert.equal((await call('/features',feature,token)).status,200);
    assert.equal((await call('/features',feature,token)).status,200);
    assert.equal((await call('/features',{...feature,text:'changed'},token)).status,409);
    const old=s.current.id;
    s=(await call('/complete',{assignmentId:old},token)).body;
    assert.equal(s.completed,i+1);
    assert.deepEqual((await call('/complete',{assignmentId:old},token)).body,s);
  }
  assert.equal(s.done,true); assert.equal(s.current,null);
  const exported=(await call('/admin/export')).body;
  assert.equal(exported.features.length,10); assert.equal(exported.assignments.length,10);
  assert.equal(new Set(exported.assignments.map(x=>x.category)).size,10);
  assert.ok(exported.sessions[0].completed_at); assert.equal(exported.seedMode,'completed');
  assert.equal(exported.sessions[0].neptun,'ABC123');
  assert.ok(!JSON.stringify(exported).includes('token_hash'));
  // Reconstruct the object against durable storage: seed must not reset counts.
  const before=worker.rows('SELECT * FROM concepts'); new Experiment(ctx,{ADMIN_TOKEN:'test-admin',SEED_MODE:'zero'});
  assert.deepEqual(worker.rows('SELECT * FROM concepts'),before);
  await call('/admin/close-study',{studyId:study.id});
  assert.equal((await call('/join-info',{studyId:study.id,joinCode:study.joinCode},'')).status,403);
  db.close();
});
test('concurrent arrivals reserve different least-answered concepts and abandoned sessions release reservations',async()=>{
  const {call,worker,db}=fixture();
  const a=await enroll(call);
  const token='b'.repeat(64);
  const b=await call('/sessions',{...a.enrollment,sessionId:crypto.randomUUID(),token,neptun:'XYZ789'},'');
  assert.equal(b.status,201); assert.notEqual(b.body.current.id,a.state.current.id);
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM assignments WHERE completed_at IS NULL').n,2);
  await call('/admin/abandon',{sessionId:a.state.sessionId});
  assert.equal((await call('/state',{},a.token)).status,401);
  assert.equal((await call('/state',{},token)).status,200);
  db.close();
});
test('enrollment validates age, Neptun, consent, and credentials',async()=>{
  const {call,db}=fixture();const {enrollment}=await enroll(call);
  for(const change of [{consent:false},{consentVersion:'stale'},{neptun:'x'},{token:'bad'}, {demographics:{...enrollment.demographics,age:17}}]) {
    assert.equal((await call('/sessions',{...enrollment,...change},'')).status,400);
  }
  assert.equal((await call('/admin/studies',{name:'Bad URL',consentVersion:'v1',consentUrl:'javascript:alert(1)'})).status,400);
  db.close();
});
test('CORS rejects unauthorized origin before forwarding; preflight does not write',async()=>{
  const env={ALLOWED_ORIGINS:'https://hcccl-lab.github.io'};
  assert.equal((await entry.fetch(new Request('https://api.test/state',{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);
  const r=await entry.fetch(new Request('https://api.test/state',{method:'OPTIONS',headers:{Origin:'https://hcccl-lab.github.io'}}),env);
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://hcccl-lab.github.io');
});

test('TESZT cleanup requires admin and matching backup, restores counters, and preserves real participants',async()=>{
  const {call,worker,db}=fixture();
  const before=worker.rows('SELECT * FROM concepts');
  const testSession=await enroll(call,'female','teszt');
  const first=testSession.state.current;
  await call('/features',{id:crypto.randomUUID(),assignmentId:first.id,text:'Test response'},testSession.token);
  const advanced=(await call('/complete',{assignmentId:first.id},testSession.token)).body;
  await call('/features',{id:crypto.randomUUID(),assignmentId:advanced.current.id,text:'Unfinished test response'},testSession.token);
  const real=await call('/sessions',{...testSession.enrollment,sessionId:crypto.randomUUID(),token:'b'.repeat(64),neptun:'TESZT1'},'');
  assert.equal(real.status,201);
  worker.sql.exec("UPDATE studies SET name='teszt' WHERE id=?",testSession.study.id);
  assert.equal((await call('/admin/delete-test-entries',{},testSession.token)).status,401);
  const preview=(await call('/admin/delete-test-entries')).body;
  assert.deepEqual(preview.counts,{sessions:1,assignments:2,features:2,completed:1});
  assert.equal((await call('/admin/delete-test-entries',{confirm:true})).status,409);
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM features').n,2);
  const deleted=await call('/admin/delete-test-entries',{confirm:true,expectedSessionIds:preview.sessionIds,expectedCounts:preview.counts});
  assert.equal(deleted.status,200);assert.equal(deleted.body.deleted,true);
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM features').n,0);
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM sessions').n,1);
  assert.equal((await call('/state',{},testSession.token)).status,401);
  assert.equal((await call('/state',{},'b'.repeat(64))).status,200);
  assert.deepEqual(worker.rows('SELECT * FROM concepts'),before);
  assert.equal((await call('/sessions',{...testSession.enrollment,sessionId:crypto.randomUUID(),token:'c'.repeat(64)},'')).status,201);
  assert.equal((await call('/admin/delete-test-entries',{scope:'study'})).status,400);
  db.close();
});

test('Neptun-first flow resumes by code with a new token, persists onboarding and blocks finished attempts',async()=>{
  const {call,worker,db}=fixture();
  const study=(await call('/admin/studies',{name:'New flow',consentUrl:'https://example.test/consent',consentVersion:'v2'})).body;
  const route={studyId:study.id,joinCode:study.joinCode};
  const info=await call('/entry-info',route,'');assert.equal(info.status,200);assert.equal(info.body.name,'New flow');
  const token='e'.repeat(64),code='FLOW01';
  assert.equal((await call('/participants/enter',{...route,neptun:code,token},'')).body.status,'new');
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM sessions').n,0);
  let result=await call('/sessions',{...route,sessionId:crypto.randomUUID(),token,neptun:code,demographics:{gender:'male',age:23,schooling:15,hungarian:'native',sni:'no',course:'fejlodes1'},consent:true,consentVersion:'v2',flowVersion:'pavlovia-v2'},'');
  assert.equal(result.status,201);assert.equal(result.body.stage,'instruction');assert.equal(result.body.current,null);
  assert.equal(JSON.parse(worker.one('SELECT demographics FROM sessions').demographics).course,'fejlodes1');
  assert.equal((await call('/stage',{stage:'experiment'},token)).status,409);
  for(const stage of ['tutorial-intro','video'])assert.equal((await call('/stage',{stage},token)).status,200);
  const resumedToken='f'.repeat(64);
  const resumed=await call('/participants/enter',{...route,neptun:code.toLowerCase(),token:resumedToken},'');
  assert.equal(resumed.body.status,'resume');assert.equal(resumed.body.state.stage,'video');
  assert.equal((await call('/state',{},token)).status,401);
  for(const stage of ['practice-intro','practice','start-experiment','experiment']){
    result=await call('/stage',{stage},resumedToken);assert.equal(result.status,200);
  }
  let state=result.body;
  const firstId=state.current.id;
  const feature={id:crypto.randomUUID(),assignmentId:firstId,text:'Saved before closing the tab'};
  await call('/features',feature,resumedToken);
  const thirdToken='1'.repeat(64);
  const researchResume=(await call('/participants/enter',{...route,neptun:code,token:thirdToken},'')).body;
  assert.equal(researchResume.state.current.id,firstId);assert.equal(researchResume.state.current.features[0].text,feature.text);
  state=researchResume.state;
  for(let i=0;i<10;i++){
    if(i)await call('/features',{id:crypto.randomUUID(),assignmentId:state.current.id,text:'Another saved concept'},thirdToken);
    state=(await call('/complete',{assignmentId:state.current.id},thirdToken)).body;
  }
  assert.equal(state.done,true);
  const completed=(await call('/participants/enter',{...route,neptun:code,token:'2'.repeat(64)},'')).body;
  assert.deepEqual(completed,{status:'completed',message:'Te már résztvettél ebben a kísérletben. Nagyon köszönjük a segítséget!'});
  db.close();
});

test('public entry uses the active study, and Neptun completion applies across named studies',async()=>{
  const {call,worker,db}=fixture();const person=await enroll(call);
  const other=(await call('/admin/studies',{name:'Public seminar',consentUrl:'https://example.test/doc',consentVersion:'v1'})).body;
  assert.equal((await call('/entry-info',{},'')).body.id,other.id);
  const resumed=(await call('/participants/enter',{neptun:'abc123',token:'3'.repeat(64)},'')).body;
  assert.equal(resumed.status,'resume');assert.equal(resumed.state.sessionId,person.state.sessionId);
  worker.sql.exec('UPDATE sessions SET completed_at=? WHERE id=?',new Date().toISOString(),person.state.sessionId);
  assert.equal((await call('/participants/enter',{neptun:'ABC123',token:'4'.repeat(64)},'')).body.status,'completed');
  assert.equal((await call('/participants/enter',{neptun:'BAD',token:'4'.repeat(64)},'')).status,400);
  db.close();
});

test('test cleanup removes an unfinished onboarding record and its progress without changing baseline counts',async()=>{
  const {call,worker,db}=fixture();const before=worker.rows('SELECT * FROM concepts');
  const study=(await call('/admin/studies',{name:'Onboarding test',consentUrl:'https://example.test/doc',consentVersion:'v1'})).body;
  await call('/sessions',{studyId:study.id,joinCode:study.joinCode,neptun:'teszt',token:'7'.repeat(64),sessionId:crypto.randomUUID(),demographics:{gender:'female',age:24,schooling:16,hungarian:'native',sni:'no'},consent:true,consentVersion:'v1',flowVersion:'pavlovia-v2'},'');
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM session_progress').n,1);
  const preview=(await call('/admin/delete-test-entries')).body;
  assert.deepEqual(preview.counts,{sessions:1,assignments:0,features:0,completed:0});
  await call('/admin/delete-test-entries',{confirm:true,expectedSessionIds:preview.sessionIds,expectedCounts:preview.counts});
  assert.equal(worker.one('SELECT COUNT(*) AS n FROM session_progress').n,0);assert.deepEqual(worker.rows('SELECT * FROM concepts'),before);db.close();
});
