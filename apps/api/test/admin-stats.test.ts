import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.ts';
import { appStats } from '../src/services/admin.ts';

describe('admin statistics', () => {
  const client = new PGlite();
  const params: unknown[] = [];
  const db = drizzle(client, { schema, logger: { logQuery: (_query, p) => void params.push(...p) } });

  beforeAll(() => migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) }), 60_000);
  afterAll(() => client.close());

  // postgres.js, the production driver, refuses a Date inside a raw sql`` template with a 500, while
  // PGlite takes it, so the rest of the tests cannot see that. Dates must go through a column's encoder.
  it('sends no raw Date to the database', async () => {
    params.length = 0;

    const stats = await appStats(db);

    expect(stats.users.total).toBe(0);
    expect(params.length).toBeGreaterThan(0);
    expect(params.filter((p) => p instanceof Date)).toEqual([]);
  });
});
