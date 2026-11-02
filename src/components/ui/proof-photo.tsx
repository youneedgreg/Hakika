"use client";

// Shows a proof photo, or a clear placeholder while the demo photo file is not in place yet.
import { useState } from "react";

export function ProofPhoto({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt}: photo not available`}
        className={`flex items-center justify-center rounded-xl border border-dashed border-line bg-paper text-sm text-muted ${className}`}
      >
        Photo not available
      </div>
    );
  }

  // Proof photos come from Vercel Blob URLs, which next/image would need configured to load.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={`rounded-xl border border-line object-cover ${className}`} />;
}
