/**
 * knowledgeGraphFeatureFlag.ts — ERIP Epic 7: the Knowledge Graph feature flag.
 * Gates the graph analysis surfaces. When off, every graph route 404s BEFORE
 * any handler/auth, and no existing behavior changes.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate. Prod enablement is out
 * of scope for the ERIP program (GATE B posture).
 */

import type { Request, Response, NextFunction } from "express";

export function knowledgeGraphEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED"] === "true";
}

export function knowledgeGraphFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!knowledgeGraphEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
