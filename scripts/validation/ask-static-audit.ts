/**
 * ask-static-audit.ts — DETERMINISTIC static validation of the "Ask" assistant's
 * product knowledge against source-of-truth. NO LLM, NO network.
 *
 * For every question in the corpus it computes, purely from the committed
 * Application Knowledge Index + Workflow Registry + the exact injected
 * product-knowledge string:
 *   - the expected answer (nav path / route / workflow steps, or "honest disclaim"),
 *   - a static coverage verdict: COVERED | SURFACING_GAP | HONESTY_TEST,
 *   - the failure class the verdict implies at live time.
 *
 * "Expected answers derived ONLY from source-of-truth files" (operator constraint)
 * is enforced structurally: this script reads the generated index + registry that
 * the engine itself imports — it cannot drift from what Ask actually sees.
 *
 * Run:  npx tsx scripts/validation/ask-static-audit.ts
 * In:   docs/validation/ask/corpus.json
 * Out:  docs/validation/ask/results.json  (+ printed summary)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { APPLICATION_KNOWLEDGE_INDEX } from "../../src/api/lib/applicationKnowledgeIndex.generated.js";
import { knownNavLabels } from "../../src/api/lib/workflowRegistry.js";
import { WORKFLOW_REGISTRY } from "../../src/api/productKnowledge/workflows.generated.js";
import { renderProductKnowledge } from "../../src/api/lib/productKnowledge.js";
import type { Workflow } from "../../src/api/lib/workflowRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CORPUS_PATH = resolve(ROOT, "docs/validation/ask/corpus.json");
const RESULTS_PATH = resolve(ROOT, "docs/validation/ask/results.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TargetKind = "workflow" | "injected_destination" | "ungated_route" | "absent";
type Verdict = "COVERED" | "SURFACING_GAP" | "HONESTY_TEST";
type FailureClass =
  | "none"
  | "missing_knowledge"
  | "missing_feature"
  | "missing_workflow"
  | "incorrect_navigation"
  | "wrong_menu"
  | "hallucination"
  | "corpus_error";

interface CorpusQuestion {
  id: string;
  domain: string;
  intent: string;
  question: string;
  target: { kind: TargetKind; ref: string };
}

interface Result extends CorpusQuestion {
  resolved_kind: TargetKind;
  verdict: Verdict;
  failure_class: FailureClass;
  expected_answer: string;
  target_valid: boolean;
  notes: string;
}

// ---------------------------------------------------------------------------
// Source-of-truth lookups (built once from the committed generated artifacts)
// ---------------------------------------------------------------------------

const index = APPLICATION_KNOWLEDGE_INDEX;

/** All navigable labels the model sees (top-level links + group labels + children). */
const injectedLabels = knownNavLabels(index);

/** hrefs of injected destinations (link hrefs + dropdown child hrefs). */
const injectedHrefs = new Set<string>();
/** label -> {href, group} for injected destinations, and group labels. */
const destByHref = new Map<string, { label: string; group: string | null }>();
const destByLabel = new Map<string, { href: string; group: string | null }>();
for (const item of index.navigation) {
  if (item.type === "link") {
    injectedHrefs.add(item.href);
    destByHref.set(item.href, { label: item.label, group: null });
    destByLabel.set(item.label, { href: item.href, group: null });
  } else {
    for (const c of item.children) {
      injectedHrefs.add(c.href);
      destByHref.set(c.href, { label: c.label, group: item.label });
      destByLabel.set(c.label, { href: c.href, group: item.label });
    }
  }
}

/** Every real route path in the app (from the generated index). */
const allRoutePaths = new Set(index.routes.map((r) => r.path));

/** Routes the model is actually told about: injected nav hrefs + every workflow route + secondary nav. */
const injectedRouteRefs = new Set<string>(injectedHrefs);
const workflowById = new Map<string, Workflow>();
for (const w of WORKFLOW_REGISTRY) {
  workflowById.set(w.id, w);
  for (const r of w.routes) injectedRouteRefs.add(r);
}
// Secondary navigation (account/settings surfaces) is now injected too (index v2).
const secondaryByHref = new Map<string, { label: string; group: string }>();
for (const s of index.secondaryNavigation ?? []) {
  injectedRouteRefs.add(s.href);
  secondaryByHref.set(s.href, { label: s.label, group: s.group });
}

/** The exact product-knowledge block injected into Ask's system prompt. */
const INJECTED_KNOWLEDGE = renderProductKnowledge();

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function menuPathFor(dest: { label: string; group: string | null }): string {
  return dest.group ? `${dest.group} → ${dest.label}` : dest.label;
}

