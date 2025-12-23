import { grantAuditSprint } from "./store";

export function grantDevAuditSprint(email: string) {
  console.log("🧪 DEV GRANT issued for:", email);
  grantAuditSprint(email, "DEV", "manual-dev-grant");
}
