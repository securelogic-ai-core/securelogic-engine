-- Migration: intelligence_event_workflow_triggers
-- Package: Intelligence Pipeline Hardening / item 7 (workflow automation)
-- Memo: docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md
--
-- The GLOBAL dedup ledger for workflow automation triggered by canonical event
-- LIFECYCLE TRANSITIONS. One row per (event, to_state) that has fired the
-- per-org follow-through (findings reconcile + notification), so a workflow
-- triggers exactly ONCE per event lifecycle transition — never per raw signal
-- ingestion, never twice for the same transition.
--
-- GLOBAL (event-keyed, org-agnostic): no organization_id, no RLS — the per-org
-- follow-through it drives (findings, notifications) carries its own tenant
-- scoping + dedup. Registered in dataClassification.ts.
--
-- DARK: nothing writes this until the lifecycle-trigger pass runs behind
-- SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED. Additive + idempotent.
-- Reversible: DROP TABLE intelligence_event_workflow_triggers;

CREATE TABLE IF NOT EXISTS intelligence_event_workflow_triggers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
  to_state       TEXT        NOT NULL,
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Fire once per (event, lifecycle state reached).
  CONSTRAINT event_workflow_triggers_unique UNIQUE (event_id, to_state)
);

CREATE INDEX IF NOT EXISTS idx_event_workflow_triggers_event
  ON intelligence_event_workflow_triggers (event_id);
