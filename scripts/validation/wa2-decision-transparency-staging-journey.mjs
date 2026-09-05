// wa2-decision-transparency-staging-journey.mjs — WA-2 against DEPLOYED
// staging, driven through the REAL customer UI in a REAL browser.
//
//   APP_URL=... ENGINE_URL=... E2E_EMAIL=... E2E_PASSWORD=... \
//   node wa2-decision-transparency-staging-journey.mjs [chromium|webkit]
//
// ── What this proves that the API tests cannot ──────────────────────────────
//
// WA-2's engine behaviour is already proven against real Postgres (145 cases
// across 8 isolation suites). What only a browser can prove is the half that IS
// the product:
//
//   * an analyst can defend a rating WITHOUT leaving the engagement — the
//     basis renders, from stored values, on the page they are standing on;
//   * the composition says what it did NOT ask, not only what it did;
//   * a mistyped contact address has a correction path that is not Delete;
//   * an add refused by an INVISIBLE inactive contact offers the one action
//     that resolves it, and reactivating selects that person;
//   * the challenge surface offers no way to remove anything, and says so.
//
// ── Pacing ─────────────────────────────────────────────────────────────────
//
// The vendor and engagement pages each fan out several engine reads under one
// user JWT, and the engine's limiter counts 120/min per user. Page loads are
// therefore paced; a rate-limited run would report a product failure that is
// really a harness failure.

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
const shot = async (p, n) => { try { await p.screenshot({ path: `${OUT}/${STAMP}-wa2-${BROWSER}-${n}.png`, fullPage: true }); } catch {} };

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

