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

  return {
    vendorId, relationshipId, engagementId,
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
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ── 1. Sign in ──
  await page.goto(`${APP}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^Sign In$/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  ok(`signed in (${BROWSER})`);
  await page.waitForTimeout(PACE_MS);

  // ── 2. The engagement page defends its own rating ──
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
  /excluded because no rule in this scope-rule set/.test(composition)
    ? ok("WA-2: requirements the rules excluded are reported")
    : bad("rule exclusions not reported");
  await shot(page, "02-composition-not-asked");
  await page.waitForTimeout(PACE_MS);

  // ── 4. Challenge: recorded, and offering no way to remove anything ──
  const chal = page.getByLabel("Applicability challenges");
  const hasChallenges = await chal
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasChallenges) {
    bad("no challenge surface on a composed engagement");
    await finish(browser, page, pageErrors, s);
    return;
  }
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

  await page.reload();
  const listed = await page.getByLabel("Applicability challenges").textContent();
  /SecureLogic determined:/.test(listed) && listed.includes(`Walkthrough ${STAMP}`)
    ? ok("WA-2: the objection persists with SecureLogic's determination beside it")
    : bad("challenge not listed", listed.slice(0, 200));
  await page.waitForTimeout(PACE_MS);

  // ── 5. Correcting a mistyped contact address ──
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
  await page.getByPlaceholderText("Full name").fill("Sam Retired");
  await page.getByPlaceholderText("Email address").fill(s.retiredEmail);
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

  await finish(browser, page, pageErrors, s);
}

/** Single exit: an early return must still write the ledger and the artifacts. */
async function finish(browser, page, pageErrors, s) {
  pageErrors.length === 0
    ? ok(`no client-side exceptions (${BROWSER})`)
    : bad(`client-side exceptions (${BROWSER})`, pageErrors.join(" | "));
  await shot(page, "99-final");
  await browser.close();
  console.log("\n" + ledger.join("\n"));
  console.log(`\nBROWSER=${BROWSER} PASS=${ledger.length - fails} FAIL=${fails} vendor=${s.vendorId} engagement=${s.engagementId}`);
  fs.writeFileSync(`${OUT}/${STAMP}-wa2-${BROWSER}.txt`, ledger.join("\n") + `\nvendor=${s.vendorId} engagement=${s.engagementId}\n`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("JOURNEY CRASHED", e); process.exit(2); });
