"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/my-day", label: "My day" },
  { href: "/my-tasks", label: "My tasks" },
  { href: "/meetings", label: "Meetings" },
  { href: "/settings", label: "Settings" },
];

/** A left rail on larger screens and a bottom bar on phones. */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-56 md:shrink-0 md:border-t-0 md:border-r md:p-4"
    >
      <p className="mb-6 hidden px-3 pt-2 text-base font-semibold tracking-tight text-brand md:block">followthrough</p>
      <ul className="grid grid-cols-4 md:grid-cols-1 md:gap-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center px-1 text-center text-sm font-medium transition-colors duration-150 md:min-h-11 md:justify-start md:rounded-lg md:px-3 md:text-base ${
                  active ? "text-brand underline decoration-2 underline-offset-4 md:bg-sage-100 md:no-underline" : "text-ink-muted hover:text-ink md:hover:bg-sage-100"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
