import type {
  AccountListItem,
  AccountSummary,
  AdminInstrument,
  AdminStats,
  AdminUser,
  SystemStatus,
  BasisOverview,
  CalendarRefresh,
  EventHistory,
  MarketAnalysis,
  ProCandles,
  BacktestCandles,
  BacktestSession,
  BacktestSessionListItem,
  BacktestTrade,
  CalendarResponse,
  DailySpread,
  Educator,
  Emotion,
  Instrument,
  Mt5Import,
  NewsResponse,
  PublicUser,
  Strategy,
  Trade,
  TradeList,
  TradeMutation,
  TradeStats,
  TradingAccount,
  TradingMonitor,
} from '@trading/api/types';
import type {
  AnalysisResolution,
  ProResolution,
  CreateBacktestSessionInput,
  OpenBacktestTradeInput,
  BrokerTimezone,
  AdminUpdateUserInput,
  CreateAccountInput,
  CreateInstrumentInput,
  UpdateInstrumentInput,
  CreateStrategyInput,
  CreateTradeInput,
  ParsedSignal,
  TradeFilters,
  UpdateAccountInput,
  UpdateSettingsInput,
  UpdateStrategyInput,
  WhatsNewInput,
} from '@trading/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client.ts';

const STATIC = { staleTime: 5 * 60_000 };

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<PublicUser>('/me') });
export const useInstruments = () =>
  useQuery({ queryKey: ['instruments'], queryFn: () => api<Instrument[]>('/instruments'), ...STATIC });
