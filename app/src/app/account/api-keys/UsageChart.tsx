"use client";

interface DailyPoint {
  date: string;
  total: number;
}

interface Props {
  daily: DailyPoint[];
  days?: number;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function UsageChart({ daily, days = 14 }: Props) {
  // Build a complete series for the last `days` days (fill gaps with 0)
  const series: DailyPoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const byDate = new Map(daily.map((d) => [d.date, d.total]));

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, total: byDate.get(key) ?? 0 });
  }

  const maxCount = Math.max(1, ...series.map((d) => d.total));

  return (
    <div>
      {/* Bars */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "4px",
          height: "60px",
        }}
      >
        {series.map((point) => {
          const heightPct = point.total > 0
            ? Math.max(3, Math.round((point.total / maxCount) * 100))
            : 2;
          return (
            <div
              key={point.date}
              style={{
                flex: 1,
                height: `${heightPct}%`,
                minHeight: point.total > 0 ? "3px" : "2px",
                background: point.total > 0 ? "#00c4b4" : "#1e293b",
                borderRadius: "2px 2px 0 0",
              }}
              title={`${formatDateLabel(point.date)}: ${point.total.toLocaleString()} call${point.total !== 1 ? "s" : ""}`}
            />
          );
        })}
      </div>
      {/* Date labels — show every 7th */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          marginTop: "4px",
        }}
      >
        {series.map((point, i) => (
          <div
            key={point.date}
            style={{
              flex: 1,
              fontSize: "10px",
              color: "#475569",
              textAlign: "center",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {i % 7 === 0 ? formatDateLabel(point.date) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
