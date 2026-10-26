type Photo = { src: string; label: string; caption?: string };

export function PhotoCompare({ left, right }: { left: Photo; right: Photo }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[left, right].map((photo) => (
        <figure key={photo.label} className="overflow-hidden rounded-xl border border-line bg-surface">
          {/* Proof photos are served from Vercel Blob URLs, which next/image would need configured to load. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.src} alt={photo.label} className="aspect-4/3 w-full object-cover" />
          <figcaption className="px-3 py-2 text-xs text-muted">
            <span className="font-semibold text-ink">{photo.label}</span>
            {photo.caption && <span> · {photo.caption}</span>}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
