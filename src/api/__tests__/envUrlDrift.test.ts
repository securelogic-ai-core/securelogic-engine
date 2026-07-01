import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// @ts-expect-error — plain .mjs guard script, no type declarations.
import { lineIsAllowedFallback, scan, FORBIDDEN_HOSTS } from "../../../scripts/check-env-url-drift.mjs";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

describe("staging→production URL drift guard", () => {
  it("allows a production host only as an env-overridable fallback", () => {
    const ok = `const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";`;
    expect(lineIsAllowedFallback(ok, "app.securelogicai.com")).toBe(true);
  });

  it("flags a bare hardcoded production host (no env fallback)", () => {
    const bad = `<a href="https://app.securelogicai.com/signup">Upgrade</a>`;
    expect(lineIsAllowedFallback(bad, "app.securelogicai.com")).toBe(false);
  });

  it("flags a hardcoded internal Render engine/app host", () => {
    const csp = `"connect-src 'self' https://securelogic-engine.onrender.com",`;
    expect(lineIsAllowedFallback(csp, "securelogic-engine.onrender.com")).toBe(false);
  });

  it("does not treat an unrelated env var + later literal as a fallback", () => {
    const sneaky = `const x = process.env.FOO; const y = "https://api.securelogicai.com/v1";`;
    expect(lineIsAllowedFallback(sneaky, "api.securelogicai.com")).toBe(false);
  });

  it("covers the four production hosts", () => {
    expect(FORBIDDEN_HOSTS).toEqual(
      expect.arrayContaining([
        "app.securelogicai.com",
        "api.securelogicai.com",
        "securelogic-engine.onrender.com",
        "securelogic-app.onrender.com",
      ])
    );
  });

  it("the app/ and website/ source tree is currently drift-free", () => {
    const violations = scan(REPO_ROOT, ["app", "website"]);
    // Surface the offending lines if this ever regresses.
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
