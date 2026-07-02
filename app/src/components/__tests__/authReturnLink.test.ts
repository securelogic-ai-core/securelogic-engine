import { describe, it, expect } from "vitest";
import {
  resolveReturnLink,
  RETURN_LINK_HREF,
  RETURN_LINK_LABEL,
} from "../authReturnLink";

describe("resolveReturnLink", () => {
  it("returns the Dashboard link for a JWT (customer-auth) session", () => {
    expect(resolveReturnLink({ jwtToken: "jwt.token.value" })).toEqual({
      href: RETURN_LINK_HREF,
      label: RETURN_LINK_LABEL,
    });
  });

  it("returns the Dashboard link for a legacy API-key session", () => {
    expect(resolveReturnLink({ apiKey: "sl_live_key" })).toEqual({
      href: RETURN_LINK_HREF,
      label: RETURN_LINK_LABEL,
    });
  });

  it("renders nothing (null) for an unauthenticated session", () => {
    expect(resolveReturnLink({})).toBeNull();
  });

  it("renders nothing when both credentials are undefined", () => {
    expect(resolveReturnLink({ jwtToken: undefined, apiKey: undefined })).toBeNull();
  });

  it("targets /dashboard with the exact approved label", () => {
    // Lock the destination + copy so a future edit can't silently change them.
    expect(RETURN_LINK_HREF).toBe("/dashboard");
    expect(RETURN_LINK_LABEL).toBe("← Return to Dashboard");
  });

  it("mirrors /signup's `??` predicate: an empty-string jwtToken is treated as unauthenticated", () => {
    // `"" ?? apiKey` short-circuits to "" (nullish coalescing only falls through
    // on null/undefined), so Boolean("") === false. This intentionally matches
    // /signup's redirect check exactly rather than diverging.
    expect(resolveReturnLink({ jwtToken: "", apiKey: "sl_live_key" })).toBeNull();
  });
});
