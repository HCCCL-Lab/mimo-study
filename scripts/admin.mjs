import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  api: {type:'string'}, name:{type:'string'}, consent:{type:'string'}, version:{type:'string'}, 'consent-version':{type:'string'},
  site:{type:'string'}, output:{type:'string'}, session:{type:'string'}, study:{type:'string'}, confirm:{type:'string'}
}});
const command = positionals[0];
values.api ||= 'https://mrngo-adult-api.mrngo-adult.workers.dev';
values.site ||= 'https://hcccl-lab.github.io/mimo-study/';
values.consent ||= 'https://hcccl-lab.github.io/mimo-study/tajekoztato.html';
values['consent-version'] ||= values.version || 'adult-v1';
if (!['create-study','stats','export','abandon','close-study','reset-baseline'].includes(command)) {
  console.log('Commands: create-study, stats, export, abandon, close-study, reset-baseline. See HOWTO.md.');
  process.exit(1);
}
if (command === 'create-study') {
  if (!values.name?.trim()) throw new Error('Add --name with the course or recruitment group name.');
  const site = new URL(values.site);
  if (site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost','127.0.0.1'].includes(site.hostname))) throw new Error('The participant site must use HTTPS (except localhost).');
  site.hash = ''; site.search = ''; values.site = site.href;
  values.output ||= `export/study-links/${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}.json`;
}
if (command === 'export') values.output ||= `export/output/${new Date().toISOString().replace(/[:.]/g,'-')}/source.json`;
// Reuse the ignored deployment credential, without exposing it in arguments or output.
const varsPath = fileURLToPath(new URL('../.dev.vars', import.meta.url));
const localVars = fs.existsSync(varsPath) ? parseEnv(fs.readFileSync(varsPath, 'utf8')) : {};
const token = process.env.MRNGO_ADMIN_TOKEN || localVars.ADMIN_TOKEN;
if (!token) throw new Error('Set MRNGO_ADMIN_TOKEN in your terminal, or ADMIN_TOKEN in the project .dev.vars file');
if (values.output) {
  const exportDirectory = path.resolve('export');
  if (!path.resolve(values.output).startsWith(exportDirectory + path.sep)) throw new Error('Save generated files inside export/.');
  if (fs.existsSync(values.output)) throw new Error(`Output already exists: ${values.output}. Choose a new filename; no study was created.`);
  fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
}
const paths = {'create-study':'studies', stats:'stats', export:'export', abandon:'abandon','close-study':'close-study'};
async function request(route,body) {
const response = await fetch(`${values.api.replace(/\/$/,'')}/admin/${route}`, {
  signal:AbortSignal.timeout(60000),
  method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  body:JSON.stringify(body)
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
return result;
}
let result;
if (command === 'reset-baseline') {
  result = await request('reset-baseline',{});
  if (values.confirm === 'RESET TO BASELINE') result = await request('reset-baseline',{confirm:values.confirm,expectedCounts:result.counts});
} else result = await request(paths[command],{name:values.name,consentUrl:values.consent,consentVersion:values['consent-version'],sessionId:values.session,studyId:values.study});
if (command === 'create-study' && values.site) result.participantLink = `${values.site}#${new URLSearchParams({study:result.id,join:result.joinCode})}`;
if (values.output) {
  fs.writeFileSync(values.output, JSON.stringify(result,null,2)+'\n', { flag:'wx' });
  console.log(`Saved ${path.resolve(values.output)}`);
  if (result.participantLink) console.log(`\n${result.name}\n${result.participantLink}\nShare this complete link with participants. Keep the part after #.`);
} else console.log(JSON.stringify(result,null,2));
