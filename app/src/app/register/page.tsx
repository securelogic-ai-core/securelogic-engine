import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

interface Props {
  searchParams: Promise<{ plan?: string }>;
}

// /register is the historical signup URL. The unified flow lives at /signup;
// this page exists solely to forward inbound traffic (external links, cached
// pages, marketing assets) onto it without a 404.
export default async function RegisterPage({ searchParams }: Props) {
  const session = await getSession();

  if (session.jwtToken ?? session.apiKey) {
    redirect("/dashboard");
  }

  const { plan } = await searchParams;
  redirect(plan ? `/signup?plan=${encodeURIComponent(plan)}` : "/signup");
}
