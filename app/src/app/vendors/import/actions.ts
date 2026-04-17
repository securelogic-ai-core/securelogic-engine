"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type VendorImportRow = {
  name: string;
  category?: string;
  criticality?: string;
  service_description?: string;
  data_sensitivity?: string;
  access_level?: string;
  website?: string;
};

export type VendorImportResult = {
  total: number;
  created: number;
  skipped: number;
  errors: number;
  results: Array<{
    name: string;
    status: "created" | "skipped" | "error";
    message?: string;
    id?: string;
  }>;
};

export async function importVendors(
  rows: VendorImportRow[]
): Promise<VendorImportResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      results: rows.map((r) => ({
        name: r.name,
        status: "error",
        message: "Not authenticated",
      })),
    };
  }

  if (rows.length > 500) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      results: rows.map((r) => ({
        name: r.name,
        status: "error",
        message: "Import limit exceeded (max 500 rows)",
      })),
    };
  }

  const results: VendorImportResult["results"] = [];

  for (const row of rows) {
    const body: Record<string, string> = { name: row.name };
    if (row.category)             body.category             = row.category;
    if (row.criticality)          body.criticality          = row.criticality;
    if (row.service_description)  body.service_description  = row.service_description;
    if (row.data_sensitivity)     body.data_sensitivity     = row.data_sensitivity;
    if (row.access_level)         body.access_level         = row.access_level;
    if (row.website)              body.website              = row.website;

    let res: Response;
    try {
      res = await fetch(`${ENGINE_URL}/api/vendors`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      results.push({ name: row.name, status: "error", message: "Network error" });
      continue;
    }

    if (res.status === 201) {
      const data = (await res.json().catch(() => ({}))) as { vendor?: { id?: string } };
      results.push({ name: row.name, status: "created", id: data.vendor?.id });
      continue;
    }

    if (res.status === 409) {
      results.push({ name: row.name, status: "skipped", message: "Vendor already exists" });
      continue;
    }

    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      results.push({
        name: row.name,
        status: "error",
        message: data.detail ?? data.error ?? "Invalid data",
      });
      continue;
    }

    results.push({ name: row.name, status: "error", message: "Failed to create vendor" });
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors:  results.filter((r) => r.status === "error").length,
    results,
  };
}
