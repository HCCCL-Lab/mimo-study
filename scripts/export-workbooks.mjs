import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [inputFile, outputDir, runtimeDir] = process.argv.slice(2);
const require = createRequire(path.resolve(runtimeDir, 'package.json'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const model = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const column = n => { let s=''; for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s; return s; };
for (const [filename, name, headers, data] of [
  ['responses.xlsx','Responses',model.rawHeaders,model.raw],
  ['demographics.xlsx','Demographics',model.demoHeaders,model.demographics]
]) {
  const book=Workbook.create(), sheet=book.worksheets.add(name), last=column(headers.length-1), rows=Math.max(2,data.length+1);
  sheet.showGridLines=false;
  const matrix=data.map(row=>row.map((v,i)=>{
    if(headers[i].endsWith('_utc') && v) { const d=new Date(v); if(!Number.isFinite(d.valueOf()))throw new Error('Invalid timestamp'); return d; }
    return typeof v==='string' && v.startsWith('=') ? "'"+v : v??null;
  }));
  sheet.getRange(`A1:${last}1`).values=[headers];
  if(matrix.length) sheet.getRange(`A2:${last}${matrix.length+1}`).values=matrix;
  const used=sheet.getRange(`A1:${last}${rows}`);
  used.format.font={name:'Arial',size:10}; used.format.verticalAlignment='top';
  used.format.columnWidth=24;
  sheet.getRange(`A1:${last}1`).format={fill:'#373456',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:42};
  if(data.length) sheet.tables.add(`A1:${last}${data.length+1}`,true,name+'Table');
  headers.forEach((h,i)=>{
    const range=sheet.getRange(`${column(i)}2:${column(i)}${rows}`);
    if(h.endsWith('_utc')) {range.setNumberFormat('yyyy-mm-dd hh:mm:ss');range.format.columnWidth=25;}
    else if(['age','schooling','concept_number','cap_exceeded','subcategory_relaxed','retained_concepts_with_responses','retained_text_entries','excluded_concepts'].includes(h))range.setNumberFormat('0');
    else {range.setNumberFormat('@');if(h.endsWith('_id'))range.format.columnWidth=40;}
    if(h==='response_content'){range.format.columnWidth=75;range.format.wrapText=true;}
    if(h==='study_name'){range.format.columnWidth=36;range.format.wrapText=true;}
    if(h==='neptun')range.format.columnWidth=18;
  });
  if(data.length)sheet.getRange(`A2:${last}${data.length+1}`).format.autofitRows();
  sheet.freezePanes.freezeRows(1);
  book.recalculate();
  await (await SpreadsheetFile.exportXlsx(book)).save(path.join(outputDir,filename));
}
console.log(`Excel files written: ${model.raw.length} text entries; ${model.demographics.length} participants.`);
