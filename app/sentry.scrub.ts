/**
 * Shared beforeSend scrubbing for the app's Sentry configs (client / server /
 * edge). Mirrors the engine's scrub shape (src/api/lib/sentry.ts): strip the
 * request body + sensitive headers, then deep-redact any nested field whose
 * name is a known secret.
 *
 * Kept as a root-level module (not under src/) and imported with a relative
 * path so it resolves identically from the root-level sentry.*.config.ts files
 * without depending on the "@/" path alias.
 */

// Field names (normalized: lowercased, separators removed) whose VALUES must
// never reach Sentry, no matter how deeply nested.
const SENSITIVE_FIELD_NAMES = new Set([
  "password",
  "token",
  "apikey",
  "sessiontoken",
  "mfacode",
  "refreshtoken",
]);

// Request header names (lowercased) stripped wholesale from captured events.
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "x-api-key"]);

const REDACTED = "[Filtered]";
const MAX_SCRUB_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deepScrub(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): void {
  if (depth > MAX_SCRUB_DEPTH) return;
  if (!value || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) deepScrub(item, seen, depth + 1);
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_FIELD_NAMES.has(normalizeKey(key))) {
      obj[key] = REDACTED;
      continue;
    }
    deepScrub(obj[key], seen, depth + 1);
  }
}

/**
 * beforeSend hook shared by all three app Sentry runtimes. Typed loosely
 * because the @sentry/nextjs Event shape differs across SDK majors; this only
 * touches stable, well-known fields.
 */
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  if (!event || typeof event !== "object") return event;

  const request = event.request as
    | { data?: unknown; headers?: Record<string, unknown>; cookies?: unknown }
    | undefined;

  if (request && typeof request === "object") {
    if ("data" in request) delete request.data;
    if ("cookies" in request) delete request.cookies;

    if (request.headers && typeof request.headers === "object") {
      for (const headerName of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(headerName.toLowerCase())) {
          delete request.headers[headerName];
        }
      }
    }
  }

  deepScrub(event, new WeakSet(), 0);

  return event;
}
