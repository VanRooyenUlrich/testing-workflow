import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("../components/backend-status", () => ({
  BackendStatus: () => <section aria-label="Backend status test double" />,
}));

describe("Home", () => {
  it("renders the Issue Tracker introduction and backend status section", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Keep work visible and moving.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/initial Issue Tracker frontend/i)).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Backend status test double" }),
    ).toBeInTheDocument();
  });
});