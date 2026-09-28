// Sets the e-mail and password of an existing user. Stop the dev server first (PGlite allows one process).
//   npm run user:login -- --user admin@trading.local --email you@example.com --password '…'
import { parseArgs } from 'node:util';
import { loadEnv } from '../env.ts';
import { setLogin } from '../services/credentials.ts';
import { createDatabase } from './client.ts';

const { values } = parseArgs({ options: { user: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' } } });
if (!values.user || !values.password) {
  console.error("Usage: npm run user:login -- --user <current e-mail> [--email <new e-mail>] --password '<password>'");
  process.exit(1);
}

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await database.migrate();
const result = await setLogin(database.db, { user: values.user, email: values.email, password: values.password });
await database.close();
console.log(`Login set for ${result.email}`);
