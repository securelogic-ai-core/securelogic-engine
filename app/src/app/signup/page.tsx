import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignupForm } from "./SignupForm";

interface Props {
  searchParams: Promise<{ plan?: string }>;
}

export default async function SignupPage({ searchParams }: Props) {
  const session = await getSession();

  if (session.jwtToken ?? session.apiKey) {
    redirect("/dashboard");
  }

  const { plan } = await searchParams;

  return <SignupForm plan={plan ?? null} />;
}
