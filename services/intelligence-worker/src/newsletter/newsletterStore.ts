import fs from "fs/promises";

const FILE = "./data/newsletter.json";

export async function saveNewsletter(issue: any) {
  await fs.writeFile(FILE, JSON.stringify([issue], null, 2));
}