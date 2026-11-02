"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { segment: "", label: "Overview" },
  { segment: "/details", label: "Details" },
  { segment: "/gantt", label: "Gantt" },
  { segment: "/money", label: "Money trail" },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav aria-label="Project" className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
      {sections.map((section) => {
        const href = `${base}${section.segment}`;
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-brand text-white" : "text-muted hover:bg-brand-soft hover:text-brand-strong"
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
