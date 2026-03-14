import fs from "fs/promises";
import { Resend } from "resend";

const HTML_FILE = "./data/newsletter.html";

export async function sendNewsletter() {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NEWSLETTER_TO_EMAIL;
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }

  if (!toEmail) {
    throw new Error("NEWSLETTER_TO_EMAIL is not set.");
  }

  if (!fromEmail) {
    throw new Error("NEWSLETTER_FROM_EMAIL is not set.");
  }

  const resend = new Resend(apiKey);
  const html = await fs.readFile(HTML_FILE, "utf8");

  const subject = `SecureLogic Intelligence Brief - ${new Date().toISOString().slice(0, 10)}`;

  const result = await resend.emails.send({
    from: fromEmail,
    to: [toEmail],
    subject,
    html
  });

  console.log("Newsletter delivery completed.");
  console.log("Resend response:", result);
}