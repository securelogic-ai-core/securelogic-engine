-- Migration: org_max_monitored_entities
-- Seat/entity metering (PR 2) — monitored-entity cap on organizations.
--
-- A "monitored entity" is a row in vendors OR ai_systems. The Platform base
-- plan includes up to 50 combined (vendors + AI systems); above that is an
-- admin-set, sales-led raise (the entire "Platform Scale" mechanism — there is
-- no Stripe price for it). Enforcement is at creation time (POST /api/vendors,
-- POST /api/ai-systems); existing over-cap rows are grandfathered.
--
-- Mirrors the existing organizations.max_members INTEGER NOT NULL DEFAULT 10
-- from 20260520_multi_user_team.sql. Adding a column with a constant default
-- is a metadata-only operation in modern Postgres — no table rewrite, every
-- existing row reads 50 immediately, no null window.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_monitored_entities INTEGER NOT NULL DEFAULT 50;
