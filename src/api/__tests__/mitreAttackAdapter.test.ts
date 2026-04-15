import { describe, it, expect } from "vitest";

import {
  extractAttackId,
  deriveAttackSeverity,
  buildAttackSummary,
  mapStixObjectToSignal,
  type StixObject
} from "../lib/mitreAttackAdapter.js";

// ---------------------------------------------------------------------------
// Fixtures — representative STIX objects
// ---------------------------------------------------------------------------

const techniquePhishing: StixObject = {
  id: "attack-pattern--a5911dd1-af0e-4164-a099-a1fa4909e42e",
  type: "attack-pattern",
  name: "Phishing",
  description:
    "Adversaries may send phishing messages to gain access to victim systems. All forms of phishing are electronically delivered social engineering.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "T1566",
      url: "https://attack.mitre.org/techniques/T1566"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false,
  x_mitre_is_subtechnique: false,
  kill_chain_phases: [
    { kill_chain_name: "mitre-attack", phase_name: "initial-access" }
  ]
};

const subTechniqueSpearphishing: StixObject = {
  id: "attack-pattern--2e34237d-8574-43f6-aace-ae2915de8849",
  type: "attack-pattern",
  name: "Spearphishing Attachment",
  description: "Adversaries may send spearphishing emails with a malicious attachment.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "T1566.001",
      url: "https://attack.mitre.org/techniques/T1566/001"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false,
  x_mitre_is_subtechnique: true,
  kill_chain_phases: [
    { kill_chain_name: "mitre-attack", phase_name: "initial-access" }
  ]
};

const techniqueDataDestruction: StixObject = {
  id: "attack-pattern--d45a3d09-b3cf-48f4-9f0e-6a150ead2081",
  type: "attack-pattern",
  name: "Data Destruction",
  description: "Adversaries may destroy data and files on specific systems.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "T1485",
      url: "https://attack.mitre.org/techniques/T1485"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false,
  x_mitre_is_subtechnique: false,
  kill_chain_phases: [
    { kill_chain_name: "mitre-attack", phase_name: "impact" }
  ]
};

const techniqueCommandExecution: StixObject = {
  id: "attack-pattern--7385dfaf-6886-4229-9ecd-6fd678040830",
  type: "attack-pattern",
  name: "Windows Command Shell",
  description: "Adversaries may abuse the Windows command shell for execution.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "T1059.003",
      url: "https://attack.mitre.org/techniques/T1059/003"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false,
  x_mitre_is_subtechnique: true,
  kill_chain_phases: [
    { kill_chain_name: "mitre-attack", phase_name: "execution" }
  ]
};

const groupAPT28: StixObject = {
  id: "intrusion-set--bef4c620-0787-42a8-a96d-b7eb6e85917c",
  type: "intrusion-set",
  name: "APT28",
  description: "APT28 is a threat group that has been attributed to Russia's GRU.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "G0007",
      url: "https://attack.mitre.org/groups/G0007"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false
};

const malwareMimikatz: StixObject = {
  id: "malware--afc079f3-c0ea-4096-b75d-3f05338b7f60",
  type: "malware",
  name: "Mimikatz",
  description:
    "Mimikatz is a credential dumper capable of obtaining plaintext Windows account logins and passwords.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "S0002",
      url: "https://attack.mitre.org/software/S0002"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false
};

const toolCobaltStrike: StixObject = {
  id: "tool--a7881f21-e978-4fe4-af56-92c9416a2616",
  type: "tool",
  name: "Cobalt Strike",
  description: "Cobalt Strike is a commercial, fully-supported, adversary simulation software.",
  external_references: [
    {
      source_name: "mitre-attack",
      external_id: "S0154",
      url: "https://attack.mitre.org/software/S0154"
    }
  ],
  x_mitre_deprecated: false,
  x_mitre_revoked: false
};

