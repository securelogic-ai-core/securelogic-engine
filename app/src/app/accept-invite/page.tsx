import { getInvitePreview } from "@/lib/api";
import AcceptInviteForm from "./AcceptInviteForm";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return <InvalidInvite reason="No invitation token provided." />;
  }

  const preview = await getInvitePreview(token);

  if (!preview || !preview.valid) {
    return (
      <InvalidInvite
        reason={
          !preview
            ? "Could not load this invitation."
            : preview.reason === "expired"
            ? "This invitation has expired."
            : "This invitation is no longer valid."
        }
      />
    );
  }

  return (
    <AcceptInviteForm
      token={token}
      email={preview.email}
      orgName={preview.orgName}
      inviterName={preview.inviterName}
      role={preview.role}
    />
  );
}

function InvalidInvite({ reason }: { reason: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060d18",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "#0d1b2e",
          border: "1px solid #1e2d45",
          borderRadius: "12px",
          padding: "40px",
          maxWidth: "440px",
          width: "100%",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 12px" }}>
          Invitation Invalid
        </p>
        <p style={{ fontSize: "15px", color: "#94a3b8", margin: "0 0 28px" }}>{reason}</p>
        <a
          href="/login"
          style={{
            display: "inline-block",
            background: "#00c4b4",
            color: "#0a0f1a",
            fontWeight: 600,
            fontSize: "14px",
            padding: "12px 24px",
            borderRadius: "8px",
            textDecoration: "none",
          }}
        >
          Go to Login
        </a>
      </div>
    </div>
  );
}
