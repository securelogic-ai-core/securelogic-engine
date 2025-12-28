export interface CustomerExportV1 {
  tenantId: string;
  exportedAt: string;
  artifacts: {
    type: string;
    hash: string;
  }[];
}
