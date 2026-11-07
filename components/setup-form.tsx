"use client";

import { useActionState } from "react";
import { finishSetup } from "@/app/(app)/settings/actions";
import { primaryButton, secondaryButton } from "./button-styles";
import { DestinationFields } from "./destination-fields";
import { FormError } from "./ui";

export function SetupForm({ current, googleAvailable }: { current: "app" | "google_tasks" | null; googleAvailable: boolean }) {
  const [state, action, pending] = useActionState(finishSetup, { error: null, saved: false });
  return (
    <form action={action} className="flex flex-col gap-4">
      <DestinationFields current={current ?? "app"} idPrefix="setup-destination" googleAvailable={googleAvailable} />
      <FormError message={state.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="finish" disabled={pending} className={primaryButton}>
          {pending ? "Saving" : "Finish setup"}
        </button>
        <button type="submit" name="intent" value="skip" disabled={pending} formNoValidate className={secondaryButton}>
          Skip for now
        </button>
      </div>
    </form>
  );
}
