/**
 * signalTypeLabels.ts — the ONE customer-language vocabulary for signal types.
 *
 * `signal_type` is an internal pipeline enum (patch_advisory, threat_actor, …).
 * The July-15 walkthrough found it leaking verbatim into customer-visible finding
 * titles ("Cyber signal (patch_advisory): …") — the same ruling class as the
 * matcher-terminology removal (app/src/components/queue/reviewLanguage.ts): raw
 * pipeline vocabulary never reaches a customer surface.
 *
 * This map previously lived privately in intelligenceBriefGenerator.ts; it is
 * extracted here so brief synthesis, finding-title composition, and event
 * projection share one definition and cannot drift.
 */

/** signal_type → customer phrase (lower-case; capitalize at the render site). */
export const SIGNAL_TYPE_PHRASE: Record<string, string> = {
  cve: "vulnerability",
  vulnerability: "attack technique",
  advisory: "security advisory",
  patch: "security patch",
  patch_advisory: "vendor security advisory",
  breach: "security incident",
  third_party_breach: "third-party breach disclosure",
  data_exposure: "data exposure",
  malware: "malware campaign",
  threat_actor: "threat-actor activity",
  regulatory_change: "regulatory development",
  geopolitical: "geopolitical development",
};

/**
 * The customer phrase for a signal type. Unknown types fall back to a humanized
 * form ("zero_day" → "zero day signal") — never the raw underscore enum.
 */
export function signalTypePhrase(signalType: string): string {
  return SIGNAL_TYPE_PHRASE[signalType] ?? `${signalType.replace(/_/g, " ")} signal`;
}

/** The phrase with its first letter capitalized, for title/sentence starts. */
export function signalTypePhraseCapitalized(signalType: string): string {
  const phrase = signalTypePhrase(signalType);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
