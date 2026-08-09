/**
 * /verify-email tells the truth about the email the customer is waiting for.
 *
 * This screen opens on "Check your inbox — We sent a verification email to
 * <you>", and it used to say that unconditionally, because signup used to
 * report `verification_email_sent` unconditionally. When RESEND_API_KEY was
 * unset nothing was sent at all: the tenant was fully provisioned, login
 * answered 403 email_not_verified, the token existed only in the database, and
 * the customer was sat in front of a page telling them to go and read an email
 * that did not exist. The first screen of the product, confidently wrong about
 * the product's own action.
 *
 * The engine now reports what happened, SignupForm forwards it as ?mail=, and
 * this file is where that verdict has to become something a person can read.
 * The engine tests (customerAuthSignupMailStatus.test.ts) prove the API stopped
 * lying; these prove the customer stopped being lied to, which is the half the
 * customer experiences.
 *
 * The resend path is held to the same standard and one extra rule. The engine
 * answers resend identically for every address on purpose — a per-address
 * outcome would be an account-existence oracle — so the UI may never upgrade
 * that to a delivery claim. "Requested" is the ceiling. The one exception is a
 * missing provider, which is true of every address at once and therefore safe
 * to state plainly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { setClientSearchParams, resetClientSearchParams } from "@/test/harness";

import VerifyEmailPage from "../page";

const EMAIL = "founder@acme.test";

/** The claim this whole file exists to stop. */
const DELIVERY_CLAIM = /we sent a verification email/i;

function renderAt(qs: string) {
  setClientSearchParams(qs);
  return render(<VerifyEmailPage />);
}

/** What /api/auth-resend-verification answers on the next click. */
function mockResend(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockResend({ ok: true, verification_email: "attempted" });
});

afterEach(() => {
  resetClientSearchParams();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────

describe("/verify-email — signup said the email never went out", () => {
  it.each(["unavailable", "failed"] as const)(
    "does not claim delivery when mail=%s",
    async (outcome) => {
      renderAt(`email=${encodeURIComponent(EMAIL)}&mail=${outcome}`);

      expect(screen.queryByText(DELIVERY_CLAIM)).toBeNull();
      expect(screen.getByText(/couldn't send your verification email/i)).toBeTruthy();
    }
  );

  it("still confirms the account exists, so nobody signs up twice", async () => {
    // The account IS provisioned — org, admin user, active API key, consent
    // rows, all committed before the email was attempted. A customer who reads
    // this as "signup failed" and retries hits email_already_registered.
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=unavailable`);

    expect(screen.getByText(/your account was created for/i)).toBeTruthy();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect(screen.getByText(/nothing needs signing up for again/i)).toBeTruthy();
  });

  it("states the consequence: they cannot sign in yet", async () => {
    // Without this the screen is a shrug. Login answers 403 email_not_verified,
    // and a customer who does not know that will keep trying it.
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=failed`);

    expect(screen.getByText(/can't sign in until your address is verified/i)).toBeTruthy();
  });

  it("gives a human route out", async () => {
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=unavailable`);

    const support = screen.getByText("hello@securelogicai.com");
    expect(support.getAttribute("href")).toBe("mailto:hello@securelogicai.com");
    expect(screen.getByRole("button", { name: /resend verification email/i })).toBeTruthy();
  });

  it("does not promise checkout copy as though enrolment were under way", async () => {
    // "After verifying, you'll continue to Brief Pro — $49/mo checkout" reads
    // as a commitment already in motion. It is not, and the customer has not
    // paid, so the outage screen says so instead.
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=unavailable&plan=professional`);

    expect(screen.queryByText(/after verifying, you.+continue to/i)).toBeNull();
    expect(screen.getByText(/have not been charged/i)).toBeTruthy();
  });
});

describe("/verify-email — the ordinary case is untouched", () => {
  it("shows the inbox screen when signup reported nothing wrong", async () => {
    renderAt(`email=${encodeURIComponent(EMAIL)}`);

    expect(screen.getByText(DELIVERY_CLAIM)).toBeTruthy();
    expect(screen.getByText(/link in the email to activate your account/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't send your verification email/i)).toBeNull();
  });

  it("keeps the inbox screen when mail= is absent, junk, or already sent", async () => {
    // An engine predating the truthful response sends no verdict at all; a
    // hand-edited URL can send anything. Neither is evidence of an outage, and
    // inventing one would be its own falsehood.
    for (const qs of ["", "&mail=", "&mail=sent", "&mail=banana"]) {
      const { unmount } = renderAt(`email=${encodeURIComponent(EMAIL)}${qs}`);
      expect(screen.getByText(DELIVERY_CLAIM)).toBeTruthy();
      unmount();
      resetClientSearchParams();
    }
  });

  it("still shows plan-aware checkout copy", async () => {
    renderAt(`email=${encodeURIComponent(EMAIL)}&plan=professional`);

    expect(screen.getByText(/after verifying/i)).toBeTruthy();
    expect(screen.getByText(/Brief Pro/)).toBeTruthy();
  });
});

describe("/verify-email — resend never overstates what happened", () => {
  it("says requested, not sent", async () => {
    // The engine hands the send to a fire-and-forget call it cannot report on
    // per address. "Email Sent" asserted an outcome nothing observed.
    renderAt(`email=${encodeURIComponent(EMAIL)}`);

    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(screen.getByText(/new verification link requested/i)).toBeTruthy();
    });
    expect(screen.queryByText(/^Email Sent$/)).toBeNull();
    expect(screen.getByRole("button", { name: /link requested/i })).toBeTruthy();
  });

  it("reports an unconfigured provider instead of claiming a resend", async () => {
    mockResend({ ok: true, verification_email: "unavailable" });
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=unavailable`);

    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(screen.getByText(/email service is unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByText(/new verification link requested/i)).toBeNull();
  });

  it("leaves the button usable when the resend achieved nothing", async () => {
    // Disabling it on a request that sent no mail strands the customer on a
    // dead screen with a greyed-out control and no way to retry.
    mockResend({ ok: true, verification_email: "unavailable" });
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=unavailable`);

    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /resend verification email/i })).toBeTruthy();
    });
  });

  it("keeps the outage screen up while the provider is still missing", async () => {
    mockResend({ ok: true, verification_email: "unavailable" });
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=unavailable`);

    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(screen.getByText(/email service is unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByText(DELIVERY_CLAIM)).toBeNull();
    expect(screen.getByText(/couldn't send your verification email/i)).toBeTruthy();
  });

  it("clears the outage once a resend reaches a live provider", async () => {
    // The signup-time verdict is a snapshot. A resend that found a provider is
    // newer evidence, and pinning the customer to a resolved outage would be
    // the same sin pointed the other way.
    renderAt(`email=${encodeURIComponent(EMAIL)}&mail=failed`);
    expect(screen.getByText(/couldn't send your verification email/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(screen.getByText(/new verification link requested/i)).toBeTruthy();
    });
    expect(screen.queryByText(/couldn't send your verification email/i)).toBeNull();
  });
});
