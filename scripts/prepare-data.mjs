import fs from 'node:fs';
// Read only metadata, never copy participant records from the Firebase exports.
const index = JSON.parse(fs.readFileSync('_examples/child_app/mrngo-webapp-lightweight-rtdb-export.json', 'utf8')).conceptIndex;
const lines = fs.readFileSync('_examples/2026-10-19_completed_items.csv', 'utf8').trim().split(/\r?\n/).slice(1);
const counts = new Map(lines.map(line => { const [name, code, category, male, female] = line.split(','); return [code, { name, male: +male, female: +female }]; }));
const concepts = Object.entries(index).map(([id, c]) => {
  const prior = counts.get(id.slice(7));
  if (!prior || prior.name !== c.name) throw new Error(`Unmatched concept ${id}: ${c.name}`);
  return { id, name: c.name, category: id.slice(0, 6), subcategory: c.subcategory, baseline_male: prior.male, baseline_female: prior.female };
});
if (concepts.length !== 300 || new Set(concepts.map(c => c.category)).size !== 10) throw new Error('Invalid corpus');
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/concepts.json', JSON.stringify(concepts, null, 2) + '\n');
fs.mkdirSync('web/assets', { recursive: true });
fs.copyFileSync('_examples/child_app/public/mimo-icon.png', 'web/assets/mimo-icon.png');
fs.copyFileSync('_examples/child_app/public/mimo-frontal.png', 'web/assets/mimo-frontal.png');
console.log(`Prepared ${concepts.length} concepts with adult CSV baseline options and child subcategories.`);
