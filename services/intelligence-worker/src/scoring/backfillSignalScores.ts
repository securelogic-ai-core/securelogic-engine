import { pg } from "../../../../src/api/infra/postgres.js"
import { scoreSignal } from "./scoreSignal.js"

async function run() {
  const result = await pg.query(`
    SELECT id, title, source, summary, tags
    FROM signals
    ORDER BY created_at DESC
  `)

  let updated = 0

  for (const row of result.rows) {
    const scores = scoreSignal({
      title: row.title,
      source: row.source,
      summary: row.summary ?? "",
      tags: Array.isArray(row.tags) ? row.tags : []
    })

    await pg.query(
      `
      UPDATE signals
      SET
        impact_score = $2,
        novelty_score = $3,
        relevance_score = $4,
        priority = $5
      WHERE id = $1
      `,
      [
        row.id,
        scores.impactScore,
        scores.noveltyScore,
        scores.relevanceScore,
        scores.priority
      ]
    )

    updated++
  }

  console.log("Signals scored:", updated)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
