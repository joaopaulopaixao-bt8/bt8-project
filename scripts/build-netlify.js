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
  SUPABASE_URL: process.env.BT8_SUPABASE_URL || 'https://znifpitysqfbepjymtmg.supabase.co',
  SUPABASE_ANON_KEY: process.env.BT8_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaWZwaXR5c3FmYmVwanltdG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDM0MTMsImV4cCI6MjA5MjYxOTQxM30.zeX_H63t9mKFLb3nNDjw7efPZmzE87BzDqFPa0U_c_c',
  STRIPE_PUBLISHABLE_KEY: process.env.BT8_STRIPE_PUBLISHABLE_KEY || ''
};

fs.writeFileSync(
  path.join(dist, 'js', 'env.js'),
  `window.BT8_ENV = ${JSON.stringify(publicEnv, null, 2)};\n`
);

console.log('Netlify build ready in dist');
