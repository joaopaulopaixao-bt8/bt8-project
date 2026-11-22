const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

fs.rmSync(dist, { recursive: true, force: true });
copyDir(path.join(root, 'src'), dist);
copyDir(path.join(root, 'public'), dist);

// Versão do deploy: vai como ?v= nos js/css e no nome do cache do service worker.
const VERSION = (process.env.COMMIT_REF || '').slice(0, 12) || `dev-${Date.now().toString(36)}`;

const indexPath = path.join(dist, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8')
  .replace(/((?:src|href)="\.\/(?:js|css|vendor)\/[^"?]+\.(?:js|css))"/g, `$1?v=${VERSION}"`);
fs.writeFileSync(indexPath, html);

// Precache do shell: tudo que o index.html referencia (com ?v=) + estáticos do dist.
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [path.relative(dist, full).split(path.sep).join('/')];
  });
}
const precache = new Set(['./']);
for (const [, url] of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) precache.add(url);
for (const file of listFiles(dist)) {
  if (file === 'sw.js' || file.startsWith('email/') || !/\.(?:js|css|png|jpe?g|svg|webp|ico|json|woff2?)$/i.test(file)) continue;
  precache.add(/^(?:js|css|vendor)\//.test(file) && /\.(?:js|css)$/.test(file) ? `./${file}?v=${VERSION}` : `./${file}`);
}
const swPath = path.join(dist, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8')
  .replace("'__BT8_VERSION__'", JSON.stringify(VERSION))
  .replace('[/*__BT8_PRECACHE__*/]', JSON.stringify([...precache], null, 2)));

const publicEnv = {
  VERSION,
  APP_ENV: process.env.BT8_APP_ENV || process.env.CONTEXT || 'production',
  SUPABASE_URL: process.env.BT8_SUPABASE_URL || 'https://api.bt8.com.br',
  SUPABASE_ANON_KEY: process.env.BT8_SUPABASE_ANON_KEY || 'sb_publishable_-wPekaIkdFqP2w-NngaTvR_3zjuTl4r',
  STRIPE_PUBLISHABLE_KEY: process.env.BT8_STRIPE_PUBLISHABLE_KEY || ''
};

fs.writeFileSync(
  path.join(dist, 'js', 'env.js'),
  `window.BT8_ENV = ${JSON.stringify(publicEnv, null, 2)};\n`
);

console.log(`Netlify build ready in dist (versão ${VERSION}, ${precache.size} arquivos no precache)`);
