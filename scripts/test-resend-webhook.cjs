#!/usr/bin/env node

const crypto = require("crypto");

async function main() {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const baseUrl = process.env.WEBHOOK_TEST_BASE_URL || "http://localhost:4000";

  if (!secret) {
    console.error("Missing RESEND_WEBHOOK_SECRET");
    process.exit(1);
  }

  const eventId = process.argv[2] || `evt_local_${Date.now()}`;
  const email = process.argv[3] || "localtest@securelogic.ai";
  const eventType = process.argv[4] || "email.bounced";

  const payload = JSON.stringify({
    id: eventId,
    type: eventType,
    data: {
      id: eventId,
      to: email
    }
  });

  const svixId = `msg_${eventId}`;
  const svixTimestamp = Math.floor(Date.now() / 1000).toString();

  const secretPart = secret.split("_")[1];
  if (!secretPart) {
    console.error("RESEND_WEBHOOK_SECRET is malformed");
    process.exit(1);
  }

  const secretBytes = Buffer.from(secretPart, "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  const response = await fetch(`${baseUrl}/webhooks/email/resend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": `v1,${signature}`
    },
    body: payload
  });

  const text = await response.text();

  console.log(JSON.stringify({
    status: response.status,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })(),
    request: {
      eventId,
      email,
      eventType,
      svixId,
      svixTimestamp
    }
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