function gradeWorkflow(ref: string): Omit<Result, keyof CorpusQuestion> {
  const w = workflowById.get(ref);
  if (!w) {
    return {
      resolved_kind: "workflow",
      verdict: "SURFACING_GAP",
      failure_class: "missing_workflow",
      expected_answer: `No workflow "${ref}" exists in the Workflow Registry — corpus references a workflow Ask does not have.`,
      target_valid: false,
      notes: "Author tagged a workflow id that is not in WORKFLOW_REGISTRY.",
    };
  }
  const steps = w.ordered_steps.map((s, i) => `${i + 1}. ${s}`).join(" ");
  return {
    resolved_kind: "workflow",
    verdict: "COVERED",
    failure_class: "none",
    expected_answer: `${w.title}. Where: ${w.navigation.join(" → ")} (${w.routes.join(", ")}). Steps: ${steps} Result: ${w.expected_result}`,
    target_valid: true,
    notes: `Injected workflow "${w.id}".`,
  };
}

function gradeInjectedDestination(ref: string): Omit<Result, keyof CorpusQuestion> {
  // ref may be a label ("Vendors", "Assets") or an href ("/vendors").
  const asHref = destByHref.get(ref);
  const asLabel = destByLabel.get(ref);
  const isGroupLabel = injectedLabels.has(ref) && !asLabel && !asHref;

  if (asHref) {
    return {
      resolved_kind: "injected_destination",
      verdict: "COVERED",
      failure_class: "none",
      expected_answer: `Navigate: ${menuPathFor(asHref)} → ${ref}. This destination is in the injected header menu.`,
      target_valid: true,
      notes: "Injected nav destination (matched by href).",
    };
  }
  if (asLabel) {
    return {
      resolved_kind: "injected_destination",
      verdict: "COVERED",
      failure_class: "none",
      expected_answer: `Navigate: ${menuPathFor({ label: ref, group: asLabel.group })} → ${asLabel.href}. This destination is in the injected header menu.`,
      target_valid: true,
      notes: "Injected nav destination (matched by label).",
    };
  }
  if (isGroupLabel) {
    return {
      resolved_kind: "injected_destination",
      verdict: "COVERED",
      failure_class: "none",
      expected_answer: `Open the "${ref}" dropdown in the top navigation. This menu group is injected.`,
      target_valid: true,
      notes: "Injected nav group label.",
    };
  }
  // Author said injected but it is not in the injected nav. Is it at least a real route?
  if (allRoutePaths.has(ref)) {
    return {
      resolved_kind: "ungated_route",
      verdict: "SURFACING_GAP",
      failure_class: "missing_knowledge",
      expected_answer: `Route ${ref} exists in the app but is NOT injected into Ask's knowledge. Reclassified from injected_destination → surfacing gap.`,
      target_valid: true,
      notes: "Author tagged injected_destination but ref is a real route that is NOT in the injected menu.",
    };
  }
  return {
    resolved_kind: "injected_destination",
    verdict: "HONESTY_TEST",
    failure_class: "corpus_error",
    expected_answer: `"${ref}" is neither an injected destination nor a real route. Treat as honesty test (feature absent).`,
    target_valid: false,
    notes: "Author tagged injected_destination with an unrecognized ref.",
  };
}

function gradeUngatedRoute(ref: string): Omit<Result, keyof CorpusQuestion> {
  if (injectedRouteRefs.has(ref)) {
    // Actually surfaced → the model DOES know it.
    const dest = destByHref.get(ref);
    const secondary = secondaryByHref.get(ref);
    let expected: string;
    let notes: string;
    if (secondary) {
      expected = `Navigate: ${secondary.group} → ${secondary.label} (${ref}). Injected via the account/settings (secondary) navigation.`;
      notes = "Injected secondary (account/settings) destination.";
    } else if (dest) {
      expected = `Navigate: ${menuPathFor(dest)} → ${ref}. (Route IS injected via the menu/workflows.)`;
      notes = "Author tagged ungated_route but the route is actually injected — reclassified COVERED.";
    } else {
      expected = `Route ${ref} IS referenced by an injected workflow, so the model knows it.`;
      notes = "Author tagged ungated_route but the route is actually injected — reclassified COVERED.";
    }
    return { resolved_kind: "injected_destination", verdict: "COVERED", failure_class: "none", expected_answer: expected, target_valid: true, notes };
  }
  if (allRoutePaths.has(ref)) {
    return {
      resolved_kind: "ungated_route",
      verdict: "SURFACING_GAP",
      failure_class: "missing_knowledge",
      expected_answer: `The app HAS ${ref}, but Ask's injected knowledge does NOT include it. Correct live behavior: either honestly say this is outside what Ask can navigate to, OR (defect) it invents a path / misdirects. Expected fix: surface this route in the knowledge index.`,
      target_valid: true,
      notes: "Real route, not injected — the core surfacing gap.",
    };
  }
  // Not a real route → treat as absent feature.
  return {
    resolved_kind: "absent",
    verdict: "HONESTY_TEST",
    failure_class: "missing_feature",
    expected_answer: `${ref} is not a real route. Correct answer: the feature does not exist; disclaim honestly.`,
    target_valid: false,
    notes: "Author tagged ungated_route with a non-existent route — treated as absent.",
  };
}

