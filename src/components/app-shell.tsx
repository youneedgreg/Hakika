"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Add owner screens here as they land so the shell stays the single source of navigation.
const navItems = [{ href: "/components", label: "Components" }];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white"
            >
              H
            </span>
            Hakika
          </Link>
          <nav aria-label="Main" className="flex gap-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-brand-soft text-brand-strong" : "text-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
