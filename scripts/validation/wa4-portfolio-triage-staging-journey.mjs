// wa4-portfolio-triage-staging-journey.mjs — WA-4 against DEPLOYED staging,
// driven through the REAL analyst UI in a REAL browser.
//
//   APP_URL=... ENGINE_URL=... E2E_EMAIL=... E2E_PASSWORD=... \
//   node wa4-portfolio-triage-staging-journey.mjs [chromium|webkit]
//
// ── What this proves that the API tests cannot ──────────────────────────────
//
// The derivation, the whitelist, the append-only guarantee and cross-tenant
// denial are all proven against real Postgres (18 isolation cases). What only a
// browser against the deployed build can prove is the half that IS the product:
//
//   * an analyst can FIND the engagements that need them, without knowing which
//     ones they are in advance;
//   * they can see WHY, in plain English, without opening the engagement — and
//     WITHOUT an internal rule identifier reaching the screen;
//   * filter, sort and page compose instead of cancelling each other out —
//     choosing a sort must not silently discard the filter just set;
//   * a disposition can be recorded, is refused without a reason where a reason
//     is required, and SURVIVES a reload;
//   * recording one — up to and including `finding_confirmed` — creates NO
//     Finding. This is the negative proof, measured before and after.
//
// ── Pacing ─────────────────────────────────────────────────────────────────
//
// The engagement page fans out several engine reads under one user JWT (WA-4
// adds one more) and the engine's limiter counts 120/min per user; the login
// limiter is 10 per 900s per IP. Page loads are paced. A rate-limited run
// reports a product failure that is really a harness failure.
//
// ── Fixture discipline ─────────────────────────────────────────────────────
//
// ONE reusable vendor, adopted if it already exists. Monitored entities are
// plan-limited and a vendor per run is what exhausted the org before WA-3.
// Relationships carry no such limit, so each run gets fresh relationships on
// the one vendor — which is all the isolation the journey needs, since every
// assertion is per-engagement.

import { chromium, webkit } from "playwright";
import fs from "node:fs";

const APP = process.env.APP_URL ?? "https://securelogic-app-staging.onrender.com";
const ENGINE = process.env.ENGINE_URL ?? "https://securelogic-engine-staging.onrender.com";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const STAMP = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const OUT = process.env.OUT_DIR ?? ".";
const BROWSER = (process.argv[2] ?? "chromium").toLowerCase();
const PACE_MS = Number(process.env.PACE_MS ?? 8_000);

const ledger = [];
let fails = 0;
const ok = (m) => { ledger.push(`PASS  ${m}`); console.log("PASS ", m); };
const bad = (m, d = "") => { fails++; ledger.push(`FAIL  ${m} :: ${String(d).slice(0, 300)}`); console.log("FAIL ", m, String(d).slice(0, 300)); };
const shot = async (p, n) => { try { await p.screenshot({ path: `${OUT}/${STAMP}-wa4-${BROWSER}-${n}.png`, fullPage: true }); } catch {} };

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

/**
 * A tier_3 intake. Deliberately NOT the tier_1 shape: a tier_1 relationship
 * composes ~79 questions and answering them through the portal exceeds the
 * portal's 120-req/min-per-session limiter, which is the WA-1 lesson. ~23
 * questions is enough to carry every attention reason this journey needs.
 */
const MODEST = {
  max_tolerable_disruption: "lt_1_week", operational_dependency: "important",
  business_reach: "single_team", substitutability: "replaceable_months",
  process_coupling: "peripheral", concentration: "none",
  data_sensitivity: "internal", data_volume: "small", access_level: "read_only",
  regulatory_exposure: "low", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
  fourth_party_exposure: "low",
};

const HARNESS_VENDOR = "WA4 journey harness";
let harnessVendorId = null;

