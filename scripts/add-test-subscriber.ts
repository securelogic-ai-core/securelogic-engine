import { pg } from "../src/api/infra/postgres.js";

const email = "thecrystians@gmail.com";

const result = await pg.query(
  `UPDATE subscribers
   SET organization_id = NULL, tier = 'standard', status = 'active'
   WHERE LOWER(email) = LOWER($1)
   RETURNING id, email, organization_id, tier, status`,
  [email]
);

console.log("Subscriber:", JSON.stringify(result.rows[0], null, 2));
await pg.end();
