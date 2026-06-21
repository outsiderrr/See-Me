import EmbeddedPostgres from 'embedded-postgres';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DIR = path.resolve(process.cwd(), '.pgdata-test');
const PORT = 5441;
const URL = `postgresql://seeme:seeme@127.0.0.1:${PORT}/see_me_test`;

export default async function setup() {
  rmSync(DIR, { recursive: true, force: true }); // fresh cluster every run
  const pg = new EmbeddedPostgres({
    databaseDir: DIR,
    user: 'seeme',
    password: 'seeme',
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('see_me_test');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: URL },
  });
  return async () => {
    await pg.stop();
  };
}
