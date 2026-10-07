import { PASSWORD_RULES, passwordProblems } from '@trading/shared';
import { useT } from '../../i18n/index.tsx';

/** True when the password meets the policy (the same check as the API). */
export const isStrongPassword = (password: string) => passwordProblems(password).length === 0;

/**
 * The password requirements under a new-password field, each ticked as soon as it is met, so the
 * user sees what is missing before submitting.
 */
export function PasswordRules({ password, id }: { password: string; id?: string }) {
  const t = useT().auth.passwordRules;
  const missing = new Set(passwordProblems(password));
  return (
    <ul id={id} aria-live="polite" className="m-0 grid list-none gap-x-4 gap-y-1 p-0 text-xs sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const met = !missing.has(rule);
        return (
          <li key={rule} className={`flex items-center gap-1.5 ${met ? 'text-buy' : 'text-dim'}`}>
            <span aria-hidden className="w-3 text-center font-bold">
              {met ? '✓' : '•'}
            </span>
            {t[rule]}
            <span className="sr-only">{met ? t.met : t.missing}</span>
          </li>
        );
      })}
    </ul>
  );
}
