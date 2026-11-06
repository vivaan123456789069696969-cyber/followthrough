"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { secondaryButton } from "./button-styles";

/** A side panel on the native dialog element, which handles focus and the Esc key. */
export function Drawer({ label, closeHref, children }: { label: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={() => router.push(closeHref, { scroll: false })}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-md overflow-y-auto bg-surface p-6 text-ink backdrop:bg-brand-deep/50"
    >
      <div className="mb-4 flex justify-end">
        <button type="button" className={secondaryButton} onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