const deprecatedTechnique: StixObject = {
  ...techniquePhishing,
  id: "attack-pattern--deprecated-1",
  x_mitre_deprecated: true,
  external_references: [
    { source_name: "mitre-attack", external_id: "T0001" }
  ]
};

const revokedTechnique: StixObject = {
  ...techniquePhishing,
  id: "attack-pattern--revoked-1",
  x_mitre_revoked: true,
  external_references: [
    { source_name: "mitre-attack", external_id: "T0002" }
  ]
};

const objectWithoutExternalId: StixObject = {
  id: "attack-pattern--no-refs",
  type: "attack-pattern",
  name: "Unknown Technique",
  description: "No external references.",
  external_references: [
    { source_name: "capec", external_id: "CAPEC-100" }
  ]
};

const relationshipObject: StixObject = {
  id: "relationship--abc123",
  type: "relationship"
};

// ====================================================================
// extractAttackId
// ====================================================================

describe("extractAttackId — mitre-attack references", () => {
  it("extracts T-series technique ID", () => {
    expect(extractAttackId(techniquePhishing)).toBe("T1566");
  });

  it("extracts sub-technique ID with dot notation", () => {
    expect(extractAttackId(subTechniqueSpearphishing)).toBe("T1566.001");
  });

  it("extracts G-series group ID", () => {
    expect(extractAttackId(groupAPT28)).toBe("G0007");
  });

  it("extracts S-series software ID for malware", () => {
    expect(extractAttackId(malwareMimikatz)).toBe("S0002");
  });

  it("extracts S-series software ID for tool", () => {
    expect(extractAttackId(toolCobaltStrike)).toBe("S0154");
  });

  it("returns null when external_references is absent", () => {
    const obj: StixObject = {
      id: "attack-pattern--no-refs",
      type: "attack-pattern",
      name: "Test"
    };
    expect(extractAttackId(obj)).toBeNull();
  });

  it("returns null when no mitre-attack reference present", () => {
    expect(extractAttackId(objectWithoutExternalId)).toBeNull();
  });

  it("returns null when mitre-attack reference has no external_id", () => {
    const obj: StixObject = {
      id: "attack-pattern--missing-id",
      type: "attack-pattern",
      name: "Test",
      external_references: [
        { source_name: "mitre-attack" }
      ]
    };
    expect(extractAttackId(obj)).toBeNull();
  });

  it("returns null for empty external_references array", () => {
    const obj: StixObject = {
      id: "attack-pattern--empty",
      type: "attack-pattern",
      name: "Test",
      external_references: []
    };
    expect(extractAttackId(obj)).toBeNull();
  });
});

// ====================================================================
// deriveAttackSeverity
// ====================================================================

describe("deriveAttackSeverity — attack-pattern techniques", () => {
  it("impact phase technique → Critical", () => {
    expect(deriveAttackSeverity(techniqueDataDestruction)).toBe("Critical");
  });

  it("initial-access phase technique (not subtechnique) → High", () => {
    expect(deriveAttackSeverity(techniquePhishing)).toBe("High");
  });

  it("sub-technique (not impact) → Moderate even if execution phase", () => {
    // Windows Command Shell is a sub-technique in execution phase.
    // Sub-technique flag wins over phase for Moderate classification.
    expect(deriveAttackSeverity(techniqueCommandExecution)).toBe("Moderate");
  });

  it("initial-access sub-technique → Moderate (subtechnique flag wins)", () => {
    expect(deriveAttackSeverity(subTechniqueSpearphishing)).toBe("Moderate");
  });

  it("technique with no kill chain phases → High (default)", () => {
    const noPhases: StixObject = {
      ...techniquePhishing,
      kill_chain_phases: []
    };
    expect(deriveAttackSeverity(noPhases)).toBe("High");
  });

  it("technique with non-mitre-attack kill chain → High (default)", () => {
    const otherChain: StixObject = {
      ...techniquePhishing,
      kill_chain_phases: [
        { kill_chain_name: "lockheed-martin-cyber-kill-chain", phase_name: "delivery" }
      ]
    };
    expect(deriveAttackSeverity(otherChain)).toBe("High");
  });
});

