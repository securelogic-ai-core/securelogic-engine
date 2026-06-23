import { logger } from "./logger.js"

/**
 * alerting.ts — operator webhook delivery, Slack- or Discord-shaped per target.
 *
 * The `ALERT_WEBHOOK_URL` env var points at either a Slack incoming webhook
 * (https://hooks.slack.com/services/...) or a Discord channel webhook
 * (https://discord.com/api/webhooks/{id}/{token}). Both alert functions build
 * the SAME internal embed structure ({title, description, color, fields,
 * footer}) and then serialize it to whichever payload shape the destination
 * accepts — Slack Block Kit (`{text, blocks}`) or Discord (`{embeds: [...]}`).
 * Slack rejects a Discord `{embeds}` body with HTTP 400, so the shape must
 * match the host.
 *
 * Format is chosen by `detectWebhookFormat()` from the URL hostname:
 *   - discord.com / discordapp.com (and subdomains) → Discord `{embeds}`
 *   - hooks.slack.com, and any other / unparseable host → Slack blocks
 *     (Slack is the most common target, so it is the safe default)
 *
 * Contracts preserved across the dual-format reshape:
 *   - No-op when `ALERT_WEBHOOK_URL` is unset (same `alert_skipped` /
 *     `security_alert_skipped` debug events).
 *   - Throws on non-2xx webhook response (Slack returns 200, Discord 204 on
 *     success; `response.ok` covers both). Callers decide whether to swallow.
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
  | "vendor_queue_backlog"
  | "feed_source_down"

const KIND_META: Record<SecurityAlertKind, { emoji: string; label: string; color: number }> = {
  account_locked:           { emoji: "🔒", label: "Account locked",           color: COLOR_SECURITY_HIGH },
  credential_stuffing:      { emoji: "🚨", label: "Credential stuffing",      color: COLOR_SECURITY_HIGH },
  api_key_probing:          { emoji: "🔑", label: "API key probing",          color: COLOR_SECURITY_HIGH },
  provider_quota_exhausted: { emoji: "💸", label: "Provider quota exhausted", color: COLOR_OPERATIONAL  },
  vendor_queue_backlog:     { emoji: "📥", label: "Vendor queue backlog",     color: COLOR_OPERATIONAL  },
  feed_source_down:         { emoji: "📡", label: "Feed source down",         color: COLOR_OPERATIONAL  }
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

// ---------------------------------------------------------------------------
// Webhook format selection + serialization
//
// Both alert functions build a `DiscordEmbed` (the internal structure) and
// hand it to `buildWebhookBody`, which picks the wire shape from the URL host.
// ---------------------------------------------------------------------------

export type WebhookFormat = "slack" | "discord"

/**
 * Choose the payload shape from the webhook URL's hostname.
 *   - discord.com / discordapp.com (or a subdomain) → "discord"
 *   - everything else (hooks.slack.com, unknown hosts, unparseable URLs) →
 *     "slack", the most common webhook target and our active destination.
 */
export function detectWebhookFormat(url: string): WebhookFormat {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return "slack"
  }
  if (
    host === "discord.com" ||
    host === "discordapp.com" ||
    host.endsWith(".discord.com") ||
    host.endsWith(".discordapp.com")
  ) {
    return "discord"
  }
  return "slack"
}

// Slack Block Kit limits — https://api.slack.com/reference/block-kit/blocks
const SLACK_HEADER_MAX = 150        // header block plain_text limit
const SLACK_SECTION_TEXT_MAX = 3000 // section block text/field mrkdwn limit
const SLACK_FIELDS_PER_SECTION = 10 // section block `fields` array cap

interface SlackTextObject { type: "plain_text" | "mrkdwn"; text: string; emoji?: boolean }
interface SlackBlock {
  type: "header" | "section" | "context"
  text?: SlackTextObject
  fields?: SlackTextObject[]
  elements?: SlackTextObject[]
}
interface SlackMessage { text: string; blocks: SlackBlock[] }

/**
 * Serialize the internal embed structure into a Slack Block Kit message:
 *   - title       → `header` block (plain_text, emoji enabled)
 *   - description → `section` block (mrkdwn)
 *   - fields      → `section` block(s) with a `fields` array of mrkdwn
 *                   `*name*\nvalue` cells, chunked to Slack's 10-per-section cap
 *   - footer      → `context` block (mrkdwn)
 * Plus a top-level `text` fallback used for notification previews / push.
 */
function embedToSlackMessage(embed: DiscordEmbed): SlackMessage {
  const blocks: SlackBlock[] = []

  if (embed.title) {
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: truncate(embed.title, SLACK_HEADER_MAX), emoji: true }
    })
  }

  if (embed.description) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: truncate(embed.description, SLACK_SECTION_TEXT_MAX) }
    })
  }

  const fields = embed.fields ?? []
  for (let i = 0; i < fields.length; i += SLACK_FIELDS_PER_SECTION) {
    const chunk = fields.slice(i, i + SLACK_FIELDS_PER_SECTION)
    blocks.push({
      type: "section",
      fields: chunk.map((f) => ({
        type: "mrkdwn",
        text: truncate(`*${f.name}*\n${f.value}`, SLACK_SECTION_TEXT_MAX)
      }))
    })
  }

  if (embed.footer) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: truncate(embed.footer.text, SLACK_SECTION_TEXT_MAX) }]
    })
  }

  const fallback = [embed.title, embed.description].filter(Boolean).join(" — ")
  return {
    text: truncate(fallback || "securelogic-engine alert", SLACK_SECTION_TEXT_MAX),
    blocks
  }
}

/**
 * Build the webhook request body for the configured target. Discord keeps its
 * existing `{embeds: [...]}` shape exactly; everything else gets Slack blocks.
 */
export function buildWebhookBody(
  url: string,
  embed: DiscordEmbed
): SlackMessage | { embeds: DiscordEmbed[] } {
  return detectWebhookFormat(url) === "discord"
    ? { embeds: [embed] }
    : embedToSlackMessage(embed)
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
    body: JSON.stringify(buildWebhookBody(alertUrl, embed))
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
    body: JSON.stringify(buildWebhookBody(alertUrl, embed))
  })

  if (!response.ok) {
    throw new Error(`security alert webhook failed with status ${response.status}`)
  }
}
