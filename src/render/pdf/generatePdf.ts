import PDFDocument from "pdfkit";

export async function generatePdf(runId: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text("PRISM REPORT");
    doc.moveDown();
    doc.fontSize(12).text(`Run ID: ${runId}`);

    doc.end();
  });
}