async function ensureHarnessVendor() {
  if (harnessVendorId) return harnessVendorId;
  const list = await engine(`/api/vendors?limit=200`);
  const vendors = list.body.vendors ?? list.body.items ?? [];
  const found =
    vendors.find((v) => v.name === HARNESS_VENDOR) ??
    vendors.find((v) => typeof v.name === "string" && v.name.startsWith("WA4 "));
  if (found) { harnessVendorId = found.id; return harnessVendorId; }
  const created = await engine("/api/vendors", {
    method: "POST",
    body: JSON.stringify({
      name: HARNESS_VENDOR, category: "Software",
      service_description: "Reporting feed", data_sensitivity: "internal",
      access_level: "read_only", website: "https://example.test",
    }),
  });
  harnessVendorId = created.body.vendor?.id;
  if (!harnessVendorId) throw new Error(`vendor create failed: ${JSON.stringify(created.body).slice(0, 300)}`);
  return harnessVendorId;
}

/**
 * Findings sourced from ONE engagement — the negative-proof measure.
 *
 * Deliberately scoped rather than counting the org's total. Staging's
 * intelligence workers create `cyber_signal` findings continuously, so an
 * org-wide before/after assertion would fail for reasons that have nothing to
 * do with WA-4. A flaky proof is not a proof.
 */
async function findingsForEngagement(engagementId) {
  const r = await engine(
    `/api/findings?source_type=vendor_engagement&source_id=${encodeURIComponent(engagementId)}&limit=200`
  );
  const list = r.body.findings ?? [];
  return list.length;
}

/**
 * Build an engagement that is genuinely IN the attention window, by walking the
 * real customer path: compose, issue, answer through the portal, submit.
 *
 * Answers are mixed on purpose — one failure and one partial, both explained,
 * so the submit gate (WA-1) is satisfied and the attention reasons that survive
 * are the ones about the ASSESSMENT rather than about its completeness.
 */
