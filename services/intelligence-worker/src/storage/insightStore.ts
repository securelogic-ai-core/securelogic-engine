import { db } from "./db";

export function saveInsight(signalId: number, insight: string, riskScore: number) {
  const stmt = db.prepare(`
    INSERT INTO insights
    (signal_id, insight, risk_score, created_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(signalId, insight, riskScore, new Date().toISOString());
}

export function getInsights() {
  return db.prepare(`
    SELECT * FROM insights
    ORDER BY created_at DESC
  `).all();
}
