import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const varsFile='.dev.vars';
if(!fs.existsSync(varsFile)) fs.writeFileSync(varsFile,`ADMIN_TOKEN=${randomBytes(32).toString('hex')}\n`,{flag:'wx'});
const line=fs.readFileSync(varsFile,'utf8').split(/\r?\n/).find(x=>x.startsWith('ADMIN_TOKEN='));
if(!line || line.slice(12).length<32) throw new Error('Set a strong ADMIN_TOKEN in .dev.vars');
const token=line.slice(12);
const run=(args,input)=>{
  const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',input,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  // Wrangler does not echo stdin secrets.
  if(r.stdout) process.stdout.write(r.stdout);if(r.stderr) process.stderr.write(r.stderr);
  if(r.status!==0) throw new Error(`Wrangler ${args[0]} failed`);
  return r.stdout;
};
const output=run(['deploy']);
run(['secret','put','ADMIN_TOKEN'],token+'\n');
const url=output.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/)?.[0];
if(url) {
  fs.mkdirSync('export',{recursive:true});fs.writeFileSync('export/config.json',JSON.stringify({apiBase:url},null,2)+'\n');
  console.log(`Backend deployed: ${url}. Local export/config.json updated; admin credential stays in ignored .dev.vars.`);
}
