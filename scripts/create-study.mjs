// The double-click launcher and the admin CLI share one implementation.
import { createInterface } from 'node:readline/promises';
const terminal = createInterface({input:process.stdin,output:process.stdout});
try {
  const name = (await terminal.question('Course / recruitment group name: ')).trim();
  if (!name) throw new Error('A name is required; no study was created.');
  process.argv = [process.execPath,'scripts/admin.mjs','create-study','--name',name];
  await import('./admin.mjs');
} finally { terminal.close(); }
