import Link from "next/link";
import Image from "next/image";

interface FooterProps {
  appUrl: string;
}

// Internal anchors and external links kept here so all four pages share one
// footer. Every href resolves to a real destination — no href="#" placeholders.
const PRODUCT_LINKS = [
  { label: "Intelligence Brief", href: "/intelligence-brief/" },
  { label: "Brief Pro", href: "/pricing/" },
  { label: "Brief-Team", href: "/pricing/" },
  { label: "Platform", href: "/platform/" },
  { label: "Pricing", href: "/pricing/" },
  { label: "API", href: "/pricing/" },
];

const COMPANY_LINKS = [
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
  { label: "Privacy Policy", href: "/privacy/" },
  { label: "Terms of Service", href: "/terms/" },
];

export function Footer({ appUrl }: FooterProps) {
  // appUrl is reserved for future account links; kept in the shared signature.
  void appUrl;

  return (
    <footer className="bg-bg border-t border-hairline text-text-muted">
      <div className="container-site py-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {/* Col 1 — Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <Image
                src="/branding/securelogic-ai-logo.png"
                alt="SecureLogic AI"
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg"
              />
              <span className="font-semibold text-text text-sm">SecureLogic AI</span>
            </Link>
            <p className="text-sm leading-relaxed max-w-xs">
              Cyber risk intelligence for security teams that refuse to be reactive.
            </p>
            <p className="text-xs text-text-muted/70 mt-5">© 2026 SecureLogic AI</p>
          </div>

          {/* Col 2 — Product */}
          <div>
            <h2 className="pill-mono text-text-muted mb-4">Product</h2>
            <ul className="space-y-2.5 text-sm">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="hover:text-text transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3 — Company */}
          <div>
            <h2 className="pill-mono text-text-muted mb-4">Company</h2>
            <ul className="space-y-2.5 text-sm">
              {COMPANY_LINKS.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="hover:text-text transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4 — Connect */}
          <div>
            <h2 className="pill-mono text-text-muted mb-4">Connect</h2>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a href="mailto:hello@securelogicai.com" className="hover:text-text transition-colors">
                  hello@securelogicai.com
                </a>
              </li>
              {/* TODO(brand): confirm official LinkedIn / X handles before launch. */}
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
              <li>
                <a
                  href="https://x.com/securelogicai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-text transition-colors"
                >
                  Twitter / X
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
