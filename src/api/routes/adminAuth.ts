import { Router } from "express";
import argon2 from "argon2";
import { v4 as uuidv4 } from "uuid";

import { findAdminByEmail } from "../auth/adminStore.js";
import { createSession, deleteSession } from "../auth/sessionStore.js";

const router = Router();

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

router.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "missing_credentials" });
    return;
  }

  const user = findAdminByEmail(email);

  if (!user) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const valid = await argon2.verify(user.password_hash, password);

  if (!valid) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  createSession(sessionId, user.id, expiresAt);

  res.cookie("sl_admin_session", sessionId, {
    httpOnly: true,
    secure: false, // change to true in prod
    sameSite: "strict",
    maxAge: SESSION_TTL_MS
  });

  res.json({ ok: true });
});

router.post("/admin/logout", (req, res) => {
  const sessionId = req.cookies?.sl_admin_session;

  if (sessionId) {
    deleteSession(sessionId);
  }

  res.clearCookie("sl_admin_session");
  res.json({ ok: true });
});

export default router;
