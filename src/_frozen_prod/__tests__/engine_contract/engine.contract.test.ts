import { describe, it, expect } from "vitest";
import { RunnerEngine } from "../../../engine/RunnerEngine.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const golden = (p: string) => path.join(__dirname, "goldens", p);

// Remove non-deterministic fields before comparison
const strip = (o: any) =>
  JSON.parse(
    JSON.stringify(o, (k, v) =>
      ["date", "generatedAt", "ledgerHash"].includes(k) ? undefined : v
    )
  );

describe("Engine Contract", () => {
  it("produces the same canonical output for v1 input", async () => {
    const input = JSON.parse(fs.readFileSync(golden("input.v1.json"), "utf-8"));
    const expected = JSON.parse(fs.readFileSync(golden("output.v1.json"), "utf-8"));

    const engine = new RunnerEngine();
    const actual = await engine.run(input);

    expect(strip(actual)).toEqual(strip(expected));
  });
});
