import type { ScoringInput } from "../../engine/contracts/ScoringInput";
import type { AuditSprintResultV1 } from "../contracts/result";
import type { LicenseContext } from "../contracts/LicenseContext";

import { SecureLogicAI } from "../SecureLogicAI";
import { enforceLicense } from "../LicenseGate";

/**
 * PUBLIC PRODUCT API
 */
export class AuditSprintAPI {
  private readonly engine: SecureLogicAI;

  constructor(private readonly license: LicenseContext) {
    this.engine = new SecureLogicAI(license);
  }

  run(input: ScoringInput): Readonly<AuditSprintResultV1> {
    const result = this.engine.runAuditSprint(input);
    return enforceLicense(result, this.license);
  }
}
