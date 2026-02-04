function extractApiKey(
  req: Request
): {
  key: string | null;
  source: "authorization" | "x-api-key" | "x-securelogic-key" | "query" | "none";
} {
  // 1) Authorization: Bearer <key>
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.length > 0) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return { key: match[1].trim(), source: "authorization" };
    }
  }

  // 2) X-API-Key
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim().length > 0) {
    return { key: xApiKey.trim(), source: "x-api-key" };
  }

  // 3) X-SecureLogic-Key (Cloudflare / Render safe)
  const xSecureLogicKey = req.headers["x-securelogic-key"];
  if (
    typeof xSecureLogicKey === "string" &&
    xSecureLogicKey.trim().length > 0
  ) {
    return {
      key: xSecureLogicKey.trim(),
      source: "x-securelogic-key"
    };
  }

  // 4) Query param fallback (debug-only)
  const q = req.query?.api_key;
  if (typeof q === "string" && q.trim().length > 0) {
    return { key: q.trim(), source: "query" };
  }

  return { key: null, source: "none" };
}