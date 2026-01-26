#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { RunnerEngine } from "./engine/RunnerEngine.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: securelogic-engine <input.json> [V1|V2]");
    process.exit(1);
  }

  const inputArg = args[0];
  const version = args[1] === "V2" ? "V2" : "V1";

  if (!inputArg) {
    throw new Error("Missing input file path");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);

  const raw = fs.readFileSync(inputPath, "utf-8");
  const input = JSON.parse(raw);

  const engine = new RunnerEngine(undefined, version);
  const result = await engine.run(input);

  process.stdout.write(JSON.stringify(result, null, 2));
}

// Only run if this file is the actual entrypoint
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}