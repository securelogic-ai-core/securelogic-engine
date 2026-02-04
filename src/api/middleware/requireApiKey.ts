function extractApiKey(req: Request): {
  key: string | null;
  source: "authorization" | "x-api-key" | "x-securelogic-key" | "query" | "none";
} {
  // 1) Authorization: Bearer <key>
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.length > 0) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return { key: m[1].trim(), source: "authorization" };
  }

  // 2) X-API-Key
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim()) {
    return { key: xApiKey.trim(), source: "x-api-key" };
  }

  // 3) X-SecureLogic-Key (recommended for Render/Cloudflare)
  const xSecureLogicKey = req.headers["x-securelogic-key"];
  if (typeof xSecureLogicKey === "string" && xSecureLogicKey.trim()) {
    return { key: xSecureLogicKey.trim(), source: "x-securelogic-key" };
  }

  // 4) Last-resort: query param (keep for debugging only)
  const q = req.query?.api_key;
  if (typeof q === "string" && q.trim()) {
    return { key: q.trim(), source: "query" };
  }

  return { key: null, source: "none" };
}