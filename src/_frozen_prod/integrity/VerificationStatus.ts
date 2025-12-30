export type VerificationStatus =
  | { status: "VALID" }
  | { status: "INVALID_SIGNATURE" }
  | { status: "INVALID_REPLAY" }
  | { status: "INVALID_POLICY" };
