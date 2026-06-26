import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// The standalone app landing page has been retired — the marketing site
// (securelogicai.com) is the canonical landing + pricing surface. The app root
// now routes by auth state: signed-in users go to their dashboard, everyone
// else goes to the login screen (which links onward to /signup).
export default async function RootPage() {
  const session = await getSession();
  const isAuthenticated = Boolean(session.jwtToken ?? session.apiKey);
  redirect(isAuthenticated ? "/dashboard" : "/login");
}
