const fs = require("fs");

function check(file) {
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");

  if (
    text.includes("EOF") ||
    text.includes("return target;]") ||
    text.includes("urceValue") ||
    text.includes("yof T") ||
    text.includes("EOFort")
  ) {
    throw new Error(`❌ Corrupted file detected: ${file}`);
  }
}

[
  "src/engine/factories/ControlStateFactory.ts",
  "src/engine/schema/QuestionnaireSchema.ts",
  "src/engine/schema/buildQuestionnaireSchema.ts"
].forEach(check);

console.log("✅ Prebuild integrity check passed");
