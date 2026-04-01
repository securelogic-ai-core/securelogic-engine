import { cleanText } from "../utils/contentSanitizer.js";
import { pool } from "./db.js";

export async function saveInsight(insight: any) {
  const query = `
    INSERT INTO insights (
      signal_id,
      title,
      analysis,
      recommendation,
      risk_level,
      audience,
      category,
      published,
      linked_sources
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id
  `;

  const values = [
    insight.signalId,
    cleanText(insight.title),
    cleanText(insight.analysis),
    cleanText(insight.recommendation),
    insight.riskLevel,
    insight.audience,
    insight.category,
    false,
    insight.linkedSources || []
  ];

  const result = await pool.query(query, values);
  return result.rows[0].id;
}
