import type { CustomerExportV1 } from "./CustomerExportV1";

export function exportCustomerData(
  exportData: CustomerExportV1
): string {
  return JSON.stringify(exportData, null, 2);
}
