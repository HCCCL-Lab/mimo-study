import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/build/index.js',compatibilityDate:'2026-10-01',
  durableObjects:{EXPERIMENT:{className:'Experiment',useSQLite:true}},bindings:{ADMIN_TOKEN:'runtime-qa-only',SEED_MODE:'completed',ALLOWED_ORIGINS:'http://127.0.0.1:4173',DEBUG_ERRORS:'true'}}));
try {
  async function call(path,body,token='runtime-qa-only') {
    const r=await mf.dispatchFetch(`http://localhost${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;
  }
  const study=await call('/admin/studies',{name:'Runtime QA',consentUrl:'https://example.test/consent',consentVersion:'v1'});
  const token='c'.repeat(64);
  let state=await call('/sessions',{studyId:study.id,joinCode:study.joinCode,sessionId:crypto.randomUUID(),token,neptun:'TEST01',demographics:{gender:'female',age:24,schooling:16,hungarian:'native',sni:'no'},consent:true,consentVersion:'v1'},'');
  for(let i=0;i<10;i++) {
    const feature={id:crypto.randomUUID(),assignmentId:state.current.id,text:'Runtime válasz'};
    await Promise.all([call('/features',feature,token),call('/features',feature,token)]);
    state=await call('/complete',{assignmentId:state.current.id},token);
  }
  assert.equal(state.done,true);
  const exported=await call('/admin/export',{});assert.equal(exported.features.length,10);assert.equal(exported.assignments.length,10);
  const testToken='d'.repeat(64);
  let testState=await call('/sessions',{studyId:study.id,joinCode:study.joinCode,sessionId:crypto.randomUUID(),token:testToken,neptun:'teszt',demographics:{gender:'male',age:24,schooling:16,hungarian:'native',sni:'no'},consent:true,consentVersion:'v1'},'');
  await call('/features',{id:crypto.randomUUID(),assignmentId:testState.current.id,text:'Disposable test'},testToken);
  testState=await call('/complete',{assignmentId:testState.current.id},testToken);
  await call('/features',{id:crypto.randomUUID(),assignmentId:testState.current.id,text:'Unfinished test'},testToken);
  const preview=await call('/admin/delete-test-entries',{scope:'neptun'});
  assert.equal(preview.counts.sessions,1);
  await call('/admin/delete-test-entries',{scope:'neptun',confirm:true,expectedSessionIds:preview.sessionIds,expectedCounts:preview.counts});
  const after=await call('/admin/export',{});assert.equal(after.features.length,10);assert.equal(after.sessions.length,1);assert.deepEqual(after.concepts,exported.concepts);
  const flowToken='5'.repeat(64);
  assert.equal((await call('/participants/enter',{neptun:'FRESH1',token:flowToken},'')).status,'new');
  let flow=await call('/sessions',{sessionId:crypto.randomUUID(),token:flowToken,neptun:'FRESH1',demographics:{gender:'female',age:24,schooling:16,hungarian:'native',sni:'no',course:'kiserleti'},consent:true,consentVersion:'v1',flowVersion:'pavlovia-v2'},'');
  assert.equal(flow.stage,'instruction');assert.equal(flow.current,null);
  for(const stage of ['tutorial-intro','video','practice-intro','practice','start-experiment','experiment'])flow=await call('/stage',{stage},flowToken);
  await call('/features',{id:crypto.randomUUID(),assignmentId:flow.current.id,text:'Saved before new opening'},flowToken);
  const freshOpening=await call('/participants/enter',{neptun:'fresh1',token:'6'.repeat(64)},'');
  assert.equal(freshOpening.status,'resume');assert.equal(freshOpening.state.current.id,flow.current.id);assert.equal(freshOpening.state.current.features.length,1);
  console.log('Cloudflare runtime QA passed: 10 concepts, duplicate saves, export, and exact TESZT cleanup with counter restoration.');
} finally {await mf.dispose();}
