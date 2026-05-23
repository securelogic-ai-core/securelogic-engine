import { logger } from "./logger.js"

/**
 * alerting.ts — operator webhook delivery via Discord-compatible payload.
 *
 * The `ALERT_WEBHOOK_URL` env var points at a Discord channel webhook
 * (https://discord.com/api/webhooks/{id}/{token}). Both functions emit
 * `{embeds: [...]}` payloads matching Discord's webhook schema so the
 * destination channel renders rich, structured messages instead of
 * rejecting an arbitrary JSON shape.
 *
 * Contracts preserved across the Discord-reshape:
 *   - No-op when `ALERT_WEBHOOK_URL` is unset (same `alert_skipped` /
 *     `security_alert_skipped` debug events).
 *   - Throws on non-2xx webhook response (Discord returns 204 on success;
 *     `response.ok` covers it). Callers decide whether to swallow.
 *   - Function signatures unchanged — no call site touched by this file.
 *
 * Title prefixes + embed color let operators distinguish kinds at a glance:
 *   - 🔒 red       account_locked
 *   - 🚨 red       credential_stuffing
 *   - 🔑 red       api_key_probing
 *   - 💸 orange    provider_quota_exhausted
 *   - ⚠️ yellow    worker failure (sendFailureAlert)
 */

// Discord embed limits — see https://discord.com/developers/docs/resources/channel#embed-limits
const DISCORD_TITLE_MAX = 256
const DISCORD_DESCRIPTION_MAX = 4096
const DISCORD_FIELD_NAME_MAX = 256
const DISCORD_FIELD_VALUE_MAX = 1024

// Color palette (decimal RGB ints, as Discord expects).
const COLOR_SECURITY_HIGH = 0xCC0000  // red — high-severity auth security
const COLOR_OPERATIONAL   = 0xFF9900  // orange — operational urgency (quota)
const COLOR_WORKER_FAIL   = 0xFFCC00  // yellow — worker run failure

type SecurityAlertKind =
  | "account_locked"
  | "credential_stuffing"
  | "api_key_probing"
  | "provider_quota_exhausted"

const KIND_META: Record<SecurityAlertKind, { emoji: string; label: string; color: number }> = {
  account_locked:           { emoji: "🔒", label: "Account locked",           color: COLOR_SECURITY_HIGH },
  credential_stuffing:      { emoji: "🚨", label: "Credential stuffing",      color: COLOR_SECURITY_HIGH },
  api_key_probing:          { emoji: "🔑", label: "API key probing",          color: COLOR_SECURITY_HIGH },
  provider_quota_exhausted: { emoji: "💸", label: "Provider quota exhausted", color: COLOR_OPERATIONAL  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
}

interface DiscordEmbedField { name: string; value: string; inline?: boolean }
interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: { text: string }
}

function detailToFields(detail: Record<string, unknown> | undefined): DiscordEmbedField[] {
  if (!detail) return []
  const fields: DiscordEmbedField[] = []
  for (const [key, raw] of Object.entries(detail)) {
    if (raw === undefined || raw === null) continue
    const value =
      typeof raw === "string"
        ? raw
        : typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : JSON.stringify(raw)
    fields.push({
      name: truncate(key, DISCORD_FIELD_NAME_MAX),
      value: truncate(value, DISCORD_FIELD_VALUE_MAX),
      inline: true
    })
  }
  return fields
}

export async function sendFailureAlert(
  workerName: string,
  errorMessage: string
): Promise<void> {
  const alertUrl = (process.env.ALERT_WEBHOOK_URL ?? "").trim()

  if (!alertUrl) {
    logger.debug({ event: "alert_skipped", worker: workerName }, "ALERT_WEBHOOK_URL not set; skipping alert")
    return
  }

  const timestamp = new Date().toISOString()
  const embed: DiscordEmbed = {
    title: truncate(`⚠️ Worker failure: ${workerName}`, DISCORD_TITLE_MAX),
    description: truncate("```\n" + errorMessage + "\n```", DISCORD_DESCRIPTION_MAX),
    color: COLOR_WORKER_FAIL,
    fields: [
      { name: "Worker",    value: truncate(workerName, DISCORD_FIELD_VALUE_MAX), inline: true },
      { name: "Timestamp", value: timestamp, inline: true }
    ],
    footer: { text: "securelogic-engine · worker_failure" }
  }

  const response = await fetch(alertUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] })
  })

  if (!response.ok) {
    throw new Error(`alert webhook failed with status ${response.status}`)
  }
}

/**
 * Operator security-anomaly alert. Sibling of sendFailureAlert — same
 * ALERT_WEBHOOK_URL channel, distinct embed shape (title prefix + color
 * encode the kind).
 *
 * No-op when ALERT_WEBHOOK_URL is unset (same contract as sendFailureAlert).
 * Throws on a non-2xx webhook response; callers decide whether to swallow
 * (the synchronous auth path) or log (the Tier 2 cron).
 */
export async function sendSecurityAlert(args: {
  kind: SecurityAlertKind
  summary: string
  detail?: Record<string, unknown>
}): Promise<void> {
  const alertUrl = (process.env.ALERT_WEBHOOK_URL ?? "").trim()

  if (!alertUrl) {
    logger.debug(
      { event: "security_alert_skipped", kind: args.kind },
      "ALERT_WEBHOOK_URL not set; skipping security alert"
    )
    return
  }

  const meta = KIND_META[args.kind]
  const timestamp = new Date().toISOString()
  const fields: DiscordEmbedField[] = [
    { name: "Kind",      value: args.kind, inline: true },
    { name: "Timestamp", value: timestamp, inline: true },
    ...detailToFields(args.detail)
  ]

  const embed: DiscordEmbed = {
    title: truncate(`${meta.emoji} ${meta.label}`, DISCORD_TITLE_MAX),
    description: truncate(args.summary, DISCORD_DESCRIPTION_MAX),
    color: meta.color,
    fields,
    footer: { text: "securelogic-engine · security_alert" }
  }

  const response = await fetch(alertUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] })
  })

  if (!response.ok) {
    throw new Error(`security alert webhook failed with status ${response.status}`)
  }
}
