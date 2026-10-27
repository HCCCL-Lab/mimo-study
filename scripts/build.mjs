import fs from 'node:fs';
import path from 'node:path';
const destination = path.resolve('dist');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync('web', destination, { recursive: true });
const apiBase = process.env.API_BASE_URL;
if (apiBase) {
  const url = new URL(apiBase);
  if (url.protocol !== 'https:') throw new Error('Production API_BASE_URL must use HTTPS');
  fs.writeFileSync(path.join(destination, 'config.js'), `window.MRNGO_CONFIG = ${JSON.stringify({ apiBase: url.origin })};\n`);
}
fs.writeFileSync(path.join(destination, '.nojekyll'), '');
console.log(`Built ${destination}`);
