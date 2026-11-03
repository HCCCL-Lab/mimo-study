// Isolated workerd/SQLite simulation. Never contacts the production API.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const participants = 100, entries = Number(process.env.SIMULATION_ENTRIES || 10);
assert.ok(Number.isInteger(entries) && entries >= 1 && entries <= 100);
const directory = path.resolve('.wrangler/simulation');
fs.mkdirSync(directory,{recursive:true});
// Instrument the real SQL cursors, only in this temporary local bundle.
const source = `
import entry, {Experiment as ActualExperiment} from '../../worker/index.mjs';
export default entry;
export class Experiment extends ActualExperiment {
  constructor(ctx,env) {
    super(ctx,env);
    this.metrics={reads:0,writes:0,requests:0};
    const sql=this.sql;
    this.sql={exec:(...args)=>{
      const cursor=sql.exec(...args), rows=cursor.toArray();
      this.metrics.reads+=cursor.rowsRead;this.metrics.writes+=cursor.rowsWritten;
      return {toArray:()=>rows};
    }};
  }
  fetch(request) {
    if(new URL(request.url).pathname==='/simulation-history') {
      // A month of retained records, inserted only in the local simulator.
      this.sql.exec("INSERT INTO studies VALUES ('history','Older recruitment','unused','https://study.test/consent','v1',0)");
      this.sql.exec(\`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<3000)
        INSERT INTO sessions SELECT 'history-'||x,'history','H'||printf('%05d',x),'history-token-'||x,
        '{"gender":"female"}','female','v1','2026-10-01','2026-10-01',NULL FROM n\`);
      this.sql.exec(\`INSERT INTO assignments
        SELECT s.id||'-'||c.id,s.id,c.id,c.category,c.subcategory,c.ordinal,0,0,'2026-10-01','2026-10-01'
        FROM sessions s CROSS JOIN (SELECT *,row_number() OVER (ORDER BY category) AS ordinal FROM concepts GROUP BY category) c\`);
      this.sql.exec("INSERT INTO features SELECT id,id,'Historical simulation text','2026-10-01' FROM assignments");
      this.metrics={reads:0,writes:0,requests:0};
      return Response.json({seededParticipants:3000});
    }
    if(new URL(request.url).pathname==='/simulation-metrics')return Response.json(this.metrics);
    this.metrics.requests++;
    return super.fetch(request);
  }
}`;
const bundle = await build({stdin:{contents:source,resolveDir:path.resolve('.wrangler/simulation'),sourcefile:'simulation.mjs'},bundle:true,format:'esm',platform:'browser',write:false});
const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',
  durableObjects:{EXPERIMENT:{className:'Experiment',useSQLite:true}},bindings:{ADMIN_TOKEN:'simulation-only',SEED_MODE:'completed',ALLOWED_ORIGINS:'https://study.test'}}));
const started = performance.now();
let preflights = 0;
try {
  const history=await mf.dispatchFetch('https://api.test/simulation-history',{method:'POST',body:'{}'});
  assert.ok(history.ok);
  async function call(route,body={},token='simulation-only') {
    // Count the browser's conservative worst case: one preflight per POST.
    const options=await mf.dispatchFetch('https://api.test'+route,{method:'OPTIONS',headers:{Origin:'https://study.test','Access-Control-Request-Method':'POST'}});
    assert.equal(options.status,204);preflights++;
    const response=await mf.dispatchFetch('https://api.test'+route,{method:'POST',headers:{Origin:'https://study.test',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    const data=await response.json();assert.ok(response.ok,route+': '+JSON.stringify(data));return data;
  }
  const studies=await Promise.all(['Course A','Course B'].map(name=>call('/admin/studies',{name,consentUrl:'https://study.test/consent',consentVersion:'v1'})));
  await Promise.all(Array.from({length:participants},async(_,i)=>{
    const study=studies[i%2], route={studyId:study.id,joinCode:study.joinCode};
    const neptun='S'+String(i).padStart(5,'0');let token=crypto.randomUUID().replaceAll('-','').repeat(2);
    await call('/entry-info',route,'');
    assert.equal((await call('/participants/enter',{...route,neptun,token},'')).status,'new');
    let state=await call('/sessions',{...route,neptun,token,sessionId:crypto.randomUUID(),demographics:{gender:i%2?'male':'female',age:24,schooling:16,hungarian:'native',sni:'no',course:'spoofed course'},consent:true,consentVersion:'v1',flowVersion:'pavlovia-v2'},'');
    for(const stage of ['tutorial-intro','video','practice-intro','practice','start-experiment','experiment'])state=await call('/stage',{stage},token);
    for(let concept=0;concept<10;concept++){
      for(let response=0;response<entries;response++){
        const feature={id:crypto.randomUUID(),assignmentId:state.current.id,text:'Local simulation: ten characteristics. '.repeat(20)};
        await call('/features',feature,token);
        if(response===0)await call('/features',feature,token); // Network retry must not duplicate text.
      }
      if(concept===4){
        token=crypto.randomUUID().replaceAll('-','').repeat(2);
        const resumed=await call('/participants/enter',{...route,neptun,token},'');
        assert.equal(resumed.status,'resume');assert.equal(resumed.state.current.features.length,entries);
      }
      state=await call('/complete',{assignmentId:state.current.id},token);
    }
    assert.equal(state.done,true);assert.equal(state.completed,10);
    assert.equal((await call('/participants/enter',{...route,neptun,token},'')).status,'completed');
  }));
  const snapshot=await call('/admin/export');
  const newSessions=snapshot.sessions.filter(s=>!s.id.startsWith('history-'));
  assert.equal(newSessions.length,100);assert.equal(snapshot.assignments.length,31000);assert.equal(snapshot.features.length,30000+1000*entries);
  for(const s of newSessions){
    assert.equal(JSON.parse(s.demographics).course,studies.find(t=>t.id===s.study_id).name);
    assert.equal(new Set(snapshot.assignments.filter(a=>a.session_id===s.id).map(a=>a.category)).size,10);
  }
  const response=await mf.dispatchFetch('https://api.test/simulation-metrics',{method:'POST',body:'{}'});
  const metrics=await response.json();
  const seconds=(performance.now()-started)/1000;
  const assets=fs.readdirSync('web/assets').reduce((n,file)=>n+fs.statSync(path.join('web/assets',file)).size,0);
  const report={participants,retainedOlderParticipants:3000,concepts:1000,textEntries:1000*entries,entriesPerConcept:entries,
    workerRequests:metrics.requests+preflights,durableObjectRequests:metrics.requests,rowsRead:metrics.reads,rowsWritten:metrics.writes,
    localElapsedSeconds:+seconds.toFixed(2),localDurationUpperBoundGBs:+(seconds*.128).toFixed(2),
    githubMonthlyAssetGB:+(assets*100*31/1e9).toFixed(2),
    limits:{workerRequests:100000,durableObjectRequests:100000,rowsRead:5000000,rowsWritten:100000,durationGBs:13000,githubMonthlyGB:100},
    notes:'Isolated database with 3000 older participants retained; 100 concurrent new participants, two studies, retries, resume, and one full export. SQL cursor metrics are measured. Duration is a local estimate, not Cloudflare billing. Account quotas are shared with other apps.'};
  fs.mkdirSync('export',{recursive:true});fs.writeFileSync('export/simulation-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  for(const key of ['workerRequests','durableObjectRequests','rowsRead','rowsWritten'])assert.ok(report[key]<report.limits[key],key+' exceeds daily quota');
  assert.ok(report.githubMonthlyAssetGB<100,'Assets exceed GitHub Pages monthly bandwidth');
} finally {await mf.dispose();}
