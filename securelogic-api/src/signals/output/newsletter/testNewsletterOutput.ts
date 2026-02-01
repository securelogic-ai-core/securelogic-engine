import { runNewsletterOutput } from "./runNewsletterOutput.js";

async function test() {
  const preview = await runNewsletterOutput("PREVIEW");
  const paid = await runNewsletterOutput("PAID");

  if (!preview.length) {
    throw new Error("Preview output empty");
  }

  if (!paid.length) {
    throw new Error("Paid output empty");
  }

  console.log("Newsletter output tests passed");
}

test();
