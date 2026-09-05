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
  // Level names come from the real tables — MTD_LEVELS, CRITICALITY_DEPENDENCY_LEVELS
  // and DATA_VOLUME_BANDS. The first draft of this fixture invented
  // `lt_1_week` / `important` / `small`, which the intake correctly rejected as
  // `invalid`. Read the enum, do not guess it.
  max_tolerable_disruption: "1_week_to_1_month", operational_dependency: "supporting",
  business_reach: "single_team", substitutability: "replaceable_months",
  process_coupling: "peripheral", concentration: "none",
  data_sensitivity: "internal", data_volume: "minimal", access_level: "read_only",
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
async function attentionEngagement(label, { clean = false } = {}) {
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
    const PASS = { status: "pass", notes: "Implemented and operating for the service described." };
    const answer = clean
      ? PASS
      : n === 0 ? { status: "fail", notes: "Not implemented for this service; scheduled for next quarter." }
      : n === 1 ? { status: "partial", notes: "In place for production only; the staging estate is not covered." }
      : PASS;
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

/**
 * The monitored-entity count, read the way the product meters it.
 *
 * `enforceEntityLimit` counts rows that EXIST in `vendors` + `ai_systems` for
 * the org against one cap. There is no endpoint that exposes the number, so
 * the harness reconstructs it from the two list surfaces rather than asserting
 * it from a database it is not supposed to reach. Reported, never enforced —
 * the journey must not raise, bypass or weaken the cap to go green.
 */
async function monitoredEntities() {
  const v = await engine("/api/vendors?limit=200");
  const a = await engine("/api/ai-systems?limit=200");
  const vendors = Number(v.body.total ?? (v.body.vendors ?? []).length);
  const aiSystems = Number(a.body.count ?? (a.body.ai_systems ?? []).length);
  return { vendors, aiSystems, total: vendors + aiSystems };
}

async function setup() {
  const login = await engine("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  TOK = login.body.token;
  if (!TOK) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);

  const before = await monitoredEntities();
  const existing = await engine("/api/vendors?limit=200");
  const adopted = (existing.body.vendors ?? []).some(
    (v) => v.name === HARNESS_VENDOR || (typeof v.name === "string" && v.name.startsWith("WA4 "))
  );

  const target = await attentionEngagement("triage");
  // The negative control: same org, same window, same template — every answer
  // a `pass` that carries its explanation. If THIS lands in the queue, the
  // queue means nothing.
  const control = await attentionEngagement("control", { clean: true });

  const after = await monitoredEntities();
  return { target, control, entities: { before, after, adopted } };
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

  // ── Fixture metering (owner gate 4) ──────────────────────────────────────
  const { before, after, adopted } = s.entities;
  console.log(
    `fixture: monitored entities ${before.total} -> ${after.total} ` +
    `(cap is per-org; vendors ${before.vendors}->${after.vendors}, ai_systems ${before.aiSystems}->${after.aiSystems}); ` +
    `harness vendor ${adopted ? "ADOPTED" : "CREATED"}`
  );
  adopted
    ? ok(`fixture: an existing harness vendor was adopted — no new monitored entity (${before.total} -> ${after.total})`)
    : ok(`fixture: no harness vendor existed, one was created once (${before.total} -> ${after.total})`);
  after.total - before.total <= (adopted ? 0 : 1)
    ? ok("fixture: the run added no monitored entity beyond the one the vendor requires")
    : bad(`fixture: the run added ${after.total - before.total} monitored entities`);

  // ── Derivation, BOTH directions, before a browser is involved ────────────
  // The positive direction is what the UI sections re-prove through the screen.
  // The negative direction has no other home: an engagement that should NOT be
  // flagged cannot be found by looking at the ones that are.
  const posAttn = await engine(`/api/vendor-engagements/${s.target.engagementId}/attention`);
  const pos = posAttn.body.attention ?? {};
  pos.needs_attention === true
    ? ok("derivation: the mixed engagement needs attention")
    : bad("derivation: the mixed engagement was not flagged", JSON.stringify(pos).slice(0, 200));
  (pos.reasons ?? []).includes("control_not_in_place") && (pos.reasons ?? []).includes("partial_response")
    ? ok(`derivation: the reasons name the canonical conditions — ${(pos.reasons ?? []).join(", ")}`)
    : bad("derivation: the canonical conditions are not in the reasons", JSON.stringify(pos.reasons));
  posAttn.body.in_attention_window === true
    ? ok("derivation: a submitted engagement is inside the attention window")
    : bad("derivation: a submitted engagement is outside the window", String(posAttn.body.in_attention_window));

  const negAttn = await engine(`/api/vendor-engagements/${s.control.engagementId}/attention`);
  const neg = negAttn.body.attention ?? {};
  neg.needs_attention === false
    ? ok("FALSE-POSITIVE PROOF: an engagement whose answers are all explained passes is NOT flagged")
    : bad("FALSE-POSITIVE: a clean engagement was flagged", JSON.stringify(neg).slice(0, 300));
  (neg.reasons ?? []).length === 0
    ? ok("FALSE-POSITIVE PROOF: the clean engagement carries zero reasons")
    : bad("the clean engagement carries reasons", JSON.stringify(neg.reasons));
  neg.digest === "none"
    ? ok("FALSE-POSITIVE PROOF: its digest is `none`, so a disposition against it records an honest zero")
    : bad("the clean engagement's digest is not `none`", String(neg.digest));
  negAttn.body.in_attention_window === true
    ? ok("FALSE-POSITIVE PROOF: and it is INSIDE the window — it is unflagged on its merits, not by exclusion")
    : bad("the control engagement is outside the window, so it proves nothing", String(negAttn.body.in_attention_window));

  // The queue itself must agree with the per-engagement derivation.
  const queue = await engine("/api/vendor-engagements?needs_attention=true&limit=200");
  const queueIds = (queue.body.engagements ?? queue.body.items ?? []).map((e) => e.id);
  queueIds.includes(s.target.engagementId)
    ? ok("queue: the mixed engagement is in the needs-attention list")
    : bad("queue: the mixed engagement is missing from the list");
  !queueIds.includes(s.control.engagementId)
    ? ok("FALSE-POSITIVE PROOF: the clean engagement is ABSENT from the needs-attention list")
    : bad("FALSE-POSITIVE: the clean engagement appears in the needs-attention list");

  // ── The sort whitelist, exercised as an attacker would (owner gate 8) ────
  const defaultOrder = (await engine("/api/vendor-engagements?limit=50")).body;
  const defaultIds = (defaultOrder.engagements ?? defaultOrder.items ?? []).map((e) => e.id);
  const INJECTIONS = [
    "e.id; DROP TABLE vendor_engagement_dispositions; --",
    "(SELECT CASE WHEN (SELECT COUNT(*) FROM users) > 0 THEN 1 ELSE 1/0 END)",
    "created_at DESC, (SELECT password_hash FROM users LIMIT 1)",
    "nonexistent_column",
    "1",
  ];
  //
  // A payload can be neutralised in two legitimate places, and the harness must
  // not confuse one for a defect. Cloudflare sits in front of staging and
  // answers a SQL-shaped query string with its own 403 HTML block page — the
  // request never reaches the engine at all, which is the STRONGEST outcome
  // available, not a failure. Anything that does reach the app must fall back
  // to the default sort. Both are counted; neither is waived.
  let sortFails = 0;
  let blockedAtEdge = 0;
  for (const payload of INJECTIONS) {
    const r = await engine(`/api/vendor-engagements?limit=50&sort=${encodeURIComponent(payload)}`);
    const ids = (r.body.engagements ?? r.body.items ?? []).map((e) => e.id);
    if (r.status === 403 && Object.keys(r.body).length === 0) { blockedAtEdge++; continue; }
    if (r.status !== 200) { sortFails++; bad(`sort whitelist: an unapproved sort returned ${r.status}`, payload); continue; }
    if (JSON.stringify(ids) !== JSON.stringify(defaultIds)) {
      sortFails++;
      bad("sort whitelist: an unapproved sort key CHANGED the order — it reached the query", payload);
      continue;
    }
    if (r.body.query?.sort !== "risk") {
      sortFails++;
      bad(`sort whitelist: the server echoed sort=${r.body.query?.sort}, not the default`, payload);
    }
  }
  const badOrder = await engine("/api/vendor-engagements?limit=50&order=%27%3B%20--");
  badOrder.status === 200 &&
    JSON.stringify((badOrder.body.engagements ?? []).map((e) => e.id)) === JSON.stringify(defaultIds)
    ? ok("sort whitelist: an unapproved ORDER direction falls back to the default too")
    : bad(`sort whitelist: a crafted order direction was not neutralised (${badOrder.status})`);
  sortFails === 0
    ? ok(
        `sort whitelist: ${INJECTIONS.length} unapproved/crafted sort keys ALL neutralised — ` +
        `${INJECTIONS.length - blockedAtEdge} fell back to the default order inside the app, ` +
        `${blockedAtEdge} never reached it (edge block)`
      )
    : bad(`${sortFails} of ${INJECTIONS.length} crafted sort keys were not neutralised`);
  INJECTIONS.length - blockedAtEdge >= 2
    ? ok(`sort whitelist: proven INSIDE the app on ${INJECTIONS.length - blockedAtEdge} payloads — the edge is not carrying this proof`)
    : bad("sort whitelist: every payload was blocked at the edge, so the application-level fallback is unproven");

  await new Promise((r) => setTimeout(r, PACE_MS));

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
  //
  // Scoped to what WA-4 PUTS on the screen — the attention chips and the row it
  // derived — and NOT to the whole document. The first draft scanned
  // page.content() and failed on `S2`, which turned out to be inside
  // `[VA-Q2-P4 ACCEPTANCE] S2 S2.subprocessors`: an engagement TITLE typed by a
  // 2026-08 acceptance harness. Ruling E constrains WA-4's own vocabulary; a
  // title someone else wrote is that record's content, not this feature's
  // rendering, and a proof that fails on it is measuring the wrong thing.
  const RULE_ID = /\b(S[0-9]{1,2}(\.[a-z_]+)?|rule_id|rule_family|attention\.[a-z_]+)\b/;
  const chipText = (
    await page.locator("tbody [title]").evaluateAll((els) =>
      els.map((e) => `${e.getAttribute("title") ?? ""} ${e.textContent ?? ""}`)
    )
  ).join(" | ");
  chipText.length > 0
    ? ok("explainability: the queue renders attention chips carrying their own explanation")
    : bad("explainability: no attention chip was rendered on the queue");
  !RULE_ID.test(chipText)
    ? ok("explainability: no internal rule identifier reaches any attention chip on the portfolio screen")
    : bad("RULING E VIOLATED: a rule identifier is in an attention chip", (chipText.match(RULE_ID) ?? [])[0]);
  !RULE_ID.test(rowText.replace(/securelogic-core-assurance/g, ""))
    ? ok("explainability: no internal rule identifier reaches the derived row itself")
    : bad("RULING E VIOLATED: a rule identifier is in the engagement's own row", (rowText.match(RULE_ID) ?? [])[0]);
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
  // The same screen, in the negative: the clean engagement must not be on it.
  const hrefs = secondPass.map((h) => String(h));
  hrefs.some((h) => h.includes(s.target.engagementId))
    ? ok("portfolio: the mixed engagement is on the filtered screen")
    : bad("portfolio: the mixed engagement is not on the filtered screen", hrefs.slice(0, 5).join(" "));
  !hrefs.some((h) => h.includes(s.control.engagementId))
    ? ok("FALSE-POSITIVE PROOF (on screen): the all-pass engagement is NOT on the needs-attention screen")
    : bad("FALSE-POSITIVE: the all-pass engagement appears on the needs-attention screen");

  // And it IS reachable when the filter is dropped — absence above is the
  // filter working, not the engagement missing from the portfolio.
  //
  // Sorted newest-first rather than asking for a bigger page: the list renders a
  // fixed PAGE_SIZE with real Previous/Next links and correctly ignores a
  // caller-supplied `limit`, so `?limit=200` proves nothing except that the
  // control engagement sorts below the first page by risk. This also exercises a
  // second whitelisted sort through the UI.
  await page.goto(`${APP}/vendor-engagements?sort=created&order=desc`);
  await page.waitForLoadState("networkidle");
  const allHrefs = (await page.locator('tbody a[href^="/vendor-engagements/"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? "")
  ));
  allHrefs.some((h) => h.includes(s.control.engagementId))
    ? ok("portfolio: the all-pass engagement IS in the unfiltered portfolio, newest-first — the filter excluded it, nothing hid it")
    : bad("portfolio: the all-pass engagement is missing from the unfiltered portfolio too");
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

  // Time, not just actor. An audit trail whose timestamps are absent, unparseable
  // or out of order is not a trail.
  const times = dispositions.map((d) => Date.parse(d.disposed_at ?? d.created_at ?? ""));
  times.every((t) => Number.isFinite(t))
    ? ok("disposition: every decision carries a parseable timestamp")
    : bad("disposition: a decision has no usable timestamp", JSON.stringify(dispositions).slice(0, 200));
  times.every((t) => Math.abs(Date.now() - t) < 60 * 60 * 1000)
    ? ok("disposition: the timestamps are the server's own clock, within the hour of this run")
    : bad("disposition: a timestamp is not from this run", JSON.stringify(times));
  times[0] >= times[times.length - 1]
    ? ok("disposition: the trail is ordered newest-first BY TIME, matching the order it was written")
    : bad("disposition: the trail's time order contradicts its position order", JSON.stringify(times));
  dispositions.every((d) => typeof d.attention_digest === "string" && d.attention_digest.length > 0)
    ? ok("disposition: each decision records the derived state it was made against")
    : bad("disposition: a decision has no attention digest");

  // The decision must not have rewritten what it was a decision ABOUT.
  const afterDispositions = await engine(`/api/vendor-engagements/${s.target.engagementId}/attention`);
  const stillAttn = afterDispositions.body.attention ?? {};
  stillAttn.needs_attention === true &&
  JSON.stringify((stillAttn.reasons ?? []).slice().sort()) === JSON.stringify((pos.reasons ?? []).slice().sort())
    ? ok("disposition: recording two decisions did NOT alter the underlying assessment truth — the same reasons derive")
    : bad("the derived state changed after a disposition was recorded", JSON.stringify(stillAttn.reasons));
  stillAttn.digest === pos.digest
    ? ok("disposition: the digest is unchanged, so the vendor's responses and evidence were untouched")
    : bad(`digest moved from ${pos.digest} to ${stillAttn.digest} without a response changing`);

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

  // PROPOSED must be a different, separately readable decision from CONFIRMED —
  // otherwise "we think this might be a finding" and "this is a finding" are the
  // same record, and the trail cannot tell an owner which one a person meant.
  const proposed = await engine(`/api/vendor-engagements/${s.target.engagementId}/disposition`, {
    method: "POST",
    body: JSON.stringify({ disposition: "finding_proposed", rationale: "Proposing this for the committee to consider; not yet agreed as a finding." }),
  });
  proposed.status === 201
    ? ok("disposition: finding_proposed is recordable")
    : bad(`finding_proposed refused (${proposed.status})`, JSON.stringify(proposed.body).slice(0, 200));
  proposed.body?.created_finding === false
    ? ok("NEGATIVE PROOF (API): finding_proposed also states created_finding=false")
    : bad("finding_proposed did not state created_finding=false", JSON.stringify(proposed.body).slice(0, 200));

  const trail2 = await engine(`/api/vendor-engagements/${s.target.engagementId}/dispositions`);
  const kinds = (trail2.body.dispositions ?? []).map((d) => d.disposition);
  kinds.includes("finding_proposed") && kinds.includes("finding_confirmed")
    ? ok("disposition: PROPOSED and CONFIRMED are stored as two distinct decisions, both readable")
    : bad("proposed/confirmed are not both in the trail", JSON.stringify(kinds));
  kinds.filter((k) => k === "finding_proposed").length === 1 && kinds.filter((k) => k === "finding_confirmed").length === 1
    ? ok("disposition: neither collapsed into the other — one row each")
    : bad("proposed/confirmed collapsed or duplicated", JSON.stringify(kinds));

  const engFindings = await findingsForEngagement(s.target.engagementId);
  engFindings === 0
    ? ok(`NEGATIVE PROOF: a failed control, a partial control and ${kinds.length} recorded dispositions — including finding_proposed AND finding_confirmed — produced ZERO findings for this engagement`)
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
