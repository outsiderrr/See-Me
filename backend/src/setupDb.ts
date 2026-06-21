import 'dotenv/config';
import { execSync } from 'node:child_process';
import { startLocalPg } from './localPg';

// One-off: boot local postgres, then create + apply the initial migration.
const { url } = await startLocalPg();
console.log(`[see-me] local postgres up: ${url}`);

const name = process.argv[2] ?? 'init';
execSync(`npx prisma migrate dev --name ${name}`, {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});

process.exit(0);
