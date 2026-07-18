/**
 * FindingEvidenceSection — the Remediation Evidence attach form with real file
 * upload. Pins: the file picker + Reference field both render; a valid file shows
 * name/size + Remove/Replace; an invalid file shows an error and no chip; an
 * uploaded (has_file) evidence row renders an authenticated download link, while a
 * reference-only row keeps its external link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Evidence } from "@/lib/api";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const api = vi.hoisted(() => ({
  getFindingEvidence: vi.fn(),
  attachFindingEvidence: vi.fn(),
  uploadFindingEvidence: vi.fn(),
  evidenceFileHref: (id: string) => `/api/evidence/${id}/file`,
}));
vi.mock("@/lib/api", () => api);

import { FindingEvidenceSection } from "../FindingEvidenceSection";

function anEvidence(over: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    organization_id: "org-1",
    source_id: "f-1",
    source_type: "finding",
    title: "Patch log",
    description: null,
    evidence_type: "log",
    collected_at: null,
    collected_by: null,
    external_ref: null,
    has_file: false,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
    ...over,
  };
}

function fileOf(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  refresh.mockClear();
  api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [] });
  api.attachFindingEvidence.mockResolvedValue({ ok: true, evidence: anEvidence() });
  api.uploadFindingEvidence.mockResolvedValue({ ok: true, evidence: anEvidence({ has_file: true }) });
});

describe("attach form — file picker + Reference both present", () => {
  it("renders a file input (with accept) and keeps the Reference field", async () => {
    const { container } = render(<FindingEvidenceSection findingId="f-1" />);
    await waitFor(() => expect(api.getFindingEvidence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ Attach evidence" }));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute("accept")).toContain(".pdf");
    expect(screen.getByPlaceholderText(/link or document reference/i)).toBeInTheDocument();
  });

  it("shows selected file name + size + Remove/Replace for a valid file", async () => {
    const { container } = render(<FindingEvidenceSection findingId="f-1" />);
    await waitFor(() => expect(api.getFindingEvidence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ Attach evidence" }));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fileOf("proof.pdf", "application/pdf", 2048)] } });

    expect(screen.getByText("proof.pdf")).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("rejects an invalid file type with an error and no file chip", async () => {
    const { container } = render(<FindingEvidenceSection findingId="f-1" />);
    await waitFor(() => expect(api.getFindingEvidence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ Attach evidence" }));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fileOf("evil.exe", "application/x-msdownload")] } });

    expect(screen.getByText(/Unsupported file type/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("uploads via the multipart path when a file is chosen (not the reference path)", async () => {
    const { container } = render(<FindingEvidenceSection findingId="f-1" />);
    await waitFor(() => expect(api.getFindingEvidence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ Attach evidence" }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fileOf("proof.pdf", "application/pdf")] } });
    // Title auto-fills from the filename, so Save is enabled.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.uploadFindingEvidence).toHaveBeenCalledTimes(1));
    expect(api.attachFindingEvidence).not.toHaveBeenCalled();
    expect(api.uploadFindingEvidence.mock.calls[0][0]).toBe("f-1");
    expect((api.uploadFindingEvidence.mock.calls[0][1] as File).name).toBe("proof.pdf");
  });
});

describe("evidence list — download vs reference", () => {
  it("renders an authenticated download link + file metadata for an uploaded file", async () => {
    api.getFindingEvidence.mockResolvedValue({
      ok: true,
      evidence: [
        anEvidence({ id: "ev-file", has_file: true, original_filename: "patch.pdf", mime_type: "application/pdf", byte_size: 3145728 }),
      ],
    });
    render(<FindingEvidenceSection findingId="f-1" />);

    const link = await screen.findByRole("link", { name: /Patch log/ });
    expect(link.getAttribute("href")).toBe("/api/evidence/ev-file/file");
    expect(screen.getByText(/patch\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/3\.0 MB/)).toBeInTheDocument();
  });

  it("keeps the external link for a reference-only row (no file)", async () => {
    api.getFindingEvidence.mockResolvedValue({
      ok: true,
      evidence: [anEvidence({ id: "ev-ref", has_file: false, external_ref: "https://tickets/CR-9" })],
    });
    render(<FindingEvidenceSection findingId="f-1" />);

    const link = await screen.findByRole("link", { name: /Patch log/ });
    expect(link.getAttribute("href")).toBe("https://tickets/CR-9");
  });
});
