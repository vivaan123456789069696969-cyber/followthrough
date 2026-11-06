export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-sage-100" />
      <div className="h-24 animate-pulse rounded-2xl bg-sage-100" />
      <div className="h-48 animate-pulse rounded-2xl bg-sage-100" />
    </div>
  );
}
