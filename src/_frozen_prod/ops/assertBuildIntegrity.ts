import fs from "fs";

const required = ["dist/api", "dist/frameworks"];

for (const path of required) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing build artifact: ${path}`);
  }
}
