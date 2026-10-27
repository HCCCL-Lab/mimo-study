import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  api: {type:'string'}, name:{type:'string'}, consent:{type:'string'}, version:{type:'string'}, 'consent-version':{type:'string'},
  site:{type:'string'}, output:{type:'string'}, session:{type:'string'}, study:{type:'string'}
}});
const command = positionals[0];
if (!['create-study','stats','export','abandon','close-study'].includes(command) || !values.api) {
  console.log('Usage: npm run admin -- create-study|stats|export|abandon|close-study --api URL [--name NAME --consent HTTPS_URL --consent-version LABEL --site PAGES_URL] [--output FILE] [--session ID] [--study ID]');
  process.exit(1);
}
// Reuse the ignored deployment credential, without exposing it in arguments or output.
const varsPath = fileURLToPath(new URL('../.dev.vars', import.meta.url));
const localVars = fs.existsSync(varsPath) ? parseEnv(fs.readFileSync(varsPath, 'utf8')) : {};
const token = process.env.MRNGO_ADMIN_TOKEN || localVars.ADMIN_TOKEN;
if (!token) throw new Error('Set MRNGO_ADMIN_TOKEN in your terminal, or ADMIN_TOKEN in the project .dev.vars file');
if (values.output) {
  if (fs.existsSync(values.output)) throw new Error(`Output already exists: ${values.output}. Choose a new filename; no study was created.`);
  fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
}
const paths = {'create-study':'studies', stats:'stats', export:'export', abandon:'abandon','close-study':'close-study'};
const response = await fetch(`${values.api.replace(/\/$/,'')}/admin/${paths[command]}`, {
  method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  body:JSON.stringify({name:values.name,consentUrl:values.consent,consentVersion:values['consent-version'] || values.version,sessionId:values.session,studyId:values.study})
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
if (command === 'create-study' && values.site) result.participantLink = `${values.site}#${new URLSearchParams({study:result.id,join:result.joinCode})}`;
if (values.output) {
  fs.writeFileSync(values.output, JSON.stringify(result,null,2)+'\n', { flag:'wx' });
  console.log(`Saved ${path.resolve(values.output)}`);
} else console.log(JSON.stringify(result,null,2));
