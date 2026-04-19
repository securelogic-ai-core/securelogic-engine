"use server";

import { getSession } from "@/lib/session";
import {
  createWebhook,
  deleteWebhook,
  testWebhook,
  getWebhookDeliveries,
  type WebhookEndpointWithSecret,
  type WebhookDelivery,
} from "@/lib/api";

export async function createWebhookAction(data: {
  url: string;
  description?: string;
  event_types?: string[];
}): Promise<{ endpoint: WebhookEndpointWithSecret } | { error: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return { error: "Not authenticated" };

  const result = await createWebhook(token, data);
  if (!result) return { error: "Failed to create webhook endpoint." };
  return result;
}

export async function deleteWebhookAction(id: string): Promise<boolean> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return false;
  return deleteWebhook(token, id);
}

export async function testWebhookAction(
  id: string
): Promise<WebhookDelivery | null> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return null;
  const result = await testWebhook(token, id);
  return result?.delivery ?? null;
}

export async function getDeliveriesAction(
  endpointId: string
): Promise<WebhookDelivery[] | null> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return null;
  const result = await getWebhookDeliveries(token, endpointId);
  return result?.deliveries ?? null;
}
