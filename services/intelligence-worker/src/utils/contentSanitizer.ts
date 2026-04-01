export function cleanText(input: string): string {
  if (!input) return "";

  let text = input;

  // Remove broken escape sequences
  text = text.replace(/\\n/g, " ");
  text = text.replace(/\\t/g, " ");

  // Remove HTML artifacts
  text = text.replace(/<\/?[^>]+(>|$)/g, "");

  // Remove duplicate fragments (basic dedupe)
  const lines = text.split(/\.\s+/);
  const seen = new Set<string>();
  const deduped = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(trimmed);
    }
  }

  text = deduped.join(". ");

  // Fix spacing
  text = text.replace(/\s+/g, " ").trim();

  // Hard cutoff to prevent overflow
  return text.slice(0, 2000);
}