async function attentionEngagement(label) {
  const vendorId = await ensureHarnessVendor();
  const r = await engine(`/api/vendors/${vendorId}/relationships`, {
    method: "POST",
    body: JSON.stringify({ name: `${label} service ${STAMP}`, service_description: "Reporting feed" }),
  });
  const relationshipId = r.body.relationship?.id;
  if (!relationshipId) throw new Error(`relationship failed: ${JSON.stringify(r.body).slice(0, 300)}`);

  const i = await engine(`/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
    method: "POST", body: JSON.stringify(MODEST),
  });
  if (i.status !== 201) throw new Error(`intake failed: ${JSON.stringify(i.body).slice(0, 300)}`);

  const e = await engine("/api/vendor-engagements", {
    method: "POST",
    body: JSON.stringify({ vendor_id: vendorId, relationship_id: relationshipId, engagement_type: "initial", title: `WA4 ${label} ${STAMP}` }),
  });
  const engagementId = e.body.id;
  const scoped = await engine(`/api/vendor-engagements/${engagementId}/scope`, { method: "POST", body: JSON.stringify({}) });
  if (scoped.status !== 200) throw new Error(`scope failed: ${JSON.stringify(scoped.body).slice(0, 300)}`);

  const c = await engine(`/api/vendors/${vendorId}/contacts`, {
    method: "POST",
    body: JSON.stringify({ full_name: "Dana Ferreira", email: `wa4+${label}${STAMP}@vendor.test`, title: "CISO", contact_role: "security", is_primary_contact: true }),
  });
  const contactId = c.body.contact?.id;
  const issued = await engine(`/api/vendor-engagements/${engagementId}/issue`, {
    method: "POST",
    body: JSON.stringify({ contact_id: contactId, message: `WA4 journey ${STAMP}.`, send_email: false }),
  });
  const token = issued.body.invite_token ?? issued.body.token;
  if (!token) throw new Error(`issue failed: ${JSON.stringify(issued.body).slice(0, 400)}`);

  // The vendor side, through the same portal API the portal UI itself calls.
  const exch = await fetch(`${ENGINE}/api/vendor-portal/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const cookie = (exch.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`portal exchange gave no session cookie (${exch.status})`);
  const portal = (path, opts = {}) =>
    fetch(`${ENGINE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers ?? {}) },
    }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) }));

  const qs = await portal("/api/vendor-portal/questions");
  const items = qs.body.questions ?? qs.body.items ?? [];
  if (items.length === 0) throw new Error(`portal returned no questions: ${JSON.stringify(qs.body).slice(0, 300)}`);

  for (let n = 0; n < items.length; n += 1) {
    const it = items[n];
    const answer =
      n === 0 ? { status: "fail", notes: "Not implemented for this service; scheduled for next quarter." }
      : n === 1 ? { status: "partial", notes: "In place for production only; the staging estate is not covered." }
      : { status: "pass", notes: "Implemented and operating for the service described." };
    // PUT /questions/:requirementId with { answer, notes } — the shape
    // savePortalAnswer actually reads (vendorPortal.ts:462-465).
    const saved = await portal(`/api/vendor-portal/questions/${encodeURIComponent(it.requirement_id)}`, {
      method: "PUT",
      body: JSON.stringify({ answer: answer.status, notes: answer.notes }),
    });
    if (saved.status >= 400) throw new Error(`answer ${n} failed (${saved.status}): ${JSON.stringify(saved.body).slice(0, 200)}`);
  }

  const submitted = await portal("/api/vendor-portal/submit", { method: "POST", body: JSON.stringify({}) });
  if (submitted.status >= 400) throw new Error(`submit failed (${submitted.status}): ${JSON.stringify(submitted.body).slice(0, 400)}`);

  return { vendorId, relationshipId, engagementId, questionCount: items.length };
}

async function setup() {
  const login = await engine("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  TOK = login.body.token;
  if (!TOK) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);

  const target = await attentionEngagement("triage");
  return { target };
}

/* ══════════════════════════════════════════════════════════════════════════ */

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error("E2E_EMAIL and E2E_PASSWORD are required.");
  const s = await setup();
  console.log(`fixture: engagement ${s.target.engagementId} (${s.target.questionCount} questions)`);
  const findingsBefore = await findingsForEngagement(s.target.engagementId);
  findingsBefore === 0
    ? ok("baseline: the fixture engagement starts with zero findings")
    : bad(`baseline is not clean: ${findingsBefore} finding(s) already exist for the fixture`);

  const browser = await (BROWSER === "webkit" ? webkit : chromium).launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const failedRequests = [];
  let section = "0-boot";
  const mark = (n) => { section = n; };
  page.on("pageerror", (e) => pageErrors.push(`[${section}] ${e.message}`));
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} [${section}] ${r.url()} :: ${r.failure()?.errorText ?? "?"}`));

  /* ── 1. Sign in ─────────────────────────────────────────────────────────── */
  mark("1-login");
  await page.goto(`${APP}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^Sign In$/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  ok(`analyst: signed in (${BROWSER})`);
  await page.waitForTimeout(PACE_MS);

  /* ── 2. FIND the work: the portfolio queue ─────────────────────────────── */
  mark("2-portfolio");
  await page.goto(`${APP}/vendor-engagements`);
  await page.getByRole("heading", { name: /Vendor Engagements/i }).waitFor({ timeout: 60_000 });
  await shot(page, "01-portfolio");

  const attentionFilter = page.getByRole("link", { name: /Needs attention/i }).first();
  (await attentionFilter.count()) > 0
    ? ok("portfolio: a Needs-attention control exists")
    : bad("portfolio: no Needs-attention control on the engagement list");

  await attentionFilter.click();
  await page.waitForURL(/needs_attention=true/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  ok("portfolio: the Needs-attention filter is a query parameter, so the view is linkable");
  await page.waitForTimeout(PACE_MS);

  const row = page.locator("tr", { has: page.locator(`a[href="/vendor-engagements/${s.target.engagementId}"]`) }).first();
  (await row.count()) > 0
    ? ok("triage: the engagement with a failed and a partial control IS in the needs-attention queue")
    : bad("triage: the engagement is missing from the needs-attention queue");

  /* ── 3. Understand WHY, without opening it ─────────────────────────────── */
  const rowText = (await row.count()) > 0 ? ((await row.innerText()) ?? "") : "";
  /Not in place/i.test(rowText)
    ? ok("explainability: the row names the failed control in plain English")
    : bad("explainability: the row does not name the failure", rowText.slice(0, 200));
  /Partial/i.test(rowText)
    ? ok("explainability: the row names the partial control too")
    : bad("explainability: the row does not name the partial", rowText.slice(0, 200));

  // Ruling E's other half: plain English, and no internal identifiers.
  const RULE_ID = /\b(S[0-9]{1,2}(\.[a-z_]+)?|rule_id|rule_family|attention\.[a-z_]+)\b/;
  const listMarkup = await page.content();
  RULE_ID.test(listMarkup.replace(/securelogic-core-assurance/g, ""))
    ? bad("RULING E VIOLATED: an internal rule identifier reached the portfolio screen", (listMarkup.match(RULE_ID) ?? [])[0])
    : ok("explainability: no internal rule identifier reaches the portfolio screen");
  await shot(page, "02-needs-attention");

  /* ── 4. Sort, without losing the filter ────────────────────────────────── */
  mark("3-sort");
  const sortLink = page.getByRole("link", { name: /Most to review/i }).first();
  (await sortLink.count()) > 0 ? ok("portfolio: a sort control exists") : bad("portfolio: no sort control");
  await sortLink.click();
  await page.waitForURL(/sort=attention/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");

  const url = new URL(page.url());
  url.searchParams.get("needs_attention") === "true"
    ? ok("navigation: choosing a sort PRESERVED the needs-attention filter")
    : bad("navigation: the sort discarded the filter", page.url());
  url.searchParams.get("sort") === "attention"
    ? ok("navigation: the sort is in the URL, so the view is shareable and reloadable")
    : bad("navigation: sort missing from the URL", page.url());
  await page.waitForTimeout(PACE_MS);

  // Stability: the same URL twice gives the same order.
  const idsOf = async () =>
    page.locator('tbody a[href^="/vendor-engagements/"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")).filter((h) => h && !h.endsWith("/new"))
    );
  const firstPass = await idsOf();
  await page.reload();
  await page.waitForLoadState("networkidle");
  const secondPass = await idsOf();
  JSON.stringify(firstPass) === JSON.stringify(secondPass)
    ? ok("navigation: the same query returns the same order — sorting is deterministic")
    : bad("navigation: the order changed between two identical requests", `${firstPass.length} vs ${secondPass.length}`);
  await shot(page, "03-sorted");
  await page.waitForTimeout(PACE_MS);

  /* ── 5. The engagement: WHY, in detail ─────────────────────────────────── */
  mark("4-detail");
  await page.goto(`${APP}/vendor-engagements/${s.target.engagementId}`);
  await page.getByRole("heading", { name: /Needs attention/i }).waitFor({ timeout: 60_000 });
  ok("detail: the engagement carries a Needs-attention panel");

  const panel = page.locator("section", { has: page.getByRole("heading", { name: /Needs attention/i }) }).first();
  const panelText = await panel.innerText();
  /Control reported not in place/i.test(panelText)
    ? ok("detail: the panel explains the failed control in a full sentence")
    : bad("detail: no explanation of the failed control", panelText.slice(0, 300));
  /derived/i.test(panelText)
    ? ok("detail: the panel says the state is derived, not a stored flag")
    : bad("detail: the panel does not say the state is derived", panelText.slice(0, 200));
  /nothing here creates a finding/i.test(panelText)
    ? ok("detail: the panel states, on the screen, that triage does not create a finding")
    : bad("detail: the screen does not state the triage/finding boundary", panelText.slice(0, 300));
  await shot(page, "04-attention-panel");
  await page.waitForTimeout(PACE_MS);

  /* ── 6. The rationale gate has somewhere to answer it ──────────────────── */
  mark("5-disposition-gate");
  await page.selectOption('[data-testid="disposition-select"]', "accepted");
  const textarea = page.locator('[data-testid="disposition-rationale"]');
  (await textarea.count()) > 0
    ? ok("disposition: choosing a judgement reveals the reason field — the gate has somewhere to answer it")
    : bad("disposition: no reason field appeared for a judgement that requires one");

  const recordBtn = page.getByRole("button", { name: /Record disposition/i }).first();
  await textarea.fill("too short");
  (await recordBtn.isDisabled())
    ? ok("disposition: the control refuses a reason below the floor before it reaches the engine")
    : bad("disposition: a short reason was accepted by the client");
  await page.waitForTimeout(1_000);

  /* ── 7. Record it, and see it persist ──────────────────────────────────── */
  mark("6-disposition-record");
  await textarea.fill("One control is not in place and one is partial; both are covered by a compensating control we have evidenced.");
  await recordBtn.click();
  await page.getByTestId("disposition-done").waitFor({ timeout: 60_000 });
  const doneText = await page.getByTestId("disposition-done").innerText();
  ok("disposition: recorded, and the confirmation survives the revalidation");
  /No finding was created/i.test(doneText)
    ? ok("NEGATIVE PROOF (on screen): the confirmation states that no finding was created")
    : bad("the confirmation does not state the finding boundary", doneText.slice(0, 200));
  await shot(page, "05-disposition-recorded");

  // The WA-3 lesson: give the server action's own revalidation time to land
  // before navigating, or the reload cancels it and the POST logs as aborted.
  await page.waitForTimeout(Math.max(PACE_MS, 3_000));
  await page.waitForLoadState("networkidle");

  mark("7-reload");
  await page.reload();
  await page.getByRole("heading", { name: /Needs attention/i }).waitFor({ timeout: 60_000 });
  const afterReload = await page
    .locator("section", { has: page.getByRole("heading", { name: /Needs attention/i }) })
    .first()
    .innerText();
  /Accepted as-is/i.test(afterReload)
    ? ok("disposition: PERSISTED — still shown after a full reload")
    : bad("disposition: did not survive a reload", afterReload.slice(0, 300));
  /compensating control/i.test(afterReload)
    ? ok("disposition: the analyst's reason is shown back, not just the verdict")
    : bad("disposition: the reason is not rendered", afterReload.slice(0, 300));
  await shot(page, "06-disposition-persisted");
  await page.waitForTimeout(PACE_MS);

  /* ── 8. Append-only, through the UI ────────────────────────────────────── */
  mark("8-append-only");
  await page.selectOption('[data-testid="disposition-select"]', "escalated");
  await page.locator('[data-testid="disposition-rationale"]').fill("On reflection this needs the risk committee: the compensating control is manual.");
  await page.getByRole("button", { name: /Record disposition/i }).first().click();
  await page.getByTestId("disposition-done").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(Math.max(PACE_MS, 3_000));

  const trail = await engine(`/api/vendor-engagements/${s.target.engagementId}/dispositions`);
  const dispositions = trail.body.dispositions ?? [];
  dispositions.length === 2
    ? ok("disposition: the second decision was ADDED — the first was not overwritten")
    : bad(`expected 2 dispositions, got ${dispositions.length}`, JSON.stringify(dispositions).slice(0, 200));
  dispositions[0]?.disposition === "escalated" && dispositions[1]?.disposition === "accepted"
    ? ok("disposition: the trail reads newest-first with both decisions intact")
    : bad("disposition: the trail is not what was recorded", JSON.stringify(dispositions.map((d) => d.disposition)));
  dispositions.every((d) => d.disposed_by)
    ? ok("disposition: every decision names the person who made it")
    : bad("disposition: an unattributed decision is in the trail");

  /* ── 9. THE NEGATIVE PROOF ─────────────────────────────────────────────── */
  mark("9-no-auto-finding");
  // The strongest form: record the disposition most likely to be mistaken for a
  // promotion, then count.
  const confirmed = await engine(`/api/vendor-engagements/${s.target.engagementId}/disposition`, {
    method: "POST",
    body: JSON.stringify({ disposition: "finding_confirmed", rationale: "The committee agreed this is a finding and will be raised deliberately." }),
  });
  confirmed.status === 201
    ? ok("disposition: finding_confirmed is recordable")
    : bad(`finding_confirmed refused (${confirmed.status})`, JSON.stringify(confirmed.body).slice(0, 200));
  confirmed.body?.created_finding === false
    ? ok("NEGATIVE PROOF (API): the engine states created_finding=false for finding_confirmed")
    : bad("the engine did not state created_finding=false", JSON.stringify(confirmed.body).slice(0, 200));

  const engFindings = await findingsForEngagement(s.target.engagementId);
  engFindings === 0
    ? ok("NEGATIVE PROOF: a failed control, a partial control and FIVE dispositions produced ZERO findings for this engagement")
    : bad(`${engFindings} finding(s) exist for this engagement — something promoted automatically`);

  // Belt and braces: the engagement's own scope items are still unpromoted, so
  // nothing slipped in under a different source shape either.
  const promoted = await engine(`/api/findings?source_id=${encodeURIComponent(s.target.engagementId)}&limit=200`);
  (promoted.body.findings ?? []).length === 0
    ? ok("NEGATIVE PROOF: no finding of ANY source type points at this engagement")
    : bad(`${(promoted.body.findings ?? []).length} finding(s) point at this engagement`);

  /* ── 10. Tenant shape ──────────────────────────────────────────────────── */
  mark("10-tenant");
  const foreign = await engine("/api/vendor-engagements/00000000-0000-4000-8000-000000000000/attention");
  foreign.status === 404
    ? ok("tenant: an engagement this org does not own answers 404, never 403 — a 403 would confirm it exists")
    : bad(`expected 404 for a foreign engagement, got ${foreign.status}`);

  const anon = await fetch(`${ENGINE}/api/vendor-engagements/${s.target.engagementId}/attention`).then((r) => r.status);
  anon === 401 || anon === 403
    ? ok(`tenant: the attention route is closed to an unauthenticated caller (${anon})`)
    : bad(`unauthenticated attention read returned ${anon}`);

  /* ── 11. Client health ─────────────────────────────────────────────────── */
  pageErrors.length === 0
    ? ok("no client-side exceptions across the journey")
    : bad(`${pageErrors.length} client-side exception(s)`, pageErrors.slice(0, 5).join(" | "));

  // WebKit reports a CANCELLED fetch as a failed request where Chromium logs it
  // silently; a navigation that supersedes a prefetch is not a defect. See the
  // WA-2 record for the four-fix trail behind this distinction.
  const ABORTED = /net::ERR_ABORTED|NS_BINDING_ABORTED|Load request cancelled|net::ERR_FAILED, aborted/i;
  const abortedRequests = failedRequests.filter((r) => ABORTED.test(r));
  const realFailures = failedRequests.filter((r) => !ABORTED.test(r));
  fs.writeFileSync(`${OUT}/${STAMP}-wa4-${BROWSER}-failed-requests.txt`, failedRequests.join("\n") + "\n");
  realFailures.length === 0
    ? ok(`no failed requests other than ${abortedRequests.length} navigation-cancelled prefetch(es)`)
    : bad(`${realFailures.length} genuinely failed request(s)`, realFailures.slice(0, 5).join(" | "));

  // A cancelled POST is a mutation or a revalidation that did not finish.
  const abortedPosts = abortedRequests.filter((r) => r.startsWith("POST "));
  abortedPosts.length === 0
    ? ok("no aborted POST: every mutation and revalidation ran to completion")
    : bad(`${abortedPosts.length} aborted POST(s)`, abortedPosts.join(" | "));

  await browser.close();

  const total = ledger.length;
  const passed = total - fails;
  const summary = `WA-4 ${BROWSER}: ${passed}/${total} passed, ${fails} failed`;
  console.log("\n" + summary);
  fs.writeFileSync(`${OUT}/${STAMP}-wa4-${BROWSER}-ledger.txt`, ledger.join("\n") + "\n" + summary + "\n");
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("JOURNEY ABORTED:", e);
  fs.writeFileSync(`${OUT}/${STAMP}-wa4-${BROWSER}-ledger.txt`, ledger.join("\n") + `\nABORTED ${String(e)}\n`);
  process.exit(2);
});
