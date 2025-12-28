import type { ScoringInput } from "../../engine/contracts/ScoringInput";

export function parseScoringInput(input: unknown): ScoringInput {
  // For now: structural trust boundary
  // Later: Zod schema here
  return input as ScoringInput;
}
