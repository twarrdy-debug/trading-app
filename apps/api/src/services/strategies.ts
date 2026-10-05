import { MAX_STRATEGY_RULES, type CreateStrategyInput, type UpdateStrategyInput } from '@trading/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { strategies, strategyRules } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

type StrategyRow = typeof strategies.$inferSelect;
type RuleRow = typeof strategyRules.$inferSelect;

export type StrategyView = StrategyRow & { rules: Pick<RuleRow, 'id' | 'label'>[] };

async function withRules(db: DB, rows: StrategyRow[]): Promise<StrategyView[]> {
  if (rows.length === 0) return [];
  const rules = await db
    .select()
    .from(strategyRules)
    .where(inArray(strategyRules.strategyId, rows.map((r) => r.id)))
    .orderBy(asc(strategyRules.sortOrder), asc(strategyRules.label));
  return rows.map((row) => ({
    ...row,
    rules: rules.filter((r) => r.strategyId === row.id).map(({ id, label }) => ({ id, label })),
  }));
}

async function ownStrategy(db: DB, user: CurrentUser, id: string) {
  const [row] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, user.id)));
  if (!row) throw notFound('strategyNotFound');
  return row;
}

async function ownRule(db: DB, user: CurrentUser, strategyId: string, ruleId: string) {
  await ownStrategy(db, user, strategyId);
  const [rule] = await db
    .select()
    .from(strategyRules)
    .where(and(eq(strategyRules.id, ruleId), eq(strategyRules.strategyId, strategyId)));
  if (!rule) throw notFound('strategyRuleNotFound');
  return rule;
}

export async function getStrategy(db: DB, user: CurrentUser, id: string) {
  const [view] = await withRules(db, [await ownStrategy(db, user, id)]);
  return view!;
}

/** The user's strategies, newest first, each with its rules in order. */
export async function listStrategies(db: DB, user: CurrentUser) {
  const rows = await db.select().from(strategies).where(eq(strategies.userId, user.id)).orderBy(desc(strategies.createdAt));
  return withRules(db, rows);
}

export async function createStrategy(db: DB, user: CurrentUser, input: CreateStrategyInput) {
  const { rules = [], ...fields } = input;
  const [row] = await db
    .insert(strategies)
    .values({ userId: user.id, name: fields.name, description: fields.description ?? null })
    .returning();
  if (rules.length > 0) {
    await db.insert(strategyRules).values(rules.map((label, i) => ({ strategyId: row!.id, label, sortOrder: i })));
  }
  return getStrategy(db, user, row!.id);
}

export async function updateStrategy(db: DB, user: CurrentUser, id: string, patch: UpdateStrategyInput) {
  await ownStrategy(db, user, id);
  await db.update(strategies).set(patch).where(eq(strategies.id, id));
  return getStrategy(db, user, id);
}

export async function deleteStrategy(db: DB, user: CurrentUser, id: string) {
  await ownStrategy(db, user, id);
  await db.delete(strategies).where(eq(strategies.id, id));
}

/** Adds a rule at the end of the list. */
export async function addStrategyRule(db: DB, user: CurrentUser, id: string, label: string) {
  await ownStrategy(db, user, id);
  const existing = await db.select({ sortOrder: strategyRules.sortOrder }).from(strategyRules).where(eq(strategyRules.strategyId, id));
  if (existing.length >= MAX_STRATEGY_RULES) throw badRequest('strategyRulesLimit', { max: MAX_STRATEGY_RULES });
  const next = existing.reduce((max, r) => Math.max(max, r.sortOrder + 1), 0);
  await db.insert(strategyRules).values({ strategyId: id, label, sortOrder: next });
  await touch(db, id);
  return getStrategy(db, user, id);
}

export async function updateStrategyRule(db: DB, user: CurrentUser, id: string, ruleId: string, label: string) {
  await ownRule(db, user, id, ruleId);
  await db.update(strategyRules).set({ label }).where(eq(strategyRules.id, ruleId));
  await touch(db, id);
  return getStrategy(db, user, id);
}

export async function deleteStrategyRule(db: DB, user: CurrentUser, id: string, ruleId: string) {
  await ownRule(db, user, id, ruleId);
  await db.delete(strategyRules).where(eq(strategyRules.id, ruleId));
  await touch(db, id);
  return getStrategy(db, user, id);
}

/** Puts the rules in the given order; `ids` must list every rule of the strategy once. */
export async function reorderStrategyRules(db: DB, user: CurrentUser, id: string, ids: string[]) {
  await ownStrategy(db, user, id);
  const current = await db.select({ id: strategyRules.id }).from(strategyRules).where(eq(strategyRules.strategyId, id));
  const known = new Set(current.map((r) => r.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((ruleId) => !known.has(ruleId))) {
    throw badRequest('strategyRulesOrder');
  }
  await db.transaction(async (tx) => {
    for (const [i, ruleId] of ids.entries()) {
      await tx.update(strategyRules).set({ sortOrder: i }).where(eq(strategyRules.id, ruleId));
    }
  });
  await touch(db, id);
  return getStrategy(db, user, id);
}

/** Rule edits count as an update of the strategy. */
const touch = (db: DB, id: string) => db.update(strategies).set({ updatedAt: new Date() }).where(eq(strategies.id, id));
