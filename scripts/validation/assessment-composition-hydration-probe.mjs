// assessment-composition-hydration-probe.mjs — opens an engagement page that
// carries an active invitation in browsers whose locale/timezone differ from the
// server's, and reports console + page errors. React error #418 (hydration text
// mismatch) appears ONLY when the browser's locale-formatted date differs from
// the server's, so an en-US/UTC run proves nothing; the second context is the test.
//
//   APP_URL=https://securelogic-app-staging.onrender.com \
//   E2E_EMAIL=... E2E_PASSWORD=... \
//   node scripts/validation/assessment-composition-hydration-probe.mjs <engagement-id>
//
// Exit 0 = no hydration error in any context; 1 = #418 (or any page error) seen.
import { chromium } from "playwright";
const APP = process.env.APP_URL ?? "https://securelogic-app-staging.onrender.com";
const EMAIL = process.env.E2E_EMAIL, PASSWORD = process.env.E2E_PASSWORD;
const ENG = process.argv[2];
const OUT = process.env.OUT_DIR ?? ".";
if (!EMAIL || !PASSWORD || !ENG) { console.error("usage: E2E_EMAIL E2E_PASSWORD node … <engagement-id>"); process.exit(2); }
// The login page's SSO domain check is a known, unrelated console error; ignore it.
const IGNORE = /check-domain|ERR_FAILED/;
let failed = false;
const browser = await chromium.launch();
for (const [locale, timezoneId] of [["en-US", "UTC"], ["de-DE", "Pacific/Auckland"]]) {
  const ctx = await browser.newContext({ locale, timezoneId, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 160)));
  await page.goto(`${APP}/login`);
  await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^Sign In$/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await page.goto(`${APP}/vendor-engagements/${ENG}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(4_000);
  const expiry = await page.getByText(/expires /).first().textContent().catch(() => "(no expiry text — is the engagement issued?)");
  const hydration = errs.some((e) => /#418|#423|#425|Hydration/.test(e));
  console.log(`${hydration ? "FAIL" : "PASS"}  [${locale} ${timezoneId}] ${String(expiry).trim().slice(0, 80)} — errors: ${errs.length}`);
  errs.forEach((e) => console.log("      ", e));
  if (hydration || errs.some((e) => e.startsWith("PAGEERROR"))) failed = true;
  try { await page.screenshot({ path: `${OUT}/hydration-${locale}.png` }); } catch {}
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
