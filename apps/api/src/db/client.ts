import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: DB;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDatabase(url: string): Database {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const client = postgres(url, { max: 10 });
    const db = drizzlePostgres(client, { schema });
    return {
      db,
      migrate: () => migratePostgres(db, { migrationsFolder }),
      close: () => client.end(),
    };
  }

  const dataDir = url === 'memory://' ? undefined : path.resolve(url);
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}
