/**
 * Pure, React-free signup validators so the client-side rules can be unit-tested
 * in isolation (the app test lane runs in node with no jsdom — see the
 * billingPortalSubmit.ts / retry.ts split for the same pattern).
 *
 * These mirror the server's own checks in /api/auth-signup; the client copy
 * exists only to give immediate feedback before the network round-trip. The
 * server remains authoritative.
 */

/** Same message for length and character-class failures (matches prior UX). */
const PASSWORD_RULE_MESSAGE =
  "Must be 12+ characters with uppercase, lowercase, and a number";

/** Returns an error message if the password is too short/weak, else null. */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 12) return PASSWORD_RULE_MESSAGE;
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return PASSWORD_RULE_MESSAGE;
  }
  return null;
}

/**
 * Returns an error message if `confirm` does not exactly match `password`, else
 * null. Catches the silent-typo case where a user would otherwise create an
 * account they cannot sign into.
 */
export function validatePasswordsMatch(
  password: string,
  confirm: string,
): string | null {
  if (password !== confirm) return "Passwords do not match.";
  return null;
}
