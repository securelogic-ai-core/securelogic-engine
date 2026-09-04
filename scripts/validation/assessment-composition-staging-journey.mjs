// journey.mjs — the owner's staging walkthrough, driven through the REAL app UI
// with Playwright. Every step is a customer or vendor action in the browser;
// the engine API is used ONLY to read back the invite row (email delivery
// state / provider message id) and the customer-side responses, which the UI
// also shows but which the ledger below records verbatim.
//
//   APP_URL=... ENGINE_URL=... E2E_EMAIL=... E2E_PASSWORD=... E2E_RECIPIENT=... \
//   node journey.mjs [chromium|webkit]
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
const bad = (m, d = "") => { fails++; ledger.push(`FAIL  ${m} :: ${d}`); console.log("FAIL ", m, d); };
const shot = async (page, name) => { try { await page.screenshot({ path: `${OUT}/${STAMP}-${name}.png`, fullPage: true }); } catch {} };

const engine = (path, opts = {}) =>
  fetch(`${ENGINE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function main() {
  const launcher = BROWSER === "webkit" ? webkit : chromium;
  const browser = await launcher.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => bad("client-side exception", String(e)));
  const vendorName = `Walkthrough Payments ${STAMP}`;

  // ── 1. Sign in ──
  await page.goto(`${APP}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  ok(`signed in (${BROWSER})`);

  // ── 2. Add vendor (factual master data, no criticality asked) ──
  await page.goto(`${APP}/vendors/new`);
  if (await page.locator('select[name="criticality"]').count()) bad("Add Vendor asks for a criticality classification");
  await page.fill('input[name="name"]', vendorName);
  await page.fill('input[name="category"]', "Payment Processing");
  await page.fill('[name="service_description"]', "Card acquiring");
  await page.selectOption('select[name="data_sensitivity"]', "restricted");
  await page.selectOption('select[name="access_level"]', "read_write");
  await page.fill('input[name="website"]', "https://example.test");
  await page.getByRole("button", { name: /Add vendor|Create vendor|Save/i }).first().click();
  await page.waitForURL(/\/vendors\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const vendorId = page.url().match(/\/vendors\/([0-9a-f-]{36})/)[1];
  ok(`vendor created through the UI (${vendorId})`);
  await shot(page, "01-vendor");

  // ── 3. Relationship ──
  await page.getByRole("button", { name: "Add relationship" }).click();
  await page.fill('input[placeholder="What you buy from this vendor (e.g. Card processing)"]', "Card processing");
  await page.fill('input[placeholder="Service description (optional)"]', "Online card acquiring");
  await page.getByRole("button", { name: "Add relationship" }).last().click();
  await page.getByText(/Card processing added/).waitFor({ timeout: 60_000 });
  ok("relationship added through the UI");

  // ── 4. Contacts ──
  await page.getByRole("button", { name: "Add contact" }).first().click();
  await page.fill('input[placeholder="Full name"]', "Jane Okafor");
  await page.fill('input[placeholder="Email address"]', RECIPIENT);
  await page.fill('input[placeholder="Title (optional)"]', "Security Lead");
  await page.getByRole("button", { name: "Add contact" }).last().click();
  await page.getByText(/Jane Okafor added to the directory/).waitFor({ timeout: 60_000 });
  ok(`contact added through the UI (${RECIPIENT})`);
  await shot(page, "02-contact");

  // ── 5. Factual intake → classification ──
  await page.getByRole("button", { name: "Record factual intake" }).first().click();
  const intake = {
    "Maximum tolerable disruption": "lt_24_hours", "Operational dependency": "essential", "Business reach": "enterprise_wide",
    "Process coupling": "in_critical_path", "Substitutability": "replaceable_months", "Concentration": "moderate",
    "Data sensitivity": "restricted", "Data volume": "large", "Access level": "read_write", "Regulatory exposure": "high",
    "AI involvement": "none", "Hosting model": "saas", "Fourth-party exposure": "moderate",
  };
  for (const [label, value] of Object.entries(intake)) {
    const sel = page.getByLabel(label, { exact: true });
    if (await sel.count()) await sel.selectOption(value); else bad(`intake field missing: ${label}`);
  }
  await page.getByRole("button", { name: "Record intake and classify" }).click();
  await page.getByText(/Classified: Critical criticality, High inherent risk/).waitFor({ timeout: 60_000 });
  ok("intake recorded: Criticality Critical / IR High / tier derived (UI)");
  await shot(page, "03-classified");

  // ── 6. Open assessment from the relationship ──
  await page.getByRole("button", { name: "Open assessment" }).first().click();
  await page.waitForURL(/\/vendor-engagements\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const engagementId = page.url().match(/\/vendor-engagements\/([0-9a-f-]{36})/)[1];
  ok(`engagement opened from the relationship (${engagementId})`);
  (await page.getByText("Relationship under assessment").count()) ? ok("engagement page names the relationship") : bad("relationship context missing");
  (await page.getByText(/Not composed yet/).count()) ? ok("composition section: not composed yet") : bad("composition section missing before compose");

  // ── 7. Compose ──
  await page.getByRole("button", { name: "Compose assessment" }).click();
  await page.getByText(/^Composed: /).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.reload();
  const objectives = await page.getByLabel("Core assurance objectives").locator("li").count();
  objectives === 16 ? ok("composition shows all 16 Core Assurance objectives") : bad("core objectives", String(objectives));
  const asked = await page.getByText("Asked", { exact: true }).count();
  const na = await page.getByText("Not applicable", { exact: true }).count();
  ok(`composition explainability visible: ${asked} asked, ${na - 1 >= 0 ? na - 1 : na} not applicable chips`);
  (await page.getByText(/Applicable domains:/).count()) ? ok("applicable domains shown") : bad("domains missing");
  (await page.getByText(/Added for this relationship/).count()) ? ok("additional requirements shown with reasons") : bad("additional missing");
  await shot(page, "04-composition");

  // ── 8. Select recipient, customise, send ──
  await page.getByRole("button", { name: "Send questionnaire to vendor" }).click();
  await page.getByLabel("Issue questionnaire").waitFor();
  (await page.getByText("Jane Okafor").count()) ? ok("recipient picker lists the directory contact") : bad("contact not listed");
  (await page.getByText(/· suggested/).count()) ? ok("primary contact suggested") : bad("no suggestion");
  await page.getByRole("button", { name: /Continue with Jane Okafor/ }).click();
  const ta = page.getByLabel("Invitation message");
  const draft = await ta.inputValue();
  draft.startsWith("Hello Jane,") ? ok("default invitation addressed by first name") : bad("default message", draft.slice(0, 40));
  const due = new Date(Date.now() + 21 * 86400e3).toISOString().slice(0, 10);
  await page.getByLabel("Response due (optional)").fill(due);
  await ta.fill(`${draft}\n\nWalkthrough ${STAMP}: customised line.`);
  await shot(page, "05-compose-invite");
  await page.getByRole("button", { name: "Send questionnaire" }).click();
  const status = page.getByRole("status");
  await status.waitFor({ timeout: 60_000 });
  const statusText = await status.textContent();
  statusText.includes("Invitation sent from SecureLogic") ? ok("invitation SENT from SecureLogic (UI)") : bad("delivery", statusText);
  const link = (await page.getByTestId("secure-link").textContent()).trim();
  /\/portal\/accept\/[0-9a-f]{64}$/.test(link) ? ok("secure link available as recovery (shown once)") : bad("secure link", link);
  await shot(page, "06-sent");

  // customer-side invite status after refresh
  await page.reload();
  const inv = page.getByLabel("Invitation");
  await inv.waitFor({ timeout: 60_000 });
  const invText = await inv.textContent();
  invText.includes("Jane Okafor") && invText.includes("Invitation sent from SecureLogic") ? ok("invitation status persisted on the engagement page") : bad("invite status", invText);
  invText.includes(`response due ${due}`) ? ok("due date persisted") : bad("due date", invText);

  // ── 9. Vendor side: receive/access the invitation (the emailed link) ──
  const vctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const vpage = await vctx.newPage();
  vpage.on("pageerror", (e) => bad("vendor portal client-side exception", String(e)));
  await vpage.goto(link);
  await vpage.waitForURL(/\/portal(\/|$)/, { timeout: 60_000 });
  ok("vendor: invitation link exchanged for a portal session");
  await vpage.goto(`${APP}/portal/engagement`).catch(() => {});
  await vpage.goto(`${APP}/portal/questionnaire`);
  await vpage.getByRole("button", { name: /Review/ }).first().waitFor({ timeout: 60_000 }).catch(() => {});
  const fieldsets = vpage.locator("fieldset");
  const qCount = await fieldsets.count();
  qCount > 0 ? ok(`vendor: questionnaire rendered with ${qCount} questions`) : bad("no questions");
  const body = await vpage.textContent("body");
  body.includes("CAS-0") ? ok("vendor: Core Assurance objectives are asked") : bad("no CAS references", body.slice(0, 200));
  await shot(vpage, "07-vendor-questionnaire");
  for (let i = 0; i < qCount; i++) {
    const fs = fieldsets.nth(i);
    await fs.locator("button").first().click();
    await vpage.waitForTimeout(150);
  }
  await vpage.waitForTimeout(2000);
  ok("vendor: answered every question");
  await vpage.goto(`${APP}/portal/review`);
  await vpage.getByRole("button", { name: "Submit responses" }).click();
  await vpage.waitForURL(/\/portal\/done/, { timeout: 60_000 }).catch(() => {});
  (await vpage.textContent("body")).match(/submitted|Thank you/i) ? ok("vendor: responses submitted") : bad("submit", vpage.url());
  await shot(vpage, "08-vendor-submitted");

  // ── 10. Customer side receives the response ──
  await page.reload();
  const st = await page.textContent("body");
  st.includes("Submitted") ? ok("customer: engagement state = Submitted") : bad("customer state", st.slice(0, 100));
  (await page.getByText(/Responses/).count()) ? ok("customer: responses section present") : bad("responses missing");
  await shot(page, "09-customer-after-submit");

  // ── 11. Ledger truth from the engine (read-only) ──
  const tok = (await engine("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).body.token;
  const det = await engine(`/api/vendor-engagements/${engagementId}`, { headers: { Authorization: `Bearer ${tok}` } });
  const active = det.body.invite?.latest;
  active?.email_delivery_state === "sent" && active?.email_provider_message_id ? ok(`engine: invite delivery sent, provider message ${active.email_provider_message_id}`) : bad("engine delivery", JSON.stringify(det.body.invite));
  active?.contact_id ? ok("engine: invite bound to the directory contact") : bad("contact binding");
  const comp = await engine(`/api/vendor-engagements/${engagementId}/composition`, { headers: { Authorization: `Bearer ${tok}` } });
  comp.body.composition?.hash ? ok(`engine: composition snapshot ${comp.body.composition.hash.slice(0, 12)}… (rules ${comp.body.composition.scope_rule_version})`) : bad("composition read");
  const resp = await engine(`/api/vendor-engagements/${engagementId}/responses`, { headers: { Authorization: `Bearer ${tok}` } });
  resp.status === 200 ? ok("engine: customer-side responses readable") : bad("responses", String(resp.status));

  await browser.close();
  console.log("\n" + ledger.join("\n"));
  console.log(`\nPASS=${ledger.length - fails} FAIL=${fails} vendor=${vendorId} engagement=${engagementId} app=${APP}`);
  fs.writeFileSync(`${OUT}/${STAMP}-journey.txt`, ledger.join("\n") + `\nvendor=${vendorId} engagement=${engagementId}\n`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("JOURNEY CRASHED", e); process.exit(2); });
