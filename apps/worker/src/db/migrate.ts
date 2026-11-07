// Applies db/migrations/*.sql in filename order, once each, each in its own transaction.
//   DATABASE_URL=postgres://... npm run db:migrate

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));

export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR, log = console.log): Promise<string[]> {
  await pool.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [f]);
      await client.query('commit');
      applied.push(f);
      log(`[migrate] applied ${f}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`[migrate] ${f} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (!applied.length) log('[migrate] up to date');
  return applied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .then(() => pool.end())
    .catch(async (e) => {
      console.error(e.message);
      await pool.end();
      process.exit(1);
    });
}
