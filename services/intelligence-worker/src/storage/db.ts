import { Pool } from "pg";
import { ENV } from "../config/env.js";

export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
