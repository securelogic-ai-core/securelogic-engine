/**
 * Notice — the queue toast. EG2 slice 4 added an optional outcome link so an
 * accept never ends in a dead-end toast ("Linked to Microsoft — View vendor →").
 * These tests pin that contract: link renders exactly when provided, and the
 * undo action still renders beside it.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Notice } from "../Notice";

describe("Notice — outcome link", () => {
  it("renders the outcome link and the undo action side by side", () => {
    render(
      <Notice
        notice={{
          id: "n1",
          message: "Linked to Microsoft",
          href: "/vendors/v-1",
          hrefLabel: "View vendor →",
          actionLabel: "Undo",
          onAction: () => {},
        }}
      />
    );

    const link = screen.getByRole("link", { name: "View vendor →" });
    expect(link).toHaveAttribute("href", "/vendors/v-1");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByText("Linked to Microsoft")).toBeInTheDocument();
  });

  it("renders no link when the notice carries none (dismiss/error toasts)", () => {
    render(<Notice notice={{ id: "n2", message: "Suggestion dismissed" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
