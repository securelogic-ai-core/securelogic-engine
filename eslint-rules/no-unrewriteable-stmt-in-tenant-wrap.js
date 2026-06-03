/**
 * ESLint rule: no-unrewriteable-stmt-in-tenant-wrap
 * A04-G1 PR γ.0 — Approach A (dev-time fast feedback).
 *
 * Flags transaction-control / session-level statements that
 * `createSavepointClient` does NOT rewrite, when they appear as a STATIC string
 * inside a handler wrapped in `asTenant(...)`. Such a statement would execute
 * un-rewritten on the request's tenant client and corrupt the wrap's
 * transaction (a real nested BEGIN, a leaking session lock, etc.).
 *
 * Scope: lexically inside the function argument to `asTenant(...)` (and any
 * closure nested in it) — the in-wrap stack. Today's only wrap shape is the
 * inline form `asTenant(async (req,res) => { … })`. A handler passed by
 * reference is not seen here; the runtime guard (Approach B, in
 * tenantContext.ts) is the load-bearing layer that also covers helper-deep and
 * dynamically-built statements. See docs/A04-G1-pr-gamma0-design.md §3 / §5.
 *
 * Escape hatch: the legitimate `pgRaw` path (tenantContext.ts:44-53) owns its
 * own real transaction and is safe; suppress this rule on that line with an
 * explicit `// eslint-disable-next-line ... -- pgRaw escape hatch: <reason>`.
 *
 * Matcher MUST stay in sync with `isUnrewriteableStatement` in
 * src/api/infra/tenantContext.ts §2.2 (single source of truth at runtime).
 */

function isUnrewriteableStatement(kw) {
  if (/^BEGIN\b/.test(kw) && kw !== "BEGIN") return true;
  if (/^COMMIT\b/.test(kw) && kw !== "COMMIT") return true;
  if (/^ROLLBACK\b/.test(kw) && kw !== "ROLLBACK") return true;
  if (/^END\b/.test(kw)) return true; // COMMIT synonym
  if (/^START\s+TRANSACTION\b/.test(kw)) return true;
  if (/^SET\s+TRANSACTION\b/.test(kw)) return true;
  if (/^SET\s+LOCAL\s+TRANSACTION\b/.test(kw)) return true;
  if (/^SELECT\s+PG_ADVISORY_/.test(kw)) return true;
  if (/^(LISTEN|UNLISTEN|NOTIFY)\b/.test(kw)) return true;
  if (/^COPY\b/.test(kw)) return true;
  return false;
}

/** Extract a static string from a `.query()` first argument, else null. */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  if (node.type === "ObjectExpression") {
    for (const p of node.properties) {
      if (
        p.type === "Property" &&
        ((p.key.type === "Identifier" && p.key.name === "text") ||
          (p.key.type === "Literal" && p.key.value === "text"))
      ) {
        return staticString(p.value);
      }
    }
  }
  return null;
}

function isAsTenantHandler(node) {
  const parent = node.parent;
  return (
    !!parent &&
    parent.type === "CallExpression" &&
    parent.callee.type === "Identifier" &&
    parent.callee.name === "asTenant" &&
    parent.arguments[0] === node
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid un-rewriteable transaction-control / session statements inside an asTenant() handler (A04-G1 γ.0).",
      recommended: true
    },
    schema: [],
    messages: {
      unrewriteable:
        'Statement "{{stmt}}" is not rewriteable by createSavepointClient and would run un-rewritten on the asTenant request transaction. If this is a legitimate pgRaw escape (tenantContext.ts:44-53), suppress with an explicit eslint-disable-next-line and a reason.'
    }
  },
  create(context) {
    let depth = 0;
    return {
      ":function"(node) {
        if (isAsTenantHandler(node)) depth += 1;
      },
      ":function:exit"(node) {
        if (isAsTenantHandler(node)) depth -= 1;
      },
      CallExpression(node) {
        if (depth === 0) return;
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "query"
        ) {
          return;
        }
        const sql = staticString(node.arguments[0]);
        if (sql === null) return; // dynamic — runtime guard (B) covers it
        if (isUnrewriteableStatement(sql.trim().toUpperCase())) {
          context.report({
            node,
            messageId: "unrewriteable",
            data: { stmt: sql }
          });
        }
      }
    };
  }
};
