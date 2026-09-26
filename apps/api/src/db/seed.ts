import { loadEnv } from '../env.ts';
import { createDatabase } from './client.ts';
import { seed } from './seed-data.ts';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await database.migrate();
await seed(database.db, env.DEV_USER_EMAIL);
await database.close();
console.log(`Seeded roles, emotions, instruments and admin user ${env.DEV_USER_EMAIL}`);
