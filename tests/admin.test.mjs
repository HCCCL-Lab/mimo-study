import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('study creator exports a complete link, uses defaults, and refuses to overwrite before creating a study',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mimo-admin-'));
  const output=path.join(directory,'link.json');const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    requests.push({path:req.url,body:JSON.parse(raw),authorization:req.headers.authorization});
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'study-123',name:'Test course',joinCode:'a'.repeat(64)}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const args=['scripts/admin.mjs','create-study','--api',`http://127.0.0.1:${server.address().port}`,'--name','Test course','--output',output];
  const options={env:{...process.env,MRNGO_ADMIN_TOKEN:'local-test-credential'}};
  try {
    const {stdout}=await promisify(execFile)(process.execPath,args,options);
    const saved=JSON.parse(await fs.readFile(output,'utf8'));
    const link=new URL(saved.participantLink),fragment=new URLSearchParams(link.hash.slice(1));
    assert.equal(link.origin,'https://hcccl-lab.github.io');assert.equal(fragment.get('study'),'study-123');assert.equal(fragment.get('join'),'a'.repeat(64));
    assert.ok(stdout.includes(saved.participantLink));assert.equal(requests.length,1);assert.equal(requests[0].body.consentVersion,'adult-v1');
    assert.equal(requests[0].authorization,'Bearer local-test-credential');
    await assert.rejects(promisify(execFile)(process.execPath,args,options));assert.equal(requests.length,1);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    // Delete only the temporary file and the now-empty directory created here.
    await fs.rm(output,{force:true});await fs.rmdir(directory);
  }
});