/** Adds or removes a favourite instrument; the cached list updates at once. */
export function useToggleFavoriteInstrument() {
  const client = useQueryClient();
  const setFavorite = (id: string, favorite: boolean) =>
    client.setQueryData<Instrument[]>(['instruments'], (list) => list?.map((i) => (i.id === id ? { ...i, favorite } : i)));
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      api<{ favorite: boolean }>(`/instruments/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' }),
    onMutate: ({ id, favorite }) => setFavorite(id, favorite),
    onError: (_, { id, favorite }) => setFavorite(id, !favorite),
  });
}

export const useEmotions = () =>
  useQuery({ queryKey: ['emotions'], queryFn: () => api<Emotion[]>('/emotions'), ...STATIC });
export const useEducators = () =>
  useQuery({ queryKey: ['educators'], queryFn: () => api<Educator[]>('/educators'), ...STATIC });

/** Finishes (or skips) the first-run introduction; `restart` shows it again. */
export function useOnboarding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'finish' | 'restart') => api<PublicUser>('/me/onboarding', { method: action === 'finish' ? 'POST' : 'DELETE' }),
    onSuccess: (user) => client.setQueryData(['me'], user),
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateSettingsInput) => {
      // The demo saves nothing: a setting (theme, language, layout…) changes only this browser's view.
      const me = client.getQueryData<PublicUser>(['me']);
      if (me?.demo) {
        if (patch.language) {
          try {
            localStorage.setItem('language', patch.language);
          } catch {
            // The language goes back on reload.
          }
        }
        return { ...me, settings: { ...me.settings, ...patch } } as PublicUser;
      }
      return api<PublicUser>('/me', { method: 'PATCH', json: patch });
    },
    // The dashboard layout shows at once; the server's answer then confirms it.
    onMutate: (patch) => {
      if (!patch.dashboardHidden) return;
      client.setQueryData<PublicUser>(['me'], (me) => (me ? { ...me, settings: { ...me.settings, dashboardHidden: patch.dashboardHidden! } } : me));
    },
    onSuccess: (user, patch) => {
      // The answer has no trade counter (only GET /me counts): keep the one known.
      client.setQueryData<PublicUser>(['me'], (old) => ({ ...old, ...user, tradesUsed: old?.tradesUsed }));
      // Emotion labels, stats labels and messages come from the API in the user's language.
      if (patch.language) void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      // Only the layout changed: nothing to recompute.
      if (Object.keys(patch).every((key) => key === 'dashboardHidden')) return;
      // Currency, time zone and limits change how trades and stats are computed.
      void client.invalidateQueries({ queryKey: ['trades'] });
      void client.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export type TradeQuery = Partial<Omit<TradeFilters, 'limit' | 'offset'>> & { limit?: number };

export const useTrades = (filters: TradeQuery) =>
  useQuery({
    queryKey: ['trades', filters],
    queryFn: () => api<TradeList>(`/trades${qs(filters)}`),
    placeholderData: (previous) => previous,
  });

export const useTradeStats = (range: { dateFrom?: string; dateTo?: string; instrumentId?: string; account?: string }, enabled = true) =>
  useQuery({ queryKey: ['stats', range], queryFn: () => api<TradeStats>(`/trades/stats${qs(range)}`), enabled });

function useInvalidateTrades() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['trades'] });
    void client.invalidateQueries({ queryKey: ['stats'] });
    void client.invalidateQueries({ queryKey: ['accounts'] });
    // The Standard plan's trade counter (me.tradesUsed).
    if (client.getQueryData<PublicUser>(['me'])?.plan.tradeLimit != null) void client.invalidateQueries({ queryKey: ['me'] });
  };
}

export function useSaveTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<CreateTradeInput> }) =>
      id
        ? api<TradeMutation>(`/trades/${id}`, { method: 'PATCH', json: input })
        : api<TradeMutation>('/trades', { method: 'POST', json: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/trades/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUploadScreenshot() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: ({ tradeId, file }: { tradeId: string; file: File }) => {
      const body = new FormData();
      body.append('file', file);
      return api<Trade['screenshots'][number]>(`/trades/${tradeId}/screenshots`, { method: 'POST', body });
    },
    onSuccess: invalidate,
  });
}

export function useDeleteScreenshot() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: ({ tradeId, screenshotId }: { tradeId: string; screenshotId: string }) =>
      api<void>(`/trades/${tradeId}/screenshots/${screenshotId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export const useDailySpread = (instrumentId: string | undefined, date: string | undefined) =>
  useQuery({
    queryKey: ['spread', instrumentId, date],
    queryFn: () => api<DailySpread>(`/spreads/${instrumentId}/${date}`),
    enabled: Boolean(instrumentId && date),
  });

/** ECB rate quote → account currency on a day (only for `AUTO_FX_CURRENCIES`); what the API applies when the rate is left empty. */
export const useFxRate = (base: string | undefined, quote: string | undefined, date: string | undefined) =>
  useQuery({
    queryKey: ['fx-rate', base, quote, date],
    queryFn: () => api<{ rate: number; rateDate: string }>(`/fx-rate${qs({ base, quote, date })}`),
    enabled: Boolean(base && quote && date && base !== quote),
    retry: false,
    ...STATIC,
  });

export function useSaveSpread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ instrumentId, date, spread }: { instrumentId: string; date: string; spread: number }) =>
      api<{ spread: number }>(`/spreads/${instrumentId}/${date}`, { method: 'PUT', json: { spread } }),
    onSuccess: (_, { instrumentId, date }) => client.invalidateQueries({ queryKey: ['spread', instrumentId, date] }),
  });
}

export type ParseSignalResponse =
  | {
      ok: true;
      signal: ParsedSignal;
      warnings: string[];
      instrument: { id: string; symbol: string } | null;
    }
  | { ok: false; errors: string[] };

export const useParseSignal = () =>
  useMutation({
    mutationFn: (text: string) => api<ParseSignalResponse>('/signals/parse', { method: 'POST', json: { text } }),
  });

export function useCreateEducator() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => api<Educator>('/educators', { method: 'POST', json: { displayName } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['educators'] }),
  });
}

/** Latest measured CFD/futures differences; the server re-measures every few hours. */
export const useBasis = () =>
  useQuery({ queryKey: ['basis'], queryFn: () => api<BasisOverview>('/basis'), refetchInterval: 5 * 60_000 });

export function useRefreshBasis() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ results: { pairKey: string; status: string; message: string | null }[]; overview: BasisOverview }>('/basis/refresh', {
        method: 'POST',
      }),
    onSuccess: (res) => client.setQueryData(['basis'], res.overview),
  });
}

/** Today's discipline check; under the 'trades' key so every trade change refreshes it. */
export const useTradingMonitor = () =>
  useQuery({ queryKey: ['trades', 'monitor'], queryFn: () => api<TradingMonitor>('/trades/monitor'), refetchInterval: 60_000 });

export interface CalendarParams {
  from: string;
  to: string;
  currencies?: string[];
  impacts?: string[];
  categories?: string[];
  instrumentId?: string;
}

