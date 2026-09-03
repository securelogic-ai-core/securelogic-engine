/**
 * Publish the SecureLogic canonical control corpus, its aliases, and the
 * NIST CSF 1.1 crosswalk.
 *
 * Run:  MIGRATION_DATABASE_URL=... npx tsx scripts/publish-canonical-controls.ts \
 *         --publisher-email you@example.com [--apply]
 *
 * Dry run by default: it executes every statement inside a transaction and
 * ROLLBACKs, so the counts it prints are what an --apply run would really do,
 * proven against the real constraints rather than simulated.
 *
 * ── Why a script and not a migration ────────────────────────────────────────
 * `canonical_controls_publication_authority_check` makes a published row
 * without a named publisher impossible, and a migration cannot name a human.
 * Publication is a governance act, so the act carries the actor: this script
 * requires a real `users` row and writes that id onto every published control
 * and every crosswalk row.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *   - It never edits published content. Divergence between the corpus modules
 *     and an already-published row is reported as DRIFT and left alone; the fix
 *     is a superseding row, which is a separate curation decision.
 *   - It never publishes a partial crosswalk. A crosswalk slug that resolves to
 *     no canonical control aborts the run before any write.
 *   - It FAILS CLOSED. An --apply run that finds any drift or any alias bound
 *     to a different canonical control ROLLS BACK and exits non-zero: nothing
 *     is committed while the meaning of a published key is in question. Use the
 *     dry run to see every finding at once.
 *
 * ── The audit trail ─────────────────────────────────────────────────────────
 * The durable, immutable record of WHO published WHAT is the row itself:
 * `canonical_controls.published_by_user_id` / `published_at` and
 * `canonical_control_crosswalk.approved_by_user_id` / `approved_at`, all frozen
 * by the publication guards. On top of that, an --apply run — and a REFUSED
 * --apply run, which is the security-relevant one — writes a platform-level
 * `security_audit_log` event here, at the operator boundary that performs the
 * act, using the same elevated pool. A DRY RUN writes none: it changed nothing.
 */

import { pgElevated } from "../src/api/infra/postgres.js";
import { writeAuditEventAwaited } from "../src/api/lib/auditLog.js";
import { publishCanonicalControls } from "../src/api/lib/controls/canonicalControlPublisher.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const apply = process.argv.includes("--apply");
const publisherId = arg("publisher-id");
const publisherEmail = arg("publisher-email");

if (publisherId === undefined && publisherEmail === undefined) {
  console.error(
    "Publication must name a human. Pass --publisher-email <email> or --publisher-id <uuid>."
  );
  process.exit(1);
}

let resolvedId = publisherId;
if (resolvedId === undefined) {
  const r = await pgElevated.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = lower($1)`,
    [publisherEmail]
  );
  if (r.rowCount === 0) {
    console.error(`No user with email ${publisherEmail}.`);
    await pgElevated.end();
    process.exit(1);
  }
  resolvedId = r.rows[0]!.id;
}

let result;
try {
  result = await publishCanonicalControls(pgElevated, {
    publishedByUserId: resolvedId,
    apply,
  });
} catch (err) {
  // Includes the fail-closed refusal. Nothing was committed in either case.
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  if (apply) {
    // An attempted publication that was refused is worth a durable record: it
    // says someone tried to publish over content whose meaning was in question.
    await writeAuditEventAwaited({
      organizationId: null,
      actorUserId: resolvedId,
      eventType: "canonical_control.publication_refused",
      resourceType: "canonical_controls",
      payload: { reason: message.slice(0, 500) },
    });
  }
  await pgElevated.end();
  process.exit(2);
}

if (apply) {
  const landed = await writeAuditEventAwaited({
    organizationId: null,
    actorUserId: resolvedId,
    eventType: "canonical_control.published",
    resourceType: "canonical_controls",
    payload: {
      corpus_version: result.corpus_version,
      controls_published: result.controls_published,
      aliases_inserted: result.aliases_inserted,
      crosswalk_published: result.crosswalk_published,
    },
  });
  if (!landed) {
    // Say so rather than imply an audit row exists. The publication itself is
    // committed and its own rows still name the publisher.
    console.error(
      "WARNING: the publication committed but its security_audit_log row did NOT land."
    );
  }
}

console.log(JSON.stringify(result, null, 2));
console.log(
  apply
    ? "APPLIED — the corpus is published."
    : "DRY RUN — every statement ran and was rolled back. Re-run with --apply to commit."
);

await pgElevated.end();

const ambiguities =
  result.drift.length + result.crosswalk_drift.length + result.alias_conflicts.length;
if (ambiguities > 0) {
  // Reachable on a DRY RUN only — an --apply run with findings throws above.
  console.error(
    `\n${result.drift.length} drifted canonical control field(s), ` +
      `${result.crosswalk_drift.length} drifted crosswalk field(s) and ` +
      `${result.alias_conflicts.length} alias identity conflict(s). --apply would REFUSE ` +
      "to publish. Published content is frozen — resolve each with a superseding row."
  );
  process.exit(2);
}
