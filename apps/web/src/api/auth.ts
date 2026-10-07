import type { AuthConfig, CreatedInvite, Invite } from '@trading/api/types';
import type { CreateInviteInput } from '@trading/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.ts';

/** A failed Better Auth call: `code` (e.g. INVALID_EMAIL_OR_PASSWORD) picks the message shown. */
export class AuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** POST to a Better Auth endpoint (/api/auth/*). The session cookie comes back with the response. */
async function authCall<T = unknown>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { code?: string };
  if (!res.ok) throw new AuthError(res.status === 429 ? 'TOO_MANY_REQUESTS' : (data.code ?? 'UNKNOWN'));
  return data as T;
}

/** The password was right, but the account has two-factor sign-in: a code is needed next. */
export interface SignInResult {
  twoFactorRedirect?: boolean;
}

export const authApi = {
  signIn: (email: string, password: string) => authCall<SignInResult>('/sign-in/email', { email, password }),
  /**
   * Second step of signing in, with a code from the authenticator app or a backup code. With
   * `trustDevice` this browser skips the code for 30 days.
   */
  verifyTotp: (code: string, trustDevice: boolean) => authCall('/two-factor/verify-totp', { code, trustDevice }),
  verifyBackupCode: (code: string, trustDevice: boolean) => authCall('/two-factor/verify-backup-code', { code, trustDevice }),
  /** Starts the setup: the authenticator link (for the QR code) and the backup codes. On after the first code. */
  enableTwoFactor: (password: string) => authCall<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password }),
  disableTwoFactor: (password: string) => authCall('/two-factor/disable', { password }),
  /** New backup codes; the old ones stop working. */
  newBackupCodes: (password: string) => authCall<{ backupCodes: string[] }>('/two-factor/generate-backup-codes', { password }),
  signUp: (input: { name: string; email: string; password: string; inviteCode?: string; language: string; timezone: string }) =>
    authCall('/sign-up/email', input),
  signOut: () => authCall('/sign-out', {}),
  requestReset: (email: string) => authCall('/request-password-reset', { email, redirectTo: '/nowe-haslo' }),
  resetPassword: (token: string, newPassword: string) => authCall('/reset-password', { token, newPassword }),
  /** Signed in only; other sessions are revoked, this one gets a fresh cookie. */
  changePassword: (currentPassword: string, newPassword: string) =>
    authCall('/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
};

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/auth-config'), staleTime: Infinity });

/** After signing in or out, everything cached belongs to the previous user. */
export function useResetSession() {
  const client = useQueryClient();
  return () => client.resetQueries();
}

export const useInvites = (enabled: boolean) =>
  useQuery({ queryKey: ['invites'], queryFn: () => api<Invite[]>('/invites'), enabled });

export function useCreateInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateInviteInput>) => api<CreatedInvite>('/invites', { method: 'POST', json: input }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useDeleteInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['invites'] }),
  });
}
