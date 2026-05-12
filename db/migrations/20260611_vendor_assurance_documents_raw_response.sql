-- Migration: vendor_assurance_documents — raw_response_excerpt for failed extractions
-- Package: vendor-assurance-extraction-resilience
--
-- Adds raw_response_excerpt to vendor_assurance_documents. On a failed extraction
-- whose failure code is llm_invalid_json (a model response was received but the
-- cleaned text did not JSON.parse, OR the parsed JSON was rejected by the strict
-- validator socExtractionValidator.ts), the runner now persists the verbatim
-- model response — truncated to the same 8 KiB budget the success path uses on
-- vendor_assurance_extractions.raw_response_excerpt — so the failure is
-- diagnosable without re-running the LLM call.
--
-- On success the excerpt continues to live on
-- vendor_assurance_extractions.raw_response_excerpt; this column stays NULL for
-- pending / extracting / extracted / finalized rows and for the non-LLM failure
-- codes (pdf_unparseable, llm_unavailable, llm_failed, unhandled).
--
-- Additive only. No alters to existing columns. No enum changes.

ALTER TABLE vendor_assurance_documents
  ADD COLUMN IF NOT EXISTS raw_response_excerpt TEXT NULL;
