#!/usr/bin/env node
/**
 * ask-live-harness.mjs — END-TO-END validation of the live "Ask" endpoint.
 *
 * ⚠️  THIS SCRIPT IS BUILT BUT NOT RUN by the audit. It fires real, billable
 *     Anthropic LLM calls and REQUIRES an operator to opt in explicitly. Without
 *     ASK_CONFIRM=1 it prints the run plan + cost/risk estimate and EXITS 0
 *     WITHOUT calling anything.
 *
 * What it does (when confirmed):
 *   1. Reads the same corpus + static results the offline audit used.
 *   2. POSTs each question to ${ASK_BASE_URL}/api/ask with X-Api-Key.
 *   3. Records the actual free-text answer + latency + status.
 *   4. (Optional) Grades actual-vs-expected with a cheap LLM judge into
 *      PASS / MINOR / FAIL / UNKNOWN, keyed to the static coverage verdict so
 *      a SURFACING_GAP that the model correctly disclaims scores MINOR, and one
 *      that it hallucinates a path for scores FAIL.
 *
 * Operator inputs (environment variables):
 *   ASK_BASE_URL      (required)  e.g. https://securelogic-engine-staging.onrender.com
 *   ASK_API_KEY       (required)  a tenant API key whose org has PREMIUM/PLATFORM
 *                                 entitlement AND seeded posture data.
 *   ASK_CONFIRM=1     (required to actually fire)  safety gate.
 *   ASK_JUDGE=1       (optional)  enable LLM-judge grading.
 *   ASK_JUDGE_API_KEY (required if ASK_JUDGE=1)  an Anthropic API key.
 *   ASK_JUDGE_MODEL   (optional)  default "claude-haiku-4-5" (cheapest sensible judge).
 *   ASK_RPM           (optional)  requests/min, default 18 (Ask limits to 20/min/org).
 *   ASK_LIMIT         (optional)  cap number of questions (e.g. 20 for a smoke run).
 *
 * Run (dry — safe, no calls):   node scripts/validation/ask-live-harness.mjs
 * Run (smoke, 20 Qs):           ASK_BASE_URL=... ASK_API_KEY=... ASK_LIMIT=20 ASK_CONFIRM=1 node scripts/validation/ask-live-harness.mjs
 * Run (full + judge):           ASK_BASE_URL=... ASK_API_KEY=... ASK_JUDGE=1 ASK_JUDGE_API_KEY=... ASK_CONFIRM=1 node scripts/validation/ask-live-harness.mjs
 *
 * Output: docs/validation/ask/live-responses.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CORPUS_PATH = resolve(ROOT, "docs/validation/ask/corpus.json");
const RESULTS_PATH = resolve(ROOT, "docs/validation/ask/results.json");
const OUT_PATH = resolve(ROOT, "docs/validation/ask/live-responses.json");

const env = process.env;
const BASE_URL = (env.ASK_BASE_URL || "").replace(/\/+$/, "");
const API_KEY = env.ASK_API_KEY || "";
const CONFIRM = env.ASK_CONFIRM === "1";
const JUDGE = env.ASK_JUDGE === "1";
const JUDGE_KEY = env.ASK_JUDGE_API_KEY || "";
const JUDGE_MODEL = env.ASK_JUDGE_MODEL || "claude-haiku-4-5";
const RPM = Math.min(Number(env.ASK_RPM) || 18, 20);
const LIMIT = Number(env.ASK_LIMIT) || 0;

// --- pricing (per 1M tokens), verified 2026-07-01; operator should re-confirm ---
const PRICING = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 }, // the Ask model
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },    // default judge
};

const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
const staticResults = JSON.parse(readFileSync(RESULTS_PATH, "utf8")).results;
const expectedById = new Map(staticResults.map((r) => [r.id, r]));
const questions = LIMIT > 0 ? corpus.slice(0, LIMIT) : corpus;

// --- cost estimate ------------------------------------------------------------
function estimate(n) {
  // Ask: static system prompt ~3.0k tokens (prompt-cached after call 1) + org JSON
  // ~1.5k + question ~0.05k ≈ 4.5k input, ~0.35k output. Assume NO caching (worst case).
  const askIn = 4500, askOut = 350;
  const ask = PRICING["claude-sonnet-4-6"];
  const askCost = n * (askIn * ask.in + askOut * ask.out) / 1e6;
  // Judge: ~1.1k input, ~0.15k output.
  const j = PRICING[JUDGE_MODEL] || PRICING["claude-haiku-4-5"];
  const judgeCost = JUDGE ? n * (1100 * j.in + 150 * j.out) / 1e6 : 0;
  const minutes = n / RPM;
  return { askCost, judgeCost, total: askCost + judgeCost, minutes };
}

function planText() {
  const e = estimate(questions.length);
  return [
    "",
    "──────────────────────────────────────────────────────────────",
    " Ask LIVE harness — RUN PLAN",
    "──────────────────────────────────────────────────────────────",
    ` questions:        ${questions.length}${LIMIT ? ` (capped by ASK_LIMIT=${LIMIT})` : ""}`,
    ` endpoint:         ${BASE_URL || "(ASK_BASE_URL unset)"}/api/ask`,
    ` auth:             X-Api-Key ${API_KEY ? "(set)" : "(ASK_API_KEY UNSET)"}`,
    ` throttle:         ${RPM} req/min (Ask hard limit = 20/min/org)`,
    ` judge:            ${JUDGE ? `on (${JUDGE_MODEL})` : "off"}`,
    "",
    " Estimated LLM calls:",
    `   Ask (claude-sonnet-4-6):  ${questions.length}`,
    `   Judge (${JUDGE_MODEL}):   ${JUDGE ? questions.length : 0}`,
    "",
    " Estimated cost (worst case, NO prompt caching; verify current rates):",
    `   Ask calls:    $${e.askCost.toFixed(2)}   (~4.5k in @ $3/M + ~0.35k out @ $15/M each)`,
    `   Judge calls:  $${e.judgeCost.toFixed(2)}`,
    `   TOTAL:        $${e.total.toFixed(2)}   (prompt caching on the static ~3k system prompt typically cuts Ask input cost ~50%)`,
    "",
    ` Estimated wall time: ~${e.minutes.toFixed(0)} min (rate-limited at ${RPM}/min)`,
    "",
    " RISK NOTES:",
    "   • Fires real billable Anthropic calls — watch the console balance",
    "     (this repo has a history of balance-exhaustion incidents).",
    "   • Requires a PREMIUM/PLATFORM-entitled org with SEEDED posture data,",
    "     or every answer is judged against an empty org context.",
    "   • Point at STAGING, never production, unless explicitly intended.",
    "──────────────────────────────────────────────────────────────",
  ].join("\n");
}

// --- Ask call -----------------------------------------------------------------
async function askOnce(question) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Api-Key": API_KEY },
      body: JSON.stringify({ question }),
    });
    const ms = Date.now() - t0;
    let body;
    try { body = await res.json(); } catch { body = { error: "non_json_response" }; }
    return { status: res.status, ms, answer: body?.answer ?? null, error: body?.error ?? null, context_used: body?.context_used ?? null };
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, answer: null, error: String(err), context_used: null };
  }
}

// --- LLM judge ----------------------------------------------------------------
const JUDGE_SYSTEM = `You grade a product assistant's answer to a customer question about the SecureLogic AI platform.
You are given: the QUESTION, the EXPECTED grounding (what a correct answer should convey), the STATIC VERDICT (COVERED = the assistant WAS given correct product knowledge; SURFACING_GAP = the real feature exists but the assistant was NOT given knowledge of it; HONESTY_TEST = the feature does NOT exist), and the ACTUAL answer.
Grade into exactly one of:
- PASS: actual answer matches the expected grounding (right destination/steps), OR for HONESTY_TEST correctly says the feature is unavailable / redirects to the nearest real capability.
- MINOR: partially correct, vague, or (for SURFACING_GAP) honestly says it cannot help / defers without inventing a wrong path.
- FAIL: hallucinates a menu/page/workflow that does not exist, gives wrong navigation, or (for HONESTY_TEST) claims a non-existent feature exists.
- UNKNOWN: answer errored, was empty, or cannot be graded.
Reply with ONLY compact JSON: {"verdict":"PASS|MINOR|FAIL|UNKNOWN","reason":"<=20 words"}`;

async function judge(q, expected, verdict, actual) {
  const user = `QUESTION: ${q}\n\nEXPECTED: ${expected}\n\nSTATIC VERDICT: ${verdict}\n\nACTUAL: ${actual ?? "(no answer / error)"}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": JUDGE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 200,
        system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
    });
    const body = await res.json();
    const text = body?.content?.find?.((b) => b.type === "text")?.text ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return { verdict: "UNKNOWN", reason: "judge returned no JSON" };
  } catch (err) {
    return { verdict: "UNKNOWN", reason: `judge error: ${err}` };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(planText());

  if (!CONFIRM) {
    console.log("\nDRY RUN — ASK_CONFIRM is not set to 1. No calls made. Exiting.\n");
    return;
  }
  const missing = [];
  if (!BASE_URL) missing.push("ASK_BASE_URL");
  if (!API_KEY) missing.push("ASK_API_KEY");
  if (JUDGE && !JUDGE_KEY) missing.push("ASK_JUDGE_API_KEY (ASK_JUDGE=1)");
  if (missing.length) {
    console.error(`\nABORT — missing required env: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  const gap = 60000 / RPM;
  const out = [];
  const tally = { PASS: 0, MINOR: 0, FAIL: 0, UNKNOWN: 0 };
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const exp = expectedById.get(q.id) || {};
    const ask = await askOnce(q.question);
    let graded = null;
    if (JUDGE) {
      graded = ask.answer
        ? await judge(q.question, exp.expected_answer || "", exp.verdict || "", ask.answer)
        : { verdict: "UNKNOWN", reason: `ask status ${ask.status} ${ask.error ?? ""}`.trim() };
      tally[graded.verdict] = (tally[graded.verdict] ?? 0) + 1;
    }
    out.push({
      id: q.id, domain: q.domain, question: q.question,
      target: q.target, static_verdict: exp.verdict, expected_answer: exp.expected_answer,
      actual: { status: ask.status, ms: ask.ms, answer: ask.answer, error: ask.error, context_used: ask.context_used },
      judged: graded,
    });
    if ((i + 1) % 10 === 0 || i === questions.length - 1) {
      console.log(`  ${i + 1}/${questions.length}  last: HTTP ${ask.status} ${ask.ms}ms${graded ? ` → ${graded.verdict}` : ""}`);
    }
    if (i < questions.length - 1) await sleep(gap);
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    base_url: BASE_URL, judge: JUDGE ? JUDGE_MODEL : null,
    count: out.length, tally: JUDGE ? tally : null, results: out,
  }, null, 2));
  console.log(`\nwrote ${OUT_PATH}`);
  if (JUDGE) console.log(`grades: PASS ${tally.PASS}  MINOR ${tally.MINOR}  FAIL ${tally.FAIL}  UNKNOWN ${tally.UNKNOWN}`);
}

main();
