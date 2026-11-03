import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { randomBytes,createHash } from 'node:crypto';
import { makeExport,readExclusions,toCsv } from './research-data-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dataRoot=path.join(root,'data'), exportRoot=path.join(root,'export');
const outputRoot=path.join(exportRoot,'output'), settingsRoot=path.join(exportRoot,'settings');
const baseline=fs.readFileSync(path.join(dataRoot,'tally-baseline.csv'),'utf8');
const concepts=JSON.parse(fs.readFileSync(path.join(dataRoot,'concepts.json'),'utf8'));
const exclusionsFile=path.join(settingsRoot,'exclusions.csv');
const defaultRuntime=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node');
const configPath=path.join(settingsRoot,'runtime.json');
const runtime=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{node:path.join(defaultRuntime,'bin','node.exe'),modules:path.join(defaultRuntime,'node_modules')};

function stamp(){const date=new Date();const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,folder:`${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}-${randomBytes(2).toString('hex')}`};}
function directory(kind){const time=stamp(),dir=path.join(outputRoot,time.folder+'_'+kind);fs.mkdirSync(dir,{recursive:true});return {...time,dir};}
function writeJson(file,data){fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});}
function credentials(){
  const varsFile=path.join(root,'.dev.vars'), vars=fs.existsSync(varsFile)?parseEnv(fs.readFileSync(varsFile,'utf8')):{};
  const token=process.env.MRNGO_ADMIN_TOKEN||vars.ADMIN_TOKEN;
  if(!token)throw new Error('Admin credential missing. Restore the project .dev.vars file.');
  const api=JSON.parse(fs.readFileSync(path.join(settingsRoot,'config.json'),'utf8')).apiBase;
  if(new URL(api).protocol!=='https:')throw new Error('The production backend must use HTTPS');
  return {api,token};
}
async function request(route,body={}){
  const {api,token}=credentials();let response;
  try{response=await fetch(api+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});}
  catch{throw new Error('Cannot reach Cloudflare. Check the internet connection and try again.');}
  const result=await response.json();if(!response.ok)throw new Error(`Cloudflare HTTP ${response.status}: ${result.error||'request failed'}`);return result;
}
function rules(){fs.mkdirSync(settingsRoot,{recursive:true});if(!fs.existsSync(exclusionsFile))fs.writeFileSync(exclusionsFile,'neptun,concept_id\r\n',{flag:'wx'});return readExclusions(fs.readFileSync(exclusionsFile,'utf8'),concepts);}
function prepareRenderer(){
  if(!fs.existsSync(runtime.node)||!fs.existsSync(runtime.modules))throw new Error('Spreadsheet runtime missing. See export/settings/runtime.json and HOWTO.md.');
  const folder=path.join(exportRoot,'.runtime');fs.mkdirSync(folder,{recursive:true});
  if(!fs.existsSync(path.join(folder,'node_modules')))fs.symlinkSync(runtime.modules,path.join(folder,'node_modules'),'junction');
  return folder;
}
function emit(snapshot,selection,kind,sourceFolder=null){
  const renderer=prepareRenderer(),model=makeExport(snapshot,baseline,selection),out=directory(kind);
  const snapshotText=JSON.stringify(snapshot,null,2)+'\n';
  fs.writeFileSync(path.join(out.dir,'source.json'),snapshotText,{flag:'wx'});
  const modelFile=path.join(renderer,'model-'+randomBytes(8).toString('hex')+'.json');writeJson(modelFile,model);
  const child=spawnSync(runtime.node,[path.join(root,'scripts','export-workbooks.mjs'),modelFile,out.dir,renderer],{cwd:root,stdio:'inherit',windowsHide:true});
  fs.unlinkSync(modelFile);
  if(child.status!==0)throw new Error(`Excel generation failed. The source snapshot is saved in ${out.dir}.`);
  for(const filename of ['responses.xlsx.inspect.ndjson','demographics.xlsx.inspect.ndjson']) {
    const generated=path.join(out.dir,filename);if(fs.existsSync(generated))fs.unlinkSync(generated);
  }
  const tallyName=`${out.date}_completed_items.csv`;
  fs.writeFileSync(path.join(out.dir,tallyName),toCsv(model.tally),{flag:'wx'});
  fs.copyFileSync(exclusionsFile,path.join(out.dir,'exclusions.csv'),fs.constants.COPYFILE_EXCL);
  writeJson(path.join(out.dir,'manifest.json'),{createdAt:new Date().toISOString(),timezone:'Europe/Budapest',sourceExportedAt:snapshot.exportedAt,sourceFolder,sourceSha256:createHash('sha256').update(snapshotText).digest('hex'),baseline:snapshot.seedMode,baselineFile:'data/tally-baseline.csv',tallyDefinition:'Baseline plus one per participant-session and concept with at least one saved text entry; unfinished concepts included.',...model.report,files:['responses.xlsx','demographics.xlsx',tallyName],complete:true});
  if(model.report.unbinnedResponses.length)console.warn(`WARNING: ${model.report.unbinnedResponses.length} responses have other/undisclosed gender. They remain in Excel; the original male/female-only CSV cannot represent them. See manifest.json.`);
  console.log(`Saved new export folder:\n${out.dir}`);
  return out;
}
async function main(){
  const command=process.argv[2];
  if(command==='export'){
    const renderer=prepareRenderer();void renderer;const selection=rules();
    console.log('Downloading current database and applying export/settings/exclusions.csv...');emit(await request('/admin/export'),selection,'export');
  }else if(command==='exclude'){
    const selection=rules();
    fs.mkdirSync(outputRoot,{recursive:true});
    const folders=fs.readdirSync(outputRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(outputRoot,x.name)).filter(p=>fs.existsSync(path.join(p,'manifest.json'))&&JSON.parse(fs.readFileSync(path.join(p,'manifest.json'),'utf8')).complete).sort().reverse();
    if(!folders.length)throw new Error('No completed export found. Run 02-download-data.bat first.');
    const source=folders[0],snapshotFile=path.join(source,'source.json');
    console.log('Applying the exclusions CSV to the latest downloaded snapshot...');emit(JSON.parse(fs.readFileSync(snapshotFile,'utf8')),selection,'filtered',source);
  }else if(command==='delete-teszt'){
    // Preview and delete atomically; no automatic backup files are generated.
    const preview=await request('/admin/delete-test-entries',{scope:'neptun'});
    if(!preview.counts.sessions){console.log('No exact TESZT Neptun-code entries found. Nothing deleted.');return;}
    const result=await request('/admin/delete-test-entries',{scope:'neptun',confirm:true,expectedSessionIds:preview.sessionIds,expectedCounts:preview.counts});
    console.log(`Deleted ${result.counts.sessions} TESZT sessions and ${result.counts.features} text entries. Completed-concept counters adjusted.\nRun 02-download-data.bat for fresh spreadsheets.`);
  }else throw new Error('Use export, exclude, or delete-teszt');
}
main().catch(error=>{console.error('\nERROR: '+error.message);process.exitCode=1;});
