import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { RegisterForm } from "./RegisterForm";

interface Props {
  searchParams: Promise<{ plan?: string }>;
}

export default async function RegisterPage({ searchParams }: Props) {
  const session = await getSession();

  if (session.apiKey) {
    redirect("/dashboard");
  }

  const { plan } = await searchParams;

  return <RegisterForm plan={plan ?? null} />;
}
