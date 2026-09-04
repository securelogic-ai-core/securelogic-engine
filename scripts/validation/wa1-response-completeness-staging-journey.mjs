// wa1-response-completeness-staging-journey.mjs — WA-1 against DEPLOYED staging,
// driven through the REAL vendor portal in a REAL browser.
//
//   APP_URL=... ENGINE_URL=... E2E_EMAIL=... E2E_PASSWORD=... \
//   node wa1-response-completeness-staging-journey.mjs [chromium|webkit]
//
// ── What this proves, and why it is a browser test at all ───────────────────
//
// The engine's submit gate is already proven against real Postgres
// (test/isolation/vendorPortalResponseCompleteness.test.ts, 15 cases). What a
// unit or API test CANNOT prove is the half of WA-1 that is a product: that a
// responder is TOLD an explanation is needed at the moment they answer, that
// the review screen names which questions are blocked and why, and that the
// attach control the whole package exists for is actually reachable beside the
// question. Those are rendered, hydrated, client-state facts.
//
// The owner walkthrough that produced this package submitted 37 answers with 0
// explanations and 0 artifacts THROUGH THIS UI, so the UI is exactly where the
// proof has to land.
//
// ── Setup is via the API, deliberately ─────────────────────────────────────
//
// Vendor / relationship / intake / composition / issuance are already covered
// end to end by assessment-composition-staging-journey.mjs in the browser.
// Repeating them here would burn the per-JWT rate limit (see the app-fan-out
// note in that script) and prove nothing new. Setup is therefore API; every
// WA-1 ASSERTION is browser.

import { chromium, webkit } from "playwright";
import fs from "node:fs";

const APP = process.env.APP_URL ?? "https://securelogic-app-staging.onrender.com";
const ENGINE = process.env.ENGINE_URL ?? "https://securelogic-engine-staging.onrender.com";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const RECIPIENT = process.env.E2E_RECIPIENT ?? "delivered@resend.dev";
const STAMP = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const OUT = process.env.OUT_DIR ?? ".";
const BROWSER = (process.argv[2] ?? "chromium").toLowerCase();

const ledger = [];
let fails = 0;
const ok = (m) => { ledger.push(`PASS  ${m}`); console.log("PASS ", m); };
const bad = (m, d = "") => { fails++; ledger.push(`FAIL  ${m} :: ${String(d).slice(0, 300)}`); console.log("FAIL ", m, String(d).slice(0, 300)); };
const shot = async (p, n) => { try { await p.screenshot({ path: `${OUT}/${STAMP}-wa1-${BROWSER}-${n}.png`, fullPage: true }); } catch {} };

