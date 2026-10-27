import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const names=execFileSync('git',['diff','--cached','--name-only','-z']).toString().split('\0').filter(Boolean);
const token=fs.existsSync('.dev.vars')?fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).find(l=>l.startsWith('ADMIN_TOKEN='))?.slice(12):null;
for(const name of names) {
  if(/^(?:_examples|export|exports|node_modules|\.wrangler|private|secrets|credentials)\//.test(name) || /^\.dev.vars(?!\.example$)/.test(name) || /^\.env(?!\.example$)/.test(name)) throw new Error(`Private/local file staged: ${name}`);
  const content=execFileSync('git',['show',`:${name}`]).toString();
  if(token && content.includes(token)) throw new Error(`Actual admin credential staged: ${name}`);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(content)) throw new Error(`Possible credential staged: ${name}`);
}
console.log(`Reviewed ${names.length} staged files: no examples, exports, local state, or detected secrets.`);
