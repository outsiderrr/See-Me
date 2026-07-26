import 'dotenv/config';
import { execSync } from 'node:child_process';
import { startLocalPg } from './localPg';

// 1) boot embedded postgres (sets process.env.DATABASE_URL)
const { url } = await startLocalPg();
console.log(`[fathom] local postgres up: ${url}`);

// 2) apply existing migrations
execSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});

// 3) start the API (import AFTER DATABASE_URL is set so Prisma picks it up)
const { startServer } = await import('./server');
startServer();
