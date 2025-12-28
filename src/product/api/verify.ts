import { validateEnv } from "../config/validateEnv";
validateEnv();

import { assertEnterpriseRuntime } from "../runtime/assertEnterpriseRuntime";
assertEnterpriseRuntime();

import { buildSBOM } from "../release/buildSBOM";
const __sbom = buildSBOM();

import { loadRuntimeEnv } from "../runtime/loadRuntimeEnv";
const __runtime = loadRuntimeEnv();

import { assertNoReplay } from "./security/replayGuard";
import { assertRateLimit } from "./security/rateLimiter";

import type { ResultEnvelope } from "../contracts";
import type { VerificationPolicy } from "../integrity/VerificationPolicy";
import type { VerificationMode } from "../integrity/VerificationMode";
import { verifyWithPolicy } from "../integrity/verifyWithPolicy";

export function verifyEnvelope(
  envelope: ResultEnvelope,
  policy: VerificationPolicy,
  mode: VerificationMode
) {
  return verifyWithPolicy(envelope, policy, mode);
}
