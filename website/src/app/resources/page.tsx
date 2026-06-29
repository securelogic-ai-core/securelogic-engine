import type { Metadata } from "next";
import Link from "next/link";
import { SECURITY_OVERVIEW_PDF } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Resources from SecureLogic AI — the weekly Intelligence Brief, security documentation, and material to help security and GRC teams turn signals into action.",
  openGraph: {
    title: "Resources — SecureLogic AI",
    description:
      "The weekly Intelligence Brief, security documentation, and material for security and GRC teams.",
  },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";

interface ResourceCard {
  eyebrow: string;
  title: string;
  copy: string;
  primary: { label: string; href: string; external?: boolean };
  secondary: { label: string; href: string };
}

const RESOURCES: ResourceCard[] = [
  {
    eyebrow: "Intelligence Brief",
    title: "The weekly Intelligence Brief",
    copy: "Executive-grade risk intelligence — vulnerabilities, vendor risk, regulatory change, and AI governance, synthesized and prioritized every Monday.",
    primary: { label: "See a sample issue", href: "/intelligence-brief/" },
    secondary: { label: "Get the Free Brief", href: "/#brief-signup" },
  },
  {
    eyebrow: "Security",
    title: "Security Overview",
    copy: "Our full security program, architecture, controls, and maturity roadmap in a single document — built for vendor due diligence.",
    primary: { label: "Download the PDF", href: SECURITY_OVERVIEW_PDF, external: true },
    secondary: { label: "Visit the Trust Center", href: "/trust/" },
  },
  {
    eyebrow: "Platform",
    title: "How the platform works",
    copy: "See how external signals become vendors, AI systems, controls, obligations, risks, findings, and posture across one connected operating picture.",
    primary: { label: "Explore the Platform", href: "/platform/" },
    secondary: { label: "Compare plans", href: "/pricing/" },
  },
];

export default function ResourcesPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-bg text-text border-b border-hairline">
        <div className="container-site py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Resources</p>
            <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.07] tracking-tight mb-6">
              Material for teams that turn signals into action.
            </h1>
            <p className="text-lg text-text-body leading-relaxed">
              The weekly Intelligence Brief, security documentation, and resources to help security
              and GRC leaders understand exposure and decide what to do next.
            </p>
          </div>
        </div>
      </section>

      {/* Resource cards */}
      <section className="bg-bg">
        <div className="container-site py-16 lg:py-20">
          <div className="grid gap-5">
            {RESOURCES.map((r) => (
              <div key={r.title} className="card p-8 sm:p-10">
                <div className="grid lg:grid-cols-[1fr_auto] gap-6 lg:items-center">
                  <div className="max-w-2xl">
                    <p className="eyebrow mb-3">{r.eyebrow}</p>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-text leading-tight mb-3">
                      {r.title}
                    </h2>
                    <p className="text-text-body leading-relaxed">{r.copy}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row lg:flex-col gap-3 lg:min-w-[200px]">
                    {r.primary.external ? (
                      <a
                        href={r.primary.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary"
                      >
                        {r.primary.label}
                      </a>
                    ) : (
                      <Link href={r.primary.href} className="btn-primary">
                        {r.primary.label}
                      </Link>
                    )}
                    <Link href={r.secondary.href} className="btn-outline">
                      {r.secondary.label}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-text mb-6">
            Start with the brief. Stay for the platform.
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#brief-signup" className="btn-primary">Get the Free Brief</Link>
            <a href={`${APP_URL}/signup?plan=platform_annual`} className="btn-outline">Start Free Trial</a>
          </div>
        </div>
      </section>
    </>
  );
}
