import fs from "node:fs";
import path from "node:path";
import type { AuditSprintReport } from "./AuditSprintSchema.js";

export class AuditSprintExporter {
  static export(report: AuditSprintReport, outDir = "./reports"): string {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const filename = `audit-sprint-${report.meta.companyName.replace(/\s+/g, "_")}-${Date.now()}.json`;
    const filePath = path.join(outDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");

    return filePath;
  }
}
