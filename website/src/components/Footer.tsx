import Link from "next/link";
import Image from "next/image";

interface FooterProps {
  appUrl: string;
}

export function Footer({ appUrl }: FooterProps) {
  return (
    <footer className="bg-navy-900 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand column */}
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <Image
                src="/branding/securelogic-ai-logo.png"
                alt="SecureLogic AI"
                width={28}
                height={28}
                className="rounded"
              />
              <span className="font-semibold text-white text-sm">SecureLogic AI</span>
            </Link>
            <p className="text-sm leading-relaxed">
              Unified Risk Intelligence Platform for vendors, controls, compliance, and AI systems.
            </p>
          </div>

          {/* Platform */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Platform
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/platform/" className="hover:text-white transition-colors">Overview</Link></li>
              <li><Link href="/platform/#vendor-risk" className="hover:text-white transition-colors">Vendor Risk</Link></li>
              <li><Link href="/platform/#ai-governance" className="hover:text-white transition-colors">AI Governance</Link></li>
              <li><Link href="/platform/#compliance" className="hover:text-white transition-colors">Compliance</Link></li>
            </ul>
          </div>

          {/* Intelligence */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Intelligence
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/intelligence-brief/" className="hover:text-white transition-colors">Intelligence Brief</Link></li>
              <li><Link href="/pricing/" className="hover:text-white transition-colors">Pricing</Link></li>
              <li>
                <a href={`${appUrl}/register`} className="hover:text-white transition-colors">
                  Get access
                </a>
              </li>
            </ul>
          </div>

          {/* Account */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Account
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a href={`${appUrl}/sign-in`} className="hover:text-white transition-colors">
                  Log in
                </a>
              </li>
              <li>
                <a href={`${appUrl}/register`} className="hover:text-white transition-colors">
                  Create account
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs">
          <p>&copy; {new Date().getFullYear()} SecureLogic AI. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/privacy/" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms/" className="hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
