import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

// The page is an async server component, so it is awaited and its result rendered.
async function renderHome(account?: string) {
  render(await HomePage({ searchParams: Promise.resolve(account ? { account } : {}) }));
}

describe("HomePage", () => {
  it("shows the wordmark and tagline", async () => {
    await renderHome();

    expect(screen.getByText("followthrough")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Meetings end. Follow-through starts." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("confirms when an account was just deleted", async () => {
    await renderHome("deleted");
    expect(screen.getByRole("status")).toHaveTextContent("Your account and everything in it were deleted.");
  });
});
