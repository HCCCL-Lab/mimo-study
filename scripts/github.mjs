import { spawnSync } from 'node:child_process';
// Use the existing Git Credential Manager session; never log credentials.
const auth = spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\nusername=IlyesAlex\n\n',encoding:'utf8',env:{...process.env,GCM_INTERACTIVE:'never',GIT_TERMINAL_PROMPT:'0'}});
if(auth.status!==0) throw new Error('GitHub authentication unavailable; connect the lab GitHub account.');
const credentials=Object.fromEntries(auth.stdout.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const headers={Authorization:`Bearer ${credentials.password}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
const request=async(url,method='GET',body)=>{
  const r=await fetch(`https://api.github.com${url}`,{method,headers,body:body?JSON.stringify(body):undefined});
  const data=await r.json().catch(()=>({})); return {status:r.status,data};
};
const owner='HCCCL-Lab',repo='mimo-study';
const user=await request('/user'), target=await request(`/users/${owner}`), existing=await request(`/repos/${owner}/${repo}`);
console.log(JSON.stringify({authenticatedUser:user.data.login,owner:target.data.login,ownerType:target.data.type,repositoryStatus:existing.status,permissions:existing.data.permissions},null,2));
if(process.argv.includes('--status')) {
  const pages=await request(`/repos/${owner}/${repo}/pages`);
  const runs=await request(`/repos/${owner}/${repo}/actions/runs?per_page=1`);
  console.log(JSON.stringify({pagesStatus:pages.status,pages:pages.data.html_url,buildType:pages.data.build_type,workflow:runs.data.workflow_runs?.map(x=>({id:x.id,status:x.status,conclusion:x.conclusion,url:x.html_url}))},null,2));
}
if(process.argv.includes('--create')) {
  if(existing.status!==404) { if(existing.status!==200) throw new Error('Cannot inspect repository'); console.log(existing.data.html_url); }
  else {
    if(target.data.type!=='Organization' && user.data.login?.toLowerCase()!==owner.toLowerCase()) throw new Error('Authenticated user cannot create repositories for a different personal account');
    const created=await request(target.data.type==='Organization'?`/orgs/${owner}/repos`:'/user/repos','POST',{name:repo,description:'M.I.M.O. adult concept norming: GitHub Pages and Cloudflare Workers',private:false,auto_init:false});
    if(created.status!==201) throw new Error(`Repository creation failed: ${created.status} ${created.data.message}`);
    console.log(created.data.html_url);
  }
}
if(process.argv.includes('--configure-pages')) {
  const variable=process.env.API_BASE_URL;if(!variable) throw new Error('API_BASE_URL required');
  let r=await request(`/repos/${owner}/${repo}/actions/variables`,'POST',{name:'API_BASE_URL',value:variable});
  if(r.status===409) r=await request(`/repos/${owner}/${repo}/actions/variables/API_BASE_URL`,'PATCH',{name:'API_BASE_URL',value:variable});
  if(![201,204].includes(r.status)) throw new Error(`Repository variable failed: ${r.status}`);
  r=await request(`/repos/${owner}/${repo}/pages`,'POST',{build_type:'workflow'});
  if(r.status===409) r=await request(`/repos/${owner}/${repo}/pages`,'PUT',{build_type:'workflow'});
  if(![201,204].includes(r.status)) throw new Error(`Pages configuration failed: ${r.status} ${r.data.message}`);
  console.log('GitHub Pages and API_BASE_URL configured.');
}
