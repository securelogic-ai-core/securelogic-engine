import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AskClient } from "./AskClient";

export default async function AskPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  return <AskClient />;
}
