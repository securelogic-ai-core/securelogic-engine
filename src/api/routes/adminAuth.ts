import { Router } from "express";
import argon2 from "argon2";
import { v4 as uuidv4 } from "uuid";

import { findAdminByEmail } from "../auth/adminStore.js";
import { createSession, deleteSession } from "../auth/sessionStore.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

router.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    writeAuditEvent({
      actorUserId: null,
      eventType: "admin.login_failure",
      resourceType: "admin_user",
      payload: { reason: "missing_credentials" },
      ipAddress: req.ip ?? null
    });
    res.status(400).json({ error: "missing_credentials" });
    return;
  }

  const user = findAdminByEmail(email);

  if (!user) {
    writeAuditEvent({
      actorUserId: null,
      eventType: "admin.login_failure",
      resourceType: "admin_user",
      payload: { reason: "user_not_found", email },
      ipAddress: req.ip ?? null
    });
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const valid = await argon2.verify(user.password_hash, password);

  if (!valid) {
    writeAuditEvent({
      actorUserId: user.id,
      eventType: "admin.login_failure",
      resourceType: "admin_user",
      resourceId: user.id,
      payload: { reason: "invalid_password" },
      ipAddress: req.ip ?? null
    });
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  createSession(sessionId, user.id, expiresAt);

  writeAuditEvent({
    actorUserId: user.id,
    eventType: "admin.login_success",
    resourceType: "admin_user",
    resourceId: user.id,
    ipAddress: req.ip ?? null
  });

  res.cookie("sl_admin_session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_MS
  });

  res.json({ ok: true });
});

router.post("/admin/logout", (req, res) => {
  const sessionId = req.cookies?.sl_admin_session;
  const hadSession = Boolean(sessionId);

  if (sessionId) {
    deleteSession(sessionId);
  }

  writeAuditEvent({
    actorUserId: null,
    eventType: "admin.logout",
    resourceType: "admin_user",
    payload: { had_session: hadSession },
    ipAddress: req.ip ?? null
  });

  res.clearCookie("sl_admin_session");
  res.json({ ok: true });
});

export default router;
