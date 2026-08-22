/**
 * GovernanceLinkManager (T2-B) — the write path for the four typed governance
 * edges. Same contract shape as its sibling vendorDependencyManager test: the
 * form reaches the server action with the picked target and the right FAMILY,
 * remove sends the link id, and errors surface instead of vanishing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  addGovernanceLink: vi.fn(),
  removeGovernanceLink: vi.fn(),
}));

vi.mock("../[id]/governanceActions", () => actions);

import {
  AddGovernanceLinkForm,
  RemoveGovernanceLinkButton,
} from "../[id]/GovernanceLinkManager";

const OPTIONS = [
  { id: "fw-1", name: "NIST AI RMF" },
  { id: "fw-2", name: "ISO/IEC 42001" },
];

beforeEach(() => {
  vi.clearAllMocks();
  actions.addGovernanceLink.mockResolvedValue({ ok: true });
  actions.removeGovernanceLink.mockResolvedValue({ ok: true });
});

describe("AddGovernanceLinkForm", () => {
  it("submits the picked target under the right family", async () => {
    render(
      <AddGovernanceLinkForm aiSystemId="ai-1" kind="framework" kindLabel="framework" options={OPTIONS} />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Link framework" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Link framework" }), {
      target: { value: "fw-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => expect(actions.addGovernanceLink).toHaveBeenCalledTimes(1));
    expect(actions.addGovernanceLink).toHaveBeenCalledWith("ai-1", "framework", "fw-2");
  });

  it("with no targets to offer it renders nothing — no affordance that can only fail", () => {
    const { container } = render(
      <AddGovernanceLinkForm aiSystemId="ai-1" kind="policy" kindLabel="policy" options={[]} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("surfaces a server error instead of silently closing", async () => {
    actions.addGovernanceLink.mockResolvedValue({
      error: "Contributors can't change governance links.",
    });
    render(
      <AddGovernanceLinkForm aiSystemId="ai-1" kind="control" kindLabel="control" options={OPTIONS} />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Link control" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Link control" }), {
      target: { value: "fw-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Contributors can't change governance links."
    );
  });
});

describe("RemoveGovernanceLinkButton", () => {
  it("retracts by LINK id under the right family — a delete plus a create is two audit rows", async () => {
    render(
      <RemoveGovernanceLinkButton
        aiSystemId="ai-1"
        kind="obligation"
        linkId="gl-7"
        targetName="GDPR Art. 22"
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove obligation link to GDPR Art. 22" })
    );

    await waitFor(() => expect(actions.removeGovernanceLink).toHaveBeenCalledTimes(1));
    expect(actions.removeGovernanceLink).toHaveBeenCalledWith("ai-1", "obligation", "gl-7");
  });
});
