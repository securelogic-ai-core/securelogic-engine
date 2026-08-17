/**
 * pgSsl.test.ts — P0-1: the TLS decision every Postgres pool shares.
 *
 * The matrix matters more than any single row: the previous state
 * (`rejectUnauthorized: false` everywhere) survived fifteen months because the
 * decision lived inline at eight call sites and no test pinned it. Now it is
 * one pure function, and this file is the pin — in particular that VERIFIED is
 * the default and that the legacy behaviour is reachable only through the
 * explicit, boot-logged rollback hatch.
 */
import { describe, it, expect } from "vitest";

import { resolvePgSsl, pgTlsVerificationDisabled } from "../infra/pgSsl.js";

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("resolvePgSsl", () => {
  it("VERIFIES by default — an empty environment gets rejectUnauthorized: true", () => {
    expect(resolvePgSsl(env({}))).toEqual({ rejectUnauthorized: true });
  });

  it("harness escape: DATABASE_SSL_DISABLED (true or 1) disables TLS entirely", () => {
    expect(resolvePgSsl(env({ DATABASE_SSL_DISABLED: "true" }))).toBe(false);
    expect(resolvePgSsl(env({ DATABASE_SSL_DISABLED: "1" }))).toBe(false);
  });

  it("rollback hatch: DATABASE_TLS_NO_VERIFY='true' reproduces the legacy behaviour exactly", () => {
    expect(resolvePgSsl(env({ DATABASE_TLS_NO_VERIFY: "true" }))).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("the hatch requires the literal 'true' — anything else stays verified", () => {
    for (const v of ["TRUE", "1", "yes", ""]) {
      expect(resolvePgSsl(env({ DATABASE_TLS_NO_VERIFY: v }))).toEqual({
        rejectUnauthorized: true,
      });
    }
  });

  it("DISABLED outranks the hatch (precedence: disabled > no-verify > verified)", () => {
    expect(
      resolvePgSsl(env({ DATABASE_SSL_DISABLED: "true", DATABASE_TLS_NO_VERIFY: "true" }))
    ).toBe(false);
  });

  it("DATABASE_SSL_SERVERNAME feeds hostname verification for internal-hostname DSNs", () => {
    expect(
      resolvePgSsl(env({ DATABASE_SSL_SERVERNAME: " dpg-x.virginia-postgres.render.com " }))
    ).toEqual({
      rejectUnauthorized: true,
      servername: "dpg-x.virginia-postgres.render.com",
    });
  });

  it("DATABASE_SSL_CA is passed through; empty/whitespace values are ignored", () => {
    expect(resolvePgSsl(env({ DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----" }))).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----",
    });
    expect(resolvePgSsl(env({ DATABASE_SSL_CA: "  " }))).toEqual({ rejectUnauthorized: true });
  });

  it("the hatch ignores servername/ca — it is the legacy config, nothing more", () => {
    expect(
      resolvePgSsl(
        env({ DATABASE_TLS_NO_VERIFY: "true", DATABASE_SSL_SERVERNAME: "x", DATABASE_SSL_CA: "y" })
      )
    ).toEqual({ rejectUnauthorized: false });
  });
});

describe("pgTlsVerificationDisabled (the boot alarm's trigger)", () => {
  it("fires only for the hatch — not for verified, not for the non-TLS harness", () => {
    expect(pgTlsVerificationDisabled(env({ DATABASE_TLS_NO_VERIFY: "true" }))).toBe(true);
    expect(pgTlsVerificationDisabled(env({}))).toBe(false);
    expect(pgTlsVerificationDisabled(env({ DATABASE_SSL_DISABLED: "true" }))).toBe(false);
  });
});
