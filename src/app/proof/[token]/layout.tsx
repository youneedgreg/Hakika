import { Suspense, type ReactNode } from "react";

export default function ProofLayout({ children }: { children: ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
