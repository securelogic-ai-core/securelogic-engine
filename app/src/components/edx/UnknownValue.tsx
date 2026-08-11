/**
 * UnknownValue — EDX-1 (load discrimination) applied to a single NUMBER.
 *
 * `<UnavailableNotice>` answers "this whole surface failed to load". This
 * answers the narrower question a stat tile asks: the page loaded, the list
 * rendered, and one count is simply not known.
 *
 * It exists because the alternatives a tile has are all lies. `0` states that
 * the population is empty. A count scanned out of the returned page states a
 * capped number as if it were a total. Hiding the tile states that the metric
 * does not apply. Only "we don't know this one" is true, so it needs a
 * rendering — and it needs to be the SAME rendering everywhere, for the same
 * reason nine independent "unavailable" implementations produced five false
 * sentences.
 *
 * Semantic rules, inherited from UnavailableNotice:
 * - The subject is named. The dash alone is not the disclosure; the sentence
 *   rendered by <UnknownValueNote> is, and a surface using this component is
 *   expected to render one.
 * - Cause is never attributed. The app layer cannot tell a 500 from a 403, so
 *   it claims neither.
 * - It refuses the specific wrong reading — that a dash means zero.
 *
 * Server-safe: no hooks, no client directives, no data access.
 */

/**
 * The value shown in place of a count that could not be loaded.
 *
 * `label` names the tile it stands in for and reaches assistive technology and
 * hover through `title`; it is deliberately NOT rendered as extra text, so a
 * caller reading the tile's text content still sees a single token rather than
 * a sentence spliced into the number.
 */
export function UnknownValue({
  label,
  style,
}: {
  /** The tile's own label, e.g. "Overdue" — used for the accessible name. */
  label: string;
  /** Merged over the default muted colour, so the tile keeps its own type scale. */
  style?: React.CSSProperties;
}) {
  const description = `${label} is unavailable — this is not a zero`;
  return (
    <span
      title={description}
      aria-label={description}
      style={{ color: "#475569", ...style }}
    >
      &mdash;
    </span>
  );
}

/**
 * The sentence that makes a dash mean something. Render it once beneath a group
 * of tiles when ANY of them is unknown — the dash is the marker, this is the
 * disclosure, and the disclosure is the part that stops a customer reading a
 * failed count as an empty one.
 */
export function UnknownValueNote({
  subject = "Some counts",
}: {
  /** What could not be counted, in the customer's vocabulary. */
  subject?: string;
}) {
  return (
    <p className="mb-6 text-xs" style={{ color: "#64748b" }}>
      {subject} couldn&rsquo;t be loaded and are shown as &mdash;. That is a
      loading problem, not a zero &mdash; the underlying work is unchanged.
    </p>
  );
}
