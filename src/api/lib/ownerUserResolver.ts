/**
 * ownerUserResolver.ts — verify an owner_user_id belongs to the
 * caller's organization, and return the user's name for denormalization
 * into the legacy `owner` TEXT column.
 *
 * Used by POST/PATCH on risks and risk_treatments. Risk owner and
 * treatment owner are tracked as a UUID FK to users(id); the legacy
 * TEXT `owner` column is kept in sync as a fallback for display when
 * the FK user is later deleted.
 *
 * Inactive users (status='inactive') are rejected — assigning a
 * deactivated user as the current owner is almost certainly a mistake.
 */

type QueryRunner = {
  query: <T>(
    sql: string,
    params: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export type OwnerUserResolveResult =
  | { name: string }
  | { error: "owner_user_not_in_organization" };

export async function resolveOwnerUserSameOrg(
  client: QueryRunner,
  userId: string,
  organizationId: string
): Promise<OwnerUserResolveResult> {
  const result = await client.query<{ name: string | null }>(
    `SELECT name FROM users
     WHERE id = $1 AND organization_id = $2 AND status != 'inactive'
     LIMIT 1`,
    [userId, organizationId]
  );
  if ((result.rowCount ?? 0) === 0) {
    return { error: "owner_user_not_in_organization" };
  }
  const raw = (result.rows[0]?.name ?? "").trim();
  return { name: raw.length > 0 ? raw : "Unknown" };
}
