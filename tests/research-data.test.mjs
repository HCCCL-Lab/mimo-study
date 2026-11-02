import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeExport,readExclusions,parseCsv,toCsv } from '../scripts/research-data-model.mjs';
const baseline='item,itemno,category,férfi,nő\r\nagy,b13,bodypart,6,22\r\nalma,f12,food,2,14\r\n';
export function researchFixture(){return {
  exportedAt:'2026-11-02T12:00:00Z',seedMode:'completed',studies:[{id:'study',name:'Sample study'}],
  concepts:[{id:'cat_02_b13',name:'agy'},{id:'cat_04_f12',name:'alma'}],
  sessions:[{id:'p1',study_id:'study',neptun:'001ABC',demographics:JSON.stringify({gender:'female',age:24,schooling:16,hungarian:'native',sni:'no'}),created_at:'2026-11-02T10:00:00Z',consent_version:'v1'},
    {id:'p2',study_id:'study',neptun:'DEF456',demographics:JSON.stringify({gender:'male',age:25,schooling:17,hungarian:'native',sni:'no'}),created_at:'2026-11-02T10:10:00Z',consent_version:'v1'}],
  assignments:[{id:'a1',session_id:'p1',concept_id:'cat_02_b13',name:'agy',ordinal:1,assigned_at:'2026-11-02T10:00:01Z',completed_at:null},
    {id:'a2',session_id:'p1',concept_id:'cat_04_f12',name:'alma',ordinal:2,assigned_at:'2026-11-02T10:01:00Z',completed_at:'2026-11-02T10:02:00Z'},
    {id:'a3',session_id:'p2',concept_id:'cat_02_b13',name:'agy',ordinal:1,assigned_at:'2026-11-02T10:10:01Z',completed_at:null}],
  features:[{id:'r1',assignment_id:'a1',text:'Ékezetes, több\nsoros válasz',saved_at:'2026-11-02T10:00:02Z'},
    {id:'r2',assignment_id:'a1',text:'Második jellemző',saved_at:'2026-11-02T10:00:03Z'},
    {id:'r3',assignment_id:'a2',text:'=literal response',saved_at:'2026-11-02T10:01:01Z'},
    {id:'r4',assignment_id:'a3',text:'A harmadik fogalomleírás',saved_at:'2026-11-02T10:10:02Z'}]
};}
export const tallyBaseline=baseline;
test('tally includes baseline and counts saved unfinished participant-concepts once',()=>{
  const model=makeExport(researchFixture(),baseline);
  assert.equal(model.raw.length,4);assert.equal(model.demographics.length,2);
  assert.deepEqual(model.tally,[['item','itemno','category','férfi','nő'],['agy','b13','bodypart',7,23],['alma','f12','food',2,15]]);
  assert.equal(model.report.retainedConceptResponses,3);
  assert.deepEqual(makeExport(researchFixture(),baseline).tally,model.tally);
  assert.equal(model.demographics[0][3],'001ABC');
});
test('full and concept exclusions update raw, demographics and tally consistently',()=>{
  const source=researchFixture();
  const rules=readExclusions('\ufeffneptun;concept_id\r\n001abc;b13\r\nDEF456;FULL\r\n',source.concepts);
  const model=makeExport(source,baseline,rules);
  assert.equal(model.raw.length,1);assert.equal(model.raw[0][7],'r3');
  assert.equal(model.demographics.length,1);assert.deepEqual(model.demographics[0].slice(13),[1,1,1,'']);
  assert.deepEqual(model.tally[1],['agy','b13','bodypart',6,22]);assert.deepEqual(model.tally[2],['alma','f12','food',2,15]);
  assert.equal(source.features.length,4);
});
test('CSV preserves Unicode, escaped quotes, multiline text and exact template header',()=>{
  const rows=[['neptun','concept_id'],['001ABC','b13'],['quoted, value','A "quote"\nSecond line']];
  assert.deepEqual(parseCsv(toCsv(rows)),rows);
  const csv=toCsv(makeExport(researchFixture(),baseline).tally);
  assert.ok(csv.startsWith('item,itemno,category,férfi,nő\r\n'));
  assert.equal(csv.split('\r\n').length,4);
});
test('malformed exclusions and orphan records stop instead of silently dropping data',()=>{
  const source=researchFixture();
  for(const csv of ['neptun,wrong\n001ABC,full','neptun,concept_id\n001ABC,missing','neptun,concept_id\n001ABC,b13,extra','neptun,concept_id\n"001ABC,b13'])assert.throws(()=>readExclusions(csv,source.concepts));
  source.features[0].assignment_id='missing';assert.throws(()=>makeExport(source,baseline),/orphan/);
});
test('zero seed does not import historic counts; other gender remains explicit in the audit',()=>{
  const source=researchFixture();source.seedMode='zero';source.sessions[0].demographics=JSON.stringify({gender:'other'});
  const model=makeExport(source,baseline);
  assert.deepEqual(model.tally[1],['agy','b13','bodypart',1,0]);assert.equal(model.raw.length,4);assert.equal(model.report.unbinnedResponses.length,2);
});
