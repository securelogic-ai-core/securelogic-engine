import { runSignalPipeline } from "./runSignalPipeline";

const signals = await runSignalPipeline();

console.log("Signals:", signals.length);
console.log("Sample:", JSON.stringify(signals[0], null, 2));
