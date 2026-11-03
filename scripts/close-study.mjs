import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'export', 'study-links');
const run = promisify(execFile);
async function admin(...args) {
  const { stdout } = await run(process.execPath, ['scripts/admin.mjs', ...args], { cwd: root, windowsHide: true });
  return JSON.parse(stdout);
}

let terminal;
try {
  const files = await fs.readdir(folder);
  const saved = new Map();
  for (const file of files.filter(name => name.endsWith('.json'))) {
    const link = JSON.parse(await fs.readFile(path.join(folder, file), 'utf8'));
    if (link.id && link.participantLink) saved.set(link.id, file);
  }
  if (!saved.size) throw new Error('No saved study links found in export/study-links/.');

  const { studies } = await admin('list-studies');
  const choices = studies.filter(study => saved.has(study.id));
  if (!choices.length) throw new Error('None of the saved links matches a study on this server.');

  console.log('\nSaved studies (current server status):\n');
  choices.forEach((study, index) => console.log(`${index + 1}. ${study.name} [${study.active ? 'OPEN' : 'CLOSED'}]\n   ${saved.get(study.id)}`));
  console.log('\nClosing stops NEW enrollment. Existing participants can still finish.\n0. Cancel\n');
  terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await terminal.question('Number of the study to close: ')).trim();
  if (!answer || answer === '0') console.log('Cancelled. No study was changed.');
  else {
    const index = Number(answer) - 1;
    if (!/^\d+$/.test(answer) || !Number.isInteger(index) || index < 0 || index >= choices.length) throw new Error('Invalid selection. No study was changed.');
    const selected = choices[index];
    if (!selected.active) console.log(`Already closed: ${selected.name}. No study was changed.`);
    else {
      const result = await admin('close-study', '--study', selected.id);
      if (!result.closed) throw new Error('The server did not confirm closure.');
      console.log(`\nClosed: ${selected.name}\nNew enrollment is disabled. Existing participant records and the saved link are preserved.`);
    }
  }
} catch (error) {
  console.error('\nERROR: ' + error.message);
  process.exitCode = 1;
} finally {
  terminal?.close();
}