let TOK = null;
const engine = (path, opts = {}) =>
  fetch(`${ENGINE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(TOK ? { Authorization: `Bearer ${TOK}` } : {}),
      ...(opts.headers ?? {}),
    },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** Everything the browser part needs: an ISSUED engagement and its secure link. */
async function setup() {
  TOK = (await engine("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).body.token;
  if (!TOK) throw new Error("login failed");

  const v = await engine("/api/vendors", {
    method: "POST",
    body: JSON.stringify({
      name: `WA1 journey ${STAMP}`,
      category: "Payment Processing",
      service_description: "Card acquiring",
      data_sensitivity: "restricted",
      access_level: "read_write",
      website: "https://example.test",
    }),
  });
  const vendorId = v.body.vendor?.id;
  if (!vendorId) throw new Error(`vendor create failed: ${JSON.stringify(v.body)}`);

  const r = await engine(`/api/vendors/${vendorId}/relationships`, {
    method: "POST",
    body: JSON.stringify({ name: "Card processing", service_description: "Online card acquiring" }),
  });
  const relationshipId = r.body.relationship?.id;

  // A MODERATE-exposure relationship on purpose (tier_3, ~23 questions rather
  // than the ~79 a tier_1 payments relationship composes to). The portal's
  // DB-backed limiter is 120 requests per minute PER SESSION
  // (requirePortalSession.ts), and answering 79 questions plus the reads around
  // them walks straight into it — a rate-limited run would report a product
  // failure that is really a harness failure. Composition breadth is proven by
  // the composition journey; what this script needs is enough questions to
  // answer, not the widest possible set.
  await engine(`/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
    method: "POST",
    body: JSON.stringify({
      max_tolerable_disruption: "1_week_to_1_month", operational_dependency: "supporting",
      business_reach: "single_function", substitutability: "replaceable_weeks",
      process_coupling: "peripheral", concentration: "low",
      data_sensitivity: "internal", data_volume: "minimal", access_level: "read_only",
      regulatory_exposure: "low", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "low",
    }),
  });

  const c = await engine(`/api/vendors/${vendorId}/contacts`, {
    method: "POST",
    body: JSON.stringify({ full_name: "Jane Okafor", email: RECIPIENT, title: "CISO", contact_role: "security", is_primary_contact: true }),
  });
  const contactId = c.body.contact?.id;

  const e = await engine("/api/vendor-engagements", {
    method: "POST",
    body: JSON.stringify({ vendor_id: vendorId, relationship_id: relationshipId, engagement_type: "initial", title: `WA1 journey ${STAMP}` }),
  });
  const engagementId = e.body.id;
  await engine(`/api/vendor-engagements/${engagementId}/scope`, { method: "POST", body: JSON.stringify({}) });

  const issued = await engine(`/api/vendor-engagements/${engagementId}/issue`, {
    method: "POST",
    body: JSON.stringify({ contact_id: contactId, message: `WA1 journey ${STAMP}.` }),
  });
  const token = issued.body.invite_token ?? issued.body.token;
  if (!token) throw new Error(`issue failed: ${JSON.stringify(issued.body).slice(0, 400)}`);
  return { vendorId, engagementId, acceptUrl: `${APP}/portal/accept/${token}` };
}

