import fs from 'node:fs';
import { createHash } from 'node:crypto';
const local=process.argv.includes('--local');
const config=local?{apiBase:'http://127.0.0.1:8787'}:JSON.parse(fs.readFileSync('export/config.json','utf8'));
const output=local?'export/local-study.json':'export/study-link.json';
if(fs.existsSync(output)) { console.log(`Study already configured in ${output}`); process.exit(0); }
const token=fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).find(l=>l.startsWith('ADMIN_TOKEN=')).slice(12);
const consentVersion='2026-10-27-'+createHash('sha256').update(fs.readFileSync('web/tajekoztato.html')).digest('hex').slice(0,12);
const site=local?'http://127.0.0.1:4173/':'https://hcccl-lab.github.io/mimo-study/';
const result=await fetch(`${config.apiBase}/admin/studies`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({name:local?'Helyi próba':'MRNGO – felnőtt fogalomnormák',consentVersion,consentUrl:'https://hcccl-lab.github.io/mimo-study/tajekoztato.html'})});
const data=await result.json();if(!result.ok) throw new Error(data.error);
data.participantLink=`${site}#${new URLSearchParams({study:data.id,join:data.joinCode})}`;
fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(`Created study; participant link saved in ignored ${output}`);
