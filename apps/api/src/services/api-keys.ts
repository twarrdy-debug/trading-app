import { createOTP } from '@better-auth/utils/otp';
import {
  apiAllowed,
  matchBrokerSymbol,
  MAX_API_KEYS,
  type BotTradeInput,
  type CreateApiKeyInput,
} from '@trading/shared';
import { symmetricDecrypt } from 'better-auth/crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Auth } from '../auth.ts';
import type { DB } from '../db/client.ts';
import { apiKeyEvents, apiKeys, authAccounts, authTwoFactors, instruments, tradingAccounts, trades, users } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { getAccount } from './accounts.ts';
import { createTrade, type TradeContext } from './trades.ts';

/**
 * Keys for a trading bot (owner's design, 2026-10-23): a key only adds closed trades to one trading
 * account, through POST /bot/v1/trades and nothing else. Making one needs 2FA on, the password and
 * a fresh code; it lives at most 90 days; only its HMAC is stored; it stops working when the
 * password or the 2FA changes, 2FA is turned off, the account is blocked or the plan loses it.
 */

const KEY_PREFIX = 'alx_';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const hashApiKey = (secret: string, key: string) => createHmac('sha256', secret).update(key).digest('hex');

/** The password hash and the 2FA secret as they stand now (null: no password or no 2FA). */
async function securityStamp(db: DB, userId: string) {
  const [credential] = await db
    .select({ password: authAccounts.password })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'credential')));
  const [twoFactor] = await db.select({ secret: authTwoFactors.secret }).from(authTwoFactors).where(eq(authTwoFactors.userId, userId));
  if (!credential?.password || !twoFactor?.secret) return null;
  return sha256(`${credential.password}|${twoFactor.secret}`);
}

/** The password and a current authenticator code, checked the way sign-in checks them. */
async function verifyPasswordAndCode(db: DB, auth: Auth, userId: string, password: string, code: string) {
  const ctx = await auth.$context;
  const [credential] = await db
    .select({ password: authAccounts.password })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'credential')));
  if (!credential?.password || !(await ctx.password.verify({ hash: credential.password, password }))) throw badRequest('apiKeyPassword');
  const [twoFactor] = await db.select({ secret: authTwoFactors.secret }).from(authTwoFactors).where(eq(authTwoFactors.userId, userId));
  if (!twoFactor) throw new HttpError(403, 'apiKey2fa');
  const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: twoFactor.secret });
  if (!(await createOTP(secret, { period: 30, digits: 6 }).verify(code))) throw badRequest('apiKeyCode');
}

const status = (k: typeof apiKeys.$inferSelect, now = Date.now()) =>
  k.revokedAt ? ('revoked' as const) : k.expiresAt.getTime() <= now ? ('expired' as const) : ('active' as const);

/** The user's keys (never the key or its hash), newest first, each with its last events. */
export async function listApiKeys(db: DB, user: CurrentUser) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).orderBy(desc(apiKeys.createdAt));
  const accounts = await db.select({ id: tradingAccounts.id, name: tradingAccounts.name }).from(tradingAccounts).where(eq(tradingAccounts.userId, user.id));
  const events = rows.length
    ? await db.select().from(apiKeyEvents).where(inArray(apiKeyEvents.keyId, rows.map((r) => r.id))).orderBy(desc(apiKeyEvents.at)).limit(200)
    : [];
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    accountId: k.accountId,
    accountName: accounts.find((a) => a.id === k.accountId)?.name ?? '',
    ipAllowlist: k.ipAllowlist,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    lastUsedIp: k.lastUsedIp,
    revokedAt: k.revokedAt,
    status: status(k),
    events: events
      .filter((e) => e.keyId === k.id)
      .slice(0, 10)
      .map((e) => ({ at: e.at, ip: e.ip, outcome: e.outcome, message: e.message })),
  }));
}

/** Makes a key; the key itself is in this answer only, never again. */
export async function createApiKey(db: DB, auth: Auth, secret: string, user: CurrentUser, input: CreateApiKeyInput) {
  if (!apiAllowed(user)) throw new HttpError(403, 'apiKeyNotEnabled');
  if (!user.twoFactorEnabled) throw new HttpError(403, 'apiKey2fa');
  const account = await getAccount(db, user, input.accountId);
  if (account.type === 'backtest') throw badRequest('backtestAccountTrade');
  const active = (await db.select().from(apiKeys).where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))).filter((k) => status(k) === 'active');
  if (active.length >= MAX_API_KEYS) throw badRequest('apiKeyLimit', { max: MAX_API_KEYS });
  await verifyPasswordAndCode(db, auth, user.id, input.password, input.code);
  const stamp = await securityStamp(db, user.id);
  if (!stamp) throw new HttpError(403, 'apiKey2fa');

  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      accountId: account.id,
      name: input.name,
      prefix: key.slice(0, 10),
      keyHash: hashApiKey(secret, key),
      securityStamp: stamp,
      ipAllowlist: input.ipAllowlist,
      expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    })
    .returning();
  return { key, id: row!.id, prefix: row!.prefix, expiresAt: row!.expiresAt };
}

