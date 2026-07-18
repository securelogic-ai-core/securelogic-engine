/**
 * evidenceFileValidation.ts — pure, I/O-free validation for uploaded Remediation
 * Evidence files. No DB, no storage, no Express — unit-testable in isolation.
 *
 * Defense in depth, because a declared Content-Type is attacker-controlled:
 *   1. the declared MIME must be in a strict allowlist (also enforced at the
 *      multer fileFilter, before the body is buffered);
 *   2. the file BYTES must match that type's magic-number signature (a PNG that
 *      claims to be a PDF is rejected);
 *   3. text types (no magic number) must not contain NUL bytes — a cheap guard
 *      against a binary smuggled in as text/plain;
 *   4. size is bounded (also enforced by multer's limits.fileSize);
 *   5. the stored display filename is sanitized (basename only, no control chars,
 *      length-capped) — the object key itself never uses the filename, so path
 *      traversal via the filename is impossible by construction.
 *
 * Legacy OLE Office formats (.doc/.xls/.ppt — the macro-bearing, higher-risk
 * container) are deliberately NOT accepted; the modern OOXML (docx/xlsx/pptx,
 * ZIP-based) are. There is no malware-scanning infrastructure in the platform, so
 * quarantine/scanning is not applicable here — the controls that DO apply (strict
 * allowlist, magic-byte verification, size limit, org-scoped keys, short-lived
 * signed URLs, no public object URLs) are all enforced.
 */

/** 25 MB — matches the vendor-assurance document limit (MAX_BYTE_SIZE). */
export const MAX_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024;

/** Per-org cumulative evidence storage cap (soft). */
export const MAX_ORG_EVIDENCE_STORAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

type MagicCheck = (buf: Buffer) => boolean;

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/** Reject text that contains a NUL byte in its leading window — binary smuggled
 *  as text. Pure text artifacts (logs, CSVs) never carry NUL. */
function looksLikeText(buf: Buffer): boolean {
  const window = buf.subarray(0, Math.min(buf.length, 8192));
  return !window.includes(0x00);
}

const PDF: MagicCheck = (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]); // %PDF
const PNG: MagicCheck = (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG: MagicCheck = (b) => startsWith(b, [0xff, 0xd8, 0xff]);
// OOXML (docx/xlsx/pptx) are ZIP containers: PK\x03\x04 (also PK\x05\x06 empty).
const ZIP: MagicCheck = (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);

/**
 * The allowlist. Key = canonical MIME. `aliases` are additional declared MIME
 * strings browsers/clients sometimes send for the same content. `magic` verifies
 * the bytes; a null magic means "no reliable signature" and falls back to the
 * text sniff.
 */
type AllowEntry = { canonical: string; ext: string; label: string; aliases?: string[]; magic: MagicCheck | null };

const ALLOW: AllowEntry[] = [
  { canonical: "application/pdf", ext: "pdf", label: "PDF", magic: PDF },
  { canonical: "image/png", ext: "png", label: "PNG image", magic: PNG },
  { canonical: "image/jpeg", ext: "jpg", label: "JPEG image", aliases: ["image/jpg"], magic: JPG },
  { canonical: "text/plain", ext: "txt", label: "Text", magic: null },
  { canonical: "text/csv", ext: "csv", label: "CSV", aliases: ["application/csv"], magic: null },
  {
    canonical: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx", label: "Word document", magic: ZIP,
  },
  {
    canonical: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx", label: "Excel workbook", magic: ZIP,
  },
  {
    canonical: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx", label: "PowerPoint deck", magic: ZIP,
  },
];

/** MIME strings accepted at the multer fileFilter (canonical + aliases). */
export const ALLOWED_UPLOAD_MIME_TYPES: string[] = ALLOW.flatMap((e) => [e.canonical, ...(e.aliases ?? [])]);

/** Human-facing list of accepted kinds, for error copy. */
export const ALLOWED_UPLOAD_LABELS: string[] = ALLOW.map((e) => e.label);

function resolveEntry(declaredMime: string): AllowEntry | null {
  const m = declaredMime.trim().toLowerCase().split(";")[0]!.trim();
  return ALLOW.find((e) => e.canonical === m || (e.aliases ?? []).includes(m)) ?? null;
}

/** Is this declared MIME in the allowlist? (fast pre-check for the fileFilter) */
export function isAllowedUploadMime(declaredMime: unknown): boolean {
  return typeof declaredMime === "string" && resolveEntry(declaredMime) !== null;
}

/**
 * Reduce an untrusted original filename to a safe display string:
 *   - basename only (strip any path, / or \ or a Windows drive),
 *   - drop control characters,
 *   - cap length.
 * The storage key never uses this value, so traversal is impossible; this only
 * keeps the DISPLAYED / audited name clean.
 */
export function sanitizeFilename(name: unknown): string {
  if (typeof name !== "string") return "upload";
  // Basename: everything after the last path separator (unix or windows).
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "") // no leading dots (hidden/relative)
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : "upload";
}

export type EvidenceFileValidationResult =
  | { ok: true; mime: string; ext: string; filename: string }
  | { ok: false; error: string; detail?: string };

/**
 * Full validation of a buffered upload. `size` is passed separately so the size
 * check is authoritative even if the buffer was truncated.
 */
export function validateEvidenceFile(args: {
  declaredMime: unknown;
  buffer: Buffer;
  size: number;
  originalName: unknown;
}): EvidenceFileValidationResult {
  if (typeof args.declaredMime !== "string") {
    return { ok: false, error: "unsupported_file_type" };
  }
  const entry = resolveEntry(args.declaredMime);
  if (!entry) {
    return {
      ok: false,
      error: "unsupported_file_type",
      detail: `Allowed: ${ALLOWED_UPLOAD_LABELS.join(", ")}`,
    };
  }

  if (!Number.isFinite(args.size) || args.size <= 0) {
    return { ok: false, error: "empty_file" };
  }
  if (args.size > MAX_EVIDENCE_FILE_BYTES) {
    return {
      ok: false,
      error: "file_too_large",
      detail: `Max ${Math.floor(MAX_EVIDENCE_FILE_BYTES / (1024 * 1024))} MB`,
    };
  }

  // Content must MATCH the declared type — a PNG renamed to .pdf is rejected.
  if (entry.magic) {
    if (!entry.magic(args.buffer)) {
      return { ok: false, error: "file_content_mismatch", detail: `Not a valid ${entry.label}` };
    }
  } else {
    // No magic number (text/csv/plain) — reject smuggled binary.
    if (!looksLikeText(args.buffer)) {
      return { ok: false, error: "file_content_mismatch", detail: `Not valid ${entry.label}` };
    }
  }

  return {
    ok: true,
    mime: entry.canonical,
    ext: entry.ext,
    filename: sanitizeFilename(args.originalName),
  };
}
