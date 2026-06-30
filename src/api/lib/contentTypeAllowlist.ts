/**
 * contentTypeAllowlist.ts — which routes are exempt from strict JSON
 * Content-Type enforcement.
 *
 * The global "STRICT CONTENT-TYPE ENFORCEMENT" guard in app.ts rejects any
 * body-bearing request whose Content-Type is not application/json with a 415.
 * A handful of routes legitimately receive other content types (webhooks with
 * raw bodies, multipart file uploads, SAML form posts) and must be exempt.
 *
 * Extracted as a pure, tested predicate so the exemption list cannot silently
 * regress — omitting a multipart route here 415s every request to it before it
 * reaches its handler (this is exactly what broke Ask voice: /api/ask/transcribe
 * was missing, so multipart audio uploads were rejected at the gate).
 */

export function isContentTypeEnforcementExempt(originalUrl: string): boolean {
  return (
    originalUrl.startsWith("/webhooks/lemon") ||
    originalUrl.startsWith("/webhooks/email/resend") ||
    originalUrl.startsWith("/api/vendor-assessments/analyze-document") ||
    /^\/api\/vendor-assurance\/documents(\?|$)/.test(originalUrl) ||
    // Ask voice transcription receives multipart/form-data audio uploads.
    originalUrl.startsWith("/api/ask/transcribe") ||
    /^\/api\/sso\/[^/]+\/acs/.test(originalUrl)
  );
}
