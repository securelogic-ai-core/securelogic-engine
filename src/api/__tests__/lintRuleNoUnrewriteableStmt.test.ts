/**
 * A04-G1 PR γ.0 — Approach A lint rule tests (§4.2).
 * RuleTester for valid/invalid cases; a flat Linter instance for the
 * eslint-disable escape-hatch case (§4.2 case 25).
 */
import { describe, it, expect } from "vitest";
import { RuleTester, Linter } from "eslint";

// @ts-expect-error — local ESM rule, no type declarations
import rule from "../../../eslint-rules/no-unrewriteable-stmt-in-tenant-wrap.js";

const RULE = "no-unrewriteable-stmt-in-tenant-wrap";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" }
});

// RuleTester.run throws on any failing case, so wrap it in a vitest `it`.
describe("eslint rule: no-unrewriteable-stmt-in-tenant-wrap", () => {
  it("passes the RuleTester valid/invalid matrix", () => {
    ruleTester.run(RULE, rule as never, {
      valid: [
        // 20: bare control inside a wrapped handler — fine.
        {
          code: `router.post("/x", asTenant(async (req, res) => { await client.query("BEGIN"); await client.query("COMMIT"); }));`
        },
        // 22 (proxy for baseline): ordinary SQL inside a wrap — fine.
        {
          code: `asTenant(async (req, res) => { await client.query("SELECT * FROM risks WHERE id = $1", [req.params.id]); });`
        },
        // forbidden token only as data — anchoring holds inside a wrap.
        {
          code: `asTenant(async (req, res) => { await client.query("SELECT 'BEGIN'"); });`
        },
        // 24: forbidden statement OUTSIDE any asTenant wrap — not reported.
        {
          code: `router.get("/x", async (req, res) => { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); });`
        },
        // dynamic string inside a wrap — rule can't see it (B's job), no report.
        {
          code: `asTenant(async (req, res) => { const sql = buildSql(); await client.query(sql); });`
        }
      ],
      invalid: [
        // 19: forbidden literal inline in a wrapped handler.
        {
          code: `asTenant(async (req, res) => { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        // 20: each forbidden family.
        {
          code: `asTenant(async (req, res) => { await client.query("START TRANSACTION"); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        {
          code: `asTenant(async (req, res) => { await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        {
          code: `asTenant(async (req, res) => { await client.query("SELECT pg_advisory_lock(1)"); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        {
          code: `asTenant(async (req, res) => { await client.query("LISTEN ch"); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        {
          code: `asTenant(async (req, res) => { await client.query("COPY t FROM STDIN"); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        // config-object { text } form.
        {
          code: `asTenant(async (req, res) => { await client.query({ text: "BEGIN WORK" }); });`,
          errors: [{ messageId: "unrewriteable" }]
        },
        // 21: forbidden statement inside a closure nested in the handler.
        {
          code: `asTenant(async (req, res) => { setImmediate(() => { client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); }); });`,
          errors: [{ messageId: "unrewriteable" }]
        }
      ]
    });
    expect(true).toBe(true); // run() would have thrown on failure
  });

  // 25: pgRaw escape hatch — explicit eslint-disable-next-line suppresses it.
  it("honours the eslint-disable escape-hatch line", () => {
    const linter = new Linter();
    const code = [
      `asTenant(async (req, res) => {`,
      `  // eslint-disable-next-line securelogic-local/${RULE} -- pgRaw escape hatch: needs SERIALIZABLE`,
      `  await rawClient.query("BEGIN ISOLATION LEVEL SERIALIZABLE");`,
      `});`
    ].join("\n");

    const messages = linter.verify(code, {
      plugins: { "securelogic-local": { rules: { [RULE]: rule as never } } },
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { [`securelogic-local/${RULE}`]: "error" }
    });

    expect(messages).toEqual([]);
  });

  // Control for 25: without the disable line, the same code IS reported.
  it("reports the same code when the disable line is absent", () => {
    const linter = new Linter();
    const code = `asTenant(async (req, res) => { await rawClient.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); });`;
    const messages = linter.verify(code, {
      plugins: { "securelogic-local": { rules: { [RULE]: rule as never } } },
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { [`securelogic-local/${RULE}`]: "error" }
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("unrewriteable");
  });
});
