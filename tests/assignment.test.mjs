import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assign, capFor } from '../worker/assignment.mjs';
import corpus from '../data/concepts.json' with { type:'json' };
const c = (id, total=0, subcategory='s1', male=0, female=0) => ({id,category:id.slice(0,6),name:id,subcategory,total,male,female,reserved:0});
test('caps and metadata cover exactly ten categories and 300 unique concepts', () => {
  assert.equal(corpus.length,300); assert.equal(new Set(corpus.map(c=>c.id)).size,300);
  assert.equal(new Set(corpus.map(c=>c.category)).size,10);
  assert.equal(capFor('cat_02_b01'),31); assert.equal(capFor('cat_10_v01'),31); assert.equal(capFor('cat_01_a01'),21);
  assert.ok(corpus.every(c=>c.baseline_male>=0 && c.baseline_female>=0));
});
test('total response minimization precedes gender tiebreak', () => {
  const a=c('cat_01_a01',4,'s1',4), b=c('cat_01_a02',5,'s2',0), d=c('cat_01_a03',4,'s3',1);
  assert.equal(assign([a,b,d],[],'male',()=>0).id,d.id);
});
test('category sampling is uniform regardless of category size', () => {
  const pool=[c('cat_01_a01'),c('cat_01_a02'),c('cat_02_b01')];
  assert.equal(assign(pool,[],'male',()=>.6).category,'cat_02');
});
test('never repeat categories and avoid used subcategories when possible', () => {
  const history=[{category:'cat_01',concept_id:'cat_01_a01',subcategory:'s1'}];
  const choice=assign([c('cat_01_a02'),c('cat_02_b01',0,'s1'),c('cat_03_c01',4,'s2')],history,'female',()=>0);
  assert.equal(choice.id,'cat_03_c01'); assert.equal(choice.relaxed,false);
});
test('relax subcategories before breaking caps and avoid immediate repeat if possible', () => {
  const history=[{category:'cat_01',subcategory:'s2'},{category:'cat_02',subcategory:'s1'}];
  const choice=assign([c('cat_03_c01',4,'s1'),c('cat_03_c02',4,'s2')],history,'male',()=>0);
  assert.equal(choice.id,'cat_03_c02'); assert.equal(choice.relaxed,true); assert.equal(choice.overflow,false);
});
test('overflow only when every unused-category capped pool is exhausted', () => {
  const a=c('cat_01_a01',21),b=c('cat_02_b01',30);
  assert.equal(assign([a,b],[],'male',()=>0).id,b.id);
  b.total=31;
  assert.equal(assign([a,b],[],'male',()=>0).overflow,true);
});
test('reservations consume capacity and affect gender balancing', () => {
  const a=c('cat_01_a01',20),b=c('cat_01_a02',20); a.reserved=1;
  assert.equal(assign([a,b],[],'female',()=>0).id,b.id);
  a.reserved=0; a.female_reserved=1;
  assert.equal(assign([a,b],[],'female',()=>0).id,b.id);
});
test('exactly ten assignments remain possible even with every count at its cap', () => {
  const history=[], concepts=corpus.map(x=>({...x,total:capFor(x.id),male:10,female:11,reserved:0}));
  for(let i=0;i<10;i++) { const picked=assign(concepts,history,'female'); assert.ok(picked?.overflow); history.push({...picked,concept_id:picked.id}); }
  assert.equal(new Set(history.map(x=>x.category)).size,10); assert.equal(assign(concepts,history,'female'),null);
});
