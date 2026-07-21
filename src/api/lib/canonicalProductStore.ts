/**
 * canonicalProductStore.ts — writer for the global Canonical Product reference
 * (Enterprise Risk Graph convergence, Phase C1b). DARK: no live caller.
 *
 * Deterministic and idempotent: the same product identity (same `canonical_key`
 * from the C1 normalizer) always maps to exactly one `canonical_products` row via
 * ON CONFLICT upsert. Alias / external-id / version children dedupe on their
 * natural keys, so re-ingesting the same evidence is a no-op.
 *
 * GLOBAL / ORGANIZATION-NEUTRAL (ruling R1): these tables carry no tenant column,
 * so there is nothing to scope and nothing to leak. This writer therefore takes a
 * plain PoolClient and performs NO org filtering — by design.
 *
 * R2 invariant: a vendor-only identity is NOT a product and is rejected — it must
 * never be stored as a Canonical Product (and so can never seed an `affected`).
 */

import type { PoolClient } from "pg";
import { canonicalProductIdentity, type ProductIdentityInput } from "./canonicalProduct.js";
import { canonicalizeVendorName } from "./vendorNameCanonical.js";

export interface CanonicalProductInput {
  identity: ProductIdentityInput;
  displayName?: string | null;
  /** Alternate raw names + their provenance source. */
  aliases?: Array<{ raw: string; source: string }>;
  /** Authoritative identifiers / external mappings (CPE optional — one scheme). */
  externalIds?: Array<{ scheme: string; identifier: string; source: string }>;
  /** Known versions + provenance. */
  versions?: Array<{ raw: string; normalized?: string | null; source: string }>;
}

export interface CanonicalProductRecord {
  id: string;
  canonical_key: string;
  vendor_canonical: string | null;
  product_canonical: string | null;
}

export class NotProductIdentifiableError extends Error {
  constructor() {
    super("canonical_product_not_identifiable");
    this.name = "NotProductIdentifiableError";
  }
}

/**
 * Idempotently upsert a Canonical Product and its provenance children within the
 * caller's transaction. Returns the product record. Rejects a non-identifiable
 * (e.g. vendor-only) identity per R2.
 */
export async function upsertCanonicalProduct(
  client: PoolClient,
  input: CanonicalProductInput
): Promise<CanonicalProductRecord> {
  const identity = canonicalProductIdentity(input.identity);
  if (!identity.identifiable) {
    throw new NotProductIdentifiableError();
  }

  const upsert = await client.query<CanonicalProductRecord>(
    `INSERT INTO canonical_products (canonical_key, vendor_canonical, product_canonical, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (canonical_key) DO UPDATE
       SET updated_at   = NOW(),
           display_name = COALESCE(canonical_products.display_name, EXCLUDED.display_name)
     RETURNING id, canonical_key, vendor_canonical, product_canonical`,
    [identity.canonical_key, identity.vendor_canonical, identity.product_canonical, input.displayName ?? null]
  );
  const product = upsert.rows[0]!;

  for (const alias of input.aliases ?? []) {
    const aliasCanonical = canonicalizeVendorName(alias.raw);
    if (aliasCanonical === "") continue; // an empty normalization is not a usable alias
    await client.query(
      `INSERT INTO canonical_product_aliases (product_id, alias_raw, alias_canonical, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, alias_canonical, source) DO NOTHING`,
      [product.id, alias.raw, aliasCanonical, alias.source]
    );
  }

  for (const ext of input.externalIds ?? []) {
    await client.query(
      `INSERT INTO canonical_product_external_ids (product_id, scheme, identifier, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, scheme, identifier) DO NOTHING`,
      [product.id, ext.scheme, ext.identifier, ext.source]
    );
  }

  for (const ver of input.versions ?? []) {
    await client.query(
      `INSERT INTO canonical_product_versions (product_id, version_raw, version_normalized, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, version_raw, source) DO NOTHING`,
      [product.id, ver.raw, ver.normalized ?? null, ver.source]
    );
  }

  return product;
}
