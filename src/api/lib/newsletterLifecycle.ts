export type NewsletterIssueStatus = "draft" | "queued" | "sent" | "canceled"

export function canPromoteIssue(status: string): boolean {
  return status === "draft"
}

export function canCancelIssue(status: string): boolean {
  return status === "draft" || status === "queued"
}

export function canDeleteIssue(status: string): boolean {
  return status === "draft" || status === "canceled"
}

export function canMarkIssueSent(status: string): boolean {
  return status === "queued"
}
