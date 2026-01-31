import { runNewsletterOutput } from "./runNewsletterOutput";

const free = await runNewsletterOutput("FREE");
const paid = await runNewsletterOutput("PAID");

console.log("FREE count:", free.length);
console.log("PAID count:", paid.length);
console.log("FREE sample:", free[0]);
console.log("PAID sample:", paid[0]);
