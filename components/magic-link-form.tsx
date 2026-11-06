"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { EmailSignInState } from "@/app/sign-in/actions";
import { primaryButton, secondaryButton } from "./button-styles";

type Props = {
  action: (previous: EmailSignInState, formData: FormData) => Promise<EmailSignInState>;
  next: string;
};

export function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${secondaryButton} w-full`}>
      {pending ? "Opening Google" : "Continue with Google"}
    </button>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={primaryButton}>
      {pending ? "Sending" : "Send sign-in link"}
    </button>
  );
}

export function MagicLinkForm({ action, next }: Props) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-lg bg-sage-100 p-4">
        <p className="font-medium text-ink">Check your email</p>
        <p className="mt-1 text-ink-muted">
          We sent a sign-in link to {state.email}. It works for about an hour.
        </p>
      </div>
    );
  }

  const hasError = state.status === "error";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="font-medium text-ink">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        defaultValue={hasError ? state.email : undefined}
        autoComplete="email"
        aria-invalid={hasError}
        aria-describedby={hasError ? "email-error" : undefined}
        className="min-h-11 rounded-lg border border-ink-muted bg-surface px-3 text-base text-ink"
      />
      {hasError ? (
        <p id="email-error" role="alert" className="rounded-lg bg-warm p-3 text-on-warm">
          {state.message}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
