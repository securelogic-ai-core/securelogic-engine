export type BriefSignupInput = {
  email: string;
  name: string | null;
};

export type BriefSignupValidationError = {
  error: "invalid_email";
  status: 400;
};

export type BriefSignupValidationResult =
  | { input: BriefSignupInput }
  | BriefSignupValidationError;

function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function validateBriefSignup(
  body: unknown
): BriefSignupValidationResult {
  const raw = body as Record<string, unknown> | null | undefined;

  if (!isValidEmail(raw?.email)) {
    return { error: "invalid_email", status: 400 };
  }

  const email = String(raw!.email).trim().toLowerCase();

  const nameRaw = raw?.name;
  const name =
    typeof nameRaw === "string" && nameRaw.trim().length > 0
      ? nameRaw.trim().slice(0, 255)
      : null;

  return { input: { email, name } };
}
