import Link from "next/link";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <EmptyState
        title="Page not found"
        body="This link may be out of date, or the page was moved."
        action={
          <Link href="/" className="text-sm font-semibold text-brand underline">
            Back to Hakika
          </Link>
        }
      />
    </main>
  );
}
