const vendorName = vendorResult.rows[0].name as string;
const performedAt =
  input.performed_at ?? new Date().toISOString().slice(0, 10);

// Insert the vendor assessment record.
const assessmentResult = await client.query(
  `
  INSERT INTO vendor_assessments (
    organization_id,
    vendor_id,
    assessment_type,
    overall_severity,
    status,
    summary,
    notes,
    performed_at,
    reviewer_id
  )
  VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8)
  RETURNING ${ASSESSMENT_SELECT}
  `,
  [
    organizationId,
    input.vendor_id,
    input.assessment_type,
    input.overall_severity,
    input.summary ?? null,
    input.notes ?? null,
    performedAt,
    input.reviewer_id ?? null
  ]
);