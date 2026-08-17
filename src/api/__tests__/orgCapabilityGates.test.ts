/**
 * orgCapabilityGates.test.ts — E-3 resolver semantics, both directions.
 *
 * C9's requirement verbatim: "a resolver bug is an entitlement bug —
 * fail-closed and test both directions." So this file proves:
 *
 *   - master flag OFF  → allow, with ZERO database access (a dark control must
 *     have no production footprint, the tdgDarkDeployment standard)
 *   - master flag ON   → explicit rows win in BOTH directions; absent rows take
 *     the per-capability registry default (allow for the live `ask`, deny for
 *     the dark agentic keys); lookup errors DENY; unregistered keys DENY
 *   - the middleware refuses with the askFeatureFlag 404 body and treats a
 *     missing org context as the programming-error 401, per the
 *     requireEntitlement contract
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../infra/postgres.js", () => ({ pg: { query: queryMock } }));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  orgCapabilityAllows,
  orgCapabilityGatesEnabled,
  requireOrgCapability,
  type OrgCapability,
} from "../lib/orgCapabilityGates.js";

const ORG = "11111111-1111-4111-8111-111111111111";

function envOn(): NodeJS.ProcessEnv {
  return { SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED: "true" } as NodeJS.ProcessEnv;
}

beforeEach(() => {
  queryMock.mockReset();
});
afterEach(() => {
  delete process.env["SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED"];
});

describe("master flag", () => {
  it("defaults OFF; only the literal 'true' enables", () => {
    expect(orgCapabilityGatesEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      orgCapabilityGatesEnabled({
        SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED: "TRUE",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(orgCapabilityGatesEnabled(envOn())).toBe(true);
  });

  it("off → allow for every registered key with ZERO database access", async () => {
    const keys: OrgCapability[] = ["ask", "ask_tools", "ask_streaming", "ask_actions", "ask_governed"];
    for (const k of keys) {
      expect(await orgCapabilityAllows(ORG, k, {} as NodeJS.ProcessEnv)).toBe(true);
    }
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("resolution with the master flag on", () => {
  it("an explicit TRUE row allows a default-deny capability", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ enabled: true }] });
    expect(await orgCapabilityAllows(ORG, "ask_actions", envOn())).toBe(true);
  });

  it("an explicit FALSE row denies the default-allow capability (per-tenant kill)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ enabled: false }] });
    expect(await orgCapabilityAllows(ORG, "ask", envOn())).toBe(false);
  });

  it("no row → 'ask' (live in production) defaults ALLOW", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await orgCapabilityAllows(ORG, "ask", envOn())).toBe(true);
  });

  it("no row → every dark agentic capability defaults DENY (explicit-grant-only)", async () => {
    for (const k of ["ask_tools", "ask_streaming", "ask_actions", "ask_governed"] as OrgCapability[]) {
      queryMock.mockResolvedValueOnce({ rows: [] });
      expect(await orgCapabilityAllows(ORG, k, envOn())).toBe(false);
    }
  });

  it("a lookup error DENIES — including for the default-allow capability", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection reset"));
    expect(await orgCapabilityAllows(ORG, "ask", envOn())).toBe(false);
  });

  it("an unregistered key DENIES without touching the database", async () => {
    expect(
      await orgCapabilityAllows(ORG, "ask_provenance" as OrgCapability, envOn())
    ).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("scopes the lookup by organization AND capability", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await orgCapabilityAllows(ORG, "ask_actions", envOn());
    const [sql, params] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/WHERE organization_id = \$1 AND capability = \$2/);
    expect(params).toEqual([ORG, "ask_actions"]);
  });
});

describe("requireOrgCapability middleware", () => {
  function run(orgId: string | null) {
    const req = { organizationContext: orgId ? { organizationId: orgId } : undefined } as never;
    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();
    const res = { status: statusMock, json: jsonMock } as never;
    const next = vi.fn();
    return { req, res, next, statusMock, jsonMock };
  }

  it("passes through with no query while the master flag is off", async () => {
    const { req, res, next } = run(ORG);
    await requireOrgCapability("ask")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("denies with the askFeatureFlag 404 body when the org gate refuses", async () => {
    process.env["SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED"] = "true";
    queryMock.mockResolvedValueOnce({ rows: [{ enabled: false }] });
    const { req, res, next, statusMock, jsonMock } = run(ORG);
    await requireOrgCapability("ask")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: "not_found" });
  });

  it("treats a missing org context as the programming-error 401", async () => {
    process.env["SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED"] = "true";
    const { req, res, next, statusMock, jsonMock } = run(null);
    await requireOrgCapability("ask")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "api_key_required" });
  });
});
