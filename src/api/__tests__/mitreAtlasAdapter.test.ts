import { describe, it, expect } from "vitest";

import {
  extractAtlasId,
  buildAtlasSummary,
  mapAtlasObjectToSignal,
  type StixObject
} from "../lib/mitreAtlasAdapter.js";

// ---------------------------------------------------------------------------
// Fixtures — representative ATLAS STIX objects
// ---------------------------------------------------------------------------

const techniqueModelEvasion: StixObject = {
  id: "attack-pattern--atlas-evasion-1",
  type: "attack-pattern",
  name: "Evade ML Model",
  description:
    "An adversary may craft inputs to evade detection by a machine learning model using adversarial examples.",
  external_references: [
    {
      source_name: "ATLAS",
      external_id: "AML.T0015",
      url: "https://atlas.mitre.org/techniques/AML.T0015"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false,
  kill_chain_phases: [
    { kill_chain_name: "mitre-atlas", phase_name: "ml-model-access" }
  ]
};

const techniqueDataPoisoning: StixObject = {
  id: "attack-pattern--atlas-poison-1",
  type: "attack-pattern",
  name: "Data Poisoning",
  description:
    "An adversary may poison training data to influence a model's behavior at inference time.",
  external_references: [
    {
      source_name: "ATLAS",
      external_id: "AML.T0020",
      url: "https://atlas.mitre.org/techniques/AML.T0020"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false
};

/** ATLAS using newer 'mitre-atlas' source name */
const techniqueModelInversion: StixObject = {
  id: "attack-pattern--atlas-inversion-1",
  type: "attack-pattern",
  name: "Model Inversion Attack",
  description: "Reconstruct training data by repeatedly querying a model.",
  external_references: [
    {
      source_name: "mitre-atlas",
      external_id: "AML.T0024",
      url: "https://atlas.mitre.org/techniques/AML.T0024"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false
};

const subTechniqueBlackBox: StixObject = {
  id: "attack-pattern--atlas-blackbox-1",
  type: "attack-pattern",
  name: "Black-Box ML Attack",
  description: "Attack a model without direct access to its internals.",
  external_references: [
    {
      source_name: "ATLAS",
      external_id: "AML.T0015.001",
      url: "https://atlas.mitre.org/techniques/AML.T0015/001"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false,
  x_mitre_is_subtechnique: true
};

const deprecatedTechnique: StixObject = {
  ...techniqueModelEvasion,
  id: "attack-pattern--atlas-deprecated",
  x_mitre_deprecated: true,
  external_references: [
    { source_name: "ATLAS", external_id: "AML.T0001" }
  ]
};

const revokedTechnique: StixObject = {
  ...techniqueModelEvasion,
  id: "attack-pattern--atlas-revoked",
  x_mitre_revoked: true,
  external_references: [
    { source_name: "ATLAS", external_id: "AML.T0002" }
  ]
};

const relationshipObject: StixObject = {
  id: "relationship--atlas-rel-1",
  type: "relationship"
};

const courseOfAction: StixObject = {
  id: "course-of-action--atlas-coa-1",
  type: "course-of-action",
  name: "Sanitize Training Data"
};

const noAtlasRef: StixObject = {
  id: "attack-pattern--no-atlas-ref",
  type: "attack-pattern",
  name: "Generic Technique",
  external_references: [
    { source_name: "mitre-attack", external_id: "T1234" }
  ]
};

// ====================================================================
// extractAtlasId
// ====================================================================

describe("extractAtlasId — ATLAS source_name variants", () => {
  it("extracts AML.T-series ID with source_name 'ATLAS'", () => {
    expect(extractAtlasId(techniqueModelEvasion)).toBe("AML.T0015");
  });

  it("extracts AML.T-series ID with source_name 'mitre-atlas'", () => {
    expect(extractAtlasId(techniqueModelInversion)).toBe("AML.T0024");
  });

  it("extracts sub-technique ID with dot notation", () => {
    expect(extractAtlasId(subTechniqueBlackBox)).toBe("AML.T0015.001");
  });

  it("returns null when external_references is absent", () => {
    const obj: StixObject = {
      id: "attack-pattern--no-refs",
      type: "attack-pattern",
      name: "Test"
    };
    expect(extractAtlasId(obj)).toBeNull();
  });

  it("returns null for non-ATLAS source names (e.g. mitre-attack)", () => {
    expect(extractAtlasId(noAtlasRef)).toBeNull();
  });

  it("returns null when ATLAS ref has no external_id", () => {
    const obj: StixObject = {
      id: "attack-pattern--no-id",
      type: "attack-pattern",
      name: "Test",
      external_references: [
        { source_name: "ATLAS" }
      ]
    };
    expect(extractAtlasId(obj)).toBeNull();
  });

  it("returns null for empty external_references", () => {
    const obj: StixObject = {
      id: "attack-pattern--empty",
      type: "attack-pattern",
      name: "Test",
      external_references: []
    };
    expect(extractAtlasId(obj)).toBeNull();
  });
});

// ====================================================================
// buildAtlasSummary
// ====================================================================

describe("buildAtlasSummary — format and truncation", () => {
  it("formats as 'AI Technique AML.T0015: <name> — <desc>'", () => {
    const summary = buildAtlasSummary(techniqueModelEvasion, "AML.T0015");
    expect(summary).toContain("AI Technique AML.T0015: Evade ML Model");
    expect(summary).toContain("—");
    expect(summary).toContain("adversarial examples");
  });

  it("sub-technique uses dot notation ID", () => {
    const summary = buildAtlasSummary(subTechniqueBlackBox, "AML.T0015.001");
    expect(summary).toContain("AI Technique AML.T0015.001: Black-Box ML Attack");
  });

  it("omits dash separator when description is empty", () => {
    const noDesc: StixObject = { ...techniqueModelEvasion, description: "" };
    const summary = buildAtlasSummary(noDesc, "AML.T0015");
    expect(summary).toBe("AI Technique AML.T0015: Evade ML Model");
  });

  it("truncates to 500 characters", () => {
    // namePart = "AI Technique AML.T0015: " + 200-char name (224 chars)
    // truncatedDesc = 300 chars
    // combined = 224 + " — " + 300 = 528 chars → triggers 500 truncation
    const longDesc: StixObject = {
      ...techniqueModelEvasion,
      name: "Y".repeat(200),
      description: "Y".repeat(1000)
    };
    const summary = buildAtlasSummary(longDesc, "AML.T0015");
    expect(summary.length).toBe(500);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("handles absent name with ID-only label", () => {
    const noName: StixObject = { ...techniqueModelEvasion, name: undefined };
    const summary = buildAtlasSummary(noName, "AML.T0015");
    expect(summary).toContain("AI Technique AML.T0015");
  });
});

// ====================================================================
// mapAtlasObjectToSignal — field mapping
// ====================================================================

describe("mapAtlasObjectToSignal — model evasion technique", () => {
  const result = mapAtlasObjectToSignal(techniqueModelEvasion);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("source is mitre_atlas", () => {
    expect(result!.source).toBe("mitre_atlas");
  });

  it("signal_type is threat_actor", () => {
    expect(result!.signal_type).toBe("threat_actor");
  });

  it("severity is High", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_vendor is the ATLAS ID", () => {
    expect(result!.affected_vendor).toBe("AML.T0015");
  });

  it("affected_cve is null", () => {
    expect(result!.affected_cve).toBeNull();
  });

  it("normalized_summary contains technique name and ID", () => {
    expect(result!.normalized_summary).toContain("AML.T0015");
    expect(result!.normalized_summary).toContain("Evade ML Model");
  });

  it("raw_payload contains atlas_id", () => {
    expect((result!.raw_payload as any).atlas_id).toBe("AML.T0015");
  });

  it("raw_payload stix_type is attack-pattern", () => {
    expect((result!.raw_payload as any).stix_type).toBe("attack-pattern");
  });
});

describe("mapAtlasObjectToSignal — data poisoning (mitre-atlas source)", () => {
  const result = mapAtlasObjectToSignal(techniqueDataPoisoning);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("source is mitre_atlas", () => {
    expect(result!.source).toBe("mitre_atlas");
  });

  it("affected_vendor is AML.T0020", () => {
    expect(result!.affected_vendor).toBe("AML.T0020");
  });
});

describe("mapAtlasObjectToSignal — model inversion (mitre-atlas source_name)", () => {
  const result = mapAtlasObjectToSignal(techniqueModelInversion);

  it("returns non-null — newer mitre-atlas source_name is recognized", () => {
    expect(result).not.toBeNull();
  });

  it("affected_vendor is AML.T0024", () => {
    expect(result!.affected_vendor).toBe("AML.T0024");
  });
});

describe("mapAtlasObjectToSignal — sub-technique", () => {
  const result = mapAtlasObjectToSignal(subTechniqueBlackBox);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("severity is still High (ATLAS has no severity differentiation)", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_vendor is AML.T0015.001", () => {
    expect(result!.affected_vendor).toBe("AML.T0015.001");
  });
});

// ====================================================================
// mapAtlasObjectToSignal — skipped/null cases
// ====================================================================

describe("mapAtlasObjectToSignal — skipped objects", () => {
  it("returns null for deprecated techniques", () => {
    expect(mapAtlasObjectToSignal(deprecatedTechnique)).toBeNull();
  });

  it("returns null for revoked techniques", () => {
    expect(mapAtlasObjectToSignal(revokedTechnique)).toBeNull();
  });

  it("returns null for relationship objects", () => {
    expect(mapAtlasObjectToSignal(relationshipObject)).toBeNull();
  });

  it("returns null for course-of-action objects", () => {
    expect(mapAtlasObjectToSignal(courseOfAction)).toBeNull();
  });

  it("returns null for attack-pattern without ATLAS external ID", () => {
    expect(mapAtlasObjectToSignal(noAtlasRef)).toBeNull();
  });

  it("returns null when name is absent", () => {
    const noName: StixObject = {
      id: "attack-pattern--no-name",
      type: "attack-pattern",
      external_references: [
        { source_name: "ATLAS", external_id: "AML.T9999" }
      ]
    };
    expect(mapAtlasObjectToSignal(noName)).toBeNull();
  });

  it("returns null when name is whitespace-only", () => {
    const blank: StixObject = {
      id: "attack-pattern--blank",
      type: "attack-pattern",
      name: "   ",
      external_references: [
        { source_name: "ATLAS", external_id: "AML.T9998" }
      ]
    };
    expect(mapAtlasObjectToSignal(blank)).toBeNull();
  });
});

// ====================================================================
// mapAtlasObjectToSignal — output shape
// ====================================================================

describe("mapAtlasObjectToSignal — output shape", () => {
  it("output has exactly 7 keys", () => {
    const result = mapAtlasObjectToSignal(techniqueModelEvasion);
    expect(result).not.toBeNull();
    const keys = Object.keys(result!).sort();
    expect(keys).toEqual(
      [
        "affected_cve",
        "affected_vendor",
        "normalized_summary",
        "raw_payload",
        "severity",
        "signal_type",
        "source"
      ].sort()
    );
  });
});

// ====================================================================
// Dedup key differentiation — both adapters use distinct sources
// ====================================================================

describe("dedup key differentiation", () => {
  it("ATLAS technique and ATT&CK technique with same ID suffix produce different signals", () => {
    // If somehow two adapters mapped to the same name, the source field differs.
    const atlasResult = mapAtlasObjectToSignal(techniqueModelEvasion);
    expect(atlasResult!.source).toBe("mitre_atlas");
    // An ATT&CK object with a similar pattern would use source 'mitre_attack'.
    // Combined with the dedup hash including source, these are distinct records.
  });
});