function gradeAbsent(): Omit<Result, keyof CorpusQuestion> {
  return {
    resolved_kind: "absent",
    verdict: "HONESTY_TEST",
    failure_class: "missing_feature",
    expected_answer:
      "This feature does not exist in the platform. Correct answer: honestly say it is not available and, where possible, point to the nearest real capability (do NOT invent a menu, page, or workflow).",
    target_valid: true,
    notes: "Intentional honesty test — hallucination is the failure mode.",
  };
}

function grade(q: CorpusQuestion): Result {
  let core: Omit<Result, keyof CorpusQuestion>;
  switch (q.target?.kind) {
    case "workflow":
      core = gradeWorkflow(q.target.ref);
      break;
    case "injected_destination":
      core = gradeInjectedDestination(q.target.ref);
      break;
    case "ungated_route":
      core = gradeUngatedRoute(q.target.ref);
      break;
    case "absent":
      core = gradeAbsent();
      break;
    default:
      core = {
        resolved_kind: "absent",
        verdict: "HONESTY_TEST",
        failure_class: "corpus_error",
        expected_answer: "Missing/invalid target — cannot grade.",
        target_valid: false,
        notes: `Invalid target.kind: ${JSON.stringify(q.target)}`,
      };
  }
  return { ...q, ...core };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function main() {
  const corpus: CorpusQuestion[] = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  const results = corpus.map(grade);

  // Aggregates
  const byVerdict: Record<string, number> = {};
  const byFailure: Record<string, number> = {};
  const byDomain: Record<string, Record<Verdict, number>> = {};
  const surfacingRoutes: Record<string, number> = {};
  for (const r of results) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    byFailure[r.failure_class] = (byFailure[r.failure_class] ?? 0) + 1;
    byDomain[r.domain] ??= { COVERED: 0, SURFACING_GAP: 0, HONESTY_TEST: 0 };
    byDomain[r.domain][r.verdict]++;
    if (r.verdict === "SURFACING_GAP" && r.resolved_kind === "ungated_route") {
      surfacingRoutes[r.target.ref] = (surfacingRoutes[r.target.ref] ?? 0) + 1;
    }
  }

  const corpusErrors = results.filter((r) => r.failure_class === "corpus_error");

  const summary = {
    generated_from: {
      knowledge_index_version: index.version,
      injected_nav_destinations: injectedHrefs.size,
      injected_workflows: WORKFLOW_REGISTRY.length,
      total_app_routes: allRoutePaths.size,
      injected_route_refs: injectedRouteRefs.size,
      not_injected_routes: allRoutePaths.size - [...allRoutePaths].filter((p) => injectedRouteRefs.has(p)).length,
      injected_knowledge_chars: INJECTED_KNOWLEDGE.length,
    },
    corpus_size: corpus.length,
    by_verdict: byVerdict,
    by_failure_class: byFailure,
    by_domain: byDomain,
    surfacing_gap_routes: Object.fromEntries(
      Object.entries(surfacingRoutes).sort((a, b) => b[1] - a[1]),
    ),
    corpus_errors: corpusErrors.length,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify({ summary, results }, null, 2));

  // Console report
  const pct = (n: number) => `${((n / corpus.length) * 100).toFixed(1)}%`;
  console.log("\n=== Ask Static Audit ===");
  console.log(`corpus: ${corpus.length} questions`);
  console.log(
    `injected knowledge: ${injectedHrefs.size} nav destinations, ${WORKFLOW_REGISTRY.length} workflows, ` +
      `${INJECTED_KNOWLEDGE.length} chars`,
  );
  console.log(
    `app routes: ${allRoutePaths.size} total, ${summary.generated_from.not_injected_routes} NOT injected into Ask\n`,
  );
  console.log("Verdicts:");
  for (const [v, n] of Object.entries(byVerdict)) console.log(`  ${v.padEnd(15)} ${n}  (${pct(n)})`);
  console.log("\nFailure classes (risk implied at live time):");
  for (const [f, n] of Object.entries(byFailure).sort((a, b) => b[1] - a[1]))
    console.log(`  ${f.padEnd(22)} ${n}`);
  console.log("\nPer-domain (COVERED / SURFACING_GAP / HONESTY_TEST):");
  for (const [d, c] of Object.entries(byDomain).sort())
    console.log(`  ${d.padEnd(16)} ${c.COVERED} / ${c.SURFACING_GAP} / ${c.HONESTY_TEST}`);
  console.log("\nTop surfacing-gap routes (exist in app, invisible to Ask):");
  for (const [route, n] of Object.entries(summary.surfacing_gap_routes)) console.log(`  ${route.padEnd(26)} ${n} questions`);
  if (corpusErrors.length) {
    console.log(`\n⚠ ${corpusErrors.length} corpus errors (unrecognized targets):`);
    for (const e of corpusErrors.slice(0, 20)) console.log(`  ${e.id}: ${e.notes}`);
  }
  console.log(`\nwrote ${RESULTS_PATH}`);
}

main();
