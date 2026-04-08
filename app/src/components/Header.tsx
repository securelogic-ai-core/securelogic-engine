import Image from "next/image";
import Link from "next/link";

interface HeaderProps {
  organizationName?: string;
  isAuthenticated: boolean;
}

export function Header({ organizationName, isAuthenticated }: HeaderProps) {
  return (
    <header className="bg-slate-900 border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Wordmark */}
        <Link href={isAuthenticated ? "/dashboard" : "/"} className="flex items-center gap-3">
          <Image
            src="/branding/securelogic-ai-logo.png"
            alt="SecureLogic AI"
            width={28}
            height={28}
            className="rounded"
          />
          <div className="flex flex-col leading-none">
            <span className="text-white font-semibold text-sm tracking-wide">
              SecureLogic AI
            </span>
            <span className="text-teal-400 font-medium text-xs tracking-wide">
              Intelligence Brief
            </span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-6">
          {isAuthenticated ? (
            <>
              <Link
                href="/briefs"
                className="text-slate-400 hover:text-white text-sm transition-colors"
              >
                Briefs
              </Link>
              <Link
                href="/account"
                className="text-slate-400 hover:text-white text-sm transition-colors"
              >
                {organizationName ?? "Account"}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-slate-400 hover:text-white text-sm transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
              >
                Get Started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function LogoutButton() {
  return (
    <form action="/api/logout" method="POST">
      <button
        type="submit"
        className="text-slate-400 hover:text-white text-sm transition-colors"
      >
        Sign Out
      </button>
    </form>
  );
}
