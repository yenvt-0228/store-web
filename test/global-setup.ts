import { execSync } from 'node:child_process';
import { config } from 'dotenv';

export default function globalSetup() {
  config({ path: '.env.test', override: true });

  console.log('\n[e2e] Áp migration lên DB TEST...');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
