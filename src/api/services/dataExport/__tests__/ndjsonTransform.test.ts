/**
 * ndjsonTransform.test.ts — the pure line encoder and the object→NDJSON stream.
 */

import { describe, it, expect } from "vitest";
import { rowToNdjsonLine, createNdjsonTransform } from "../ndjsonTransform";

describe("rowToNdjsonLine", () => {
  it("serializes a row to one JSON line with a trailing newline", () => {
    expect(rowToNdjsonLine({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}\n');
  });

  it("preserves null and nested values", () => {
    expect(rowToNdjsonLine({ a: null, b: { c: [1, 2] } })).toBe('{"a":null,"b":{"c":[1,2]}}\n');
  });

  it("throws on a non-serializable value rather than emitting 'undefined'", () => {
    expect(() => rowToNdjsonLine(undefined)).toThrow(TypeError);
    expect(() => rowToNdjsonLine(() => 0)).toThrow(TypeError);
  });
});

describe("createNdjsonTransform", () => {
  async function run(objects: unknown[]): Promise<string> {
    const t = createNdjsonTransform();
    const chunks: Buffer[] = [];
    t.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    const done = new Promise<void>((resolve, reject) => {
      t.on("end", resolve);
      t.on("error", reject);
    });
    for (const o of objects) t.write(o);
    t.end();
    await done;
    return Buffer.concat(chunks).toString("utf8");
  }

  it("emits one NDJSON line per object", async () => {
    expect(await run([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}\n');
  });

  it("produces empty output for no rows", async () => {
    expect(await run([])).toBe("");
  });

  it("surfaces a serialization error on the stream", async () => {
    const t = createNdjsonTransform();
    const err = new Promise<Error>((resolve) => t.on("error", resolve));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    t.write(circular);
    expect(await err).toBeInstanceOf(Error);
  });
});
