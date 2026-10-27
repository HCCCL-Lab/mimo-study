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
  console.log('Cloudflare runtime QA passed: actual SQLite Durable Object, 10 concepts, concurrent duplicate saves, export.');
} finally {await mf.dispose();}
