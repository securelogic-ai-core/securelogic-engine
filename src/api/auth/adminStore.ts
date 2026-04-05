import { db } from "../infra/db.js";

export type AdminUser = {
  id: string;
  email: string;
  password_hash: string;
  role: string;
};

export function findAdminByEmail(email: string): AdminUser | null {
  return (db.prepare(`
    SELECT id, email, password_hash, role
    FROM admin_users
    WHERE email = ?
  `).get(email) as AdminUser | undefined) ?? null;
}

export function findAdminById(id: string): AdminUser | null {
  return (db.prepare(`
    SELECT id, email, password_hash, role
    FROM admin_users
    WHERE id = ?
  `).get(id) as AdminUser | undefined) ?? null;
}