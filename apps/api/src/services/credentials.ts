import { passwordProblems } from '@trading/shared';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { authAccounts, users } from '../db/schema.ts';

/**
 * Gives an existing user an e-mail + password login (Better Auth "credential" account), e.g. the
 * seeded admin that owns the data created before login existed. Optionally changes the e-mail.
 */
export async function setLogin(db: DB, { user, email, password }: { user: string; email?: string; password: string }) {
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    throw new Error(`The password is too weak (${problems.join(', ')}): use 10+ characters with a lowercase and an uppercase letter and a special character`);
  }
  const [row] = await db.select().from(users).where(eq(users.email, user.toLowerCase()));
  if (!row) throw new Error(`No user with the e-mail ${user}`);
  const login = (email ?? user).toLowerCase();
  await db.update(users).set({ email: login, emailVerified: true }).where(eq(users.id, row.id));

  const hash = await hashPassword(password);
  const match = and(eq(authAccounts.userId, row.id), eq(authAccounts.providerId, 'credential'));
  const [existing] = await db.select({ id: authAccounts.id }).from(authAccounts).where(match);
  if (existing) await db.update(authAccounts).set({ password: hash }).where(eq(authAccounts.id, existing.id));
  else await db.insert(authAccounts).values({ userId: row.id, accountId: row.id, providerId: 'credential', password: hash });
  return { id: row.id, email: login };
}
