import fs from 'node:fs';
import { parseArgs } from 'node:util';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  api: {type:'string'}, name:{type:'string'}, consent:{type:'string'}, version:{type:'string'},
  site:{type:'string'}, output:{type:'string'}, session:{type:'string'}, study:{type:'string'}
}});
const command = positionals[0];
if (!['create-study','stats','export','abandon','close-study'].includes(command) || !values.api) {
  console.log('Usage: npm run admin -- create-study|stats|export|abandon|close-study --api URL [--name NAME --consent HTTPS_URL --version LABEL --site PAGES_URL] [--output FILE] [--session ID] [--study ID]');
  process.exit(1);
}
// Secrets come from the process environment, never command-line arguments.
if (!process.env.MRNGO_ADMIN_TOKEN) throw new Error('Set MRNGO_ADMIN_TOKEN in your local terminal');
const paths = {'create-study':'studies', stats:'stats', export:'export', abandon:'abandon','close-study':'close-study'};
const response = await fetch(`${values.api.replace(/\/$/,'')}/admin/${paths[command]}`, {
  method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MRNGO_ADMIN_TOKEN}`},
  body:JSON.stringify({name:values.name,consentUrl:values.consent,consentVersion:values.version,sessionId:values.session,studyId:values.study})
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
if (command === 'create-study' && values.site) result.participantLink = `${values.site}#${new URLSearchParams({study:result.id,join:result.joinCode})}`;
if (values.output) {
  fs.writeFileSync(values.output, JSON.stringify(result,null,2)+'\n', { flag:'wx' });
  console.log(`Saved ${values.output}`);
} else console.log(JSON.stringify(result,null,2));
