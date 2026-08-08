import type { Request, Response, NextFunction } from "express";

/**
 * requireTeamCapability — gate for the team-management routes (#692 A2).
 *
 * The defect: Brief Team orgs land at entitlement_level='professional'
 * (rank 2) while every team-invite route demanded requireEntitlement("premium")
 * (rank 4) — so every paying Brief Team customer 403'd on the tier's headline
 * feature.
 *
 * Mechanism (narrowest of the options filed in #692): platform ranks pass
 * exactly as before, PLUS an explicit allowance for the 'teams' Stripe tier.
 * The global rank lattice is untouched — Brief Pro ('professional' tier)
 * still cannot reach team routes, and none of the other 215 premium gates
 * change meaning. Seat enforcement is unchanged: passing this gate still
 * lands every member-creation in the seatLimit check (cap 6 for Brief Team).
 *
 * Mount AFTER attachOrganizationContext (needs entitlementLevel +
 * stripeSubscriptionTier from the org row).
 */
export function requireTeamCapability() {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as any).organizationContext as
      | { entitlementLevel: string | null; stripeSubscriptionTier: string | null }
      | undefined;

    if (!ctx) {
      // Same contract as requireEntitlement when mounted without context.
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    const level = (ctx.entitlementLevel ?? "starter").toLowerCase();
    const platformRank =
      level === "premium" || level === "platform" || level === "team";
    const briefTeamTier = ctx.stripeSubscriptionTier === "teams";

    if (platformRank || briefTeamTier) {
      next();
      return;
    }

    res.status(403).json({
      error: "insufficient_entitlement",
      required: "premium",
      current: level,
      detail: "Team management requires a Brief Team or Platform plan.",
    });
  };
}
