import { mapToPublicSignal } from "../mapToPublicSignal.js";
import { ProvenancedSignal } from "../../../signals/contract/ProvenancedSignal.js";

const mockSignal = {
  id: "TEST-001",
  title: "Test Signal",
  source: "CISA_KEV",
  publishedAt: new Date().toISOString(),
  severity: 9,
  confidence: 0.9,
  occurrences: 3,
  risk: {
    score: 82,
    band: "HIGH",
    rationale: ["test"]
  },
  provenance: {
    sourceSystem: "CISA_KEV",
    ingestedAt: "",
    qualifiedAt: "",
    normalizedAt: "",
    scoredAt: "",
    engineVersion: "test"
  }
} as ProvenancedSignal;

const preview = mapToPublicSignal(mockSignal, "PREVIEW") as any;

if (preview.confidence !== undefined) throw new Error("confidence leaked");
if (preview.provenance !== undefined) throw new Error("provenance leaked");
if (preview.preview !== true) throw new Error("preview flag missing");
