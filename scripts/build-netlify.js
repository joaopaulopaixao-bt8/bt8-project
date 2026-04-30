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

const publicEnv = {
  APP_ENV: process.env.BT8_APP_ENV || process.env.CONTEXT || 'production',
  SUPABASE_URL: process.env.BT8_SUPABASE_URL || 'https://srrbnjgixizsjxobvsma.supabase.co',
  SUPABASE_ANON_KEY: process.env.BT8_SUPABASE_ANON_KEY || 'sb_publishable_U6D-70GQBH2DkCVJSsVhFA_YvPkqWZl',
  STRIPE_PUBLISHABLE_KEY: process.env.BT8_STRIPE_PUBLISHABLE_KEY || ''
};

fs.writeFileSync(
  path.join(dist, 'js', 'env.js'),
  `window.BT8_ENV = ${JSON.stringify(publicEnv, null, 2)};\n`
);

console.log('Netlify build ready in dist');
