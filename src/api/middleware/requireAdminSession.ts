import { getSession } from "../auth/sessionStore.js";
import { findAdminById } from "../auth/adminStore.js";

export async function requireAdminSession(req, res, next) {
  const sessionId = req.cookies?.sl_admin_session;

  if (!sessionId) {
    return res.status(401).json({ error: "not_authenticated" });
  }

  const session = getSession(sessionId);

  if (!session) {
    return res.status(401).json({ error: "invalid_session" });
  }

  if (new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: "session_expired" });
  }

  const user = findAdminById(session.user_id);

  if (!user) {
    return res.status(401).json({ error: "user_not_found" });
  }

  req.adminUser = user;

  next();
}
