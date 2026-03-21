import { Webhook } from "svix"

type VerifyWebhookArgs = {
  rawBody: string
  webhookSecret: string | undefined
  svixId: string | undefined
  svixTimestamp: string | undefined
  svixSignature: string | undefined
}

export function verifyWebhookSignature({
  rawBody,
  webhookSecret,
  svixId,
  svixTimestamp,
  svixSignature
}: VerifyWebhookArgs): boolean {
  if (!rawBody || !webhookSecret || !svixId || !svixTimestamp || !svixSignature) {
    return false
  }

  try {
    const webhook = new Webhook(webhookSecret)

    webhook.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature
    })

    return true
  } catch {
    return false
  }
}
