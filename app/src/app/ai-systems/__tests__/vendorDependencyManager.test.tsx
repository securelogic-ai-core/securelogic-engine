/**
 * VendorDependencyManager (EG2 slice 5) — the write path for AI-system vendor
 * dependencies. The engine routes existed for months with no UI; these tests
 * pin the contract that the form actually reaches them: canonical role
 * vocabulary offered, add submits the picked vendor+role, remove sends the
 * dependency id, and errors surface instead of vanishing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  addVendorDependency: vi.fn(),
  removeVendorDependency: vi.fn(),
}));

vi.mock("../[id]/dependencyActions", () => actions);

import {
  AddVendorDependencyForm,
  RemoveVendorDependencyButton,
  ROLE_OPTIONS,
} from "../[id]/VendorDependencyManager";

const VENDORS = [
  { id: "v-1", name: "Acme Cloud" },
  { id: "v-2", name: "ModelHub" },
];

beforeEach(() => {
  vi.clearAllMocks();
  actions.addVendorDependency.mockResolvedValue({ ok: true });
  actions.removeVendorDependency.mockResolvedValue({ ok: true });
});

describe("AddVendorDependencyForm", () => {
  it("expands from the affordance and offers every canonical dependency role", () => {
    render(<AddVendorDependencyForm aiSystemId="ai-1" vendors={VENDORS} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add vendor dependency" }));

    const roleSelect = screen.getByRole("combobox", { name: "Dependency role" });
    for (const r of ROLE_OPTIONS) {
      expect(
        Array.from(roleSelect.querySelectorAll("option")).some((o) => o.value === r.value)
      ).toBe(true);
    }
    expect(screen.getByRole("combobox", { name: "Vendor" })).toBeInTheDocument();
  });

  it("submits the picked vendor and role to the server action", async () => {
    render(<AddVendorDependencyForm aiSystemId="ai-1" vendors={VENDORS} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add vendor dependency" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Vendor" }), {
      target: { value: "v-2" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Dependency role" }), {
      target: { value: "model_provider" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(actions.addVendorDependency).toHaveBeenCalledTimes(1));
    const [aiSystemId, formData] = actions.addVendorDependency.mock.calls[0]!;
    expect(aiSystemId).toBe("ai-1");
    expect((formData as FormData).get("vendor_id")).toBe("v-2");
    expect((formData as FormData).get("dependency_role")).toBe("model_provider");
  });

  it("surfaces a server error instead of silently closing", async () => {
    actions.addVendorDependency.mockResolvedValue({ error: "Viewers can't change dependencies." });
    render(<AddVendorDependencyForm aiSystemId="ai-1" vendors={VENDORS} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add vendor dependency" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Vendor" }), { target: { value: "v-1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Dependency role" }), {
      target: { value: "runtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Viewers can't change dependencies.");
  });

  it("renders nothing when there are no vendors to pick", () => {
    const { container } = render(<AddVendorDependencyForm aiSystemId="ai-1" vendors={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RemoveVendorDependencyButton", () => {
  it("sends the dependency id with both revalidation targets", async () => {
    render(
      <RemoveVendorDependencyButton
        dependencyId="dep-9"
        aiSystemId="ai-1"
        vendorId="v-1"
        vendorName="Acme Cloud"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove dependency on Acme Cloud" }));

    await waitFor(() =>
      expect(actions.removeVendorDependency).toHaveBeenCalledWith("dep-9", "ai-1", "v-1")
    );
  });
});
