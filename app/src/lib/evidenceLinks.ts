/**
 * evidenceLinks.ts — turning evidence metadata into something a user can actually
 * open (DW-7 / B-12 / R-2).
 *
 * Evidence in this system is METADATA ONLY (src/api/routes/evidence.ts: "No file
 * upload, no blob storage") — a title, a type, and an optional `external_ref`. The
 * walkthrough flagged rows that LOOK interactive but do nothing. There is no blob
 * to download, so "openable" means: when `external_ref` is a URL, render it as a
 * real link that opens the source; otherwise present it as a plain, copyable
 * reference. No dead links, and no fabricated download endpoint.
 */

/** Is this external_ref a followable http(s) URL (vs. a bare identifier / ticket ref)? */
export function isUrlLikeRef(ref: string | null | undefined): boolean {
  if (!ref) return false;
  return /^https?:\/\/\S+$/i.test(ref.trim());
}

/** The href to open an evidence reference, or null when it is not a URL. */
export function evidenceRefHref(ref: string | null | undefined): string | null {
  return isUrlLikeRef(ref) ? ref!.trim() : null;
}
