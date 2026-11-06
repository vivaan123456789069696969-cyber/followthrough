"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { primaryButton } from "./button-styles";

export function SubmitButton({ children, pendingLabel = "Saving", className = primaryButton }: { children: ReactNode; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** A submit button that asks first, for actions that can't be undone. */
export function ConfirmButton({ children, message, className }: { children: ReactNode; message: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
