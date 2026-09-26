import type {
  DailySpread,
  Educator,
  Emotion,
  Instrument,
  PublicUser,
  Trade,
  TradeList,
  TradeMutation,
  TradeStats,
} from '@trading/api/types';
import type { CreateTradeInput, ParsedSignal, TradeFilters, UpdateSettingsInput } from '@trading/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
    onSuccess: (user) => {
      client.setQueryData(['me'], user);
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

export const useTradeStats = (range: { dateFrom?: string; dateTo?: string; instrumentId?: string }) =>
  useQuery({ queryKey: ['stats', range], queryFn: () => api<TradeStats>(`/trades/stats${qs(range)}`) });

function useInvalidateTrades() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['trades'] });
    void client.invalidateQueries({ queryKey: ['stats'] });
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
