// One-off driver for the exec_summary + teaser synthesis prompt.
//
// Loads the staging brief artifact (synthesis-wired-verify.json), flattens
// the items, sorts by sort_order, takes the top 10, and runs a single Claude
// call. Prints the raw model output to stdout.
//
// This script is a checkpoint artifact, not a long-lived tool. Once the
// prompt is signed off, the logic moves into briefSynthesizer.ts and this
// file is deleted.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// ---- Load .env.local for ANTHROPIC_API_KEY ---------------------------------

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY missing from environment.");
  process.exit(1);
}

// ---- Load staging brief artifact -------------------------------------------

const ARTIFACT_PATH = path.resolve(
  process.cwd(),
  "synthesis-wired-verify.json"
);
const raw = fs.readFileSync(ARTIFACT_PATH, "utf8");
// The artifact has a trailing "HTTP 200" line from the curl that produced it.
const cleaned = raw.replace(/HTTP \d+\s*$/m, "").trim();
const brief = JSON.parse(cleaned);

const allItems = brief.content_json.categories.flatMap((c) => c.items);
allItems.sort((a, b) => a.sort_order - b.sort_order);
const topItems = allItems.slice(0, 10);

// ---- Build signal lines ----------------------------------------------------
//
// The model needs enough per-item context to form a directive without us
// pre-summarising. Each line carries:
//   - sort rank
//   - urgency band + severity + relevance
//   - title
//   - why_it_matters (truncated)
//   - first recommended action (truncated)
//
// We trust the model with the rest.

