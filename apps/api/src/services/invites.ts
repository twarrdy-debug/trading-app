import { LANGUAGES, type CreateInviteInput } from '@trading/shared';
import { randomInt } from 'node:crypto';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { invites, users } from '../db/schema.ts';
import { HttpError, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

/** No 0/O, 1/I/L: codes are read and typed by people. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export async function createInvite(db: DB, admin: CurrentUser, input: CreateInviteInput) {
  const [row] = await db
    .insert(invites)
    .values({
      code: input.code ?? newCode(),
      createdBy: admin.id,
      email: input.email?.toLowerCase() ?? null,
      role: input.role,
      expiresAt: input.expiresInDays == null ? null : new Date(Date.now() + input.expiresInDays * 86_400_000),
      multiUse: input.multiUse,
    })
    .onConflictDoNothing({ target: invites.code })
    .returning();
  if (!row) throw new HttpError(409, 'inviteCodeTaken', { code: input.code ?? '' });
  return row;
}

export const listInvites = (db: DB) => db.select().from(invites).orderBy(desc(invites.createdAt));

export async function deleteInvite(db: DB, id: string) {
  const [row] = await db.delete(invites).where(eq(invites.id, id)).returning({ id: invites.id });
  if (!row) throw notFound();
}

/**
 * The invite for `code`, when it is usable (unused, or a multi-use code), not expired and (if bound
 * to an address) for `email`.
 */
export async function findUsableInvite(db: DB, code: unknown, email: unknown) {
  if (typeof code !== 'string' || code.trim() === '') return null;
  const [invite] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.code, code.trim().toUpperCase()), or(isNull(invites.usedBy), eq(invites.multiUse, true))));
  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return null;
  if (invite.email && (typeof email !== 'string' || invite.email !== email.trim().toLowerCase())) return null;
  return invite;
}

/**
 * After a successful sign-up: uses up the invite (giving its role) and stores the language and
 * time zone the browser sent, when valid.
 */
export async function finishSignUp(db: DB, userId: string, body: Record<string, unknown>, inviteMode: boolean) {
  // A new sign-up starts with the introduction.
  const patch: Partial<typeof users.$inferInsert> = { onboardedAt: null };
  if (typeof body.language === 'string' && (LANGUAGES as readonly string[]).includes(body.language)) {
    patch.language = body.language as (typeof LANGUAGES)[number];
  }
  if (typeof body.timezone === 'string') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone });
      patch.timezone = body.timezone;
    } catch {
      // Unknown zone: keep the default.
    }
  }
  if (inviteMode) {
    const invite = await findUsableInvite(db, body.inviteCode, body.email);
    if (invite) {
      // A multi-use code only counts its sign-ups; a single-use one is used up.
      await db
        .update(invites)
        .set(invite.multiUse ? { useCount: sql`${invites.useCount} + 1`, usedAt: new Date() } : { usedBy: userId, usedAt: new Date(), useCount: 1 })
        .where(eq(invites.id, invite.id));
      patch.role = invite.role;
    }
  }
  if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, userId));
}
