import * as fs from "fs";

export function loadCatalogFiles(paths: string[]) {
  let allControls: any[] = [];

  for (const p of paths) {
    const raw = fs.readFileSync(p, "utf-8");
    const json = JSON.parse(raw);

    if (!Array.isArray(json.controls)) {
      throw new Error(`Invalid catalog format in ${p}`);
    }

    allControls = allControls.concat(json.controls);
  }

  return allControls;
}
