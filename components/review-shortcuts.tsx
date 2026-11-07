"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keyboard shortcuts for the review list. They only work while focus is inside the
 * list, so single letters never fire elsewhere on the page (WCAG 2.1.4).
 */
export function ReviewShortcuts({ listId }: { listId: string }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return;
      if (!target?.closest(`#${listId}`)) return;
      if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      if (document.querySelector("dialog[open]")) return;

      const cards = [...document.querySelectorAll<HTMLElement>(`#${listId} [data-suggestion]`)];
      if (!cards.length) return;
      const current = cards.findIndex((card) => card.contains(document.activeElement));
      const key = event.key.toLowerCase();

      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = key === "j" ? Math.min(current + 1, cards.length - 1) : Math.max(current - 1, 0);
        cards[current === -1 ? 0 : next]!.focus();
      } else if ((key === "c" || key === "x") && current !== -1) {
        event.preventDefault();
        const selector = key === "c" ? "[data-confirm] button" : "button[data-dismiss]";
        cards[current]!.querySelector<HTMLButtonElement>(selector)?.click();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [listId]);

  return (
    <p className="hidden text-sm text-ink-muted md:block">
      In this list: <kbd>J</kbd> and <kbd>K</kbd> to move, <kbd>C</kbd> to confirm, <kbd>X</kbd> to dismiss.
    </p>
  );
}

/**
 * After a suggestion is confirmed or dismissed its card disappears. This moves focus to
 * the card that took its place, or the heading when none are left, and says what happened.
 */
export function ReviewFocus({ listId, headingId, pending, confirmed }: { listId: string; headingId: string; pending: number; confirmed: number }) {
  const previous = useRef({ pending, confirmed });
  const lastIndex = useRef(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    function onFocus(event: FocusEvent) {
      const card = (event.target as HTMLElement | null)?.closest?.("[data-suggestion]");
      if (!card) return;
      const cards = [...document.querySelectorAll(`#${listId} [data-suggestion]`)];
      const index = cards.indexOf(card);
      if (index !== -1) lastIndex.current = index;
    }
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [listId]);

  useEffect(() => {
    const before = previous.current;
    previous.current = { pending, confirmed };
    if (pending >= before.pending) return;

    const done = confirmed > before.confirmed ? (confirmed - before.confirmed === 1 ? "Task confirmed." : `${confirmed - before.confirmed} tasks confirmed.`) : "Suggestion dismissed.";
    setMessage(`${done} ${pending ? `${pending} to review.` : "All reviewed."}`);

    // Focus only moves if it was lost with the card, never away from where the user went.
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    const cards = [...document.querySelectorAll<HTMLElement>(`#${listId} [data-suggestion]`)];
    const next = cards[Math.min(lastIndex.current, cards.length - 1)];
    (next ?? document.getElementById(headingId))?.focus();
  }, [pending, confirmed, listId, headingId]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}
