#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/securelogic-engine

set -a
source .env.local
set +a

npx tsx <<'TS'
import { pg } from "./src/api/infra/postgres.ts";

const organizationId = "82c9bbc4-27b7-4c39-9ad4-791f7583b5e9";

await pg.query("DELETE FROM newsletter_deliveries");
await pg.query("DELETE FROM newsletter_issues");
await pg.query(
  "DELETE FROM subscribers WHERE email IN ('test@securelogic.ai','user2@securelogic.ai','user3@securelogic.ai')"
);

await pg.query(
  "INSERT INTO subscribers (organization_id, email, tier, status, created_at) VALUES ($1,$2,$3,$4,NOW())",
  [organizationId, "test@securelogic.ai", "free", "active"]
);

await pg.query(
  "INSERT INTO subscribers (organization_id, email, tier, status, created_at) VALUES ($1,$2,$3,$4,NOW())",
  [organizationId, "user2@securelogic.ai", "free", "active"]
);

await pg.query(
  "INSERT INTO subscribers (organization_id, email, tier, status, created_at) VALUES ($1,$2,$3,$4,NOW())",
  [organizationId, "user3@securelogic.ai", "free", "active"]
);

console.log("newsletter state reset and seed subscribers created");
process.exit(0);
TS
