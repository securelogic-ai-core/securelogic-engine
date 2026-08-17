/**
 * pgSsl.ts — the single decision about how every Postgres connection treats
 * TLS. Pure and dependency-free ON PURPOSE: the app pools (infra/postgres.ts)
 * and the standalone script pools (runMigrations, seeds, validation) must make
 * the SAME decision, and the scripts cannot import a module that constructs
 * pools at import time.
 *
 * P0-1 (hardening batch 2026-08-17; OWASP audit 2026-05 finding #1, Critical):
 * every pool previously used `{ rejectUnauthorized: false }` — encrypted but
 * UNAUTHENTICATED TLS, accepting any certificate an on-path party presents.
 * Verification is now the DEFAULT. This is safe against Render managed
 * Postgres because its external endpoints present a publicly-trusted chain,
 * verified empirically 2026-08-17 credential-free:
 *
 *   issuer  C=US, O=Let's Encrypt, CN=YR2
 *   SANs    *.virginia-postgres.render.com, *.aws-us-east-1-1-postgres.render.com, ...
 *   openssl s_client -starttls postgres -verify_hostname <dpg-host>  →  OK
 *
 * Knobs, each for one specific situation and nothing else:
 *
 *   DATABASE_SSL_DISABLED=true      No TLS at all. The cross-org isolation
 *                                   harness's local docker Postgres (E1-G1).
 *                                   Pre-existing; unchanged.
 *
 *   DATABASE_SSL_SERVERNAME=<host>  Verify the chain against system roots but
 *                                   check the certificate's hostname against
 *                                   THIS name instead of the DSN's host. For a
 *                                   DSN that uses Render's INTERNAL hostname:
 *                                   the cert's SANs cover only the public
 *                                   *.{region}-postgres.render.com names, so
 *                                   hostname verification needs the external
 *                                   name while the socket dials the internal
 *                                   one. Set it to the database's external
 *                                   hostname (dpg-….{region}-postgres.render.com).
 *
 *   DATABASE_SSL_CA=<PEM>           Additional/replacement trust anchor(s), if
 *                                   Render ever moves off a public CA. Unused
 *                                   today.
 *
 *   DATABASE_TLS_NO_VERIFY=true     THE ROLLBACK HATCH — the exact legacy
 *                                   behaviour (encrypted, unauthenticated).
 *                                   Exists so that a verification failure in
 *                                   production is recoverable with an env flip
 *                                   instead of a code revert. Setting it is an
 *                                   incident action, not a configuration: the
 *                                   engine logs it at error level on every
 *                                   boot (selfTest) and it must be removed as
 *                                   part of closing whatever incident set it.
 *
 * Precedence: DISABLED > NO_VERIFY > verified (with optional CA / servername).
 */

export type PgSslConfig =
  | false
  | {
      rejectUnauthorized: boolean;
      ca?: string;
      servername?: string;
    };

export function resolvePgSsl(env: NodeJS.ProcessEnv = process.env): PgSslConfig {
  const disabled =
    env["DATABASE_SSL_DISABLED"] === "true" || env["DATABASE_SSL_DISABLED"] === "1";
  if (disabled) return false;

  if (env["DATABASE_TLS_NO_VERIFY"] === "true") {
    return { rejectUnauthorized: false };
  }

  const out: Exclude<PgSslConfig, false> = { rejectUnauthorized: true };
  const ca = env["DATABASE_SSL_CA"];
  if (typeof ca === "string" && ca.trim() !== "") out.ca = ca;
  const servername = env["DATABASE_SSL_SERVERNAME"];
  if (typeof servername === "string" && servername.trim() !== "") {
    out.servername = servername.trim();
  }
  return out;
}

/** True when the rollback hatch is active — callers log this loudly. */
export function pgTlsVerificationDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = resolvePgSsl(env);
  return cfg !== false && cfg.rejectUnauthorized === false;
}
