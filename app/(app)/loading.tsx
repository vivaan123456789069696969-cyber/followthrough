/** Shown while a private page loads, in the shape of the page, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <main aria-busy="true" className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading
      </p>
      <div className="h-9 w-2/3 max-w-sm animate-pulse rounded-lg bg-sage-100 motion-reduce:animate-none" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile} className="h-24 animate-pulse rounded-2xl bg-sage-100 motion-reduce:animate-none" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-2xl bg-sage-100 motion-reduce:animate-none" />
    </main>
  );
}
