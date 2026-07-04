import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

// PGDATA_DIR overrides where the cluster lives (e.g. outside an
// iCloud-synced folder — eviction of live database files corrupts it).
const DATA_DIR = process.env.PGDATA_DIR
  ? path.resolve(process.env.PGDATA_DIR.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'))
  : path.resolve(process.cwd(), '.pgdata');
const PORT = 5440;
const USER = 'seeme';
const PASSWORD = 'seeme';
const DB_NAME = 'see_me';

/**
 * Boots a real PostgreSQL via embedded-postgres for local dev/test.
 * No Docker, no system install. Data persists in ./.pgdata across restarts.
 * Returns the DATABASE_URL and also sets it on process.env.
 */
export async function startLocalPg(): Promise<{ url: string; stop: () => Promise<void> }> {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  const alreadyInitialised = existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (!alreadyInitialised) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(DB_NAME);
  } catch {
    // database already exists — fine
  }

  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
  process.env.DATABASE_URL = url;
  return { url, stop: () => pg.stop() };
}