async function main() {
  const { vendorId, engagementId, acceptUrl } = await setup();
  ok(`setup: engagement ${engagementId} issued (API)`);

  const browser = await (BROWSER === "webkit" ? webkit : chromium).launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ── 1. Vendor opens the secure link ──
  //
  // Wait for the EXCHANGE, not merely for a /portal URL. `/portal/accept/<token>`
  // already matches `/\/portal(\/|$)/`, so that pattern is satisfied by the page
  // we are standing on and returns before the client-side POST has run — the
  // next navigation then races it and lands on "Secure link required". On
  // success AcceptClient does `router.replace("/portal")`, so the honest signal
  // is the bare /portal path.
  await page.goto(acceptUrl);
  await page.waitForURL(/\/portal\/?$/, { timeout: 60_000 });
  ok(`vendor: invitation exchanged for a portal session (${BROWSER})`);

  // Let the shell's own engagement fetch FINISH before navigating away.
  //
  // Landing on /portal starts PortalShell's GET /api/vendor-portal/engagement;
  // navigating immediately cancels it, and WebKit reports a cancelled fetch as
  // a PAGEERROR ("Fetch API cannot load … due to access control checks") while
  // Chromium reports nothing. That made the no-client-exceptions assertion
  // FLAKY — it failed one WebKit run and passed the next on identical code,
  // which is the worst kind of validation signal. Settling here removes the
  // cause instead of filtering the symptom, so the assertion stays strict and
  // a real client-side exception still fails the run.
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.goto(`${APP}/portal/questionnaire`);
  const fieldsets = page.locator("fieldset");
  await fieldsets.first().waitFor({ timeout: 60_000 });
  const qCount = await fieldsets.count();
  qCount > 0 ? ok(`vendor: questionnaire rendered with ${qCount} questions`) : bad("no questions rendered");
  await shot(page, "01-questionnaire");

  // ── 2. WA-1: the attach control exists AT the question ──
  //
  // This is the gap the package was opened for: before WA-1 the questionnaire
  // page contained the string "evidence" zero times.
  const attachInputs = await page.locator('input[type="file"]').count();
  attachInputs === qCount
    ? ok(`WA-1: an evidence attach control on every question (${attachInputs})`)
    : bad("attach controls per question", `${attachInputs} of ${qCount}`);
  (await page.getByText(/Supporting evidence/i).count()) > 0
    ? ok("WA-1: evidence is labelled at the question")
    : bad("no per-question evidence label");

  // ── 3. WA-1: nothing is demanded before an answer exists ──
  (await page.getByText(/An explanation is required/i).count()) === 0
    ? ok("WA-1: no explanation demanded before the vendor has answered anything")
    : bad("form opens already demanding explanations");

  // ── 4. WA-1: choosing a negative answer prompts immediately (optimistic) ──
  const first = fieldsets.nth(0);
  await first.getByRole("button", { name: "Partially in place", exact: true }).click();
  await page.getByText(/An explanation is required before this questionnaire can be submitted/i)
    .first().waitFor({ timeout: 20_000 })
    .then(() => ok("WA-1: 'Partially in place' prompts for an explanation on the click"))
    .catch((e) => bad("no explanation prompt after a partial answer", e));
  (await page.getByPlaceholder(/Describe what is in place and what is not/i).count()) > 0
    ? ok("WA-1: the prompt is answer-specific, not a generic 'add notes'")
    : bad("generic notes placeholder");
  (await page.getByText(/Explanation \(required\)/i).count()) > 0
    ? ok("WA-1: the field is labelled required")
    : bad("field not labelled required");
  await shot(page, "02-explanation-prompt");

  // Answer everything else affirmatively so ONLY the explanation blocks.
  for (let i = 1; i < qCount; i++) {
    await fieldsets.nth(i).getByRole("button", { name: "In place", exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2500);
  ok("vendor: remaining questions answered 'In place'");

  // ── 5. WA-1: the review screen names the blocker, and Submit is refused ──
  await page.goto(`${APP}/portal/review`);
  const submit = page.getByRole("button", { name: "Submit responses", exact: true });
  await submit.waitFor({ timeout: 60_000 });
  (await submit.isDisabled())
    ? ok("WA-1: Submit is disabled while an answer is unexplained")
    : bad("Submit enabled with an unexplained answer");
  (await page.getByText(/1 answer without an explanation/i).count()) > 0
    ? ok("WA-1: review names the count of unexplained answers")
    : bad("review headline", (await page.textContent("body")).slice(0, 300));
  (await page.getByText(/Needs an explanation/i).count()) > 0
    ? ok("WA-1: review names the REASON per item (not just 'incomplete')")
    : bad("no per-item reason");
  (await page.getByText(/Needs an answer/i).count()) === 0
    ? ok("WA-1: an answered-but-unexplained item is not mislabelled 'unanswered'")
    : bad("unexplained item reported as unanswered");
  await shot(page, "03-review-blocked");

  // ── 5b. The ENGINE refuses it too, with the additive 422 ──
  //
  // The disabled button is a courtesy; the gate is the engine. Proven from the
  // browser's own session so it is the same credential, not a side channel.
  const refusal = await page.evaluate(async () => {
    const r = await fetch("/api/vendor-portal/submit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  refusal.status === 422 && refusal.body.error === "incomplete" && refusal.body.explanations_missing === 1
    ? ok(`WA-1: engine refuses the submission 422 (explanations_missing=1, unanswered_required=${refusal.body.unanswered_required})`)
    : bad("engine did not refuse as expected", JSON.stringify(refusal));
  Array.isArray(refusal.body.items) && refusal.body.items[0]?.reason === "explanation_missing"
    ? ok("WA-1: the refusal names the exact item and reason")
    : bad("refusal items", JSON.stringify(refusal.body.items));

  // ── 6. WA-1: typing the explanation clears the block ──
  await page.goto(`${APP}/portal/questionnaire`);
  await fieldsets.first().waitFor({ timeout: 60_000 });
  const ta = page.getByPlaceholder(/Describe what is in place and what is not/i).first();
  await ta.fill("MFA is enforced for administrators only; standard users are scheduled for Q3.");
  await page.getByRole("button", { name: "Save explanation" }).first().click();
  await page.waitForTimeout(2500);
  (await page.getByText(/An explanation is required/i).count()) === 0
    ? ok("WA-1: the prompt clears once an explanation is present")
    : bad("prompt persists after an explanation was saved");
  await shot(page, "04-explained");

  // ── 7. WA-1: attach evidence AT the question, through the canonical path ──
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: `wa1-${STAMP}.pdf`, mimeType: "application/pdf", buffer: pdf,
  });
  await page.getByText(`wa1-${STAMP}.pdf`).first().waitFor({ timeout: 60_000 })
    .then(() => ok("WA-1: evidence attached AT the question and listed there"))
    .catch((e) => bad("attachment not listed at the question", e));
  await shot(page, "05-evidence-attached");

  // It landed on the CANONICAL evidence spine at the engagement x requirement
  // grain — not in some portal-only attachment store.
  const ev = await engine(`/api/vendor-engagements/${engagementId}/evidence`);
  const row = (ev.body.evidence ?? []).find((f) => (f.original_filename ?? "").includes(STAMP));
  row?.requirement_id
    ? ok(`WA-1: the artifact is on the canonical evidence spine, bound to requirement ${String(row.requirement_id).slice(0, 8)}…`)
    : bad("evidence not on the canonical spine with a requirement", JSON.stringify(ev.body).slice(0, 300));

  // ── 8. Submit now succeeds ──
  await page.goto(`${APP}/portal/review`);
  const submit2 = page.getByRole("button", { name: "Submit responses", exact: true });
  await submit2.waitFor({ timeout: 60_000 });
  (await submit2.isEnabled())
    ? ok("WA-1: Submit is enabled once everything required is complete")
    : bad("Submit still disabled", (await page.textContent("body")).slice(0, 300));
  await submit2.click();
  await page.waitForURL(/\/portal\/done/, { timeout: 60_000 }).catch(() => {});
  /\/portal\/done/.test(page.url())
    ? ok("vendor: responses submitted")
    : bad("submit did not complete", page.url());
  await shot(page, "06-submitted");

  // The explanation is on the record the reviewer reads, not just in the UI.
  const resp = await engine(`/api/vendor-engagements/${engagementId}/responses`);
  const partial = (resp.body.items ?? []).find((i) => i.response?.status === "partial");
  partial?.response?.notes?.includes("administrators only")
    ? ok("customer side: the vendor's explanation is on the response record")
    : bad("explanation missing from the response record", JSON.stringify(partial?.response ?? {}).slice(0, 200));

  // ── 9. Ruling 6: authorization ends at analysis_complete, engagement-scoped ──
  const stillLive = await page.evaluate(async () => (await fetch("/api/vendor-portal/questions")).status);
  stillLive === 200
    ? ok("ruling 6: the vendor can still READ between submit and conclusion (the clarification window)")
    : bad("vendor lost read access too early", String(stillLive));

  await engine(`/api/vendor-engagements/${engagementId}/begin-review`, { method: "POST", body: "{}" });
  const done = await engine(`/api/vendor-engagements/${engagementId}/complete-analysis`, { method: "POST", body: "{}" });
  done.status === 200 && done.body.portal_access_revoked?.invites >= 1 && done.body.portal_access_revoked?.sessions >= 1
    ? ok(`ruling 6: concluding the engagement revoked ${done.body.portal_access_revoked.invites} invite(s) and ${done.body.portal_access_revoked.sessions} session(s)`)
    : bad("analysis_complete did not revoke portal access", JSON.stringify(done.body).slice(0, 300));

  const afterwards = await page.evaluate(async () => (await fetch("/api/vendor-portal/questions")).status);
  afterwards === 401
    ? ok("ruling 6: the vendor's live browser session stops working immediately (401)")
    : bad("vendor session still authenticated after conclusion", String(afterwards));
  await shot(page, "07-access-revoked");

  pageErrors.length === 0
    ? ok(`no client-side exceptions (${BROWSER})`)
    : bad(`client-side exceptions (${BROWSER})`, pageErrors.join(" | "));

  await browser.close();
  console.log("\n" + ledger.join("\n"));
  console.log(`\nBROWSER=${BROWSER} PASS=${ledger.length - fails} FAIL=${fails} vendor=${vendorId} engagement=${engagementId}`);
  fs.writeFileSync(`${OUT}/${STAMP}-wa1-${BROWSER}.txt`, ledger.join("\n") + `\nvendor=${vendorId} engagement=${engagementId}\n`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("JOURNEY CRASHED", e); process.exit(2); });
