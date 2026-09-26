import { loadEnv } from '../env.ts';
import { createDatabase } from './client.ts';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await database.migrate();
await database.close();
console.log('Migrations applied');
