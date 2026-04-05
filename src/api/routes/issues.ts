import { Router } from "express";
import { logger } from "../infra/logger.js";
import {
  getLatestIssueId,
  getIssueArtifact
} from "../infra/issueStore.js";
import { isSignedIssue } from "../contracts/signedIssue.schema.js";

const router = Router();

/**
 * Parse and validate a raw artifact string from Redis.
 * Returns the issue content or null if invalid.
 */
function parseArtifact(raw: string): import("../contracts/signedIssue.schema.js").SignedIssue | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isSignedIssue(parsed)) {
    return null;
  }

  return parsed;
}

/* =========================================================
   GET LATEST ISSUE
   GET /issues/latest
   ========================================================= */

router.get("/latest", async (_req, res) => {
  try {
    const latestId = await getLatestIssueId();

    if (!latestId) {
      res.status(404).json({ error: "no_issues_published" });
      return;
    }

    const raw = await getIssueArtifact(latestId);

    if (!raw) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    const artifact = parseArtifact(raw);

    if (!artifact) {
      logger.error(
        { event: "issues_artifact_invalid", issueNumber: latestId },
        "GET /issues/latest: artifact failed validation"
      );
      res.status(500).json({ error: "issue_unavailable" });
      return;
    }

    res.status(200).json({
      issueNumber: latestId,
      signedAt: artifact.signedAt,
      issue: artifact.issue
    });
  } catch (err) {
    logger.error({ event: "issues_latest_failed", err }, "GET /issues/latest failed");
    res.status(500).json({ error: "issue_fetch_failed" });
  }
});

/* =========================================================
   GET ISSUE BY NUMBER
   GET /issues/:issueNumber
   ========================================================= */

router.get("/:issueNumber", async (req, res) => {
  try {
    const raw = req.params.issueNumber ?? "";
    const issueNumber = Number(raw);

    if (
      !Number.isFinite(issueNumber) ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0 ||
      issueNumber > 10_000_000
    ) {
      res.status(400).json({ error: "invalid_issue_number" });
      return;
    }

    const artifact_raw = await getIssueArtifact(issueNumber);

    if (!artifact_raw) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    const artifact = parseArtifact(artifact_raw);

    if (!artifact) {
      logger.error(
        { event: "issues_artifact_invalid", issueNumber },
        "GET /issues/:issueNumber: artifact failed validation"
      );
      res.status(500).json({ error: "issue_unavailable" });
      return;
    }

    res.status(200).json({
      issueNumber,
      signedAt: artifact.signedAt,
      issue: artifact.issue
    });
  } catch (err) {
    logger.error({ event: "issues_get_failed", err }, "GET /issues/:issueNumber failed");
    res.status(500).json({ error: "issue_fetch_failed" });
  }
});

export default router;
