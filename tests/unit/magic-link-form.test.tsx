import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MagicLinkForm } from "@/components/magic-link-form";

async function submit(email: string) {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
}

describe("MagicLinkForm", () => {
  it("passes the email and destination to the action", async () => {
    const action = vi.fn(async () => ({ status: "sent" as const, email: "maya@example.com" }));
    render(<MagicLinkForm action={action} next="/meetings/1" />);

    await submit("maya@example.com");

    const formData = (action.mock.calls[0] as unknown[])[1] as FormData;
    expect(formData.get("email")).toBe("maya@example.com");
    expect(formData.get("next")).toBe("/meetings/1");
  });

  it("tells the user to check their email", async () => {
    render(<MagicLinkForm action={async () => ({ status: "sent", email: "maya@example.com" })} next="/my-day" />);

    await submit("maya@example.com");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Check your email");
    expect(status).toHaveTextContent("maya@example.com");
  });

  it("shows errors in a way screen readers announce", async () => {
    render(<MagicLinkForm action={async () => ({ status: "error", message: "We couldn't send the link. Try again." })} next="/my-day" />);

    await submit("maya@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't send the link");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("We couldn't send the link. Try again.");
  });
});
