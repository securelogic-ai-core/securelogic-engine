"use server";

import ExcelJS from "exceljs";

export async function parseExcelFile(formData: FormData): Promise<{
  headers: string[];
  rows: Record<string, string>[];
  error?: string;
}> {
  try {
    const file = formData.get("file") as File | null;
    if (!file) return { headers: [], rows: [], error: "No file provided." };
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return { headers: [], rows: [], error: "No sheets found in file." };
    }

    const matrix: string[][] = [];
    worksheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(String(cell.value ?? "").trim());
      });
      matrix.push(cells);
    });

    if (matrix.length === 0) {
      return { headers: [], rows: [], error: "No data found in file." };
    }

    // Skip merged/title rows — find first row with at least 2 non-empty cells
    const headerRowIdx = matrix.findIndex(
      (row) => row.filter((c) => c !== "").length >= 2
    );
    if (headerRowIdx === -1) {
      return { headers: [], rows: [], error: "No header row detected." };
    }

    const headers = matrix[headerRowIdx].map((h) => h.trim()).filter((h) => h !== "");
    if (headers.length === 0) {
      return { headers: [], rows: [], error: "No columns detected." };
    }

    const rows: Record<string, string>[] = [];
    for (let i = headerRowIdx + 1; i < matrix.length; i++) {
      const rawRow = matrix[i];
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h] = String(rawRow[idx] ?? "").trim();
      });
      if (Object.values(record).some((v) => v !== "")) {
        rows.push(record);
      }
    }

    if (rows.length === 0) {
      return { headers, rows: [], error: "No data rows found." };
    }

    return { headers, rows };
  } catch {
    return {
      headers: [],
      rows: [],
      error: "Failed to parse Excel file. Please check the format or use CSV instead.",
    };
  }
}