export async function revokeApiKey(db: DB, user: CurrentUser, id: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (!row) throw notFound('apiKeyNotFound');
}

/** An IPv4 address inside a CIDR range, or the same address. */
function ipAllowed(ip: string, allowlist: string[]) {
  if (allowlist.length === 0) return true;
  const v4 = (a: string) => a.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
  return allowlist.some((entry) => {
    if (!entry.includes('/')) return entry.toLowerCase() === ip.toLowerCase();
    const [base, bits] = entry.split('/');
    if (isIP(ip) !== 4 || isIP(base!) !== 4) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (v4(ip) & mask) === (v4(base!) & mask);
  });
}

async function logEvent(db: DB, keyId: string, ip: string, outcome: 'created' | 'duplicate' | 'refused', message: string | null, tradeId: string | null = null) {
  await db.insert(apiKeyEvents).values({ keyId, ip, outcome, message, tradeId });
}

/**
 * The key from `Authorization: Bearer alx_…`, with its user and account. Every failure that does
 * not reach a key answers the same 401, so nothing tells a guesser which part was wrong.
 */
export async function authenticateBot(db: DB, secret: string, header: string | undefined, ip: string) {
  const key = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key.startsWith(KEY_PREFIX) || key.length > 100) throw new HttpError(401, 'apiKeyInvalid');
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashApiKey(secret, key)));
  if (!row || status(row) !== 'active') throw new HttpError(401, 'apiKeyInvalid');
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  const refuse = async (reason: string, revoke = false) => {
    if (revoke) await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, row.id));
    await logEvent(db, row.id, ip, 'refused', reason);
    throw new HttpError(401, 'apiKeyInvalid');
  };
  if (!user || user.disabledAt) return refuse('account blocked');
  // A changed password or 2FA, or 2FA turned off, ends the key for good.
  if (!user.twoFactorEnabled || (await securityStamp(db, user.id)) !== row.securityStamp) return refuse('password or 2FA changed', true);
  if (!apiAllowed(user)) return refuse('API access turned off');
  if (!ipAllowed(ip, row.ipAllowlist)) {
    await logEvent(db, row.id, ip, 'refused', 'address not allowed');
    throw new HttpError(403, 'apiKeyIp');
  }
  await db.update(apiKeys).set({ lastUsedAt: new Date(), lastUsedIp: ip }).where(eq(apiKeys.id, row.id));
  return { key: row, user };
}

/** Adds the bot's closed trade to the key's account; the same `externalId` again adds nothing. */
export async function addBotTrade(ctx: TradeContext, auth: { key: typeof apiKeys.$inferSelect; user: CurrentUser }, input: BotTradeInput, ip: string) {
  const { key, user } = auth;
  const externalId = `bot:${key.id}:${input.externalId}`;
  const [existing] = await ctx.db.select({ id: trades.id }).from(trades).where(and(eq(trades.userId, user.id), eq(trades.externalId, externalId)));
  if (existing) {
    await logEvent(ctx.db, key.id, ip, 'duplicate', input.externalId, existing.id);
    return { status: 'duplicate' as const, id: existing.id };
  }
  try {
    const list = await ctx.db.select().from(instruments).where(eq(instruments.active, true));
    const instrument = matchBrokerSymbol(input.symbol, list);
    if (!instrument) throw badRequest('botUnknownSymbol', { symbol: input.symbol });
    const opened = Date.parse(input.openedAt);
    const closed = Date.parse(input.closedAt);
    if (closed < opened) throw badRequest('botTimes');
    if (closed > Date.now() + 5 * 60_000) throw badRequest('botFuture');
    const { trade } = await createTrade(
      ctx,
      user,
      {
        accountId: key.accountId,
        instrumentId: instrument.id,
        direction: input.direction === 'buy' || input.direction === 'long' ? 'long' : 'short',
        openedAt: input.openedAt,
        closedAt: input.closedAt,
        entryPrice: input.entryPrice,
        exitPrice: input.exitPrice,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        positionSize: input.size,
        fees: input.fees ?? null,
        notes: input.notes ?? null,
        source: 'own',
        emotionKeys: [],
      },
      { externalId },
    );
    await logEvent(ctx.db, key.id, ip, 'created', input.externalId, trade.id);
    return { status: 'created' as const, id: trade.id };
  } catch (err) {
    await logEvent(ctx.db, key.id, ip, 'refused', `${input.externalId}: ${(err as Error).message}`.slice(0, 300));
    throw err;
  }
}
