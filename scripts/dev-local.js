// Roda o BT8 em http://localhost:8888 apontando para o Supabase LOCAL (Docker).
// Pré-requisito: `npm run db:start`. Nunca usa variáveis do site Netlify (modo --offline),
// então as Functions não tocam o banco de produção.
const { execSync, spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SUPABASE_CLI = 'npx -y supabase@2.120.0';

let status;
try {
  status = JSON.parse(execSync(`${SUPABASE_CLI} status -o json`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
} catch (e) {
  console.error('Supabase local não está rodando. Rode primeiro: npm run db:start');
  process.exit(1);
}

const env = {
  ...process.env,
  BT8_APP_ENV: 'local',
  BT8_SUPABASE_URL: status.API_URL,
  BT8_SUPABASE_ANON_KEY: status.ANON_KEY,
  BT8_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  BT8_GUEST_USAGE_HASH_SECRET: 'bt8-local-guest-usage-secret-somente-para-dev',
  // Stripe fica desligado no local; para testar checkout, exporte chaves sk_test_/price_ de teste antes de rodar.
  BT8_STRIPE_PUBLISHABLE_KEY: process.env.BT8_STRIPE_PUBLISHABLE_KEY || ''
};

execSync('node scripts/build-netlify.js', { cwd: root, env, stdio: 'inherit' });

console.log(`\nSupabase local: ${status.API_URL}  |  Studio: ${status.STUDIO_URL}  |  E-mails: ${status.INBUCKET_URL || status.MAILPIT_URL || 'http://127.0.0.1:54324'}`);
console.log('Login de teste: admin@bt8.test / usuario@bt8.test — senha bt8-local-123\n');

const dev = spawn('netlify dev --offline --dir dist --functions netlify/functions --port 8888', {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true
});
dev.on('exit', code => process.exit(code ?? 0));