export const useCalendar = (p: CalendarParams) =>
  useQuery({
    queryKey: ['calendar', p],
    queryFn: () =>
      api<CalendarResponse>(
        `/calendar${qs({
          from: p.from,
          to: p.to,
          currencies: p.currencies?.join(','),
          impacts: p.impacts?.join(','),
          categories: p.categories?.join(','),
          instrumentId: p.instrumentId,
        })}`,
      ),
    placeholderData: (previous) => previous,
  });

export function useRefreshCalendar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<CalendarRefresh>('/calendar/refresh', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

/** Earlier releases of one calendar event (the event card's chart). */
export const useEventHistory = (id: string | null) =>
  useQuery({
    queryKey: ['calendar', 'history', id],
    queryFn: () => api<EventHistory>(`/calendar/${id}/history`),
    enabled: id != null,
    staleTime: 10 * 60_000,
  });

/** Automatic analysis of one instrument (candles, swings, equal levels, day levels, sentiment); refreshed every minute. */
export const useMarketAnalysis = (instrumentId: string | null, resolution: AnalysisResolution) =>
  useQuery({
    queryKey: ['analysis', 'market', instrumentId, resolution],
    queryFn: () => api<MarketAnalysis>(`/analysis/market/${instrumentId}${qs({ resolution })}`),
    enabled: instrumentId != null,
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });

/** Calculator PRO: the pair's CFD and futures candles (the futures about 10 minutes late). */
export const useProCandles = (pair: string, resolution: ProResolution) =>
  useQuery({
    queryKey: ['basis', 'pro', pair, resolution],
    queryFn: () => api<ProCandles>(`/basis/pro${qs({ pair, resolution })}`),
    refetchInterval: 60_000,
    placeholderData: (previous) => (previous?.pairKey === pair ? previous : undefined),
  });

export interface NewsParams {
  categories?: string[];
  currencies?: string[];
  instrumentId?: string;
  q?: string;
  noise?: boolean;
  important?: boolean;
}

/**
 * Headlines, newest first, a page at a time. The live stream (lib/news-live.ts) invalidates it when
 * new ones arrive; the interval only matters while the stream is down.
 */
export const useNews = (p: NewsParams) =>
  useInfiniteQuery({
    queryKey: ['news', p],
    queryFn: ({ pageParam }) =>
      api<NewsResponse>(
        `/news${qs({
          before: pageParam,
          categories: p.categories?.join(','),
          currencies: p.currencies?.join(','),
          instrumentId: p.instrumentId,
          q: p.q,
          noise: p.noise ? 'true' : undefined,
          important: p.important ? 'true' : undefined,
        })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });

/** Preview (commit = false) or import of an MT5 history report or a Tradovate Position History. */
export function useMt5Import() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: ({
      file,
      timezone,
      symbolMap,
      commit,
      accountId,
      includeSimilar,
      copyToLinked,
    }: {
      file: File;
      /** Omitted: MT5 server time GMT+2/+3, Tradovate the user's zone. */
      timezone?: BrokerTimezone | (string & {});
      symbolMap: Record<string, string>;
      commit: boolean;
      accountId?: string;
      includeSimilar?: boolean;
      /** The account is linked and the file came from a trade copier: save on every linked account. */
      copyToLinked?: boolean;
    }) => {
      const body = new FormData();
      // Text fields go first: the API reads them before the file.
      if (timezone) body.append('timezone', timezone);
      if (includeSimilar) body.append('includeSimilar', 'true');
      if (copyToLinked) body.append('copyToLinked', 'true');
      if (accountId) body.append('accountId', accountId);
      body.append('symbolMap', JSON.stringify(symbolMap));
      body.append('commit', String(commit));
      body.append('file', file);
      return api<Mt5Import>('/trades/import/mt5', { method: 'POST', body });
    },
    onSuccess: (_result, { commit }) => {
      if (commit) invalidate();
    },
  });
}

// --- Trading accounts ---------------------------------------------------------

// Stable selectors: a new function each render would hand out a new list each render.
const journalOnly = (list: AccountListItem[]) => list.filter((a) => a.type !== 'backtest');
const backtestOnly = (list: AccountListItem[]) => list.filter((a) => a.type === 'backtest');

/** Every account, backtesting ones included (Settings → Accounts). */
export const useAllAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api<AccountListItem[]>('/accounts') });
/** The journal's accounts: backtesting ones never appear in the journal, trades, stats or monitor. */
export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<AccountListItem[]>('/accounts'), select: journalOnly });
/** Backtesting accounts only. */
export const useBacktestAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<AccountListItem[]>('/accounts'), select: backtestOnly });

function useInvalidateAccounts() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['accounts'] });
    void client.invalidateQueries({ queryKey: ['trades'] });
    void client.invalidateQueries({ queryKey: ['stats'] });
  };
}

export function useSaveAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateAccountInput | UpdateAccountInput }) =>
      id
        ? api<TradingAccount>(`/accounts/${id}`, { method: 'PATCH', json: input })
        : api<TradingAccount>('/accounts', { method: 'POST', json: input }),
    onSuccess: invalidate,
  });
}

/** Links an account with others (a trade copier), or unlinks it with an empty list. */
export function useLinkAccounts() {
  const invalidate = useInvalidateAccounts();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountIds }: { id: string; accountIds: string[] }) => api<unknown>(`/accounts/${id}/links`, { method: 'PUT', json: { accountIds } }),
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['trades'] });
    },
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ id, trades, moveTo }: { id: string; trades: 'keep' | 'move' | 'delete'; moveTo?: string }) =>
      api<void>(`/accounts/${id}${qs({ trades, moveTo })}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

// --- Strategies ------------------------------------------------------------------

export const useStrategies = () => useQuery({ queryKey: ['strategies'], queryFn: () => api<Strategy[]>('/strategies') });

/** Puts a strategy returned by the API into the cached list (new ones first). */
function useStoreStrategy() {
  const client = useQueryClient();
  return (strategy: Strategy) =>
    client.setQueryData<Strategy[]>(['strategies'], (list = []) =>
      list.some((s) => s.id === strategy.id) ? list.map((s) => (s.id === strategy.id ? strategy : s)) : [strategy, ...list],
    );
}

export function useSaveStrategy() {
  const store = useStoreStrategy();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateStrategyInput | UpdateStrategyInput }) =>
      id
        ? api<Strategy>(`/strategies/${id}`, { method: 'PATCH', json: input })
        : api<Strategy>('/strategies', { method: 'POST', json: input }),
    onSuccess: store,
  });
}

