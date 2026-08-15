/**
 * askRoutesArePlatformOnly.test.ts — Ask is a platform surface, and the code
 * that assumes so must fail loudly if that ever stops being true.
 *
 * WHY THIS EXISTS (W-6)
 * ---------------------
 * ask.ts selects a product-knowledge prompt per entitlement class — starter,
 * professional, premium — so "the prompt must not name surfaces this org's
 * entitlement cannot reach". But every Ask route sits behind
 * requireEntitlement("premium"), so the class can only ever be `premium` and
 * the other two variants are unreachable. Executing walkthrough §2.5 against a
 * real professional-tier tenant proved it: POST /api/ask/stream returns
 * 403 insufficient_entitlement, so no non-premium request ever reaches the
 * class computation at all.
 *
 * That is not, by itself, a bug — Ask being platform-only is the ratified
 * product ruling (2026-08-15). The bug was that it LOOKED like an active
 * filter while being unable to fire, which is the same shape as a control
 * believed enforced that is wired to nothing. Two things now hold it honest:
 * resolveRequesterClass() logs at error level if a non-premium class ever
 * arrives, and this test pins the gate that makes that impossible.
 *
 * If someone loosens the gate — a live question, since Brief Pro and Brief Team
 * are sold tiers — this test fails and sends them to the prompt logic, which is
 * exactly the conversation that needs to happen at that moment.
 *
 * Source-level assertions, following entityLimit.test.ts and seatLimit.test.ts,
 * because the property is about how the routes are DECLARED. A runtime test
 * would need the whole middleware stack and would still not prove the guard is
 * on every route.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASK_SRC = readFileSync(resolve(__dirname, "../routes/ask.ts"), "utf8");

/** Every `router.<verb>(` declaration with the path on the following line. */
function declaredRoutes(src: string): Array<{ verb: string; path: string; guards: string }> {
  const lines = src.split("\n");
  const out: Array<{ verb: string; path: string; guards: string }> = [];
  lines.forEach((line, i) => {
    const m = /^router\.(get|post|patch|put|delete)\(/.exec(line.trim());
    if (!m) return;
    // The path is the first string literal at or after the call.
    const window = lines.slice(i, i + 12).join("\n");
    const p = /"([^"]+)"/.exec(window);
    out.push({ verb: m[1]!, path: p?.[1] ?? "(unparsed)", guards: window });
  });
  return out;
}

describe("Ask routes are platform-only", () => {
  it("declares at least the four known Ask routes", () => {
    const routes = declaredRoutes(ASK_SRC);
    const paths = routes.map((r) => r.path);
    // A guard is useless if the parser silently found nothing.
    expect(paths).toEqual(
      expect.arrayContaining(["/ask", "/ask/stream", "/ask/conversations", "/ask/conversations/:id"]),
    );
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it("gates EVERY Ask route on requireEntitlement(\"premium\")", () => {
    const ungated = declaredRoutes(ASK_SRC)
      .filter((r) => !/requireEntitlement\("premium"\)/.test(r.guards))
      .map((r) => `${r.verb.toUpperCase()} ${r.path}`);

    expect(
      ungated,
      "An Ask route is no longer platform-only. That may be intended — Brief Pro " +
        "and Brief Team are sold tiers — but ask.ts's prompt selection assumes " +
        "the class is always 'premium'. Revisit resolveRequesterClass() and the " +
        "starter/professional product-knowledge variants before shipping this.",
    ).toEqual([]);
  });

  it("keeps the unexpected-class alarm, so a loosened gate cannot pass silently", () => {
    // The alarm is what turns unreachable code into a guarded invariant. If it
    // is removed, a future gate change goes unnoticed in production.
    expect(ASK_SRC).toContain("ask_entitlement_class_unexpected");
    expect(ASK_SRC).toMatch(/logger\.error\(\s*\{\s*event:\s*"ask_entitlement_class_unexpected"/);
  });

  it("still selects the prompt by class rather than hard-coding premium", () => {
    // Hard-coding the premium variant would make a future gate change leak
    // platform surface names into a lower tier's prompt. The class must keep
    // flowing through to systemPromptFor(). Matched loosely on the first
    // argument: the call also carries the requester's admin-ness (W-1), and
    // pinning the arity would fail on every future audience dimension without
    // saying anything about the property under test.
    expect(ASK_SRC).toMatch(/systemPromptFor\(requesterClass[,)]/);
    expect(ASK_SRC).not.toMatch(/systemPromptFor\("premium"/);
  });
});
