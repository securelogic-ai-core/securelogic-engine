export interface SBOMComponent {
  name: string;
  version: string;
  integrity?: string;
}

export interface SBOMV1 {
  version: "sbom-v1";
  generatedAt: string;
  components: SBOMComponent[];
}