export function useDeleteStrategy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/strategies/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => client.setQueryData<Strategy[]>(['strategies'], (list = []) => list.filter((s) => s.id !== id)),
  });
}

export type StrategyRuleChange =
  | { op: 'add'; label: string }
  | { op: 'edit'; ruleId: string; label: string }
  | { op: 'delete'; ruleId: string }
  | { op: 'order'; ids: string[] };

/** Adds, edits, deletes or reorders a strategy's rules; the API answers with the whole strategy. */
export function useChangeStrategyRules(strategyId: string) {
  const store = useStoreStrategy();
  return useMutation({
    mutationFn: (change: StrategyRuleChange) => {
      const base = `/strategies/${strategyId}/rules`;
      switch (change.op) {
        case 'add':
          return api<Strategy>(base, { method: 'POST', json: { label: change.label } });
        case 'edit':
          return api<Strategy>(`${base}/${change.ruleId}`, { method: 'PATCH', json: { label: change.label } });
        case 'delete':
          return api<Strategy>(`${base}/${change.ruleId}`, { method: 'DELETE' });
        case 'order':
          return api<Strategy>(`${base}/order`, { method: 'PUT', json: { ids: change.ids } });
      }
    },
    onSuccess: store,
  });
}

// --- Admin panel ---------------------------------------------------------------------

export const useAdminUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<AdminUser[]>('/admin/users') });
export const useAdminStats = () => useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<AdminStats>('/admin/stats') });
/** Refreshes every 30 s while the status page is open. */
export const useSystemStatus = () =>
  useQuery({ queryKey: ['admin', 'system'], queryFn: () => api<SystemStatus>('/admin/system'), refetchInterval: 30_000 });
export const useAdminInstruments = () => useQuery({ queryKey: ['admin', 'instruments'], queryFn: () => api<AdminInstrument[]>('/admin/instruments') });

