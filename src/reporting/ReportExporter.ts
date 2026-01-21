import fs from "node:fs";
import path from "node:path";
import type { AuditSprintReport } from "./ReportSchema.js";

export class ReportExporter {
  static exportToJson(report: AuditSprintReport, outputDir = "./reports"): string {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `audit-sprint-${report.meta.clientName.replace(/\s+/g, "_")}-${Date.now()}.json`;
    const filePath = path.join(outputDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");

    return filePath;
  }
}
