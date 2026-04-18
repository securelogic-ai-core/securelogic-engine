import Link from "next/link";
import { NewPolicyForm } from "./NewPolicyForm";

export default function NewPolicyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href="/policies"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Back to policies
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          Add Policy
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Create a new organizational security or compliance policy.
        </p>
      </div>
      <NewPolicyForm />
    </div>
  );
}