export function useAdminUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUpdateUserInput }) => api<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export type AdminUserAction = 'revoke' | 'reset' | 'twoFactor' | 'delete';
export type AdminActionResult = { revoked?: number; sent?: boolean; emailConfigured?: boolean; deleted?: boolean; reset?: boolean };

/** Sign out everywhere, e-mail a password reset link, turn off two-step sign-in, or delete the account. */
export function useAdminUserAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: AdminUserAction }): Promise<AdminActionResult> =>
      action === 'revoke'
        ? api<{ revoked: number }>(`/admin/users/${id}/sessions/revoke`, { method: 'POST' })
        : action === 'reset'
          ? api<{ sent: boolean; emailConfigured: boolean }>(`/admin/users/${id}/password-reset`, { method: 'POST' })
          : action === 'twoFactor'
            ? api<{ reset: boolean }>(`/admin/users/${id}/two-factor/reset`, { method: 'POST' })
            : api<{ deleted: boolean }>(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin'] }),
  });
}

/** Admin: the "what's new" e-mail, as a test to yourself or to everyone. */
export function useSendWhatsNew() {
  return useMutation({
    mutationFn: (input: WhatsNewInput) => api<{ recipients: number }>('/admin/whats-new', { method: 'POST', json: input }),
  });
}

export function useRefreshNews() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ status: string }>('/admin/news/refresh', { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: ['admin', 'system'] }),
  });
}

export function useSaveInstrument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreateInstrumentInput | UpdateInstrumentInput }) =>
      id
        ? api<AdminInstrument>(`/admin/instruments/${id}`, { method: 'PATCH', json: input })
        : api<AdminInstrument>('/instruments', { method: 'POST', json: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      void client.invalidateQueries({ queryKey: ['instruments'] });
    },
  });
}

// --- Backtesting ---------------------------------------------------------------

/** Past candles of a replay (at most 1000 of the stored resolution per call). */
export const fetchBacktestCandles = (instrumentId: string, resolution: AnalysisResolution, from: string, to: string) =>
  api<BacktestCandles>(`/backtest/candles${qs({ instrumentId, resolution, from, to })}`);

export const useBacktestSessions = () => useQuery({ queryKey: ['backtest', 'sessions'], queryFn: () => api<BacktestSessionListItem[]>('/backtest/sessions') });

export const useBacktestSession = (id: string | null) =>
  useQuery({ queryKey: ['backtest', 'session', id], queryFn: () => api<BacktestSession>(`/backtest/sessions/${id}`), enabled: id != null });

function useBacktestRefresh() {
  const client = useQueryClient();
  return (session?: BacktestSession) => {
    if (session) client.setQueryData(['backtest', 'session', session.id], session);
    void client.invalidateQueries({ queryKey: ['backtest'] });
    // A closed position moves the backtesting account's balance.
    void client.invalidateQueries({ queryKey: ['accounts'] });
  };
}

export function useCreateBacktestSession() {
  const refresh = useBacktestRefresh();
  return useMutation({
    mutationFn: (input: CreateBacktestSessionInput) => api<BacktestSession>('/backtest/sessions', { method: 'POST', json: input }),
    onSuccess: (session) => refresh(session),
  });
}

export function useUpdateBacktestSession() {
  const refresh = useBacktestRefresh();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; cursorAt?: string; resolution?: AnalysisResolution; finished?: boolean }) =>
      api<BacktestSession>(`/backtest/sessions/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: (session) => refresh(session),
  });
}

export function useDeleteBacktestSession() {
  const refresh = useBacktestRefresh();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/backtest/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}

export function useOpenBacktestTrade() {
  const refresh = useBacktestRefresh();
  return useMutation({
    mutationFn: ({ sessionId, ...input }: OpenBacktestTradeInput & { sessionId: string }) =>
      api<BacktestTrade>(`/backtest/sessions/${sessionId}/trades`, { method: 'POST', json: input }),
    onSuccess: () => refresh(),
  });
}

export function useUpdateBacktestTrade() {
  const refresh = useBacktestRefresh();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; stopLoss?: number | null; takeProfit?: number | null; close?: { price: number; at: string; reason: 'tp' | 'sl' | 'manual' } }) =>
      api<BacktestTrade>(`/backtest/trades/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => refresh(),
  });
}

export function useDeleteBacktestTrade() {
  const refresh = useBacktestRefresh();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/backtest/trades/${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}
