import type { ExecutiveRiskReportV2 } from "../contracts/ExecutiveRiskReportV2.js";
import { ExecutiveRiskReportV2PdfRenderer } from "./ExecutiveRiskReportV2PdfRenderer.js";

export class ClientReportRenderer {
  static renderExecutive(report: ExecutiveRiskReportV2): string {
    return ExecutiveRiskReportV2PdfRenderer.render(report);
  }
}
