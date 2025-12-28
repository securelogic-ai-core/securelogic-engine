/**
 * PUBLIC CONTRACT — STABLE ENVELOPE FORMAT
 * Clients persist and transmit this object
 */

/**
 * SecureLogic Result Envelope
 * ==========================
 * Canonical wrapper for all client-facing outputs.
 * This is the ONLY object clients should persist or transmit.
 */

import type { AuditSprintResultV1 } from "../result/AuditSprintResultV1.js";

export type ResultPayload =
  | {
      version: "v1";
      payload: AuditSprintResultV1;
    };

export interface ResultEnvelope {
  kind: "SecureLogicResult";
  issuedAt: string;
  result: ResultPayload;
}
