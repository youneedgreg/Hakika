import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
