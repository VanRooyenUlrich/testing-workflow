import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("frontend validation baseline", () => {
  it("renders the baseline page", () => {
    render(<Home />);
    expect(screen.getByText("Frontend validation baseline")).toBeInTheDocument();
  });
});