describe("deriveAttackSeverity — intrusion-set, malware, tool", () => {
  it("intrusion-set (threat group) → High", () => {
    expect(deriveAttackSeverity(groupAPT28)).toBe("High");
  });

  it("malware → High", () => {
    expect(deriveAttackSeverity(malwareMimikatz)).toBe("High");
  });

  it("tool → Moderate", () => {
    expect(deriveAttackSeverity(toolCobaltStrike)).toBe("Moderate");
  });
});

// ====================================================================
// buildAttackSummary
// ====================================================================

describe("buildAttackSummary — format and truncation", () => {
  it("formats technique as 'Technique T1566: Phishing — <desc>'", () => {
    const summary = buildAttackSummary(techniquePhishing, "T1566");
    expect(summary).toContain("Technique T1566: Phishing");
    expect(summary).toContain("—");
    expect(summary).toContain("phishing");
  });

  it("formats threat group as 'Threat Group G0007: APT28 — <desc>'", () => {
    const summary = buildAttackSummary(groupAPT28, "G0007");
    expect(summary).toContain("Threat Group G0007: APT28");
  });

  it("formats malware as 'Malware S0002: Mimikatz — <desc>'", () => {
    const summary = buildAttackSummary(malwareMimikatz, "S0002");
    expect(summary).toContain("Malware S0002: Mimikatz");
  });

  it("formats tool as 'Tool S0154: Cobalt Strike — <desc>'", () => {
    const summary = buildAttackSummary(toolCobaltStrike, "S0154");
    expect(summary).toContain("Tool S0154: Cobalt Strike");
  });

  it("omits dash separator when description is empty", () => {
    const noDesc: StixObject = { ...techniquePhishing, description: "" };
    const summary = buildAttackSummary(noDesc, "T1566");
    expect(summary).toBe("Technique T1566: Phishing");
  });

  it("truncates to 500 characters max", () => {
    // namePart = "Technique T1566: " + 200-char name (217 chars)
    // truncatedDesc = 300 chars
    // combined = 217 + " — " + 300 = 521 chars → triggers 500 truncation
    const longDesc: StixObject = {
      ...techniquePhishing,
      name: "N".repeat(200),
      description: "X".repeat(1000)
    };
    const summary = buildAttackSummary(longDesc, "T1566");
    expect(summary.length).toBe(500);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("uses ID alone when name is absent", () => {
    const noName: StixObject = {
      ...techniquePhishing,
      name: undefined
    };
    const summary = buildAttackSummary(noName, "T1566");
    expect(summary).toContain("Technique T1566");
  });
});

// ====================================================================
// mapStixObjectToSignal — field mapping
// ====================================================================

describe("mapStixObjectToSignal — attack-pattern (technique)", () => {
  const result = mapStixObjectToSignal(techniquePhishing);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("source is mitre_attack", () => {
    expect(result!.source).toBe("mitre_attack");
  });

  it("signal_type is vulnerability", () => {
    expect(result!.signal_type).toBe("vulnerability");
  });

  it("severity is High (initial-access, not sub-technique)", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_vendor is the ATT&CK ID T1566", () => {
    expect(result!.affected_vendor).toBe("T1566");
  });

  it("affected_cve is null", () => {
    expect(result!.affected_cve).toBeNull();
  });

  it("normalized_summary contains name and description", () => {
    expect(result!.normalized_summary).toContain("Phishing");
    expect(result!.normalized_summary).toContain("T1566");
  });

  it("raw_payload contains attack_id", () => {
    expect((result!.raw_payload as any).attack_id).toBe("T1566");
  });

  it("raw_payload stix_type is attack-pattern", () => {
    expect((result!.raw_payload as any).stix_type).toBe("attack-pattern");
  });
});

describe("mapStixObjectToSignal — sub-technique (spearphishing)", () => {
  const result = mapStixObjectToSignal(subTechniqueSpearphishing);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("signal_type is vulnerability", () => {
    expect(result!.signal_type).toBe("vulnerability");
  });

  it("severity is Moderate (sub-technique)", () => {
    expect(result!.severity).toBe("Moderate");
  });

  it("affected_vendor is T1566.001", () => {
    expect(result!.affected_vendor).toBe("T1566.001");
  });
});

describe("mapStixObjectToSignal — impact-phase technique", () => {
  const result = mapStixObjectToSignal(techniqueDataDestruction);

  it("severity is Critical", () => {
    expect(result!.severity).toBe("Critical");
  });

  it("affected_vendor is T1485", () => {
    expect(result!.affected_vendor).toBe("T1485");
  });
});

describe("mapStixObjectToSignal — intrusion-set (threat group)", () => {
  const result = mapStixObjectToSignal(groupAPT28);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("signal_type is threat_actor", () => {
    expect(result!.signal_type).toBe("threat_actor");
  });

  it("severity is High", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_vendor is G0007", () => {
    expect(result!.affected_vendor).toBe("G0007");
  });
});

