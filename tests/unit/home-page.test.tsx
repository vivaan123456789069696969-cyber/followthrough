import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("shows the wordmark and tagline", () => {
    render(<HomePage />);

    expect(screen.getByText("followthrough")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Meetings end. Follow-through starts." }),
    ).toBeInTheDocument();
  });
});
