import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('web');
const types = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.mp4':'video/mp4' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/config.js') { res.setHeader('Content-Type','application/javascript'); res.end("window.MRNGO_CONFIG = { apiBase: 'http://127.0.0.1:8787' };\n"); return; }
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const buffer=await fs.readFile(target);
    if(path.extname(target)==='.mp4'){
      res.setHeader('Accept-Ranges','bytes');
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if(range){const start=+range[1],end=Math.min(range[2]?+range[2]:buffer.length-1,buffer.length-1);if(start>end){res.writeHead(416);res.end();return;}res.setHeader('Content-Range',`bytes ${start}-${end}/${buffer.length}`);res.setHeader('Content-Length',end-start+1);res.writeHead(206);res.end(buffer.subarray(start,end+1));return;}
    }
    res.setHeader('Content-Length',buffer.length);res.end(buffer);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173'));
