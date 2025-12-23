export function validateAuditSprintInput(body: any) {
  console.log("VALIDATOR HIT — BODY KEYS:", Object.keys(body || {}));

  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  const payload = body.data ?? body;
  const keys = Object.keys(payload).filter(k => k !== "license");

  if (keys.length === 0) {
    return "At least one control response is required";
  }

  return null;
}
