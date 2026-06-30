/**
 * Single source of truth for legal-document dates.
 *
 * Launch decision: the Effective Date and the Last Updated date for every legal
 * document (Terms, Privacy, AI Policy) are the public launch date. They are
 * defined once here so the rendered legal pages can never show the authoring
 * placeholder ("[INSERT DATE]") and can never drift from one another.
 *
 * At the launch cutover, replace the value below with the real calendar date
 * (e.g. "June 30, 2026"). This is the ONLY edit required to date all three
 * legal documents.
 */
export const LAUNCH_DATE = "July 1, 2026";

export const LEGAL_EFFECTIVE_DATE = LAUNCH_DATE;
export const LEGAL_LAST_UPDATED = LAUNCH_DATE;
