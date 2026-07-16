/**
 * downloadFile.ts — fetch-based file download for export buttons.
 *
 * Plain `<a download>` anchors save whatever the server returns — including
 * JSON error payloads (staging EXP-1: findings.json containing
 * {"error":"upstream_error"}). This helper fetches first, verifies the
 * response is an actual file, and only then triggers a browser download.
 *
 * Returns null on success, or a customer-safe error message when the export
 * failed — in which case nothing is downloaded.
 */

const GENERIC_ERROR =
  "Export failed. Please try again in a moment — if the problem persists, contact support.";

export function filenameFromContentDisposition(
  header: string | null
): string | null {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function downloadFile(
  url: string,
  fallbackFilename: string
): Promise<string | null> {
  let resp: Response;
  try {
    resp = await fetch(url, { cache: "no-store" });
  } catch {
    return GENERIC_ERROR;
  }

  const contentType = resp.headers.get("content-type") ?? "";
  // An error status — or a JSON body on any status — is never a file the
  // customer asked for. Surface an error instead of downloading it.
  if (!resp.ok || contentType.includes("application/json")) {
    return GENERIC_ERROR;
  }

  const blob = await resp.blob();
  const filename =
    filenameFromContentDisposition(resp.headers.get("content-disposition")) ??
    fallbackFilename;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return null;
}
