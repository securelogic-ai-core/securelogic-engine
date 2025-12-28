import type { IdentityBindingV1 } from "./IdentityBindingV1";
import { deepFreeze } from "../integrity/deepFreeze";

const identities = new Map<string, IdentityBindingV1>();

export function bindIdentity(binding: IdentityBindingV1): void {
  identities.set(binding.subjectId, deepFreeze(binding));
}

export function getIdentity(subjectId: string): IdentityBindingV1 | undefined {
  return identities.get(subjectId);
}
