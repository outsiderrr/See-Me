import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests run against a dedicated embedded-postgres on port 5441 (separate from dev's 5440).
process.env.DATABASE_URL = 'postgresql://seeme:seeme@127.0.0.1:5441/see_me_test';
process.env.OTP_SECRET = process.env.OTP_SECRET ?? 'test-secret';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