describe("mapStixObjectToSignal — malware", () => {
  const result = mapStixObjectToSignal(malwareMimikatz);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("signal_type is malware", () => {
    expect(result!.signal_type).toBe("malware");
  });

  it("severity is High", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_vendor is S0002", () => {
    expect(result!.affected_vendor).toBe("S0002");
  });
});

describe("mapStixObjectToSignal — tool", () => {
  const result = mapStixObjectToSignal(toolCobaltStrike);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("signal_type is malware (tools use the same type)", () => {
    expect(result!.signal_type).toBe("malware");
  });

  it("severity is Moderate", () => {
    expect(result!.severity).toBe("Moderate");
  });

  it("affected_vendor is S0154", () => {
    expect(result!.affected_vendor).toBe("S0154");
  });
});

// ====================================================================
// mapStixObjectToSignal — skipped/null cases
// ====================================================================

describe("mapStixObjectToSignal — skipped objects", () => {
  it("returns null for deprecated objects", () => {
    expect(mapStixObjectToSignal(deprecatedTechnique)).toBeNull();
  });

  it("returns null for revoked objects", () => {
    expect(mapStixObjectToSignal(revokedTechnique)).toBeNull();
  });

  it("returns null for relationship objects", () => {
    expect(mapStixObjectToSignal(relationshipObject)).toBeNull();
  });

  it("returns null when no ATT&CK external_id", () => {
    expect(mapStixObjectToSignal(objectWithoutExternalId)).toBeNull();
  });

  it("returns null for course-of-action type", () => {
    const coa: StixObject = {
      id: "course-of-action--abc",
      type: "course-of-action",
      name: "Patch System"
    };
    expect(mapStixObjectToSignal(coa)).toBeNull();
  });

  it("returns null when name is absent", () => {
    const noName: StixObject = {
      id: "attack-pattern--no-name",
      type: "attack-pattern",
      description: "Some technique",
      external_references: [
        { source_name: "mitre-attack", external_id: "T9999" }
      ]
    };
    expect(mapStixObjectToSignal(noName)).toBeNull();
  });

  it("returns null when name is whitespace-only", () => {
    const blankName: StixObject = {
      id: "attack-pattern--blank",
      type: "attack-pattern",
      name: "   ",
      external_references: [
        { source_name: "mitre-attack", external_id: "T9998" }
      ]
    };
    expect(mapStixObjectToSignal(blankName)).toBeNull();
  });
});

// ====================================================================
// mapStixObjectToSignal — output shape
// ====================================================================

describe("mapStixObjectToSignal — output shape", () => {
  it("output has exactly 7 keys", () => {
    const result = mapStixObjectToSignal(techniquePhishing);
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