function trim(text, max) {
  if (!text) return "";
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

// NOTE: the staging artifact's API response strips why_it_matters and
// recommended_actions from items. In production (briefScheduler / generate
// route) those fields ARE on the BriefItem at synthesis time, so the
// production prompt will be richer than this local checkpoint. We feed
// `summary` here as the richest available per-item context.
const signalLines = topItems
  .map((it, i) => {
    const sev = (it.severity ?? "").toUpperCase();
    const rel = (it.relevance ?? "").toUpperCase();
    const title = trim(it.title, 90);
    const summary = trim(it.summary, 320);
    const cve = it.affected_cve ? ` ${it.affected_cve}` : "";
    const vendor = it.affected_vendor ? ` (${it.affected_vendor})` : "";
    return [
      `[${i + 1}] [${rel} | ${sev}]${cve}${vendor} ${title}`,
      `    summary: ${summary}`,
    ].join("\n");
  })
  .join("\n");

// ---- Prompt ----------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are writing the executive summary for a weekly cyber risk intelligence brief read by CISOs, GRC leaders, and security engineers at mid-to-large enterprises. " +
  "Your job is decision compression. Every sentence you write must leave the reader with a concrete decision lever in hand. " +
  "You are writing a memo to a busy operator, not an essay.";

const USER_PROMPT = `Below is the prioritized list of signals in this week's brief. Each is already enriched with urgency, why_it_matters, and one recommended action.

Signals (top 10, in priority order):
${signalLines}

Return JSON only with exactly two fields: teaser, exec_summary.

teaser
- One sentence. 18–24 words.
- The dashboard-card hook. Names the central threat THIS BRIEF and the action it forces.
- Must make a reader who skims past it understand what is at stake and why they should open the brief.

exec_summary
- Exactly three sentences. STRICT: 60–110 words total. Per-sentence caps: S1 20–30 words, S2 25–35 words, S3 25–40 words. If you would exceed 110 total, cut the CVE list in S1 to three vendors max. Do NOT truncate S3's instruction list — the actions are the deliverable.
- The "if you read only this paragraph and skipped the rest of the brief, what would you do today?" passage.
- Sentence 1: the most urgent thing that must happen — name the specific vendor/CVE/regulation, name the action. Must include a specific deadline (named day, calendar date, or business interval like "within 24 hours"). Reject "now", "immediately", "today" as standalone deadlines unless paired with a more specific bound (e.g. "today before market open" is acceptable, "today" alone is not).
- Sentence 2: names who is specifically exposed (function/role/sector — not "organizations" generically) AND ends on a verb the named role can take, bounded by a specific deadline (named day of the week, calendar date, or business interval like "48 hours" or "before market open"). Acceptable verb shapes: "should pull X by Wednesday", "escalate Y by close of business Friday", "confirm Z within 48 hours". Reject observational verbs that describe state without prescribing action: "owns", "faces", "is exposed to", "must contend with", "is on the table", "is at risk". Reject vague time horizons: "soon", "this period", "in the near term", "going forward". The sentence must leave the named role with a lever they pull on a specific day, not a fact they remember.
- Sentence 3: the instruction for this week. Must open with an imperative verb. Must leave the reader with a concrete decision lever in hand.
- DIRECTIVE, not descriptive. Tells the reader what to decide, does not narrate what is happening.

HARD AVOID:
1. Magazine voice — "has moved from X to Y", "the convergence of A and B is no coincidence", "this represents a systemic shift". You are writing a memo, not an essay.
2. Pattern-claim filler — "this reflects a single underlying exposure", "represents a systemic trust failure", "is not just a patching event".
3. Setup / throat-clearing — never open with "Industrial control system security has", "This week's signals show", "The security landscape is", or any framing sentence before the directive.
4. Embedded-clause sprawl — no sentence with three commas. No em-dash mid-clause inside a 30-word run. Plain subject-verb-object.
5. Generic governance/risk language — never write "organizations should review", "this highlights the importance", "teams should consider", "this underscores".
6. Descriptive vs directive — every sentence must leave the reader with a concrete decision lever. The third sentence in particular must instruct, not observe. If a sentence could be deleted without changing what the reader does today, it is the wrong sentence.

GOOD examples (the shape you are aiming for):

Example A:
{
  "teaser": "A Rhysida-affiliate hospital ransomware wave is in active triage with a 60-day HHS breach notification clock already running for affected health systems.",
  "exec_summary": "Confirm whether your hospital network sits in the Rhysida-affiliate ransomware wave by Wednesday — three providers have published incident notices in the past five days and the EHR-tooling vector overlaps with widely used remote-access stacks. Hospital security leaders, IR retainers, and HIPAA privacy officers at regional health systems should pull EHR vendor exposure reports and confirm offline-backup integrity by Friday. Tighten EDR detections for Rhysida loaders this week, freeze elective patient-portal feature releases until the wave clears, and brief your privacy officer on the 60-day notification clock if any system shows compromise indicators."
}

Example B:
{
  "teaser": "A credential-stuffing wave against a major payments processor has triggered SEC Item 1.05 disclosure clocks at three downstream brokerages this week.",
  "exec_summary": "Determine materiality on the StackPay credential-stuffing breach by Tuesday — three downstream broker-dealers have filed Item 1.05 8-Ks and the SEC's 4-business-day disclosure window starts the moment your team confirms reasonable belief of material impact. CISOs, in-house counsel, and disclosure committee members at any firm with StackPay-routed payment flows should map customer exposure and escalate the materiality determination to the audit committee by Wednesday. Rotate StackPay API credentials today, force a session reset across all customer accounts that authenticated since March 1, and stage draft 8-K language with counsel before Thursday's market open."
}

Return JSON only — no surrounding prose, no markdown fences.`;

// ---- Call the model --------------------------------------------------------

const client = new Anthropic({ apiKey });

const t0 = Date.now();
const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 350,
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: USER_PROMPT }],
});
const elapsed = Date.now() - t0;

const rawText = message.content
  .filter((c) => c.type === "text")
  .map((c) => c.text)
  .join("");

// Strip markdown code fences if Claude wrapped the JSON — mirrors the
// post-processing pattern at intelligenceBriefGenerator.ts:638.
const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

console.log("=".repeat(70));
console.log("INPUT — top 10 signal lines fed to the model");
console.log("=".repeat(70));
console.log(signalLines);
console.log();
console.log("=".repeat(70));
console.log(`MODEL — claude-sonnet-4-6 (${elapsed} ms)`);
console.log("=".repeat(70));
console.log(text);
console.log();
console.log("=".repeat(70));
console.log("USAGE");
console.log("=".repeat(70));
console.log(JSON.stringify(message.usage, null, 2));
