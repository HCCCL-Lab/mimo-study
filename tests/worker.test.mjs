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
