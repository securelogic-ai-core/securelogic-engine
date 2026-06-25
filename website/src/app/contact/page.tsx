import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Book a working demo, request enterprise information, or contact SecureLogic AI directly.",
  openGraph: {
    title: "Contact — SecureLogic AI",
    description:
      "Book a working demo, request enterprise information, or contact SecureLogic AI directly.",
  },
};

export default function ContactPage() {
  return (
    <>
      {/* ─── A. Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-bg text-text border-b border-hairline">
        <div className="container-site py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Contact</p>
            <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.07] tracking-tight mb-6">
              Let&apos;s map your exposure together.
            </h1>
            <p className="text-lg text-text-body leading-relaxed">
              Book a working demo and we&apos;ll show you which of today&apos;s signals
              already touch your vendors and obligations — or send us a note.
            </p>
          </div>
        </div>
      </section>

      {/* ─── B. Form + contact cards ─────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-16 lg:py-20">
          <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-8">
            {/* Left — form */}
            <ContactForm />

            {/* Right — cards */}
            <div className="space-y-5">
              {/* Card 1 — Book a demo */}
              <div className="card bg-bg-elevated-2 border-accent/30 p-7">
                <h2 className="text-text font-bold text-lg mb-2">Book a working demo</h2>
                <p className="text-sm text-text-muted leading-relaxed mb-6">
                  30 minutes. Bring a few vendors and an obligation or two — we&apos;ll show
                  you the matched signals and recommended actions.
                </p>
                {/* TODO(scheduling): replace this mailto with a real calendar URL
                    (e.g. Calendly / Cal.com) once scheduling is set up. */}
                <a
                  href="mailto:hello@securelogicai.com?subject=Book%20a%20working%20demo"
                  className="btn-primary w-full"
                >
                  Pick a time
                </a>
              </div>

              {/* Card 2 — Direct links */}
              <div className="card p-7">
                <ul className="space-y-4 text-sm">
                  <li>
                    <p className="text-text-muted text-xs mb-0.5">Email us directly</p>
                    <a href="mailto:hello@securelogicai.com" className="text-accent font-medium hover:text-accent-hover transition-colors">
                      hello@securelogicai.com
                    </a>
                  </li>
                  <li className="pt-4 border-t border-hairline">
                    <p className="text-text-muted text-xs mb-0.5">Prefer to explore first?</p>
                    <Link href="/#brief-signup" className="text-accent font-medium hover:text-accent-hover transition-colors">
                      Start without us — get the free brief
                    </Link>
                  </li>
                  <li className="pt-4 border-t border-hairline">
                    <p className="text-text-muted text-xs mb-0.5">Plans &amp; commercial terms</p>
                    <Link href="/pricing/" className="text-accent font-medium hover:text-accent-hover transition-colors">
                      Pricing &amp; terms
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── C. Enterprise inquiry strip ─────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-16">
          <div className="grid lg:grid-cols-[1.4fr_0.6fr] gap-8 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-text leading-tight mb-3">
                Need SSO, white-labeling, or multi-org support?
              </h2>
              <p className="text-text-body leading-relaxed max-w-2xl">
                We support enterprise requirements including SSO / SAML, custom signal
                sources, white-labeled intelligence briefs, and dedicated onboarding.
              </p>
            </div>
            <div className="lg:text-right">
              <a
                href="mailto:hello@securelogicai.com?subject=Enterprise%20inquiry"
                className="btn-primary"
              >
                Talk to Sales
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
