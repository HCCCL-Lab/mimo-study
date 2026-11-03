import fs from 'node:fs';
import path from 'node:path';
const destination = path.resolve('export/site');
fs.mkdirSync(destination, { recursive: true });
// Do not leave removed source files in an older build.
if (fs.realpathSync(destination) !== destination) throw new Error('Build directory must not be a symlink');
for (const entry of fs.readdirSync(destination)) {
  const target = path.resolve(destination, entry);
  if (!target.startsWith(destination + path.sep)) throw new Error('Invalid build output path');
  fs.rmSync(target, {recursive:true,force:true});
}
fs.cpSync('web', destination, { recursive: true });
const apiBase = process.env.API_BASE_URL;
if (apiBase) {
  const url = new URL(apiBase);
  if (url.protocol !== 'https:') throw new Error('Production API_BASE_URL must use HTTPS');
  fs.writeFileSync(path.join(destination, 'config.js'), `window.MRNGO_CONFIG = ${JSON.stringify({ apiBase: url.origin })};\n`);
}
fs.writeFileSync(path.join(destination, '.nojekyll'), '');
console.log(`Built ${destination}`);
