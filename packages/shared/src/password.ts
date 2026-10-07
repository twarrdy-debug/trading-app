/**
 * Password policy, checked by the API (sign-up, reset, change, the CLI login script) and shown live
 * by the forms: at least 10 characters with a lowercase letter, an uppercase letter and a special
 * character (anything that is neither a letter nor a digit, e.g. ! ? # or a space).
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES = ['length', 'lower', 'upper', 'special'] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

const TESTS: Record<PasswordRule, (password: string) => boolean> = {
  length: (p) => [...p].length >= PASSWORD_MIN_LENGTH,
  lower: (p) => /\p{Ll}/u.test(p),
  upper: (p) => /\p{Lu}/u.test(p),
  special: (p) => /[^\p{L}\p{N}]/u.test(p),
};

/** The rules the password does not meet yet (empty when it is good enough). */
export const passwordProblems = (password: string): PasswordRule[] => PASSWORD_RULES.filter((rule) => !TESTS[rule](password));
