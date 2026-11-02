import Link from "next/link";
import { DEMO_PROJECT_ID } from "@/lib/demo-ids";

const linkClass =
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">Hakika</p>
      <h1 className="text-4xl font-semibold leading-tight">
        Pay the crew for work that is proven on site.
      </h1>
      <p className="max-w-xl text-lg text-muted">
        Quotes come in on WhatsApp. Payments wait for the owner&apos;s approval in PayPal. Photos taken on site
        are checked before any money moves.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href={`/projects/${DEMO_PROJECT_ID}`} className={`${linkClass} bg-brand text-white hover:bg-brand-strong`}>
          Open the demo project
        </Link>
        <Link href="/judge" className={`${linkClass} border border-line bg-surface text-ink hover:bg-paper`}>
          Judge Mode
        </Link>
      </div>
    </main>
  );
}
