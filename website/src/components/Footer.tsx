import Link from "next/link";
import Image from "next/image";
import { FOOTER_COLUMNS, type NavLink } from "@/lib/nav";

interface FooterProps {
  appUrl: string;
}

export function Footer({ appUrl }: FooterProps) {
  // Render a single footer link, honoring the app/external flags from the IA
  // model. Internal routes use next/link; app + external use a plain anchor.
  function FooterItem({ link }: { link: NavLink }) {
    if (link.external) {
      return (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-text transition-colors"
        >
          {link.label}
        </a>
      );
    }
    if (link.app) {
      return (
        <a href={`${appUrl}${link.href}`} className="hover:text-text transition-colors">
          {link.label}
        </a>
      );
    }
    return (
      <Link href={link.href} className="hover:text-text transition-colors">
        {link.label}
      </Link>
    );
  }

  return (
    <footer className="bg-bg border-t border-hairline text-text-muted">
      <div className="container-site py-14">
        {/* Link columns — rendered from the shared IA model (lib/nav.ts). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8 lg:gap-10">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="pill-mono text-text-muted mb-4">{col.title}</h2>
              <ul className="space-y-2.5 text-sm">
                {col.links.map((link) => (
                  <li key={`${col.title}-${link.label}`}>
                    <FooterItem link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Brand + connect + legal entity */}
        <div className="mt-12 pt-8 border-t border-hairline flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/" className="flex items-center gap-2.5 mb-3">
              <Image
                src="/branding/securelogic-ai-logo.png"
                alt="SecureLogic AI"
                width={32}
                height={32}
                className="h-8 w-8 rounded-lg"
              />
              <span className="font-semibold text-text text-sm">SecureLogic AI</span>
            </Link>
            <p className="text-xs text-text-muted/80 leading-relaxed max-w-sm">
              © 2026 Threat Loom, LLC d/b/a SecureLogic AI · Tinton Falls, New Jersey
            </p>
          </div>

          <ul className="flex items-center gap-5 text-sm">
            <li>
              <a href="mailto:hello@securelogicai.com" className="hover:text-text transition-colors">
                hello@securelogicai.com
              </a>
            </li>
            {/* TODO(brand): confirm official LinkedIn handle before launch. The X
                account could not be verified, so the link is omitted rather than
                pointing at an unowned/404 handle. */}
            <li>
              <a
                href="https://www.linkedin.com/company/securelogic-ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-text transition-colors"
              >
                LinkedIn
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
