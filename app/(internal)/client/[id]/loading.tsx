// Shown the moment a client is opened, while the page gathers its data: the
// page's frame (title, the Needs You strip, the tiles) in soft placeholders,
// so the click answers right away instead of waiting on a blank screen.

const bar = "animate-pulse rounded-md bg-foreground/[0.06]";

function TileSkeleton({ wide = false, rows = 3 }: { wide?: boolean; rows?: number }) {
  return (
    <section className={`rounded-2xl border border-border/70 bg-panel p-5 ${wide ? "md:col-span-2" : ""}`}>
      <div className="mb-4 flex items-center gap-2.5 border-b border-border/60 pb-3">
        <div className={`h-7 w-7 rounded-full ${bar}`} />
        <div className={`h-3 w-24 ${bar}`} />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={`h-3.5 ${bar}`} style={{ width: `${88 - i * 14}%` }} />
        ))}
      </div>
    </section>
  );
}

export default function ClientLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-10" aria-busy="true" aria-label="Loading client">
      <div className={`mb-6 h-3 w-16 ${bar}`} />
      <div className={`h-2.5 w-14 ${bar}`} />
      <div className={`mt-3 h-9 w-72 max-w-full ${bar}`} />
      <div className="mt-4 flex gap-2">
        <div className={`h-7 w-36 rounded-full ${bar}`} />
        <div className={`h-7 w-24 rounded-full ${bar}`} />
      </div>
      <div className="my-6 h-px bg-border/60" />
      <div className={`mb-5 h-14 rounded-2xl ${bar}`} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5">
        <TileSkeleton rows={4} />
        <TileSkeleton rows={4} />
        <TileSkeleton wide rows={5} />
        <TileSkeleton wide rows={4} />
      </div>
    </div>
  );
}
