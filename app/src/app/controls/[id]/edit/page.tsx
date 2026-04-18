import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getControl } from "@/lib/api";
import { EditControlForm } from "./EditControlForm";

export default async function EditControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const control = await getControl(token, id);
  if (!control) redirect("/controls");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/controls/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← {control.name}
      </Link>

      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Edit Control
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Update details for {control.name}.
      </p>

      <EditControlForm control={control} />
    </div>
  );
}
