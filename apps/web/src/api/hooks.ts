import type {
  AccountSummary,
  BasisOverview,
  CalendarRefresh,
  CalendarResponse,
  DailySpread,
  Educator,
  Emotion,
  Instrument,
  Mt5Import,
  NewsResponse,
  PublicUser,
  Trade,
  TradeList,
  TradeMutation,
  TradeStats,
  TradingAccount,
  TradingMonitor,
} from '@trading/api/types';
import type {
  BrokerTimezone,
  CreateAccountInput,
  CreateTradeInput,
  ParsedSignal,
  TradeFilters,
  UpdateAccountInput,
  UpdateSettingsInput,
} from '@trading/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client.ts';

const STATIC = { staleTime: 5 * 60_000 };

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<PublicUser>('/me') });
export const useInstruments = () =>
  useQuery({ queryKey: ['instruments'], queryFn: () => api<Instrument[]>('/instruments'), ...STATIC });
export const useEmotions = () =>
  useQuery({ queryKey: ['emotions'], queryFn: () => api<Emotion[]>('/emotions'), ...STATIC });
export const useEducators = () =>
  useQuery({ queryKey: ['educators'], queryFn: () => api<Educator[]>('/educators'), ...STATIC });

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateSettingsInput) => api<PublicUser>('/me', { method: 'PATCH', json: patch }),
    onSuccess: (user, patch) => {
      client.setQueryData(['me'], user);
      // Emotion labels, stats labels and messages come from the API in the user's language.
      if (patch.language) void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
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

export const useTradeStats = (range: { dateFrom?: string; dateTo?: string; instrumentId?: string; account?: string }) =>
  useQuery({ queryKey: ['stats', range], queryFn: () => api<TradeStats>(`/trades/stats${qs(range)}`) });

function useInvalidateTrades() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['trades'] });
    void client.invalidateQueries({ queryKey: ['stats'] });
    void client.invalidateQueries({ queryKey: ['accounts'] });
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

/** Preview (commit = false) or import of an MT5 history report. */
export function useMt5Import() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: ({
      file,
      timezone,
      symbolMap,
      commit,
      accountId,
    }: {
      file: File;
      timezone: BrokerTimezone;
      symbolMap: Record<string, string>;
      commit: boolean;
      accountId?: string;
    }) => {
      const body = new FormData();
      // Text fields go first: the API reads them before the file.
      body.append('timezone', timezone);
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

export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api<AccountSummary[]>('/accounts') });

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

export function useDeleteAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
