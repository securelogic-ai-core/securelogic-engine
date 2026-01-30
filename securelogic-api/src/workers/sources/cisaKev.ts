export async function ingestCisaKev() {
  const res = await fetch(
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
  );

  const data = await res.json();

  return data.vulnerabilities.map((v: any) => ({
    source: "CISA KEV",
    title: `${v.vendorProject} ${v.product} – ${v.cveID}`,
    url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    category: "Vulnerability",
    publishedAt: new Date(v.dateAdded),
    rawPayload: v, // 🔒 REQUIRED
  }));
}