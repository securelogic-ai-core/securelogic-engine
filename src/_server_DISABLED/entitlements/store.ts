console.log("🧠 ENTITLEMENT STORE LOADED");

export type Entitlement = {
  email: string;
  product: "AUDIT_SPRINT";
  remaining: number;
  source: "STRIPE" | "DEV";
  sourceRef: string;
  issuedAt: string;
};

const entitlements = new Map<string, Entitlement>();

export function grantAuditSprint(
  email: string,
  source: "STRIPE" | "DEV",
  sourceRef: string
) {
  entitlements.set(email, {
    email,
    product: "AUDIT_SPRINT",
    remaining: 1,
    source,
    sourceRef,
    issuedAt: new Date().toISOString()
  });
}

export function hasAuditSprint(email: string): boolean {
  const ent = entitlements.get(email);
  return !!ent && ent.remaining > 0;
}

export function consumeAuditSprint(email: string) {
  const ent = entitlements.get(email);
  if (!ent || ent.remaining <= 0) {
    throw new Error("ENTITLEMENT_EXHAUSTED");
  }
  ent.remaining -= 1;
}