async function setup() {
  TOK = (await engine("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).body.token;
  if (!TOK) throw new Error("login failed");

  const v = await engine("/api/vendors", {
    method: "POST",
    body: JSON.stringify({
      name: `WA2 journey ${STAMP}`, category: "Payment Processing",
      service_description: "Card acquiring", data_sensitivity: "restricted",
      access_level: "read_write", website: "https://example.test",
    }),
  });
  const vendorId = v.body.vendor?.id;
  if (!vendorId) throw new Error(`vendor create failed: ${JSON.stringify(v.body)}`);

  const r = await engine(`/api/vendors/${vendorId}/relationships`, {
    method: "POST",
    body: JSON.stringify({ name: "Card processing", service_description: "Online card acquiring" }),
  });
  const relationshipId = r.body.relationship?.id;

  // A HIGH-exposure intake so the basis has floors and adjustments to render —
  // an all-low relationship produces a basis with nothing interesting in it.
  await engine(`/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
    method: "POST",
    body: JSON.stringify({
      max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential",
      business_reach: "enterprise_wide", substitutability: "no_viable_alternative",
      process_coupling: "in_critical_path", concentration: "single_point_of_failure",
      data_sensitivity: "restricted", data_volume: "mass", access_level: "admin",
      regulatory_exposure: "high", regulatory_breach_notification: true,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "multi_tenant_saas",
      fourth_party_exposure: "high",
    }),
  });

  // Two contacts: one to correct, one to deactivate for the collision test.
  const typo = await engine(`/api/vendors/${vendorId}/contacts`, {
    method: "POST",
    body: JSON.stringify({ full_name: "Pat Typo", email: `pat.typoo+${STAMP}@vendor.test`, title: "CISO", contact_role: "security", is_primary_contact: true }),
  });
  const retired = await engine(`/api/vendors/${vendorId}/contacts`, {
    method: "POST",
    body: JSON.stringify({ full_name: "Sam Retired", email: `sam.retired+${STAMP}@vendor.test`, contact_role: "privacy" }),
  });
  // Deactivated => invisible on every add surface, address still owned.
  await engine(`/api/vendors/${vendorId}/contacts/${retired.body.contact.id}`, {
    method: "PATCH", body: JSON.stringify({ status: "inactive" }),
  });

  const e = await engine("/api/vendor-engagements", {
    method: "POST",
    body: JSON.stringify({ vendor_id: vendorId, relationship_id: relationshipId, engagement_type: "initial", title: `WA2 journey ${STAMP}` }),
  });
  const engagementId = e.body.id;
  const scoped = await engine(`/api/vendor-engagements/${engagementId}/scope`, { method: "POST", body: JSON.stringify({}) });
  if (scoped.status !== 200) throw new Error(`scope failed: ${JSON.stringify(scoped.body).slice(0, 300)}`);

  // A SECOND, deliberately low relationship. The tier_1 engagement above
  // excludes nothing, so it cannot demonstrate that the composition reports
  // what it did NOT ask. A tier_4 relationship excludes the whole library.
  const lowRel = await engine(`/api/vendors/${vendorId}/relationships`, {
    method: "POST",
    body: JSON.stringify({ name: "Office catering", service_description: "On-site catering" }),
  });
  const lowRelationshipId = lowRel.body.relationship?.id;
  const lowIntake = await engine(`/api/vendors/${vendorId}/relationships/${lowRelationshipId}/intake`, {
    method: "POST",
    body: JSON.stringify({
      max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental",
      business_reach: "single_team", substitutability: "interchangeable",
      process_coupling: "peripheral", concentration: "none",
      data_sensitivity: "none", data_volume: "minimal", access_level: "none",
      regulatory_exposure: "none", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "none",
    }),
  });
  if (lowIntake.status !== 201) throw new Error(`low intake failed: ${JSON.stringify(lowIntake.body).slice(0, 300)}`);
  const lowE = await engine("/api/vendor-engagements", {
    method: "POST",
    body: JSON.stringify({ vendor_id: vendorId, relationship_id: lowRelationshipId, engagement_type: "initial", title: `WA2 journey low ${STAMP}` }),
  });
  const lowEngagementId = lowE.body.id;
  const lowScoped = await engine(`/api/vendor-engagements/${lowEngagementId}/scope`, { method: "POST", body: JSON.stringify({}) });
  if (lowScoped.status !== 200) throw new Error(`low scope failed: ${JSON.stringify(lowScoped.body).slice(0, 300)}`);

  return {
    vendorId, relationshipId, engagementId, lowEngagementId,
    typoContactId: typo.body.contact.id,
    retiredEmail: `sam.retired+${STAMP}@vendor.test`,
  };
}

async function main() {
  const s = await setup();
  ok(`setup: engagement ${s.engagementId} composed (API)`);

  const browser = await (BROWSER === "webkit" ? webkit : chromium).launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  // Record WHERE a page error fired and WHAT was in flight, not just what it
  // said. WebKit reports a fetch cancelled by navigation as a pageerror
  // ("TypeError: Load failed") while Chromium reports nothing, so a bare
  // message cannot distinguish a real client bug from the harness navigating
  // away from a page whose fan-out was still running. `page.url()` alone is
  // not enough either: it is read when the error SURFACES, which for a
  // cancelled fetch is already the destination page. The failed-request log
  // below names the actual request and its errorText, which is decisive.
  let section = "0-preamble";
  const mark = (m) => { section = m; };
  const failedRequests = [];
  page.on("pageerror", (e) => pageErrors.push(`${String(e)} @ ${page.url()} [${section}]`));
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText ?? "?"} [${section}]`)
  );

  // ── 1. Sign in ──
  await page.goto(`${APP}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^Sign In$/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  ok(`signed in (${BROWSER})`);
  await page.waitForTimeout(PACE_MS);

  // ── 2. The engagement page defends its own rating ──
  mark("2-engagement-main");
  await page.goto(`${APP}/vendor-engagements/${s.engagementId}`);
  await page.getByLabel("Relationship under assessment").waitFor({ timeout: 60_000 });
  // Guarded: a FAILED assertion must not abort the run. The whole point of
  // running this against a pre-WA-2 deployment (the negative control) is to see
  // every assertion fail, and a hard crash on the first missing element hides
  // the rest of the picture.
  const why = page.getByText("Why this rating?");
  const hasWhy = (await why.count()) > 0;
  hasWhy
    ? ok("WA-2: the engagement page offers 'Why this rating?'")
    : bad("no basis disclosure on the engagement page");
  if (hasWhy) await why.first().click();

  const body = await page.textContent("body");
  // A stored factor explanation, rendered verbatim from the envelope.
  /weight|contribution|× 0\./.test(body)
    ? ok("WA-2: the weighted factors render on the engagement page")
    : bad("no factor arithmetic rendered", body.slice(0, 200));
  /on the approved matrix/.test(body)
    ? ok("WA-2: the tier is explained as the joint function it is")
    : bad("no tier matrix sentence");
  // NOT `/criticality v1\.0\.0/` — the VO-11 header already prints that, so
  // matching it passed against a pre-WA-2 deployment and proved nothing. The
  // negative control caught it. `method` + version together is rendered ONLY by
  // ClassificationBasisPanel, off the stored envelope.
  /vendor_inherent_v2 v2\.0\.0/.test(body)
    ? ok("WA-2: the basis envelope's own method + methodology stamp render")
    : bad("no basis-envelope methodology stamp");
  /correct the facts and record the intake/.test(body)
    ? ok("WA-2: the page says ratings are corrected through facts, never edited")
    : bad("no correction guidance");
  await shot(page, "01-why-this-rating");

  // ── 3. The composition says what it did NOT ask ──
  const composition = await page.getByLabel("Assessment composition").textContent();
  /Independent assurance coverage/.test(composition)
    ? ok("WA-2: independent assurance coverage is shown")
    : bad("coverage line missing", composition.slice(0, 200));
  // This engagement is tier_1 and excludes NOTHING (`excluded_by_rules: 0`), so
  // the exclusions sentence is correctly absent here. Asserting its presence on
  // this fixture was a harness defect: it failed for a fixture reason both
  // before and after WA-2, so it never tested the feature. Assert the UI agrees
  // with the snapshot instead, and prove the positive on a fixture that HAS
  // exclusions (section 3b).
  const mainExcluded = (await engine(`/api/vendor-engagements/${s.engagementId}/composition`))
    .body.composition.summary.excluded_by_rules;
  const claimsExclusions = /excluded because no rule in this scope-rule set/.test(composition);
  mainExcluded === 0 && !claimsExclusions
    ? ok("WA-2: with nothing excluded, the composition claims no exclusions")
    : bad("composition disagrees with its snapshot", `excluded_by_rules=${mainExcluded} rendered=${claimsExclusions}`);
  await shot(page, "02-composition-not-asked");
  await page.waitForTimeout(PACE_MS);

  // ── 3b. The positive case: a composition that DID exclude, says so ──
  //
  // A tier_4 relationship asks nothing and excludes the whole library, which is
  // exactly the case where "what we did not ask" has to be legible.
  mark("3b-low-engagement");
  await page.goto(`${APP}/vendor-engagements/${s.lowEngagementId}`);
  const lowSection = page.getByLabel("Assessment composition");
  await lowSection.waitFor({ timeout: 60_000 });
  const lowText = await lowSection.textContent();
  const lowExcluded = (await engine(`/api/vendor-engagements/${s.lowEngagementId}/composition`))
    .body.composition.summary.excluded_by_rules;
  lowExcluded > 0
    ? ok(`WA-2: the low-tier fixture genuinely excludes (${lowExcluded}) — the arm is not vacuous`)
    : bad("low-tier fixture excluded nothing; this arm proves nothing", String(lowExcluded));
  /excluded because no rule in this scope-rule set/.test(lowText)
    ? ok("WA-2: requirements the rules excluded ARE reported, with the count")
    : bad("rule exclusions not reported", lowText.slice(0, 200));
  new RegExp(`${lowExcluded} requirements? in the library`).test(lowText)
    ? ok("WA-2: the exclusion count rendered matches the snapshot")
    : bad("exclusion count does not match the snapshot", String(lowExcluded));
  await shot(page, "02b-exclusions-reported");
  // Settle before leaving. This page fans out, and Next.js also fires RSC
  // prefetches for the links on it; navigating while those are in flight
  // cancels them, and WebKit surfaces a cancelled fetch as a pageerror
  // ("TypeError: Load failed") where Chromium stays silent. Proven by the
  // requestfailed log: four `Load request cancelled` entries, all stamped
  // 3b-back-to-main. The fix is to settle the load, NOT to filter the
  // pageerror — the no-client-exceptions assertion stays exactly as strict.
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  mark("3b-back-to-main");
  await page.goto(`${APP}/vendor-engagements/${s.engagementId}`);
  await page.getByLabel("Applicability challenges").waitFor({ timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(PACE_MS);

  // ── 4. Challenge: recorded, and offering no way to remove anything ──
  const chal = page.getByLabel("Applicability challenges");
  const hasChallenges = await chal
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasChallenges) {
    bad("no challenge surface on a composed engagement");
    await finish(browser, page, pageErrors, s, failedRequests);
    return;
  }
  mark("4-challenge");
  ok("WA-2: the challenge surface is present on a composed engagement");
  await page.getByRole("button", { name: /Disagree with a determination/ }).click();
  const formText = await chal.textContent();
  /does not remove the requirement or change what the vendor is asked/.test(formText)
    ? ok("WA-2: the form says up front that it removes nothing")
    : bad("no 'removes nothing' statement", formText.slice(0, 200));
  /are a minimum and are not waived by objection/.test(formText)
    ? ok("WA-2: the Core Assurance floor is stated as a floor")
    : bad("floor not stated");
  for (const name of [/^Remove/i, /^Suppress/i, /^Waive/i, /^Exclude/i]) {
    if (await chal.getByRole("button", { name }).count()) bad("a removal control exists", String(name));
  }
  ok("WA-2: no remove / suppress / waive control exists on the surface");

  const beforeHash = (await engine(`/api/vendor-engagements/${s.engagementId}/composition`)).body.composition.hash;
  const select = page.getByLabel("Determination to challenge");
  const firstRef = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(firstRef);
  await page.getByLabel("Why you disagree").fill(
    `Walkthrough ${STAMP}: we believe this determination rests on a stale declared fact.`
  );
  await page.getByRole("button", { name: /Record disagreement/ }).click();
  await page.getByRole("status").waitFor({ timeout: 60_000 });
  const resolution = await page.getByRole("status").textContent();
  /does not change the assessment/.test(resolution)
    ? ok("WA-2: the engine's resolution sentence is shown verbatim")
    : bad("resolution text", resolution);
  /opening a new engagement from the relationship/.test(resolution)
    ? ok("WA-2: the resolution describes what ACTUALLY happens (open ruling honoured)")
    : bad("resolution does not describe the real path", resolution);
  await shot(page, "03-challenge-recorded");

  const afterHash = (await engine(`/api/vendor-engagements/${s.engagementId}/composition`)).body.composition.hash;
  afterHash === beforeHash
    ? ok("WA-2: THE FLOOR HOLDS — the composition is byte-identical after a challenge")
    : bad("composition changed after a challenge", `${beforeHash} -> ${afterHash}`);

  mark("4-reload");
  // "Record disagreement" is a Next.js server action, and a server action
  // schedules a router revalidation AFTER it resolves. `networkidle` alone
  // returns immediately here — at that instant the page genuinely is idle —
  // and the reload then cancels the revalidation POST that starts a moment
  // later. WebKit surfaces that cancellation as a pageerror; Chromium logs
  // the same abort and says nothing. Give the revalidation time to start,
  // then settle, then reload. The assertion below is unchanged.
  await page.waitForTimeout(3_000);
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.reload();
  const listed = await page.getByLabel("Applicability challenges").textContent();
  /SecureLogic determined:/.test(listed) && listed.includes(`Walkthrough ${STAMP}`)
    ? ok("WA-2: the objection persists with SecureLogic's determination beside it")
    : bad("challenge not listed", listed.slice(0, 200));
  await page.waitForTimeout(PACE_MS);

  // ── 5. Correcting a mistyped contact address ──
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  mark("5-vendor-page");
  await page.goto(`${APP}/vendors/${s.vendorId}`);
  await page.getByRole("button", { name: "Edit" }).first().waitFor({ timeout: 60_000 });
  ok("WA-2: contacts can be EDITED (the path that did not exist)");
  await page.getByRole("button", { name: "Edit" }).first().click();
  const emailField = page.getByLabel("Email address");
  (await emailField.inputValue()).includes("pat.typoo")
    ? ok("WA-2: the edit form opens prefilled with the stored contact")
    : bad("edit form not prefilled");
  const corrected = `pat.typo+${STAMP}@vendor.test`;
  await emailField.fill(corrected);
  (await page.getByText(/Past invitations keep the address they were actually sent to/).count()) > 0
    ? ok("WA-2: correcting an address warns that history is not rewritten")
    : bad("no invite-snapshot warning");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(3000);
  const contacts = (await engine(`/api/vendors/${s.vendorId}/contacts`)).body.contacts;
  contacts.find((c) => c.id === s.typoContactId)?.email === corrected
    ? ok("WA-2: the corrected address is stored")
    : bad("address not corrected", JSON.stringify(contacts.map((c) => c.email)));
  await shot(page, "04-contact-corrected");
  await page.waitForTimeout(PACE_MS);

  // ── 6. The hidden-inactive collision, resolved rather than refused ──
  //
  // The exact defect from the walkthrough: the list shows only active
  // contacts, the unique index covers every row.
  await page.getByRole("button", { name: "Add contact" }).first().click();
  await page.getByPlaceholder("Full name").fill("Sam Retired");
  await page.getByPlaceholder("Email address").fill(s.retiredEmail);
  const addButtons = await page.getByRole("button", { name: "Add contact" }).all();
  await addButtons[addButtons.length - 1].click();

  const reactivate = page.getByRole("button", { name: /Reactivate Sam Retired/ });
  await reactivate.waitFor({ timeout: 60_000 })
    .then(() => ok("WA-2: the refusal names the invisible contact and offers to reactivate"))
    .catch((e) => bad("no reactivate offer on the hidden-inactive collision", e));
  const refusal = await page.textContent("body");
  /marked inactive/.test(refusal)
    ? ok("WA-2: the refusal says the holder is inactive, not just 'already exists'")
    : bad("refusal does not explain the collision");
  await shot(page, "05-hidden-inactive-collision");

  await reactivate.click();
  await page.waitForTimeout(3000);
  const after = (await engine(`/api/vendors/${s.vendorId}/contacts`)).body.contacts;
  const sam = after.find((c) => c.email === s.retiredEmail);
  sam?.status === "active"
    ? ok("WA-2: reactivating restored the person — not a duplicate, not a delete")
    : bad("reactivate did not restore", JSON.stringify(sam ?? {}));
  after.filter((c) => c.email === s.retiredEmail).length === 1
    ? ok("WA-2: exactly one row still holds that address")
    : bad("a duplicate was created");
  await page.waitForTimeout(PACE_MS);

  // ── 7. Re-recording the intake can say WHY ──
  //
  // The engine refuses a re-intake without `change_reason`. The form had no
  // field for it, so "Re-record intake" answered 400 with nowhere to reply —
  // a dead end this arm exists to keep closed.
  const reRecord = page.getByRole("button", { name: "Re-record intake" });
  const canReRecord = (await reRecord.count()) > 0;
  if (!canReRecord) {
    bad("no re-record control on a classified relationship");
  } else {
    await reRecord.first().click();
    const changed = page.getByLabel("What changed about this relationship?");
    (await changed.count()) > 0
      ? ok("WA-2: a re-intake asks what changed — the field the engine requires exists")
      : bad("re-intake offers no way to give the reason the engine demands");
    // The precise gating (facts answered, reason too short, reason accepted) is
    // pinned by the card's unit arms; here we prove the field reached staging
    // and explains why it is being asked.
    const guidance = await page.textContent("body");
    /The reason is kept\s+with the new facts|The reason is kept with the new facts/.test(guidance)
      ? ok("WA-2: the form says what the reason is for and that history is kept")
      : bad("no re-intake reason guidance");
    await shot(page, "06-reintake-reason");
  }

  await finish(browser, page, pageErrors, s, failedRequests);
}

/** Single exit: an early return must still write the ledger and the artifacts. */
async function finish(browser, page, pageErrors, s, failedRequestLog = []) {
  pageErrors.length === 0
    ? ok(`no client-side exceptions (${BROWSER})`)
    : bad(`client-side exceptions (${BROWSER})`, pageErrors.join(" | "));
  await shot(page, "99-final");
  if (failedRequestLog.length) {
    console.log("\nFAILED REQUESTS (diagnostic, not an assertion):");
    for (const f of failedRequestLog) console.log("  " + f);
  }
  await browser.close();
  console.log("\n" + ledger.join("\n"));
  console.log(`\nBROWSER=${BROWSER} PASS=${ledger.length - fails} FAIL=${fails} vendor=${s.vendorId} engagement=${s.engagementId}`);
  fs.writeFileSync(`${OUT}/${STAMP}-wa2-${BROWSER}.txt`, ledger.join("\n") + `\nvendor=${s.vendorId} engagement=${s.engagementId}\n`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("JOURNEY CRASHED", e); process.exit(2); });
