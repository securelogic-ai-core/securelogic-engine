/**
 * scanAppRoutes.ts — discover the app's page routes from the Next.js App Router
 * file tree (`app/src/app/**`).
 *
 * A directory containing a `page.tsx` is a navigable route. The route path is
 * the directory path with Next conventions applied:
 *   - route groups `(group)` are stripped from the URL,
 *   - dynamic segments `[id]` are kept verbatim and flag the route dynamic,
 *   - the `api/` subtree (route handlers, not pages) is skipped,
 *   - the app root `page.tsx` is `/`.
 *
 * Shared by the generator (`generate-app-knowledge-index.ts`) and the drift
 * regression test, so both derive routes identically. Node-only (uses fs); it
 * lives under scripts/ and is never part of the engine build.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

export type ScannedRoute = { path: string; dynamic: boolean };

export function scanAppRoutes(appAppDir: string): ScannedRoute[] {
  const found: ScannedRoute[] = [];

  function walk(dir: string, segments: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
      const urlSegments = segments.filter(
        (s) => !(s.startsWith("(") && s.endsWith(")"))
      );
      const path = urlSegments.length === 0 ? "/" : "/" + urlSegments.join("/");
      const dynamic = segments.some((s) => s.startsWith("[") && s.endsWith("]"));
      found.push({ path, dynamic });
    }

    for (const e of entries) {
      if (e.isDirectory() && e.name !== "api") {
        walk(join(dir, e.name), [...segments, e.name]);
      }
    }
  }

  walk(appAppDir, []);

  // Dedupe + sort for determinism.
  const seen = new Set<string>();
  return found
    .filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
