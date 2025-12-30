import express from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";

import { saveIntakeEnvelope } from "../store/saveIntakeEnvelope";
import { verifyIntakeEnvelopeV1 } from "../verify/verifyIntakeEnvelopeV1";
import { dispatchRun } from "../../engine/dispatch/dispatchRun";
import type { IntakeEnvelopeV1 } from "../IntakeEnvelopeV1";
import path from "path";
import { isArtifactRevoked } from "../../run/artifacts/revocation/isArtifactRevoked";
import { revokeArtifact } from "../../run/artifacts/revocation/revokeArtifact";

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());

// ===== ARTIFACT INDEX (JSON ONLY) =====
app.get("/artifacts", (_req, res) => {
  const dir = "artifacts";
  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir).map(f => ({
    filename: f,
    url: `/artifacts/${f}`
  }));

  res.json(files);
});

// ===== ARTIFACT DOWNLOAD (STATIC) =====
app.use("/artifacts", express.static("artifacts"));

// ===== INTAKE =====
app.post("/intake", upload.array("evidence"), (req, res) => {
  const runId = crypto.randomUUID();

  const envelope: IntakeEnvelopeV1 = {
    version: "V1",
    runId,
    receivedAt: new Date().toISOString(),
    evidence: (req.files as any[]).map(f => ({
      id: f.filename,
      filename: f.originalname
    }))
  };

  const verification = verifyIntakeEnvelopeV1(envelope);
  if (!verification.valid) {
    return res.status(400).json(verification);
  }

  saveIntakeEnvelope(envelope);
  dispatchRun(runId);

  res.json({ runId });
});

app.listen(3001, () => {
  console.log("PRISM Intake API listening on http://localhost:3001");
});

// Revoke artifact (ADMIN)
app.post("/admin/artifacts/:filename/revoke", (req, res) => {
  revokeArtifact(req.params.filename, "ADMIN_REVOKE");
  res.json({ revoked: true });
});
