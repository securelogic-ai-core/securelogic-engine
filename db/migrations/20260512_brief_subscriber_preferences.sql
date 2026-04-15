-- Migration: brief_subscriber_preferences
-- Package: brief-pro-personalization
-- Depends on: intelligence_brief_delivery (intelligence_brief_subscribers)
--
-- Adds per-subscriber delivery preferences to intelligence_brief_subscribers.
-- These control what items appear in each subscriber's email copy of the Brief.
--
--   min_severity              — Minimum item severity to include in delivery.
--                               Default 'Low' = receive everything.
--                               'High' = Critical + High only.
--
--   categories                — Optional allowlist of categories to include.
--                               NULL (default) = all categories.
--                               TEXT[] of: vulnerability, threat_actor,
--                                          vendor_incident, regulatory, general.
--
--   notify_vendor_matches_only — When TRUE, only deliver items where
--                               is_personalized = TRUE (i.e., the item matched
--                               a vendor, AI system, risk, or obligation in the
--                               subscriber's org's platform data).
--                               Default FALSE = deliver all items.

ALTER TABLE intelligence_brief_subscribers
  ADD COLUMN IF NOT EXISTS min_severity TEXT NOT NULL DEFAULT 'Low',
  ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notify_vendor_matches_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE intelligence_brief_subscribers
  DROP CONSTRAINT IF EXISTS intelligence_brief_subscribers_min_severity_check;

ALTER TABLE intelligence_brief_subscribers
  ADD CONSTRAINT intelligence_brief_subscribers_min_severity_check
    CHECK (min_severity IN ('Critical', 'High', 'Moderate', 'Low'));
