import fs from 'node:fs';
// Import presentation materials only. Never run the Pavlovia script or its external form action.
const source='_examples/adult_pavlovia';
for(const file of ['background.png','tutorial_video.mp4','mimo-frontal.png'])fs.copyFileSync(`${source}/${file}`,`web/assets/${file}`);
let form=fs.readFileSync(`${source}/form_demo.html`,'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
  .replace(/<meta name="viewport"[^>]*>/i,'<meta name="viewport" content="width=device-width, initial-scale=1">')
  .replace(/\sstyle="[^"]*"/gi,'')
  .replace(/\saction="[^"]*"/gi,'').replace(/\smethod="[^"]*"/gi,'')
  .replace(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*?name="Qneptun"(?:(?!<\/tr>)[\s\S])*?<\/tr>/gi,'')
  .replace(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*?name="Qkurzus"(?:(?!<\/tr>)[\s\S])*?<\/tr>/gi,'')
  .replace('<form name="form1"','<form autocomplete="off" name="form1"')
  .replace('</head>','<title>Demográfia</title><link rel="stylesheet" href="./form-demo.css"></head>')
  .replace(/<html>/i,'<html lang="hu">');
const extra=`<tr><td><label for="age">Életkor</label></td><td><input id="age" name="age" type="number" required min="18" max="110"></td></tr>
<tr><td><label for="gender">Nem</label></td><td><select id="gender" name="gender" required><option value="">Válasszon…</option><option value="female">Nő</option><option value="male">Férfi</option><option value="other">Egyéb</option><option value="undisclosed">Nem kívánok válaszolni</option></select></td></tr>`;
form=form.replace('<tbody><tr><td valign="top" class="textItem">Hány',`<tbody>${extra}<tr><td valign="top" class="textItem">Hány`)
  .replace('</body>','<p id="form-error" role="alert"></p><script type="module" src="./form-demo.js"></script></body>');
fs.writeFileSync('web/form_demo.html',form);
let consent=fs.readFileSync(`${source}/tajekoztato.html`,'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace(/<link\b[^>]*>/gi,'')
  .replace('</head>','<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./consent.css"></head>')
  .replace('</body>','<script type="module" src="./consent.js"></script></body>');
fs.writeFileSync('web/tajekoztato.html',consent);
console.log('Prepared the supplied adult presentation assets, consent, and demographic form.');
